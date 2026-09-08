import { describe, expect, it } from 'vitest';
import type { BoardEvent, ConsoleMessage, LcdDevice, RuntimeContext } from '../src/types';
import { Board } from '../src/runtime/board';
import { VirtualClock } from '../src/runtime/clock';
import { getServoAttachedCount } from '../src/runtime/core';
import { createLibs } from '../src/runtime/libs/index';
import { formatPrintArg } from '../src/runtime/libs/print';
import type { ArduinoSerial } from '../src/runtime/libs/serial';
import type { ArduinoServo } from '../src/runtime/libs/servo';
import type { ArduinoLcd } from '../src/runtime/libs/lcd';
import type { ArduinoDht } from '../src/runtime/libs/dht';
import type { ArduinoNeoPixel } from '../src/runtime/libs/neopixel';
import type { ArduinoNewPing } from '../src/runtime/libs/newping';
import type { ArduinoWire } from '../src/runtime/libs/wire';
import { FloatBox, SketchError, StopSignal } from '../src/runtime/values';

const HEX = 16;
const BIN = 2;
const OCT = 8;

type Fn = (...args: unknown[]) => unknown;
type Ctor<T> = new (...args: unknown[]) => T;

function makeCtx() {
  const clock = new VirtualClock();
  const board = new Board(clock);
  const messages: ConsoleMessage[] = [];
  const controller = new AbortController();
  let stopped = false;
  const ctx: RuntimeContext = {
    board,
    clock,
    console: (msg) => {
      messages.push(msg);
    },
    signal: controller.signal,
    throwIfStopped: () => {
      if (stopped) throw new StopSignal();
    },
    tick: async () => undefined,
    deadline: null,
  };
  const libs = createLibs(ctx);
  const events: BoardEvent[] = [];
  board.on((e) => events.push(e));
  const stop = (): void => {
    stopped = true;
    controller.abort();
  };
  const warnings = (): string[] => messages.filter((m) => m.level === 'warn').map((m) => m.text);
  return { clock, board, messages, warnings, libs, events, stop };
}

/** A recording stand-in for the LCD peripheral. */
function makeFakeLcd(): LcdDevice & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push([name, ...args]);
    };
  return {
    kind: 'lcd',
    cols: 16,
    rows: 2,
    calls,
    clear: record('clear'),
    home: record('home'),
    setCursor: record('setCursor'),
    writeChar: record('writeChar'),
    backlight: record('backlight'),
    display: record('display'),
    cursor: record('cursor'),
    blink: record('blink'),
    createChar: record('createChar'),
    scrollDisplayLeft: record('scrollDisplayLeft'),
    scrollDisplayRight: record('scrollDisplayRight'),
    autoscroll: record('autoscroll'),
    leftToRight: record('leftToRight'),
    rightToLeft: record('rightToLeft'),
  };
}

const writtenChars = (lcd: { calls: unknown[][] }): number[] =>
  lcd.calls.filter((c) => c[0] === 'writeChar').map((c) => c[1] as number);

describe('formatPrintArg (Arduino Print)', () => {
  it('prints integers in decimal by default', () => {
    expect(formatPrintArg(42)).toBe('42');
    expect(formatPrintArg(-7)).toBe('-7');
    expect(formatPrintArg(0)).toBe('0');
    expect(formatPrintArg(42, 10)).toBe('42');
  });

  it('prints floats with 2 decimals by default and honours the digits argument', () => {
    expect(formatPrintArg(3.14159)).toBe('3.14');
    expect(formatPrintArg(new FloatBox(3))).toBe('3.00');
    expect(formatPrintArg(new FloatBox(3.14159), 4)).toBe('3.1416');
    expect(formatPrintArg(new FloatBox(2.5), 0)).toBe('3');
    expect(formatPrintArg(-1.005)).toBe('-1.00');
    expect(formatPrintArg(Number.NaN)).toBe('nan');
  });

  it('prints other bases as unsigned 32-bit values, HEX in uppercase', () => {
    expect(formatPrintArg(255, HEX)).toBe('FF');
    expect(formatPrintArg(-1, HEX)).toBe('FFFFFFFF');
    expect(formatPrintArg(5, BIN)).toBe('101');
    expect(formatPrintArg(8, OCT)).toBe('10');
    expect(formatPrintArg(35, 36)).toBe('Z');
  });

  it('base 0 writes the raw byte, like write()', () => {
    expect(formatPrintArg(65, 0)).toBe('A');
    expect(formatPrintArg(0x141, 0)).toBe('A');
  });

  it('prints bools, strings, chars with a base, char arrays and nothing for null', () => {
    expect(formatPrintArg(true)).toBe('1');
    expect(formatPrintArg(false)).toBe('0');
    expect(formatPrintArg('hello')).toBe('hello');
    expect(formatPrintArg('A', 10)).toBe('65');
    expect(formatPrintArg('A')).toBe('A');
    expect(formatPrintArg([72, 105, 0, 33])).toBe('Hi');
    expect(formatPrintArg(null)).toBe('');
    expect(formatPrintArg(undefined)).toBe('');
  });
});

