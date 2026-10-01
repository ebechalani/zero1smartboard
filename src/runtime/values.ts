/**
 * Boxed values exchanged between generated code and the runtime.
 *
 * JavaScript has one number type, so the transpiler wraps values whose C++
 * static type matters for *printing* right at the call boundary:
 *   - `float`/`double` expressions passed to print-like functions -> FloatBox
 *   - `char` expressions passed to runtime functions -> a 1-character string
 * Everything else is a plain JS number / string / boolean / array.
 */
import { printFloat } from './avr-float';

export class FloatBox {
  constructor(public readonly value: number) {}
  valueOf(): number {
    return this.value;
  }
  toString(): string {
    return formatFloat(this.value, 2);
  }
}

/**
 * Arduino `Print::printFloat` semantics, in single precision like the UNO:
 * halves round up, "nan", "inf" (for both signs), "ovf" beyond ±4294967040.
 */
export function formatFloat(v: number, digits = 2): string {
  return printFloat(v, digits);
}

/** Wrap a float-typed value for printing. */
export function __flt(v: unknown): FloatBox | unknown {
  if (v instanceof FloatBox) return v;
  if (typeof v === 'number') return new FloatBox(v);
  if (typeof v === 'boolean') return new FloatBox(v ? 1 : 0);
  return v;
}

/** Convert a char-typed value (number code) to a 1-character string. */
export function __chr(v: unknown): string | unknown {
  if (typeof v === 'number') return String.fromCharCode(v & 0xff);
  if (typeof v === 'boolean') return String.fromCharCode(v ? 1 : 0);
  return v;
}

/** Thrown (and swallowed by the executor) when the user stops the sketch. */
export class StopSignal extends Error {
  constructor() {
    super('sketch stopped');
    this.name = 'StopSignal';
  }
}

/** Thrown for runtime faults the sketch author should see (division by zero, unknown identifier...). */
export class SketchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SketchError';
  }
}

/** Text of the console error reported when the sketch calls `abort()` (docs/PYTHON.md §6 item 3). */
export const ABORT_MESSAGE = 'The sketch stopped: abort() was called.';

/**
 * Thrown by `abort()`. On the board avr-libc's `abort()` disables the interrupts and
 * loops forever; the simulator stops the run with an error on the line of the call.
 */
export class SketchAbort extends SketchError {
  constructor() {
    super(ABORT_MESSAGE);
    this.name = 'SketchAbort';
  }
}
