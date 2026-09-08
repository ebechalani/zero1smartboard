import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transpile } from '../src/transpiler';
import type { SketchModule } from '../src/types';

const EXAMPLES_DIR = join(__dirname, '..', 'src', 'examples');

// ---------------------------------------------------------------------------
// A minimal fake runtime (docs/ARCHITECTURE.md §5.3 helpers + a few API stubs)
// ---------------------------------------------------------------------------

class FloatBox {
  constructor(public readonly value: number) {}
  valueOf(): number {
    return this.value;
  }
}

function num(x: unknown): number {
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (x instanceof FloatBox) return x.value;
  if (typeof x === 'string') return Number(x) || 0;
  return 0;
}

function fmt(v: unknown): string {
  if (v instanceof FloatBox) return v.value.toFixed(2);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Array.isArray(v)) return cstr(v);
  return String(v);
}

function cstr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return String(v ?? '');
  let s = '';
  for (const c of v) {
    if (c === 0) break;
    s += String.fromCharCode(c as number);
  }
  return s;
}

/** Arduino print(value[, format]) on the fake runtime. */
function printArgs(a: unknown[]): string {
  if (a.length === 2 && typeof a[1] === 'number') {
    if (a[0] instanceof FloatBox) return a[0].value.toFixed(a[1]);
    if (typeof a[0] === 'number') return a[0].toString(a[1]).toUpperCase();
  }
  return a.map(fmt).join('');
}

interface FakeRuntime {
  rt: Record<string, unknown>;
  writes: [number, number][];
  modes: [number, number][];
  serial: string[];
  calls: string[];
}

