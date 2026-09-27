/**
 * Arduino `String` and the C string functions (docs/ARCHITECTURE.md §6.3).
 *
 * `String` values are plain JS strings, so the transpiler routes every
 * `String` method through `__m` (read-only methods) and `__mut` (methods that
 * modify the string in place in C++, which here return the new value that the
 * generated code stores back). `char[]` arrays are JS arrays of character
 * codes with a trailing 0; the C functions read and write those in place.
 */
import { SketchError, FloatBox, formatFloat } from '../values';
import type { LibContext } from './print';
import { charCodeOf, cstr, formatPrintArg, intArg, storeCString, toNumber } from './print';

/** Static type of an operand of `+` with a `String`, as the transpiler saw it. */
export type ConcatKind = 'int' | 'float' | 'char' | 'bool' | 'string' | 'unknown';

const SPRINTF_FLOAT_WARNING = 'sprintf does not support %f on Arduino UNO; use dtostrf()';
const SPRINTF_INT_WARNING = 'sprintf: %d prints a 16-bit int on the UNO, so this value came out wrong; use %ld for long values';

/**
 * Member names `__m` / `__mut` never look up (docs/CLASSROOM.md §3.4, X1): through them a
 * sketch could reach `Function` and run arbitrary JavaScript. The transpiler refuses the same
 * names at compile time (src/transpiler/codegen.ts FORBIDDEN_MEMBER_NAMES); this is the
 * defence in depth for anything that slips through.
 */
export const FORBIDDEN_MEMBER_NAMES: readonly string[] = ['constructor', 'prototype', '__proto__', 'caller', 'callee', 'arguments', 'call', 'apply', 'bind'];

function forbidden(name: string): boolean {
  return name.startsWith('__') || FORBIDDEN_MEMBER_NAMES.includes(name);
}

/** A function that every object inherits (`toString`, `call`, …): never a runtime API. */
function inheritedFromBuiltins(member: unknown, name: string): boolean {
  return (
    typeof member === 'function' &&
    (member === (Object.prototype as unknown as Record<string, unknown>)[name] || member === (Function.prototype as unknown as Record<string, unknown>)[name])
  );
}

/** Characters `String::trim()` and `atoi()` treat as whitespace (C `isspace`). */
const WHITESPACE = new Set([32, 9, 10, 11, 12, 13]);

