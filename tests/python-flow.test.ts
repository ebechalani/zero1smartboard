/**
 * Data flow of Python mode (docs/PYTHON.md §2.9, §4.5, §4.7 D1–D3, §10.2): webs, definite
 * assignment (first visits of a use), where each C++ variable lives and is declared, and the
 * non-negative facts of N3.
 */
import { describe, expect, it } from 'vitest';
import type { Assign, BinOp, Expr, Stmt } from '../src/python/ast';
import { pythonToArduino } from '../src/python';
import { analyzeFlow } from '../src/python/flow';
import { infer } from '../src/python/kinds';
import { parseSource } from '../src/python/parser';
import { resolve } from '../src/python/scope';

const program = (source: string) => {
  const resolved = resolve(parseSource(source), source);
  const flow = analyzeFlow(resolved);
  const typing = infer(resolved, flow);
  return { resolved, flow, typing };
};
const codes = (source: string) => pythonToArduino(source).diagnostics.filter((d) => d.code !== 'X-internal').map((d) => `${d.code}@${d.line}`);
/** [Python name, C++ name, kind, storage, line declared at (null: top of its scope / globals)] for every variable. */
const vars = (source: string) =>
  program(source).typing.variables.map((v) => [v.sym.name, v.cppName, v.kind, v.storage, v.declareAt?.node?.line ?? null]);

const ADC = 'from machine import ADC\nfrom zero1 import POT_LDR\nadc = ADC(POT_LDR)\n';

describe('webs (§2.9)', () => {
  it('answer = input(); answer = int(answer) → two webs, answer and answer_2, no error', () => {
    const src = 'while True:\n    answer = input("How old are you? ")\n    answer = int(answer)\n    print("Next year you will be", answer + 1)\n';
    expect(vars(src)).toEqual([
      ['answer', 'answer', 'str', 'loop', 2],
      ['answer', 'answer_2', 'int', 'loop', 3],
    ]);
    expect(codes(src)).toEqual([]);
    const { flow, resolved } = program(src);
    expect(flow.webs.filter((w) => w.sym === resolved.moduleScope.symbols.get('answer'))).toHaveLength(2);
  });
  it('x = 5; print(x); x = 2.5 → two webs (the print sees the whole number)', () => {
    const src = 'x = 5\nprint(x)\nx = 2.5\nprint(x)\n';
    expect(vars(src)).toEqual([
      ['x', 'x', 'int', 'setup', 1],
      ['x', 'x_2', 'float', 'setup', 3],
    ]);
    expect(codes(src)).toEqual([]);
  });
  it('state = 0 … state = not state in the loop → one web, int, W-bool-int when printed', () => {
    const src = 'state = 0\nwhile True:\n    state = not state\n    print(state)\n';
    const { flow, typing } = program(src);
    expect(flow.webs).toHaveLength(1);
    expect(typing.variables.map((v) => [v.kind, v.storage])).toEqual([['int', 'global']]);
    expect(codes(src)).toEqual(['W-bool-int@4']);
    expect(codes('state = 0\nwhile True:\n    state = not state\n')).toEqual([]);
  });
  it('webs of the same name and kind are one variable', () => {
    const src = 'while True:\n    v = 1\n    print(v)\n    v = 2\n    print(v)\n';
    const { flow, typing } = program(src);
    expect(flow.webs).toHaveLength(2);
    expect(typing.variables).toHaveLength(1);
    expect(typing.variables[0].webs).toHaveLength(2);
  });
  it('a module name that a function reads or assigns is one web (the call order is unknown)', () => {
    const src = 'x = 1\nprint(x)\nx = "a"\ndef f():\n    print(x)\nf()\n';
    const { flow } = program(src);
    expect(flow.webs).toHaveLength(1);
    expect(codes(src)[0]).toMatch(/^E-retype@/);
  });
});