describe('Serial', () => {
  it('is truthy and drops output before begin() with a single warning', () => {
    const { libs, board, warnings } = makeCtx();
    const Serial = libs.Serial as ArduinoSerial;
    expect(Serial).toBeTruthy();
    let out = '';
    board.serial.onTx((t) => (out += t));
    expect(Serial.print('lost')).toBe(0);
    Serial.println('lost too');
    expect(out).toBe('');
    expect(warnings()).toEqual(['Serial output ignored: call Serial.begin(9600) in setup()']);
  });

  it('prints, printlns with CR LF and writes bytes after begin()', () => {
    const { libs, board } = makeCtx();
    const Serial = libs.Serial as ArduinoSerial;
    let out = '';
    board.serial.onTx((t) => (out += t));
    Serial.begin(9600);
    expect(Serial.print('x')).toBe(1);
    expect(Serial.println(42)).toBe(4);
    expect(Serial.write(65)).toBe(1);
    expect(Serial.write('hi')).toBe(2);
    Serial.print(new FloatBox(1.5));
    Serial.print(255, HEX);
    Serial.println();
    Serial.print(true);
    Serial.print([79, 75, 0]);
    expect(out).toBe('x42\r\nAhi1.50FF\r\n1OK');
    Serial.end();
    expect(Serial.print('gone')).toBe(0);
  });

  it('readString waits for the timeout while readStringUntil stops at the terminator', async () => {
    const { libs, board, clock } = makeCtx();
    const Serial = libs.Serial as ArduinoSerial;
    Serial.begin(9600);
    board.serial.inject('abc');
    const start = clock.now();
    expect(await Serial.readString()).toBe('abc');
    expect(clock.now() - start).toBeGreaterThanOrEqual(1000);
    expect(clock.now() - start).toBeLessThan(1010);

    board.serial.inject('hello\nworld');
    const t1 = clock.now();
    expect(await Serial.readStringUntil('\n')).toBe('hello');
    expect(clock.now()).toBe(t1);
    expect(Serial.available()).toBe(5);
    expect(Serial.peek()).toBe(119);
    expect(Serial.read()).toBe(119);
    expect(await Serial.readStringUntil(10)).toBe('orld');
    expect(clock.now() - t1).toBeGreaterThanOrEqual(1000);
  });

  it('parseInt skips junk, reads the sign and returns 0 after the timeout', async () => {
    const { libs, board, clock } = makeCtx();
    const Serial = libs.Serial as ArduinoSerial;
    Serial.begin(9600);
    board.serial.inject('abc-42x');
    expect(await Serial.parseInt()).toBe(-42);
    expect(Serial.read()).toBe(120);
    Serial.setTimeout(50);
    const start = clock.now();
    expect(await Serial.parseInt()).toBe(0);
    expect(clock.now() - start).toBeGreaterThanOrEqual(50);
    expect(clock.now() - start).toBeLessThan(60);
    board.serial.inject('3.25;');
    expect(await Serial.parseFloat()).toBeCloseTo(3.25, 6);
    expect(Serial.read()).toBe(59);
  });

  it('readBytes, find and empty reads behave like Stream', async () => {
    const { libs, board } = makeCtx();
    const Serial = libs.Serial as ArduinoSerial;
    Serial.begin(9600);
    Serial.setTimeout(10);
    board.serial.inject('junk ok data');
    expect(await Serial.find('ok')).toBe(true);
    const buf = [0, 0, 0, 0, 0];
    expect(await Serial.readBytes(buf, 3)).toBe(3);
    expect(buf).toEqual([32, 100, 97, 0, 0]);
    expect(await Serial.readBytesUntil('a', buf, 5)).toBe(1);
    expect(buf[0]).toBe(116);
    expect(Serial.available()).toBe(0);
    expect(Serial.read()).toBe(-1);
    expect(Serial.peek()).toBe(-1);
    expect(await Serial.readString()).toBe('');
  });

  it('stops waiting when the sketch is stopped', async () => {
    const { libs, clock, stop } = makeCtx();
    const Serial = libs.Serial as ArduinoSerial;
    Serial.begin(9600);
    const pending = Serial.readString();
    stop();
    await expect(pending).rejects.toBeInstanceOf(StopSignal);
    expect(clock.now()).toBeLessThan(20);
  });
});

