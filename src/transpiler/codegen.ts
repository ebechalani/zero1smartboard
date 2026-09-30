/**
 * Code generator: AST → JavaScript (docs/ARCHITECTURE.md §4.4).
 *
 * The output is the body of `new Function('__rt', js)`. Every sketch function
 * becomes `async`, every call is awaited, C integer semantics are preserved
 * through the `__i16`-style helpers, and cooperative `__tick()` yields are
 * inserted at function entries and loop back-edges.
 */
import type {
  Block,
  Declarator,
  Expression,
  FunctionDecl,
  InitializerList,
  Pos,
  Program,
  Statement,
  TypeSpec,
  VarDecl,
} from './ast';
import { isTypeSpec } from './ast';
import {
  BIT_MACROS,
  CONSTANT_TYPES,
  CONSTANT_VALUES,
  CORE_RETURN,
  FLOAT_BOXING_CALLEES,
  GLOBAL_OBJECTS,
  KNOWN_CLASSES,
  KNOWN_RUNTIME_NAMES,
  METHOD_RETURN,
  NUMERIC_CALLEES,
  PWM_PIN_NUMBERS,
  RAW_CHAR_ARRAY_CALLEES,
  STRING_MUTATORS,
} from './signatures';
import {
  arithResult,
  bitWidth,
  commonType,
  defaultValue,
  describeType,
  isChar,
  isCharArray,
  isFloat,
  isIntegral,
  isNumeric,
  isStringLike,
  isUnsigned,
  printKind,
  promote,
  sizeOf,
  T,
  typeFromSpec,
  wrapHelper,
  type StaticType,
} from './typesys';
import type { Diagnostic } from '../types';

/**
 * Member names a sketch may never reach (docs/CLASSROOM.md §3.4, X1): through them the
 * generated JavaScript could climb from a runtime object to `Function` and run arbitrary
 * code on the page (`Serial.constructor.constructor("...")()`). The runtime (`__m` in
 * src/runtime/libs/strings.ts) refuses the same names; tests/codegen.test.ts keeps both
 * lists equal.
 */
export const FORBIDDEN_MEMBER_NAMES: readonly string[] = ['constructor', 'prototype', '__proto__', 'caller', 'callee', 'arguments', 'call', 'apply', 'bind'];

/** Whether `name` is a member a sketch may not use: one of FORBIDDEN_MEMBER_NAMES or a `__` helper name. */
export function isForbiddenMember(name: string): boolean {
  return name.startsWith('__') || FORBIDDEN_MEMBER_NAMES.includes(name);
}

export class CodegenError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(message);
    this.name = 'CodegenError';
  }
}

export interface CodegenResult {
  js: string;
  lineMap: number[];
  warnings: Diagnostic[];
}

/** Helper names destructured from `__rt` at the top of the generated code (§4.4). */
export const PRELUDE_HELPERS = [
  '__i8',
  '__u8',
  '__i16',
  '__u16',
  '__i32',
  '__u32',
  '__f32',
  '__bool',
  '__idiv',
  '__imod',
  '__imul',
  '__shl',
  '__shr',
  '__ftoi',
  '__ftou',
  '__tick',
  '__array',
  '__cstr',
  '__chr',
  '__flt',
  '__str',
  '__m',
  '__mut',
  '__charAt',
] as const;

const JS_RESERVED: ReadonlySet<string> = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'let', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'await', 'arguments',
  'eval', 'undefined', 'NaN', 'Infinity', 'async', 'of',
]);

type SymbolKind = 'var' | 'const' | 'param' | 'func';

interface Sym {
  kind: SymbolKind;
  jsName: string;
  type: StaticType;
  /** Known element counts per dimension for arrays (undefined when unknown, e.g. array parameters). */
  arrayLengths?: number[];
  /** Compile-time constant value (for `#define`, enum members, `const int x = 5`). */
  constValue?: number;
  returnType?: StaticType;
  paramTypes?: StaticType[];
  declaredAt: Pos;
}

class Scope {
  readonly symbols = new Map<string, Sym>();
  constructor(readonly parent: Scope | null) {}
  lookup(name: string): Sym | undefined {
    return this.symbols.get(name) ?? this.parent?.lookup(name);
  }
}

interface ExprResult {
  code: string;
  type: StaticType;
  /** Can be assigned to. */
  lvalue: boolean;
  /** For arrays: known lengths of the remaining dimensions. */
  arrayLengths?: number[];
  node: Expression;
  /** Compile-time value when known (the value the board computes: wrapped or rounded like the C type). */
  constValue?: number;
  /**
   * The `__rt` helper whose result `code` already is (`__i16`, `__f32`, …): storing it into a
   * variable wrapped by the same helper needs no second wrapper.
   */
  wrapped?: string;
}

/** A numeric operand after the usual arithmetic conversions (docs/ARCHITECTURE.md §4.4 rule 4). */
interface Operand {
  code: string;
  constValue?: number;
}

const STRING_INDEX_METHODS: ReadonlySet<string> = new Set(['substring', 'remove', 'charAt', 'toCharArray', 'getBytes', 'reserve']);

/** Arduino.h macros that compute in the type of their argument, so an integer result wraps like it (`sq(300)` in an int). */
const INTEGER_MACROS: ReadonlySet<string> = new Set(['sq', 'abs']);

export class CodeGen {
  private readonly lines: string[] = [];
  private readonly lineMap: number[] = [];
  private readonly warnings: Diagnostic[] = [];
  private readonly statics: { text: string; line: number }[] = [];
  private readonly enumNames = new Set<string>();
  private readonly globalScope = new Scope(null);
  private scope: Scope = this.globalScope;
  private indent = 0;
  private curLine = 0;
  private currentFunction: FunctionDecl | null = null;
  private staticCounter = 0;
  private usesSerialPrint: Pos | null = null;
  private callsSerialBegin = false;

  constructor(private readonly program: Program) {}

  // ---------------------------------------------------------------------------
  // emission helpers
  // ---------------------------------------------------------------------------

  private emit(text: string, line = this.curLine): void {
    this.lines.push('  '.repeat(this.indent) + text);
    this.lineMap.push(line);
  }

  private warn(pos: Pos, message: string): void {
    if (this.warnings.some((w) => w.line === pos.line && w.column === pos.column && w.message === message)) return;
    this.warnings.push({ line: pos.line, column: pos.column, message, severity: 'warning' });
  }

  private fail(pos: Pos, message: string): never {
    throw new CodegenError(message, pos.line, pos.column);
  }

  private mangle(name: string): string {
    if (JS_RESERVED.has(name) || name.startsWith('__')) return `${name}$`;
    return name;
  }

  private declare(name: string, sym: Omit<Sym, 'jsName'> & { jsName?: string }): Sym {
    const existing = this.scope.symbols.get(name);
    if (existing) {
      if (existing.kind === 'func' && sym.kind === 'func') return existing;
      this.fail(sym.declaredAt, `redeclaration of '${name}' (it was already declared on line ${existing.declaredAt.line})`);
    }
    const full: Sym = { ...sym, jsName: sym.jsName ?? this.mangle(name) };
    this.scope.symbols.set(name, full);
    return full;
  }

  private pushScope(): void {
    this.scope = new Scope(this.scope);
  }

  private popScope(): void {
    this.scope = this.scope.parent ?? this.globalScope;
  }

  // ---------------------------------------------------------------------------
  // program
  // ---------------------------------------------------------------------------

  generate(): CodegenResult {
    this.collectSignatures();

    this.curLine = 0;
    this.emit('"use strict";');
    this.emit(`const { ${PRELUDE_HELPERS.join(', ')} } = __rt;`);
    this.emit('return (async () => {');
    this.indent++;

    for (const item of this.program.body) {
      switch (item.kind) {
        case 'Include':
          break;
        case 'Define':
          this.genDefine(item.name, item.value, item.pos);
          break;
        case 'EnumDecl':
          this.genEnum(item);
          break;
        case 'VarDecl':
          this.genVarDecl(item, 'global');
          break;
        case 'FunctionDecl':
          break;
      }
    }
    for (const item of this.program.body) {
      if (item.kind === 'FunctionDecl' && item.body) this.genFunction(item);
    }
    for (const s of this.statics) this.emit(s.text, s.line);

    this.curLine = 0;
    this.emit("return { setup, loop, serialEvent: typeof serialEvent === 'function' ? serialEvent : undefined };");
    this.indent--;
    this.emit('})();');

    if (this.usesSerialPrint && !this.callsSerialBegin) {
      this.warn(
        this.usesSerialPrint,
        'Serial.print() is used but Serial.begin(9600) is never called: nothing will appear in the Serial Monitor',
      );
    }
    return { js: this.lines.join('\n'), lineMap: this.lineMap, warnings: this.warnings };
  }

