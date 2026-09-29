/**
 * Float formatting exactly as the UNO does it (docs/ARCHITECTURE.md §6.1, §6.3).
 *
 * On the AVR `float` and `double` are both IEEE single precision, and the two
 * formatters a sketch reaches work on those 32 bits:
 *   - `printFloat` is Arduino's `Print::printFloat` (`Serial.print(x, n)`,
 *     `lcd.print(x)`): "nan", "inf", "ovf" beyond ±4294967040, otherwise the
 *     integer part and `n` decimals worked out with single-precision steps;
 *   - `dtostrf` is avr-libc's `dtostrf()` (and so `String(x, n)` and
 *     `String + x`): at most 8 significant digits, rounded like the chip,
 *     then zeros; "NAN"/"INF" in capitals; no "ovf".
 * The digit engine is a line-by-line port of avr-libc 2.0's `ftoa_engine.S`
 * (Dmitry Xmelkov, BSD licence) and `dtoa_prf.c`, so the simulator prints the
 * same characters as the board, last digit included.
 */

const FTOA_MINUS = 1;
const FTOA_ZERO = 2;
const FTOA_INF = 4;
const FTOA_NAN = 8;
const FTOA_CARRY = 16;

/** Largest magnitude `Print::printFloat` prints; beyond it the board prints "ovf". */
const PRINT_FLOAT_LIMIT = 4294967040;

const CHAR_0 = 0x30;
const CHAR_9 = 0x39;

/**
 * The engine's flash tables, byte for byte (`.L_powr10`: 10^14 … 10^0 as 6-byte
 * little-endian numbers; `.L_base10`: 4-byte multiplier + decimal exponent per
 * group of 8 binary exponents). Kept as bytes because for subnormal values the
 * engine reads past the end of `.L_powr10` into `.L_base10`, like the chip.
 */
const TABLES = new Uint8Array([
  0, 64, 122, 16, 243, 90, 0, 160, 114, 78, 24, 9, 0, 16, 165, 212, 232, 0, 0, 232, 118, 72, 23, 0,
  0, 228, 11, 84, 2, 0, 0, 202, 154, 59, 0, 0, 0, 225, 245, 5, 0, 0, 128, 150, 152, 0, 0, 0,
  64, 66, 15, 0, 0, 0, 160, 134, 1, 0, 0, 0, 16, 39, 0, 0, 0, 0, 232, 3, 0, 0, 0, 0,
  100, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
  44, 118, 216, 136, 220, 103, 79, 8, 35, 223, 193, 223, 174, 89, 225, 177, 183, 150, 229, 227,
  228, 83, 198, 58, 230, 81, 153, 118, 150, 232, 230, 194, 132, 38, 235, 137, 140, 155, 98, 237,
  64, 124, 111, 252, 239, 188, 156, 159, 64, 242, 186, 165, 111, 165, 244, 144, 5, 90, 42, 247,
  92, 147, 107, 108, 249, 103, 109, 193, 27, 252, 224, 228, 13, 71, 254, 245, 32, 230, 181, 0,
  208, 237, 144, 46, 3, 0, 148, 53, 119, 5, 0, 128, 132, 30, 8, 0, 0, 32, 78, 10,
  0, 0, 0, 200, 12, 51, 51, 51, 51, 15, 152, 110, 18, 131, 17, 65, 239, 141, 33, 20,
  137, 59, 230, 85, 22, 207, 254, 230, 219, 24, 209, 132, 75, 56, 27, 247, 124, 29, 144, 29,
  164, 187, 228, 36, 32, 50, 132, 114, 94, 34, 129, 0, 201, 241, 36, 236, 161, 229, 61, 39,
]);
const BASE10_OFFSET = 90;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** The 32 bits of `x` rounded to single precision. */
function floatBits(x: number): number {
  f32[0] = x;
  return u32[0]!;
}

