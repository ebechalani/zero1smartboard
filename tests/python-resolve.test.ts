/**
 * Name resolution of Python mode (docs/PYTHON.md §2.1, §2.14, §4.5): scopes (module names,
 * function locals, `global`), imports and their API bindings, the main-loop split, and the C++
 * name of every Python name (transliteration, reserved names, clashes, webs of another kind).
 */
import { describe, expect, it } from 'vitest';
import type { FunctionDef, Name, Stmt } from '../src/python/ast';
import { analyzeFlow } from '../src/python/flow';
import { infer } from '../src/python/kinds';
import { parseSource } from '../src/python/parser';
import { freshName, resolve, transliterate, type Resolved } from '../src/python/scope';

const resolved = (source: string): Resolved => resolve(parseSource(source), source);
const typed = (source: string) => {
  const r = resolved(source);
  const flow = analyzeFlow(r);
  return { r, flow, typing: infer(r, flow) };
};
/** The C++ names of the variables of a program, as [Python name, C++ name]. */
const cppNames = (source: string) => typed(source).typing.variables.map((v) => [v.sym.name, v.cppName]);

describe('scopes (§2.14)', () => {
  it('module names are one scope; a name assigned in a def is local unless global', () => {
    const r = resolved('count = 0\ndef add():\n    global count\n    count += 1\n    step = 2\n    return step\ndef show():\n    print(count)\nadd()\nshow()\n');
    expect([...r.moduleScope.symbols.keys()]).toEqual(['count', 'add', 'show']);
    const [add, show] = r.functions;
    expect([...add.scope.symbols.keys()]).toEqual(['step']);
    expect([...add.scope.globals.keys()]).toEqual(['count']);
    expect([...show.scope.symbols.keys()]).toEqual([]);
    const count = r.moduleScope.symbols.get('count')!;
    expect(count.shared).toBe(true);
    expect(count.writtenByFunction).toBe(true);
    expect(count.defs.map((d) => [d.kind, d.scope.kind])).toEqual([
      ['assign', 'module'],
      ['augassign', 'function'],
    ]);
    expect(count.uses.map((u) => u.scope.fn?.name ?? 'module')).toEqual(['add', 'show']);
  });
  it('a module name that no function uses is not shared (webs may split)', () => {
    const r = resolved('x = 1\nprint(x)\n');
    expect(r.moduleScope.symbols.get('x')!.shared).toBe(false);
  });
  it('parameters are locals of their function; built-ins and unknown names are not symbols', () => {
    const r = resolved('def f(a, b=2):\n    print(a, b, zz)\nf(1)\n');
    const f = r.functions[0];
    expect(f.params.map((p) => p.name)).toEqual(['a', 'b']);
    const call = (f.def.body.stmts[0] as Stmt & { type: 'ExprStmt' }).value;
    if (call.type !== 'Call') throw new Error('call');
    expect(r.refs.get(call.func as Name)).toEqual({ kind: 'builtin', name: 'print' });
    expect(r.refs.get(call.args[2] as Name)).toEqual({ kind: 'unbound', name: 'zz' });
  });
  it('a module name that is also a built-in keeps a "built-in" definition until assigned (W-shadow, E-not-callable)', () => {
    const { r, flow } = typed('print(max(1, 2))\nmax = 0\nprint(max)\n');
    const max = r.moduleScope.symbols.get('max')!;
    expect(max.builtinDef?.kind).toBe('builtin');
    expect(flow.bindingOf(max.uses[0].node)).toEqual({ kind: 'builtin', name: 'max' });
    expect(flow.bindingOf(max.uses[1].node).kind).toBe('variable');
  });
});

