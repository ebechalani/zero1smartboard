/**
 * The parser of Python mode (docs/PYTHON.md §2.3–§2.5, §4.4, §5.1, §10.1): every statement and
 * expression form, precedence, positions, comment attachment, docstrings, every syntax and
 * indentation error with its exact message and range, and the constructs that parse into
 * Unsupported nodes with their NA codes. Also pythonToArduino's syntax diagnostics.
 */
import { describe, expect, it } from 'vitest';
import type { Assign, Expr, FString, FunctionDef, If, Span, Stmt, Try, Unsupported } from '../src/python/ast';
import { PythonSyntaxError, parseSource } from '../src/python/parser';
import { BLANK_PYTHON, PYTHON_EXAMPLES, pythonToArduino } from '../src/python';
import { message } from '../src/python/messages';
import { placeholderErrorCount, pythonPlaceholder } from '../src/sketch/placeholder';

const at = (s: Span) => [s.line, s.column, s.endLine, s.endColumn];
const body = (source: string): Stmt[] => parseSource(source).body.stmts;
const first = <T extends Stmt = Stmt>(source: string): T => body(source)[0] as T;
/** The expression of `x = <expr>` / an expression statement. */
const expr = (source: string): Expr => {
  const s = first(source.includes('\n') ? source : `${source}\n`);
  if (s.type === 'ExprStmt') return s.value;
  if (s.type === 'Assign') return s.value;
  throw new Error(`no expression in ${source}`);
};

/** A compact, fully parenthesised rendering of an expression (precedence tests). */
function show(e: Expr): string {
  switch (e.type) {
    case 'Name':
      return e.id;
    case 'Num':
      return e.raw;
    case 'Str':
      return JSON.stringify(e.value);
    case 'FString':
      return `f[${e.parts.map((p) => (p.type === 'text' ? JSON.stringify(p.value) : `{${show(p.value)}${p.spec ? ':' + p.spec.text : ''}}`)).join(' ')}]`;
    case 'Bool':
      return e.value ? 'True' : 'False';
    case 'NoneLit':
      return 'None';
    case 'BinOp':
      return `(${show(e.left)} ${e.op} ${show(e.right)})`;
    case 'UnaryOp':
      return `(${e.op}${e.op === 'not' ? ' ' : ''}${show(e.operand)})`;
    case 'BoolOp':
      return `(${e.values.map(show).join(` ${e.op} `)})`;
    case 'Compare':
      return `(${show(e.left)}${e.ops.map((op, i) => ` ${op} ${show(e.comparators[i])}`).join('')})`;
    case 'IfExp':
      return `(${show(e.body)} if ${show(e.test)} else ${show(e.orelse)})`;
    case 'Call':
      return `${show(e.func)}(${[...e.args.map(show), ...e.keywords.map((k) => `${k.name.name}=${show(k.value)}`)].join(', ')})`;
    case 'Attribute':
      return `${show(e.value)}.${e.attr.name}`;
    case 'Subscript':
      return `${show(e.value)}[${show(e.index)}]`;
    case 'ListLit':
      return `[${e.elts.map(show).join(', ')}]`;
    case 'ListRepeat':
      return `(${show(e.list)} * ${show(e.count)})`;
    case 'TupleLit':
      return `tuple(${e.elts.map(show).join(', ')})`;
    case 'Unsupported':
      return `<${e.code}>`;
  }
}

/** The error parseSource() throws: code, message and [line, column, endLine, endColumn]. */
function syntaxError(source: string): { code: string; message: string; at: number[] } {
  try {
    parseSource(source);
  } catch (err) {
    if (err instanceof PythonSyntaxError) return { code: err.code, message: err.message, at: [err.line, err.column, err.endLine, err.endColumn] };
    throw err;
  }
  throw new Error(`no error for ${JSON.stringify(source)}`);
}

// ---------------------------------------------------------------------------