describe('String', () => {
  it('String(x, arg) formats numbers by base or decimals', () => {
    const { libs } = makeCtx();
    const String_ = libs.String as (x: unknown, arg?: unknown) => string;
    expect(String_(255, HEX)).toBe('FF');
    expect(String_(5, BIN)).toBe('101');
    expect(String_(3.14159, 2)).toBe('3.14');
    expect(String_(new FloatBox(3.14159), 3)).toBe('3.142');
    expect(String_(new FloatBox(3))).toBe('3.00');
    expect(String_(2.5)).toBe('2.50');
    expect(String_(42)).toBe('42');
    expect(String_(true)).toBe('1');
    expect(String_(false)).toBe('0');
    expect(String_('abc')).toBe('abc');
    expect(String_('A')).toBe('A');
    expect(String_([79, 75, 0])).toBe('OK');
  });

  it('__str converts concatenation operands by static kind', () => {
    const { libs } = makeCtx();
    const __str = libs.__str as (v: unknown, kind: string) => string;
    expect(__str(65, 'char')).toBe('A');
    expect(__str('A', 'char')).toBe('A');
    expect(__str(3, 'float')).toBe('3.00');
    expect(__str(new FloatBox(1.25), 'float')).toBe('1.25');
    expect(__str(true, 'bool')).toBe('1');
    expect(__str(0, 'bool')).toBe('0');
    expect(__str(7, 'int')).toBe('7');
    expect(__str('abc', 'string')).toBe('abc');
    expect(__str([72, 105, 0], 'string')).toBe('Hi');
    expect(__str(2.5, 'unknown')).toBe('2.50');
    expect(__str(12, 'unknown')).toBe('12');
    expect(__str(null, 'unknown')).toBe('');
  });

  it('__m implements the read-only String API on JS strings', () => {
    const { libs } = makeCtx();
    const __m = libs.__m as (o: unknown, n: string, a?: unknown[]) => unknown;
    const s = 'hello';
    expect(__m(s, 'length')).toBe(5);
    expect(__m(s, 'charAt', [1])).toBe(101);
    expect(__m(s, 'charAt', [9])).toBe(0);
    expect(__m(s, 'indexOf', ['l'])).toBe(2);
    expect(__m(s, 'indexOf', [108])).toBe(2);
    expect(__m(s, 'indexOf', ['l', 3])).toBe(3);
    expect(__m(s, 'indexOf', ['z'])).toBe(-1);
    expect(__m(s, 'lastIndexOf', ['l'])).toBe(3);
    expect(__m(s, 'substring', [1, 3])).toBe('el');
    expect(__m(s, 'substring', [3, 1])).toBe('el');
    expect(__m(s, 'substring', [2])).toBe('llo');
    expect(__m(s, 'substring', [9])).toBe('');
    expect(__m(s, 'equals', ['hello'])).toBe(true);
    expect(__m(s, 'equals', ['Hello'])).toBe(false);
    expect(__m(s, 'equalsIgnoreCase', ['HELLO'])).toBe(true);
    expect(__m(s, 'startsWith', ['he'])).toBe(true);
    expect(__m(s, 'startsWith', [104])).toBe(true);
    expect(__m(s, 'startsWith', ['ll', 2])).toBe(true);
    expect(__m(s, 'endsWith', ['lo'])).toBe(true);
    expect(__m(s, 'compareTo', ['hello'])).toBe(0);
    expect(__m(s, 'compareTo', ['help']) as number).toBeLessThan(0);
    expect(__m(s, 'compareTo', ['hell']) as number).toBeGreaterThan(0);
    expect(__m('42abc', 'toInt')).toBe(42);
    expect(__m('  -7', 'toInt')).toBe(-7);
    expect(__m('abc', 'toInt')).toBe(0);
    expect(__m('3.5x', 'toFloat')).toBeCloseTo(3.5, 6);
    expect(__m('3.5x', 'toDouble')).toBeCloseTo(3.5, 6);
    expect(__m(s, 'c_str')).toBe('hello');
    expect(__m(s, 'isEmpty')).toBe(false);
    expect(__m('', 'isEmpty')).toBe(true);
    expect(__m(s, 'reserve', [32])).toBe(true);
    const buf = [1, 1, 1, 1, 1, 1];
    __m(s, 'toCharArray', [buf, 4]);
    expect(buf).toEqual([104, 101, 108, 0, 1, 1]);
    __m(s, 'getBytes', [buf, 6]);
    expect(buf).toEqual([104, 101, 108, 108, 111, 0]);
    expect(() => __m(s, 'explode')).toThrow(SketchError);
  });

  it('__m dispatches to arrays and objects, keeping `this` and returning promises', async () => {
    const { libs } = makeCtx();
    const __m = libs.__m as (o: unknown, n: string, a?: unknown[]) => unknown;
    expect(__m([1, 2, 3], 'length')).toBe(3);
    const obj = {
      base: 10,
      add(x: number) {
        return this.base + x;
      },
      async later(x: number) {
        return x * 2;
      },
    };
    expect(__m(obj, 'add', [5])).toBe(15);
    const p = __m(obj, 'later', [4]);
    expect(p).toBeInstanceOf(Promise);
    expect(await p).toBe(8);
    expect(() => __m(obj, 'missing', [])).toThrow("'missing' is not a member of this object");
    expect(() => __m(5, 'toInt', [])).toThrow(SketchError);
    expect(() => __m(null, 'x', [])).toThrow(SketchError);
  });

  it('__mut returns the modified string', () => {
    const { libs } = makeCtx();
    const __mut = libs.__mut as (s: unknown, n: string, a?: unknown[]) => string;
    expect(__mut('Hello', 'toUpperCase')).toBe('HELLO');
    expect(__mut('Hello', 'toLowerCase')).toBe('hello');
    expect(__mut('  hi \r\n', 'trim')).toBe('hi');
    expect(__mut('hello', 'replace', ['l', 'L'])).toBe('heLLo');
    expect(__mut('hello', 'replace', [108, 76])).toBe('heLLo');
    expect(__mut('hello', 'replace', ['ll', ''])).toBe('heo');
    expect(__mut('hello', 'remove', [1])).toBe('h');
    expect(__mut('hello', 'remove', [1, 2])).toBe('hlo');
    expect(__mut('hello', 'remove', [9])).toBe('hello');
    expect(__mut('abc', 'concat', [5])).toBe('abc5');
    expect(__mut('abc', 'concat', ['x'])).toBe('abcx');
    expect(__mut('abc', 'concat', [2.5])).toBe('abc2.50');
    expect(__mut('abc', 'concat', [new FloatBox(2)])).toBe('abc2.00');
    expect(__mut('hello', 'setCharAt', [0, 'X'])).toBe('Xello');
    expect(__mut('hello', 'setCharAt', [0, 88])).toBe('Xello');
    expect(__mut('hello', 'setCharAt', [9, 88])).toBe('hello');
    expect(() => __mut('x', 'nope')).toThrow(SketchError);
  });

  it('__charAt returns the code or 0', () => {
    const { libs } = makeCtx();
    const __charAt = libs.__charAt as (s: unknown, i: unknown) => number;
    expect(__charAt('abc', 1)).toBe(98);
    expect(__charAt('abc', 3)).toBe(0);
    expect(__charAt('abc', -1)).toBe(0);
    expect(__charAt([65, 66, 0], 1)).toBe(66);
  });
});

