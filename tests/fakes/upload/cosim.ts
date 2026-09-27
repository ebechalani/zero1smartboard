/**
 * Discrete-event co-simulation: runs the (async, promise-based) uploader against the
 * (synchronous) emulated UNO in SIMULATED time.
 *
 * The uploader only waits through the injected Clock.sleep() and UploadPort.read(timeout);
 * both register a deadline here. The driver lets the uploader run until it blocks (all
 * microtasks drained), then runs the AVR until the earliest deadline or until a byte reaches
 * the host while a read is pending, resolves what is due, and repeats.
 */
import type { Clock, SerialSignals, UploadPort } from '../../../src/upload/serial/port';
import type { UnoSim } from './uno-sim';

interface Waiter {
  deadline: number; // global cycle
  resolve: () => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface ReadWaiter {
  deadline: number;
  resolve: (v: Uint8Array | null) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const flush = () => new Promise<void>((r) => setImmediate(r));

export class CoSim {
  private sleeps: Waiter[] = [];
  private reading: ReadWaiter | null = null;
  readonly log: string[] = [];
  /** Bytes thrown away through discardInput() (stale sketch output before the sync). */
  discardedBytes = 0;
  /** Called after every loop iteration; lets tests inject faults (e.g. abort at a given time). */
  onTick?: (sim: UnoSim) => void;

  constructor(readonly sim: UnoSim) {}

  readonly clock: Clock = {
    now: () => this.sim.nowMs,
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const w: Waiter = { deadline: this.sim.now + this.sim.ms(ms), resolve, reject, signal };
        if (signal) {
          w.onAbort = () => {
            this.sleeps = this.sleeps.filter((x) => x !== w);
            reject(signal.reason);
          };
          signal.addEventListener('abort', w.onAbort, { once: true });
        }
        this.sleeps.push(w);
      }),
  };

  readonly port: UploadPort = {
    write: async (bytes: Uint8Array) => {
      this.sim.hostWrite(bytes);
    },
    read: (timeoutMs: number, signal?: AbortSignal) => {
      if (this.reading) return Promise.reject(new Error('concurrent read'));
      if (this.sim.hostRxAvailable() > 0) return Promise.resolve(this.sim.hostTakeRx());
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise<Uint8Array | null>((resolve, reject) => {
        const w: ReadWaiter = { deadline: this.sim.now + this.sim.ms(timeoutMs), resolve, reject, signal };
        if (signal) {
          w.onAbort = () => {
            if (this.reading === w) this.reading = null;
            reject(signal.reason);
          };
          signal.addEventListener('abort', w.onAbort, { once: true });
        }
        this.reading = w;
      });
    },
    setSignals: async (s: SerialSignals) => {
      if (s.dataTerminalReady !== undefined) this.sim.setDTR(s.dataTerminalReady);
    },
    setBaud: async (baud: number) => {
      // Web Serial: close() drops DTR, open() asserts it again → the board resets, like on hardware.
      this.sim.setDTR(false);
      this.sim.hostBaud = baud;
      this.sim.setDTR(true);
    },
    discardInput: () => {
      this.discardedBytes += this.sim.hostTakeRx().length;
    },
  };

  /** Run `fn` (the uploader) to completion in simulated time. */
  async run<T>(fn: (port: UploadPort, clock: Clock) => Promise<T>, maxSimMs = 120_000): Promise<T> {
    let settled = false;
    let value: T | undefined;
    let error: unknown;
    fn(this.port, this.clock).then(
      (v) => {
        settled = true;
        value = v;
      },
      (e) => {
        settled = true;
        error = e;
      },
    );
    const limit = this.sim.now + this.sim.ms(maxSimMs);
    let idleSpins = 0;
    while (!settled) {
      await flush();
      if (settled) break;
      const deadlines = this.sleeps.map((s) => s.deadline);
      if (this.reading) deadlines.push(this.reading.deadline);
      if (!deadlines.length) {
        // Uploader is waiting on something we do not drive (should not happen).
        if (++idleSpins > 100) throw new Error('co-sim deadlock: uploader is not waiting on the simulated clock or port');
        await new Promise((r) => setTimeout(r, 1));
        continue;
      }
      idleSpins = 0;
      const target = Math.min(...deadlines);
      if (target > limit) throw new Error(`simulation limit of ${maxSimMs} ms reached`);
      this.sim.runUntil(target, this.reading !== null);
      this.onTick?.(this.sim);
      const now = this.sim.now;
      const r = this.reading;
      if (r) {
        if (this.sim.hostRxAvailable() > 0) {
          this.reading = null;
          r.signal?.removeEventListener('abort', r.onAbort!);
          r.resolve(this.sim.hostTakeRx());
        } else if (now >= r.deadline) {
          this.reading = null;
          r.signal?.removeEventListener('abort', r.onAbort!);
          r.resolve(null);
        }
      }
      const due = this.sleeps.filter((s) => s.deadline <= now);
      if (due.length) {
        this.sleeps = this.sleeps.filter((s) => s.deadline > now);
        for (const s of due) {
          s.signal?.removeEventListener('abort', s.onAbort!);
          s.resolve();
        }
      }
    }
    if (error !== undefined) throw error;
    return value as T;
  }
}