describe('definite assignment (§2.9)', () => {
  it('while True: count = count + 1 → E-name on count (first round); count += 1 → the same', () => {
    expect(codes('while True:\n    count = count + 1\n')).toEqual(['E-name@2']);
    expect(codes('while True:\n    count += 1\n')).toEqual(['E-name@2']);
    expect(vars('count = 0\nwhile True:\n    count += 1\n')).toEqual([['count', 'count', 'int', 'global', null]]);
    expect(codes('count = 0\nwhile True:\n    count += 1\n')).toEqual([]);
  });
  it('if c: x = 1 then print(x) → W-maybe-unassigned; a use above the only assignment → E-name-later', () => {
    expect(codes('c = input()\nif c:\n    x = 1\nprint(x)\n')).toEqual(['W-maybe-unassigned@4']);
    expect(codes('print(x)\nx = 1\n')).toEqual(['E-name-later@1']);
    expect(codes('while True:\n    print(y)\n    y = 1\n')).toEqual(['E-name-later@2']);
  });
  it('a value set on some first visits only (inside the loop, from an if) → W-maybe-unassigned', () => {
    expect(codes('while True:\n    if input():\n        z = 1\n    print(z)\n')).toEqual(['W-maybe-unassigned@4']);
  });
  it('the for loop variable after a loop that may not run → W-maybe-unassigned; a literal range runs at least once', () => {
    expect(codes('n = int(input())\nfor i in range(n):\n    pass\nprint(i)\n')).toEqual(['W-maybe-unassigned@4']);
    expect(codes('for i in range(3):\n    pass\nprint(i)\n')).toEqual([]);
    expect(codes('for i in range(3, 0):\n    pass\nprint(i)\n')).toEqual(['W-maybe-unassigned@3']);
  });
  it('a local read before its assignment → E-unbound-local', () => {
    expect(codes('def f():\n    print(y)\n    y = 1\nf()\n')).toEqual(['E-unbound-local@2']);
  });
  it('a global only created in a function (global x; x = 5) is a C++ global; reads elsewhere are fine', () => {
    const src = 'def start():\n    global level\n    level = 5\nstart()\nprint(level)\n';
    expect(codes(src)).toEqual([]);
    expect(vars(src)).toEqual([['level', 'level', 'int', 'global', null]]);
  });
  it('a global read in a function but never assigned anywhere → E-name', () => {
    expect(codes('def f():\n    print(level)\nf()\n')).toEqual(['E-name@2']);
    expect(codes('def f():\n    global level\n    print(level)\nf()\n')).toEqual(['E-name@3']);
  });
  it('a function used before its def has run → E-name-later; defs after the main loop cannot be called from it', () => {
    expect(codes('beep()\ndef beep():\n    pass\n')).toEqual(['E-name-later@1']);
    expect(codes('while True:\n    beep()\ndef beep():\n    pass\n')).toEqual(['E-name-later@2']);
    expect(codes('def a():\n    b()\ndef b():\n    pass\na()\n')).toEqual([]);
  });
  it('the try forms: the handler runs without the assignment of the first statement', () => {
    expect(codes('try:\n    age = int(input())\nexcept ValueError:\n    pass\nprint(age)\n')).toEqual(['W-maybe-unassigned@5']);
    expect(codes('try:\n    age = int(input())\nexcept ValueError:\n    age = 0\nprint(age)\n')).toEqual([]);
  });
});

describe('where variables live (§4.7 D1–D3)', () => {
  it('T2: counters are initialised globals, readings of one round are locals of loop()', () => {
    const src = `${ADC}total = 0\ncount = 0\nwhile True:\n    value = adc.read()\n    percent = value * 100 // 1023\n    total += value\n    count += 1\n    average = total / count\n    print(percent, average)\n`;
    const { typing } = program(src);
    expect(typing.variables.map((v) => [v.sym.name, v.kind, v.storage, v.declareAt?.node?.line ?? null, v.init?.node?.line ?? null])).toEqual([
      ['adc', 'ADC', 'global', null, 3],
      ['total', 'int', 'global', null, 4],
      ['count', 'int', 'global', null, 5],
      ['value', 'int', 'loop', 7, null],
      ['percent', 'int', 'loop', 8, null],
      ['average', 'float', 'loop', 11, null],
    ]);
  });
  it('a loop local first assigned inside an if and read after it → declared at the top of loop()', () => {
    const src = 'while True:\n    if input():\n        v = 1\n    else:\n        v = 2\n    print(v)\n';
    expect(vars(src)).toEqual([['v', 'v', 'int', 'loop', null]]);
  });
  it('a loop local whose uses are all in the block of its first assignment is declared there (T7 n)', () => {
    const src = 'while True:\n    if input():\n        n = 5\n        if n > 1:\n            print(n)\n';
    expect(vars(src)).toEqual([['n', 'n', 'int', 'loop', 3]]);
  });
  it('used in a function, or read before written in a round → a global (negative cases)', () => {
    expect(vars('while True:\n    v = 1\n    def f():\n        pass\n')).toEqual([['v', 'v', 'int', 'loop', 2]]);
    expect(vars('def show():\n    print(v)\nwhile True:\n    v = 1\n    show()\n')).toEqual([['v', 'v', 'int', 'global', null]]);
    expect(vars('while True:\n    if input():\n        v = 1\n    print(v)\n')).toEqual([['v', 'v', 'int', 'global', null]]);
  });
  it('setup-only variables are locals of setup(); a for loop variable is declared by its loop', () => {
    expect(vars('for i in range(3):\n    x = i * 2\n    print(x)\nprint("Done")\n')).toEqual([
      ['i', 'i', 'int', 'setup', 1],
      ['x', 'x', 'int', 'setup', 2],
    ]);
    expect(vars('for i in range(3):\n    pass\nprint(i)\n')).toEqual([['i', 'i', 'int', 'setup', null]]);
  });
  it('form V (T6): the number is declared inside the try, the else goes with it', () => {
    const src = 'while True:\n    try:\n        age = int(input("Age? "))\n    except ValueError:\n        print("Please type a whole number")\n    else:\n        print("In ten years:", age + 10)\n';
    expect(vars(src)).toEqual([['age', 'age', 'int', 'loop', 3]]);
  });
  it('function locals: at the first assignment when it dominates, else at the top; parameters are declared by the function', () => {
    const src = 'def f(a):\n    if a:\n        b = 1\n    else:\n        b = 2\n    c = b + a\n    return c\nprint(f(1))\n';
    expect(vars(src)).toEqual([
      ['a', 'a', 'int', 'local', 1],
      ['b', 'b', 'int', 'local', null],
      ['c', 'c', 'int', 'local', 6],
    ]);
  });
  it('a global whose first definition is not a top-level constant is declared with its zero value', () => {
    const { typing } = program(`${ADC}level = adc.read()\nwhile True:\n    level = level + 1\n`);
    const level = typing.variables.find((v) => v.sym.name === 'level')!;
    expect([level.storage, level.init]).toEqual(['global', null]);
  });
});