describe('imports (§3)', () => {
  it('binds modules and members, with aliases', () => {
    const r = resolved('import time as t\nfrom machine import Pin, ADC as A\nfrom zero1 import *\n');
    expect(r.imports.map((i) => [i.module, i.memberName, i.member?.id ?? null])).toEqual([
      ['time', null, null],
      ['machine', 'Pin', 'machine.Pin'],
      ['machine', 'ADC', 'machine.ADC'],
      ['zero1', null, null],
    ]);
    expect(r.moduleScope.symbols.has('t')).toBe(true);
    expect(r.moduleScope.symbols.has('A')).toBe(true);
    // A star import binds every name of the module.
    for (const name of ['LED_RED', 'Servo', 'map_range', 'A3']) expect(r.moduleScope.symbols.has(name), name).toBe(true);
  });
  it('keeps unknown modules and names bound (their errors are E-module / E-import-name, not E-name)', () => {
    const r = resolved('import foo\nfrom machine import Nope\n');
    expect(r.imports.map((i) => [i.module, i.member])).toEqual([
      [null, null],
      ['machine', null],
    ]);
    expect(r.moduleScope.symbols.has('foo')).toBe(true);
    expect(r.moduleScope.symbols.has('Nope')).toBe(true);
  });
  it('knows when a program calls input() (§7.9)', () => {
    expect(resolved('x = input()\n').usesInput).toBe(true);
    expect(resolved('print(1)\n').usesInput).toBe(false);
  });
});

describe('the main-loop split (§2.1)', () => {
  const split = (source: string) => {
    const r = resolved(source);
    return { loop: r.main.loop?.line ?? null, setup: r.main.setup.map((s) => s.line), after: r.main.after.map((s) => s.line), ends: r.endsAfterSetup, unreachable: r.unreachable?.first.line ?? null };
  };
  it('the final top-level while True (or while 1) is the main loop; defs may follow it', () => {
    expect(split('x = 1\nwhile True:\n    pass\ndef f():\n    pass\n')).toEqual({ loop: 2, setup: [1], after: [4], ends: false, unreachable: null });
    expect(split('while 1:\n    pass\n')).toMatchObject({ loop: 1, ends: false });
  });
  it('without a main loop everything runs in setup() and the program ends', () => {
    expect(split('for _ in range(3):\n    pass\nprint("Done")\n')).toEqual({ loop: null, setup: [1, 3], after: [], ends: true, unreachable: null });
  });
  it('a break out of it, a test other than True / 1, or statements after it: not the main loop', () => {
    expect(split('while True:\n    if x:\n        break\n')).toMatchObject({ loop: null, ends: true });
    expect(split('while True:\n    for i in range(3):\n        break\n')).toMatchObject({ loop: 1 });
    expect(split('while x:\n    pass\n')).toMatchObject({ loop: null });
    expect(split('while True:\n    pass\nprint("never")\n')).toMatchObject({ loop: null, unreachable: 3 });
  });
  it('unwraps if __name__ == "__main__": (its body is top-level code)', () => {
    const r = resolved('def main():\n    pass\nif __name__ == "__main__":\n    x = 1\n    while True:\n        main()\n');
    expect(r.mainGuards.map((s) => s.line)).toEqual([3]);
    expect(r.body.map((s) => s.line)).toEqual([1, 4, 5]);
    expect(r.main.loop?.line).toBe(5);
  });
  it('the def main(): pattern keeps its while True inside the function', () => {
    expect(split('def main():\n    while True:\n        pass\nmain()\n')).toMatchObject({ loop: null, ends: true });
  });
});

