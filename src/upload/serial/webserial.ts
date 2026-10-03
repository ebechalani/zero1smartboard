/**
 * Web Serial adapter: turns a W3C Web Serial `SerialPort` into the uploader's UploadPort.
 *
 * Structural types only (TypeScript's lib.dom has no Web Serial types, and the simulator
 * project already has its own `SerialPort` interface), so this file compiles anywhere and can
 * be tested in Node with a fake port built on WHATWG streams.
 *
 * Browser support: Chrome/Edge/Opera desktop ≥ 89, secure context (https or localhost).
 * Not Firefox, not Safari, not iOS; Android Chrome only for Bluetooth serial (no USB) — see README.
 */
import type { SerialSignals, UploadPort } from './port';
import { abortReason } from './port';
import { UploadError, MESSAGES } from './errors';
import { uploadParsed, DEFAULT_TIMING } from './uploader';
import type { UploadOptions, UploadResult } from './uploader';
import { parseIntelHex, HexParseError } from './intelhex';

export interface WebSerialOpenOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

export interface WebSerialPortLike {
  open(options: WebSerialOpenOptions): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean; break?: boolean }): Promise<void>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

export interface WebSerialLike {
  requestPort(options?: { filters?: { usbVendorId?: number; usbProductId?: number }[] }): Promise<WebSerialPortLike>;
  getPorts(): Promise<WebSerialPortLike[]>;
}

/** USB IDs of UNO-compatible boards. Used as chooser filters (the user can still see only these). */
export const UNO_USB_FILTERS = [
  { usbVendorId: 0x1a86 }, // WCH: CH340 (1A86:7523, the ZERO1 board and most UNO clones), CH341, CH343, CH9102…
  { usbVendorId: 0x2341 }, // Arduino SA (UNO R3 ATmega16U2: PID 0x0043/0x0001/0x0243)
  { usbVendorId: 0x2a03 }, // Arduino Srl
  { usbVendorId: 0x0403 }, // FTDI (FT232R and others)
  { usbVendorId: 0x10c4, usbProductId: 0xea60 }, // Silicon Labs CP210x
];

export function getWebSerial(): WebSerialLike | null {
  const nav = (globalThis as { navigator?: { serial?: WebSerialLike } }).navigator;
  return nav?.serial ?? null;
}

export function isWebSerialSupported(): boolean {
  return getWebSerial() !== null && (globalThis as { isSecureContext?: boolean }).isSecureContext !== false;
}

/**
 * Ask the user to pick the board. MUST be called synchronously from a click handler
 * (transient user activation), before any other `await`. `filters` limits the chooser
 * to those USB ids (null = every serial port).
 */
export async function requestBoardPort(
  serial: WebSerialLike | null = getWebSerial(),
  filters: readonly { usbVendorId?: number; usbProductId?: number }[] | null = UNO_USB_FILTERS,
): Promise<WebSerialPortLike> {
  if (!serial) {
    throw new UploadError('UNSUPPORTED', 'This browser cannot talk to USB boards. Use Google Chrome or Microsoft Edge on a computer.');
  }
  try {
    return await serial.requestPort(filters ? { filters: [...filters] } : {});
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'NotFoundError') throw new UploadError('ABORTED', 'No board selected.', {}, { cause: e });
    if (name === 'SecurityError') {
      throw new UploadError('UNSUPPORTED', 'The browser blocked access to USB serial ports on this page.', {}, { cause: e });
    }
    throw new UploadError('PORT', `Could not choose a port: ${(e as Error)?.message ?? e}`, {}, { cause: e });
  }
}

export function mapOpenError(e: unknown): UploadError {
  const name = (e as { name?: string })?.name;
  const msg = (e as Error)?.message ?? String(e);
  if (name === 'InvalidStateError') {
    return new UploadError('PORT', 'The port is already open in this page — close the serial monitor first.', { name }, { cause: e });
  }
  if (name === 'NetworkError') {
    // Chrome: "Failed to open serial port." — another program (or tab) holds the port.
    return new UploadError(
      'PORT',
      'Could not open the board\'s port: it is being used by another program. Close the Arduino IDE (Serial Monitor/Plotter), ' +
        'other browser tabs or apps using the board, then try again.',
      { name },
      { cause: e },
    );
  }
  return new UploadError('PORT', `Could not open the board's port: ${msg}`, { name }, { cause: e });
}

/** UploadPort over a Web Serial SerialPort. Owns the port while open. */
export class WebSerialUploadPort implements UploadPort {
  private queue: Uint8Array[] = [];
  private waiter: (() => void) | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private loop: Promise<void> | null = null;
  private fatal: unknown = null;
  private opened = false;
  baud = 0;