/** Build every string-related name of the runtime for one sketch run. */
export function createStrings(lib: LibContext): Record<string, unknown> {
  const sprintfImpl = createSprintf(lib);
  return {
    String: arduinoString,
    __str,
    __m,
    __mut,
    __charAt,
    strlen: (s: unknown): number => cstr(s).length,
    strcpy(dst: unknown, src: unknown): unknown {
      const text = cstr(src);
      storeCString(dst, text);
      return Array.isArray(dst) ? dst : text;
    },
    strncpy(dst: unknown, src: unknown, n: unknown): unknown {
      const count = Math.max(0, intArg(n));
      const text = cstr(src).slice(0, count);
      if (Array.isArray(dst)) {
        // C pads with zeros up to n but does not terminate when src is at least n long.
        for (let i = 0; i < count && i < dst.length; i++) dst[i] = i < text.length ? text.charCodeAt(i) & 0xff : 0;
        return dst;
      }
      return text;
    },
    strcat(dst: unknown, src: unknown): unknown {
      const text = cstr(src);
      if (Array.isArray(dst)) {
        storeCString(dst, text, cstr(dst).length);
        return dst;
      }
      return cstr(dst) + text;
    },
    strcmp: (a: unknown, b: unknown): number => compareStrings(cstr(a), cstr(b)),
    strncmp: (a: unknown, b: unknown, n: unknown): number => {
      const count = Math.max(0, intArg(n));
      return compareStrings(cstr(a).slice(0, count), cstr(b).slice(0, count));
    },
    /** Returns the rest of the string from the match (a `char*` into it) or 0 (`NULL`). */
    strstr(haystack: unknown, needle: unknown): string | number {
      const text = cstr(haystack);
      const index = text.indexOf(cstr(needle));
      return index < 0 ? 0 : text.slice(index);
    },
    atoi: (s: unknown): number => (parseLeadingInt(cstr(s)) << 16) >> 16,
    atol: (s: unknown): number => parseLeadingInt(cstr(s)) | 0,
    atof: (s: unknown): number => parseLeadingFloat(cstr(s)),
    itoa(n: unknown, buf: unknown, base: unknown): unknown {
      const text = integerToString(intArg(n), intArg(base), 16);
      storeCString(buf, text);
      return Array.isArray(buf) ? buf : text;
    },
    ltoa(n: unknown, buf: unknown, base: unknown): unknown {
      const text = integerToString(intArg(n), intArg(base), 32);
      storeCString(buf, text);
      return Array.isArray(buf) ? buf : text;
    },
    utoa(n: unknown, buf: unknown, base: unknown): unknown {
      const text = (intArg(n) & 0xffff).toString(radixOf(intArg(base)));
      storeCString(buf, text);
      return Array.isArray(buf) ? buf : text;
    },
    ultoa(n: unknown, buf: unknown, base: unknown): unknown {
      const text = (intArg(n) >>> 0).toString(radixOf(intArg(base)));
      storeCString(buf, text);
      return Array.isArray(buf) ? buf : text;
    },
    dtostrf(value: unknown, width: unknown, precision: unknown, buf: unknown): unknown {
      const text = dtostrf(toNumber(value), intArg(width), intArg(precision));
      storeCString(buf, text);
      return Array.isArray(buf) ? buf : text;
    },
    sprintf(buf: unknown, format: unknown, ...args: unknown[]): number {
      const text = sprintfImpl(cstr(format), args);
      storeCString(buf, text);
      return text.length;
    },
    snprintf(buf: unknown, size: unknown, format: unknown, ...args: unknown[]): number {
      const text = sprintfImpl(cstr(format), args);
      const room = Math.max(0, intArg(size));
      if (room > 0) storeCString(buf, text.slice(0, room - 1));
      return text.length;
    },
  };
}

// ---------------------------------------------------------------------------
// String(x, arg?) and concatenation
// ---------------------------------------------------------------------------

/**
 * The `String(x)` / `String(x, base|decimals)` constructor: an integer with a
 * base (`String(255, HEX)` → "FF"), a float with a number of decimals
 * (`String(3.14159, 2)` → "3.14", default 2), a char stays a character,
 * a bool becomes "1"/"0", a string is copied.
 */
export function arduinoString(x: unknown, arg?: unknown): string {
  if (x instanceof FloatBox) return formatFloat(x.value, arg === undefined ? 2 : intArg(arg));
  if (typeof x === 'number') {
    if (!Number.isInteger(x)) return formatFloat(x, arg === undefined ? 2 : intArg(arg));
    return formatPrintArg(x, arg === undefined ? undefined : intArg(arg));
  }
  if (typeof x === 'string') return x;
  if (typeof x === 'boolean') return x ? '1' : '0';
  if (x === null || x === undefined) return '';
  return formatPrintArg(x);
}

/** Convert one operand of `String + x` to text according to its static type (§4.4 rule 5). */
export function __str(v: unknown, kind: ConcatKind): string {
  switch (kind) {
    case 'char':
      return typeof v === 'string' ? v : String.fromCharCode(intArg(v) & 0xff);
    case 'float':
      return formatFloat(toNumber(v), 2);
    case 'bool':
      return toNumber(v) !== 0 ? '1' : '0';
    case 'int':
      if (typeof v === 'string') return v;
      return String(intArg(v));
    case 'string':
      return typeof v === 'string' ? v : cstr(v);
    default:
      return typeof v === 'string' ? v : formatPrintArg(v);
  }
}

/** `s[i]` on a `String` or `char[]`: the character code, or 0 outside the string. */
export function __charAt(s: unknown, i: unknown): number {
  const index = intArg(i);
  if (typeof s === 'string') return index >= 0 && index < s.length ? s.charCodeAt(index) : 0;
  if (Array.isArray(s)) return index >= 0 && index < s.length ? intArg(s[index]) : 0;
  return 0;
}

