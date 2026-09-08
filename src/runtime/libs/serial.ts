/**
 * `Serial`: the UNO's USB serial port as the sketch sees it (Arduino
 * `HardwareSerial` + the `Stream` parsing helpers).
 *
 * Output goes to `board.serial.write`, input comes from the board's RX buffer
 * (filled by the serial monitor). Blocking reads wait in short slices of
 * simulated time so that the sketch can still be stopped while it waits.
 */
import { FloatBox } from '../values';
import type { LibContext } from './print';
import { cstr, formatPrintArg, toNumber } from './print';

/** Arduino's default `Stream` timeout for the blocking reads. */
const DEFAULT_TIMEOUT_MS = 1000;
/** How long a blocking read sleeps between two looks at the RX buffer. */
const WAIT_SLICE_MS = 5;
const NO_DATA = -1;
/** The UNO keeps a 64-byte transmit buffer and reports one byte less as free, like the real core. */
const TX_FREE_BYTES = 63;
const CHAR_MINUS = 45;
const CHAR_DOT = 46;
const CHAR_0 = 48;
const CHAR_9 = 57;

const OUTPUT_IGNORED = 'Serial output ignored: call Serial.begin(9600) in setup()';
const INPUT_IGNORED = 'Serial input ignored: call Serial.begin(9600) in setup()';

/** The `Serial` object handed to the sketch. Every method may be awaited. */
export interface ArduinoSerial {
  begin(baud?: unknown): void;
  end(): void;
  /** Format `value` like Arduino `Print` and send it; returns the number of characters written. */
  print(value?: unknown, fmt?: unknown): number;
  /** Like `print` followed by `\r\n`. */
  println(value?: unknown, fmt?: unknown): number;
  /** Send raw bytes: a number is one byte, a string is sent as is, a char array optionally limited to `len` bytes. */
  write(value: unknown, len?: unknown): number;
  available(): number;
  availableForWrite(): number;
  read(): number;
  peek(): number;
  flush(): void;
  setTimeout(ms: unknown): void;
  getTimeout(): number;
  readString(): Promise<string>;
  readStringUntil(terminator: unknown): Promise<string>;
  readBytes(buffer: unknown, length: unknown): Promise<number>;
  readBytesUntil(terminator: unknown, buffer: unknown, length: unknown): Promise<number>;
  parseInt(): Promise<number>;
  parseFloat(): Promise<number>;
  find(target: unknown): Promise<boolean>;
  findUntil(target: unknown, terminator: unknown): Promise<boolean>;
}

