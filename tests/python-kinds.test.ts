/**
 * Kinds of Python mode (docs/PYTHON.md §2.5, §2.6, §2.9, §2.10, §3.6, §10.2): literal and
 * operator kinds, the combining rules and their warnings and errors, parameters from call sites,
 * return kinds, recursion, lists (element kinds, fixed / growable, capacity), colours, constants,
 * board objects, and what calls and attributes are.
 */
import { describe, expect, it } from 'vitest';
import type { Assign, Call, Expr, Stmt } from '../src/python/ast';
import { pythonToArduino } from '../src/python';
import { analyzeFlow } from '../src/python/flow';
import { combineKinds, elementOf, infer, pythonType, type Kind } from '../src/python/kinds';
import { parseSource } from '../src/python/parser';
import { resolve } from '../src/python/scope';

const program = (source: string) => {
  const resolved = resolve(parseSource(source), source);
  const flow = analyzeFlow(resolved);
  const typing = infer(resolved, flow);
  return { resolved, flow, typing };
};
const codes = (source: string) => pythonToArduino(source).diagnostics.filter((d) => d.code !== 'X-internal').map((d) => `${d.code}@${d.line}`);
/** The kind of `<expr>` in `x = <expr>` on the last line of `source`. */
const kind = (setup: string, e: string): Kind | null => {
  const src = `${setup}${setup && !setup.endsWith('\n') ? '\n' : ''}x = ${e}\n`;
  const { resolved, typing } = program(src);
  const last = resolved.body[resolved.body.length - 1] as Assign;
  return typing.kindOf(last.value);
};
const varKinds = (source: string) => program(source).typing.variables.map((v) => [v.sym.name, v.kind]);