// ---------------------------------------------------------------------------
// Method dispatch: __m and __mut
// ---------------------------------------------------------------------------

/**
 * Call `obj.name(...args)` the way the sketch wrote it: on a JS string this
 * implements the read-only Arduino `String` API, on an array only `length`
 * exists, and on any other object the method is looked up and invoked
 * (returning its promise when it is async). Unknown members throw a
 * `SketchError` the student can read.
 */
export function __m(obj: unknown, name: string, args: unknown[] = []): unknown {
  if (forbidden(name)) throw new SketchError(`'${name}' is not available in the simulator`);
  if (typeof obj === 'string') return stringMethod(obj, name, args);
  if (Array.isArray(obj)) {
    if (name === 'length') return obj.length;
    throw new SketchError(`'${name}' is not a member of this array`);
  }
  if (obj !== null && (typeof obj === 'object' || typeof obj === 'function') && !(obj instanceof FloatBox)) {
    const member = (obj as Record<string, unknown>)[name];
    if (inheritedFromBuiltins(member, name)) throw new SketchError(`'${name}' is not available in the simulator`);
    if (typeof member === 'function') return (member as (...a: unknown[]) => unknown).apply(obj, args);
  }
  throw new SketchError(`'${name}' is not a member of this object`);
}

/**
 * The `String` methods that modify the string in C++ (`toUpperCase`,
 * `toLowerCase`, `trim`, `replace`, `remove`, `concat`, `setCharAt`): return
 * the new value, which the generated code assigns back to the variable.
 */
export function __mut(s: unknown, name: string, args: unknown[] = []): string {
  if (forbidden(name)) throw new SketchError(`'${name}' is not available in the simulator`);
  const text = typeof s === 'string' ? s : cstr(s);
  switch (name) {
    case 'toUpperCase':
      return mapAscii(text, (c) => (c >= 97 && c <= 122 ? c - 32 : c));
    case 'toLowerCase':
      return mapAscii(text, (c) => (c >= 65 && c <= 90 ? c + 32 : c));
    case 'trim': {
      let start = 0;
      let end = text.length;
      while (start < end && WHITESPACE.has(text.charCodeAt(start))) start++;
      while (end > start && WHITESPACE.has(text.charCodeAt(end - 1))) end--;
      return text.slice(start, end);
    }
    case 'replace': {
      const from = textArg(args[0]);
      if (from.length === 0) return text;
      return text.split(from).join(textArg(args[1]));
    }
    case 'remove': {
      const index = intArg(args[0]);
      if (index < 0 || index >= text.length) return text;
      const count = args[1] === undefined ? text.length - index : Math.max(0, intArg(args[1]));
      return text.slice(0, index) + text.slice(index + count);
    }
    case 'concat':
      return text + concatArg(args[0]);
    case 'setCharAt': {
      const index = intArg(args[0]);
      if (index < 0 || index >= text.length) return text;
      return text.slice(0, index) + String.fromCharCode(charCodeOf(args[1])) + text.slice(index + 1);
    }
    default:
      throw new SketchError(`'${name}' is not a member of String`);
  }
}

