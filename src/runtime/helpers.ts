/**
 * Numeric helpers used by the generated code (docs/ARCHITECTURE.md §5.3).
 *
 * C++ integers have fixed widths; JavaScript has one number type. The
 * transpiler wraps every integer operation and every store into a typed
 * variable with one of these helpers so that `int` really wraps at 16 bits,
 * `byte` at 8 bits, and so on, and rounds every float to single precision.
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

/**
 * Integer division (truncating toward zero). Throws `division by zero` like a crash on the real board would.
 * `+ 0` turns JavaScript's -0 (-1 / 2) into the integer 0, so that a later `1.0 / x` is inf, not -inf.
 */
export function __idiv(a: unknown, b: unknown): number {
  const divisor = toNumber(b);
  if (divisor === 0) throw new SketchError('division by zero');
  return Math.trunc(toNumber(a) / divisor) + 0;
}

/** Integer remainder with the sign of the dividend (C semantics; -4 % 2 is 0, not -0). Throws `division by zero`. */
export function __imod(a: unknown, b: unknown): number {
  const divisor = toNumber(b);
  if (divisor === 0) throw new SketchError('division by zero');
  return (toNumber(a) % divisor) + 0;
}

/**
 * A float converted to a signed integer like avr-gcc's `__fixsfsi` (the transpiler then
 * wraps the result to `char`, `int` or `long`): truncated toward zero, and
 * -2147483648 when the value is NaN, infinite or outside the `long` range.
 */
export function __ftoi(x: unknown): number {
  const v = toNumber(x);
  if (!(v > -2147483649 && v < 2147483648)) return -2147483648;
  return Math.trunc(v) | 0;
}

/**
 * A float converted to `unsigned int` / `unsigned long` like avr-gcc's `__fixunssfsi`:
 * truncated toward zero and taken modulo 2^32 (-1.5 → 4294967295), and 0 when the
 * value is NaN, infinite or at least 2^32 away from 0.
 */
export function __ftou(x: unknown): number {
  const v = toNumber(x);
  if (!(v > -4294967296 && v < 4294967296)) return 0;
  return Math.trunc(v) >>> 0;
}

/**
 * 32-bit `long` multiplication: the low 32 bits of the product, as a signed value
 * (`50000L * 50000L` → -1794967296 like the AVR). A plain JS product loses those
 * bits once it passes 2^53; the generated code wraps it with `__u32` for `unsigned long`.
 */
export function __imul(a: unknown, b: unknown): number {
  return Math.imul(toNumber(a), toNumber(b));
}

/**
 * The steps of an AVR shift whose count is known only while running: avr-gcc loops on the count's
 * low byte with `dec` + `brpl`, so a count of 1..128 shifts that many times and any other one
 * (0, 129..255: a negative count, 256, …) not at all.
 */
function shiftSteps(n: unknown): number {
  const c = toNumber(n) & 255;
  return c >= 1 && c <= 128 ? c : 0;
}

/** `a << n` on the board in a `bits`-wide type (16 or 32), for a count known only while running: 32 or more steps give 0. The caller wraps the result to the type. */
export function __shl(a: unknown, n: unknown, bits: unknown): number {
  const k = shiftSteps(n);
  return k >= toNumber(bits) ? 0 : toNumber(a) * 2 ** k;
}

/**
 * `a >> n` on the board in a `bits`-wide type, for a count known only while running: arithmetic
 * for a signed type (`a` negative ends at -1), logical for an unsigned one (`a` is then its
 * unsigned value).
 */
export function __shr(a: unknown, n: unknown, bits: unknown, signed: unknown): number {
  const k = shiftSteps(n);
  const v = toNumber(a);
  if (k >= toNumber(bits)) return signed && v < 0 ? -1 : 0;
  return Math.floor(v / 2 ** k);
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
  __imul,
  __shl,
  __shr,
  __ftoi,
  __ftou,
  __array,
  __cstr,
} as const;