  /** Pass 0: function signatures and enum names, so that forward references type-check. */
  private collectSignatures(): void {
    for (const item of this.program.body) {
      if (item.kind === 'EnumDecl' && item.name) this.enumNames.add(item.name);
    }
    const defined = new Set<string>();
    for (const item of this.program.body) {
      if (item.kind !== 'FunctionDecl') continue;
      if (item.body) {
        if (defined.has(item.name)) this.fail(item.pos, `function '${item.name}' is defined twice`);
        defined.add(item.name);
      }
      const returnType = this.declaredType(item.returnType, 0, item.pos);
      const paramTypes = item.params
        .filter((p) => !(p.type.name === 'void' && p.name === null))
        .map((p) => this.declaredType(p.type, p.arrayDims.length, p.pos));
      const existing = this.globalScope.symbols.get(item.name);
      if (existing && existing.kind !== 'func') this.fail(item.pos, `'${item.name}' is already declared as a variable`);
      if (!existing) {
        this.globalScope.symbols.set(item.name, {
          kind: 'func',
          jsName: this.mangle(item.name),
          type: T.unknown,
          returnType,
          paramTypes,
          declaredAt: item.pos,
        });
      }
    }
    const setup = this.globalScope.symbols.get('setup');
    const loop = this.globalScope.symbols.get('loop');
    if (!setup || !loop || !defined.has('setup') || !defined.has('loop')) {
      this.fail(this.program.pos, 'sketch must define void setup() and void loop()');
    }
  }

  private declaredType(spec: TypeSpec, dims: number, pos: Pos): StaticType {
    if (spec.reference) this.fail(pos, "references ('&' parameters) are not supported; pass the value or use a global variable");
    if (spec.pointer > 0 && !(spec.name === 'char' && spec.pointer === 1)) {
      this.fail(pos, 'pointers are not supported by the simulator (except const char* for text)');
    }
    return typeFromSpec(spec, dims, this.enumNames);
  }

  private genDefine(name: string, value: Expression | null, pos: Pos): void {
    this.curLine = pos.line;
    let code = '1';
    let type: StaticType = T.int;
    let constValue: number | undefined = 1;
    if (value) {
      const r = this.genExpr(value);
      code = r.code;
      type = r.type;
      constValue = r.constValue;
    }
    const sym = this.declare(name, { kind: 'const', type, constValue, declaredAt: pos });
    this.emit(`const ${sym.jsName} = ${code};`);
  }

  private genEnum(e: { name: string | null; members: { name: string; value: Expression | null; pos: Pos }[]; pos: Pos }): void {
    let next = 0;
    for (const m of e.members) {
      this.curLine = m.pos.line;
      let value = next;
      if (m.value) {
        const r = this.genExpr(m.value);
        if (r.constValue === undefined) this.fail(m.pos, `enum value for '${m.name}' must be a constant`);
        value = r.constValue;
      }
      const sym = this.declare(m.name, { kind: 'const', type: T.int, constValue: value, declaredAt: m.pos });
      this.emit(`const ${sym.jsName} = ${value};`);
      next = value + 1;
    }
  }

  // ---------------------------------------------------------------------------
  // functions
  // ---------------------------------------------------------------------------

  private genFunction(f: FunctionDecl): void {
    const sym = this.globalScope.symbols.get(f.name)!;
    this.curLine = f.pos.line;
    this.pushScope();
    const paramNames: string[] = [];
    const coercions: string[] = [];
    for (const p of f.params) {
      if (p.type.name === 'void' && p.name === null) continue;
      const type = this.declaredType(p.type, p.arrayDims.length, p.pos);
      const name = p.name ?? `__unused${paramNames.length}`;
      const ps = this.declare(name, { kind: 'param', type, declaredAt: p.pos });
      paramNames.push(ps.jsName);
      const helper = wrapHelper(type);
      if (helper) coercions.push(`${ps.jsName} = ${helper}(${ps.jsName});`);
      else if (type.kind === 'string') coercions.push(`${ps.jsName} = __str(${ps.jsName}, "unknown");`);
    }
    this.emit(`async function ${sym.jsName}(${paramNames.join(', ')}) {`);
    this.indent++;
    for (const c of coercions) this.emit(c);
    this.emit('await __tick();');
    const previous = this.currentFunction;
    this.currentFunction = f;
    for (const s of f.body!.body) this.genStmt(s);
    this.currentFunction = previous;
    this.indent--;
    this.curLine = f.pos.line;
    this.emit('}');
    this.popScope();
  }

  // ---------------------------------------------------------------------------
  // statements
  // ---------------------------------------------------------------------------

  private genStmt(s: Statement): void {
    this.curLine = s.pos.line;
    switch (s.kind) {
      case 'Block':
        this.genBlock(s);
        return;
      case 'EmptyStmt':
        return;
      case 'ExprStmt': {
        if (s.expr.kind === 'BinaryExpr' && s.expr.op === '==') {
          this.warn(s.pos, "statement has no effect: did you mean '=' (assign) instead of '==' (compare)?");
        } else if (s.expr.kind === 'Identifier' || s.expr.kind === 'IntLiteral' || s.expr.kind === 'BinaryExpr') {
          if (s.expr.kind !== 'BinaryExpr') this.warn(s.pos, 'statement has no effect');
        }
        const r = this.genExpr(s.expr, false);
        this.emit(`${r.code};`);
        return;
      }
      case 'VarDecl':
        this.genVarDecl(s, 'local');
        return;
      case 'IfStmt': {
        const test = this.genExpr(s.test);
        this.emit(`if (${test.code}) {`);
        this.genNested(s.consequent);
        if (s.alternate) {
          this.curLine = s.alternate.pos.line;
          if (s.alternate.kind === 'IfStmt') {
            this.emit('} else');
            this.genStmt(s.alternate);
            return;
          }
          this.emit('} else {');
          this.genNested(s.alternate);
        }
        this.curLine = s.pos.line;
        this.emit('}');
        return;
      }
      case 'WhileStmt': {
        const test = this.genExpr(s.test);
        this.emit(`while (${test.code}) {`);
        this.genLoopBody(s.body);
        this.curLine = s.pos.line;
        this.emit('}');
        return;
      }
      case 'DoWhileStmt': {
        this.emit('do {');
        this.genLoopBody(s.body);
        this.curLine = s.pos.line;
        const test = this.genExpr(s.test);
        this.emit(`} while (${test.code});`);
        return;
      }
      case 'ForStmt': {
        this.pushScope();
        let init = '';
        if (s.init) {
          init = s.init.kind === 'VarDecl' ? this.genVarDecl(s.init, 'for') : this.genExpr(s.init, false).code;
        }
        const test = s.test ? this.genExpr(s.test).code : '';
        const update = s.update ? this.genExpr(s.update, false).code : '';
        this.curLine = s.pos.line;
        this.emit(`for (${init}; ${test}; ${update}) {`);
        this.genLoopBody(s.body);
        this.curLine = s.pos.line;
        this.emit('}');
        this.popScope();
        return;
      }
      case 'SwitchStmt': {
        const d = this.genExpr(s.discriminant);
        if (isStringLike(d.type)) this.fail(s.pos, 'switch cannot be used on a String; use if / else if with == instead');
        this.emit(`switch (${d.code}) {`);
        this.indent++;
        this.pushScope();
        for (const c of s.cases) {
          this.curLine = c.pos.line;
          if (c.test) {
            const t = this.genExpr(c.test);
            if (t.constValue === undefined && !(c.test.kind === 'Identifier')) {
              this.warn(c.pos, 'case labels should be constants');
            }
            this.emit(`case ${t.code}:`);
          } else {
            this.emit('default:');
          }
          this.indent++;
          for (const st of c.body) this.genStmt(st);
          this.indent--;
        }
        this.popScope();
        this.indent--;
        this.curLine = s.pos.line;
        this.emit('}');
        return;
      }
      case 'ReturnStmt': {
        const fn = this.currentFunction;
        const returnType = fn ? this.globalScope.symbols.get(fn.name)!.returnType! : T.void;
        if (returnType.kind === 'void') {
          if (s.argument) this.fail(s.pos, `'${fn?.name}' is declared void and cannot return a value`);
          this.emit('return;');
          return;
        }
        if (!s.argument) {
          this.warn(s.pos, `'${fn?.name}' should return a ${describeType(returnType)} value`);
          this.emit(`return ${defaultValue(returnType)};`);
          return;
        }
        const r = this.genExpr(s.argument);
        this.emit(`return ${this.coerce(r, returnType)};`);
        return;
      }
      case 'BreakStmt':
        this.emit('break;');
        return;
      case 'ContinueStmt':
        this.emit('continue;');
        return;
    }
  }

