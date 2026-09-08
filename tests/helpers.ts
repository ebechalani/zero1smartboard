/**
 * Shared test helpers (docs/ARCHITECTURE.md §10): a ZERO1 board on a virtual
 * clock, and a one-call "transpile + run" for whole sketches.
 */
import { VirtualClock } from '../src/runtime/clock';
import { Executor } from '../src/runtime/executor';
import { transpile } from '../src/transpiler';
import type { BoardConfig, ConsoleMessage, ExecutorStatus } from '../src/types';
import { createZero1Board, type Zero1Board } from '../src/zero1';

/**
 * Virtual cost of one cooperative tick. A loop() iteration on a 16 MHz AVR
 * takes a few tens of microseconds, so sketches that never call delay()
 * still make time pass at a realistic rate.
 */
export const TICK_COST_MS = 0.02;

export function makeBoard(config?: Partial<BoardConfig>): { board: Zero1Board; clock: VirtualClock } {
  const clock = new VirtualClock({ yieldCostMs: TICK_COST_MS });
  const board = createZero1Board(clock, config);
  return { board, clock };
}

export interface RunOptions {
  /** Stop once the virtual clock reaches this many ms (default 2000). */
  stopAfterMs?: number;
  /** Stop after this many loop() iterations (default 10000). */
  maxLoops?: number;
  config?: Partial<BoardConfig>;
  /** Prepare inputs before the sketch starts (press a button, set the pot...). */
  before?: (board: Zero1Board, clock: VirtualClock) => void;
}

export interface RunResult {
  board: Zero1Board;
  clock: VirtualClock;
  console: ConsoleMessage[];
  /** Everything the sketch printed to the serial monitor. */
  serial: string;
  status: ExecutorStatus;
  js: string;
  loops: number;
}

/** Transpile and run a sketch on a virtual clock until it stops. Throws if the sketch does not transpile. */
export async function runSketch(source: string, opts: RunOptions = {}): Promise<RunResult> {
  const result = transpile(source);
  if (!result.ok) {
    throw new Error(`transpile failed: ${result.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join('; ')}`);
  }
  const { board, clock } = makeBoard(opts.config);
  const messages: ConsoleMessage[] = [];
  let serial = '';
  board.serial.onTx((text) => {
    serial += text;
  });
  opts.before?.(board, clock);
  const executor = new Executor({
    board,
    onConsole: (m) => messages.push(m),
    maxLoops: opts.maxLoops ?? 400000,
    stopAfterMs: opts.stopAfterMs ?? 2000,
    lineMap: result.lineMap,
  });
  await executor.run(result.js);
  return { board, clock, console: messages, serial, status: executor.status, js: result.js, loops: executor.loops };
}

/** Let pending promises/microtasks and timers run (for tests that drive a running sketch by hand). */
export async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
}