describe('C string functions', () => {
  it('strlen/strcpy/strncpy/strcat/strcmp/strncmp/strstr work on strings and char arrays', () => {
    const { libs } = makeCtx();
    const f = libs as Record<string, Fn>;
    expect(f.strlen!('abc')).toBe(3);
    expect(f.strlen!([104, 105, 0, 0, 0])).toBe(2);
    const buf = new Array<number>(8).fill(0);
    expect(f.strcpy!(buf, 'hey')).toBe(buf);
    expect(buf).toEqual([104, 101, 121, 0, 0, 0, 0, 0]);
    f.strcat!(buf, [33, 33, 0]);
    expect(buf).toEqual([104, 101, 121, 33, 33, 0, 0, 0]);
    const small = [9, 9, 9];
    f.strcpy!(small, 'toolong');
    expect(small).toEqual([116, 111, 111]);
    const n = [9, 9, 9, 9, 9];
    f.strncpy!(n, 'ab', 4);
    expect(n).toEqual([97, 98, 0, 0, 9]);
    expect(f.strcmp!('abc', 'abc')).toBe(0);
    expect(f.strcmp!('abc', 'abd') as number).toBeLessThan(0);
    expect(f.strcmp!([98, 0], 'a') as number).toBeGreaterThan(0);
    expect(f.strncmp!('abcX', 'abcY', 3)).toBe(0);
    expect(f.strstr!('turn on', 'on')).toBe('on');
    expect(f.strstr!('on', 'on')).toBe('on');
    expect(f.strstr!('turn off', 'on')).toBe(0);
  });

  it('atoi/atol/atof parse leading numbers with AVR widths', () => {
    const { libs } = makeCtx();
    const f = libs as Record<string, Fn>;
    expect(f.atoi!('  42x')).toBe(42);
    expect(f.atoi!('-13')).toBe(-13);
    expect(f.atoi!('abc')).toBe(0);
    expect(f.atoi!('40000')).toBe(-25536);
    expect(f.atol!('70000')).toBe(70000);
    expect(f.atol!([49, 50, 0])).toBe(12);
    expect(f.atof!('3.5e2 rest')).toBeCloseTo(350, 6);
    expect(f.atof!('.5')).toBeCloseTo(0.5, 6);
    expect(f.atof!('x')).toBe(0);
  });

  it('itoa/ltoa/dtostrf write into the buffer and return it', () => {
    const { libs } = makeCtx();
    const f = libs as Record<string, Fn>;
    const buf = new Array<number>(12).fill(7);
    expect(f.itoa!(255, buf, 16)).toBe(buf);
    expect(buf.slice(0, 3)).toEqual([102, 102, 0]);
    f.itoa!(-1, buf, 16);
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe('ffff');
    f.itoa!(-42, buf, 10);
    expect(String.fromCharCode(...buf.slice(0, 3))).toBe('-42');
    f.ltoa!(-1, buf, 16);
    expect(String.fromCharCode(...buf.slice(0, 8))).toBe('ffffffff');
    f.ltoa!(5, buf, 2);
    expect(String.fromCharCode(...buf.slice(0, 3))).toBe('101');
    f.dtostrf!(3.14159, 6, 2, buf);
    expect(String.fromCharCode(...buf.slice(0, 6))).toBe('  3.14');
    expect(buf[6]).toBe(0);
    f.dtostrf!(-2.5, 1, 1, buf);
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe('-2.5');
    f.dtostrf!(1.5, -5, 1, buf);
    expect(String.fromCharCode(...buf.slice(0, 5))).toBe('1.5  ');
  });

  it('sprintf supports the integer, char and string conversions with width and flags', () => {
    const { libs, warnings } = makeCtx();
    const f = libs as Record<string, Fn>;
    const buf = new Array<number>(40).fill(0);
    const text = (): string => {
      let out = '';
      for (const c of buf) {
        if (c === 0) break;
        out += String.fromCharCode(c);
      }
      return out;
    };
    expect(f.sprintf!(buf, 'v=%d', 42)).toBe(4);
    expect(text()).toBe('v=42');
    f.sprintf!(buf, '[%5d]', 42);
    expect(text()).toBe('[   42]');
    f.sprintf!(buf, '[%-5d]', 42);
    expect(text()).toBe('[42   ]');
    f.sprintf!(buf, '[%05d]', 42);
    expect(text()).toBe('[00042]');
    f.sprintf!(buf, '[%05d]', -42);
    expect(text()).toBe('[-0042]');
    f.sprintf!(buf, '%i|%u|%x|%X|%o', -3, -1, 255, 255, 8);
    expect(text()).toBe('-3|65535|ff|FF|10');
    f.sprintf!(buf, '%c%c%%', 65, 'B');
    expect(text()).toBe('AB%');
    f.sprintf!(buf, '%s and %s', 'text', [79, 75, 0]);
    expect(text()).toBe('text and OK');
    f.sprintf!(buf, '[%5s][%-3s][%.2s]', 'ab', 'ab', 'abcdef');
    expect(text()).toBe('[   ab][ab ][ab]');
    f.sprintf!(buf, '%ld %lu %lx', 70000, -1, 70000);
    expect(text()).toBe('70000 4294967295 11170');
    f.sprintf!(buf, '%02d:%02d', 7, 5);
    expect(text()).toBe('07:05');
    f.sprintf!(buf, '%+d %3d', 5, 1234);
    expect(text()).toBe('+5 1234');
    expect(warnings()).toEqual([]);
    f.sprintf!(buf, '%d', 70000);
    expect(text()).toBe('4464');
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('%ld');
  });

  it('sprintf prints ? for %f with a single warning and snprintf truncates', () => {
    const { libs, warnings } = makeCtx();
    const f = libs as Record<string, Fn>;
    const buf = new Array<number>(16).fill(0);
    expect(f.sprintf!(buf, 'T=%f C', 21.5)).toBe(5);
    expect(String.fromCharCode(...buf.slice(0, 5))).toBe('T=? C');
    expect(buf[5]).toBe(0);
    f.sprintf!(buf, '%.2f', 1.5);
    expect(warnings()).toEqual(['sprintf does not support %f on Arduino UNO; use dtostrf()']);
    buf.fill(9);
    expect(f.snprintf!(buf, 4, '%s', 'abcdef')).toBe(6);
    expect(buf.slice(0, 5)).toEqual([97, 98, 99, 0, 9]);
  });
});

