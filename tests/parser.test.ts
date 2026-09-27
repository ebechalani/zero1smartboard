import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CallExpr, FunctionDecl, VarDecl } from '../src/transpiler/ast';
import { tokenize } from '../src/transpiler/lexer';
import { parse, ParseError } from '../src/transpiler/parser';

const EXAMPLES_DIR = join(__dirname, '..', 'src', 'examples');

function fails(src: string): ParseError {
  try {
    parse(src);
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
  throw new Error('expected a ParseError');
}

describe('lexer', () => {
  it('tokenizes literals with the right values', () => {
    const t = tokenize("0x1F 0b101 B10101010 017 42 3.5 .5 1e3 'A' '\\n' \"hi\\t\" 100UL 5u");
    expect(t.map((x) => x.type).slice(0, -1)).toEqual([
      'int', 'int', 'int', 'int', 'int', 'float', 'float', 'float', 'char', 'char', 'string', 'int', 'int',
    ]);
    expect(t.map((x) => x.num ?? x.value).slice(0, -1)).toEqual([31, 5, 170, 15, 42, 3.5, 0.5, 1000, 65, 10, 'hi\t', 100, 5]);
    expect(t[11]!.unsigned && t[11]!.long).toBe(true);
  });

  it('strips comments and joins directive continuations', () => {
    const t = tokenize('#define X 5 // five\n/* block\n*/ int a;\n#define Y 1 \\\n + 2\nint b;');
    expect(t[0]).toMatchObject({ type: 'directive', value: '#define X 5', line: 1 });
    expect(t[4]).toMatchObject({ type: 'directive', value: '#define Y 1   + 2', line: 4 });
    expect(t[5]).toMatchObject({ type: 'keyword', value: 'int', line: 6 });
    expect(() => tokenize('int a; #define Y 1')).toThrow(/stray '#'/);
  });

  it('reports positions of bad characters', () => {
    expect(() => tokenize('int a = 5;\nint b = @;')).toThrow(/unexpected character '@'/);
    const e = fails('int a = 5;\nint b = @;');
    expect(e.line).toBe(2);
    expect(e.column).toBe(9);
  });
});

describe('parser: declarations', () => {
  it('normalizes types', () => {
    const p = parse('unsigned long int a; byte b; boolean c; uint8_t d; long unsigned e; const int f = 1; static float g; short int h;');
    const names = p.body.map((d) => (d as VarDecl).type.name);
    expect(names).toEqual(['unsigned long', 'unsigned char', 'bool', 'unsigned char', 'unsigned long', 'int', 'float', 'short']);
    expect((p.body[5] as VarDecl).type.isConst).toBe(true);
    expect((p.body[6] as VarDecl).type.isStatic).toBe(true);
  });

  it('distinguishes function declarations from constructor calls', () => {
    const p = parse('Servo s(4); int f(int x); LiquidCrystal_I2C lcd(0x27, 16, 2); void g() {} Servo t;');
    expect(p.body.map((d) => d.kind)).toEqual(['VarDecl', 'FunctionDecl', 'VarDecl', 'FunctionDecl', 'VarDecl']);
    const s = p.body[0] as VarDecl;
    expect(s.type.name).toBe('Servo');
    expect(s.declarators[0]!.ctorArgs).toHaveLength(1);
    const f = p.body[1] as FunctionDecl;
    expect(f.params[0]).toMatchObject({ name: 'x', type: { name: 'int' } });
    expect(f.body).toBeNull();
    expect((p.body[4] as VarDecl).declarators[0]!.ctorArgs).toBeNull();
  });

  it('parses arrays, initializer lists and multiple declarators', () => {
    const p = parse('byte digits[10] = {B00111111, 0x06}; int grid[2][3] = {{1,2,3},{4,5,6}}; int a = 1, b[3], c;');
    const d = p.body[0] as VarDecl;
    expect(d.declarators[0]!.arrayDims).toHaveLength(1);
    expect(d.declarators[0]!.init?.kind).toBe('InitializerList');
    const g = p.body[1] as VarDecl;
    expect(g.declarators[0]!.arrayDims).toHaveLength(2);
    expect((p.body[2] as VarDecl).declarators.map((x) => x.name)).toEqual(['a', 'b', 'c']);
  });

  it('parses #define, #include and enum', () => {
    const p = parse('#include <Servo.h>\n#include "x.h"\n#define LED A1\n#define DEBUG\nenum Mode { OFF, ON = 5, AUTO };\nvoid setup(){}\nvoid loop(){}');
    expect(p.body[0]).toMatchObject({ kind: 'Include', path: 'Servo.h', system: true });
    expect(p.body[1]).toMatchObject({ kind: 'Include', path: 'x.h', system: false });
    expect(p.body[2]).toMatchObject({ kind: 'Define', name: 'LED', value: { kind: 'Identifier', name: 'A1' } });
    expect(p.body[3]).toMatchObject({ kind: 'Define', name: 'DEBUG', value: null });
    expect(p.body[4]).toMatchObject({ kind: 'EnumDecl', name: 'Mode' });
    expect((p.body[4] as { members: { name: string }[] }).members.map((m) => m.name)).toEqual(['OFF', 'ON', 'AUTO']);
  });

  it('parses prototypes, static locals and functions with array params', () => {
    const p = parse('void blink(int n);\nvoid show(char msg[], int grid[][3]) { static int count = 0; count++; }');
    expect((p.body[0] as FunctionDecl).body).toBeNull();
    const show = p.body[1] as FunctionDecl;
    expect(show.params[0]!.arrayDims).toEqual([null]);
    expect(show.params[1]!.arrayDims).toHaveLength(2);
    const stat = show.body!.body[0] as VarDecl;
    expect(stat.type.isStatic).toBe(true);
  });
});

describe('parser: statements and expressions', () => {
  const sketch = `
    void setup() {
      int x = 3, y = 4;
      x += y * 2 - (x / 2) % 3;
      x = x << 1 | 0x0F & ~y ^ 1;
      bool ok = x > 2 && y <= 4 || !x;
      int z = ok ? x : y;
      x++; ++y; y--; --x;
      float f = (float) x / 2;
      long l = long(f);
      unsigned int s = sizeof(x) + sizeof(int);
      char c = 'a' + 1;
      switch (c) { case 'a': x = 1; break; case 'b': case 'c': { x = 2; } break; default: x = 0; }
      do { x--; } while (x > 0);
      for (int i = 0, j = 10; i < j; i++, j--) { if (i == 5) continue; else if (i == 7) break; }
      for (;;) { break; }
      while (digitalRead(6) == HIGH) ;
      String name = "Ze" "ro";
      name.toUpperCase();
      int n = name.length();
      Serial.println(name.substring(0, 2) + n);
      return;
    }
    void loop() {}
  `;

  it('parses a kitchen-sink sketch', () => {
    const p = parse(sketch);
    const setup = p.body[0] as FunctionDecl;
    expect(setup.name).toBe('setup');
    const body = setup.body!.body;
    expect(body[1]).toMatchObject({ kind: 'ExprStmt', expr: { kind: 'AssignExpr', op: '+=' } });
    const prec = (body[3] as { declarators: { init: { op: string; left: { op: string } } }[] }).declarators[0]!.init;
    expect(prec.op).toBe('||');
    expect(prec.left.op).toBe('&&');
    expect(body[4]).toMatchObject({ kind: 'VarDecl', declarators: [{ init: { kind: 'ConditionalExpr' } }] });
    expect(body[5]).toMatchObject({ expr: { kind: 'UnaryExpr', op: '++', prefix: false } });
    expect(body[6]).toMatchObject({ expr: { kind: 'UnaryExpr', op: '++', prefix: true } });
    expect(body[9]).toMatchObject({ declarators: [{ init: { kind: 'BinaryExpr', op: '/', left: { kind: 'CastExpr', type: { name: 'float' } } } }] });
    expect(body[10]).toMatchObject({ declarators: [{ init: { kind: 'CastExpr', type: { name: 'long' } } }] });
    expect(body[12]).toMatchObject({ declarators: [{ init: { kind: 'BinaryExpr', left: { kind: 'CharLiteral', value: 97 } } }] });
    const sw = body[13] as { kind: string; cases: { test: unknown }[] };
    expect(sw.kind).toBe('SwitchStmt');
    expect(sw.cases).toHaveLength(4);
    expect(sw.cases[3]!.test).toBeNull();
    expect(body[14]!.kind).toBe('DoWhileStmt');
    expect(body[15]).toMatchObject({ kind: 'ForStmt', init: { kind: 'VarDecl' }, update: { kind: 'CommaExpr' } });
    expect(body[16]).toMatchObject({ kind: 'ForStmt', init: null, test: null, update: null });
    expect(body[17]).toMatchObject({ kind: 'WhileStmt', body: { kind: 'EmptyStmt' } });
    expect(body[18]).toMatchObject({ declarators: [{ init: { kind: 'StringLiteral', value: 'Zero' } }] });
    expect(body[19]).toMatchObject({ expr: { kind: 'CallExpr', callee: { kind: 'MemberExpr', property: 'toUpperCase' } } });
    const call = (body[21] as { expr: CallExpr }).expr;
    expect(call.callee).toMatchObject({ kind: 'MemberExpr', object: { name: 'Serial' }, property: 'println' });
    expect(call.args[0]).toMatchObject({ kind: 'BinaryExpr', op: '+', left: { kind: 'CallExpr' } });
  });

  it('parses String(...) and functional casts as expressions', () => {
    const p = parse('void setup() { String s = String(3.14, 2); int v = int(2.5); byte b = byte(300); }');
    const body = (p.body[0] as FunctionDecl).body!.body;
    expect(body[0]).toMatchObject({ declarators: [{ init: { kind: 'CallExpr', callee: { kind: 'Identifier', name: 'String' } } }] });
    expect(body[1]).toMatchObject({ declarators: [{ init: { kind: 'CastExpr', type: { name: 'int' } } }] });
    expect(body[2]).toMatchObject({ declarators: [{ init: { kind: 'CastExpr', type: { name: 'unsigned char' } } }] });
  });

  it('records pointer and reference types for codegen to reject', () => {
    const p = parse('const char* msg = "hi"; void f(int &x) {}');
    expect((p.body[0] as VarDecl).type).toMatchObject({ name: 'char', pointer: 1, isConst: true });
    expect((p.body[1] as FunctionDecl).params[0]!.type.reference).toBe(true);
  });

  it('positions nodes at their first token', () => {
    const p = parse('\n\n  int  count = 7;');
    const d = p.body[0] as VarDecl;
    expect(d.pos).toEqual({ line: 3, column: 3 });
    expect(d.declarators[0]!.pos).toEqual({ line: 3, column: 8 });
    expect(d.declarators[0]!.init!.pos).toEqual({ line: 3, column: 16 });
  });
});

describe('parser: errors', () => {
  it('missing semicolon', () => {
    const e = fails('void setup() {\n  int a = 5\n  int b = 6;\n}\nvoid loop(){}');
    expect(e.message).toBe("expected ';' before 'int'");
    expect(e.line).toBe(3);
    expect(e.column).toBe(3);
  });

  it('function-like macro', () => {
    const e = fails('#define SQ(x) ((x)*(x))\nvoid setup(){}\nvoid loop(){}');
    expect(e.message).toMatch(/function-like macros/);
    expect(e.line).toBe(1);
  });

  it('struct', () => {
    const e = fails('struct P { int x; };\nvoid setup(){}\nvoid loop(){}');
    expect(e.message).toMatch(/struct/);
    expect(e.line).toBe(1);
  });

  it('#ifdef', () => {
    const e = fails('#ifdef DEBUG\n#endif\nvoid setup(){}\nvoid loop(){}');
    expect(e.message).toMatch(/conditional compilation/);
  });

  it('missing closing brace', () => {
    const e = fails('void setup() {\n  if (true) {\n}\nvoid loop(){}');
    expect(e.message).toMatch(/'}' is probably missing/);
  });

  it('missing parenthesis', () => {
    const e = fails('void setup() {\n  digitalWrite(13, HIGH;\n}');
    expect(e.message).toBe("expected ')' before ';'");
    expect(e.line).toBe(2);
  });

  it('code outside functions', () => {
    const e = fails('digitalWrite(13, HIGH);\nvoid setup(){}\nvoid loop(){}');
    expect(e.message).toMatch(/inside a function/);
    expect(e.line).toBe(1);
  });

  it('default parameters and nested functions', () => {
    expect(fails('void f(int x = 3) {}').message).toMatch(/default parameter/);
    expect(fails('void setup() { void g() {} }').message).toMatch(/inside another function/);
  });
});

describe('parser: example sketches', () => {
  const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.ino'));
  it('has all 48 example sketches', () => {
    expect(files.length).toBe(48);
  });
  for (const f of files) {
    it(`parses ${f}`, () => {
      const program = parse(readFileSync(join(EXAMPLES_DIR, f), 'utf8'));
      const functions = program.body.filter((d) => d.kind === 'FunctionDecl').map((d) => (d as FunctionDecl).name);
      expect(functions).toContain('setup');
      expect(functions).toContain('loop');
    });
  }
});