  private genBlock(b: Block): void {
    this.emit('{');
    this.indent++;
    this.pushScope();
    for (const s of b.body) this.genStmt(s);
    this.popScope();
    this.indent--;
    this.curLine = b.pos.line;
    this.emit('}');
  }

  /** Body of if/else: emitted inside braces the caller opened. */
  private genNested(s: Statement): void {
    this.indent++;
    this.pushScope();
    if (s.kind === 'Block') for (const st of s.body) this.genStmt(st);
    else this.genStmt(s);
    this.popScope();
    this.indent--;
  }

  /** Loop body with the cooperative yield point at the top. */
  private genLoopBody(s: Statement): void {
    this.indent++;
    this.pushScope();
    this.emit('await __tick();');
    if (s.kind === 'Block') for (const st of s.body) this.genStmt(st);
    else this.genStmt(s);
    this.popScope();
    this.indent--;
  }

  // ---------------------------------------------------------------------------
  // variable declarations
  // ---------------------------------------------------------------------------

  /**
   * Emits a declaration (or, for `for` initialisers, returns it as text).
   */
  private genVarDecl(d: VarDecl, context: 'global' | 'local' | 'for'): string {
    const parts: string[] = [];
    for (const decl of d.declarators) {
      this.curLine = decl.pos.line;
      const dims = decl.arrayDims.length;
      const type = this.declaredType(d.type, dims, decl.pos);
      if (type.kind === 'void') this.fail(decl.pos, `variable '${decl.name}' cannot have type void`);

      let arrayLengths: number[] | undefined;
      let code: string;
      let constValue: number | undefined;

      if (type.kind === 'array') {
        const declaredLengths = decl.arrayDims.map((dim) => {
          if (!dim) return null;
          const v = this.genExpr(dim).constValue;
          if (v === undefined || v <= 0 || !Number.isInteger(v)) this.fail(dim.pos, `the size of array '${decl.name}' must be a positive constant`);
          return v;
        });
        const built = this.genArrayInit(decl, type, declaredLengths);
        code = built.code;
        arrayLengths = built.lengths;
      } else if (type.kind === 'class') {
        if (decl.ctorArgs) {
          const args = decl.ctorArgs.map((a) => this.runtimeArg(a, type.name)).join(', ');
          code = `new __rt.${type.name}(${args})`;
        } else if (decl.init) {
          if (decl.init.kind === 'InitializerList') this.fail(decl.pos, `'${decl.name}' cannot be initialised with { }`);
          code = this.genExpr(decl.init).code;
        } else {
          code = `new __rt.${type.name}()`;
        }
      } else if (decl.init) {
        if (decl.init.kind === 'InitializerList') {
          if (decl.init.elements.length !== 1 || decl.init.elements[0]!.kind === 'InitializerList') {
            this.fail(decl.pos, `'${decl.name}' is not an array; remove the { } or add [] after the name`);
          }
          const r = this.genExpr(decl.init.elements[0] as Expression);
          code = this.coerce(r, type);
          constValue = r.constValue;
        } else {
          const r = this.genExpr(decl.init);
          code = this.coerce(r, type);
          constValue = r.constValue;
        }
      } else if (decl.ctorArgs) {
        if (type.kind === 'string') {
          code = `__rt.String(${decl.ctorArgs.map((a) => this.runtimeArg(a, 'String')).join(', ')})`;
        } else if (decl.ctorArgs.length === 1) {
          const r = this.genExpr(decl.ctorArgs[0]!);
          code = this.coerce(r, type);
          constValue = r.constValue;
        } else {
          this.fail(decl.pos, `'${decl.name}' takes a single initial value`);
        }
      } else {
        code = defaultValue(type);
        if (type.kind === 'unknown') code = '0';
      }

      const isConst = d.type.isConst && type.kind !== 'array' && type.kind !== 'class';
      // The value the variable holds: `const int X = 70000;` is 4464 on the board.
      if (constValue !== undefined) constValue = this.foldCast(constValue, type);
      const keepConstValue = isConst || context === 'global' ? constValue : undefined;

      if (d.type.isStatic && context !== 'global') {
        const jsName = `__static_${this.currentFunction?.name ?? 'fn'}_${decl.name}_${this.staticCounter++}`;
        this.declare(decl.name, { kind: isConst ? 'const' : 'var', jsName, type, arrayLengths, constValue: keepConstValue, declaredAt: decl.pos });
        this.statics.push({ text: `let ${jsName} = ${code};`, line: decl.pos.line });
        continue;
      }
      const sym = this.declare(decl.name, { kind: isConst ? 'const' : 'var', type, arrayLengths, constValue: keepConstValue, declaredAt: decl.pos });
      if (context === 'for') {
        parts.push(`${sym.jsName} = ${code}`);
      } else {
        this.emit(`${isConst ? 'const' : 'let'} ${sym.jsName} = ${code};`);
      }
    }
    return parts.length ? `let ${parts.join(', ')}` : '';
  }

  private genArrayInit(
    decl: Declarator,
    type: StaticType & { kind: 'array' },
    declaredLengths: (number | null)[],
  ): { code: string; lengths: number[] } {
    const elem = type.elem;
    const elemDefault = elem.kind === 'class' ? `new __rt.${elem.name}()` : defaultValue(elem);
    const lengths = declaredLengths.map((l) => l ?? 0);

    if (decl.ctorArgs) this.fail(decl.pos, `array '${decl.name}' must be initialised with { } or left empty`);

    if (decl.init && decl.init.kind === 'InitializerList') {
      const list = decl.init;
      if (declaredLengths[0] === null) lengths[0] = list.elements.length;
      for (let i = 1; i < lengths.length; i++) {
        if (declaredLengths[i] === null) this.fail(decl.pos, `only the first dimension of '${decl.name}' may be left empty`);
      }
      const code = this.genInitList(list, elem, lengths, 0, decl.name);
      return { code, lengths };
    }
    if (decl.init && decl.init.kind === 'StringLiteral' && isChar(elem) && type.dims === 1) {
      const codes = Array.from(decl.init.value, (ch) => ch.codePointAt(0) ?? 0);
      codes.push(0);
      if (declaredLengths[0] === null) lengths[0] = codes.length;
      else if (codes.length > lengths[0]!) this.fail(decl.init.pos, `"${decl.init.value}" does not fit in char ${decl.name}[${lengths[0]}] (it needs ${codes.length} characters including the final 0)`);
      while (codes.length < lengths[0]!) codes.push(0);
      return { code: `[${codes.join(', ')}]`, lengths };
    }
    if (decl.init) this.fail(decl.init.pos, `array '${decl.name}' must be initialised with { } (arrays cannot be copied with =)`);
    if (declaredLengths.some((l) => l === null)) this.fail(decl.pos, `array '${decl.name}' needs a size or an initialiser: int ${decl.name}[10] or int ${decl.name}[] = {1, 2, 3}`);
    if (elem.kind === 'class') {
      if (lengths.length !== 1) this.fail(decl.pos, `arrays of ${elem.name} objects must be one-dimensional`);
      return { code: `[${Array.from({ length: lengths[0]! }, () => elemDefault).join(', ')}]`, lengths };
    }
    return { code: `__array([${lengths.join(', ')}], ${elemDefault})`, lengths };
  }

  private genInitList(list: InitializerList, elem: StaticType, lengths: number[], depth: number, name: string): string {
    const size = lengths[depth]!;
    if (list.elements.length > size) this.fail(list.pos, `too many values for array '${name}' (${list.elements.length} given, room for ${size})`);
    const items: string[] = [];
    const isLast = depth === lengths.length - 1;
    for (let i = 0; i < size; i++) {
      const el = list.elements[i];
      if (el === undefined) {
        items.push(isLast ? (elem.kind === 'class' ? `new __rt.${elem.name}()` : defaultValue(elem)) : `__array([${lengths.slice(depth + 1).join(', ')}], ${defaultValue(elem)})`);
      } else if (isLast) {
        if (el.kind === 'InitializerList') this.fail(el.pos, `too many { } levels in the initialiser of '${name}'`);
        const r = this.genExpr(el);
        items.push(this.coerce(r, elem));
      } else {
        if (el.kind !== 'InitializerList') this.fail(el.pos, `expected { } for the inner dimension of '${name}'`);
        items.push(this.genInitList(el, elem, lengths, depth + 1, name));
      }
    }
    return `[${items.join(', ')}]`;
  }

  // ---------------------------------------------------------------------------
  // expressions
  // ---------------------------------------------------------------------------

  /** Expressions already worked out, with the code that reads them (indexedOnce). */
  private readonly fixed = new Map<Expression, ExprResult>();