/** Unsigned little-endian number of `size` bytes at `offset` in the engine tables (0 past their end). */
function tableNumber(offset: number, size: number): number {
  let n = 0;
  for (let i = size - 1; i >= 0; i--) n = n * 256 + (TABLES[offset + i] ?? 0);
  return n;
}

interface EngineResult {
  /** FTOA_* flags. */
  flags: number;
  /** The decimal digits (character codes), most significant first. */
  digits: number[];
  /** Decimal exponent of the first digit. */
  exp10: number;
}

/**
 * avr-libc `__ftoa_engine(val, buf, prec, maxdgs)`: up to `prec + 1` (≤ 8)
 * rounded decimal digits of the single-precision `value`; `maxdgs` (0 = unused)
 * limits them to the digits before the `maxdgs - 1`th decimal place.
 */
function ftoaEngine(value: number, prec: number, maxdgs: number): EngineResult {
  if (prec >= 8) prec = 7;
  const bits = floatBits(value);
  let flags = bits >>> 31 ? FTOA_MINUS : 0;
  let exponent = (bits >>> 23) & 0xff;
  let mantissa = bits & 0x7fffff;
  if (exponent === 0 && mantissa === 0) {
    return { flags: flags | FTOA_ZERO, digits: new Array<number>(prec + 1).fill(CHAR_0), exp10: 0 };
  }
  if (exponent === 0xff) {
    // The chip goes on converting, but nobody reads those digits.
    return { flags: flags | (mantissa === 0 ? FTOA_INF : FTOA_NAN), digits: [], exp10: 0 };
  }
  if (exponent >= 1) mantissa |= 0x800000;
  else exponent = 1; // subnormal

  // Multiplication of the 24-bit mantissa by the 32-bit table entry, keeping bits 8… of the product,
  // then the shift by 7 - (exponent & 7). Split in 16-bit halves so every step is an exact double.
  const entry = BASE10_OFFSET + (exponent >> 3) * 5;
  const multiplier = tableNumber(entry, 4);
  let exp10 = (TABLES[entry + 4]! << 24) >> 24;
  const shift = 8 + (~exponent & 7);
  const high = mantissa * Math.floor(multiplier / 65536);
  const low = mantissa * (multiplier % 65536);
  let rest = high * 2 ** (16 - shift) + Math.floor(low / 2 ** shift);

  // Conversion to digits by repeated subtraction of the powers of ten.
  const buf: number[] = [flags];
  let power = 0;
  let powerOffset = 0;
  let count = prec;
  let total = 0;
  let searching = true;
  let roundUp = false;
  for (;;) {
    power = tableNumber(powerOffset, 6);
    powerOffset += 6;
    let digit = power === 0 ? 0 : Math.floor(rest / power);
    rest -= digit * power;
    if (searching) {
      if (digit === 0) {
        exp10--;
        continue;
      }
      searching = false;
      if (maxdgs !== 0) {
        let limit = (maxdgs - 1 + exp10) & 0xff;
        if (limit & 0x80) limit = 0;
        if (limit < count) count = limit;
      }
      count++;
      total = count;
    }
    if (digit >= 10) {
      while (count > 0) {
        buf.push(CHAR_9);
        count--;
      }
      roundUp = true;
      break;
    }
    buf.push(CHAR_0 + digit);
    if (--count === 0) break;
  }
  // Rounding: up when the rest is at least half of the last power of ten.
  if (!roundUp) roundUp = rest - Math.floor(power / 2) >= 0;
  if (roundUp) {
    let x = buf.length;
    for (;;) {
      count++;
      x--;
      let digit = buf[x]! + 1;
      const carried = digit > CHAR_9;
      if (carried) digit = CHAR_0;
      buf[x] = digit;
      if (count !== total && carried) continue;
      // The carry reached the first digit (on a digit this OR changes nothing: '0'..'9' have bit 4 set).
      buf[x - 1] = buf[x - 1]! | FTOA_CARRY;
      if (!carried) break;
      exp10++;
      buf[1] = 0x31;
      for (let i = 2; i < buf.length; i++) buf[i] = CHAR_0;
      break;
    }
  }
  return { flags: buf[0]!, digits: buf.slice(1), exp10 };
}

