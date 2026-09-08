import { describe, expect, it } from 'vitest';
import { Board } from '../src/runtime/board';
import { VirtualClock } from '../src/runtime/clock';
import { createCoreApi } from '../src/runtime/core';
import type { BoardEvent, ConsoleMessage, RuntimeContext } from '../src/types';

type Api = Record<string, (...args: unknown[]) => unknown>;

function make(): { api: Api; board: Board; clock: VirtualClock; events: BoardEvent[]; messages: ConsoleMessage[] } {
  const clock = new VirtualClock();
  const board = new Board(clock);
  const events: BoardEvent[] = [];
  const messages: ConsoleMessage[] = [];
  board.on((e) => events.push(e));
  const ctx: RuntimeContext = {
    board,
    clock,
    console: (m) => messages.push(m),
    signal: new AbortController().signal,
    throwIfStopped: () => {},
    tick: async () => {},
    deadline: null,
  };
  return { api: createCoreApi(ctx) as Api, board, clock, events, messages };
}

describe('core API', () => {
  it('map() uses integer arithmetic like the AVR', () => {
    const { api } = make();
    expect(api.map!(512, 0, 1023, 0, 255)).toBe(127);
    expect(api.map!(1023, 0, 1023, 0, 255)).toBe(255);
    expect(api.map!(0, 0, 1023, 255, 0)).toBe(255);
    expect(api.map!(50, 0, 100, -100, 100)).toBe(0);
    expect(api.map!(-5, -10, 0, 0, 10)).toBe(5);
  });

  it('constrain, min, max, abs, sq, round', () => {
    const { api } = make();
    expect(api.constrain!(300, 0, 255)).toBe(255);
    expect(api.constrain!(-3, 0, 255)).toBe(0);
    expect(api.min!(3, 9)).toBe(3);
    expect(api.max!(3, 9)).toBe(9);
    expect(api.abs!(-4)).toBe(4);
    expect(api.sq!(7)).toBe(49);
    expect(api.round!(2.5)).toBe(3);
    expect(api.round!(-2.5)).toBe(-3);
  });

  it('random is deterministic after randomSeed and respects the bounds', () => {
    const { api } = make();
    api.randomSeed!(42);
    const a = Array.from({ length: 20 }, () => api.random!(10, 20) as number);
    api.randomSeed!(42);
    const b = Array.from({ length: 20 }, () => api.random!(10, 20) as number);
    expect(a).toEqual(b);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(api.random!(1)).toBe(0);
  });

  it('shiftOut emits 24 digitalWrite events in the right order', async () => {
    const { api, events } = make();
    api.pinMode!(12, 1);
    api.pinMode!(10, 1);
    events.length = 0;
    await api.shiftOut!(12, 10, 1, 0b10110000); // MSBFIRST
    const writes = events.filter((e) => e.type === 'digitalWrite') as Extract<BoardEvent, { type: 'digitalWrite' }>[];
    expect(writes).toHaveLength(24);
    const dataBits = writes.filter((e) => e.pin === 12).map((e) => e.level);
    expect(dataBits).toEqual([1, 0, 1, 1, 0, 0, 0, 0]);
    expect(writes.slice(0, 3).map((e) => `${e.pin}:${e.level}`)).toEqual(['12:1', '10:1', '10:0']);
    events.length = 0;
    await api.shiftOut!(12, 10, 0, 0b10110000); // LSBFIRST
    const lsb = (events.filter((e) => e.type === 'digitalWrite' && e.pin === 12) as Extract<BoardEvent, { type: 'digitalWrite' }>[]).map((e) => e.level);
    expect(lsb).toEqual([0, 0, 0, 0, 1, 1, 0, 1]);
  });

  it('delay advances the virtual clock and millis/micros follow', async () => {
    const { api, clock } = make();
    expect(api.millis!()).toBe(0);
    await api.delay!(250);
    expect(clock.now()).toBe(250);
    expect(api.millis!()).toBe(250);
    await api.delayMicroseconds!(1500);
    expect(api.micros!()).toBe(251500);
  });

  it('tone with a duration ends by itself and only one tone plays at a time', async () => {
    const { api, board, clock } = make();
    api.tone!(8, 440, 100);
    expect(board.pins[8]!.tone).toBe(440);
    api.tone!(9, 880);
    expect(board.pins[9]!.tone).toBeNull();
    await clock.sleep(150);
    await new Promise((r) => setImmediate(r));
    expect(board.pins[8]!.tone).toBeNull();
    api.tone!(8, 262);
    expect(board.pins[8]!.tone).toBe(262);
    api.noTone!(8);
    expect(board.pins[8]!.tone).toBeNull();
  });

  it('warns once when digitalWrite is used without pinMode', () => {
    const { api, messages } = make();
    api.digitalWrite!(15, 1);
    api.digitalWrite!(15, 0);
    expect(messages.filter((m) => /pinMode\(A1, OUTPUT\)/.test(m.text))).toHaveLength(1);
    api.pinMode!(16, 1);
    api.digitalWrite!(16, 1);
    expect(messages).toHaveLength(1);
  });

  it('rejects pins that do not exist on the UNO', () => {
    const { api } = make();
    expect(() => api.pinMode!(20, 1)).toThrow(/does not exist/);
  });

  it('bit helpers and char classification', () => {
    const { api } = make();
    expect(api.bit!(3)).toBe(8);
    expect(api.bitRead!(0b1010, 1)).toBe(1);
    expect(api.lowByte!(0x1234)).toBe(0x34);
    expect(api.highByte!(0x1234)).toBe(0x12);
    expect(api.word!(0x12, 0x34)).toBe(0x1234);
    expect(api.isDigit!('7')).toBe(true);
    expect(api.isDigit!(55)).toBe(true);
    expect(api.isAlpha!('a')).toBe(true);
    expect(api.toUpperCase!('a')).toBe('A'.charCodeAt(0));
  });

  it('exposes the Arduino constants', () => {
    const { api } = make();
    expect(api.HIGH).toBe(1);
    expect(api.A3).toBe(17);
    expect(api.LED_BUILTIN).toBe(13);
    expect(api.INPUT_PULLUP).toBe(2);
    expect(api.PI).toBeCloseTo(Math.PI);
  });
});