function makeRuntime(extra: Record<string, unknown> = {}): FakeRuntime {
  const writes: [number, number][] = [];
  const modes: [number, number][] = [];
  const serial: string[] = [];
  const calls: string[] = [];
  let now = 0;
  const strMethods: Record<string, (s: string, ...args: unknown[]) => unknown> = {
    length: (s) => s.length,
    charAt: (s, i) => s.charCodeAt(num(i)) || 0,
    substring: (s, a, b) => s.substring(num(a), b === undefined ? undefined : num(b)),
    toInt: (s) => parseInt(s, 10) || 0,
    toFloat: (s) => parseFloat(s) || 0,
    equals: (s, o) => s === o,
    indexOf: (s, o) => s.indexOf(typeof o === 'number' ? String.fromCharCode(o) : String(o)),
  };
  const api: Record<string, unknown> = {
    __i8: (x: unknown) => (num(x) << 24) >> 24,
    __u8: (x: unknown) => num(x) & 0xff,
    __i16: (x: unknown) => (num(x) << 16) >> 16,
    __u16: (x: unknown) => num(x) & 0xffff,
    __i32: (x: unknown) => num(x) | 0,
    __u32: (x: unknown) => num(x) >>> 0,
    __f32: (x: unknown) => Math.fround(num(x)),
    __bool: (x: unknown) => (typeof x === 'string' ? true : !!num(x)),
    __idiv: (a: unknown, b: unknown) => {
      if (num(b) === 0) throw new Error('division by zero');
      return Math.trunc(num(a) / num(b));
    },
    __imod: (a: unknown, b: unknown) => {
      if (num(b) === 0) throw new Error('division by zero');
      return num(a) % num(b);
    },
    __tick: async () => {},
    __array: (dims: number[], fill: unknown): unknown[] => {
      const build = (d: number): unknown[] => Array.from({ length: dims[d]! }, () => (d === dims.length - 1 ? fill : build(d + 1)));
      return build(0);
    },
    __cstr: cstr,
    __chr: (x: unknown) => (typeof x === 'number' ? String.fromCharCode(x & 0xff) : x),
    __flt: (x: unknown) => (typeof x === 'number' ? new FloatBox(x) : x),
    __str: (v: unknown, kind: string) => {
      if (kind === 'char') return String.fromCharCode(num(v));
      if (kind === 'float') return num(v).toFixed(2);
      if (kind === 'bool') return num(v) ? '1' : '0';
      if (typeof v === 'string') return v;
      return String(v);
    },
    __m: (obj: unknown, name: string, args: unknown[]) => {
      if (typeof obj === 'string') {
        const m = strMethods[name];
        if (!m) throw new Error(`no string method ${name}`);
        return m(obj, ...args);
      }
      const target = obj as Record<string, (...a: unknown[]) => unknown>;
      if (typeof target[name] !== 'function') throw new Error(`'${name}' is not a member`);
      return target[name]!(...args);
    },
    __mut: (s: string, name: string, args: unknown[]) => {
      switch (name) {
        case 'toUpperCase':
          return s.toUpperCase();
        case 'toLowerCase':
          return s.toLowerCase();
        case 'trim':
          return s.trim();
        case 'concat':
          return s + fmt(args[0]);
        default:
          throw new Error(`no mutator ${name}`);
      }
    },
    __charAt: (s: string, i: unknown) => s.charCodeAt(num(i)) || 0,
    HIGH: 1,
    LOW: 0,
    INPUT: 0,
    OUTPUT: 1,
    INPUT_PULLUP: 2,
    A0: 14,
    A1: 15,
    A2: 16,
    A3: 17,
    LED_BUILTIN: 13,
    HEX: 16,
    MSBFIRST: 1,
    PI: Math.PI,
    pinMode: (p: unknown, m: unknown) => {
      modes.push([num(p), num(m)]);
    },
    digitalWrite: (p: unknown, v: unknown) => {
      writes.push([num(p), num(v)]);
    },
    digitalRead: () => 1,
    analogRead: () => 512,
    analogWrite: (p: unknown, v: unknown) => {
      writes.push([num(p), num(v)]);
    },
    delay: async (ms: unknown) => {
      now += num(ms);
    },
    millis: () => now,
    map: (x: unknown, a: unknown, b: unknown, c: unknown, d: unknown) => Math.trunc(((num(x) - num(a)) * (num(d) - num(c))) / (num(b) - num(a))) + num(c),
    abs: (x: unknown) => Math.abs(num(x)),
    String: (v: unknown, arg?: unknown) => {
      if (v instanceof FloatBox) return v.value.toFixed(arg === undefined ? 2 : num(arg));
      if (typeof v === 'number' && arg !== undefined) return v.toString(num(arg)).toUpperCase();
      return fmt(v);
    },
    Serial: {
      begin: () => calls.push('Serial.begin'),
      print: (...a: unknown[]) => {
        serial.push(printArgs(a));
        return 1;
      },
      println: (...a: unknown[]) => {
        serial.push(printArgs(a) + '\n');
        return 1;
      },
      available: () => 0,
    },
    Servo: class {
      pin = -1;
      angle = 0;
      attach(p: unknown) {
        this.pin = num(p);
        calls.push(`servo.attach(${this.pin})`);
      }
      write(a: unknown) {
        this.angle = num(a);
        calls.push(`servo.write(${this.angle})`);
      }
      read() {
        return this.angle;
      }
    },
    ...extra,
  };
  const rt = new Proxy(api, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in target) return target[key];
      if (key === 'then' || key.startsWith('__')) return undefined;
      throw new ReferenceError(`'${key}' was not declared in this scope`);
    },
  });
  return { rt, writes, modes, serial, calls };
}

async function run(source: string, loops = 1, extra?: Record<string, unknown>): Promise<FakeRuntime & { mod: SketchModule; js: string; warnings: string[] }> {
  const result = transpile(source);
  if (!result.ok) throw new Error(`transpile failed: ${result.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join('; ')}`);
  const fake = makeRuntime(extra);
  const factory = new Function('__rt', result.js) as (rt: unknown) => Promise<SketchModule>;
  const mod = await factory(fake.rt);
  await mod.setup();
  for (let i = 0; i < loops; i++) await mod.loop();
  return { ...fake, mod, js: result.js, warnings: result.warnings.map((w) => w.message) };
}

function errorOf(source: string): { line: number; column: number; message: string } {
  const r = transpile(source);
  if (r.ok) throw new Error('expected a transpile error');
  return r.errors[0]!;
}

const LOOP = 'void loop() {}';

// ---------------------------------------------------------------------------

