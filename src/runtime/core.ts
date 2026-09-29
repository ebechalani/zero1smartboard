/**
 * The Arduino core API (docs/ARCHITECTURE.md §5.4): every function and
 * constant a sketch can use without including a library, from `pinMode()`
 * to `map()` and `random()`. `createCoreApi(ctx)` builds one set per sketch run.
 */
import type { IBoard, PinMode, RuntimeContext } from '../types';
import { assertPin, pinName } from './board';
import { __ftoi, __idiv, __u16, __u32, __u8, toNumber } from './helpers';
import { SketchAbort, SketchError } from './values';

/** Constants available to every sketch (Arduino.h). */
export const CORE_CONSTANTS: Readonly<Record<string, number>> = {
  HIGH: 1,
  LOW: 0,
  INPUT: 0,
  OUTPUT: 1,
  INPUT_PULLUP: 2,
  A0: 14,
  A1: 15,
  A2: 16,
  A3: 17,
  A4: 18,
  A5: 19,
  LED_BUILTIN: 13,
  DEC: 10,
  HEX: 16,
  OCT: 8,
  BIN: 2,
  MSBFIRST: 1,
  LSBFIRST: 0,
  CHANGE: 1,
  FALLING: 2,
  RISING: 3,
  NOT_AN_INTERRUPT: -1,
  SDA: 18,
  SCL: 19,
  NULL: 0,
  // AVR double is float: the Arduino.h constants are single-precision values on the board.
  PI: Math.fround(Math.PI),
  HALF_PI: Math.fround(Math.PI / 2),
  TWO_PI: Math.fround(Math.PI * 2),
  DEG_TO_RAD: Math.fround(Math.PI / 180),
  RAD_TO_DEG: Math.fround(180 / Math.PI),
  EULER: Math.fround(Math.E),
  F_CPU: 16000000,
  DEFAULT: 1,
  EXTERNAL: 0,
  INTERNAL: 3,
  INT_MAX: 32767,
  INT_MIN: -32768,
  UINT_MAX: 65535,
  LONG_MAX: 2147483647,
  LONG_MIN: -2147483648,
  ULONG_MAX: 4294967295,
  NAN: Number.NaN,
  INFINITY: Number.POSITIVE_INFINITY,
};

const DEFAULT_PULSEIN_TIMEOUT_US = 1_000_000;
const RANDOM_MAX = 0x7fffffff;
/** Only these two UNO pins have external interrupts (INT0, INT1). */
const INTERRUPT_PINS: Readonly<Record<number, number>> = { 2: 0, 3: 1 };
/** Pins whose PWM timer (Timer1) the Servo library takes over. */
const SERVO_TIMER_PINS: ReadonlySet<number> = new Set([9, 10]);

const servoAttachedCounts = new WeakMap<IBoard, number>();

/** Record how many `Servo` objects are attached on `board` (the Servo library calls this on attach/detach). */
export function setServoAttachedCount(board: IBoard, n: number): void {
  servoAttachedCounts.set(board, Math.max(0, Math.trunc(n) || 0));
}

/** How many `Servo` objects are attached on `board` (0 when none). */
export function getServoAttachedCount(board: IBoard): number {
  return servoAttachedCounts.get(board) ?? 0;
}

/** Deterministic 32-bit PRNG (mulberry32); returns values in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A char argument: generated code passes chars as 1-character strings, sketches may also pass codes. */
function charArg(v: unknown): number {
  if (typeof v === 'string') return v.length === 1 ? v.charCodeAt(0) : 0;
  return int(v);
}

function int(v: unknown): number {
  return Math.trunc(toNumber(v)) || 0;
}

/** A `long` parameter: truncated, then wrapped to 32 bits. */
function long(v: unknown): number {
  return int(v) | 0;
}

/** A `float`/`double` parameter: rounded to single precision (AVR double is float). */
function flt(v: unknown): number {
  return Math.fround(toNumber(v));
}