describe('expression kinds (§2.5, §2.9)', () => {
  it('literals', () => {
    expect([kind('', '1'), kind('', '1.5'), kind('', 'True'), kind('', '"a"'), kind('', 'f"{1}"'), kind('', '(1, 2, 3)'), kind('', '[1, 2]'), kind('', '[0.5] * 3')]).toEqual([
      'int', 'float', 'bool', 'str', 'str', 'color', 'list<int>', 'list<float>',
    ]);
  });
  it('+ - * give int for ints and bools, float otherwise; / is always float', () => {
    expect([kind('', '1 + 2'), kind('', 'True + 1'), kind('', '1 * 2.0'), kind('', '4 / 2'), kind('', '"a" + "b"'), kind('', '"-" * 3')]).toEqual(['int', 'int', 'float', 'float', 'str', 'str']);
  });
  it('// and % keep ints, give float with a float; ** is int unless a float or a negative literal exponent', () => {
    expect([kind('', '7 // 2'), kind('', '7.0 // 2'), kind('', '7 % 2'), kind('', '7.5 % 2')]).toEqual(['int', 'float', 'int', 'float']);
    expect([kind('', '2 ** 3'), kind('', '2 ** -1'), kind('', '2.0 ** 3'), kind('n = 3', '2 ** n')]).toEqual(['int', 'float', 'float', 'int']);
  });
  it('comparisons, and / or / not, in are bool; a conditional expression combines its branches', () => {
    expect([kind('', '1 < 2'), kind('', 'not 1'), kind('', '1 in [1]'), kind('', '1 if True else 2.5')]).toEqual(['bool', 'bool', 'bool', 'float']);
  });
  it('built-ins (§2.6)', () => {
    expect([kind('', 'len("ab")'), kind('', 'int("5")'), kind('', 'float(2)'), kind('', 'str(5)'), kind('', 'bool(1)'), kind('', 'input()')]).toEqual(['int', 'int', 'float', 'str', 'bool', 'str']);
    expect([kind('', 'abs(-2)'), kind('', 'abs(-2.5)'), kind('', 'min(2, 2.5)'), kind('', 'max(1, 2)'), kind('', 'round(2.5)'), kind('', 'round(2.567, 2)')]).toEqual(['int', 'float', 'float', 'int', 'int', 'float']);
    expect([kind('', 'pow(2, 3)'), kind('', 'chr(65)'), kind('', 'ord("A")'), kind('l = [1.5, 2.5]', 'sum(l)'), kind('l = [1, 2]', 'max(l)')]).toEqual(['int', 'str', 'int', 'float', 'int']);
  });
  it('the API table (§3) and text methods (§2.7)', () => {
    const imports = 'import time, math, random\nfrom machine import ADC, Pin\nadc = ADC(17)\np = Pin(6, Pin.IN)';
    expect([kind(imports, 'adc.read()'), kind(imports, 'p.value()'), kind(imports, 'time.ticks_ms()'), kind(imports, 'math.sqrt(2)'), kind(imports, 'math.floor(2.5)'), kind(imports, 'math.pi')]).toEqual([
      'int', 'int', 'int', 'float', 'int', 'float',
    ]);
    expect([kind(imports, 'random.randint(1, 6)'), kind(imports, 'random.random()'), kind('import random\nl = ["a"]', 'random.choice(l)'), kind('from micropython import const', 'const(2.5)')]).toEqual(['int', 'float', 'str', 'float']);
    expect([kind('s = "a"', 's.upper()'), kind('s = "a"', 's.startswith("a")'), kind('s = "a"', 's.find("a")'), kind('l = [1]', 'l.pop()')]).toEqual(['str', 'bool', 'int', 'int']);
    expect(kind(imports, 'Pin(13, Pin.OUT)')).toBe('Pin');
  });
  it('a subscript gives the element kind; text gives text', () => {
    expect([kind('l = [1.5]', 'l[0]'), kind('s = "ab"', 's[0]')]).toEqual(['float', 'str']);
  });
  it('combining rules and Python type names', () => {
    expect([combineKinds('bool', 'int'), combineKinds('int', 'float'), combineKinds('str', 'int'), combineKinds('list<int>', 'list<float>'), combineKinds('color', 'int')]).toEqual([
      'int', 'float', null, 'list<float>', null,
    ]);
    expect([pythonType('str'), pythonType('color'), pythonType('list<int>'), pythonType('Pin'), pythonType('none')]).toEqual(['str', 'tuple', 'list', 'Pin', 'NoneType']);
    expect(elementOf('list<Pin>')).toBe('Pin');
  });
});

describe('webs combine kinds (§2.9)', () => {
  it('an int+float web is float; W-int-float only when printed', () => {
    const src = 'x = 0\nwhile True:\n    x = x + 0.5\n';
    expect(varKinds(src)).toEqual([['x', 'float']]);
    expect(codes(src)).toEqual([]);
    expect(codes(`${src}    print(x)\n`)).toEqual(['W-int-float@4']);
    expect(codes(`${src}    print(f"{x}")\n`)).toEqual(['W-int-float@4']);
    expect(codes(`${src}    s = str(x)\n`)).toEqual(['W-int-float@4']);
  });
  it('/= on an int web in a loop widens it', () => {
    expect(varKinds('x = 100\nwhile True:\n    x /= 2\n')).toEqual([['x', 'float']]);
  });
  it('a text+number web is E-retype with both lines', () => {
    expect(codes('x = 5\nwhile True:\n    print(x)\n    x = input()\n')).toEqual(['E-retype@3']);
    expect(pythonToArduino('x = 5\nwhile True:\n    print(x)\n    x = input()\n').diagnostics[0].message).toContain("'x' can be text (line 4) or a number (line 1) on line 3");
  });
});