describe('codegen: integer semantics', () => {
  it('integer division and float division', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        int a = 7 / 2;
        float b = 7.0 / 2;
        float ratio = analogRead(A3) / 1023;
        float ratio2 = analogRead(A3) / 1023.0;
        Serial.println(a); Serial.println(b); Serial.println(ratio); Serial.println(ratio2);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['3\n', '3.50\n', '0.00\n', '0.50\n']);
  });

  it('wraps int, byte and unsigned long like the AVR', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        int big = 32767; big = big + 1;
        byte b = 255; b++;
        unsigned int u = 0; u = u - 1;
        unsigned long start = 0;
        unsigned long elapsed = millis() - start;
        long l = 2147483647; l += 1;
        Serial.println(big); Serial.println(b); Serial.println(u); Serial.println(elapsed); Serial.println(l);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['-32768\n', '0\n', '65535\n', '0\n', '-2147483648\n']);
  });

  it('postfix and prefix increments', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        int x = 5;
        int y = x++;
        int z = ++x;
        byte c = 255;
        int w = c++;
        Serial.println(x); Serial.println(y); Serial.println(z); Serial.println(c); Serial.println(w);
        x--; --x;
        Serial.println(x);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['7\n', '5\n', '7\n', '0\n', '255\n', '5\n']);
  });

  it('compound assignment wraps and uses integer division', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        int x = 30000; x += 10000;
        int d = 9; d /= 2;
        byte b = 200; b *= 2;
        int m = 17; m %= 5;
        Serial.println(x); Serial.println(d); Serial.println(b); Serial.println(m);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['-25536\n', '4\n', '144\n', '2\n']);
  });

  it('casts truncate toward zero and fold constants', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        float f = 3.7;
        int i = (int) f;
        int j = int(-3.7);
        byte k = (byte) 300;
        float half = (float) 1 / 2;
        Serial.println(i); Serial.println(j); Serial.println(k); Serial.println(half);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['3\n', '-3\n', '44\n', '0.50\n']);
  });

  it('logical operators produce booleans printed as 1/0', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        int a = 5, b = 7;
        int c = a && b;
        bool d = !a;
        Serial.println(c); Serial.println(d); Serial.println(a > 3);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['1\n', '0\n', '1\n']);
  });

  it('division by zero is reported', async () => {
    await expect(run(`void setup() { int z = 0; int x = 5 / z; } ${LOOP}`)).rejects.toThrow(/division by zero/);
  });
});

