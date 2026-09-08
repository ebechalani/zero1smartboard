import { describe, expect, it } from 'vitest';
import { Board } from '../src/runtime/board';
import { RealClock, VirtualClock } from '../src/runtime/clock';
import { Executor } from '../src/runtime/executor';
import type { ConsoleMessage } from '../src/types';

/** Hand-written module body in the shape produced by the code generator (docs/ARCHITECTURE.md §4.4). */
function body(setup: string, loop: string, extra = ''): string {
  return `"use strict";
const { __i16, __tick, __idiv } = __rt;
return (async () => {
  ${extra}
  async function setup() { await __tick(); ${setup} }
  async function loop() { await __tick(); ${loop} }
  return { setup, loop, serialEvent: typeof serialEvent === 'function' ? serialEvent : undefined };
})();`;
}

function make(js: string, opts: { maxLoops?: number; stopAfterMs?: number; lineMap?: number[]; real?: boolean } = {}) {
  const clock = opts.real ? new RealClock() : new VirtualClock();
  const board = new Board(clock);
  const messages: ConsoleMessage[] = [];
  const executor = new Executor({ board, onConsole: (m) => messages.push(m), maxLoops: opts.maxLoops, stopAfterMs: opts.stopAfterMs, lineMap: opts.lineMap });
  return { clock, board, messages, executor, run: () => executor.run(js) };
}

describe('Executor', () => {
  it('runs setup once and loop until maxLoops, then reports stopped', async () => {
    const js = body('await __rt.pinMode(13, 1); await __rt.digitalWrite(13, 1);', 'await __rt.digitalWrite(13, 0); await __rt.delay(10);');
    const { executor, board, run, clock } = make(js, { maxLoops: 5 });
    await run();
    expect(executor.status).toBe('stopped');
    expect(executor.loops).toBe(5);
    expect(board.pins[13]!.mode).toBe('OUTPUT');
    expect(clock.now()).toBeGreaterThanOrEqual(50);
  });

  it('stops when the virtual clock passes stopAfterMs', async () => {
    const js = body('', 'await __rt.delay(100);');
    const { executor, run, clock } = make(js, { stopAfterMs: 1000 });
    await run();
    expect(executor.status).toBe('stopped');
    expect(clock.now()).toBeGreaterThanOrEqual(1000);
    expect(executor.loops).toBeLessThanOrEqual(11);
  });

  it('a busy loop without delay still advances virtual time and stops', async () => {
    const js = body('', 'let i = 0; while (i < 10) { await __tick(); i++; }');
    const { executor, run } = make(js, { stopAfterMs: 50 });
    await run();
    expect(executor.status).toBe('stopped');
  });

  it('reports sketch errors with the mapped source line', async () => {
    const lines = body('', 'let x = __idiv(5, z);', 'let z = 0;').split('\n');
    const lineMap = lines.map((_, i) => 100 + i);
    const { executor, run, messages } = make(lines.join('\n'), { lineMap });
    await run();
    expect(executor.status).toBe('error');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.level).toBe('error');
    expect(messages[0]!.text).toMatch(/division by zero/);
    const errorLine = lines.findIndex((l) => l.includes('__idiv(5, z)'));
    expect(messages[0]!.line).toBe(100 + errorLine);
  });

  it('reports unknown runtime names like the Arduino compiler', async () => {
    const js = body('await __rt.digitalWrit(13, 1);', '');
    const { executor, run, messages } = make(js);
    await run();
    expect(executor.status).toBe('error');
    expect(messages[0]!.text).toContain("'digitalWrit' was not declared in this scope");
  });

  it('stop() interrupts a long delay on a real clock promptly', async () => {
    const js = body('', 'await __rt.delay(10000);');
    const { executor, run } = make(js, { real: true });
    const running = run();
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    await executor.stop();
    expect(Date.now() - t0).toBeLessThan(200);
    await running;
    expect(executor.status).toBe('stopped');
  });

  it('calls serialEvent after loop when serial data is waiting', async () => {
    const js = body('await __rt.pinMode(13, 1);', 'await __rt.delay(1);', 'async function serialEvent() { await __rt.digitalWrite(13, 1); }');
    const { executor, board, run } = make(js, { maxLoops: 3 });
    await run();
    expect(board.pins[13]!.level).toBe(0);
    board.serial.inject('a');
    await run();
    expect(executor.status).toBe('stopped');
    expect(board.pins[13]!.level).toBe(1);
  });

  it('resets state between runs and a second run() stops the first', async () => {
    const js = body('', 'await __rt.delay(5);');
    const { executor } = make(js, { maxLoops: 2 });
    await executor.run(js);
    expect(executor.loops).toBe(2);
    await executor.run(js);
    expect(executor.loops).toBe(2);
    expect(executor.status).toBe('stopped');
  });
});