  private result(node: Expression, code: string, type: StaticType, extra: Partial<ExprResult> = {}): ExprResult {
    return { node, code, type, lvalue: false, ...extra };
  }

  genExpr(e: Expression, valueUsed = true): ExprResult {
    const fixed = this.fixed.get(e);
    if (fixed) return fixed;
    switch (e.kind) {
      case 'IntLiteral': {
        const v = e.value;
        let type: StaticType;
        if (e.unsigned && e.long) type = T.ulong;
        else if (e.long) type = T.long;
        else if (e.unsigned) type = v <= 0xffff ? T.uint : T.ulong;
        else type = v <= 0x7fff ? T.int : v <= 0x7fffffff ? T.long : T.ulong;
        return this.result(e, String(v), type, { constValue: v });
      }
      case 'FloatLiteral': {
        // AVR double is float: a literal the chip cannot hold exactly (0.1) is rounded to single precision.
        // Large values print with an exponent ("3.4e+38"), which must not get a ".0" appended.
        const text = String(e.value);
        const js = Number.isInteger(e.value) && !/e/i.test(text) ? `${text}.0` : text;
        const value = Math.fround(e.value);
        return this.result(e, value === e.value ? js : `__f32(${js})`, T.double, { constValue: value, wrapped: '__f32' });
      }
      case 'CharLiteral':
        return this.result(e, String(e.value), T.char, { constValue: e.value });
      case 'StringLiteral':
        // A literal is a C string: print, String(...), strlen, + … all stop at its first NUL on the board.
        return this.result(e, JSON.stringify(cStringText(e.value)), T.cstring);
      case 'BoolLiteral':
        return this.result(e, e.value ? 'true' : 'false', T.bool, { constValue: e.value ? 1 : 0 });
      case 'Identifier':
        return this.genIdentifier(e);
      case 'UnaryExpr':
        return this.genUnary(e, valueUsed);
      case 'BinaryExpr':
        return this.genBinary(e);
      case 'AssignExpr':
        return this.genAssign(e);
      case 'ConditionalExpr': {
        const t = this.genExpr(e.test);
        const a = this.genExpr(e.consequent);
        const b = this.genExpr(e.alternate);
        const type = commonType(a.type, b.type);
        const conv = (x: ExprResult): string => {
          if (type.kind === 'string') return this.toStringCode(x);
          return isNumeric(x.type) ? this.convertOperand(x, type).code : x.code;
        };
        return this.result(e, `(${t.code} ? ${conv(a)} : ${conv(b)})`, type);
      }
      case 'CallExpr':
        return this.genCall(e, valueUsed);
      case 'MemberExpr': {
        this.checkMemberName(e.property, e.pos);
        const o = this.genExpr(e.object);
        if (o.type.kind === 'class' || o.type.kind === 'unknown') {
          return this.result(e, `${o.code}.${e.property}`, T.unknown, { lvalue: true });
        }
        this.fail(e.pos, `'${e.property}' is not a member of ${describeType(o.type)} (did you forget the parentheses of a method call?)`);
      }
      case 'IndexExpr':
        return this.genIndex(e);
      case 'CastExpr': {
        const type = this.declaredType(e.type, 0, e.pos);
        const v = this.genExpr(e.argument);
        // `(void)x;`: evaluates x and throws the value away (how C++ code says "x is unused on purpose").
        if (type.kind === 'void') return this.result(e, `void (${v.code})`, T.void);
        if (type.kind === 'string') return this.result(e, `__rt.String(${this.boxForPrint(v)})`, T.string);
        const helper = wrapHelper(type);
        if (!helper) this.fail(e.pos, `cannot cast to ${describeType(type)}`);
        const constValue = v.constValue !== undefined ? this.foldCast(v.constValue, type, isFloat(v.type)) : undefined;
        return this.result(e, this.convertCode(v, type, helper!), type, { constValue, wrapped: helper! });
      }
      case 'SizeofExpr': {
        const size = this.sizeofValue(e);
        return this.result(e, String(size), T.uint, { constValue: size });
      }
      case 'CommaExpr': {
        const parts = e.expressions.map((x, i) => this.genExpr(x, i === e.expressions.length - 1 && valueUsed));
        return this.result(e, `(${parts.map((p) => p.code).join(', ')})`, parts[parts.length - 1]!.type);
      }
    }
  }

  private genIdentifier(e: Expression & { kind: 'Identifier' }): ExprResult {
    const sym = this.scope.lookup(e.name);
    if (sym) {
      if (sym.kind === 'func') return this.result(e, sym.jsName, T.unknown);
      return this.result(e, sym.jsName, sym.type, {
        lvalue: sym.kind !== 'const',
        arrayLengths: sym.arrayLengths,
        constValue: sym.kind === 'const' ? sym.constValue : undefined,
      });
    }
    const global = GLOBAL_OBJECTS[e.name];
    if (global) return this.result(e, `__rt.${e.name}`, global);
    const constant = CONSTANT_TYPES[e.name];
    if (constant) return this.result(e, `__rt.${e.name}`, constant, { constValue: CONSTANT_VALUES[e.name] });
    if (KNOWN_RUNTIME_NAMES.has(e.name)) return this.result(e, `__rt.${e.name}`, T.unknown);
    this.fail(e.pos, `'${e.name}' was not declared in this scope`);
  }

  /** X1: refuse the member names that lead out of the sandbox (see FORBIDDEN_MEMBER_NAMES). */
  private checkMemberName(name: string, pos: Pos): void {
    if (isForbiddenMember(name)) this.fail(pos, `'${name}' is not available in the simulator`);
  }

  private genIndex(e: Expression & { kind: 'IndexExpr' }): ExprResult {
    const o = this.genExpr(e.object);
    const i = this.genExpr(e.index);
    return this.indexed(e, o, i, o.code, i.code);
  }

  /** `object[index]` of `e`, with the object and the index written `oCode` and `iCode`. */
  private indexed(e: Expression & { kind: 'IndexExpr' }, o: ExprResult, i: ExprResult, oCode: string, iCode: string): ExprResult {
    if (e.index.kind === 'StringLiteral') this.checkMemberName(e.index.value, e.index.pos);
    if (o.type.kind === 'array') {
      const type: StaticType = o.type.dims > 1 ? { kind: 'array', elem: o.type.elem, dims: o.type.dims - 1 } : o.type.elem;
      // a[true] is a[1] (JavaScript would read a property "true")
      const index = i.type.kind === 'bool' ? `+${iCode}` : iCode;
      return this.result(e, `${oCode}[${index}]`, type, { lvalue: type.kind !== 'array', arrayLengths: o.arrayLengths?.slice(1) });
    }
    if (isStringLike(o.type)) return this.result(e, `__charAt(${oCode}, ${iCode})`, T.char);
    // X1: only a number can index a runtime object or a function (`Serial[k]` with a String k
    // would reach its methods and Function): any other key becomes "NaN".
    if (o.type.kind === 'unknown' || o.type.kind === 'class') return this.result(e, `${oCode}[+(${iCode})]`, T.unknown, { lvalue: true });
    this.fail(e.pos, `'${this.describeNode(e.object)}' is a ${describeType(o.type)}, not an array`);
  }

  /**
   * `a[i] op= v`, `a[i]++`: when the array or the index has effects (`votes[readVote()] += 1`),
   * they are worked out once, like on the board, and `gen` makes the rest with the item written
   * `$obj[$idx]` (a sketch name cannot contain $). Null when the target needs nothing of the kind.
   */
  private indexedOnce(target: Expression, gen: () => ExprResult): ExprResult | null {
    if (target.kind !== 'IndexExpr' || (isPure(target.object) && isPure(target.index))) return null;
    const o = this.genExpr(target.object);
    const i = this.genExpr(target.index);
    this.fixed.set(target, this.indexed(target, o, i, '$obj', '$idx'));
    try {
      const r = gen();
      return { ...r, code: `(await (async ($obj, $idx) => ${r.code})(${o.code}, ${i.code}))` };
    } finally {
      this.fixed.delete(target);
    }
  }

