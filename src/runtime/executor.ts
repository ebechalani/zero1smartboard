/**
 * Runs a transpiled sketch against a board (docs/ARCHITECTURE.md §5.6):
 * builds the runtime, calls `setup()` once and `loop()` forever, yields to
 * the host regularly so the page stays responsive, and turns errors into
 * console messages with the source line they came from.
 */
import type { ConsoleMessage, ExecutorOptions, ExecutorStatus, IExecutor, RuntimeContext, SketchModule } from '../types';
import { yieldsInstantly } from './clock';
import { createRuntime } from './index';
import { SketchError, StopSignal } from './values';

/** Cooperative ticks between two yields to the event loop (real clock). */
const TICKS_PER_YIELD = 512;
/** Longest stretch of clock time the sketch may run without yielding (real clock). */
const MAX_MS_WITHOUT_YIELD = 8;
/** `new Function('__rt', body)` puts the body on line 3 of the anonymous function source in V8 and SpiderMonkey. */
const FUNCTION_HEADER_LINES = 2;
/** Stack-frame locations of code created with `new Function`: V8 `<anonymous>:L:C`, Firefox `> Function:L:C`. */
const GENERATED_FRAME = /(?:<anonymous>|Function):(\d+):(\d+)/g;

type SketchFactory = (rt: Record<string, unknown>) => Promise<Partial<SketchModule> | null | undefined>;

/**
 * Executes one sketch at a time. `run()` resolves when the sketch stops —
 * through `stop()`, `maxLoops`, `stopAfterMs` or an error — and never rejects.
 */
export class Executor implements IExecutor {
  private currentStatus: ExecutorStatus = 'idle';
  private loopCount = 0;
  private controller: AbortController | null = null;
  private stopRequested = false;
  private running: Promise<void> | null = null;

  constructor(private readonly options: ExecutorOptions) {}

  get status(): ExecutorStatus {
    return this.currentStatus;
  }

  get loops(): number {
    return this.loopCount;
  }

  async run(js: string): Promise<void> {
    if (this.running) await this.stop();
    const execution = this.execute(js);
    this.running = execution;
    try {
      await execution;
    } finally {
      if (this.running === execution) this.running = null;
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.controller?.abort();
    await this.running;
  }

  private async execute(js: string): Promise<void> {
    const { board, maxLoops, stopAfterMs, lineMap } = this.options;
    const clock = board.clock;
    const controller = new AbortController();
    this.controller = controller;
    this.stopRequested = false;
    this.loopCount = 0;
    this.currentStatus = 'running';

    const yieldEvery = yieldsInstantly(clock) ? 1 : TICKS_PER_YIELD;
    let ticksSinceYield = 0;
    let lastYieldAt = clock.now();

    const throwIfStopped = (): void => {
      if (this.stopRequested || controller.signal.aborted) throw new StopSignal();
    };
    const tick = async (): Promise<void> => {
      throwIfStopped();
      if (stopAfterMs !== undefined && clock.now() >= stopAfterMs) throw new StopSignal();
      if (maxLoops !== undefined && this.loopCount >= maxLoops) throw new StopSignal();
      ticksSinceYield++;
      if (ticksSinceYield >= yieldEvery || clock.now() - lastYieldAt > MAX_MS_WITHOUT_YIELD) {
        ticksSinceYield = 0;
        await clock.yield();
        lastYieldAt = clock.now();
        throwIfStopped();
      }
    };
    const ctx: RuntimeContext = {
      board,
      clock,
      console: (msg) => this.options.onConsole?.(msg),
      signal: controller.signal,
      throwIfStopped,
      tick,
      deadline: stopAfterMs ?? null,
    };

    try {
      const rt = createRuntime(ctx);
      const factory = new Function('__rt', js) as SketchFactory;
      const mod = await factory(rt);
      if (!mod || typeof mod.setup !== 'function' || typeof mod.loop !== 'function') {
        throw new SketchError('sketch must define void setup() and void loop()');
      }
      await mod.setup();
      for (;;) {
        await mod.loop();
        this.loopCount++;
        if (typeof mod.serialEvent === 'function' && board.serial.available() > 0) await mod.serialEvent();
        await tick();
      }
    } catch (err) {
      if (err instanceof StopSignal) {
        this.currentStatus = 'stopped';
      } else {
        this.currentStatus = 'error';
        this.options.onConsole?.(describeError(err, lineMap));
      }
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}

/** Turn a thrown value into the console message the student sees, with the sketch line when it can be recovered. */
function describeError(err: unknown, lineMap: number[] | undefined): ConsoleMessage {
  const message: ConsoleMessage = { level: 'error', text: errorText(err) };
  const line = err instanceof Error ? sourceLineOf(err.stack, lineMap) : undefined;
  if (line !== undefined) message.line = line;
  return message;
}

function errorText(err: unknown): string {
  if (err instanceof SketchError) return err.message;
  if (err instanceof Error) return `runtime error: ${err.message}`;
  return `runtime error: ${String(err)}`;
}

/**
 * Find the innermost stack frame that lies in the generated code and map its
 * line back to the sketch. Frames on synthetic lines (mapped to 0) are skipped.
 */
function sourceLineOf(stack: string | undefined, lineMap: number[] | undefined): number | undefined {
  if (!stack || !lineMap) return undefined;
  for (const match of stack.matchAll(GENERATED_FRAME)) {
    const generatedLine = Number(match[1]) - FUNCTION_HEADER_LINES;
    const sourceLine = lineMap[generatedLine - 1];
    if (sourceLine !== undefined && sourceLine > 0) return sourceLine;
  }
  return undefined;
}