describe('codegen: chars and strings', () => {
  it('chars are numbers but print as characters', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        char c = 'a';
        char d = c + 1;
        Serial.print(c); Serial.print(d); Serial.println('!');
        Serial.println(d == 'b');
        Serial.println(c - 'a');
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['a', 'b', '!\n', '1\n', '0\n']);
  });

  it('float arguments to print are boxed', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        float t = 3.0;
        Serial.println(t);
        Serial.println(t, 1);
        Serial.println(2.5 * 2);
        int n = 3;
        Serial.println(n);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['3.00\n', '3.0\n', '5.00\n', '3\n']);
  });

  it('String concatenation converts by static type', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        int n = 42; float f = 1.5; char c = 'x'; bool ok = true;
        String s = "n=" + String(n);
        s = s + " f=" + f + " c=" + c + " ok=" + ok;
        String t = 5;
        Serial.println(s); Serial.println(t);
        Serial.println(s.length());
        Serial.println(s == "nope");
        String u = "abc";
        Serial.println(u == "abc");
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['n=42 f=1.50 c=x ok=1\n', '5\n', '20\n', '0\n', '1\n']);
  });

  it('String methods, mutators and indexing', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        String s = "hello";
        s.toUpperCase();
        Serial.println(s);
        Serial.println(s.substring(1, 3));
        Serial.println(s[0] == 'H');
        Serial.println(s.charAt(1) == 'E');
        String num = "42abc";
        int v = num.toInt();
        Serial.println(v + 1);
        s.concat(7);
        Serial.println(s);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['HELLO\n', 'EL\n', '1\n', '1\n', '43\n', 'HELLO7\n']);
  });

  it('char arrays become code arrays and print as text', async () => {
    const r = await run(`
      char name[] = "hi";
      char buf[6] = "ab";
      void setup() {
        Serial.begin(9600);
        Serial.println(name);
        Serial.println(sizeof(name));
        Serial.println(sizeof(buf));
        Serial.println(name[1] == 'i');
        String s = "say ";
        s = s + name;
        Serial.println(s);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['hi\n', '3\n', '6\n', '1\n', 'say hi\n']);
    expect(r.js).toContain('let name = [104, 105, 0];');
    expect(r.js).toContain('let buf = [97, 98, 0, 0, 0, 0];');
  });

  it('warns about pointer arithmetic on string literals', async () => {
    const r = await run(`void setup() { Serial.begin(9600); int x = 3; Serial.println("value: " + x); } ${LOOP}`);
    expect(r.warnings.some((w) => /pointer arithmetic/.test(w))).toBe(true);
  });
});

describe('codegen: arrays, sizeof, switch, statics, defines, enums', () => {
  it('arrays with initialisers and the sizeof length idiom', async () => {
    const r = await run(`
      byte digits[] = {0x3F, 0x06, 0x5B};
      int grid[2][3] = {{1, 2, 3}, {4, 5}};
      int empty[4];
      void setup() {
        Serial.begin(9600);
        int count = sizeof(digits) / sizeof(digits[0]);
        Serial.println(count);
        Serial.println(sizeof(grid) / sizeof(grid[0]));
        Serial.println(grid[1][2]);
        Serial.println(empty[3]);
        grid[0][0] = 70000;
        Serial.println(grid[0][0]);
        for (int i = 0; i < count; i++) Serial.print(digits[i], HEX);
        Serial.println();
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['3\n', '2\n', '0\n', '0\n', '4464\n', '3F', '6', '5B', '\n']);
  });

  it('switch with char cases and fallthrough', async () => {
    const r = await run(`
      void check(char c) {
        switch (c) {
          case 'a': Serial.print("A"); break;
          case 'b':
          case 'c': Serial.print("BC"); break;
          default: Serial.print("?");
        }
      }
      void setup() { Serial.begin(9600); check('a'); check('c'); check('z'); }
      ${LOOP}`);
    expect(r.serial.join('')).toBe('ABC?');
  });

  it('static locals persist across calls', async () => {
    const r = await run(`
      int counter() { static int n = 0; n++; return n; }
      void setup() { Serial.begin(9600); counter(); counter(); Serial.println(counter()); }
      ${LOOP}`);
    expect(r.serial).toEqual(['3\n']);
  });

  it('#define and enum constants', async () => {
    const r = await run(`
      #define LED_PIN A1
      #define DELAY_MS 250
      #define VERBOSE
      enum Mode { OFF, ON = 5, AUTO };
      Mode mode = AUTO;
      void setup() {
        Serial.begin(9600);
        pinMode(LED_PIN, OUTPUT);
        digitalWrite(LED_PIN, HIGH);
        delay(DELAY_MS);
        Serial.println(mode);
        Serial.println(VERBOSE);
        Serial.println(millis());
      }
      ${LOOP}`);
    expect(r.modes).toEqual([[15, 1]]);
    expect(r.writes).toEqual([[15, 1]]);
    expect(r.serial).toEqual(['6\n', '1\n', '250\n']);
  });

  it('bitSet / bitClear on a byte variable', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        byte b = 0;
        bitSet(b, 7);
        bitSet(b, 0);
        bitClear(b, 0);
        bitWrite(b, 1, 1);
        Serial.println(b);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['130\n']);
  });
});