describe('Servo', () => {
  it('warns once when written before attach and applies the write when attached', () => {
    const { libs, board, events, warnings } = makeCtx();
    const Servo = libs.Servo as Ctor<ArduinoServo>;
    const servo = new Servo();
    expect(servo.attached()).toBe(false);
    servo.write(45);
    servo.write(50);
    expect(warnings()).toEqual(['Servo.write() called before attach(): call myServo.attach(4) in setup()']);
    expect(events.filter((e) => e.type === 'servo')).toEqual([]);
    servo.attach(4);
    expect(servo.attached()).toBe(true);
    expect(board.pins[4]!.mode).toBe('OUTPUT');
    expect(board.pins[4]!.servo).toBe(50);
    expect(events.filter((e) => e.type === 'servo')).toEqual([{ type: 'servo', pin: 4, angle: 50 }]);
    expect(getServoAttachedCount(board)).toBe(1);
  });

  it('write/read/microseconds follow Servo.cpp and detach releases the pin', () => {
    const { libs, board, events } = makeCtx();
    const Servo = libs.Servo as Ctor<ArduinoServo>;
    const servo = new Servo();
    servo.attach(4);
    expect(servo.read()).toBe(92);
    expect(servo.readMicroseconds()).toBe(1500);
    servo.write(90);
    expect(servo.read()).toBe(90);
    expect(board.pins[4]!.servo).toBe(90);
    expect(servo.readMicroseconds()).toBe(1472);
    servo.write(-20);
    expect(servo.read()).toBe(0);
    servo.write(300);
    expect(servo.read()).toBe(180);
    servo.write(2400);
    expect(servo.read()).toBe(180);
    expect(servo.readMicroseconds()).toBe(2400);
    servo.writeMicroseconds(1500);
    expect(servo.readMicroseconds()).toBe(1500);
    expect(servo.read()).toBe(92);
    servo.writeMicroseconds(100);
    expect(servo.readMicroseconds()).toBe(544);
    expect(board.pins[4]!.servo).toBe(0);
    for (let angle = 0; angle <= 180; angle++) {
      servo.write(angle);
      expect(servo.read()).toBe(angle);
    }
    servo.detach();
    expect(servo.attached()).toBe(false);
    expect(board.pins[4]!.servo).toBeNull();
    expect(events.at(-1)).toEqual({ type: 'servo', pin: 4, angle: null });
    expect(getServoAttachedCount(board)).toBe(0);
    servo.detach();
    expect(getServoAttachedCount(board)).toBe(0);
  });

  it('honours custom min/max pulse widths and counts every attached servo', () => {
    const { libs, board } = makeCtx();
    const Servo = libs.Servo as Ctor<ArduinoServo>;
    const a = new Servo();
    const b = new Servo();
    a.attach(4, 1000, 2000);
    b.attach(5);
    expect(getServoAttachedCount(board)).toBe(2);
    a.write(180);
    expect(a.readMicroseconds()).toBe(2000);
    a.writeMicroseconds(1500);
    expect(a.read()).toBe(90);
    expect(() => a.attach(99)).toThrow(SketchError);
  });
});