describe('functions (§2.9)', () => {
  const fnKinds = (source: string) =>
    [...program(source).typing.functions.values()].map((f) => [f.fn.name, f.paramKinds, f.returnKind]);
  it('parameters take the combined kind of the arguments at every call (int, float, text, Pin, list)', () => {
    expect(fnKinds('def f(a):\n    print(a)\nf(1)\nf(2.5)\n')).toEqual([['f', ['float'], 'none']]);
    expect(fnKinds('def f(a):\n    print(a)\nf("x")\n')).toEqual([['f', ['str'], 'none']]);
    expect(fnKinds('from machine import Pin\ndef on(p):\n    p.on()\nled = Pin(15, Pin.OUT)\non(led)\n')).toEqual([['on', ['Pin'], 'none']]);
    expect(fnKinds('def avg(values):\n    return sum(values) / len(values)\nr = [1.5, 2.5]\nprint(avg(r))\n')).toEqual([['avg', ['list<float>'], 'float']]);
    expect(fnKinds('def f(a, b=2.5):\n    return a * b\nprint(f(1))\n')).toEqual([['f', ['int', 'float'], 'float']]);
  });
  it('keywords go to their parameters', () => {
    expect(fnKinds('def beep(ms=100, times=1):\n    pass\nbeep(times=2.5)\n')).toEqual([['beep', ['int', 'float'], 'none']]);
  });
  it('text at one call and a number at another → E-param-kinds', () => {
    expect(codes('def show(x):\n    print(x)\nshow(42)\nshow("a")\n')).toEqual(['E-param-kinds@4']);
  });
  it('uncalled functions: parameters are int (or the default), W-unused-function', () => {
    expect(fnKinds('def f(a, b="x"):\n    return a\n')).toEqual([['f', ['int', 'str'], 'int']]);
    expect(codes('def f(a):\n    return a\n')).toEqual(['W-unused-function@1']);
  });
  it('return kinds combine; text and numbers → E-return-kinds; none gives nothing', () => {
    expect(fnKinds('def f(x):\n    if x:\n        return 1\n    return 2.5\nprint(f(1))\n')).toEqual([['f', ['int'], 'float']]);
    expect(fnKinds('def f():\n    return\nf()\n')).toEqual([['f', [], 'none']]);
    expect(fnKinds('def f():\n    return None\nf()\n')).toEqual([['f', [], 'none']]);
    expect(codes('def f(x):\n    if x:\n        return "a"\n    return 1\nprint(f(1))\n')).toEqual(['E-return-kinds@4']);
  });
  it('recursion is resolved by the fixed point; unresolved kinds are int', () => {
    expect(fnKinds('def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nprint(fact(5))\n')).toEqual([['fact', ['int'], 'int']]);
    expect(fnKinds('def half(x):\n    if x < 1:\n        return x\n    return half(x / 2)\nprint(half(8))\n')).toEqual([['half', ['float'], 'float']]);
    expect(fnKinds('def loop(n):\n    return loop(n)\n')).toEqual([['loop', ['int'], 'int']]);
    const { typing } = program('def a(n):\n    return b(n)\ndef b(n):\n    return a(n)\nprint(a(1))\n');
    expect([...typing.functions.values()].map((f) => f.recursive)).toEqual([true, true]);
  });
});

