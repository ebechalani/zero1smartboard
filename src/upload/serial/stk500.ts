/**
 * STK500 version 1 protocol, the subset Optiboot (and the older ATmegaBOOT) understand.
 *
 * Constants: Atmel AVR061 "STK500 Communication Protocol" (command.h, reproduced verbatim as
 * avrdude's stk500_private.h). Behaviour: optiboot.c (ArduinoCore-avr 1.8.6, Optiboot 4.4)
 * and avrdude stk500.c / arduino.c (6.3 = what Arduino IDE ships for the AVR core, 7.x/8.x).
 *
 * Every command is `<cmd> [args…] 0x20 (CRC_EOP)`; the bootloader answers
 * `0x14 (INSYNC) [data…] 0x10 (OK)`. Optiboot never answers NOSYNC: if the byte where it expects
 * 0x20 is anything else, it sets a 16 ms watchdog and resets (→ runs the application).
 */
import { UploadError, MESSAGES, hexBytes } from './errors';
import type { Clock, UploadPort } from './port';
import { abortReason } from './port';

export const STK = {
  OK: 0x10,
  FAILED: 0x11,
  UNKNOWN: 0x12,
  NODEVICE: 0x13,
  INSYNC: 0x14,
  NOSYNC: 0x15,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  GET_PARAMETER: 0x41,
  SET_DEVICE: 0x42,
  SET_DEVICE_EXT: 0x45,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  UNIVERSAL: 0x56,
  PROG_PAGE: 0x64,
  READ_PAGE: 0x74,
  READ_SIGN: 0x75,
  PARM_SW_MAJOR: 0x81,
  PARM_SW_MINOR: 0x82,
  MEMTYPE_FLASH: 0x46, // 'F'
} as const;

const RESPONSE_NAMES: Record<number, string> = {
  0x10: 'OK',
  0x11: 'FAILED',
  0x12: 'UNKNOWN',
  0x13: 'NODEVICE',
  0x14: 'INSYNC',
  0x15: 'NOSYNC',
};

export type TraceFn = (dir: 'tx' | 'rx', bytes: Uint8Array, atMs: number) => void;

/** Byte-level client: buffering, timeouts, INSYNC/OK framing. */
export class Stk500Client {
  private buf: number[] = [];
  private head = 0;
  /** Everything received (for diagnostics), capped. */
  readonly received: number[] = [];

  constructor(
    private readonly port: UploadPort,
    private readonly clock: Clock,
    private readonly signal?: AbortSignal,
    private readonly trace?: TraceFn,
  ) {}

  checkAbort(): void {
    if (this.signal?.aborted) throw new UploadError('ABORTED', MESSAGES.aborted, {}, { cause: abortReason(this.signal) });
  }