describe('LiquidCrystal_I2C', () => {
  it('drives the registered device: init, print codes, setCursor, write, createChar, backlight', async () => {
    const { libs, board, warnings } = makeCtx();
    const fake = makeFakeLcd();
    board.registerI2CDevice(0x27, fake);
    const LiquidCrystal_I2C = libs.LiquidCrystal_I2C as Ctor<ArduinoLcd>;
    const lcd = new LiquidCrystal_I2C(0x27, 16, 2);
    await lcd.init();
    expect(fake.calls.map((c) => c[0])).toContain('clear');
    expect(fake.calls.at(-1)).toEqual(['home']);
    lcd.backlight();
    expect(fake.calls.at(-1)).toEqual(['backlight', true]);
    fake.calls.length = 0;
    expect(lcd.print('Hi')).toBe(2);
    expect(writtenChars(fake)).toEqual([72, 105]);
    lcd.setCursor(3, 1);
    expect(fake.calls.at(-1)).toEqual(['setCursor', 3, 1]);
    fake.calls.length = 0;
    lcd.print(new FloatBox(25.5));
    lcd.print('°C');
    lcd.print('→');
    lcd.print(255, HEX);
    expect(writtenChars(fake)).toEqual([50, 53, 46, 53, 48, 0xdf, 67, 63, 70, 70]);
    fake.calls.length = 0;
    expect(lcd.write(223)).toBe(1);
    lcd.write(0);
    lcd.write('ab');
    expect(writtenChars(fake)).toEqual([223, 0, 97, 98]);
    lcd.createChar(1, [0, 10, 31, 31, 14, 4, 0, 0]);
    expect(fake.calls.at(-1)).toEqual(['createChar', 1, [0, 10, 31, 31, 14, 4, 0, 0]]);
    lcd.noBacklight();
    lcd.setBacklight(1);
    lcd.noDisplay();
    lcd.cursor();
    lcd.blink();
    lcd.scrollDisplayLeft();
    lcd.rightToLeft();
    lcd.autoscroll();
    await lcd.clear();
    expect(fake.calls.slice(-9)).toEqual([
      ['backlight', false],
      ['backlight', true],
      ['display', false],
      ['cursor', true],
      ['blink', true],
      ['scrollDisplayLeft'],
      ['rightToLeft'],
      ['autoscroll', true],
      ['clear'],
    ]);
    expect(warnings()).toEqual([]);
  });

  it('warns once when nothing answers at the address and becomes a no-op', async () => {
    const { libs, board, warnings } = makeCtx();
    board.registerI2CDevice(0x27, makeFakeLcd());
    const LiquidCrystal_I2C = libs.LiquidCrystal_I2C as Ctor<ArduinoLcd>;
    const lcd = new LiquidCrystal_I2C(0x3f, 16, 2);
    await lcd.init();
    lcd.backlight();
    expect(lcd.print('nobody home')).toBe(11);
    lcd.setCursor(0, 1);
    await lcd.clear();
    expect(warnings()).toEqual(['No I2C LCD found at address 0x3F (the ZERO1 LCD is at 0x27)']);
  });

  it('ignores drawing before init() with a hint, but lets the backlight through', () => {
    const { libs, board, warnings } = makeCtx();
    const fake = makeFakeLcd();
    board.registerI2CDevice(0x27, fake);
    const LiquidCrystal_I2C = libs.LiquidCrystal_I2C as Ctor<ArduinoLcd>;
    const lcd = new LiquidCrystal_I2C(0x27, 16, 2);
    lcd.backlight();
    expect(fake.calls).toEqual([['backlight', true]]);
    lcd.print('early');
    lcd.setCursor(0, 1);
    expect(writtenChars(fake)).toEqual([]);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('lcd.init()');
  });

  it('LiquidCrystal warns that the ZERO1 LCD is on I2C and does nothing', () => {
    const { libs, warnings } = makeCtx();
    const LiquidCrystal = libs.LiquidCrystal as Ctor<ArduinoLcd>;
    const lcd = new LiquidCrystal(12, 11, 5, 4, 3, 2);
    void lcd.begin(16, 2);
    expect(lcd.print('x')).toBe(1);
    lcd.setCursor(0, 0);
    expect(warnings()).toEqual(['the ZERO1 LCD is connected over I2C; use LiquidCrystal_I2C lcd(0x27, 16, 2)']);
  });
});

describe('DHT', () => {
  it('reads NaN without a sensor and the registered values with one', () => {
    const { libs, board, clock } = makeCtx();
    const DHT = libs.DHT as Ctor<ArduinoDht>;
    expect(libs.DHT22).toBe(22);
    expect(libs.DHT11).toBe(11);
    expect(libs.DHT21).toBe(21);
    expect(libs.AM2301).toBe(21);
    expect(libs.DHT12).toBe(12);
    const dht = new DHT(5, libs.DHT22);
    dht.begin();
    expect(board.pins[5]!.mode).toBe('INPUT_PULLUP');
    expect(Number.isNaN(dht.readTemperature())).toBe(true);
    expect(Number.isNaN(dht.readHumidity())).toBe(true);
    let reading = { temperature: 24, humidity: 55 };
    board.registerDht(5, () => reading);
    clock.advance(2000);
    expect(dht.readTemperature()).toBe(24);
    expect(dht.readHumidity()).toBe(55);
    expect(dht.readTemperature(true)).toBeCloseTo(75.2, 6);
    reading = { temperature: 30, humidity: 40 };
    expect(dht.readTemperature()).toBe(24);
    expect(dht.readTemperature(false, true)).toBe(30);
    clock.advance(2000);
    expect(dht.readHumidity()).toBe(40);
  });

  it('computes the heat index and converts units like DHT.cpp', () => {
    const { libs } = makeCtx();
    const DHT = libs.DHT as Ctor<ArduinoDht>;
    const dht = new DHT(5, 22);
    expect(dht.convertCtoF(100)).toBeCloseTo(212, 6);
    expect(dht.convertFtoC(212)).toBeCloseTo(99.999, 2);
    expect(dht.computeHeatIndex(25, 50, false)).toBeCloseTo(24.86, 1);
    expect(dht.computeHeatIndex(95, 60)).toBeCloseTo(113.09, 1);
    expect(dht.computeHeatIndex(35, 70, false)).toBeCloseTo(50.4, 0);
  });
});