  private genUnary(e: Expression & { kind: 'UnaryExpr' }, valueUsed: boolean): ExprResult {
    switch (e.op) {
      case '++':
      case '--':
        return this.genIncDec(e, valueUsed);
      case '&': {
        if (e.argument.kind === 'Identifier') {
          const sym = this.scope.lookup(e.argument.name);
          if (sym?.kind === 'func') return this.result(e, sym.jsName, T.unknown);
        }
        this.fail(e.pos, "the address-of operator '&' (pointers) is not supported by the simulator");
      }
      case '*':
        this.fail(e.pos, 'pointers are not supported by the simulator');
      case '!': {
        const v = this.genExpr(e.argument);
        const constValue = v.constValue !== undefined ? (v.constValue ? 0 : 1) : undefined;
        return this.result(e, `(!${v.code})`, T.bool, { constValue });
      }
      case '-': {
        const v = this.genExpr(e.argument);
        const raw = v.constValue !== undefined ? -v.constValue : undefined;
        if (isIntegral(v.type)) {
          // -(-32768) is -32768 in a 16-bit int, and -1 is 65535 in an unsigned int.
          const type = promote(v.type);
          return this.wrapInteger(e, `(-${v.code})`, `-${v.code}`, type, raw, raw !== undefined ? this.foldCast(raw, type) : undefined);
        }
        return this.result(e, `(-${v.code})`, v.type, { constValue: raw, wrapped: v.type.kind === 'float' ? v.wrapped : undefined });
      }
      case '+': {
        const v = this.genExpr(e.argument);
        return this.result(e, `(+${v.code})`, isIntegral(v.type) ? promote(v.type) : v.type, { constValue: v.constValue });
      }
      case '~': {
        const v = this.genExpr(e.argument);
        if (!isIntegral(v.type)) return this.result(e, `(~${v.code})`, T.unknown);
        const type = promote(v.type);
        const raw = v.constValue !== undefined ? ~v.constValue : undefined;
        const value = raw !== undefined ? this.foldCast(raw, type) : undefined;
        // JavaScript's ~ gives a signed 32-bit result: only the unsigned types need wrapping.
        if (!isUnsigned(type)) return this.result(e, `(~${v.code})`, type, { constValue: value });
        return this.wrapInteger(e, `(~${v.code})`, `~${v.code}`, type, raw, value);
      }
    }
  }

  private genIncDec(e: Expression & { kind: 'UnaryExpr' }, valueUsed: boolean): ExprResult {
    return this.indexedOnce(e.argument, () => this.incDec(e, valueUsed)) ?? this.incDec(e, valueUsed);
  }

  private incDec(e: Expression & { kind: 'UnaryExpr' }, valueUsed: boolean): ExprResult {
    const target = this.genExpr(e.argument);
    this.requireLvalue(target, e.argument);
    if (!isNumeric(target.type) && target.type.kind !== 'unknown') {
      this.fail(e.pos, `'${e.op}' cannot be applied to a ${describeType(target.type)}`);
    }
    const helper = wrapHelper(target.type);
    const inc = e.op === '++';
    if (target.type.kind === 'float') {
      // f++ is f = f + 1 in single precision (16777216.0 + 1 stays 16777216.0); the old value of f++ comes first.
      const assign = `${target.code} = __f32(${target.code} ${inc ? '+' : '-'} 1)`;
      if (e.prefix || !valueUsed) return this.result(e, `(${assign})`, target.type, { wrapped: '__f32' });
      return this.result(e, `([${target.code}, ${assign}][0])`, target.type, { wrapped: '__f32' });
    }
    if (!helper || target.type.kind === 'bool') {
      const code = e.prefix ? `${e.op}${target.code}` : `${target.code}${e.op}`;
      return this.result(e, `(${code})`, target.type);
    }
    const assign = `${target.code} = ${helper}(${target.code} ${inc ? '+' : '-'} 1)`;
    if (e.prefix || !valueUsed) return this.result(e, `(${assign})`, target.type);
    return this.result(e, `((${assign}), ${helper}(${target.code} ${inc ? '-' : '+'} 1))`, target.type);
  }

  private requireLvalue(r: ExprResult, node: Expression): void {
    if (r.lvalue) return;
    if (node.kind === 'Identifier') {
      const sym = this.scope.lookup(node.name);
      if (sym?.kind === 'const') this.fail(node.pos, `assignment of read-only variable '${node.name}'`);
      if (sym?.kind === 'func') this.fail(node.pos, `'${node.name}' is a function and cannot be assigned`);
      this.fail(node.pos, `'${node.name}' cannot be assigned`);
    }
    if (node.kind === 'IndexExpr' && isStringLike(this.genExpr(node.object).type)) {
      this.fail(node.pos, 'characters of a String cannot be assigned with [ ]; use setCharAt(index, character)');
    }
    this.fail(node.pos, 'this expression cannot be assigned');
  }

  private genBinary(e: Expression & { kind: 'BinaryExpr' }): ExprResult {
    const l = this.genExpr(e.left);
    const r = this.genExpr(e.right);
    const op = e.op;

    if (op === '+' && (l.type.kind === 'string' || r.type.kind === 'string')) {
      return this.result(e, `(${this.toStringCode(l)} + ${this.toStringCode(r)})`, T.string);
    }
    if (op === '+' && (l.type.kind === 'cstring' || r.type.kind === 'cstring') && (isNumeric(l.type) || isNumeric(r.type))) {
      this.warn(e.pos, 'adding a number to a text literal is pointer arithmetic in C++ and does not build a text; use String("...") + value');
      return this.result(e, `(${this.toStringCode(l)} + ${this.toStringCode(r)})`, T.string);
    }
    if (op === '+' && isCharArray(l.type) && isStringLike(r.type)) {
      return this.result(e, `(${this.toStringCode(l)} + ${this.toStringCode(r)})`, T.string);
    }

    if (op === '==' || op === '!=') {
      const jsOp = op === '==' ? '===' : '!==';
      if ((isStringLike(l.type) || isCharArray(l.type)) && (isStringLike(r.type) || isCharArray(r.type))) {
        return this.result(e, `(${this.toStringCode(l)} ${jsOp} ${this.toStringCode(r)})`, T.bool);
      }
      if ((l.type.kind === 'string' && isChar(r.type)) || (r.type.kind === 'string' && isChar(l.type))) {
        this.warn(e.pos, "comparing a String with a character: use text in double quotes (\"a\") or s.charAt(0) == 'a'");
      }
      const [a, b] = this.convertOperands(l, r);
      const constValue = this.foldBinary(op, a.constValue, b.constValue);
      return this.result(e, `(${a.code} ${op === '==' ? '==' : '!='} ${b.code})`, T.bool, { constValue });
    }
    if (op === '<' || op === '>' || op === '<=' || op === '>=') {
      const [a, b] = this.convertOperands(l, r);
      return this.result(e, `(${a.code} ${op} ${b.code})`, T.bool, { constValue: this.foldBinary(op, a.constValue, b.constValue) });
    }
    if (op === '&&' || op === '||') {
      const lb = l.type.kind === 'bool' ? l.code : `!!${l.code}`;
      const rb = r.type.kind === 'bool' ? r.code : `!!${r.code}`;
      return this.result(e, `(${lb} ${op} ${rb})`, T.bool, { constValue: this.foldBinary(op, l.constValue, r.constValue) });
    }

    if (isStringLike(l.type) || isStringLike(r.type) || l.type.kind === 'array' || r.type.kind === 'array' || l.type.kind === 'class' || r.type.kind === 'class') {
      this.fail(e.pos, `'${op}' cannot be applied to ${describeType(l.type)} and ${describeType(r.type)}`);
    }

    // The result has the C type of the operation (a shift has the type of its promoted left operand)
    // and is wrapped or rounded to it right away, like the board computes it (docs/PYTHON.md §6).
    const shift = op === '<<' || op === '>>';
    const type = shift && isIntegral(l.type) ? promote(l.type) : arithResult(l.type, r.type);
    if (type.kind === 'float' && (op === '+' || op === '-' || op === '*' || op === '/')) {
      const a = this.convertOperand(l, type);
      const b = this.convertOperand(r, type);
      const raw = this.foldBinary(op, a.constValue, b.constValue);
      const inner = `${a.code} ${op} ${b.code}`;
      return this.wrapArith(e, `(${inner})`, inner, type, '__f32', raw, raw !== undefined ? Math.fround(raw) : undefined);
    }
    if (type.kind !== 'int') {
      // unknown operands, and the operators C++ refuses on floats (%, bit operators, shifts)
      return this.result(e, `(${l.code} ${op} ${r.code})`, type, { constValue: this.foldBinary(op, l.constValue, r.constValue, type) });
    }
    const wide = bitWidth(type) === 32;
    const unsigned = isUnsigned(type);
    if (op === '/' || op === '%') {
      // -1 / 2u divides 65535 by 2 on the board: the signed operand becomes unsigned first.
      const a = this.convertOperand(l, type);
      const b = this.convertOperand(r, type);
      const raw = this.foldBinary(op, a.constValue, b.constValue, type);
      const code = `${op === '/' ? '__idiv' : '__imod'}(${a.code}, ${b.code})`;
      const helper = wrapHelper(type)!;
      // The quotient of in-range operands is in range, except INT_MIN / -1, which wraps on the board (-32768 / -1 is -32768).
      const mayOverflow = op === '/' && !unsigned && (b.constValue === undefined || b.constValue === -1);
      const value = raw !== undefined ? this.foldCast(raw, type) : undefined;
      return this.result(e, mayOverflow ? `${helper}(${code})` : code, type, { constValue: value, wrapped: helper });
    }
    const raw = this.foldBinary(op, l.constValue, r.constValue, type);
    if (op === '*' && wide) {
      // A double loses the low bits of products above 2^53: the 32-bit product comes from Math.imul.
      const bothConst = l.constValue !== undefined && r.constValue !== undefined;
      const product = bothConst ? Math.imul(l.constValue!, r.constValue!) : undefined;
      const value = product !== undefined && unsigned ? product >>> 0 : product;
      const imul = `__imul(${l.code}, ${r.code})`;
      if (raw !== undefined && value !== undefined && Object.is(raw, value)) return this.result(e, `(${l.code} * ${r.code})`, type, { constValue: value, wrapped: wrapHelper(type)! });
      return this.result(e, unsigned ? `__u32(${imul})` : imul, type, { constValue: value, wrapped: wrapHelper(type)! });
    }
    const value = raw !== undefined ? this.foldCast(raw, type) : undefined;
    // A shift count outside 0..31 (JavaScript takes it mod 32), or known only while running: the board's result.
    if (shift && !(r.constValue !== undefined && r.constValue >= 0 && r.constValue < 32)) {
      const bits = bitWidth(type);
      if (r.constValue !== undefined) {
        // avr-gcc works a fixed count of 32 or more (or a negative one) out while compiling: 0, or -1 for >> of a negative signed value
        const sign = op === '>>' && !unsigned;
        const constValue = l.constValue === undefined ? undefined : sign && l.constValue < 0 ? -1 : 0;
        return this.result(e, sign ? `((${l.code}) < 0 ? -1 : 0)` : `((${l.code}), 0)`, type, { constValue });
      }
      if (op === '<<') return this.wrapInteger(e, `__shl(${l.code}, ${r.code}, ${bits})`, `__shl(${l.code}, ${r.code}, ${bits})`, type, undefined, undefined);
      const operand = unsigned ? this.convertOperand(l, type).code : l.code;
      return this.result(e, `__shr(${operand}, ${r.code}, ${bits}, ${!unsigned})`, type);
    }
    if (op === '+' || op === '-' || op === '*' || op === '<<') {
      return this.wrapInteger(e, `(${l.code} ${op} ${r.code})`, `${l.code} ${op} ${r.code}`, type, raw, value);
    }
    if (op === '>>') {
      const jsOp = unsigned && wide ? '>>>' : '>>';
      const shifted = l.constValue !== undefined && r.constValue !== undefined ? (jsOp === '>>>' ? l.constValue >>> r.constValue : l.constValue >> r.constValue) : undefined;
      return this.result(e, `(${l.code} ${jsOp} ${r.code})`, type, { constValue: shifted });
    }
    // & | ^: JavaScript gives a signed 32-bit result, so only the unsigned types need wrapping
    // (-1 ^ 5u is 65530: the signed operand is converted first, which the wrap reproduces).
    if (unsigned) return this.wrapInteger(e, `(${l.code} ${op} ${r.code})`, `${l.code} ${op} ${r.code}`, type, raw, value);
    return this.result(e, `(${l.code} ${op} ${r.code})`, type, { constValue: value });
  }