describe('non-negative facts (N3)', () => {
  /** Whether the right side of the statement on `line` is known ≥ 0. */
  const nonNegative = (src: string, line: number, pick: (e: Expr) => Expr = (e) => e) => {
    const { resolved, typing } = program(src);
    const find = (stmts: readonly Stmt[]): Assign | null => {
      for (const s of stmts) {
        if (s.line === line && s.type === 'Assign') return s;
        const inner = s.type === 'While' || s.type === 'For' || s.type === 'If' ? find(s.body.stmts) : null;
        if (inner) return inner;
      }
      return null;
    };
    const stmt = find(resolved.body)!;
    return typing.nonNegative(pick(stmt.value));
  };
  it('value = adc.read(); value * 100 // 1023 → known ≥ 0 (plain /)', () => {
    const src = `${ADC}while True:\n    value = adc.read()\n    percent = value * 100 // 1023\n`;
    expect(nonNegative(src, 6)).toBe(true);
    expect(nonNegative(src, 6, (e) => (e as BinOp).left)).toBe(true);
  });
  it('n = f(); n % 5 → not known (pyMod)', () => {
    const src = 'def f():\n    return 5\nwhile True:\n    n = f()\n    r = n % 5\n';
    expect(nonNegative(src, 5)).toBe(false);
  });
  it('counters from 0 that only grow are ≥ 0; one that is decremented is not', () => {
    const { typing } = program('count = 0\ndown = 10\nwhile True:\n    count += 1\n    down -= 1\n    print(count, down)\n');
    expect(typing.variables.map((v) => [v.sym.name, v.nonNegative])).toEqual([
      ['count', true],
      ['down', false],
    ]);
  });
  it('the variable of for i in range(n) with a non-negative start and a positive step', () => {
    const { typing } = program('for i in range(10):\n    print(i)\nfor j in range(-5, 5):\n    print(j)\nfor k in range(10, 0, -1):\n    print(k)\n');
    expect(typing.variables.map((v) => [v.sym.name, v.nonNegative])).toEqual([
      ['i', true],
      ['j', false],
      ['k', false],
    ]);
  });
  it('len(), ticks and pin readings are ≥ 0; a subtraction is not', () => {
    const src = 'import time\nitems = [1]\na = len(items)\nb = time.ticks_ms()\nc = a - b\n';
    expect([nonNegative(src, 3), nonNegative(src, 4), nonNegative(src, 5)]).toEqual([true, true, false]);
  });
});

describe('control flow', () => {
  it('knows when a function can fall off its end (W-missing-return) and dominance', () => {
    const { flow, resolved } = program('def f(x):\n    if x:\n        return 1\ndef g(x):\n    while True:\n        return 1\nprint(f(1), g(1))\n');
    const [f, g] = resolved.functions;
    expect(flow.cfgs.get(f.scope)!.fallsOff).toBe(true);
    expect(flow.cfgs.get(g.scope)!.fallsOff).toBe(false);
    const body = f.def.body.stmts;
    expect(flow.dominates(body[0], (body[0] as Stmt & { type: 'If' }).body.stmts[0])).toBe(true);
  });
  it('knows the definitions alive at the main loop head (a value carried to the next round)', () => {
    const { flow, typing } = program('count = 0\nwhile True:\n    v = 1\n    count += v\n');
    const count = typing.variables.find((v) => v.sym.name === 'count')!;
    expect(count.defs.every((d) => flow.reachesLoopHead.has(d))).toBe(true);
  });
  it('records for loops whose variable is changed in the body or read after the loop (hidden counter, §2.4)', () => {
    const { flow, resolved } = program('for i in range(10):\n    i = i + 1\nprint(i)\nfor j in range(3):\n    print(j)\n');
    const [first, , second] = resolved.body as Array<Stmt & { type: 'For' }>;
    expect(flow.forLoops.get(first)).toMatchObject({ readAfter: true });
    expect(flow.forLoops.get(first)!.assignedInBody.map((d) => d.node?.line)).toEqual([2]);
    expect(flow.forLoops.get(second)).toMatchObject({ readAfter: false, assignedInBody: [] });
  });
});