  async send(bytes: ArrayLike<number>): Promise<void> {
    this.checkAbort();
    const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes as ArrayLike<number>);
    this.trace?.('tx', data, this.clock.now());
    await this.port.write(data);
  }

  /** Next received byte, or null if none arrives before `deadline` (clock ms). */
  async readByte(deadline: number): Promise<number | null> {
    for (;;) {
      if (this.head < this.buf.length) {
        const b = this.buf[this.head++];
        if (this.head > 4096 && this.head * 2 > this.buf.length) {
          this.buf = this.buf.slice(this.head);
          this.head = 0;
        }
        return b;
      }
      this.checkAbort();
      const remaining = deadline - this.clock.now();
      if (remaining <= 0) return null;
      let chunk: Uint8Array | null;
      try {
        chunk = await this.port.read(remaining, this.signal);
      } catch (e) {
        if (this.signal?.aborted) throw new UploadError('ABORTED', MESSAGES.aborted, {}, { cause: e });
        if (e instanceof UploadError) throw e;
        throw new UploadError('PORT', `Lost the connection to the board: ${(e as Error)?.message ?? e}`, {}, { cause: e });
      }
      this.checkAbort();
      if (chunk === null) return null;
      this.trace?.('rx', chunk, this.clock.now());
      for (const b of chunk) {
        this.buf.push(b);
        if (this.received.length < 4096) this.received.push(b);
      }
    }
  }

  /** Read exactly n bytes or throw PROTOCOL (timeout). */
  async readExact(n: number, timeoutMs: number, what: string): Promise<Uint8Array> {
    const deadline = this.clock.now() + timeoutMs;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const b = await this.readByte(deadline);
      if (b === null) {
        throw new UploadError('PROTOCOL', MESSAGES.protocol(`no reply to ${what} after ${timeoutMs} ms, got ${i} of ${n} bytes`), {
          what,
          got: Array.from(out.subarray(0, i)),
        });
      }
      out[i] = b;
    }
    return out;
  }

  /** Throw away pending input, then keep reading until the line has been quiet for `quietMs` (max `maxMs`). */
  async drain(quietMs: number, maxMs = 1000): Promise<number[]> {
    const dropped = this.buf.slice(this.head);
    this.buf = [];
    this.head = 0;
    this.port.discardInput?.();
    const end = this.clock.now() + maxMs;
    for (;;) {
      const deadline = Math.min(end, this.clock.now() + quietMs);
      const b = await this.readByte(deadline);
      if (b === null) break;
      dropped.push(b);
      // readByte may have buffered a whole chunk; drop it all.
      while (this.head < this.buf.length) dropped.push(this.buf[this.head++]);
      if (this.clock.now() >= end) break;
    }
    this.buf = [];
    this.head = 0;
    return dropped;
  }

  /**
   * Send `cmd + CRC_EOP`, expect INSYNC, `dataLen` bytes, OK. Returns the data bytes.
   */
  async command(cmd: ArrayLike<number>, dataLen: number, timeoutMs: number, what: string): Promise<Uint8Array> {
    const frame = new Uint8Array(cmd.length + 1);
    frame.set(cmd as ArrayLike<number>);
    frame[cmd.length] = STK.CRC_EOP;
    await this.send(frame);
    const first = await this.readExact(1, timeoutMs, what);
    if (first[0] !== STK.INSYNC) {
      throw new UploadError(
        'PROTOCOL',
        MESSAGES.protocol(`${what}: expected INSYNC 0x14, got 0x${hexBytes(first)}${RESPONSE_NAMES[first[0]] ? ' ' + RESPONSE_NAMES[first[0]] : ''}`),
        { what, response: first[0] },
      );
    }
    const data = dataLen > 0 ? await this.readExact(dataLen, timeoutMs, what) : new Uint8Array(0);
    const last = await this.readExact(1, timeoutMs, what);
    if (last[0] !== STK.OK) {
      throw new UploadError(
        'PROTOCOL',
        MESSAGES.protocol(`${what}: expected OK 0x10, got 0x${hexBytes(last)}${RESPONSE_NAMES[last[0]] ? ' ' + RESPONSE_NAMES[last[0]] : ''}`),
        { what, response: last[0] },
      );
    }
    return data;
  }

  /**
   * One GET_SYNC round trip: send 0x30 0x20, then read until INSYNC,OK is seen or `timeoutMs` passes.
   * Returns every byte seen (for diagnostics) and whether 0x14 0x10 was among them.
   */
  async syncOnce(timeoutMs: number): Promise<{ ok: boolean; seen: number[] }> {
    await this.send([STK.GET_SYNC, STK.CRC_EOP]);
    const deadline = this.clock.now() + timeoutMs;
    const seen: number[] = [];
    let prev = -1;
    for (;;) {
      const b = await this.readByte(deadline);
      if (b === null) return { ok: false, seen };
      seen.push(b);
      if (prev === STK.INSYNC && b === STK.OK) return { ok: true, seen };
      prev = b;
    }
  }

  getParameter(param: number, timeoutMs: number): Promise<number> {
    return this.command([STK.GET_PARAMETER, param], 1, timeoutMs, `GET_PARAMETER 0x${param.toString(16)}`).then((d) => d[0]);
  }

  readSignature(timeoutMs: number): Promise<Uint8Array> {
    return this.command([STK.READ_SIGN], 3, timeoutMs, 'READ_SIGN');
  }

  async enterProgMode(timeoutMs: number): Promise<void> {
    await this.command([STK.ENTER_PROGMODE], 0, timeoutMs, 'ENTER_PROGMODE');
  }

  async leaveProgMode(timeoutMs: number): Promise<void> {
    await this.command([STK.LEAVE_PROGMODE], 0, timeoutMs, 'LEAVE_PROGMODE');
  }

  /** `byteAddress` must be even; STK500 flash addresses are 16-bit WORD addresses, little-endian. */
  async loadAddress(byteAddress: number, timeoutMs: number): Promise<void> {
    const word = byteAddress >>> 1;
    await this.command([STK.LOAD_ADDRESS, word & 0xff, (word >> 8) & 0xff], 0, timeoutMs, `LOAD_ADDRESS 0x${byteAddress.toString(16)}`);
  }

  /** Program one flash page. Length is big-endian (AVR061), memtype 'F'. */
  async progPage(data: Uint8Array, timeoutMs: number, byteAddress: number): Promise<void> {
    const cmd = new Uint8Array(4 + data.length);
    cmd[0] = STK.PROG_PAGE;
    cmd[1] = (data.length >> 8) & 0xff;
    cmd[2] = data.length & 0xff;
    cmd[3] = STK.MEMTYPE_FLASH;
    cmd.set(data, 4);
    await this.command(cmd, 0, timeoutMs, `PROG_PAGE 0x${byteAddress.toString(16)}`);
  }

  readPage(length: number, timeoutMs: number, byteAddress: number): Promise<Uint8Array> {
    return this.command(
      [STK.READ_PAGE, (length >> 8) & 0xff, length & 0xff, STK.MEMTYPE_FLASH],
      length,
      timeoutMs,
      `READ_PAGE 0x${byteAddress.toString(16)}`,
    );
  }
}
