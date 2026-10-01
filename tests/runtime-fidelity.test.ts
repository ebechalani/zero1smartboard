/**
 * Simulator fidelity (docs/PYTHON.md §6, "C0"): the simulator computes like the ATmega328P in
 * every mode. Every expected value in this file was measured on the chip: the sketch built with
 * the project's avr-g++ 7.3 (WebAssembly toolchain) and run on avr8js (tools/emulator/run-hex.mjs,
 * A3 = 512), then compared line by line with the simulator.
 */
import { describe, expect, it } from 'vitest';
import { dtostrf, printFloat } from '../src/runtime/avr-float';
import { __ftoi, __ftou, __idiv, __imod, __imul } from '../src/runtime/helpers';
import { arduinoString } from '../src/runtime/libs/strings';
import { FloatBox } from '../src/runtime/values';
import { runSketch } from './helpers';

/** Run `body` inside setup() (after Serial.begin) and return the printed lines. */
async function printed(body: string, globals = ''): Promise<string[]> {
  const r = await runSketch(`${globals}\nvoid setup() {\n  Serial.begin(9600);\n${body}\n}\nvoid loop() {}\n`, {
    stopAfterMs: 200,
    maxLoops: 1,
    before: (board) => board.potLdr.setPot(512),
  });
  expect(r.console.filter((m) => m.level === 'error')).toEqual([]);
  return r.serial.split('\r\n').slice(0, -1);
}

/** The float whose IEEE single-precision bits are `bits`. */
function floatOf(bits: number): number {
  return new Float32Array(new Uint32Array([bits]).buffer)[0]!;
}

describe('the board values of docs/PYTHON.md §6', () => {
  it('integer operations wrap at the C width, floats are single precision, String(float) and print(float) differ', async () => {
    expect(
      await printed(`
  int p = analogRead(A3) * 100 / 1023;
  Serial.println(p);
  Serial.println(60 * 1000);
  Serial.println(1 << 20);
  long a = 50000;
  Serial.println(a * a);
  float s = 0.1;
  Serial.println(s == 0.1);
  Serial.println(0.1 + 0.2 == 0.3);
  Serial.println(String(1e10, 1));
  Serial.println(1e10);
  float big = 3.4e38;
  Serial.println(big > 1e38);`),
    ).toEqual(['-14', '-5536', '0', '-1794967296', '1', '1', '10000000000.0', 'ovf', '1']);
  });
});

describe('rule 1: floats are single precision everywhere', () => {
  it('rounds literals, results of + - * /, float-returning calls and conversions', async () => {
    expect(
      await printed(`
  float r = 2.675 * 100;
  Serial.println(r, 6);
  Serial.println(floor(2.675 * 100 + 0.5) / 100);
  long big = 16777217;
  Serial.println(big + 0.5, 1);
  Serial.println(PI, 7);
  Serial.println(PI * 1000000.0, 2);
  float volts = analogRead(A3) * 5.0 / 1023;
  Serial.println(volts, 7);
  Serial.println(sqrt(2), 7);
  Serial.println(1.0 / 3.0, 9);
  float third = 1.0 / 3.0;
  Serial.println(third * 3 == 1.0);
  double d = 0.1;
  Serial.println(d * 3, 9);`),
    ).toEqual(['267.500000', '2.68', '16777216.0', '3.1415927', '3141592.75', '2.5024437', '1.4142135', '0.333333349', '1', '0.300000000']);
  });

  it('f++ on a float and round() add in single precision', async () => {
    expect(
      await printed(`
  float f = 16777216.0;
  f++;
  Serial.println(f, 1);
  Serial.println(round(0.49999997));`),
    ).toEqual(['16777216.0', '1']);
  });
});