describe('statements (§2.4)', () => {
  it('x = e, a = b = e (targets left to right), a, b = e1, e2 and subscript swaps', () => {
    const one = first<Assign>('x = 5\n');
    expect(one.targets.map((t) => t.type)).toEqual(['Name']);
    expect(at(one)).toEqual([1, 1, 1, 6]);
    const chain = first<Assign>('a = b = 0\n');
    expect(chain.targets.map((t) => (t.type === 'Name' ? t.id : t.type))).toEqual(['a', 'b']);
    expect(show(chain.value)).toBe('0');
    const swap = first<Assign>('a, b = b, a\n');
    expect(swap.targets[0]).toMatchObject({ type: 'TupleTarget', elts: [{ id: 'a' }, { id: 'b' }] });
    expect(show(swap.value)).toBe('tuple(b, a)');
    const items = first<Assign>('a[i], a[j] = a[j], a[i]\n');
    expect(items.targets[0].type === 'TupleTarget' && items.targets[0].elts.map((t) => (t.type === 'Subscript' ? show(t) : ''))).toEqual(['a[i]', 'a[j]']);
    expect(first<Assign>('(a, b) = 1, 2\n').targets[0].type).toBe('TupleTarget');
    expect(first<Assign>('np[0] = (255, 0, 0)\n')).toMatchObject({ targets: [{ type: 'Subscript' }], value: { type: 'TupleLit', parenthesized: true } });
    expect(first<Assign>('led.value = 1\n').targets[0].type).toBe('Attribute');
  });
  it('every augmented assignment', () => {
    for (const op of ['+', '-', '*', '/', '//', '%', '**', '&', '|', '^', '<<', '>>']) {
      expect(first(`x ${op}= 2\n`)).toMatchObject({ type: 'AugAssign', op, target: { type: 'Name', id: 'x' }, value: { type: 'Num', value: 2 } });
    }
    expect(first('a[i] += 1\n')).toMatchObject({ type: 'AugAssign', target: { type: 'Subscript' } });
  });
  it('if / elif / else: an elif is an If alone in the orelse block', () => {
    const s = first<If>('if a:\n    x()\nelif b:\n    y()\nelse:\n    z()\n');
    expect(show(s.test)).toBe('a');
    expect(s.isElif).toBe(false);
    const elif = s.orelse!.stmts[0] as If;
    expect(s.orelse!.stmts).toHaveLength(1);
    expect(elif).toMatchObject({ type: 'If', isElif: true, test: { id: 'b' } });
    expect(elif.orelse!.stmts.map((x) => x.type)).toEqual(['ExprStmt']);
    expect(at(s)).toEqual([1, 1, 6, 8]);
    expect(at(elif)).toEqual([3, 1, 6, 8]);
  });
  it('while and for (range, a list, text), break, continue, pass', () => {
    expect(first('while True:\n    break\n')).toMatchObject({ type: 'While', test: { type: 'Bool', value: true }, body: { stmts: [{ type: 'Break' }] }, orelse: null });
    expect(first('while 1:\n    continue\n')).toMatchObject({ type: 'While', test: { type: 'Num', value: 1 }, body: { stmts: [{ type: 'Continue' }] } });
    const loop = first('for i in range(0, 10, 2):\n    pass\n');
    expect(loop).toMatchObject({ type: 'For', target: { type: 'Name', id: 'i' }, body: { stmts: [{ type: 'Pass' }] }, orelse: null });
    expect(loop.type === 'For' && show(loop.iter)).toBe('range(0, 10, 2)');
    expect(first('for ch in "abc":\n    pass\n')).toMatchObject({ type: 'For', iter: { type: 'Str', value: 'abc' } });
    expect(first('for a in i2c.scan():\n    pass\n')).toMatchObject({ type: 'For', iter: { type: 'Call' } });
  });
  it('one-line suites and ; separated statements (with a trailing ;)', () => {
    expect(first('while True: pass\n')).toMatchObject({ type: 'While', body: { stmts: [{ type: 'Pass' }] } });
    expect(first('if x: a(); b()\n')).toMatchObject({ type: 'If', body: { stmts: [{ type: 'ExprStmt' }, { type: 'ExprStmt' }] } });
    expect(body('a = 1; b = 2;\nc = 3\n').map((s) => s.type)).toEqual(['Assign', 'Assign', 'Assign']);
    expect(at(body('a = 1; b = 2\n')[1])).toEqual([1, 8, 1, 13]);
  });
  it('def with defaults, return with and without a value, global', () => {
    const f = first<FunctionDef>('def beep(ms=100, times=2 * 3):\n    global count\n    count += 1\n    return\n');
    expect(f.name).toMatchObject({ name: 'beep', line: 1, column: 5, endColumn: 9 });
    expect(f.params.map((p) => [p.name, p.default && show(p.default), ...at(p)])).toEqual([
      ['ms', '100', 1, 10, 1, 16],
      ['times', '(2 * 3)', 1, 18, 1, 29],
    ]);
    expect(f.body.stmts.map((s) => s.type)).toEqual(['Global', 'AugAssign', 'Return']);
    expect(f.body.stmts[0]).toMatchObject({ names: [{ name: 'count' }] });
    expect(f.body.stmts[2]).toMatchObject({ type: 'Return', value: null });
    expect(first<FunctionDef>('def f(a, b):\n    return a + b\n').body.stmts[0]).toMatchObject({ type: 'Return', value: { type: 'BinOp' } });
    expect(first<FunctionDef>('def f():\n    return None\n').body.stmts[0]).toMatchObject({ type: 'Return', value: { type: 'NoneLit' } });
    expect(first<FunctionDef>('def f(a,):\n    pass\n').params.map((p) => p.name)).toEqual(['a']);
  });
  it('import and from … import (names, aliases, *, brackets, dotted and relative names kept for E-module)', () => {
    expect(first('import time, math as m\n')).toMatchObject({ type: 'Import', names: [{ name: 'time', asname: null }, { name: 'math', asname: { name: 'm' } }] });
    expect(first('import a.b\n')).toMatchObject({ type: 'Import', names: [{ name: 'a.b' }] });
    expect(first('from machine import Pin, ADC as A\n')).toMatchObject({ type: 'ImportFrom', module: { name: 'machine' }, star: false, names: [{ name: 'Pin' }, { name: 'ADC', asname: { name: 'A' } }] });
    expect(first('from zero1 import *\n')).toMatchObject({ type: 'ImportFrom', star: true, names: [] });
    expect(first('from machine import (\n    Pin,\n    PWM,\n)\n')).toMatchObject({ names: [{ name: 'Pin' }, { name: 'PWM' }] });
    expect(first('from . import x\n')).toMatchObject({ module: { name: '.' } });
    expect(first('from ..a.b import x\n')).toMatchObject({ module: { name: '..a.b' } });
  });
  it('expression statements, raise, assert, try / except / else', () => {
    expect(first('led.on()\n')).toMatchObject({ type: 'ExprStmt', value: { type: 'Call' } });
    expect(first('raise ValueError("too hot")\n')).toMatchObject({ type: 'Raise', exc: { type: 'Call' }, cause: null });
    expect(first('raise ValueError\n')).toMatchObject({ type: 'Raise', exc: { type: 'Name', id: 'ValueError' } });
    expect(first('raise A from B\n')).toMatchObject({ type: 'Raise', cause: { id: 'B' } });
    expect(first('assert x > 0\n')).toMatchObject({ type: 'Assert', msg: null });
    expect(first('assert x > 0, f"bad {x}"\n')).toMatchObject({ type: 'Assert', msg: { type: 'FString' } });
    const t = first<Try>('try:\n    sensor.measure()\nexcept OSError as e:\n    print(e)\nelse:\n    x = 1\n');
    expect(t.type).toBe('Try');
    expect(t.handler).toMatchObject({ typeName: { name: 'OSError', line: 3, column: 8 }, alias: { name: 'e' }, line: 3, column: 1, endLine: 4, endColumn: 13 });
    expect(t.orelse!.stmts.map((s) => s.type)).toEqual(['Assign']);
    expect(first<Try>('try:\n    a = int(s)\nexcept:\n    a = 0\n').handler).toMatchObject({ typeName: null, alias: null });
  });
  it('`if __name__ == "__main__":` is an ordinary if (the resolver unwraps it)', () => {
    expect(first('if __name__ == "__main__":\n    main()\n')).toMatchObject({ type: 'If', test: { type: 'Compare', ops: ['=='] } });
  });
});