function stringMethod(s: string, name: string, args: unknown[]): unknown {
  switch (name) {
    case 'length':
      return s.length;
    case 'charAt':
      return __charAt(s, args[0]);
    case 'indexOf': {
      const from = args[1] === undefined ? 0 : intArg(args[1]);
      if (from >= s.length) return -1;
      return s.indexOf(textArg(args[0]), Math.max(0, from));
    }
    case 'lastIndexOf': {
      const needle = textArg(args[0]);
      const from = args[1] === undefined ? s.length - 1 : intArg(args[1]);
      return from < 0 ? -1 : s.lastIndexOf(needle, from);
    }
    case 'substring': {
      let left = Math.max(0, intArg(args[0]));
      let right = args[1] === undefined ? s.length : Math.max(0, intArg(args[1]));
      if (left > right) [left, right] = [right, left];
      if (left >= s.length) return '';
      return s.slice(left, Math.min(right, s.length));
    }
    case 'equals':
      return s === textArg(args[0]);
    case 'equalsIgnoreCase':
      return s.toLowerCase() === textArg(args[0]).toLowerCase();
    case 'startsWith': {
      const offset = args[1] === undefined ? 0 : intArg(args[1]);
      return s.startsWith(textArg(args[0]), offset);
    }
    case 'endsWith':
      return s.endsWith(textArg(args[0]));
    case 'compareTo':
      return compareStrings(s, textArg(args[0]));
    case 'toInt':
      return parseLeadingInt(s) | 0;
    case 'toFloat':
    case 'toDouble':
      return parseLeadingFloat(s);
    case 'c_str':
      return s;
    case 'isEmpty':
      return s.length === 0;
    case 'toCharArray':
    case 'getBytes': {
      const size = intArg(args[1]);
      const index = args[2] === undefined ? 0 : intArg(args[2]);
      if (size > 0) storeCString(args[0], s.slice(index, index + size - 1));
      return undefined;
    }
    case 'reserve':
      return true;
    case 'toUpperCase':
    case 'toLowerCase':
    case 'trim':
    case 'replace':
    case 'remove':
    case 'concat':
    case 'setCharAt':
      // Reached only through an `unknown`-typed receiver; the result cannot be stored back.
      return __mut(s, name, args);
    default:
      throw new SketchError(`'${name}' is not a member of String`);
  }
}

/** A text argument of a `String` method: a string as is, a char code (number) as its character. */
function textArg(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || v instanceof FloatBox || typeof v === 'boolean') {
    return String.fromCharCode(intArg(v) & 0xff);
  }
  return cstr(v);
}

/** What `String::concat(x)` appends: text as is, a `char` (already a 1-char string) as is, numbers as `print` shows them. */
function concatArg(v: unknown): string {
  if (typeof v === 'string') return v;
  return formatPrintArg(v);
}

function mapAscii(text: string, fn: (code: number) => number): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += String.fromCharCode(fn(text.charCodeAt(i)));
  return out;
}

/** `strcmp` result: the difference of the first differing character codes (0 when equal). */
export function compareStrings(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const diff = a.charCodeAt(i) - b.charCodeAt(i);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Number parsing and formatting (atoi/atof/itoa/dtostrf)
// ---------------------------------------------------------------------------

/** `atol` semantics: skip whitespace, optional sign, digits; 0 when there is no number. */
export function parseLeadingInt(text: string): number {
  const match = /^\s*([+-]?\d+)/.exec(text);
  return match ? Number(match[1]) : 0;
}

/** `atof`/`strtod` semantics for decimal input: 0 when there is no number. */
export function parseLeadingFloat(text: string): number {
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(text);
  return match ? Number(match[1]) : 0;
}

function radixOf(base: number): number {
  return base >= 2 && base <= 36 ? base : 10;
}

/**
 * avr-libc `itoa`/`ltoa`: base 10 keeps the sign, any other base shows the
 * two's complement bits of the C type (`itoa(-1, buf, 16)` → "ffff") in
 * lowercase.
 */
function integerToString(n: number, base: number, bits: 16 | 32): string {
  const radix = radixOf(base);
  if (radix === 10) return String(bits === 16 ? (n << 16) >> 16 : n | 0);
  return (bits === 16 ? n & 0xffff : n >>> 0).toString(radix);
}

/** avr-libc `dtostrf(value, width, precision, buf)`: `width` right-aligns (negative width left-aligns). */
export function dtostrf(value: number, width: number, precision: number): string {
  const text = formatFloat(value, Math.max(0, precision));
  if (width < 0) return text.padEnd(-width, ' ');
  return text.padStart(width, ' ');
}

// ---------------------------------------------------------------------------
// sprintf
// ---------------------------------------------------------------------------

const FORMAT_SPEC = /%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|L|z|j|t)?([a-zA-Z%])/g;

