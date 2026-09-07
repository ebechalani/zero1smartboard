/**
 * Boxed values exchanged between generated code and the runtime.
 *
 * JavaScript has one number type, so the transpiler wraps values whose C++
 * static type matters for *printing* right at the call boundary:
 *   - `float`/`double` expressions passed to print-like functions -> FloatBox
 *   - `char` expressions passed to runtime functions -> a 1-character string
 * Everything else is a plain JS number / string / boolean / array.
 */

export class FloatBox {
  constructor(public readonly value: number) {}
  valueOf(): number {
    return this.value;
  }
  toString(): string {
    return formatFloat(this.value, 2);
  }
}

/** Arduino Print::printFloat semantics (round half up, "nan"/"inf"/"ovf"). */
export function formatFloat(v: number, digits = 2): string {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  if (v > 4294967040 || v < -4294967040) return 'ovf';
  digits = Math.max(0, Math.floor(digits));
  let s = '';
  if (v < 0) {
    s = '-';
    v = -v;
  }
  let rounding = 0.5;
  for (let i = 0; i < digits; i++) rounding /= 10;
  v += rounding;
  const intPart = Math.floor(v);
  let rem = v - intPart;
  s += String(intPart);
  if (digits > 0) {
    s += '.';
    for (let i = 0; i < digits; i++) {
      rem *= 10;
      const d = Math.floor(rem);
      s += String(d);
      rem -= d;
    }
  }
  return s;
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