/** A math function of avr-libc: single-precision argument and result. */
function f32Math(fn: (x: number) => number): (x: unknown) => number {
  return (x: unknown): number => Math.fround(fn(flt(x)));
}

/** Pin argument as a C `uint8_t` would see it, validated against the UNO. */
function pinArg(v: unknown): number {
  return assertPin(toNumber(v));
}

function parsePinMode(pin: number, mode: unknown): PinMode {
  if (typeof mode === 'string' && mode.length > 1) {
    const name = mode.toUpperCase();
    if (name === 'INPUT' || name === 'OUTPUT' || name === 'INPUT_PULLUP') return name;
  } else {
    const n = int(mode);
    if (n === 0) return 'INPUT';
    if (n === 1) return 'OUTPUT';
    if (n === 2) return 'INPUT_PULLUP';
  }
  throw new SketchError(`pinMode(${pinName(pin)}, ...): the mode must be INPUT, OUTPUT or INPUT_PULLUP`);
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}
function isUpper(c: number): boolean {
  return c >= 65 && c <= 90;
}
function isLower(c: number): boolean {
  return c >= 97 && c <= 122;
}
function isAlpha(c: number): boolean {
  return isUpper(c) || isLower(c);
}
function isGraph(c: number): boolean {
  return c >= 33 && c <= 126;
}

/**
 * Build the core Arduino functions and constants for one sketch run, bound
 * to the board and clock in `ctx`. Warnings (a forgotten `pinMode`, an
 * ignored `tone()`...) go to `ctx.console` once each.
 */