describe('codegen: functions and identifiers', () => {
  it('functions defined after use with parameter coercion and return coercion', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        Serial.println(twice(40000));
        Serial.println(half(7));
        blink(2);
      }
      ${LOOP}
      int twice(int x) { return x * 2; }
      float half(int x) { return x / 2.0; }
      void blink(int times) {
        for (int i = 0; i < times; i++) { digitalWrite(13, HIGH); digitalWrite(13, LOW); }
      }`);
    expect(r.serial).toEqual(['14464\n', '3.50\n']);
    expect(r.writes).toEqual([[13, 1], [13, 0], [13, 1], [13, 0]]);
  });

  it('runtime calls pass through __rt and library objects are constructed with new', async () => {
    const r = await run(`
      #include <Servo.h>
      Servo myServo;
      void setup() { myServo.attach(4); myServo.write(map(512, 0, 1023, 0, 180)); }
      ${LOOP}`);
    expect(r.calls).toEqual(['servo.attach(4)', 'servo.write(90)']);
    expect(r.js).toContain('new __rt.Servo()');
    expect(r.js).toContain('__rt.map(');
  });

  it('JS reserved words are usable as variable names', async () => {
    const r = await run(`
      void setup() {
        Serial.begin(9600);
        int yield = 1; int await = 2; int function = 3; int var = 4; int let = 5; int arguments = 6;
        Serial.println(yield + await + function + var + let + arguments);
      }
      ${LOOP}`);
    expect(r.serial).toEqual(['21\n']);
  });

  it('serialEvent is exported when defined', async () => {
    const r = await run(`void setup() {} ${LOOP} void serialEvent() { Serial.println("x"); }`);
    expect(typeof r.mod.serialEvent).toBe('function');
    const r2 = await run(`void setup() {} ${LOOP}`);
    expect(r2.mod.serialEvent).toBeUndefined();
  });

  it('inserts __tick at function entries and loop heads', async () => {
    const r = await run(`void setup() { while (false) {} for (;;) { break; } do {} while (false); } ${LOOP}`);
    expect(r.js.match(/await __tick\(\);/g)?.length).toBe(5);
  });
});

describe('codegen: errors and warnings', () => {
  it('requires setup and loop', () => {
    expect(errorOf('void setup() {}').message).toMatch(/setup\(\) and void loop\(\)/);
  });

  it('rejects pointers with a position', () => {
    const e = errorOf(`int* p;\nvoid setup() {}\n${LOOP}`);
    expect(e.message).toMatch(/pointers are not supported/);
    expect(e.line).toBe(1);
  });

  it('reports undeclared identifiers like the Arduino compiler', () => {
    const e = errorOf(`void setup() {\n  digitalWrite(ledPin, HIGH);\n}\n${LOOP}`);
    expect(e.message).toBe("'ledPin' was not declared in this scope");
    expect(e.line).toBe(2);
    expect(e.column).toBe(16);
    expect(errorOf(`void setup() { digitalWrit(13, 1); } ${LOOP}`).message).toBe("'digitalWrit' was not declared in this scope");
  });

  it('reports wrong argument counts, duplicate functions, const assignment', () => {
    expect(errorOf(`void f(int a) {} void setup() { f(); } ${LOOP}`).message).toMatch(/expects 1 argument but 0 were given/);
    expect(errorOf(`void setup() {} void setup() {} ${LOOP}`).message).toMatch(/defined twice/);
    expect(errorOf(`const int N = 5; void setup() { N = 6; } ${LOOP}`).message).toMatch(/read-only/);
    expect(errorOf(`void setup() { int a[3], b[3]; a = b; } ${LOOP}`).message).toMatch(/arrays cannot be assigned/);
  });

  it('warns about == statements, analogWrite on non-PWM pins and missing Serial.begin', async () => {
    const r = await run(`
      void setup() {
        int x = 1;
        x == 5;
        analogWrite(A1, 200);
        analogWrite(9, 200);
        Serial.println(x);
      }
      ${LOOP}`);
    expect(r.warnings.some((w) => /did you mean '='/.test(w))).toBe(true);
    expect(r.warnings.filter((w) => /analogWrite/.test(w))).toHaveLength(1);
    expect(r.warnings.some((w) => /Serial\.begin\(9600\) is never called/.test(w))).toBe(true);
  });

  it('produces a line map that points statements back to the source', () => {
    const src = `void setup() {\n  int a = 1;\n  digitalWrite(13, HIGH);\n}\nvoid loop() {\n}`;
    const r = transpile(src);
    if (!r.ok) throw new Error('transpile failed');
    const lines = r.js.split('\n');
    expect(r.lineMap).toHaveLength(lines.length);
    const idx = lines.findIndex((l) => l.includes('__rt.digitalWrite(13'));
    expect(r.lineMap[idx]).toBe(3);
  });
});

describe('codegen: example sketches', () => {
  for (const f of readdirSync(EXAMPLES_DIR).filter((x) => x.endsWith('.ino'))) {
    it(`transpiles ${f}`, () => {
      const r = transpile(readFileSync(join(EXAMPLES_DIR, f), 'utf8'));
      if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join('; '));
      expect(() => new Function('__rt', r.js)).not.toThrow();
      expect(r.warnings.filter((w) => !/analogWrite/.test(w.message))).toEqual([]);
    });
  }
});
