/**
 * Protocol-level fake of Optiboot 4.4 behind a fake serial port, in virtual time (no real timers):
 * read(timeout) with nothing to deliver advances the virtual clock by `timeout` and returns null,
 * sleep(ms) advances it by ms. Faults are injected through options.
 */
import type { Clock, SerialSignals, UploadPort } from '../../../src/upload/serial/port';

export interface FakeOptions {
  /** Baud the fake bootloader listens at; other bauds get no answer. */
  baud?: number;
  /** Never answer anything. */
  silent?: boolean;
  /** Answer every write with this text (a running sketch that was not reset). */
  chatter?: string;
  /** Answer GET_SYNC with these bytes instead of 14 10. */
  syncReply?: number[];
  signature?: [number, number, number];
  version?: [number, number];
  /** Flip bit 0 of the byte stored at this address (flash defect → verify must fail). */
  corruptAt?: number;
  /** Stop answering after this many PROG_PAGE commands. */
  dieAfterPages?: number;
  /** Answer PROG_PAGE with 14 11 (FAILED) instead of 14 10. */
  failProgPage?: boolean;
  /** Needs a DTR reset before it answers (default true). */
  needsReset?: boolean;
  /** Latency per reply (ms of virtual time). */
  replyDelayMs?: number;
}

export class FakeOptibootPort implements UploadPort {
  now = 0;
  baud: number;
  readonly flash = new Uint8Array(0x8000).fill(0xff);
  readonly writes: Uint8Array[] = [];
  readonly signals: SerialSignals[] = [];
  readonly bauds: number[] = [];
  resets = 0;
  pagesProgrammed = 0;
  private rx: number[] = []; // bytes waiting for the bootloader
  private out: { t: number; b: number }[] = []; // bytes waiting for the host
  private address = 0;
  private dtr = false;
  private inBootloader = false;
  private dead = false;
  /** Hook to run on each read (e.g. abort at a given point). */
  onRead?: (port: FakeOptibootPort) => void;

  constructor(readonly o: FakeOptions = {}) {
    this.baud = 115200;
    if (o.needsReset === false) this.inBootloader = true;
  }

  readonly clock: Clock = {
    now: () => this.now,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw signal.reason;
      this.now += ms;
    },
  };

  async write(bytes: Uint8Array): Promise<void> {
    this.writes.push(bytes.slice());
    if (this.o.chatter) {
      for (const c of this.o.chatter) this.reply([c.charCodeAt(0)]);
      return;
    }
    if (this.o.silent || this.dead || !this.inBootloader || this.baud !== (this.o.baud ?? 115200)) return;
    this.rx.push(...bytes);
    this.process();
  }

  async read(timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array | null> {
    this.onRead?.(this);
    if (signal?.aborted) throw signal.reason;
    const due = this.out.filter((x) => x.t <= this.now + timeoutMs);
    if (due.length === 0) {
      this.now += timeoutMs;
      return null;
    }
    const t = Math.max(this.now, due[0].t);
    this.now = t;
    const ready = this.out.filter((x) => x.t <= t);
    this.out = this.out.filter((x) => x.t > t);
    return Uint8Array.from(ready.map((x) => x.b));
  }

  async setSignals(s: SerialSignals): Promise<void> {
    this.signals.push({ ...s });
    if (s.dataTerminalReady && !this.dtr && this.o.needsReset !== false) {
      this.resets++;
      this.inBootloader = true;
      this.rx = [];
    }
    if (s.dataTerminalReady !== undefined) this.dtr = s.dataTerminalReady;
  }

  async setBaud(baud: number): Promise<void> {
    this.bauds.push(baud);
    this.baud = baud;
  }

  discardInput(): void {
    this.out = this.out.filter((x) => x.t > this.now);
  }

  private reply(bytes: number[]): void {
    const t = this.now + (this.o.replyDelayMs ?? 0.1);
    for (const b of bytes) this.out.push({ t, b });
  }

  /** Optiboot main loop, fed from this.rx. */
  private process(): void {
    for (;;) {
      if (this.rx.length === 0) return;
      const cmd = this.rx[0];
      const need = cmdLength(cmd, this.rx);
      if (need === null || this.rx.length < need) return;
      const frame = this.rx.splice(0, need);
      if (frame[need - 1] !== 0x20) {
        // Optiboot: verifySpace() fails → watchdog reset → application. Stop answering.
        this.inBootloader = false;
        return;
      }
      const OK = [0x14, 0x10];
      switch (cmd) {
        case 0x30:
          this.reply(this.o.syncReply ?? OK);
          break;
        case 0x41: {
          const [maj, min] = this.o.version ?? [4, 4];
          this.reply([0x14, frame[1] === 0x81 ? maj : frame[1] === 0x82 ? min : 0x03, 0x10]);
          break;
        }
        case 0x75: {
          const sig = this.o.signature ?? [0x1e, 0x95, 0x0f];
          this.reply([0x14, ...sig, 0x10]);
          break;
        }
        case 0x55:
          this.address = (frame[1] | (frame[2] << 8)) * 2;
          this.reply(OK);
          break;
        case 0x64: {
          if (this.o.dieAfterPages !== undefined && this.pagesProgrammed >= this.o.dieAfterPages) {
            this.dead = true;
            return;
          }
          const len = (frame[1] << 8) | frame[2];
          const data = frame.slice(4, 4 + len);
          for (let i = 0; i < len; i++) {
            let b = data[i];
            if (this.address + i === this.o.corruptAt) b ^= 1;
            this.flash[this.address + i] = b;
          }
          this.pagesProgrammed++;
          this.reply(this.o.failProgPage ? [0x14, 0x11] : OK);
          break;
        }
        case 0x74: {
          const len = (frame[1] << 8) | frame[2];
          this.reply([0x14, ...this.flash.subarray(this.address, this.address + len), 0x10]);
          break;
        }
        case 0x51:
          this.reply(OK);
          this.inBootloader = false; // 16 ms watchdog → sketch
          break;
        default:
          this.reply(OK);
      }
    }
  }
}

function cmdLength(cmd: number, rx: number[]): number | null {
  switch (cmd) {
    case 0x41:
      return 3;
    case 0x42:
      return 22;
    case 0x45:
      return 7;
    case 0x55:
      return 4;
    case 0x56:
      return 6;
    case 0x64:
    case 0x74: {
      if (rx.length < 3) return null;
      const len = (rx[1] << 8) | rx[2];
      return cmd === 0x64 ? 4 + len + 1 : 5;
    }
    default:
      return 2;
  }
}