describe('expressions (§2.5) and precedence', () => {
  it('follows Python precedence', () => {
    const cases: Array<[string, string]> = [
      ['-2 ** 2', '(-(2 ** 2))'],
      ['2 ** -1', '(2 ** (-1))'],
      ['2 ** 3 ** 2', '(2 ** (3 ** 2))'],
      ['not a == b', '(not (a == b))'],
      ['a & b == c', '((a & b) == c)'],
      ['a or b and c', '(a or (b and c))'],
      ['a and b and c or d', '((a and b and c) or d)'],
      ['a < b < c', '(a < b < c)'],
      ['x if c else y if d else z', '(x if c else (y if d else z))'],
      ['a | b ^ c & d << 1 + 2 * 3', '(a | (b ^ (c & (d << (1 + (2 * 3))))))'],
      ['a - b - c', '((a - b) - c)'],
      ['a // b % c * d', '(((a // b) % c) * d)'],
      ['-x.y[1](2)', '(-x.y[1](2))'],
      ['~a + +b', '((~a) + (+b))'],
      ['not not a', '(not (not a))'],
      ['a in [1, 2, 3]', '(a in [1, 2, 3])'],
      ['a not in s', '(a not in s)'],
      ['a != b >= c', '(a != b >= c)'],
      ['(a + b) * c', '((a + b) * c)'],
      ['1 + 2 == 3 and x', '(((1 + 2) == 3) and x)'],
    ];
    for (const [source, tree] of cases) expect(show(expr(source)), source).toBe(tree);
  });
  it('literals, names, calls with keywords, attributes, subscripts, lists, [v] * N, tuples', () => {
    expect(expr('x = True')).toMatchObject({ type: 'Bool', value: true });
    expect(expr('x = None')).toMatchObject({ type: 'NoneLit' });
    expect(expr('x = 0x3F')).toMatchObject({ type: 'Num', value: 63, raw: '0x3F', base: 16, isFloat: false });
    expect(expr('x = 2.5')).toMatchObject({ type: 'Num', value: 2.5, isFloat: true });
    expect(expr('x = température')).toMatchObject({ type: 'Name', id: 'température' });
    expect(expr('x = ﬁle')).toMatchObject({ type: 'Name', id: 'file' }); // NFKC, like Python
    expect(show(expr('print("a", 1, sep="-", end="")'))).toBe('print("a", 1, sep="-", end="")');
    expect(show(expr('Pin(LED_RED, Pin.OUT, value=1)'))).toBe('Pin(LED_RED, Pin.OUT, value=1)');
    expect(show(expr('f(a, b,)'))).toBe('f(a, b)');
    expect(show(expr('x = [1, 2, 3,]'))).toBe('[1, 2, 3]');
    expect(show(expr('x = []'))).toBe('[]');
    expect(expr('x = [0] * 10')).toMatchObject({ type: 'ListRepeat', list: { elts: [{ value: 0 }] }, count: { value: 10 } });
    expect(expr('x = 5 * [False]')).toMatchObject({ type: 'ListRepeat', list: { elts: [{ value: false }] }, count: { value: 5 } });
    expect(expr('x = (255, 128, 0)')).toMatchObject({ type: 'TupleLit', parenthesized: true, elts: [{ value: 255 }, { value: 128 }, { value: 0 }] });
    expect(expr('x = 1, 2')).toMatchObject({ type: 'TupleLit', parenthesized: false });
    expect(expr('x = ()')).toMatchObject({ type: 'TupleLit', elts: [] });
    expect(expr('x = (1,)')).toMatchObject({ type: 'TupleLit', elts: [{ value: 1 }] });
    expect(expr('x = (y)')).toMatchObject({ type: 'Name', id: 'y' });
    expect(show(expr('x = a[1, 2]'))).toBe('a[tuple(1, 2)]');
    expect(show(expr('x = a[i]'))).toBe('a[i]');
  });
  it('strings: adjacent literals concatenate, with f-strings too', () => {
    const s = expr('x = "ab" \'cd\'');
    expect(s).toMatchObject({ type: 'Str', value: 'abcd', parts: [{ value: 'ab', column: 5 }, { value: 'cd', column: 10 }] });
    expect(show(expr('x = "T = " f"{t:.1f}" " C"'))).toBe('f["T = " {t:.1f} " C"]');
    const f = expr('x = f"{{a}} {b + 1:>5}"') as FString;
    expect(f.parts.map((p) => p.type)).toEqual(['text', 'field']);
    expect(f.parts[1]).toMatchObject({ type: 'field', spec: { text: '>5', line: 1, column: 20, endColumn: 22 }, unsupported: null, line: 1, column: 13, endColumn: 23 });
    expect(f.parts[1].type === 'field' && at(f.parts[1].value)).toEqual([1, 14, 1, 19]);
    expect(expr('x = "\\d"')).toMatchObject({ type: 'Str', parts: [{ escapes: [{ kind: 'unknown', text: '\\d' }] }] });
  });
  it('positions: every node from its first to just after its last character', () => {
    const e = expr('x = (a + b) * f(c)');
    expect(at(e)).toEqual([1, 5, 1, 19]);
    expect(e.type === 'BinOp' && at(e.left)).toEqual([1, 6, 1, 11]); // parentheses are not part of the inner node
    const multi = first<Assign>('total = (1 +\n         2)\n');
    expect(at(multi)).toEqual([1, 1, 2, 12]);
  });
});