  /**
   * An integer result wrapped to the width of its C type (`__i16(a + b)`). When the operands are
   * constants whose plain JavaScript result already fits (`2 * 3`), the wrapper is left out.
   */
  private wrapInteger(e: Expression, plain: string, inner: string, type: StaticType, raw: number | undefined, value: number | undefined): ExprResult {
    return this.wrapArith(e, plain, inner, type, wrapHelper(type)!, raw, value);
  }

  /**
   * `helper(inner)`, or `plain` when the constant result `raw` of the plain code already equals the
   * C `value` (Object.is: a JavaScript -0 is not an integer 0, since 1.0 / -0 is -inf).
   */
  private wrapArith(e: Expression, plain: string, inner: string, type: StaticType, helper: string, raw: number | undefined, value: number | undefined): ExprResult {
    const code = raw !== undefined && value !== undefined && Object.is(raw, value) ? plain : `${helper}(${inner})`;
    return this.result(e, code, type, { constValue: value, wrapped: helper });
  }

  /**
   * An operand converted to the type `to` of the operation (C's usual arithmetic conversions, which
   * JavaScript does not do): a `long` becomes a single-precision float next to a float (16777217 →
   * 16777216.0), and a signed integer becomes unsigned next to an unsigned one (-1 → 65535).
   * Constants that are already exact stay as they are.
   */
  private convertOperand(r: ExprResult, to: StaticType): Operand {
    if (to.kind === 'float') {
      if (r.type.kind !== 'int' || bitWidth(r.type) < 32) return { code: r.code, constValue: r.constValue };
      const value = r.constValue !== undefined ? Math.fround(r.constValue) : undefined;
      if (value !== undefined && value === r.constValue) return { code: r.code, constValue: value };
      return { code: `__f32(${r.code})`, constValue: value };
    }
    if (to.kind === 'int' && isUnsigned(to) && r.type.kind === 'int' && !isUnsigned(r.type)) {
      if (r.constValue !== undefined && r.constValue >= 0) return { code: r.code, constValue: r.constValue };
      const value = r.constValue !== undefined ? this.foldCast(r.constValue, to) : undefined;
      return { code: `${wrapHelper(to)}(${r.code})`, constValue: value };
    }
    return { code: r.code, constValue: r.constValue };
  }

  /** Both operands of a comparison converted to their common type. */
  private convertOperands(l: ExprResult, r: ExprResult): [Operand, Operand] {
    const common = arithResult(l.type, r.type);
    return [this.convertOperand(l, common), this.convertOperand(r, common)];
  }

  private genAssign(e: Expression & { kind: 'AssignExpr' }): ExprResult {
    // `a[i] op= v` reads and writes a[i]: an index with effects is worked out once.
    return (e.op !== '=' ? this.indexedOnce(e.target, () => this.assign(e)) : null) ?? this.assign(e);
  }

  private assign(e: Expression & { kind: 'AssignExpr' }): ExprResult {
    const target = this.genExpr(e.target);
    this.requireLvalue(target, e.target);
    if (target.type.kind === 'array') this.fail(e.pos, 'arrays cannot be assigned as a whole; copy the elements one by one in a loop');
    let value: ExprResult;
    if (e.op === '=') {
      value = this.genExpr(e.value);
    } else {
      const binOp = e.op.slice(0, -1) as (Expression & { kind: 'BinaryExpr' })['op'];
      value = this.genBinary({ kind: 'BinaryExpr', pos: e.pos, op: binOp, left: e.target, right: e.value });
    }
    return this.result(e, `(${target.code} = ${this.coerce(value, target.type)})`, target.type);
  }

  // ---------------------------------------------------------------------------
  // calls
  // ---------------------------------------------------------------------------