describe('lists (§2.10)', () => {
  const lists = (source: string) =>
    program(source).typing.variables.filter((v) => v.list).map((v) => [v.sym.name, v.kind, v.list!.growable, v.list!.length, v.list!.capacity, v.list!.capacityGuessed]);
  it('fixed lists from a literal or [v] * N', () => {
    expect(lists('notes = [262, 294, 330]\nzeros = [0.0] * 4\nprint(notes, zeros)\n')).toEqual([
      ['notes', 'list<int>', false, 3, 3, false],
      ['zeros', 'list<float>', false, 4, 4, false],
    ]);
  });
  it('growable lists: capacity provable in for range(K) loops (products for nested ones), 20 otherwise', () => {
    expect(lists('readings = []\nfor i in range(5):\n    for j in range(2):\n        readings.append(i * j)\nprint(readings)\n')).toEqual([['readings', 'list<int>', true, 0, 10, false]]);
    expect(lists('readings = [1, 2]\nreadings.append(3)\nprint(readings)\n')).toEqual([['readings', 'list<int>', true, 2, 3, false]]);
    expect(lists('readings = []\nwhile True:\n    readings.append(1.5)\n')).toEqual([['readings', 'list<float>', true, 0, 20, true]]);
    expect(lists('readings = []\ndef add():\n    readings.append(1)\nadd()\n')).toEqual([['readings', 'list<int>', true, 0, 20, true]]);
    expect(lists('items = [1, 2]\nitems.pop()\n')).toEqual([['items', 'list<int>', true, 2, 2, false]]);
  });
  it('an empty list takes its kind from its appends (int when never told)', () => {
    expect(lists('names = []\nnames.append("a")\nprint(names)\n')[0][1]).toBe('list<str>');
    expect(lists('names = []\nprint(names)\n')[0][1]).toBe('list<int>');
  });
  it('mixed kinds → E-list-kinds; lists of lists → NA-nested-list', () => {
    expect(codes('items = [1, "a"]\n')).toEqual(['E-list-kinds@1']);
    expect(codes('items = [1, 2]\nitems.append("x")\n')).toEqual(['E-list-kinds@2']);
    expect(codes('items = []\nitems.append([1])\n')).toEqual(['NA-nested-list@2']);
  });
  it('a list of Pins (fixed) and item writes keep a list from being const', () => {
    const { typing } = program('from machine import Pin\nleds = [Pin(15, Pin.OUT), Pin(16, Pin.OUT)]\nfor i in range(len(leds)):\n    leds[i].on()\nNOTES = [1, 2]\nNOTES[0] = 3\n');
    expect(typing.variables.map((v) => [v.sym.name, v.kind, v.constant])).toEqual([
      ['leds', 'list<Pin>', false],
      ['i', 'int', false],
      ['NOTES', 'list<int>', false],
    ]);
  });
});

describe('colours (§3.6)', () => {
  it('a literal tuple is a constant 0xRRGGBB; a computed one needs a NeoPixel (E-colour)', () => {
    const { typing } = program('RED = (255, 0, 0)\nprint(RED == RED)\n');
    expect(typing.variables[0]).toMatchObject({ kind: 'color', constant: true, constValue: { type: 'color', value: 0xff0000 } });
    expect(codes('r = 100\nc = (r, 0, 0)\n')).toEqual(['E-colour@2']);
    expect(codes('from machine import Pin\nfrom neopixel import NeoPixel\nnp = NeoPixel(Pin(9), 1)\nr = 100\nnp[0] = (r, 0, 0)\nnp.write()\n')).toEqual([]);
    expect(codes('c = (1.5, 0, 0)\n')).toEqual(['E-range-float@1']);
  });
});

describe('constants (§2.9)', () => {
  const consts = (source: string) => program(source).typing.variables.map((v) => [v.sym.name, v.constant, v.constValue]);
  it('an UPPER_CASE name assigned once at top level from a constant expression', () => {
    expect(consts('BLINK_TIME = 0.5\nLIMIT = 10 * 2\nNAME = "Ali"\nprint(BLINK_TIME, LIMIT, NAME)\n')).toEqual([
      ['BLINK_TIME', true, { type: 'float', value: 0.5 }],
      ['LIMIT', true, { type: 'int', value: 20 }],
      ['NAME', true, { type: 'str', value: 'Ali' }],
    ]);
  });
  it('reassigned, assigned in a loop or an if, lower-case, or not constant → a variable', () => {
    expect(consts('LIMIT = 10\nLIMIT = 20\nprint(LIMIT)\n').map((c) => c[1])).toEqual([false]);
    expect(consts('if input():\n    LIMIT = 10\n    print(LIMIT)\n')[0][1]).toBe(false);
    expect(consts('limit = 10\nprint(limit)\n')[0][1]).toBe(false);
    expect(consts('from machine import ADC\nadc = ADC(17)\nLEVEL = adc.read()\nprint(LEVEL)\n').find((c) => c[0] === 'LEVEL')![1]).toBe(false);
    expect(consts('LIMIT = 10\ndef f():\n    global LIMIT\n    LIMIT = 5\nf()\n')[0][1]).toBe(false);
  });
  it('any name assigned with micropython.const(e); constants of constants and of pin names', () => {
    expect(consts('from micropython import const\nlimit = const(100)\nprint(limit)\n')).toEqual([['limit', true, { type: 'int', value: 100 }]]);
    expect(consts('import micropython\nlimit = micropython.const(5)\nprint(limit)\n')[0][1]).toBe(true);
    expect(consts('from zero1 import LED_RED\nA = 2\nB = A * 3\nPIN = LED_RED\nprint(B, PIN)\n')).toEqual([
      ['A', true, { type: 'int', value: 2 }],
      ['B', true, { type: 'int', value: 6 }],
      ['PIN', true, { type: 'int', value: 15 }],
    ]);
  });
});

