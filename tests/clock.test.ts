import { describe, expect, it } from 'vitest';
import { RealClock, VirtualClock, yieldsInstantly } from '../src/runtime/clock';

describe('VirtualClock', () => {
  it('starts at zero and only moves when something sleeps', async () => {
    const clock = new VirtualClock();
    expect(clock.now()).toBe(0);
    expect(clock.micros()).toBe(0);
    await clock.sleep(100);
    expect(clock.now()).toBe(100);
    expect(clock.micros()).toBe(100_000);
    await clock.sleep(0.25);
    expect(clock.now()).toBeCloseTo(100.25, 9);
    expect(clock.micros()).toBe(100_250);
  });

  it('charges a tiny cost per yield so busy loops make progress', async () => {
    const clock = new VirtualClock();
    for (let i = 0; i < 200; i++) await clock.yield();
    expect(clock.now()).toBeCloseTo(1, 6);

    const slow = new VirtualClock({ yieldCostMs: 0.5 });
    await slow.yield();
    await slow.yield();
    expect(slow.now()).toBe(1);
  });

  it('ignores negative or NaN sleeps and an already-aborted sleep', async () => {
    const clock = new VirtualClock();
    await clock.sleep(-10);
    await clock.sleep(Number.NaN);
    expect(clock.now()).toBe(0);
    const controller = new AbortController();
    controller.abort();
    await clock.sleep(500, controller.signal);
    expect(clock.now()).toBe(0);
  });

  it('can be advanced directly and reset', async () => {
    const clock = new VirtualClock();
    clock.advance(42);
    expect(clock.now()).toBe(42);
    clock.reset();
    expect(clock.now()).toBe(0);
  });

  it('reports that yielding is instant, unlike a real clock', () => {
    expect(yieldsInstantly(new VirtualClock())).toBe(true);
    expect(yieldsInstantly(new RealClock())).toBe(false);
  });
});

describe('RealClock', () => {
  it('follows the wall clock and resets its epoch', async () => {
    const clock = new RealClock();
    const before = clock.now();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(clock.now() - before).toBeGreaterThanOrEqual(10);
    expect(clock.micros()).toBeGreaterThan(before * 1000);
    clock.reset();
    expect(clock.now()).toBeLessThan(5);
  });

  it('sleeps for about the requested time', async () => {
    const clock = new RealClock();
    const start = clock.now();
    await clock.sleep(30);
    expect(clock.now() - start).toBeGreaterThanOrEqual(25);
  });

  it('busy-waits sub-millisecond sleeps without a timer', async () => {
    const clock = new RealClock();
    const start = clock.now();
    await clock.sleep(0.2);
    const elapsed = clock.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(0.15);
    expect(elapsed).toBeLessThan(5);
  });

  it('resolves a long sleep early when its signal aborts', async () => {
    const clock = new RealClock();
    const controller = new AbortController();
    const start = clock.now();
    const sleeping = clock.sleep(5000, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await sleeping;
    expect(clock.now() - start).toBeLessThan(200);
  });

  it('resolves at once when the signal was already aborted', async () => {
    const clock = new RealClock();
    const controller = new AbortController();
    controller.abort();
    const start = clock.now();
    await clock.sleep(5000, controller.signal);
    expect(clock.now() - start).toBeLessThan(50);
  });

  it('yields as a macrotask so pending microtasks run first', async () => {
    const clock = new RealClock();
    let microtaskRan = false;
    void Promise.resolve().then(() => {
      microtaskRan = true;
    });
    await clock.yield();
    expect(microtaskRan).toBe(true);
  });
});