describe('Adafruit_NeoPixel', () => {
  it('packs colours, converts HSV and applies gamma like the library', () => {
    const { libs } = makeCtx();
    const Adafruit_NeoPixel = libs.Adafruit_NeoPixel as Ctor<ArduinoNeoPixel>;
    const px = new Adafruit_NeoPixel(1, 9, (libs.NEO_GRB as number) + (libs.NEO_KHZ800 as number));
    expect(px.Color(255, 128, 0)).toBe(0xff8000);
    expect(px.Color(1, 2, 3, 4)).toBe(0x04010203);
    expect(px.ColorHSV(0)).toBe(0xff0000);
    expect(px.ColorHSV(21845)).toBe(0x00ff00);
    expect(px.ColorHSV(43690)).toBe(0x0000ff);
    expect(px.ColorHSV(0, 0, 255)).toBe(0xffffff);
    expect(px.ColorHSV(0, 255, 128)).toBe(0x800000);
    expect(px.ColorHSV(65535)).toBe(0xff0000);
    expect(px.gamma8(0)).toBe(0);
    expect(px.gamma8(255)).toBe(255);
    // Values from Adafruit's _NeoPixelGammaTable / _NeoPixelSineTable.
    expect(px.gamma8(28)).toBe(1);
    expect(px.gamma8(100)).toBe(22);
    expect(px.gamma8(128)).toBe(42);
    expect(px.gamma8(200)).toBe(136);
    expect(px.gamma32(0xff8000)).toBe(0xff2a00);
    expect(px.sine8(0)).toBe(128);
    expect(px.sine8(1)).toBe(131);
    expect(px.sine8(64)).toBe(255);
    expect(px.sine8(128)).toBe(128);
    expect(px.sine8(192)).toBe(0);
    expect(px.sine8(255)).toBe(124);
    expect(px.canShow()).toBe(true);
    expect(px.numPixels()).toBe(1);
    expect(px.getPin()).toBe(9);
    expect(libs.NEO_RGB).toBe(0x06);
    expect(libs.NEO_GRB).toBe(0x52);
    expect(libs.NEO_RGBW).toBe(0x1b);
    expect(libs.NEO_KHZ400).toBe(0x0100);
    const orders = [libs.NEO_RGB, libs.NEO_GRB, libs.NEO_RGBW, libs.NEO_BRG, libs.NEO_RBG, libs.NEO_GBR, libs.NEO_BGR];
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('show() before begin() warns once; afterwards it sends brightness-scaled colours', () => {
    const { libs, board, events, warnings } = makeCtx();
    const Adafruit_NeoPixel = libs.Adafruit_NeoPixel as Ctor<ArduinoNeoPixel>;
    const px = new Adafruit_NeoPixel(3, 9, libs.NEO_GRB);
    px.setPixelColor(0, 255, 255, 255);
    px.show();
    px.show();
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('pixels.show() called before pixels.begin()');
    expect(events.filter((e) => e.type === 'pixels')).toEqual([]);
    px.begin();
    expect(board.pins[9]!.mode).toBe('OUTPUT');
    px.setPixelColor(1, px.Color(10, 20, 30));
    px.setPixelColor(2, 0x040506);
    px.setPixelColor(7, 0xffffff);
    expect(px.getBrightness()).toBe(255);
    px.show();
    expect(events.at(-1)).toEqual({ type: 'pixels', pin: 9, colors: [0xffffff, 0x0a141e, 0x040506] });
    px.setBrightness(127);
    expect(px.getBrightness()).toBe(127);
    px.show();
    expect(events.at(-1)).toEqual({ type: 'pixels', pin: 9, colors: [0x7f7f7f, 0x050a0f, 0x020203] });
    expect(px.getPixelColor(0)).toBe(0xffffff);
    expect(px.getPixelColor(9)).toBe(0);
    px.setBrightness(0);
    px.show();
    expect(events.at(-1)).toEqual({ type: 'pixels', pin: 9, colors: [0, 0, 0] });
    px.setBrightness(255);
    px.fill(0x112233);
    expect([0, 1, 2].map((i) => px.getPixelColor(i))).toEqual([0x112233, 0x112233, 0x112233]);
    px.fill(0xaabbcc, 1, 1);
    expect([0, 1, 2].map((i) => px.getPixelColor(i))).toEqual([0x112233, 0xaabbcc, 0x112233]);
    px.clear();
    px.show();
    expect(events.at(-1)).toEqual({ type: 'pixels', pin: 9, colors: [0, 0, 0] });
    px.rainbow();
    expect(px.getPixelColor(0)).toBe(0xff0000);
    expect(px.getPixelColor(1)).toBe(px.gamma32(px.ColorHSV(21845)));
    px.rainbow(0, 1, 255, 255, false);
    expect(px.getPixelColor(2)).toBe(px.ColorHSV(43690));
    px.updateLength(2);
    expect(px.numPixels()).toBe(2);
    expect(px.getPixelColor(0)).toBe(0);
    px.setPin(6);
    px.show();
    expect(events.at(-1)).toEqual({ type: 'pixels', pin: 6, colors: [0, 0] });
  });
});

describe('NewPing', () => {
  it('triggers on trig, measures the echo and converts to cm/inches', async () => {
    const { libs, board, events, clock } = makeCtx();
    const NewPing = libs.NewPing as Ctor<ArduinoNewPing>;
    board.registerPulseSource(2, { measure: (level) => (level === 1 ? 2900 : 0) });
    const sonar = new NewPing(3, 2, 200);
    expect(board.pins[3]!.mode).toBe('OUTPUT');
    expect(board.pins[2]!.mode).toBe('INPUT');
    events.length = 0;
    const start = clock.now();
    expect(await sonar.ping()).toBe(2900);
    const trig = events.filter((e) => e.type === 'digitalWrite' && e.pin === 3).map((e) => (e as { level: number }).level);
    expect(trig).toEqual([0, 1, 0]);
    expect(clock.now() - start).toBeCloseTo(2.914, 3);
    expect(await sonar.ping_cm()).toBe(50);
    expect(await sonar.ping_in()).toBe(19);
    expect(sonar.convert_cm(2900)).toBe(50);
    expect(sonar.convert_cm(0)).toBe(0);
    expect(sonar.convert_cm(56)).toBe(0);
    expect(sonar.convert_cm(57)).toBe(1);
    expect(sonar.convert_in(1460)).toBe(10);
  });

  it('returns 0 after waiting the maximum echo time when nothing answers', async () => {
    const { libs, clock } = makeCtx();
    const NewPing = libs.NewPing as Ctor<ArduinoNewPing>;
    const sonar = new NewPing(3, 2, 100);
    const start = clock.now();
    expect(await sonar.ping()).toBe(0);
    expect(await sonar.ping_cm()).toBe(0);
    // NewPing waits (maxCm + 1) * 57 µs for each echo.
    expect(clock.now() - start).toBeGreaterThanOrEqual(2 * 5.757);
    expect(clock.now() - start).toBeLessThan(2 * 5.8);
  });

  it('ping_median takes several pings ~29 ms apart and drops the failed ones', async () => {
    const { libs, board, clock } = makeCtx();
    const NewPing = libs.NewPing as Ctor<ArduinoNewPing>;
    const samples = [1200, 0, 1000, 5000, 1100];
    let i = 0;
    board.registerPulseSource(2, { measure: () => samples[i++ % samples.length] as number });
    const sonar = new NewPing(3, 2);
    const start = clock.now();
    // Four echoes kept in descending order [5000, 1200, 1100, 1000]; the library returns uS[4 >> 1].
    expect(await sonar.ping_median()).toBe(1100);
    expect(clock.now() - start).toBeGreaterThanOrEqual(4 * 29);
    expect(clock.now() - start).toBeLessThan(5 * 29 + 5);
  });
});

describe('Wire', () => {
  it('endTransmission reports 0 for a registered device and 2 otherwise', () => {
    const { libs, board } = makeCtx();
    const Wire = libs.Wire as ArduinoWire;
    board.registerI2CDevice(0x27, makeFakeLcd());
    Wire.begin();
    Wire.setClock(400000);
    Wire.beginTransmission(0x27);
    expect(Wire.write(0)).toBe(1);
    expect(Wire.endTransmission()).toBe(0);
    Wire.beginTransmission(0x3f);
    expect(Wire.endTransmission()).toBe(2);
    expect(Wire.endTransmission()).toBe(2);
    expect(Wire.requestFrom(0x27, 2)).toBe(0);
    expect(Wire.available()).toBe(0);
    expect(Wire.read()).toBe(-1);
    const found: number[] = [];
    for (let addr = 1; addr < 127; addr++) {
      Wire.beginTransmission(addr);
      if (Wire.endTransmission() === 0) found.push(addr);
    }
    expect(found).toEqual([0x27]);
  });
});

describe('createLibs', () => {
  it('exports every name the architecture lists', () => {
    const { libs } = makeCtx();
    const names = [
      'Serial', 'String', '__str', '__m', '__mut', '__charAt',
      'strlen', 'strcpy', 'strncpy', 'strcat', 'strcmp', 'strncmp', 'strstr',
      'atoi', 'atol', 'atof', 'itoa', 'ltoa', 'dtostrf', 'sprintf', 'snprintf',
      'Servo', 'LiquidCrystal_I2C', 'LiquidCrystal',
      'DHT', 'DHT11', 'DHT12', 'DHT21', 'DHT22', 'AM2301',
      'Adafruit_NeoPixel', 'NEO_RGB', 'NEO_GRB', 'NEO_RGBW', 'NEO_BRG', 'NEO_RBG', 'NEO_GBR', 'NEO_BGR', 'NEO_KHZ800', 'NEO_KHZ400',
      'NewPing', 'Wire',
    ];
    for (const name of names) expect(libs, name).toHaveProperty(name);
    expect(typeof libs.Servo).toBe('function');
    expect(typeof libs.String).toBe('function');
  });
});