describe('board objects (§2.9, §3)', () => {
  const objects = (source: string) =>
    program(source).typing.variables.filter((v) => v.object).map((v) => [v.sym.name, v.object!.part, v.object!.cls.name, v.object!.pin, v.object!.output]);
  it('knows the part, the class, the pin and whether a Pin is an output', () => {
    const src =
      'import dht\nfrom machine import Pin, ADC\nfrom neopixel import NeoPixel\nfrom zero1 import *\nled = Pin(LED_RED, Pin.OUT)\nbutton = Pin("D6", Pin.IN)\nadc = ADC(Pin(POT_LDR))\nnp = NeoPixel(Pin(RGB_PIN), 1)\nsensor = dht.DHT22(Pin(DHT_PIN))\nservo = Servo()\nbuzzer = Buzzer()\nsonar = HCSR04()\nlcd = LCD()\nhandle = led\n';
    expect(objects(src)).toEqual([
      ['led', 'Pin', 'Pin', 15, true],
      ['button', 'Pin', 'Pin', 6, false],
      ['adc', 'ADC', 'ADC', 17, false],
      ['np', 'NeoPixel', 'NeoPixel', 9, false],
      ['sensor', 'DHT', 'DHT22', 5, false],
      ['servo', 'Servo', 'Servo', 4, false],
      ['buzzer', 'Buzzer', 'Buzzer', 8, false],
      ['sonar', 'HCSR04', 'HCSR04', 3, false],
      ['lcd', 'LCD', 'LCD', null, false],
      ['handle', 'Pin', 'Pin', 15, true],
    ]);
    const { typing } = program(src);
    expect(typing.neoPixel?.sym.name).toBe('np');
    expect(typing.variables.filter((v) => v.object).every((v) => v.storage === 'global')).toBe(true);
  });
  it('what calls and attributes are (callTarget, denote)', () => {
    const src = 'import time\nfrom machine import Pin\nfrom zero1 import LED_RED\nled = Pin(LED_RED, Pin.OUT)\nled.on()\nled(1)\ntime.sleep(1)\nprint(len("a"))\ndef f():\n    pass\nf()\ns = "a"\ns.upper()\nl = [1]\nl.append(2)\n';
    const { resolved, typing } = program(src);
    const calls: Call[] = [];
    const visit = (e: Expr) => {
      if (e.type === 'Call') {
        calls.push(e);
        e.args.forEach(visit);
      }
    };
    for (const s of resolved.body as Stmt[]) {
      if (s.type === 'ExprStmt') visit(s.value);
      if (s.type === 'Assign') visit(s.value);
    }
    expect(calls.map((c) => typing.callTarget(c).kind)).toEqual(['class', 'method', 'pin-call', 'api', 'builtin', 'builtin', 'function', 'str-method', 'list-method']);
    const attr = (calls[0].args[1] as Expr & { type: 'Attribute' });
    expect(typing.apiConstant(attr)?.id).toBe('Pin.OUT');
    expect(typing.denote(calls[0].args[0])).toEqual({ kind: 'value', type: 'int' });
    expect(typing.pinOf(calls[0].args[0])).toBe(15);
  });
});