export function createCoreApi(ctx: RuntimeContext): Record<string, unknown> {
  const { board, clock } = ctx;
  setServoAttachedCount(board, 0);

  const warned = new Set<string>();
  const warnOnce = (text: string): void => {
    if (warned.has(text)) return;
    warned.add(text);
    ctx.console({ level: 'warn', text });
  };

  let rng = mulberry32(1);
  const nextRandom = (max: number): number => Math.floor(rng() * max);

  /** The pending `noTone()` scheduled by `tone(pin, freq, duration)`, if any. */
  let toneTimer: { pin: number; cancelled: boolean } | null = null;
  const cancelToneTimer = (): void => {
    if (toneTimer) toneTimer.cancelled = true;
    toneTimer = null;
  };

  const interruptHandlers = new Map<number, unknown>();

  /** Resolve with the promise's value, or `undefined` as soon as the sketch is stopped. */
  const untilStopped = async <T>(promise: Promise<T>): Promise<T | undefined> => {
    const { signal } = ctx;
    if (signal.aborted) return undefined;
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<undefined>((resolve) => {
      onAbort = () => resolve(undefined);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([promise, aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };

  const digitalWrite = (pin: unknown, value: unknown): void => {
    const index = pinArg(pin);
    const level: 0 | 1 = toNumber(value) !== 0 ? 1 : 0;
    board.digitalWrite(index, level);
    const mode = board.pins[index]?.mode ?? null;
    const enablesPullUp = mode === 'INPUT' && level === 1;
    if (mode !== 'OUTPUT' && !enablesPullUp) {
      const name = pinName(index);
      warnOnce(`digitalWrite(${name}) but pinMode(${name}, OUTPUT) was never called`);
    }
  };

  const noTone = (pin: unknown): void => {
    const index = pinArg(pin);
    if (toneTimer?.pin === index) cancelToneTimer();
    board.noTone(index);
  };

  const pulseIn = async (pin: unknown, level: unknown, timeout?: unknown): Promise<number> => {
    const index = pinArg(pin);
    const wanted: 0 | 1 = toNumber(level) !== 0 ? 1 : 0;
    const timeoutUs = timeout === undefined ? DEFAULT_PULSEIN_TIMEOUT_US : Math.max(0, toNumber(timeout)) || 0;
    const width = await untilStopped(board.pulseIn(index, wanted, timeoutUs));
    ctx.throwIfStopped();
    return __u32(width ?? 0);
  };

  const api: Record<string, unknown> = {
    ...CORE_CONSTANTS,

    // --- digital and analog I/O ---------------------------------------------
    pinMode(pin: unknown, mode: unknown): void {
      const index = pinArg(pin);
      board.pinMode(index, parsePinMode(index, mode));
    },
    digitalWrite,
    digitalRead(pin: unknown): number {
      return board.digitalRead(pinArg(pin));
    },
    analogWrite(pin: unknown, value: unknown): void {
      const index = pinArg(pin);
      const duty = Math.min(255, Math.max(0, int(value)));
      if (SERVO_TIMER_PINS.has(index) && getServoAttachedCount(board) > 0) {
        warnOnce('PWM on pins 9 and 10 is disabled while a Servo is attached');
        board.digitalWrite(index, duty > 127 ? 1 : 0);
        return;
      }
      board.analogWrite(index, duty);
    },
    analogRead(pin: unknown): number {
      return board.analogRead(toNumber(pin));
    },
    analogReference(): void {
      // The simulator always uses the 5 V reference.
    },

    // --- time -----------------------------------------------------------------
    async delay(ms: unknown): Promise<void> {
      // delay(unsigned long): a decimal part is dropped like on the board (delay(1.5) waits 1 ms)
      await clock.sleep(Math.max(0, Math.trunc(toNumber(ms))) || 0, ctx.signal);
      ctx.throwIfStopped();
    },
    async delayMicroseconds(us: unknown): Promise<void> {
      await clock.sleep((Math.max(0, Math.trunc(toNumber(us))) || 0) / 1000, ctx.signal);
      ctx.throwIfStopped();
    },
    millis(): number {
      return __u32(Math.floor(clock.now()));
    },
    micros(): number {
      return __u32(clock.micros());
    },
    yield: (): Promise<void> => ctx.tick(),

    // --- sound and pulses ------------------------------------------------------
    tone(pin: unknown, freq: unknown, duration?: unknown): void {
      const index = pinArg(pin);
      const hz = int(freq);
      if (hz <= 0) {
        noTone(index);
        return;
      }
      const busyPin = board.pins.findIndex((p, i) => i !== index && p.tone !== null);
      if (busyPin >= 0) {
        const busy = pinName(busyPin);
        warnOnce(
          `tone(${pinName(index)}) was ignored: pin ${busy} is still playing a tone. ` +
            `The UNO plays one tone at a time; call noTone(${busy}) first`,
        );
        return;
      }
      cancelToneTimer();
      board.tone(index, hz);
      const ms = duration === undefined ? 0 : toNumber(duration);
      if (!(ms > 0)) return;
      const timer = { pin: index, cancelled: false };
      toneTimer = timer;
      clock
        .sleep(ms, ctx.signal)
        .then(() => {
          if (toneTimer === timer) toneTimer = null;
          if (!timer.cancelled) board.noTone(index);
        })
        .catch(() => undefined);
    },
    noTone,
    pulseIn,
    pulseInLong: pulseIn,

    // --- shift registers -------------------------------------------------------
    shiftOut(dataPin: unknown, clockPin: unknown, bitOrder: unknown, value: unknown): void {
      const data = pinArg(dataPin);
      const clk = pinArg(clockPin);
      const msbFirst = int(bitOrder) !== CORE_CONSTANTS.LSBFIRST;
      const byte = __u8(value);
      for (let i = 0; i < 8; i++) {
        const bit = msbFirst ? (byte >> (7 - i)) & 1 : (byte >> i) & 1;
        digitalWrite(data, bit);
        digitalWrite(clk, 1);
        digitalWrite(clk, 0);
      }
    },
    shiftIn(dataPin: unknown, clockPin: unknown, bitOrder: unknown): number {
      const data = pinArg(dataPin);
      const clk = pinArg(clockPin);
      const msbFirst = int(bitOrder) !== CORE_CONSTANTS.LSBFIRST;
      let value = 0;
      for (let i = 0; i < 8; i++) {
        digitalWrite(clk, 1);
        const bit = board.digitalRead(data);
        value |= msbFirst ? bit << (7 - i) : bit << i;
        digitalWrite(clk, 0);
      }
      return value;
    },

    // --- maths -------------------------------------------------------------------
    map(x: unknown, inMin: unknown, inMax: unknown, outMin: unknown, outMax: unknown): number {
      // WMath.cpp: (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min, all in 32-bit long.
      const [v, a, b, c, d] = [x, inMin, inMax, outMin, outMax].map(long) as [number, number, number, number, number];
      return (__idiv(Math.imul((v - a) | 0, (d - c) | 0), (b - a) | 0) + c) | 0;
    },
    constrain(x: unknown, low: unknown, high: unknown): number {
      const v = toNumber(x);
      const lo = toNumber(low);
      const hi = toNumber(high);
      return v < lo ? lo : v > hi ? hi : v;
    },
    min(a: unknown, b: unknown): number {
      const x = toNumber(a);
      const y = toNumber(b);
      return x < y ? x : y;
    },
    max(a: unknown, b: unknown): number {
      const x = toNumber(a);
      const y = toNumber(b);
      return x > y ? x : y;
    },
    abs(x: unknown): number {
      const v = toNumber(x);
      return v < 0 ? -v : v;
    },
    fabs: f32Math(Math.abs),
    sq(x: unknown): number {
      // #define sq(x) ((x)*(x)): the transpiler wraps an integer result to its C type
      // (and uses __imul for a long variable, whose square can pass 2^53).
      const v = toNumber(x);
      return v * v;
    },
    pow: (a: unknown, b: unknown): number => Math.fround(Math.pow(flt(a), flt(b))),
    sqrt: f32Math(Math.sqrt),
    sin: f32Math(Math.sin),
    cos: f32Math(Math.cos),
    tan: f32Math(Math.tan),
    asin: f32Math(Math.asin),
    acos: f32Math(Math.acos),
    atan: f32Math(Math.atan),
    atan2: (y: unknown, x: unknown): number => Math.fround(Math.atan2(flt(y), flt(x))),
    exp: f32Math(Math.exp),
    log: f32Math(Math.log),
    log10: f32Math(Math.log10),
    floor: f32Math(Math.floor),
    ceil: f32Math(Math.ceil),
    trunc: f32Math(Math.trunc),
    fmod: (a: unknown, b: unknown): number => Math.fround(flt(a) % flt(b)),
    round(x: unknown): number {
      // #define round(x) ((x)>=0?(long)((x)+0.5):(long)((x)-0.5)): the addition in single precision,
      // the (long) conversion like avr-gcc's (NaN and out-of-range values give -2147483648)
      const v = flt(x);
      return __ftoi(Math.fround(v >= 0 ? v + 0.5 : v - 0.5));
    },
    // #define radians(deg) ((deg)*DEG_TO_RAD) and degrees(rad) ((rad)*RAD_TO_DEG), in single precision
    radians: (deg: unknown): number => Math.fround(flt(deg) * CORE_CONSTANTS.DEG_TO_RAD!),
    degrees: (rad: unknown): number => Math.fround(flt(rad) * CORE_CONSTANTS.RAD_TO_DEG!),
    isnan: (x: unknown): boolean => Number.isNaN(toNumber(x)),
    isinf(x: unknown): boolean {
      const v = toNumber(x);
      return v === Number.POSITIVE_INFINITY || v === Number.NEGATIVE_INFINITY;
    },
    isfinite: (x: unknown): boolean => Number.isFinite(toNumber(x)),

    // --- random ------------------------------------------------------------------
    random(a?: unknown, b?: unknown): number {
      if (a === undefined) return nextRandom(RANDOM_MAX);
      if (b === undefined) {
        const max = int(a);
        return max <= 0 ? 0 : nextRandom(max);
      }
      const low = int(a);
      const diff = int(b) - low;
      return diff <= 0 ? low : low + nextRandom(diff);
    },
    randomSeed(seed: unknown): void {
      const s = __u32(seed);
      if (s !== 0) rng = mulberry32(s);
    },

    // --- bits and bytes ------------------------------------------------------------
    bit: (n: unknown): number => (1 << (int(n) & 31)) >>> 0,
    bitRead: (value: unknown, n: unknown): number => (__u32(value) >>> (int(n) & 31)) & 1,
    lowByte: (value: unknown): number => __u8(value),
    highByte: (value: unknown): number => (__u32(value) >>> 8) & 0xff,
    word(high: unknown, low?: unknown): number {
      if (low === undefined) return __u16(high);
      return (__u8(high) << 8) | __u8(low);
    },

    // --- characters ------------------------------------------------------------------
    isDigit: (c: unknown): boolean => isDigit(charArg(c)),
    isAlpha: (c: unknown): boolean => isAlpha(charArg(c)),
    isAlphaNumeric(c: unknown): boolean {
      const code = charArg(c);
      return isAlpha(code) || isDigit(code);
    },
    isSpace(c: unknown): boolean {
      const code = charArg(c);
      return code === 32 || (code >= 9 && code <= 13);
    },
    isWhitespace(c: unknown): boolean {
      const code = charArg(c);
      return code === 32 || code === 9;
    },
    isUpperCase: (c: unknown): boolean => isUpper(charArg(c)),
    isLowerCase: (c: unknown): boolean => isLower(charArg(c)),
    isPunct(c: unknown): boolean {
      const code = charArg(c);
      return isGraph(code) && !isAlpha(code) && !isDigit(code);
    },
    isPrintable(c: unknown): boolean {
      const code = charArg(c);
      return code >= 32 && code <= 126;
    },
    isGraph: (c: unknown): boolean => isGraph(charArg(c)),
    isControl(c: unknown): boolean {
      const code = charArg(c);
      return (code >= 0 && code < 32) || code === 127;
    },
    isAscii(c: unknown): boolean {
      const code = charArg(c);
      return code >= 0 && code <= 127;
    },
    isHexadecimalDigit(c: unknown): boolean {
      const code = charArg(c);
      return isDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
    },
    toUpperCase(c: unknown): number {
      const code = charArg(c);
      return isLower(code) ? code - 32 : code;
    },
    toLowerCase(c: unknown): number {
      const code = charArg(c);
      return isUpper(code) ? code + 32 : code;
    },
    toAscii: (c: unknown): number => charArg(c) & 0x7f,

    // --- interrupts (not simulated) ------------------------------------------------------
    interrupts(): void {
      // Interrupts are always "enabled": the simulator never disables them.
    },
    noInterrupts(): void {
      // Nothing runs concurrently with the sketch, so there is nothing to block.
    },
    attachInterrupt(interrupt: unknown, isr: unknown): void {
      interruptHandlers.set(int(interrupt), isr);
      warnOnce('external interrupts are not simulated on this board');
    },
    detachInterrupt(interrupt: unknown): void {
      interruptHandlers.delete(int(interrupt));
    },
    digitalPinToInterrupt: (pin: unknown): number => INTERRUPT_PINS[int(pin)] ?? CORE_CONSTANTS.NOT_AN_INTERRUPT,

    // --- misc ---------------------------------------------------------------------------
    F: (s: unknown): unknown => s,
    /** avr-libc `abort()`: the board halts; the simulator stops with an error on the line of the call. */
    abort(): never {
      throw new SketchAbort();
    },
  };
  return api;
}
