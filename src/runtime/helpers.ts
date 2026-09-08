/**
 * Numeric helpers used by the generated code (docs/ARCHITECTURE.md §5.3).
 *
 * C++ integers have fixed widths; JavaScript has one number type. The
 * transpiler wraps every store into a typed variable with one of these helpers
 * so that `int` really wraps at 16 bits, `byte` at 8 bits, and so on.
 */
import { FloatBox, SketchError } from './values';

/**
 * Coerce any value the sketch may produce into a JS number: `FloatBox` → its
 * value, booleans → 0/1, numeric strings → their value, other 1-character
 * strings (a `char` boxed by `__chr`) → the character code, anything else → 0.
 */
export function toNumber(x: unknown): number {
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (x instanceof FloatBox) return x.value;
  if (typeof x === 'string') {
    const n = Number(x);
    if (!Number.isNaN(n)) return n;
    return x.length === 1 ? x.charCodeAt(0) : 0;
  }
  return 0;
}

/** Wrap to a signed 8-bit `char`. */
export function __i8(x: unknown): number {
  return (toNumber(x) << 24) >> 24;
}

/** Wrap to an unsigned 8-bit `byte` / `unsigned char`. */
export function __u8(x: unknown): number {
  return toNumber(x) & 0xff;
}

/** Wrap to a signed 16-bit `int` / `short`. */
export function __i16(x: unknown): number {
  return (toNumber(x) << 16) >> 16;
}

/** Wrap to an unsigned 16-bit `unsigned int` / `word`. */
export function __u16(x: unknown): number {
  return toNumber(x) & 0xffff;
}

/** Wrap to a signed 32-bit `long`. */
export function __i32(x: unknown): number {
  return toNumber(x) | 0;
}

/** Wrap to an unsigned 32-bit `unsigned long`. */
export function __u32(x: unknown): number {
  return toNumber(x) >>> 0;
}

/** Round to single precision like an AVR `float` / `double` (both are 32-bit on the UNO). */
export function __f32(x: unknown): number {
  return Math.fround(toNumber(x));
}

/** Convert to a C++ `bool`: numbers are true when non-zero, strings (pointers) are always true. */
export function __bool(x: unknown): boolean {
  if (typeof x === 'boolean') return x;
  if (typeof x === 'string') return true;
  if (x === null || x === undefined) return false;
  if (typeof x === 'object' && !(x instanceof FloatBox)) return true;
  return toNumber(x) !== 0;
}

/** Integer division (truncating toward zero). Throws `division by zero` like a crash on the real board would. */
export function __idiv(a: unknown, b: unknown): number {
  const divisor = toNumber(b);
  if (divisor === 0) throw new SketchError('division by zero');
  return Math.trunc(toNumber(a) / divisor);
}

/** Integer remainder with the sign of the dividend (C semantics). Throws `division by zero`. */
export function __imod(a: unknown, b: unknown): number {
  const divisor = toNumber(b);
  if (divisor === 0) throw new SketchError('division by zero');
  return toNumber(a) % divisor;
}

/**
 * Build a (possibly nested) array: `__array([5], 0)` is `int a[5]`,
 * `__array([2, 3], "")` is `String s[2][3]`. Every element holds `fill`.
 */
export function __array(dims: number[], fill: unknown): unknown[] {
  const build = (depth: number): unknown[] => {
    const length = Math.max(0, Math.trunc(toNumber(dims[depth])));
    const isLast = depth === dims.length - 1;
    return Array.from({ length }, () => (isLast ? fill : build(depth + 1)));
  };
  return dims.length === 0 ? [] : build(0);
}

/**
 * Read a C string: a `char[]` (array of character codes) up to its first 0,
 * or a JS string as is. Negative codes are the signed-char view of bytes 128..255.
 */
export function __cstr(x: unknown): string {
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) {
    let out = '';
    for (const item of x) {
      const code = Math.trunc(toNumber(item));
      if (code === 0) break;
      out += String.fromCharCode(code & 0xff);
    }
    return out;
  }
  if (x === null || x === undefined) return '';
  return String(x);
}

/** Every helper keyed by the name the generated code destructures from `__rt`. */
export const HELPERS = {
  __i8,
  __u8,
  __i16,
  __u16,
  __i32,
  __u32,
  __f32,
  __bool,
  __idiv,
  __imod,
  __array,
  __cstr,
} as const;