describe('comments (attached by indentation, §4.4) and docstrings', () => {
  const text = (cs: { text: string }[]) => cs.map((c) => c.text);
  it('leading, end-of-line and end-of-block comments', () => {
    const m = parseSource(
      [
        '# setup',
        'x = 1  # one',
        'while True:  # forever',
        '    # blink',
        '    led.on()',
        '    if x:',
        '        y = 2',
        '        # end of if',
        '    # end of loop',
        '# the end',
        '',
      ].join('\n'),
    );
    const [assign, loop] = m.body.stmts;
    expect(text(assign.leading)).toEqual([' setup']);
    expect(text(assign.trailing)).toEqual([' one']);
    expect(text(loop.trailing)).toEqual([' forever']);
    if (loop.type !== 'While') throw new Error('while expected');
    expect(text(loop.body.stmts[0].leading)).toEqual([' blink']);
    const inner = loop.body.stmts[1];
    expect(inner.type === 'If' && text(inner.body.endComments)).toEqual([' end of if']);
    expect(text(loop.body.endComments)).toEqual([' end of loop']);
    expect(text(m.body.endComments)).toEqual([' the end']);
    expect(m.body.endComments[0]).toMatchObject({ line: 10, column: 1 });
  });
  it('a comment before elif / else / except goes to the end of the block before it; header comments into their block', () => {
    const s = first<If>('if a:\n    x()\n# about b\nelif b:  # b\n    y()\nelse:  # other\n    z()\n');
    expect(text(s.body.endComments)).toEqual([' about b']);
    const elif = s.orelse!.stmts[0] as If;
    expect(text(elif.trailing)).toEqual([' b']);
    expect(text(elif.orelse!.stmts[0].leading)).toEqual([' other']);
  });
  it('comments inside brackets and on each line of a statement are its trailing comments; ; lines give them to the last statement', () => {
    expect(text(first('x = [1,  # one\n     # between\n     2]  # two\n').trailing)).toEqual([' one', ' between', ' two']);
    expect(text(body('a = 1; b = 2  # both\n')[1].trailing)).toEqual([' both']);
  });
  it('module and function docstrings are taken out of the body', () => {
    const m = parseSource('"""\nZERO1 Smart Board - 01\n"""\n# after the docstring\nx = 1\n');
    expect(m.docstring).toMatchObject({ type: 'Str', value: '\nZERO1 Smart Board - 01\n', line: 1, endLine: 3 });
    expect(m.body.stmts.map((s) => s.type)).toEqual(['Assign']);
    expect(text(m.body.stmts[0].leading)).toEqual([' after the docstring']);
    const f = first<FunctionDef>('def f():\n    "Beeps."\n    beep()\n');
    expect(f.docstring).toMatchObject({ value: 'Beeps.' });
    expect(f.body.stmts.map((s) => s.type)).toEqual(['ExprStmt']);
    expect(parseSource('x = 1\n"not a docstring"\n').docstring).toBeNull();
    expect(parseSource('f"{x}"\n').docstring).toBeNull();
  });
});