/** Build the `Serial` object for one sketch run. */
export function createSerial(lib: LibContext): ArduinoSerial {
  const { ctx } = lib;
  let begun = false;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  function port() {
    return ctx.board.serial;
  }

  function send(text: string): number {
    if (!begun) {
      lib.warnOnce(OUTPUT_IGNORED);
      return 0;
    }
    if (text.length > 0) port().write(text);
    return text.length;
  }

  /** True when the port is open; otherwise warns once, like output does, and the read yields nothing. */
  function inputOpen(): boolean {
    if (!begun) lib.warnOnce(INPUT_IGNORED);
    return begun;
  }

  /** Wait (in slices) until `look()` returns a byte or the timeout elapses. */
  async function timed(look: () => number): Promise<number> {
    if (!inputOpen()) return NO_DATA;
    const start = ctx.clock.now();
    for (;;) {
      const c = look();
      if (c >= 0) return c;
      const remaining = timeoutMs - (ctx.clock.now() - start);
      if (remaining <= 0) return NO_DATA;
      await ctx.clock.sleep(Math.min(WAIT_SLICE_MS, remaining), ctx.signal);
      ctx.throwIfStopped();
    }
  }

  const timedRead = () => timed(() => port().read());
  const timedPeek = () => timed(() => port().peek());

  /** Skip input until a digit, a minus sign (or a dot when `detectDecimal`) is next; returns it without consuming it. */
  async function peekNextDigit(detectDecimal: boolean): Promise<number> {
    for (;;) {
      const c = await timedPeek();
      if (c < 0 || c === CHAR_MINUS || isDigit(c) || (detectDecimal && c === CHAR_DOT)) return c;
      port().read();
    }
  }

  async function readUntil(terminator: number | null, maxLength: number, onByte: (c: number, index: number) => void): Promise<number> {
    let count = 0;
    while (count < maxLength) {
      const c = await timedRead();
      if (c < 0 || c === terminator) break;
      onByte(c, count);
      count++;
    }
    return count;
  }

  /** Read bytes until `target` (a string or a char) has been seen; stops early on the terminator. */
  async function scanFor(target: string, terminator: string): Promise<boolean> {
    if (target.length === 0) return true;
    let matched = 0;
    let terminatorMatched = 0;
    for (;;) {
      const c = await timedRead();
      if (c < 0) return false;
      matched = advanceMatch(target, matched, c);
      if (matched === target.length) return true;
      if (terminator.length > 0) {
        terminatorMatched = advanceMatch(terminator, terminatorMatched, c);
        if (terminatorMatched === terminator.length) return false;
      }
    }
  }

  return {
    begin(): void {
      begun = true;
    },
    end(): void {
      begun = false;
    },
    print(value?: unknown, fmt?: unknown): number {
      if (value === undefined) return 0;
      return send(formatPrintArg(value, fmt === undefined ? undefined : toNumber(fmt)));
    },
    println(value?: unknown, fmt?: unknown): number {
      const text = value === undefined ? '' : formatPrintArg(value, fmt === undefined ? undefined : toNumber(fmt));
      return send(text + '\r\n');
    },
    write(value: unknown, len?: unknown): number {
      return send(bytesToText(value, len));
    },
    available(): number {
      return inputOpen() ? port().available() : 0;
    },
    availableForWrite(): number {
      return TX_FREE_BYTES;
    },
    read(): number {
      return inputOpen() ? port().read() : NO_DATA;
    },
    peek(): number {
      return inputOpen() ? port().peek() : NO_DATA;
    },
    flush(): void {
      // Output is delivered immediately; nothing is left to wait for.
    },
    setTimeout(ms: unknown): void {
      timeoutMs = Math.max(0, toNumber(ms));
    },
    getTimeout(): number {
      return timeoutMs;
    },
    async readString(): Promise<string> {
      let out = '';
      await readUntil(null, Infinity, (c) => {
        out += String.fromCharCode(c);
      });
      return out;
    },
    async readStringUntil(terminator: unknown): Promise<string> {
      let out = '';
      await readUntil(charCode(terminator), Infinity, (c) => {
        out += String.fromCharCode(c);
      });
      return out;
    },
    readBytes(buffer: unknown, length: unknown): Promise<number> {
      return readUntil(null, Math.trunc(toNumber(length)), (c, i) => storeByte(buffer, i, c));
    },
    readBytesUntil(terminator: unknown, buffer: unknown, length: unknown): Promise<number> {
      return readUntil(charCode(terminator), Math.trunc(toNumber(length)), (c, i) => storeByte(buffer, i, c));
    },
    async parseInt(): Promise<number> {
      let negative = false;
      let value = 0;
      let c = await peekNextDigit(false);
      if (c < 0) return 0;
      do {
        if (c === CHAR_MINUS) negative = true;
        else if (isDigit(c)) value = value * 10 + (c - CHAR_0);
        port().read();
        c = await timedPeek();
      } while (isDigit(c));
      return negative ? -value : value;
    },
    async parseFloat(): Promise<number> {
      let negative = false;
      let fraction = false;
      let value = 0;
      let scale = 1;
      let c = await peekNextDigit(true);
      if (c < 0) return 0;
      do {
        if (c === CHAR_MINUS) negative = true;
        else if (c === CHAR_DOT) fraction = true;
        else if (isDigit(c)) {
          value = value * 10 + (c - CHAR_0);
          if (fraction) scale *= 0.1;
        }
        port().read();
        c = await timedPeek();
      } while (isDigit(c) || (c === CHAR_DOT && !fraction));
      if (negative) value = -value;
      return fraction ? value * scale : value;
    },
    find(target: unknown): Promise<boolean> {
      return scanFor(textOf(target), '');
    },
    findUntil(target: unknown, terminator: unknown): Promise<boolean> {
      return scanFor(textOf(target), textOf(terminator));
    },
  };
}

function isDigit(c: number): boolean {
  return c >= CHAR_0 && c <= CHAR_9;
}

/** A terminator/char argument: a 1-char string (a `char`) or a char code. */
function charCode(v: unknown): number {
  if (typeof v === 'string') return v.length > 0 ? v.charCodeAt(0) : 0;
  return Math.trunc(toNumber(v)) & 0xff;
}

/** A search target: a string, a char array, or a single char given as a code. */
function textOf(v: unknown): string {
  if (typeof v === 'number' || v instanceof FloatBox) return String.fromCharCode(charCode(v));
  return cstr(v);
}

function storeByte(buffer: unknown, index: number, c: number): void {
  if (Array.isArray(buffer) && index < buffer.length) buffer[index] = c;
}

/** Text for `write(x)` / `write(buf, len)`. */
function bytesToText(value: unknown, len: unknown): string {
  if (typeof value === 'number' || value instanceof FloatBox || typeof value === 'boolean') {
    return String.fromCharCode(toNumber(value) & 0xff);
  }
  if (len === undefined) return cstr(value);
  const count = Math.max(0, Math.trunc(toNumber(len)));
  if (Array.isArray(value)) {
    let out = '';
    for (let i = 0; i < count && i < value.length; i++) out += String.fromCharCode(toNumber(value[i]) & 0xff);
    return out;
  }
  return cstr(value).slice(0, count);
}

/** Advance a naive substring matcher by one byte; returns the new number of matched characters. */
function advanceMatch(target: string, matched: number, c: number): number {
  if (c === target.charCodeAt(matched)) return matched + 1;
  return c === target.charCodeAt(0) ? 1 : 0;
}