describe('rule 2: integers wrap at their C width on every operation', () => {
  it('wraps + - * << ~ and unary - and converts signed operands to unsigned like C', async () => {
    expect(
      await printed(`
  unsigned long ul3 = 4000000000UL;
  Serial.println(ul3 * 3);
  unsigned int u = 0;
  Serial.println(u - 1);
  int neg = -1;
  unsigned int one = 1;
  Serial.println(neg < one);
  Serial.println(neg / one);
  unsigned long ul = 0x80000000UL;
  Serial.println(ul | 1);
  Serial.println(~one);
  byte b = 255;
  Serial.println(b << 8);
  int m = -32768;
  Serial.println(-m);
  int big = 32767;
  big++;
  Serial.println(big);`),
    ).toEqual(['3410065408', '65535', '0', '65535', '2147483649', '65534', '-256', '-32768', '-32768']);
  });

  it('the sq/abs/min/max/constrain macros and map() compute in their C types', async () => {
    expect(
      await printed(`
  Serial.println(sq(300));
  int m = -32768;
  Serial.println(abs(m));
  Serial.println(map(100000, 0, 200000, 0, 100000));
  unsigned int u3 = 14;
  Serial.println(constrain(u3, -100, 100));
  Serial.println(max(0UL, -7));
  char c = -32;
  Serial.println(ceil(c), 1);`),
    ).toEqual(['24464', '-32768', '7050', '65436', '4294967289', '-32.0']);
  });

  it('sq() of a float stays a float, sq() of a long keeps the low 32 bits of the square', async () => {
    expect(
      await printed(
        `  Serial.println(sq(big));
  Serial.println(String(sq(mid), 0));
  long a = l;
  unsigned long b = ul;
  Serial.println(sq(a));
  Serial.println(sq(b));
  Serial.println(sq(l + 1));
  Serial.println(sq(i));`,
        `volatile float big = 1e30;
volatile float mid = 123456789.0;
volatile long l = 100000000L;
volatile unsigned long ul = 3000000000UL;
volatile int i = 300;`,
      ),
    ).toEqual(['inf', '15241579000000000', '1874919424', '3800301568', '2074919425', '24464']);
  });

  it('an integer 0 is never a negative zero (1.0 / 0 is INF, not -INF)', async () => {
    expect(
      await printed(`
  int neg = -1;
  int half = neg / 2;
  Serial.println(String(1.0 / half, 1));
  Serial.println(String(1.0 / (-4 % 2), 1));`),
    ).toEqual(['INF', 'INF']);
  });

  it('converts floats to integers like avr-gcc at run time (__fixsfsi / __fixunssfsi)', async () => {
    const values = ['3705297664.0', '-3705297664.0', '2147483520.0', '1e10', '40000.5', '-70000.7', '255.9', '-1.5', '0.0 / 0.0', '65535.9'];
    const lines = await printed(
      `  for (int i = 0; i < ${values.length}; i++) {
    float f = v[i];
    long l = f; unsigned long ul = f; int n = f; unsigned int un = f; char c = f; byte b = f;
    Serial.print(l); Serial.print(' '); Serial.print(ul); Serial.print(' '); Serial.print(n); Serial.print(' ');
    Serial.print(un); Serial.print(' '); Serial.print((int)c); Serial.print(' '); Serial.println((int)b);
  }`,
      `volatile float v[] = {${values.join(', ')}};`,
    );
    expect(lines).toEqual([
      '-2147483648 3705297664 0 23296 0 0',
      '-2147483648 589669632 0 42240 0 0',
      '2147483520 2147483520 -128 65408 -128 128',
      '-2147483648 0 0 0 0 0',
      '40000 40000 -25536 40000 64 64',
      '-70000 4294897296 -4464 61072 -112 144',
      '255 255 255 255 -1 255',
      '-1 4294967295 -1 65535 -1 255',
      '-2147483648 0 0 0 0 0',
      '65535 65535 -1 65535 -1 255',
    ]);
  });

  it('round() is the Arduino.h macro: a single-precision addition, then the avr-gcc conversion to long', async () => {
    expect(
      await printed(
        `  for (int i = 0; i < 5; i++) {
    long r = round(v[i]);
    Serial.print(r);
    Serial.print(' ');
    Serial.println(String(1.0 / round(v[i]), 1));
  }`,
        'volatile float v[] = {0.0 / 0.0, 2.5, -2.5, -0.3, 3e9};',
      ),
    ).toEqual(['-2147483648 -0.0', '3 0.3', '-3 -0.3', '0 INF', '-2147483648 -0.0']);
  });

  it('the helpers: __imul keeps the low 32 bits, __idiv/__imod never give -0, __ftoi/__ftou like libgcc', () => {
    expect(__imul(50000, 50000)).toBe(-1794967296);
    expect(__imul(2147483647, 2147483647)).toBe(1);
    expect(Object.is(__idiv(-1, 2), 0)).toBe(true);
    expect(Object.is(__imod(-4, 2), 0)).toBe(true);
    expect(__ftoi(3e9)).toBe(-2147483648);
    expect(__ftoi(-2147483648)).toBe(-2147483648);
    expect(__ftoi(Number.NaN)).toBe(-2147483648);
    expect(__ftoi(-7.9)).toBe(-7);
    expect(__ftou(-1.5)).toBe(4294967295);
    expect(__ftou(4294967296)).toBe(0);
    expect(__ftou(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('rule 3: abort()', () => {
  it('stops the run with a console error on the line of the call, after what was printed', async () => {
    const r = await runSketch(
      `void fail(int line, String text) {
  Serial.print("Line ");
  Serial.print(line);
  Serial.print(": ");
  Serial.println(text);
  Serial.flush();
  abort();
}

void setup() {
  Serial.begin(9600);
  Serial.println("before");
  fail(12, "IndexError: list index out of range");
  Serial.println("after");
}

void loop() {
  Serial.println("loop");
}
`,
      { stopAfterMs: 1000 },
    );
    // the board prints the same two lines, then halts in abort() (cli + rjmp .)
    expect(r.serial).toBe('before\r\nLine 12: IndexError: list index out of range\r\n');
    expect(r.status).toBe('error');
    expect(r.console).toEqual([{ level: 'error', text: 'The sketch stopped: abort() was called.', line: 7 }]);
  });
});

describe('rule 4: String(float, n), String + float and dtostrf() format like avr-libc', () => {
  it('prints big values in full (no "ovf"), 8 significant digits, capital NAN/INF and the width of String(x, n)', async () => {
    expect(
      await printed(`
  Serial.println(String(2.5, 0));
  char buf[33];
  dtostrf(-4294967296.0, 4, 2, buf);
  Serial.println(buf);
  Serial.println(String("x") + 5e9);
  Serial.println(String(123.456, 10));
  Serial.println(String(0.0 / 0.0, 2));
  Serial.println(-1.0 / 0.0);
  Serial.println(String(-1.0 / 0.0, 2));
  String t = "T=";
  t += 23.456;
  Serial.println(t);`),
    ).toEqual([' 3', '-4294967300.00', 'x5000000000.00', '123.4560000000', ' NAN', 'inf', '-INF', 'T=23.46']);
  });

  // [IEEE bits, decimals, dtostrf(x, 1, n), String(x, n) ("-": not printed, it overflows String's buffer), Serial.print(x, n)]
  const GOLDEN: [number, number, string, string, string][] = [
  [0x00000000, 0, "0", " 0", "0"],
  [0x00000000, 1, "0.0", "0.0", "0.0"],
  [0x00000000, 2, "0.00", "0.00", "0.00"],
  [0x00000000, 3, "0.000", "0.000", "0.000"],
  [0x00000000, 6, "0.000000", "0.000000", "0.000000"],
  [0x80000000, 0, "-0", "-0", "0"],
  [0x80000000, 1, "-0.0", "-0.0", "0.0"],
  [0x80000000, 2, "-0.00", "-0.00", "0.00"],
  [0x80000000, 3, "-0.000", "-0.000", "0.000"],
  [0x80000000, 6, "-0.000000", "-0.000000", "0.000000"],
  [0x3f000000, 0, "1", " 1", "1"],
  [0x3f000000, 1, "0.5", "0.5", "0.5"],
  [0x3f000000, 2, "0.50", "0.50", "0.50"],
  [0x3f000000, 3, "0.500", "0.500", "0.500"],
  [0x3f000000, 6, "0.500000", "0.500000", "0.500000"],
  [0x3fc00000, 0, "2", " 2", "2"],
  [0x3fc00000, 1, "1.5", "1.5", "1.5"],
  [0x3fc00000, 2, "1.50", "1.50", "1.50"],
  [0x3fc00000, 3, "1.500", "1.500", "1.500"],
  [0x3fc00000, 6, "1.500000", "1.500000", "1.500000"],
  [0x40200000, 0, "3", " 3", "3"],
  [0x40200000, 1, "2.5", "2.5", "2.5"],
  [0x40200000, 2, "2.50", "2.50", "2.50"],
  [0x40200000, 3, "2.500", "2.500", "2.500"],
  [0x40200000, 6, "2.500000", "2.500000", "2.500000"],
  [0xc0200000, 0, "-3", "-3", "-3"],
  [0xc0200000, 1, "-2.5", "-2.5", "-2.5"],
  [0xc0200000, 2, "-2.50", "-2.50", "-2.50"],
  [0xc0200000, 3, "-2.500", "-2.500", "-2.500"],
  [0xc0200000, 6, "-2.500000", "-2.500000", "-2.500000"],
  [0x3e000000, 0, "0", " 0", "0"],
  [0x3e000000, 1, "0.1", "0.1", "0.1"],
  [0x3e000000, 2, "0.13", "0.13", "0.12"],
  [0x3e000000, 3, "0.125", "0.125", "0.125"],
  [0x3e000000, 6, "0.125000", "0.125000", "0.125000"],
  [0x42c7fd71, 0, "100", "100", "100"],
  [0x42c7fd71, 1, "100.0", "100.0", "100.0"],
  [0x42c7fd71, 2, "100.00", "100.00", "100.00"],
  [0x42c7fd71, 3, "99.995", "99.995", "99.995"],
  [0x42c7fd71, 6, "99.995003", "99.995003", "99.995002"],
  [0x411fffff, 0, "10", "10", "10"],
  [0x411fffff, 1, "10.0", "10.0", "10.0"],
  [0x411fffff, 2, "10.00", "10.00", "10.00"],
  [0x411fffff, 3, "10.000", "10.000", "10.000"],
  [0x411fffff, 6, "9.999999", "9.999999", "10.000000"],
  [0x501502f9, 0, "10000000000", "10000000000", "ovf"],
  [0x501502f9, 1, "10000000000.0", "10000000000.0", "ovf"],
  [0x501502f9, 2, "10000000000.00", "10000000000.00", "ovf"],
  [0x501502f9, 3, "10000000000.000", "10000000000.000", "ovf"],
  [0x501502f9, 6, "10000000000.000000", "10000000000.000000", "ovf"],
  [0x4f800000, 0, "4294967300", "4294967300", "ovf"],
  [0x4f800000, 1, "4294967300.0", "4294967300.0", "ovf"],
  [0x4f800000, 2, "4294967300.00", "4294967300.00", "ovf"],
  [0x4f800000, 3, "4294967300.000", "4294967300.000", "ovf"],
  [0x4f800000, 6, "4294967300.000000", "4294967300.000000", "ovf"],
  [0x4f7fffff, 0, "4294967000", "4294967000", "4294967040"],
  [0x4f7fffff, 1, "4294967000.0", "4294967000.0", "4294967040.0"],
  [0x4f7fffff, 2, "4294967000.00", "4294967000.00", "4294967040.00"],
  [0x4f7fffff, 3, "4294967000.000", "4294967000.000", "4294967040.000"],
  [0x4f7fffff, 6, "4294967000.000000", "4294967000.000000", "4294967040.000000"],
  [0x4ceb79a3, 0, "123456790", "123456790", "123456792"],
  [0x4ceb79a3, 1, "123456790.0", "123456790.0", "123456792.0"],
  [0x4ceb79a3, 2, "123456790.00", "123456790.00", "123456792.00"],
  [0x4ceb79a3, 3, "123456790.000", "123456790.000", "123456792.000"],
  [0x4ceb79a3, 6, "123456790.000000", "123456790.000000", "123456792.000000"],
  [0x3dcccccd, 0, "0", " 0", "0"],
  [0x3dcccccd, 1, "0.1", "0.1", "0.1"],
  [0x3dcccccd, 2, "0.10", "0.10", "0.10"],
  [0x3dcccccd, 3, "0.100", "0.100", "0.100"],
  [0x3dcccccd, 6, "0.100000", "0.100000", "0.100000"],
  [0x3eaaaaab, 0, "0", " 0", "0"],
  [0x3eaaaaab, 1, "0.3", "0.3", "0.3"],
  [0x3eaaaaab, 2, "0.33", "0.33", "0.33"],
  [0x3eaaaaab, 3, "0.333", "0.333", "0.333"],
  [0x3eaaaaab, 6, "0.333333", "0.333333", "0.333333"],
  [0x402b3333, 0, "3", " 3", "3"],
  [0x402b3333, 1, "2.7", "2.7", "2.7"],
  [0x402b3333, 2, "2.67", "2.67", "2.68"],
  [0x402b3333, 3, "2.675", "2.675", "2.675"],
  [0x402b3333, 6, "2.675000", "2.675000", "2.675000"],
  [0x4385c000, 0, "268", "268", "268"],
  [0x4385c000, 1, "267.5", "267.5", "267.5"],
  [0x4385c000, 2, "267.50", "267.50", "267.50"],
  [0x4385c000, 3, "267.500", "267.500", "267.500"],
  [0x4385c000, 6, "267.500000", "267.500000", "267.500000"],
  [0x40490fdb, 0, "3", " 3", "3"],
  [0x40490fdb, 1, "3.1", "3.1", "3.1"],
  [0x40490fdb, 2, "3.14", "3.14", "3.14"],
  [0x40490fdb, 3, "3.142", "3.142", "3.142"],
  [0x40490fdb, 6, "3.141593", "3.141593", "3.141593"],
  [0x2edbe6ff, 0, "0", " 0", "0"],
  [0x2edbe6ff, 1, "0.0", "0.0", "0.0"],
  [0x2edbe6ff, 2, "0.00", "0.00", "0.00"],
  [0x2edbe6ff, 3, "0.000", "0.000", "0.000"],
  [0x2edbe6ff, 6, "0.000000", "0.000000", "0.000000"],
  [0x3900f990, 0, "0", " 0", "0"],
  [0x3900f990, 1, "0.0", "0.0", "0.0"],
  [0x3900f990, 2, "0.00", "0.00", "0.00"],
  [0x3900f990, 3, "0.000", "0.000", "0.000"],
  [0x3900f990, 6, "0.000123", "0.000123", "0.000123"],
  [0x4640e6b6, 0, "12346", "12346", "12346"],
  [0x4640e6b6, 1, "12345.7", "12345.7", "12345.7"],
  [0x4640e6b6, 2, "12345.68", "12345.68", "12345.68"],
  [0x4640e6b6, 3, "12345.678", "12345.678", "12345.678"],
  [0x4640e6b6, 6, "12345.678000", "12345.678000", "12345.677734"],
  [0x7f7fc99e, 0, "340000000000000000000000000000000000000", "-", "ovf"],
  [0x7f7fc99e, 1, "340000000000000000000000000000000000000.0", "-", "ovf"],
  [0x7f7fc99e, 2, "340000000000000000000000000000000000000.00", "-", "ovf"],
  [0x7f7fc99e, 3, "340000000000000000000000000000000000000.000", "-", "ovf"],
  [0xba83126f, 0, "-0", "-0", "-0"],
  [0xba83126f, 1, "-0.0", "-0.0", "-0.0"],
  [0xba83126f, 2, "-0.00", "-0.00", "-0.00"],
  [0xba83126f, 3, "-0.001", "-0.001", "-0.001"],
  [0xba83126f, 6, "-0.001000", "-0.001000", "-0.001000"],
  [0x3d4ccccd, 0, "0", " 0", "0"],
  [0x3d4ccccd, 1, "0.1", "0.1", "0.1"],
  [0x3d4ccccd, 2, "0.05", "0.05", "0.05"],
  [0x3d4ccccd, 3, "0.050", "0.050", "0.050"],
  [0x3d4ccccd, 6, "0.050000", "0.050000", "0.050000"],
  [0x3f7eb852, 0, "1", " 1", "1"],
  [0x3f7eb852, 1, "1.0", "1.0", "1.0"],
  [0x3f7eb852, 2, "1.00", "1.00", "1.00"],
  [0x3f7eb852, 3, "0.995", "0.995", "0.995"],
  [0x3f7eb852, 6, "0.995000", "0.995000", "0.995000"],
  [0x41180000, 0, "10", "10", "10"],
  [0x41180000, 1, "9.5", "9.5", "9.5"],
  [0x41180000, 2, "9.50", "9.50", "9.50"],
  [0x41180000, 3, "9.500", "9.500", "9.500"],
  [0x41180000, 6, "9.500000", "9.500000", "9.500000"],
  [0x3ee66666, 0, "0", " 0", "0"],
  [0x3ee66666, 1, "0.4", "0.4", "0.5"],
  [0x3ee66666, 2, "0.45", "0.45", "0.45"],
  [0x3ee66666, 3, "0.450", "0.450", "0.450"],
  [0x3ee66666, 6, "0.450000", "0.450000", "0.450000"],
  [0x4b800000, 0, "16777216", "16777216", "16777216"],
  [0x4b800000, 1, "16777216.0", "16777216.0", "16777216.0"],
  [0x4b800000, 2, "16777216.00", "16777216.00", "16777216.00"],
  [0x4b800000, 3, "16777216.000", "16777216.000", "16777216.000"],
  [0x4b800000, 6, "16777216.000000", "16777216.000000", "16777216.000000"],
  [0x006ce3ee, 0, "0", " 0", "0"],
  [0x006ce3ee, 1, "0.0", "0.0", "0.0"],
  [0x006ce3ee, 2, "0.00", "0.00", "0.00"],
  [0x006ce3ee, 3, "0.000", "0.000", "0.000"],
  [0x006ce3ee, 6, "0.000000", "0.000000", "0.000000"],
  [0x00000001, 0, "0", " 0", "0"],
  [0x00000001, 1, "0.0", "0.0", "0.0"],
  [0x00000001, 2, "0.00", "0.00", "0.00"],
  [0x00000001, 3, "0.000", "0.000", "0.000"],
  [0x00000001, 6, "0.000000", "0.000000", "0.000000"],
  [0x7fc00000, 0, "NAN", "NAN", "nan"],
  [0x7fc00000, 1, "NAN", "NAN", "nan"],
  [0x7fc00000, 2, "NAN", " NAN", "nan"],
  [0x7fc00000, 3, "NAN", "  NAN", "nan"],
  [0x7fc00000, 6, "NAN", "     NAN", "nan"],
  [0x7f800000, 0, "INF", "-", "inf"],
  [0x7f800000, 1, "INF", "-", "inf"],
  [0x7f800000, 2, "INF", "-", "inf"],
  [0x7f800000, 3, "INF", "-", "inf"],
  [0xff800000, 0, "-INF", "-", "inf"],
  [0xff800000, 1, "-INF", "-", "inf"],
  [0xff800000, 2, "-INF", "-", "inf"],
  [0xff800000, 3, "-INF", "-", "inf"],
  [0xbf80a3d7, 0, "-1", "-1", "-1"],
  [0xbf80a3d7, 1, "-1.0", "-1.0", "-1.0"],
  [0xbf80a3d7, 2, "-1.00", "-1.00", "-1.00"],
  [0xbf80a3d7, 3, "-1.005", "-1.005", "-1.005"],
  [0xbf80a3d7, 6, "-1.005000", "-1.005000", "-1.005000"],
  [0x41bb3333, 0, "23", "23", "23"],
  [0x41bb3333, 1, "23.4", "23.4", "23.4"],
  [0x41bb3333, 2, "23.40", "23.40", "23.40"],
  [0x41bb3333, 3, "23.400", "23.400", "23.400"],
  [0x41bb3333, 6, "23.400000", "23.400000", "23.399999"],
  [0x4996b438, 0, "1234567", "1234567", "1234567"],
  [0x4996b438, 1, "1234567.0", "1234567.0", "1234567.0"],
  [0x4996b438, 2, "1234567.00", "1234567.00", "1234567.00"],
  [0x4996b438, 3, "1234567.000", "1234567.000", "1234567.000"],
  [0x4996b438, 6, "1234567.000000", "1234567.000000", "1234567.000000"],
  [0x4b189680, 0, "10000000", "10000000", "10000000"],
  [0x4b189680, 1, "10000000.0", "10000000.0", "10000000.0"],
  [0x4b189680, 2, "10000000.00", "10000000.00", "10000000.00"],
  [0x4b189680, 3, "10000000.000", "10000000.000", "10000000.000"],
  [0x4b189680, 6, "10000000.000000", "10000000.000000", "10000000.000000"],
  [0x3f7ffffe, 0, "1", " 1", "1"],
  [0x3f7ffffe, 1, "1.0", "1.0", "1.0"],
  [0x3f7ffffe, 2, "1.00", "1.00", "1.00"],
  [0x3f7ffffe, 3, "1.000", "1.000", "1.000"],
  [0x3f7ffffe, 6, "1.000000", "1.000000", "1.000000"],
  [0x47c34fff, 0, "100000", "100000", "100000"],
  [0x47c34fff, 1, "100000.0", "100000.0", "100000.0"],
  [0x47c34fff, 2, "99999.99", "99999.99", "100000.00"],
  [0x47c34fff, 3, "99999.992", "99999.992", "99999.992"],
  [0x47c34fff, 6, "99999.992000", "99999.992000", "99999.992187"],
  [0x36fba882, 0, "0", " 0", "0"],
  [0x36fba882, 1, "0.0", "0.0", "0.0"],
  [0x36fba882, 2, "0.00", "0.00", "0.00"],
  [0x36fba882, 3, "0.000", "0.000", "0.000"],
  [0x36fba882, 6, "0.000007", "0.000007", "0.000007"],
  [0xc3889333, 0, "-273", "-273", "-273"],
  [0xc3889333, 1, "-273.1", "-273.1", "-273.1"],
  [0xc3889333, 2, "-273.15", "-273.15", "-273.15"],
  [0xc3889333, 3, "-273.150", "-273.150", "-273.150"],
  [0xc3889333, 6, "-273.149990", "-273.149990", "-273.149993"],
  [0x447d5000, 0, "1013", "1013", "1013"],
  [0x447d5000, 1, "1013.3", "1013.3", "1013.2"],
  [0x447d5000, 2, "1013.25", "1013.25", "1013.25"],
  [0x447d5000, 3, "1013.250", "1013.250", "1013.250"],
  [0x447d5000, 6, "1013.250000", "1013.250000", "1013.250000"],
  ];

  it('dtostrf(), String(x, n) and Serial.print(x, n) match the chip on the golden values', () => {
    for (const [bits, n, fixed, string, print] of GOLDEN) {
      const x = floatOf(bits);
      const label = `0x${bits.toString(16)} (${x}), ${n} decimals`;
      expect(dtostrf(x, 1, n), label).toBe(fixed);
      if (string !== '-') expect(arduinoString(new FloatBox(x), n), label).toBe(string);
      expect(printFloat(x, n), label).toBe(print);
    }
  });

  it('dtostrf() pads to the width on the left, or on the right for a negative width', () => {
    expect(dtostrf(3.14159, 8, 3)).toBe('   3.142');
    expect(dtostrf(3.14159, -8, 3)).toBe('3.142   ');
    expect(dtostrf(-3.14159, 2, 0)).toBe('-3');
  });
});

describe('shifts by a count known only while running, and a[i] op= v with an index that has effects', () => {
  it('shift like avr-gcc: a loop on the count\'s low byte, 1..128 steps (32 or more give 0 or -1; 0, 129..255 and -1 do not shift)', async () => {
    const lines = await printed(
      `  for (int k = 0; k < 16; k++) {
    long n = counts[k];
    long a = 1;
    long b = -1024;
    unsigned long u = 0x80000000UL;
    int i = 1;
    int j = -1024;
    unsigned int w = 0x8000;
    Serial.print(n); Serial.print(' ');
    Serial.print(a << n); Serial.print(' ');
    Serial.print(b >> n); Serial.print(' ');
    Serial.print(u >> n); Serial.print(' ');
    Serial.print(i << n); Serial.print(' ');
    Serial.print(j >> n); Serial.print(' ');
    Serial.println(w >> n);
  }`,
      'long counts[] = {0, 1, 15, 16, 17, 31, 32, 33, 40, 128, 129, 255, 256, 257, 300, -1};',
    );
    // n, long 1 << n, long -1024 >> n, unsigned long 0x80000000 >> n, int 1 << n, int -1024 >> n, unsigned int 0x8000 >> n
    expect(lines).toEqual([
      '0 1 -1024 2147483648 1 -1024 32768',
      '1 2 -512 1073741824 2 -512 16384',
      '15 32768 -1 65536 -32768 -1 1',
      '16 65536 -1 32768 0 -1 0',
      '17 131072 -1 16384 0 -1 0',
      '31 -2147483648 -1 1 0 -1 0',
      '32 0 -1 0 0 -1 0',
      '33 0 -1 0 0 -1 0',
      '40 0 -1 0 0 -1 0',
      '128 0 -1 0 0 -1 0',
      '129 1 -1024 2147483648 1 -1024 32768',
      '255 1 -1024 2147483648 1 -1024 32768',
      '256 1 -1024 2147483648 1 -1024 32768',
      '257 2 -512 1073741824 2 -512 16384',
      '300 0 -1 0 0 -1 0',
      '-1 1 -1024 2147483648 1 -1024 32768',
    ]);
  });

  it('a[next()] += 5 and a[next()]++ call next() once each; a[true] is a[1]', async () => {
    const lines = await printed(
      '  int v[3] = {0, 0, 0};\n  v[nextIndex()] += 5;\n  v[nextIndex()]++;\n  bool t = true;\n  Serial.print(v[1]); Serial.print(\' \'); Serial.print(calls); Serial.print(\' \'); Serial.println(v[t]);',
      'int calls = 0;\nint nextIndex() { calls++; return 1; }',
    );
    expect(lines).toEqual(['6 2 6']);
  });
});

describe('rule 5: float literals with an exponent', () => {
  it('3.4e38 and 1e21 transpile and run', async () => {
    expect(
      await printed(`
  float big = 3.4e38;
  Serial.println(big > 1e38);
  Serial.println(String(big / 1e30, 1));
  Serial.println(1e21 > 1e20);
  Serial.println(1e39 > 3.4e38);`),
    ).toEqual(['1', '340000000.0', '1', '1']);
  });
});

describe('text with an embedded NUL ends at the NUL, like a C string on the board', () => {
  it('print, String(...), + and strlen read a literal up to its NUL; String((char)0) is empty', async () => {
    expect(
      await printed(`
  Serial.println("ab\\0cd");
  Serial.print("x\\0y");
  Serial.println();
  Serial.println("\\0" "1");
  String s = "ab\\0cd";
  Serial.println(s);
  Serial.println(s.length());
  Serial.println(String("x") + "a\\0b");
  Serial.println(strlen("ab\\0cd"));
  Serial.println(String((char)0).length());
  Serial.println(String("ab") + String((char)0) + "c");
  Serial.write("ab\\0cd");
  Serial.println();`),
    ).toEqual(['ab', 'x', '', 'ab', '2', 'xa', '2', '0', 'abc', 'ab']);
  });

  it('a String keeps a NUL added as a char; write(literal, n) and char s[] = "…" keep the bytes after it', async () => {
    expect(
      await printed(`
  String t = "a";
  t += '\\0';
  t += "b";
  Serial.println(t);
  Serial.println(t.length());
  Serial.write("ab\\0cd", 5);
  Serial.println();
  Serial.print('\\0');
  Serial.println();
  char buf[] = "ab\\0cd";
  Serial.println(sizeof(buf));
  Serial.println(buf);`),
    ).toEqual(['a\0b', '3', 'ab\0cd', '\0', '6', 'ab']);
  });

  it('the LCD prints a literal up to its NUL too', async () => {
    const r = await runSketch(
      '#include <Wire.h>\n#include <LiquidCrystal_I2C.h>\nLiquidCrystal_I2C lcd(0x27, 16, 2);\nvoid setup() {\n  lcd.init();\n  lcd.backlight();\n  lcd.print("ab\\0cd");\n  lcd.setCursor(0, 1);\n  lcd.print(String("x") + "y\\0z");\n}\nvoid loop() {}\n',
      { stopAfterMs: 200, maxLoops: 1 },
    );
    expect(r.board.lcd.state.chars.map((row) => String.fromCharCode(...row).trimEnd())).toEqual(['ab', 'xy']);
  });
});
