/**
 * Print formatting shared by Serial and the LCD (Arduino `Print` semantics,
 * docs/ARCHITECTURE.md §6.1), plus the small helpers every library emulation
 * in this folder relies on: the per-run `LibContext`, argument coercion and
 * C-string reads/writes on char-code arrays.
 */
import type { RuntimeContext } from '../../types';
import { FloatBox, formatFloat } from '../values';

/**
 * Services handed to every library emulation for one sketch run: the runtime
 * context plus a console channel that reports each distinct warning only once.
 */
export interface LibContext {
  readonly ctx: RuntimeContext;
  /** Emit `text` as a console warning, unless the same text was already emitted during this run. */
  warnOnce(text: string): void;
}

/** Build the per-run `LibContext` used by `createLibs`. */
export function createLibContext(ctx: RuntimeContext): LibContext {
  const seen = new Set<string>();
  return {
    ctx,
    warnOnce(text: string): void {
      if (seen.has(text)) return;
      seen.add(text);
      ctx.console({ level: 'warn', text });
    },
  };
}

/**
 * Coerce any value the sketch may hand to a numeric parameter into a JS number:
 * FloatBox → its value, booleans → 0/1, a 1-character string (a `char` wrapped
 * by `__chr`) → its character code, other strings → `Number(s)` or 0,
 * `null`/`undefined`/objects → 0.
 */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v instanceof FloatBox) return v.value;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    if (v.length === 1) return v.charCodeAt(0);
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** An integer parameter as a C cast would see it (truncated toward zero; NaN → 0). */
export function intArg(v: unknown): number {
  return Math.trunc(toNumber(v)) || 0;
}

/**
 * A `char` parameter as its code 0..255: a string gives its first character's
 * code (empty → 0), a number is taken as the code itself.
 */
export function charCodeOf(v: unknown): number {
  if (typeof v === 'string') return v.length > 0 ? v.charCodeAt(0) & 0xff : 0;
  return intArg(v) & 0xff;
}

/**
 * Convert a C string to a JS string: char-code arrays are read up to the first
 * 0 (negative codes are the signed `char` view of bytes 128..255); strings pass
 * through; anything else is printed like `Print` would.
 */
export function cstr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    let out = '';
    for (const item of v) {
      const code = Math.trunc(toNumber(item));
      if (code === 0) break;
      out += String.fromCharCode(code < 0 ? code & 0xff : code);
    }
    return out;
  }
  return formatPrintArg(v);
}

/**
 * Write `text` into a `char[]` (an array of character codes) starting at
 * `offset`, followed by a terminating 0, the way `strcpy` does. Writes stop at
 * the end of the array instead of overflowing it. Does nothing when `buffer`
 * is not an array (a `char*` variable holds a JS string, which cannot be
 * mutated). Returns the number of characters stored (without the 0).
 */
export function storeCString(buffer: unknown, text: string, offset = 0): number {
  if (!Array.isArray(buffer)) return 0;
  let i = 0;
  for (; i < text.length && offset + i < buffer.length; i++) buffer[offset + i] = text.charCodeAt(i) & 0xff;
  if (offset + i < buffer.length) buffer[offset + i] = 0;
  return i;
}

/**
 * Format one `print()` argument the way Arduino's `Print` class does.
 * `fmt` is the optional second argument of `print`: the number of decimals for
 * floats, or the base (`DEC`, `HEX`, `BIN`, `OCT`) for integers; base 0 writes
 * the raw byte (like `write`). Integers in a base other than 10 are shown as
 * unsigned 32-bit values, so `print(-1, HEX)` gives `FFFFFFFF` like the UNO.
 */
export function formatPrintArg(value: unknown, fmt?: number): string {
  if (value instanceof FloatBox) return formatFloat(value.value, decimalsOf(fmt));
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return formatFloat(value, decimalsOf(fmt));
    return formatInteger(value, fmt);
  }
  if (typeof value === 'string') {
    // A 1-char string is a `char`; `print('A', DEC)` prints its code like the UNO does.
    if (fmt !== undefined && value.length === 1) return formatInteger(value.charCodeAt(0), fmt);
    return value;
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (Array.isArray(value)) return cstr(value);
  if (value === null || value === undefined) return '';
  return String(value);
}

function decimalsOf(fmt: number | undefined): number {
  return fmt === undefined ? 2 : Math.trunc(toNumber(fmt));
}

function formatInteger(n: number, fmt: number | undefined): string {
  const base = fmt === undefined ? 10 : Math.trunc(toNumber(fmt));
  if (base === 0) return String.fromCharCode(n & 0xff);
  if (base === 10) return String(n);
  const radix = base < 2 ? 10 : Math.min(base, 36);
  return (n >>> 0).toString(radix).toUpperCase();
}