describe('C++ names (§2.14)', () => {
  it('transliterates non-ASCII names', () => {
    expect(transliterate('température')).toBe('temperature');
    expect(transliterate('größe')).toBe('grosse');
    expect(transliterate('Æble')).toBe('AEble');
    expect(transliterate('łódź')).toBe('lodz');
    expect(transliterate('þorn')).toBe('thorn');
    expect(transliterate('حرارة')).toBe('u062du0631u0627u0631u0629');
    expect(transliterate('x😀')).toBe('xu1f600');
  });
  it('appends _ to reserved names and to names already taken', () => {
    expect(cppNames('map = 1\nB1 = 2\nsquare = 3\nvalue = 4\ncount = 5\nprint(map, B1, square, value, count)\n')).toEqual([
      ['map', 'map_'],
      ['B1', 'B1_'],
      ['square', 'square_'],
      ['value', 'value'],
      ['count', 'count'],
    ]);
    expect(cppNames('température = 1\ntemperature = 2\nprint(température, temperature)\n')).toEqual([
      ['température', 'temperature'],
      ['temperature', 'temperature_'],
    ]);
  });
  it('renames functions named like the sketch (setup, loop) and keeps function names apart from variables', () => {
    const { r } = typed('def setup():\n    pass\ndef loop():\n    pass\ndef blink():\n    pass\nsetup()\nloop()\nblink()\n');
    expect(r.functions.map((f) => f.cppName)).toEqual(['setup_', 'loop_', 'blink']);
  });
  it('a web of another kind gets _2, _3 (and a clash with a Python name gets an _)', () => {
    expect(cppNames('while True:\n    answer = input("Age? ")\n    answer = int(answer)\n    print(answer + 1)\n')).toEqual([
      ['answer', 'answer'],
      ['answer', 'answer_2'],
    ]);
    expect(cppNames('answer_2 = 5\nanswer = "a"\nprint(answer)\nanswer = 1\nprint(answer, answer_2)\n')).toEqual([
      ['answer_2', 'answer_2'],
      ['answer', 'answer'],
      ['answer', 'answer_2_'],
    ]);
  });
  it('locals and parameters are named in their function (they may shadow a global, like Python)', () => {
    const { r, typing } = typed('value = 1\ndef f(value, map):\n    total = value + map\n    return total\nprint(f(1, 2), value)\n');
    expect(r.functions[0].params.map((p) => p.cppName)).toEqual(['value', 'map_']);
    expect(typing.variables.map((v) => [v.sym.name, v.cppName, v.storage])).toEqual([
      ['value', 'value', 'setup'],
      ['value', 'value', 'local'],
      ['map', 'map_', 'local'],
      ['total', 'total', 'local'],
    ]);
  });
  it('freshName gives the emitter names that are free in a scope', () => {
    const { r } = typed('readings = [1]\nreadingsCount = 2\nprint(readings, readingsCount)\n');
    expect(freshName(r.moduleScope, 'readingsCount')).toBe('readingsCount_');
    expect(freshName(r.moduleScope, 'readingsCount')).toBe('readingsCount__');
    expect(freshName(r.moduleScope, 'i')).toBe('i');
    expect(freshName(r.moduleScope, 'setup')).toBe('setup_');
  });
});

describe('bookkeeping for the later stages', () => {
  it('records every statement’s scope, parent statement and block', () => {
    const r = resolved('def f():\n    if True:\n        x = 1\nwhile True:\n    y = 2\n');
    const f = r.body[0] as FunctionDef;
    const ifStmt = f.body.stmts[0] as Stmt & { type: 'If' };
    const x = ifStmt.body.stmts[0];
    expect(r.scopeOf.get(x)?.fn?.name).toBe('f');
    expect(r.parentOf.get(x)).toBe(ifStmt);
    expect(r.blockOf.get(x)).toBe(ifStmt.body);
    expect(r.parentOf.get(f)).toBeNull();
    const loop = r.main.loop!;
    expect(r.parentOf.get(loop.body.stmts[0])).toBe(loop);
  });
  it('gives every definition and use in evaluation order (the right side before the target)', () => {
    const r = resolved('x = 1\nx = x + 1\n');
    const events = r.stmtEvents.get(r.body[1])!.main.map((e) => (e.use ? `use ${e.use.sym.name}` : `def ${e.def!.sym.name}`));
    expect(events).toEqual(['use x', 'def x']);
    const aug = resolved('y = 0\ny += 2\n');
    expect(aug.stmtEvents.get(aug.body[1])!.main.map((e) => (e.use ? 'use' : 'def'))).toEqual(['use', 'def']);
  });
});