  private genCall(e: Expression & { kind: 'CallExpr' }, valueUsed: boolean): ExprResult {
    const callee = e.callee;
    if (callee.kind === 'MemberExpr') return this.genMethodCall(e, callee, valueUsed);
    if (callee.kind !== 'Identifier') this.fail(e.pos, 'this kind of function call is not supported');
    const name = callee.name;
    const sym = this.scope.lookup(name);

    if (sym) {
      if (sym.kind !== 'func') this.fail(callee.pos, `'${name}' is a variable, not a function`);
      const params = sym.paramTypes ?? [];
      if (e.args.length !== params.length) {
        this.fail(e.pos, `'${name}' expects ${params.length} argument${params.length === 1 ? '' : 's'} but ${e.args.length} ${e.args.length === 1 ? 'was' : 'were'} given`);
      }
      const args = e.args.map((a, i) => {
        const r = this.argExpr(a);
        const param = params[i];
        if (param?.kind === 'string') return this.toStringCode(r);
        // The callee wraps its integer parameters on entry; a float argument is first converted like avr-gcc does.
        if (param?.kind === 'int' && isFloat(r.type)) return this.convertCode(r, param, wrapHelper(param)!);
        return r.code;
      });
      return this.result(e, `(await ${sym.jsName}(${args.join(', ')}))`, sym.returnType ?? T.unknown);
    }

    if (BIT_MACROS.has(name)) return this.genBitMacro(e, name);
    if (name === 'F') {
      if (e.args.length !== 1) this.fail(e.pos, 'F() takes exactly one text argument');
      return this.genExpr(e.args[0]!);
    }
    if (KNOWN_CLASSES.has(name)) {
      const args = e.args.map((a) => this.runtimeArg(a, name)).join(', ');
      return this.result(e, `new __rt.${name}(${args})`, { kind: 'class', name });
    }
    if (name === 'String') {
      const args = e.args.map((a) => this.runtimeArg(a, name)).join(', ');
      return this.result(e, `__rt.String(${args})`, T.string);
    }
    if (!KNOWN_RUNTIME_NAMES.has(name) && !CORE_RETURN[name]) {
      this.fail(callee.pos, `'${name}' was not declared in this scope`);
    }
    this.checkCallWarnings(e, name);
    const argResults = e.args.map((a) => ({ r: this.argExpr(a), a }));
    const type = this.returnTypeOf(name, argResults.map((x) => x.r));
    const only = argResults[0]?.r;
    if (name === 'sq' && argResults.length === 1 && only && type.kind === 'int' && bitWidth(type) === 32 && isPure(only.node)) {
      // sq(x) is ((x)*(x)), which evaluates x twice anyway: the square of a long can pass 2^53,
      // where a double loses the low 32 bits.
      const imul = `__imul(${only.code}, ${only.code})`;
      return this.result(e, isUnsigned(type) ? `__u32(${imul})` : imul, type, { wrapped: wrapHelper(type)! });
    }
    // min()/max()/constrain() are macros: they compare and return their arguments in the common type
    // (max(0UL, -7) is -7 as unsigned long, 4294967289).
    const common = CORE_RETURN[name] === 'common' && isNumeric(type) ? type : null;
    const args = argResults.map(({ r, a }) => (common && isNumeric(r.type) ? this.convertOperand(r, common).code : this.wrapRuntimeArg(r, a, name))).join(', ');
    return this.runtimeResult(e, `(await __rt.${name}(${args}))`, type, INTEGER_MACROS.has(name));
  }

  /**
   * The value of a runtime call as the board has it: a float result is rounded to single precision
   * (`sqrt`, `readTemperature`, `toFloat`, …), and `sq`/`abs` of an integer wrap like the Arduino
   * macros they are (`sq(300)` is 24464 in a 16-bit int).
   */
  private runtimeResult(e: Expression, call: string, type: StaticType, wrapsInteger = false): ExprResult {
    const helper = wrapHelper(type);
    if (!helper || !(type.kind === 'float' || (wrapsInteger && type.kind === 'int'))) return this.result(e, call, type);
    const args = call.startsWith('(await ') ? call : `(${call})`;
    return this.result(e, `${helper}${args}`, type, { wrapped: helper });
  }

  private returnTypeOf(name: string, args: ExprResult[]): StaticType {
    const rule = CORE_RETURN[name];
    if (!rule) return T.unknown;
    if (rule === 'firstArg') return args[0] ? (isIntegral(args[0].type) ? promote(args[0].type) : args[0].type) : T.unknown;
    if (rule === 'common') {
      if (args.length < 2) return args[0]?.type ?? T.unknown;
      return args.slice(1).reduce((type, a) => arithResult(type, a.type), args[0]!.type);
    }
    return rule;
  }

  private checkCallWarnings(e: Expression & { kind: 'CallExpr' }, name: string): void {
    if (name === 'delay' && e.args[0]?.kind === 'FloatLiteral') {
      this.warn(e.args[0].pos, 'delay() takes whole milliseconds; the decimal part is ignored');
    }
    if (name === 'analogWrite' && e.args[0]) {
      const pin = this.genExpr(e.args[0]).constValue;
      if (pin !== undefined && !PWM_PIN_NUMBERS.has(pin)) {
        this.warn(
          e.args[0].pos,
          `analogWrite() only dims on PWM pins 3, 5, 6, 9, 10 and 11; on ${this.pinLabel(pin)} it just switches the output on (value > 127) or off`,
        );
      }
    }
  }

  private pinLabel(pin: number): string {
    return pin >= 14 && pin <= 19 ? `A${pin - 14}` : `pin ${pin}`;
  }

  private genMethodCall(e: Expression & { kind: 'CallExpr' }, callee: Expression & { kind: 'MemberExpr' }, valueUsed: boolean): ExprResult {
    const name = callee.property;
    if (callee.object.kind === 'Identifier' && callee.object.name === 'Serial' && !this.scope.lookup('Serial')) {
      if (name === 'begin') this.callsSerialBegin = true;
      if ((name === 'print' || name === 'println' || name === 'write') && !this.usesSerialPrint) this.usesSerialPrint = e.pos;
    }
    const recv = this.genExpr(callee.object);
    this.checkMemberName(name, callee.pos); // after the receiver, so the innermost bad name is reported

    if (recv.type.kind === 'string' || recv.type.kind === 'cstring') {
      if (name === 'length' && e.args.length === 0) return this.result(e, `${recv.code}.length`, T.uint);
      const args = e.args
        .map((a) => {
          const r = this.argExpr(a);
          if (isChar(r.type) && !STRING_INDEX_METHODS.has(name)) return `__chr(${r.code})`;
          if (isFloat(r.type) && (name === 'concat' || name === 'replace')) return `__flt(${r.code})`;
          if (isCharArray(r.type) && !RAW_CHAR_ARRAY_CALLEES.has(name)) return `__cstr(${r.code})`;
          return r.code;
        })
        .join(', ');
      if (STRING_MUTATORS.has(name)) {
        if (!recv.lvalue) {
          this.warn(e.pos, `${name}() changes the String it is called on, but this String is not a variable, so nothing changes`);
          return this.result(e, `__mut(${recv.code}, "${name}", [${args}])`, T.string);
        }
        const assign = `(${recv.code} = __mut(${recv.code}, "${name}", [${args}]))`;
        if (name === 'concat') return this.result(e, `(${assign}, true)`, T.bool);
        return this.result(e, assign, T.void);
      }
      const type = METHOD_RETURN[name] ?? T.unknown;
      return this.runtimeResult(e, `__m(${recv.code}, "${name}", [${args}])`, type);
    }

    if (isNumeric(recv.type)) {
      this.fail(callee.pos, `'${this.describeNode(callee.object)}' is a ${describeType(recv.type)}; numbers have no methods (did you mean a String?)`);
    }
    if (recv.type.kind === 'array') {
      this.fail(callee.pos, `arrays have no methods; use sizeof(${this.describeNode(callee.object)}) / sizeof(${this.describeNode(callee.object)}[0]) for the length`);
    }

    // write(buffer, n) sends n bytes, so a literal buffer keeps what follows a NUL ("\x02\0\x10", 3).
    const bytesOf = (a: Expression, i: number): ExprResult | null =>
      name === 'write' && i === 0 && e.args.length === 2 && a.kind === 'StringLiteral' ? this.result(a, JSON.stringify(a.value), T.cstring) : null;
    const argResults = e.args.map((a, i) => ({ r: bytesOf(a, i) ?? this.argExpr(a), a }));
    const args = argResults.map(({ r, a }) => this.wrapRuntimeArg(r, a, name)).join(', ');
    const type = METHOD_RETURN[name] ?? T.unknown;
    if (recv.type.kind === 'class') return this.runtimeResult(e, `(await ${recv.code}.${name}(${args}))`, type);
    return this.runtimeResult(e, `(await __m(${recv.code}, "${name}", [${args}]))`, type);
  }

  private genBitMacro(e: Expression & { kind: 'CallExpr' }, name: string): ExprResult {
    const expected = name === 'bitWrite' ? 3 : 2;
    if (e.args.length !== expected) this.fail(e.pos, `${name}() expects ${expected} arguments`);
    const target = this.genExpr(e.args[0]!);
    this.requireLvalue(target, e.args[0]!);
    const bit = this.genExpr(e.args[1]!).code;
    const helper = wrapHelper(target.type) ?? '__i32';
    let expr: string;
    switch (name) {
      case 'bitSet':
        expr = `${target.code} | (1 << ${bit})`;
        break;
      case 'bitClear':
        expr = `${target.code} & ~(1 << ${bit})`;
        break;
      case 'bitToggle':
        expr = `${target.code} ^ (1 << ${bit})`;
        break;
      default: {
        const v = this.genExpr(e.args[2]!).code;
        expr = `(${v} ? ${target.code} | (1 << ${bit}) : ${target.code} & ~(1 << ${bit}))`;
      }
    }
    return this.result(e, `(${target.code} = ${helper}(${expr}))`, target.type);
  }

  /** Argument expression, allowing `&isr` for function references. */
  private argExpr(a: Expression): ExprResult {
    if (a.kind === 'UnaryExpr' && a.op === '&' && a.prefix && a.argument.kind === 'Identifier') {
      const sym = this.scope.lookup(a.argument.name);
      if (sym?.kind === 'func') return this.result(a, sym.jsName, T.unknown);
    }
    return this.genExpr(a);
  }