  constructor(readonly port: WebSerialPortLike) {}

  static async open(port: WebSerialPortLike, baud = 115200): Promise<WebSerialUploadPort> {
    const p = new WebSerialUploadPort(port);
    await p.open(baud);
    return p;
  }

  async open(baud: number): Promise<void> {
    try {
      await this.port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 });
    } catch (e) {
      throw mapOpenError(e);
    }
    this.baud = baud;
    this.opened = true;
    this.fatal = null;
    this.queue = [];
    this.loop = this.readLoop();
  }

  private async readLoop(): Promise<void> {
    // Per the spec, framing/parity/break/overrun errors error the current stream but
    // port.readable is replaced with a fresh one; only a lost device leaves it null.
    while (this.opened && this.port.readable) {
      const reader = this.port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) {
            this.queue.push(value);
            this.wake();
          }
        }
      } catch (e) {
        const name = (e as { name?: string })?.name;
        const nonFatal = name === 'BreakError' || name === 'FramingError' || name === 'ParityError' || name === 'BufferOverrunError';
        if (!nonFatal) this.fatal = e;
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
        this.reader = null;
      }
      if (this.fatal) break;
    }
    if (this.opened && !this.fatal) this.fatal = new Error('The board was disconnected');
    this.wake();
  }

  private wake(): void {
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  private take(): Uint8Array {
    if (this.queue.length === 1) return this.queue.pop()!;
    let n = 0;
    for (const c of this.queue) n += c.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of this.queue) {
      out.set(c, o);
      o += c.length;
    }
    this.queue = [];
    return out;
  }

  async write(bytes: Uint8Array): Promise<void> {
    const w = this.port.writable;
    if (!w) throw new UploadError('PORT', 'The board was disconnected');
    const writer = w.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  read(timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array | null> {
    if (this.queue.length) return Promise.resolve(this.take());
    if (this.fatal) return Promise.reject(new UploadError('PORT', `Lost the connection to the board: ${(this.fatal as Error)?.message ?? this.fatal}`));
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (this.waiter === done) this.waiter = null;
        if (this.queue.length) resolve(this.take());
        else if (this.fatal) reject(new UploadError('PORT', `Lost the connection to the board: ${(this.fatal as Error)?.message ?? this.fatal}`));
        else resolve(null);
      };
      const onAbort = () => {
        clearTimeout(timer);
        if (this.waiter === done) this.waiter = null;
        reject(abortReason(signal!));
      };
      const timer = setTimeout(done, Math.max(0, timeoutMs));
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiter = done;
    });
  }

  async setSignals(s: SerialSignals): Promise<void> {
    await this.port.setSignals(s);
  }

  /** Web Serial cannot change the baud rate of an open port: close and reopen (this also toggles DTR → reset). */
  async setBaud(baud: number): Promise<void> {
    await this.close();
    await this.open(baud);
  }

  discardInput(): void {
    this.queue = [];
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    this.opened = false;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    await this.loop;
    try {
      await this.port.close();
    } catch {
      /* already closed / device gone */
    }
  }
}

export interface WebUploadOptions extends Omit<UploadOptions, 'clock'> {
  /** An already-granted port (from requestBoardPort() or navigator.serial.getPorts()). */
  port: WebSerialPortLike;
}

/**
 * One-call upload for the UI:
 *   const port = await requestBoardPort();          // inside the click handler
 *   const res = await uploadWithWebSerial(hexText, { port, onProgress, signal });
 * The hex is parsed and size-checked BEFORE the port is opened (opening it resets the board).
 */
export async function uploadWithWebSerial(hexText: string, opts: WebUploadOptions): Promise<UploadResult> {
  let hex;
  try {
    hex = parseIntelHex(hexText);
  } catch (e) {
    if (e instanceof HexParseError) throw new UploadError(e.code, `The compiled program (.hex) is damaged: ${e.message}`, { line: e.line }, { cause: e });
    throw e;
  }
  const max = opts.maxSize ?? 32256;
  if (hex.maxAddress > max) throw new UploadError('TOO_LARGE', MESSAGES.tooLarge(hex.maxAddress, max), { size: hex.maxAddress, max });
  const bauds = opts.baudRates ?? [115200, 57600];
  const up = await WebSerialUploadPort.open(opts.port, bauds[0]);
  try {
    return await uploadParsed(up, hex, { ...opts, baudRates: bauds, timing: { ...DEFAULT_TIMING, ...opts.timing } });
  } finally {
    await up.close();
  }
}