/**
 * Build the `sprintf` formatter for one run. Integer conversions use the AVR
 * widths (`%d` is a 16-bit `int`, `%ld` a 32-bit `long`); `%f` and friends
 * print `?` as the UNO's `printf` does, with a one-time hint to use `dtostrf`.
 */
function createSprintf(lib: LibContext): (format: string, args: unknown[]) => string {
  return (format, args) => {
    let next = 0;
    const take = (): unknown => (next < args.length ? args[next++] : undefined);
    return format.replace(FORMAT_SPEC, (match, flags: string, widthSpec: string | undefined, precisionSpec: string | undefined, length: string | undefined, conv: string) => {
      if (conv === '%') return '%';
      let width = widthSpec === '*' ? intArg(take()) : widthSpec === undefined ? 0 : Number(widthSpec);
      let leftAlign = flags.includes('-');
      if (width < 0) {
        leftAlign = true;
        width = -width;
      }
      const precision = precisionSpec === '*' ? intArg(take()) : precisionSpec === undefined ? undefined : Number(precisionSpec);
      const wide = length === 'l' || length === 'll' || length === 'j' || length === 'z' || length === 't';
      let body: string;
      let numeric = false;
      switch (conv) {
        case 'd':
        case 'i': {
          const raw = intArg(take());
          const value = wide ? raw | 0 : (raw << 16) >> 16;
          if (!wide && value !== raw) lib.warnOnce(SPRINTF_INT_WARNING);
          body = signed(value, flags, precision);
          numeric = true;
          break;
        }
        case 'u': {
          const raw = intArg(take());
          const value = wide ? raw >>> 0 : raw & 0xffff;
          // A negative `int` shown with %u is deliberate two's complement; only values that cannot fit 16 bits are wrong.
          if (!wide && (raw > 0xffff || raw < -0x8000)) lib.warnOnce(SPRINTF_INT_WARNING);
          body = unsignedDigits(value, 10, precision);
          numeric = true;
          break;
        }
        case 'x':
        case 'X':
        case 'o':
        case 'p': {
          const raw = intArg(take());
          const value = wide || conv === 'p' ? raw >>> 0 : raw & 0xffff;
          const radix = conv === 'o' ? 8 : 16;
          body = unsignedDigits(value, radix, precision);
          if (flags.includes('#') && value !== 0) body = (conv === 'o' ? '0' : '0x') + body;
          if (conv === 'X') body = body.toUpperCase();
          numeric = true;
          break;
        }
        case 'c':
          body = String.fromCharCode(charCodeOf(take()));
          break;
        case 's': {
          body = cstr(take());
          if (precision !== undefined) body = body.slice(0, precision);
          break;
        }
        case 'f':
        case 'F':
        case 'e':
        case 'E':
        case 'g':
        case 'G': {
          take();
          lib.warnOnce(SPRINTF_FLOAT_WARNING);
          body = '?';
          break;
        }
        default:
          return match;
      }
      if (body.length >= width) return body;
      if (leftAlign) return body.padEnd(width, ' ');
      if (numeric && flags.includes('0') && precision === undefined) {
        const signLength = /^[-+ ]/.test(body) ? 1 : 0;
        const prefixLength = /^0[xX]/.test(body.slice(signLength)) ? 2 : 0;
        const head = body.slice(0, signLength + prefixLength);
        return head + body.slice(signLength + prefixLength).padStart(width - head.length, '0');
      }
      return body.padStart(width, ' ');
    });
  };
}

function signed(value: number, flags: string, precision: number | undefined): string {
  const digits = unsignedDigits(Math.abs(value), 10, precision);
  if (value < 0) return '-' + digits;
  if (flags.includes('+')) return '+' + digits;
  if (flags.includes(' ')) return ' ' + digits;
  return digits;
}

function unsignedDigits(value: number, radix: number, precision: number | undefined): string {
  let digits = value.toString(radix);
  if (precision !== undefined) {
    if (precision === 0 && value === 0) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  return digits;
}