describe('what ZERO1 Python does not have parses into Unsupported (§5.4)', () => {
  /** [source, statement or expression path, code, params, range]. */
  const statements: Array<[string, string, Record<string, string>, number[]]> = [
    ['class Led:\n    pass\n', 'NA-class', {}, [1, 1, 1, 11]],
    ['with open("f") as f:\n    pass\n', 'NA-with', {}, [1, 1, 1, 21]],
    ['async def f():\n    await x\n', 'NA-async', {}, [1, 1, 1, 10]],
    ['match cmd:\n    case "on":\n        led.on()\n    case _: pass\n', 'NA-match', {}, [1, 1, 1, 11]],
    ['@micropython.native\ndef f():\n    pass\n', 'NA-decorator', {}, [1, 1, 1, 20]],
    ['del x\n', 'NA-del', {}, [1, 1, 1, 6]],
    ['def f():\n    nonlocal x\n', 'NA-nonlocal', {}, [2, 5, 2, 15]],
    ['x: int = 5\n', 'NA-annotation', { annotation: ': int' }, [1, 2, 1, 7]],
    ['raise\n', 'NA-raise', {}, [1, 1, 1, 6]],
    ['try:\n    a()\nexcept A:\n    b()\nexcept B:\n    c()\n', 'NA-try', {}, [5, 1, 5, 10]],
    ['try:\n    a()\nfinally:\n    c()\n', 'NA-try', {}, [3, 1, 3, 8]],
    ['try:\n    a()\nexcept (A, B):\n    b()\n', 'NA-try', {}, [3, 1, 3, 15]],
    ['try:\n    a()\nexcept dht.Error:\n    b()\n', 'NA-try', {}, [3, 1, 3, 18]],
    ['def f():\n    def g():\n        pass\n', 'NA-nested-def', { f: 'g' }, [2, 5, 2, 13]],
  ];
  it('statements', () => {
    for (const [source, code, params, range] of statements) {
      const found = findUnsupported(parseSource(source), code);
      expect(found, source).toBeDefined();
      expect(found!.params, source).toEqual(params);
      expect(at(found!), source).toEqual(range);
      expect(message(found!.code, found!.params), code).toMatch(/^ZERO1 Python /);
    }
  });
  it('the statement after a decorator and the match block are still read', () => {
    expect(body('@dec\ndef f():\n    pass\n').map((s) => s.type)).toEqual(['Unsupported', 'FunctionDef']);
    expect(body('match x:\n    case [a, b]:\n        pass\ny = 1\n').map((s) => s.type)).toEqual(['Unsupported', 'Assign']);
    expect(body('match = 5\nmatch(x)\ncase = 1\n').map((s) => s.type)).toEqual(['Assign', 'ExprStmt', 'Assign']); // soft keywords
  });
  it('loop else and loop targets other than a name', () => {
    const w = first('while x:\n    pass\nelse:\n    pass\n');
    expect(w).toMatchObject({ type: 'While', orelse: { type: 'Unsupported', code: 'NA-loop-else', line: 3, column: 1, endColumn: 5 } });
    expect(first('for i in x:\n    pass\nelse:\n    pass\n')).toMatchObject({ orelse: { code: 'NA-loop-else' } });
    expect(first('for i, v in pairs:\n    pass\n')).toMatchObject({ type: 'For', target: { type: 'Unsupported', code: 'NA-unpack', line: 1, column: 5, endColumn: 9 } });
  });
  it('def headers: *args, **kw, /, annotations', () => {
    const f = first<FunctionDef>('def f(a: int, *args, b=1, **kw) -> float:\n    pass\n');
    expect(f.params.map((p) => p.name)).toEqual(['a', 'b']);
    expect(f.unsupported.map((u) => [u.code, u.params.annotation ?? '', ...at(u)])).toEqual([
      ['NA-annotation', ': int', 1, 8, 1, 13],
      ['NA-star-args', '', 1, 15, 1, 20],
      ['NA-star-args', '', 1, 27, 1, 31],
      ['NA-annotation', '-> float', 1, 33, 1, 41],
    ]);
    expect(message('NA-annotation', f.unsupported[0].params)).toBe("ZERO1 Python does not have type annotations yet: remove ': int'.");
  });
  it('expressions', () => {
    const cases: Array<[string, string, number[]]> = [
      ['x = lambda a: a + 1', 'NA-lambda', [1, 5, 1, 20]],
      ['x = [i * i for i in range(10) if i]', 'NA-comprehension', [1, 5, 1, 36]],
      ['x = (i for i in y)', 'NA-comprehension', [1, 5, 1, 19]],
      ['x = {i for i in y}', 'NA-comprehension', [1, 5, 1, 19]],
      ['f(i for i in y)', 'NA-comprehension', [1, 3, 1, 15]],
      ['x = {"a": 1, **d}', 'NA-dict', [1, 5, 1, 18]],
      ['x = {}', 'NA-dict', [1, 5, 1, 7]],
      ['x = {1, 2}', 'NA-dict', [1, 5, 1, 11]],
      ['x = a[1:3]', 'NA-slice', [1, 5, 1, 11]],
      ['x = a[::2]', 'NA-slice', [1, 5, 1, 11]],
      ['x = a[1:2, 3]', 'NA-slice', [1, 5, 1, 14]],
      ['x = (y := 5)', 'NA-walrus', [1, 6, 1, 12]],
      ['x = ...', 'NA-ellipsis', [1, 5, 1, 8]],
      ['x = a @ b', 'NA-matmul', [1, 5, 1, 10]],
      ['x = 2j', 'NA-complex', [1, 5, 1, 7]],
      ["x = b'ab'", 'NA-bytes', [1, 5, 1, 10]],
      ["x = 'a' b'c'", 'NA-bytes', [1, 5, 1, 13]],
      ['x = a is b', 'NA-is', [1, 5, 1, 11]],
      ['x = a is not b', 'NA-is', [1, 5, 1, 15]],
      ['x = a is None', 'NA-none', [1, 5, 1, 14]],
      ['print(*items)', 'NA-star-args', [1, 7, 1, 13]],
      ['f(**options)', 'NA-star-args', [1, 3, 1, 12]],
      ['x = [*a, 1]', 'NA-star-args', [1, 6, 1, 8]],
      ['x = await y', 'NA-async', [1, 5, 1, 12]],
      ['x = f"{v!r}"', 'NA-fstring-spec', [1, 9, 1, 11]],
    ];
    for (const [source, code, range] of cases) {
      const found = findUnsupported(parseSource(`${source}\n`), code);
      expect(found, source).toBeDefined();
      expect(at(found!), source).toEqual(range);
    }
    expect(findUnsupported(parseSource('x = f"{v=}"\n'), 'NA-fstring-spec')!.params).toEqual({ spec: '=' });
    expect(message('NA-fstring-spec', { spec: '!r' })).toBe('ZERO1 Python does not have this format (!r) yet. You can use {x}, {x:.2f}, {n:5d}, {n:03d}, {s:<8}, {n:x}, {n:X}, {n:b}.');
  });
  it('yield anywhere is NA-generator', () => {
    expect(findUnsupported(parseSource('def f():\n    yield 1\n'), 'NA-generator')).toMatchObject({ line: 2, column: 5, endColumn: 12 });
    expect(findUnsupported(parseSource('def f():\n    x = yield\n'), 'NA-generator')).toBeDefined();
    expect(findUnsupported(parseSource('def f():\n    print((yield from g()))\n'), 'NA-generator')).toBeDefined();
  });
  it('unpacking targets other than a, b = … are NA-unpack', () => {
    for (const source of ['a, *b = c\n', '[a, b] = c\n', '*a, = c\n', 'a, (b, c) = d\n', 'x = [a, b] = c\n']) {
      expect(findUnsupported(parseSource(source), 'NA-unpack'), source).toBeDefined();
    }
  });
});

