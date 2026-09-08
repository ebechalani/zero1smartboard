/**
 * Time sources for the runtime (docs/ARCHITECTURE.md §5.1).
 *
 * `RealClock` follows the wall clock (`performance.now()`); the browser uses it.
 * `VirtualClock` keeps a counter that only moves when something sleeps or
 * yields, so tests are instant and deterministic.
 */
import type { Clock } from '../types';

/** Longest busy-wait `RealClock.sleep()` performs for sub-millisecond delays. */
const MAX_BUSY_WAIT_MS = 1;

/**
 * Wall-clock time. `sleep()` uses `setTimeout` (busy-waiting for delays under
 * 1 ms, which timers cannot honour) and resolves early when its signal aborts;
 * `yield()` hops to a new macrotask so the page can render and handle input.
 */
export class RealClock implements Clock {
  private epoch = performance.now();

  now(): number {
    return performance.now() - this.epoch;
  }

  micros(): number {
    return Math.floor(this.now() * 1000);
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!(ms >= MAX_BUSY_WAIT_MS)) {
      busyWait(Math.min(Math.max(ms, 0) || 0, MAX_BUSY_WAIT_MS));
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  yield(): Promise<void> {
    if (typeof MessageChannel === 'function') {
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          resolve();
        };
        channel.port2.postMessage(null);
      });
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  reset(): void {
    this.epoch = performance.now();
  }
}

function busyWait(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // spin: timers cannot wait less than a millisecond
  }
}

export interface VirtualClockOptions {
  /** Virtual milliseconds added by each `yield()` (the time a real loop iteration would take). Default 0.005. */
  yieldCostMs?: number;
}

/**
 * Simulated time for tests: `sleep(ms)` adds `ms` and resolves at once,
 * `yield()` adds a tiny `yieldCostMs` so busy loops still move forward.
 * `instantYield` tells the executor that yielding costs nothing real, so it
 * may yield on every cooperative tick.
 */
export class VirtualClock implements Clock {
  /** Marks a clock whose `yield()` is free (see `yieldsInstantly`). */
  readonly instantYield = true as const;
  readonly yieldCostMs: number;
  private time = 0;

  constructor(options: VirtualClockOptions = {}) {
    this.yieldCostMs = options.yieldCostMs ?? 0.005;
  }

  now(): number {
    return this.time;
  }

  micros(): number {
    return Math.floor(this.time * 1000);
  }

  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    this.advance(ms);
  }

  async yield(): Promise<void> {
    this.advance(this.yieldCostMs);
  }

  reset(): void {
    this.time = 0;
  }

  /** Move virtual time forward by `ms` (negative or NaN values are ignored). */
  advance(ms: number): void {
    if (ms > 0) this.time += ms;
  }
}

/** True for clocks (like `VirtualClock`) whose `yield()` only advances simulated time. */
export function yieldsInstantly(clock: Clock): boolean {
  return (clock as { instantYield?: unknown }).instantYield === true;
}