/**
 * avr-libc `dtostrf(value, width, prec)`: `value` in fixed notation with `prec`
 * decimals, right-aligned in `width` characters (left-aligned when `width` is
 * negative). Only the first 8 significant digits are real; the rest are zeros
 * (`dtostrf(4294967296.0, 4, 2)` → "4294967300.00"). NaN and infinities print
 * as "NAN", "INF", "-INF".
 */
export function dtostrf(value: number, width: number, prec: number): string {
  const w = Math.trunc(width) << 24 >> 24; // signed char
  const left = w < 0;
  return dtoaPrf(value, Math.abs(w) & 0xff, Math.trunc(prec) & 0xff, left);
}

/** avr-libc `dtoa_prf()` with the flags `dtostrf()` passes (DTOA_UPPER, DTOA_LEFT for a negative width). */
function dtoaPrf(value: number, width: number, prec: number, left: boolean): string {
  let ndigs = prec < 60 ? prec + 1 : 60;
  const { flags, digits, exp10: exp } = ftoaEngine(value, 7, ndigs);
  const sign = (flags & (FTOA_MINUS | FTOA_NAN)) === FTOA_MINUS ? '-' : '';
  const pad = (n: number): string => ' '.repeat(Math.max(0, n));

  if (flags & (FTOA_NAN | FTOA_INF)) {
    const text = sign + (flags & FTOA_NAN ? 'NAN' : 'INF');
    const fill = pad(width - text.length);
    return left ? text + fill : fill + text;
  }

  const n = sign.length + (exp > 0 ? exp + 1 : 1) + (prec ? prec + 1 : 0);
  const fill = pad(width - n);
  let s = left ? '' : fill;
  s += sign;

  ndigs = (ndigs + exp) & 0xff;
  const first = digits[0] ?? CHAR_0;
  if (flags & FTOA_CARRY && first === 0x31) ndigs = (ndigs - 1) & 0xff;
  if (((ndigs << 24) >> 24) < 1) ndigs = 1;
  else if (ndigs > 8) ndigs = 8;

  let place = exp > 0 ? exp : 0;
  let ch: number;
  for (;;) {
    if (place === -1) s += '.';
    ch = place <= exp && place > exp - ndigs ? (digits[exp - place] ?? CHAR_0) : CHAR_0;
    if (--place < -prec) break;
    s += String.fromCharCode(ch);
  }
  if (place === exp && (first > 0x35 || (first === 0x35 && !(flags & FTOA_CARRY)))) ch = 0x31;
  s += String.fromCharCode(ch);
  return left ? s + fill : s;
}

/**
 * Arduino `Print::printFloat(number, digits)` (`Serial.print(x, digits)`), with
 * every step in single precision like the UNO: "nan", "inf" (for both signs),
 * "ovf" beyond ±4294967040, otherwise halves rounded up at the last decimal.
 */
export function printFloat(value: number, digits = 2): string {
  let number = Math.fround(value);
  if (Number.isNaN(number)) return 'nan';
  if (!Number.isFinite(number)) return 'inf';
  if (number > PRINT_FLOAT_LIMIT || number < -PRINT_FLOAT_LIMIT) return 'ovf';
  let places = Math.trunc(digits) & 0xff; // uint8_t
  let s = '';
  if (number < 0) {
    s = '-';
    number = -number;
  }
  let rounding = 0.5;
  for (let i = 0; i < places; i++) rounding = Math.fround(rounding / 10);
  number = Math.fround(number + rounding);
  const intPart = Math.trunc(number);
  let remainder = Math.fround(number - intPart);
  s += String(intPart);
  if (places > 0) s += '.';
  while (places-- > 0) {
    remainder = Math.fround(remainder * 10);
    const toPrint = Math.trunc(remainder);
    s += String(toPrint);
    remainder = Math.fround(remainder - toPrint);
  }
  return s;
}