  /** Generate + box an argument for a runtime function or library method. */
  private runtimeArg(a: Expression, calleeName: string): string {
    return this.wrapRuntimeArg(this.argExpr(a), a, calleeName);
  }

  private wrapRuntimeArg(r: ExprResult, _a: Expression, calleeName: string): string {
    if (isChar(r.type) && !NUMERIC_CALLEES.has(calleeName)) return `__chr(${r.code})`;
    if (isCharArray(r.type) && !RAW_CHAR_ARRAY_CALLEES.has(calleeName)) return `__cstr(${r.code})`;
    if (isFloat(r.type) && FLOAT_BOXING_CALLEES.has(calleeName)) return `__flt(${r.code})`;
    return r.code;
  }

  private boxForPrint(r: ExprResult): string {
    if (isChar(r.type)) return `__chr(${r.code})`;
    if (isFloat(r.type)) return `__flt(${r.code})`;
    if (isCharArray(r.type)) return `__cstr(${r.code})`;
    return r.code;
  }

  // ---------------------------------------------------------------------------
  // conversions
  // ---------------------------------------------------------------------------

  /** Code for `r` used as a String operand. */
  private toStringCode(r: ExprResult): string {
    if (r.type.kind === 'string' || r.type.kind === 'cstring') return r.code;
    if (isCharArray(r.type)) return `__cstr(${r.code})`;
    return `__str(${r.code}, "${printKind(r.type)}")`;
  }

  /** Code that stores `r` into a slot of type `to` (assignment coercion, §4.4 rule 4). */
  private coerce(r: ExprResult, to: StaticType): string {
    if (to.kind === 'string') return this.toStringCode(r);
    if (to.kind === 'cstring') return isCharArray(r.type) ? `__cstr(${r.code})` : r.code;
    const helper = wrapHelper(to);
    if (!helper) return r.code;
    if (r.type.kind === 'string' || r.type.kind === 'cstring' || isCharArray(r.type)) {
      this.fail(r.node.pos, `a text value cannot be stored in a ${describeType(to)} variable (use .toInt() or .toFloat())`);
    }
    if (r.wrapped === helper || this.literalFits(r, to)) return r.code;
    return this.convertCode(r, to, helper);
  }

  /**
   * `r` converted to the numeric type `to` by its `helper`. A float becomes an integer the way
   * avr-gcc converts it (`__ftoi` = `__fixsfsi`, `__ftou` = `__fixunssfsi`, then the width), so an
   * out-of-range value gives the board's result (3e9 → -2147483648 in a long), not JavaScript's modulo.
   */
  private convertCode(r: ExprResult, to: StaticType, helper: string): string {
    if (!(isFloat(r.type) && to.kind === 'int')) return `${helper}(${r.code})`;
    const fix = `${isUnsignedFix(to) ? '__ftou' : '__ftoi'}(${r.code})`;
    return bitWidth(to) === 32 ? fix : `${helper}(${fix})`;
  }

  /** Skip the wrapper for literals that already fit the target type (keeps the generated code readable). */
  private literalFits(r: ExprResult, to: StaticType): boolean {
    const n = r.node;
    if (n.kind === 'BoolLiteral') return to.kind === 'bool';
    if (to.kind === 'bool') return false;
    if (n.kind === 'FloatLiteral') return to.kind === 'float' && Math.fround(n.value) === n.value;
    if (n.kind !== 'IntLiteral' && n.kind !== 'CharLiteral') return false;
    const v = n.value;
    if (to.kind === 'float') return true;
    if (to.kind !== 'int') return false;
    const width = bitWidth(to);
    if (isUnsigned(to)) return v >= 0 && v < 2 ** width;
    return v >= -(2 ** (width - 1)) && v < 2 ** (width - 1);
  }

  private foldCast(v: number, to: StaticType, fromFloat = false): number | undefined {
    if (to.kind === 'float') return Math.fround(v);
    if (to.kind === 'bool') return v ? 1 : 0;
    if (to.kind !== 'int') return undefined;
    const t = fromFloat ? fixFloat(v, isUnsignedFix(to)) : Math.trunc(v);
    switch (bitWidth(to)) {
      case 8:
        return isUnsigned(to) ? t & 0xff : (t << 24) >> 24;
      case 16:
        return isUnsigned(to) ? t & 0xffff : (t << 16) >> 16;
      default:
        return isUnsigned(to) ? t >>> 0 : t | 0;
    }
  }

  private foldBinary(op: string, a: number | undefined, b: number | undefined, type?: StaticType): number | undefined {
    if (a === undefined || b === undefined) return undefined;
    const intResult = type?.kind === 'int';
    switch (op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return b === 0 ? undefined : intResult ? Math.trunc(a / b) + 0 : a / b;
      case '%':
        return b === 0 ? undefined : intResult ? (a % b) + 0 : a % b;
      case '<<':
        return a << b;
      case '>>':
        return a >> b;
      case '&':
        return a & b;
      case '|':
        return a | b;
      case '^':
        return a ^ b;
      case '==':
        return a === b ? 1 : 0;
      case '!=':
        return a !== b ? 1 : 0;
      case '<':
        return a < b ? 1 : 0;
      case '>':
        return a > b ? 1 : 0;
      case '<=':
        return a <= b ? 1 : 0;
      case '>=':
        return a >= b ? 1 : 0;
      case '&&':
        return a && b ? 1 : 0;
      case '||':
        return a || b ? 1 : 0;
      default:
        return undefined;
    }
  }

  private sizeofValue(e: Expression & { kind: 'SizeofExpr' }): number {
    if (isTypeSpec(e.argument)) return sizeOf(this.declaredType(e.argument, 0, e.pos));
    const r = this.genExpr(e.argument);
    if (r.type.kind === 'array') {
      if (!r.arrayLengths || r.arrayLengths.length === 0 || r.arrayLengths.some((l) => !l)) {
        this.fail(e.pos, 'sizeof cannot measure an array received as a parameter; pass its length as another argument');
      }
      return r.arrayLengths.reduce((acc, l) => acc * l, 1) * sizeOf(r.type.elem);
    }
    if (r.type.kind === 'cstring') return 2;
    return sizeOf(r.type);
  }

  private describeNode(e: Expression): string {
    switch (e.kind) {
      case 'Identifier':
        return e.name;
      case 'IndexExpr':
        return `${this.describeNode(e.object)}[]`;
      case 'MemberExpr':
        return `${this.describeNode(e.object)}.${e.property}`;
      case 'CallExpr':
        return `${this.describeNode(e.callee)}()`;
      default:
        return 'expression';
    }
  }
}

/** Whether evaluating `e` twice is the same as once: no calls, assignments or ++/--. */
function isPure(e: Expression): boolean {
  switch (e.kind) {
    case 'Identifier':
    case 'IntLiteral':
    case 'FloatLiteral':
    case 'CharLiteral':
    case 'BoolLiteral':
      return true;
    case 'UnaryExpr':
      return e.op !== '++' && e.op !== '--' && isPure(e.argument);
    case 'BinaryExpr':
      return isPure(e.left) && isPure(e.right);
    case 'CastExpr':
      return isPure(e.argument);
    case 'IndexExpr':
      return isPure(e.object) && isPure(e.index);
    case 'ConditionalExpr':
      return isPure(e.test) && isPure(e.consequent) && isPure(e.alternate);
    default:
      return false;
  }
}

/**
 * The text of a string literal as a C string: up to its first NUL. On the board a literal is a
 * `const char*` and every use as text reads it with `strlen` (`Serial.print("ab\0cd")` prints
 * "ab", `String("ab\0cd")` holds "ab"). Only `char s[] = "…"` and `write(literal, n)` see the bytes after it.
 */
function cStringText(value: string): string {
  const nul = value.indexOf('\0');
  return nul < 0 ? value : value.slice(0, nul);
}

/** Whether avr-gcc converts a float to integer type `t` with `__fixunssfsi` (16- and 32-bit unsigned) rather than `__fixsfsi`. */
function isUnsignedFix(t: StaticType): boolean {
  return isUnsigned(t) && bitWidth(t) >= 16;
}

/** Compile-time twin of the runtime's `__ftoi` / `__ftou` (src/runtime/helpers.ts). */
function fixFloat(v: number, unsigned: boolean): number {
  if (unsigned) return v > -4294967296 && v < 4294967296 ? Math.trunc(v) >>> 0 : 0;
  return v > -2147483649 && v < 2147483648 ? Math.trunc(v) | 0 : -2147483648;
}

/** Generate JavaScript for a parsed program. Throws CodegenError. */
export function generate(program: Program): CodegenResult {
  return new CodeGen(program).generate();
}