describe('syntax and indentation errors (§5.1): exact message, line, column and end', () => {
  const S = (code: Parameters<typeof message>[0], params: Record<string, string | number> = {}) => message(code, params);
  const cases: Array<[string, string, string, number[]]> = [
    // generic
    ['x = 5 y\n', 'S-syntax', S('S-syntax'), [1, 7, 1, 8]],
    ["print 'hi'\n", 'S-syntax', S('S-syntax'), [1, 7, 1, 11]],
    ['x = 1 +\n', 'S-syntax', S('S-syntax'), [1, 8, 1, 8]],
    ['x = 1;;\n', 'S-syntax', S('S-syntax'), [1, 7, 1, 8]],
    ['if x: if y: pass\n', 'S-syntax', S('S-syntax'), [1, 7, 1, 9]],
    ['else:\n    pass\n', 'S-syntax', S('S-syntax'), [1, 1, 1, 5]],
    ['try:\n    pass\n', 'S-syntax', S('S-syntax'), [3, 1, 3, 1]], // expected 'except' or 'finally' block
    ['x = a if b\n', 'S-syntax', S('S-syntax'), [1, 11, 1, 11]],
    ['if x > 5 then:\n    pass\n', 'S-syntax', S('S-syntax'), [1, 10, 1, 14]],
    ['from m import a,\n', 'S-syntax', S('S-syntax'), [1, 17, 1, 17]],
    // commas and colons
    ['print(1 2)\n', 'S-comma', 'SyntaxError: invalid syntax. Perhaps you forgot a comma?', [1, 7, 1, 10]],
    ['x = [1 2]\n', 'S-comma', S('S-comma'), [1, 6, 1, 9]],
    ['f(a, "b" c)\n', 'S-comma', S('S-comma'), [1, 6, 1, 11]],
    ['print(f"{a b}")\n', 'S-comma', S('S-comma'), [1, 10, 1, 13]],
    ['if x\n    pass\n', 'S-colon', "SyntaxError: expected ':'", [1, 5, 1, 5]],
    ['if x > 5  # check\n    pass\n', 'S-colon', S('S-colon'), [1, 9, 1, 9]],
    ['def f()\n    pass\n', 'S-colon', S('S-colon'), [1, 8, 1, 8]],
    ['for i in range(3)\n    pass\n', 'S-colon', S('S-colon'), [1, 18, 1, 18]],
    ['while True\n    pass\n', 'S-colon', S('S-colon'), [1, 11, 1, 11]],
    ['if x:\n    pass\nelse\n    pass\n', 'S-colon', S('S-colon'), [3, 5, 3, 5]],
    ['if x:\n    pass\nelse if y:\n    pass\n', 'S-else-if', "SyntaxError: expected ':'. In Python, else if is written elif: elif x > 5:", [3, 1, 3, 8]],
    ['if x = 5:\n    pass\n', 'S-assign-in-if', "SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='?", [1, 4, 1, 9]],
    ['while n = 0:\n    pass\n', 'S-assign-in-if', S('S-assign-in-if'), [1, 7, 1, 12]],
    ['if a:\n    pass\nelif b = c:\n    pass\n', 'S-assign-in-if', S('S-assign-in-if'), [3, 6, 3, 11]],
    ['f(a.b = 1)\n', 'S-assign-in-if', S('S-assign-in-if'), [1, 3, 1, 10]],
    // assignments
    ['f() = 1\n', 'S-cannot-assign', "SyntaxError: cannot assign to function call here. Maybe you meant '==' instead of '='?", [1, 1, 1, 4]],
    ['5 = x\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'literal' }), [1, 1, 1, 2]],
    ['a + b = 1\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'expression' }), [1, 1, 1, 6]],
    ['a < b = 1\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'comparison' }), [1, 1, 1, 6]],
    ['True = 1\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'True' }), [1, 1, 1, 5]],
    ['None = 1\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'None' }), [1, 1, 1, 5]],
    ['x if y else z = 1\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'conditional expression' }), [1, 1, 1, 14]],
    ['f"a" = 1\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'f-string expression' }), [1, 1, 1, 5]],
    ['x = 1 = 2\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'literal' }), [1, 5, 1, 6]],
    ['f() += 1\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'function call' }), [1, 1, 1, 4]],
    ['a, b += 1\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'tuple' }), [1, 1, 1, 5]],
    ['for 5 in x:\n    pass\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'literal' }), [1, 5, 1, 6]],
    ['x = {} = 1\n', 'S-cannot-assign', S('S-cannot-assign', { what: 'dict literal' }), [1, 5, 1, 7]],
    // after parsing (like CPython's compiler): the earliest one
    ['return 5\n', 'S-return-outside', "SyntaxError: 'return' outside function", [1, 1, 1, 9]],
    ['while True:\n    pass\nbreak\n', 'S-break-outside', "SyntaxError: 'break' outside loop", [3, 1, 3, 6]],
    ['def f():\n    continue\n', 'S-continue-outside', "SyntaxError: 'continue' not properly in loop", [2, 5, 2, 13]],
    ['for i in x:\n    def f():\n        break\n', 'S-break-outside', S('S-break-outside'), [3, 9, 3, 14]],
    ['while x:\n    pass\nelse:\n    break\n', 'S-break-outside', S('S-break-outside'), [4, 5, 4, 10]],
    ['class A:\n    return 1\n', 'S-return-outside', S('S-return-outside'), [2, 5, 2, 13]],
    ['def f():\n    print(x)\n    global x\n', 'S-global-after-use', "SyntaxError: name 'x' is used prior to global declaration", [3, 5, 3, 13]],
    ['def f():\n    x = 1\n    global x\n', 'S-global-after-use', S('S-global-after-use', { x: 'x' }), [3, 5, 3, 13]],
    ['def f(x):\n    global x\n', 'S-global-after-use', S('S-global-after-use', { x: 'x' }), [2, 5, 2, 13]],
    ['count = 0\nglobal count\n', 'S-global-after-use', S('S-global-after-use', { x: 'count' }), [2, 1, 2, 13]],
    ['f(a=1, a=2)\n', 'S-keyword-repeated', 'SyntaxError: keyword argument repeated: a', [1, 8, 1, 11]],
    ['def f(a, a):\n    pass\n', 'S-duplicate-param', "SyntaxError: duplicate argument 'a' in function definition", [1, 10, 1, 11]],
    ['return 1\nbreak\n', 'S-return-outside', S('S-return-outside'), [1, 1, 1, 9]],
    // during parsing
    ['f(a=1, 2)\n', 'S-positional-after-keyword', 'SyntaxError: positional argument follows keyword argument', [1, 8, 1, 9]],
    ['f(**k, a)\n', 'S-positional-after-keyword', S('S-positional-after-keyword'), [1, 8, 1, 9]],
    ['def f(a=1, b):\n    pass\n', 'S-default-order', 'SyntaxError: parameter without a default follows parameter with a default', [1, 12, 1, 13]],
    // indentation
    ['if x:\npass\n', 'S-indent-expected', "IndentationError: expected an indented block after 'if' statement on line 1. Indent the lines inside it by 4 spaces (press Tab).", [2, 1, 2, 5]],
    ['def f():\nreturn 1\n', 'S-indent-expected', S('S-indent-expected', { kw: 'def', n: 1 }), [2, 1, 2, 7]],
    ['if x:\n    pass\nelse:\npass\n', 'S-indent-expected', S('S-indent-expected', { kw: 'else', n: 3 }), [4, 1, 4, 5]],
    ['while True:\n    if x:\ny = 1\n', 'S-indent-expected', S('S-indent-expected', { kw: 'if', n: 2 }), [3, 1, 3, 2]],
    ['for i in range(3):\n', 'S-indent-expected', S('S-indent-expected', { kw: 'for', n: 1 }), [2, 1, 2, 1]],
    ['try:\n    a()\nexcept:\nb()\n', 'S-indent-expected', S('S-indent-expected', { kw: 'except', n: 3 }), [4, 1, 4, 2]],
    ['x = 1\n    y = 2\n', 'S-indent-unexpected', 'IndentationError: unexpected indent', [2, 5, 2, 6]],
    ['  x = 1\n', 'S-indent-unexpected', S('S-indent-unexpected'), [1, 3, 1, 4]],
    ['# comment\n  x = 1\n', 'S-indent-unexpected', S('S-indent-unexpected'), [2, 3, 2, 4]],
    ['if x:\n    a = 1\n        b = 2\n', 'S-indent-unexpected', S('S-indent-unexpected'), [3, 9, 3, 10]],
    ['if x:\n    pass\n  else:\n    pass\n', 'S-unindent', 'IndentationError: unindent does not match any outer indentation level', [3, 1, 3, 3]],
    ['if x:\n    pass\n\telse:\n    pass\n', 'S-tab', 'TabError: inconsistent use of tabs and spaces in indentation', [3, 1, 3, 2]],
    // lexical errors come first, wherever they are
    ['x = 5 y\nz = "abc\n', 'S-unterminated', 'SyntaxError: unterminated string literal (detected at line 2)', [2, 5, 2, 6]],
    ['x = (1 2\n', 'S-never-closed', "SyntaxError: '(' was never closed", [1, 5, 1, 6]],
  ];
  it.each(cases)('%j → %s', (source, code, text, range) => {
    expect(syntaxError(source)).toEqual({ code, message: text, at: range });
  });
  it('every message of §5.1 has its text, and each is at most 240 characters', () => {
    const codes = new Set<string>(cases.map((c) => c[1]));
    for (const code of ['S-leading-zero', 'S-nbsp', 'S-curly-quote', 'S-invalid-char', 'S-plusplus', 'S-c-operator', 'S-c-comment', 'S-brace', 'S-never-closed', 'S-unmatched', 'S-unterminated', 'S-unterminated-triple']) codes.add(code);
    expect(codes.size).toBe(30);
    for (const code of codes) {
      const text = message(code as Parameters<typeof message>[0]);
      expect(text, code).not.toBe(code);
      expect(text.length, code).toBeLessThanOrEqual(240);
      expect(text, code).toMatch(/^(SyntaxError|IndentationError|TabError): /);
    }
  });
});

describe('pythonToArduino: the real syntax diagnostics, the rest still the stub', () => {
  it('a syntax error: the placeholder with one error, with its code, text and range', () => {
    const result = pythonToArduino('from machine import Pin\n\nif x = 5:\n    pass\n');
    expect(result).toMatchObject({ ok: false, endsAfterSetup: false, usesInput: false });
    expect(result.sketch).toBe(pythonPlaceholder(1));
    expect(placeholderErrorCount(result.sketch)).toBe(1);
    expect(result.diagnostics).toEqual([
      { code: 'S-assign-in-if', severity: 'error', message: message('S-assign-in-if'), line: 3, column: 4, endLine: 3, endColumn: 9 },
    ]);
    expect(result.map.sketchToPython).toEqual([0, 0]);
  });
  it('lexical errors too, with CRLF input on the same lines', () => {
    expect(pythonToArduino('x = 1\r\ny = “2”\r\n').diagnostics[0]).toMatchObject({ code: 'S-curly-quote', line: 2, column: 5, endLine: 2, endColumn: 6 });
    expect(pythonToArduino('while True:\n    x++\n').diagnostics[0]).toMatchObject({ code: 'S-plusplus', line: 2, column: 6 });
  });
  it('a program over 50,000 bytes is X-too-long', () => {
    const result = pythonToArduino(`# ${'é'.repeat(30_000)}\n`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      { code: 'X-too-long', severity: 'error', line: 1, column: 1, message: 'This program is too long for the simulator: 50,000 bytes at most (it has 60,003).' },
    ]);
  });
  it('BLANK_PYTHON and every Python example parse', () => {
    for (const source of [BLANK_PYTHON, ...PYTHON_EXAMPLES.map((e) => e.python)]) expect(() => parseSource(source)).not.toThrow();
    expect(parseSource(PYTHON_EXAMPLES[0].python).docstring?.value).toMatch(/^\nZERO1 Smart Board - 01 Blink the red LED\n/);
    expect(pythonToArduino(PYTHON_EXAMPLES[0].python).ok).toBe(true);
  });
});

/** The first Unsupported node with `code` anywhere in the tree. */
function findUnsupported(node: unknown, code: string): Unsupported | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findUnsupported(item, code);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  const n = node as { type?: string; code?: string };
  if (n.type === 'Unsupported' && n.code === code) return node as Unsupported;
  for (const value of Object.values(node)) {
    const found = findUnsupported(value, code);
    if (found) return found;
  }
  return undefined;
}
