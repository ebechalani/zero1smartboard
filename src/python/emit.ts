/**
 * The emitter of ZERO1 Python (docs/PYTHON.md §4.7): a checked, typed program (scope.ts,
 * flow.ts, kinds.ts, without errors) becomes an Arduino sketch and its source map (§4.9).
 *
 * Program shape (§2.1): the top-level statements before the final `while True:` go into
 * `setup()`, its body into `loop()` (a `continue` there is `return;`); functions come before
 * `setup()` in Python order (the `.ino` preprocessing makes their prototypes). Declarations follow
 * D1–D4 as kinds.ts placed them; numbers follow N1–N6 (every int is a `long`); comments C1–C4;
 * strings S1. The board API (§3) is lowered by the stable member ids of api.ts; the helpers
 * that make C++ behave like Python (helpers.ts) are added after `loop()`, only when used.
 *
 * Every sketch line records the first line of the Python statement it was made from; scaffolding
 * (header, includes, pin constants, braces, labels, `Serial.begin`, helpers) records 0.
 */
import type {
  Assign,
  AugAssign,
  BinOp,
  Call,
  Comment,
  Compare,
  Expr,
  For,
  FString,
  FunctionDef,
  If,
  ListLit,
  ListRepeat,
  Name,
  Span,
  Stmt,
  Subscript,
  Try,
  TupleLit,
  UnaryOp,
} from './ast';
import { ZERO1_PINS, pinOfText, type ApiConstant, type ApiFunction, type ApiParam, type PartName } from './api';
import type { Flow } from './flow';
import { helperTexts, stopsProgram, type ListSuffix } from './helpers';
import { elementOf, isListKind, type ConstValue, type ElementKind, type Kind, type Typing, type Variable } from './kinds';
import { RESERVED_NAMES } from './reserved-names';
import { childBlocks, isEndlessTest, walkExpr, type DefSite, type FunctionInfo, type Resolved, type Scope } from './scope';
import { SourceMap } from './sourcemap';
import { Order } from '../sketch/order';
import { PINS, type PinName } from '../sketch/pins';

export interface EmitResult {
  sketch: string;
  map: SourceMap;
}

/** Turns a program without errors into its sketch (§4.7) and source map (§4.9). */
export function emit(resolved: Resolved, flow: Flow, typing: Typing): EmitResult {
  return new Emitter(resolved, flow, typing).run();
}

// ---------------------------------------------------------------------------
// C++ text
// ---------------------------------------------------------------------------

/** The first line of every generated sketch (§4.7 layout). */
export const SKETCH_HEADER = '// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.';

/** The pin comments of the goldens (§4.10) where they differ from the Blocks generator's (§3.1). */
const PIN_COMMENTS: Partial<Record<PinName, string>> = {
  POT_LDR: 'potentiometer / light sensor',
  BUTTON_1: 'button 1',
  BUTTON_2: 'button 2',
};

/** The libraries, in the order their includes are written (§4.7). */
const INCLUDE_ORDER = ['Wire', 'LiquidCrystal_I2C', 'DHT', 'Adafruit_NeoPixel', 'Servo'] as const;
type Library = (typeof INCLUDE_ORDER)[number];

/** Trailing comments start at this column (0-based), or two spaces after the code (§4.10). */
const COMMENT_COLUMN = 31;

/** The C++ type of a value (what N1 needs to know: `lit` is an int literal that may take `L`). */
type CType = 'long' | 'narrow' | 'lit' | 'bool' | 'float' | 'String' | 'cstr' | 'color' | 'void';

/** A C++ expression: its text, precedence and type. */
interface Code {
  c: string;
  p: Order;
  t: CType;
}

const code = (c: string, p: Order, t: CType): Code => ({ c, p, t });
const atom = (c: string, t: CType): Code => ({ c, p: Order.ATOMIC, t });

const BITWISE = new Set([Order.SHIFT, Order.BITWISE_AND, Order.BITWISE_XOR, Order.BITWISE_OR]);
const BINARY = new Set([Order.MULTIPLICATIVE, Order.ADDITIVE, Order.SHIFT, Order.RELATIONAL, Order.EQUALITY, Order.BITWISE_AND, Order.BITWISE_XOR, Order.BITWISE_OR, Order.LOGICAL_AND, Order.LOGICAL_OR]);

/**
 * `x` as an operand of an operator of precedence `parent`: parenthesised when it binds less
 * tightly, when it is the right operand of the same precedence, and where GCC's -Wparentheses
 * wants parentheses (arithmetic or comparisons inside bit operations, && inside ||, `!x == y`).
 */
function wrap(x: Code, parent: Order, right = false): string {
  const paren =
    x.p > parent ||
    (right && x.p === parent && parent !== Order.ATOMIC && parent !== Order.UNARY_PREFIX) ||
    (BITWISE.has(parent) && BINARY.has(x.p) && x.p !== parent) ||
    (parent === Order.LOGICAL_OR && x.p === Order.LOGICAL_AND) ||
    ((parent === Order.EQUALITY || parent === Order.RELATIONAL) && !right && x.p === Order.UNARY_PREFIX && x.c.startsWith('!'));
  return paren ? `(${x.c})` : x.c;
}

/** `a op b` at precedence `p`. */
function binary(a: Code, op: string, b: Code, p: Order, t: CType): Code {
  return code(`${wrap(a, p)} ${op} ${wrap(b, p, true)}`, p, t);
}

/** A unary prefix (`-x`, `!x`, `(long)x`); `- -x` keeps its parentheses. */
function prefix(op: string, x: Code, t: CType): Code {
  let inner = wrap(x, Order.UNARY_PREFIX);
  if ((op === '-' || op === '+') && /^[-+]/.test(inner)) inner = `(${inner})`;
  return code(`${op}${inner}`, Order.UNARY_PREFIX, t);
}

/** S1: a C++ string literal of `text` (UTF-8 kept; `"` `\` and control characters escaped; `\xHH` + hex digit and `??` split). */
export function cString(text: string, lcd = false): string {
  const parts: string[] = [];
  let cur = '';
  let splitIfHex = false;
  let splitIfDigit = false;
  let prevQuestion = false;
  for (const ch of text) {
    let out: string;
    const cp = ch.codePointAt(0)!;
    if (lcd && ch === '°') out = '\\xDF';
    else if (ch === '"') out = '\\"';
    else if (ch === '\\') out = '\\\\';
    else if (ch === '\n') out = '\\n';
    else if (ch === '\t') out = '\\t';
    else if (ch === '\r') out = '\\r';
    else if (cp === 0) out = '\\0';
    else if (cp < 0x20 || cp === 0x7f) out = `\\x${cp.toString(16).toUpperCase().padStart(2, '0')}`;
    else out = ch;
    const first = out[0];
    const split = (splitIfHex && out.length === 1 && /[0-9A-Fa-f]/.test(first)) || (splitIfDigit && out.length === 1 && /[0-9]/.test(first)) || (prevQuestion && out === '?');
    if (split) {
      parts.push(cur);
      cur = '';
    }
    cur += out;
    splitIfHex = out.startsWith('\\x');
    splitIfDigit = out === '\\0';
    prevQuestion = out === '?';
  }
  parts.push(cur);
  return parts.map((p) => `"${p}"`).join(' ');
}

/** N6: a float literal as Python's repr() writes it (`0.5`, `3.0`, `1e+30`, `1.5e-05`). */
export function floatLiteral(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? 'INFINITY' : value < 0 ? '-INFINITY' : 'NAN';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const [mantissa, exp] = value.toExponential().split('e');
  const e = Number(exp);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace(/^-/, '').replace('.', '');
  let out: string;
  if (e < -4 || e >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    out = `${m}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  } else if (e < 0) {
    out = `0.${'0'.repeat(-e - 1)}${digits}`;
  } else if (digits.length > e + 1) {
    out = `${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`;
  } else {
    out = `${digits}${'0'.repeat(e + 1 - digits.length)}.0`;
  }
  return negative ? `-${out}` : out;
}

/** A Python int literal in C++ (§2.2): `1_000` → `1000`, `0o17` → `15`, hex and binary kept. */
function intLiteral(raw: string, value: number): string {
  const text = raw.replace(/_/g, '');
  if (/^0[oO]/.test(text)) return String(value);
  return text;
}

/** N1: an int literal as an operand of arithmetic gets `L`. */
function withL(text: string): string {
  return /[lL]$/.test(text) ? text : `${text}L`;
}

/** A trailing comment's text (C2): trailing whitespace trimmed, a final `\` (or `??/`) gets a `.`. */
function commentText(text: string): string {
  const t = text.replace(/\s+$/, '');
  return /\\$|\?\?\/$/.test(t) ? `${t}.` : t;
}

/** `code` with `comment` (`// …`) at column 31, or two (or three: an even column) spaces after it. */
function withComment(text: string, comment: string): string {
  const len = [...text].length;
  const at = len + 2 <= COMMENT_COLUMN ? COMMENT_COLUMN : len + 2 + ((len + 2) % 2);
  return `${text}${' '.repeat(at - len)}${comment}`;
}

// ---------------------------------------------------------------------------
// kinds → C++ types
// ---------------------------------------------------------------------------

function cppType(kind: Kind | ElementKind): string {
  switch (kind) {
    case 'int':
      return 'long';
    case 'float':
      return 'float';
    case 'bool':
      return 'bool';
    case 'str':
      return 'String';
    case 'color':
      return 'unsigned long';
    case 'none':
      return 'void';
    default:
      return 'int'; // Pin, ADC, PWM: a pin number
  }
}

function zeroValue(kind: Kind | ElementKind): string {
  switch (kind) {
    case 'float':
      return '0.0';
    case 'bool':
      return 'false';
    case 'str':
      return '""';
    default:
      return '0';
  }
}

function ctypeOf(kind: Kind | ElementKind | null): CType {
  switch (kind) {
    case 'int':
      return 'long';
    case 'float':
      return 'float';
    case 'bool':
      return 'bool';
    case 'str':
      return 'String';
    case 'color':
      return 'color';
    case 'none':
      return 'void';
    default:
      return 'narrow';
  }
}

const SUFFIX: Readonly<Record<string, ListSuffix>> = { long: 'L', float: 'F', String: 'S', bool: 'B', 'unsigned long': 'C', int: 'P', byte: 'Y' };

// ---------------------------------------------------------------------------
// the writer
// ---------------------------------------------------------------------------

interface Line {
  text: string;
  py: number;
}

/** Lines of one C++ function body, with the pending trailing comment of the statement being written. */
class Out {
  readonly lines: Line[] = [];
  depth = 1;
  private trailing: string[] = [];

  /** The student's trailing comments of the statement about to be written (they go on its first line, C1). */
  setTrailing(comments: ReadonlyArray<{ text: string }>): void {
    this.trailing = comments.map((c) => c.text);
  }

  takeTrailing(): string[] {
    const t = this.trailing;
    this.trailing = [];
    return t;
  }

  line(text: string, py: number, generated: string | null = null): void {
    const student = this.takeTrailing();
    const indent = '  '.repeat(this.depth);
    let comment: string | null = null;
    if (generated !== null && student.length > 0) comment = `// ${[generated, ...student.map((s) => commentText(s).trim())].join('  ')}`;
    else if (generated !== null) comment = `// ${generated}`;
    else if (student.length === 1) comment = `//${commentText(student[0])}`;
    else if (student.length > 1) comment = `// ${student.map((s) => commentText(s).trim()).join('  ')}`;
    this.lines.push({ text: comment ? withComment(indent + text, comment) : indent + text, py });
  }

  comment(text: string, py: number): void {
    this.lines.push({ text: `${'  '.repeat(this.depth)}//${commentText(text)}`, py });
  }

  blankAt(index: number): void {
    this.lines.splice(index, 0, { text: '', py: 0 });
  }
}

/** Where a statement is written. */
interface Ctx {
  scope: Scope;
  fn: FunctionInfo | null;
  out: Out;
  /** The loops around the statement, innermost last (`main`: the main loop, where `continue` is `return;`). */
  loops: Array<'main' | 'loop'>;
  /** Lines that must come before the statement being written (a part made on the spot). */
  pre: string[];
  /** C++ names used for a variable inside a loop (the `i` of `for _ in …`). */
  names: Map<Variable, string>;
  /** Loop variables that index lists without pyIndex(): `for i in range(len(lst))`. */
  safe: Array<{ v: Variable; lists: Set<Variable>; upTo: number }>;
}

// ---------------------------------------------------------------------------
// the emitter
// ---------------------------------------------------------------------------

class Emitter {
  private readonly pins = new Set<PinName>();
  private readonly libraries = new Set<Library>();
  private readonly helpers = new Set<string>();
  private serial = false;
  private readonly sourceLines: string[];
  /** Library object declarations (Python order) and the other globals (first definition order). */
  private readonly objectDecls: Line[] = [];
  /** The count variable of each growable list, the hidden length of each list parameter. */
  private readonly counts = new Map<Variable, string>();
  /** Lists given whole to a function or helper (they cannot be `const`), lists used as LCD bitmaps (`byte`). */
  private readonly passedWhole = new Set<Variable>();
  private readonly byteLists = new Set<Variable>();
  /** Lists that are popped or cleared somewhere (their indexes need pyIndex() even in a range loop). */
  private readonly shrinking = new Set<Variable>();
  /** Statements that give a global its initialiser (D1): their comments go with the declaration when they write nothing where they are. */
  private readonly declaredGlobally = new Set<Stmt>();
  /** Comments of the `if __name__ == "__main__":` guards, before their first statement. */
  private readonly guardComments = new Map<Stmt, Comment[]>();
  private readonly functionScopes: Scope[];

  constructor(
    private readonly resolved: Resolved,
    private readonly flow: Flow,
    private readonly typing: Typing,
  ) {
    this.sourceLines = resolved.source.split('\n');
    this.functionScopes = resolved.functions.map((f) => f.scope);
  }

  run(): EmitResult {
    this.prepass();
    const functions = this.resolved.functions.map((fn) => this.functionDef(fn));
    const setup = this.setupBody();
    const loop = this.loopBody();
    const globals = this.globalDecls();
    return this.assemble(functions, setup, loop, globals);
  }

  // ---- names -------------------------------------------------------------------------------

  /** A C++ name for a hidden variable: `base`, with `_` appended while it is reserved or visible in `scope`. */
  private fresh(scope: Scope, base: string): string {
    const module = this.resolved.moduleScope;
    const taken = (n: string) =>
      RESERVED_NAMES.has(n) || scope.cppNames.has(n) || (scope === module ? this.functionScopes.some((s) => s.cppNames.has(n)) : module.cppNames.has(n));
    let name = base;
    while (taken(name)) name += '_';
    scope.cppNames.add(name);
    return name;
  }

  private nameOf(v: Variable, ctx: Ctx | null): string {
    return ctx?.names.get(v) ?? v.cppName;
  }

  // ---- the program scan ------------------------------------------------------------------------

  private prepass(): void {
    const typing = this.typing;
    for (const guard of this.resolved.mainGuards) {
      const first = guard.type === 'If' ? guard.body.stmts[0] : null;
      if (first) this.guardComments.set(first, [...guard.leading, ...guard.trailing]);
    }
    // Lists: count names, lists given whole, LCD bitmaps, lists that shrink.
    const listVar = (e: Expr) => (e.type === 'Name' ? typing.variableOf(e) : null);
    const markWhole = (e: Expr) => {
      const v = listVar(e);
      if (v?.list) this.passedWhole.add(v);
    };
    const visitExpr = (x: Expr) => {
      if (x.type === 'Call') {
        const t = typing.callTarget(x);
        if (t.kind === 'function' || (t.kind === 'builtin' && ['print', 'str', 'sum', 'min', 'max'].includes(t.name))) x.args.forEach(markWhole);
        if (t.kind === 'function') x.keywords.forEach((k) => markWhole(k.value));
        if (t.kind === 'method' && t.member.id === 'LCD.custom_char' && x.args[1]) {
          const v = listVar(x.args[1]);
          if (v?.list) this.byteLists.add(v);
        }
        if (t.kind === 'list-method' && (t.name === 'pop' || t.name === 'clear')) {
          const v = listVar(t.receiver);
          if (v) this.shrinking.add(v);
        }
      } else if (x.type === 'Compare') {
        x.ops.forEach((op, k) => (op === 'in' || op === 'not in') && markWhole(x.comparators[k]));
      } else if (x.type === 'FString') {
        for (const p of x.parts) if (p.type === 'field') markWhole(p.value);
      }
    };
    const visit = (stmts: readonly Stmt[]) => {
      for (const s of stmts) {
        for (const e of stmtExpressions(s)) walkExpr(e, visitExpr);
        for (const b of childBlocks(s)) visit(b.stmts);
      }
    };
    visit(this.resolved.body);
    for (const fn of this.resolved.functions) visit(fn.def.body.stmts);
    for (const v of typing.variables) {
      if (!v.list) continue;
      if (v.list.growable) this.counts.set(v, this.fresh(v.sym.scope, `${v.cppName}Count`));
      else if (v.isParam) this.counts.set(v, this.fresh(v.sym.scope, `${v.cppName}Count`));
    }
    // Statements that are only a global declaration (their comments go there).
    for (const v of typing.variables) {
      const stmt = this.globalInit(v)?.stmt;
      if (stmt) this.declaredGlobally.add(stmt);
    }
  }

  // ---- variables and their declarations -------------------------------------------------------------

  /** The C++ type of a list's items (`byte` for an LCD bitmap). */
  private itemType(v: Variable): string {
    if (this.byteLists.has(v)) return 'byte';
    return cppType(v.list!.elem);
  }

  /**
   * A constant list (§2.9) or a list of Pins (§2.9 Objects) that is never written nor given whole
   * to a function or helper (their array parameters are not `const`): `const`.
   */
  private constList(v: Variable): boolean {
    if (!v.list || v.list.growable || !v.list.neverWritten || this.passedWhole.has(v) || this.byteLists.has(v)) return false;
    return v.constant || v.list.elem === 'Pin';
  }

  /** The number of items of a list variable: its constant length, its count, or the hidden length parameter. */
  private sizeOf(v: Variable): Code {
    const count = this.counts.get(v);
    if (count) return atom(count, 'long');
    return atom(String(v.list?.length ?? 0), 'lit');
  }

  /** A global with an initialiser (D1): the definition that gives it, or null. */
  private globalInit(v: Variable): DefSite | null {
    if (v.storage !== 'global') return null;
    if (v.constant) return v.defs.find((d) => d.kind === 'assign') ?? null;
    const init = v.init;
    if (!init) return null;
    if (v.object && (v.object.part === 'Pin' || v.object.part === 'ADC' || v.object.part === 'PWM') && v.object.pin === null) return null;
    return init;
  }

  /** The variable is declared at `def` (D2, D3), inside the function it belongs to. */
  private declaredAt(v: Variable, def: DefSite): boolean {
    return v.storage !== 'global' && v.declareAt === def && !v.isParam;
  }

  /** Every definition of `v` is a `for` loop that declares its own C++ variable (not changed in the body, not read after it). */
  private headerOnly(v: Variable): boolean {
    if (v.storage === 'global' || v.defs.length === 0) return false;
    // Never read (`for _ in range(3):`, nested ones too): each loop has its own counter.
    if (v.uses.length === 0 && v.defs.every((d) => d.kind === 'for')) return true;
    return v.defs.every((d) => {
      if (d.kind !== 'for' || !d.stmt || d.stmt.type !== 'For') return false;
      const info = this.flow.forLoops.get(d.stmt);
      return !!info && info.assignedInBody.length === 0 && !info.readAfter;
    });
  }

  /** `T name` (or `T name[N]`) for a declaration. */
  private declarator(v: Variable, name = v.cppName): string {
    if (v.list) {
      const size = v.list.growable ? v.list.capacity : v.list.length ?? 0;
      return `${this.itemType(v)} ${name}[${size}]`;
    }
    if (v.object) return `int ${name}`;
    return `${cppType(v.kind)} ${name}`;
  }

  /** Locals declared at the top of their function / setup() / loop() with their zero value (D2, D3). */
  private topDeclarations(storage: 'setup' | 'loop' | 'local', fn: FunctionInfo | null, out: Out): void {
    for (const v of this.typing.variables) {
      if (v.storage !== storage || v.declareAt || v.isParam || v.kind === 'none' || this.headerOnly(v)) continue;
      if (storage === 'local' && v.sym.scope.fn !== fn) continue;
      if (v.uses.length === 0 && v.defs.every((d) => d.kind === 'except')) continue;
      const py = v.defs[0]?.stmt?.line ?? 0;
      if (v.list) {
        out.line(`${this.declarator(v)}${this.listZeroInit(v)};`, py);
        const count = this.counts.get(v);
        if (count && !v.isParam) out.line(`long ${count} = 0;`, py);
      } else {
        out.line(`${this.declarator(v)} = ${zeroValue(v.object ? 'int' : v.kind)};`, py, this.againComment(v));
      }
    }
  }

  /** "// 'answer' again, now a number" on the declaration of `name_2` (§2.9). */
  private againComment(v: Variable): string | null {
    if (v.index < 2) return null;
    const words: Record<string, string> = { int: 'a number', float: 'a number', bool: 'True / False', str: 'text', color: 'a colour' };
    const what = words[v.kind] ?? (isListKind(v.kind) ? 'a list' : `a ${v.kind}`);
    return `'${v.sym.name}' again, now ${what}`;
  }

  /** The initialiser of a local list declared without its items. */
  private listZeroInit(v: Variable): string {
    const t = this.itemType(v);
    if (t === 'String') return '';
    return t === 'bool' ? ' = {false}' : ' = {0}';
  }

  // ---- the globals section ----------------------------------------------------------------------------

  private globalDecls(): Line[] {
    const out: Line[] = [];
    const ctx = this.ctxFor(this.resolved.moduleScope, null, new Out());
    const commented = new Set<Stmt>();
    for (const v of this.typing.variables) {
      if (v.storage !== 'global' || v.kind === 'none') continue;
      if (v.object && !['Pin', 'ADC', 'PWM'].includes(v.object.part)) continue; // library objects: their own section; other parts: no variable (D4)
      const init = this.globalInit(v);
      const stmt = init?.stmt ?? v.defs[0]?.stmt ?? null;
      const py = stmt?.line ?? 0;
      // A statement that wrote nothing where it is: its comments come with its (first) declaration.
      const own = stmt && init?.stmt === stmt && this.silent.has(stmt) && !commented.has(stmt) ? stmt : null;
      if (own) commented.add(own);
      let first = true;
      const push = (text: string, generated: string | null = null) => {
        let comment = generated === null ? null : `// ${generated}`;
        if (own && first) {
          for (const c of [...(this.guardComments.get(own) ?? []), ...own.leading]) out.push({ text: `//${commentText(c.text)}`, py: c.line });
          const trailing = own.trailing.map((c) => c.text);
          if (trailing.length === 1) comment = `//${commentText(trailing[0])}`;
          else if (trailing.length > 1) comment = `// ${trailing.map((t) => commentText(t).trim()).join('  ')}`;
        }
        first = false;
        out.push({ text: comment ? withComment(text, comment) : text, py });
      };
      if (v.object) {
        const value = init?.value;
        if (value && value.type === 'Call') push(`const int ${v.cppName} = ${this.pinCode(value.args[0] ?? value.keywords[0]?.value, ctx).c};`);
        else if (value) push(`const int ${v.cppName} = ${this.expr(value, ctx).c};`);
        else push(`int ${v.cppName} = 0;`);
      } else if (v.list) {
        const count = this.counts.get(v);
        const items = init?.value ? this.listItems(init.value, v, ctx) : null;
        const allZero = !items || items.every((x) => x === '0' || x === 'false' || x === '0.0' || x === '""');
        const room = v.list.growable ? `the list '${v.sym.name}' has room for ${v.list.capacity} items` : null;
        const constant = this.constList(v);
        push(`${constant ? 'const ' : ''}${this.declarator(v)}${allZero && !constant ? '' : ` = {${items!.join(', ')}}`};`, room);
        if (count) push(`long ${count} = ${init?.value ? this.listStartLength(init.value) : 0};`);
      } else if (init && init.value) {
        const value = this.valueOf(init.value, v.kind, ctx);
        const colour = v.kind === 'color' && init.value.type === 'TupleLit' ? `(${init.value.elts.map((e) => this.pySource(e)).join(', ')})` : null;
        push(`${v.constant ? 'const ' : ''}${cppType(v.kind)} ${v.cppName} = ${value.c};`, colour ?? this.againComment(v));
      } else {
        push(`${cppType(v.kind)} ${v.cppName} = ${zeroValue(v.kind)};`, this.againComment(v));
      }
    }
    return out;
  }

  /** Statements that wrote nothing where they are (filled while writing). */
  private readonly silent = new Set<Stmt>();

  /** The library objects section: `Servo servo;`, `LiquidCrystal_I2C lcd(0x27, 16, 2);`, … (Python order). */
  private libraryObject(v: Variable, call: Call, ctx: Ctx): void {
    const name = v.cppName;
    const arg = (n: string, pos: number): Expr | null => call.keywords.find((k) => k.name.name === n)?.value ?? call.args[pos] ?? null;
    const py = v.defs[0]?.stmt?.line ?? call.line;
    switch (v.object!.part) {
      case 'Servo':
        this.libraries.add('Servo');
        this.objectDecls.push({ text: `Servo ${name};`, py });
        break;
      case 'LCD': {
        this.libraries.add('Wire');
        this.libraries.add('LiquidCrystal_I2C');
        const addr = arg('addr', 0);
        const cols = arg('cols', 1);
        const rows = arg('rows', 2);
        const value = (e: Expr | null, dflt: string) => (e ? this.expr(e, ctx).c : dflt);
        this.objectDecls.push({ text: `LiquidCrystal_I2C ${name}(${value(addr, '0x27')}, ${value(cols, '16')}, ${value(rows, '2')});`, py });
        break;
      }
      case 'NeoPixel': {
        this.libraries.add('Adafruit_NeoPixel');
        const pin = this.pinCode(arg('pin', 0), ctx).c;
        const n = arg('n', 1);
        this.objectDecls.push({ text: `Adafruit_NeoPixel ${name}(${n ? this.expr(n, ctx).c : '1'}, ${pin}, NEO_GRB + NEO_KHZ800);`, py });
        break;
      }
      case 'DHT': {
        this.libraries.add('DHT');
        const pin = this.pinCode(arg('pin', 0), ctx).c;
        this.objectDecls.push({ text: `DHT ${name}(${pin}, ${v.object!.cls.name === 'DHT11' ? 'DHT11' : 'DHT22'});`, py });
        break;
      }
      default:
        break;
    }
  }

  // ---- functions ------------------------------------------------------------------------------------------

  private ctxFor(scope: Scope, fn: FunctionInfo | null, out: Out, loops: Array<'main' | 'loop'> = []): Ctx {
    return { scope, fn, out, loops, pre: [], names: new Map(), safe: [] };
  }

  private functionDef(fn: FunctionInfo): Line[] {
    const def = fn.def;
    const ft = this.typing.functions.get(fn)!;
    const out = new Out();
    const ctx = this.ctxFor(fn.scope, fn, out);
    const params = fn.params.map((sym, i) => {
      const kind = ft.paramKinds[i];
      const v = ft.paramVariables[i];
      const name = v?.cppName ?? sym.cppName;
      if (isListKind(kind)) {
        const elem = elementOf(kind)!;
        const count = (v && this.counts.get(v)) ?? this.fresh(fn.scope, `${name}Count`);
        return `${v && this.byteLists.has(v) ? 'byte' : cppType(elem)} ${name}[], long ${count}`;
      }
      return `${cppType(kind)} ${name}`;
    });
    const head: Line[] = [];
    for (const c of def.leading) head.push({ text: `//${commentText(c.text)}`, py: c.line });
    if (def.docstring) for (const l of docLines(def.docstring.value)) head.push({ text: l === '' ? '//' : `// ${commentText(l)}`, py: 0 });
    out.depth = 0;
    out.setTrailing(def.trailing);
    out.line(`${cppType(ft.returnKind)} ${fn.cppName}(${params.join(', ')}) {`, def.line);
    out.depth = 1;
    this.topDeclarations('local', fn, out);
    this.block(def.body.stmts, def.body.endComments, ctx);
    const cfg = this.flow.cfgs.get(fn.scope);
    if (ft.returnKind !== 'none' && cfg?.fallsOff) out.line(`return ${zeroValue(ft.returnKind)};`, 0);
    out.depth = 0;
    out.line('}', 0);
    return [...head, ...out.lines];
  }

  // ---- setup() and loop() --------------------------------------------------------------------------------

  private setupBody(): Line[] {
    const out = new Out();
    const ctx = this.ctxFor(this.resolved.moduleScope, null, out);
    const stmts = this.resolved.main.setup;
    const loop = this.resolved.main.loop;
    this.block(stmts, loop ? [] : this.resolved.module.body.endComments, ctx, loop ? [...(this.guardComments.get(loop) ?? []), ...loop.leading] : []);
    const top = new Out();
    this.topDeclarations('setup', null, top);
    return [...top.lines, ...out.lines];
  }

  private loopBody(): Line[] {
    const loop = this.resolved.main.loop;
    if (!loop) return [];
    const out = new Out();
    const ctx = this.ctxFor(this.resolved.moduleScope, null, out, ['main']);
    this.block(loop.body.stmts, loop.body.endComments, ctx);
    const top = new Out();
    this.topDeclarations('loop', null, top);
    return [...top.lines, ...out.lines];
  }

  // ---- the whole sketch -----------------------------------------------------------------------------------

  private assemble(functions: Line[][], setup: Line[], loop: Line[], globals: Line[]): EmitResult {
    const lines: Line[] = [];
    const add = (text: string, py = 0) => lines.push({ text, py });
    const section = (items: Line[]) => {
      if (items.length === 0) return;
      lines.push(...items);
      add('');
    };
    add(SKETCH_HEADER);
    const doc = this.resolved.module.docstring;
    if (doc) {
      add('/*');
      for (const l of moduleDocLines(doc.value)) add(l.replace(/\*\//g, '* /').replace(/\/\*/g, '/ *'));
      add('*/');
    }
    add('');
    section(INCLUDE_ORDER.filter((l) => this.libraries.has(l)).map((l) => ({ text: `#include <${l}.h>`, py: 0 })));
    const pins = PINS.filter((p) => this.pins.has(p.name) && p.value !== null).map((p) => ({ text: withComment(`const int ${p.name} = ${p.value};`, `// ${PIN_COMMENTS[p.name] ?? p.comment}`), py: 0 }));
    section(pins);
    section(this.objectDecls);
    section(globals);
    for (const f of functions) section(f);
    const needsSerial = this.serial || stopsProgram(this.helpers);
    const loopNode = this.resolved.main.loop;
    const header = loopNode ? (loopNode.test.type === 'Num' ? 'while 1:' : 'while True:') : '';
    add(loopNode ? `// Runs once: the lines before "${header}"` : '// Runs once: the whole program');
    add('void setup() {');
    if (needsSerial) add('  Serial.begin(9600);');
    lines.push(...setup);
    add('}');
    add('');
    if (loopNode) {
      add(`// Runs forever: the body of "${header}" (line ${loopNode.line})`);
      const trailing = loopNode.trailing.map((c) => c.text);
      add(trailing.length > 0 ? withComment('void loop() {', `//${commentText(trailing.join(' //'))}`) : 'void loop() {');
    } else {
      add('// The Python program has no "while True:": it has ended.');
      add('void loop() {');
    }
    lines.push(...loop);
    add('}');
    if (loopNode && this.resolved.module.body.endComments.length > 0) {
      add('');
      for (const c of this.resolved.module.body.endComments) add(`//${commentText(c.text)}`, c.line);
    }
    const helpers = helperTexts(this.helpers);
    if (helpers.length > 0) {
      add('');
      add('// ---- Helpers that make C++ behave like Python ----');
      for (const h of helpers) {
        add('');
        for (const l of h.split('\n')) add(l);
      }
    }
    return { sketch: lines.map((l) => l.text).join('\n') + '\n', map: new SourceMap(lines.map((l) => l.py)) };
  }

  // ---- blocks and statements -----------------------------------------------------------------------------

  /** The Python line before `line` is blank (C4). */
  private blankBefore(line: number): boolean {
    return line > 1 && (this.sourceLines[line - 2] ?? '').trim() === '';
  }

  /**
   * The statements of a block (C1, C4): leading comments before each statement, one blank line
   * kept between two statements, the block's end comments inside its braces. `after` are
   * comments to write at the end (the main loop's leading comments, at the end of setup()).
   */
  private block(stmts: readonly Stmt[], endComments: readonly Comment[], ctx: Ctx, after: readonly Comment[] = []): void {
    const out = ctx.out;
    let written = false;
    for (const s of stmts) {
      if (s.type === 'FunctionDef') continue;
      const leading = [...(this.guardComments.get(s) ?? []), ...s.leading];
      const firstLine = leading[0]?.line ?? s.line;
      const start = out.lines.length;
      const hoisted = this.declaredGlobally.has(s);
      const commentsHere = () => {
        for (const c of leading) out.comment(c.text, c.line);
      };
      // A statement that is only a global declaration takes its comments there.
      if (!hoisted) commentsHere();
      const afterComments = out.lines.length;
      ctx.pre = [];
      out.setTrailing(s.trailing);
      this.stmt(s, ctx);
      const pending = out.takeTrailing();
      if (hoisted && out.lines.length === afterComments) {
        this.silent.add(s);
      } else if (hoisted && out.lines.length > afterComments) {
        // Something was written after all: its comments go here.
        const body = out.lines.splice(afterComments);
        commentsHere();
        out.lines.push(...body);
      }
      if (pending.length > 0 && (s.type === 'Pass' || s.type === 'ExprStmt')) for (const t of pending) out.comment(t, s.line);
      if (out.lines.length > start) {
        if (written && this.blankBefore(firstLine)) out.blankAt(start);
        written = true;
      }
    }
    const tail = [...endComments, ...after];
    if (tail.length > 0) {
      if (written && this.blankBefore(tail[0].line)) out.blankAt(out.lines.length);
      for (const c of tail) out.comment(c.text, c.line);
    }
  }

  /** Lines that must come before the statement (parts made on the spot), written now. */
  private flushPre(ctx: Ctx, py: number): void {
    for (const l of ctx.pre) ctx.out.line(l, py);
    ctx.pre = [];
  }

  private stmt(s: Stmt, ctx: Ctx): void {
    switch (s.type) {
      case 'Assign':
        return this.assign(s, ctx);
      case 'AugAssign':
        return this.augAssign(s, ctx);
      case 'ExprStmt':
        if (s.value.type === 'Call') this.callStmt(s.value, s, ctx);
        return; // a docstring or W-no-effect: nothing
      case 'If':
        return this.ifStmt(s, ctx);
      case 'While':
        return this.whileStmt(s, ctx);
      case 'For':
        return this.forStmt(s, ctx);
      case 'Try':
        return this.tryStmt(s, ctx);
      case 'Return':
        return this.returnStmt(s, ctx);
      case 'Break':
        ctx.out.line('break;', s.line);
        return;
      case 'Continue':
        if (ctx.loops[ctx.loops.length - 1] === 'main') ctx.out.line('return;', s.line, 'continue: start the next round of the loop');
        else ctx.out.line('continue;', s.line);
        return;
      case 'Raise':
        return this.raiseStmt(s, ctx);
      case 'Assert': {
        const test = this.truth(s.test, ctx);
        const msg = s.msg ? this.textWith('AssertionError: ', s.msg, ctx) : '"AssertionError"';
        this.flushPre(ctx, s.line);
        this.fail();
        ctx.out.line(`if (!(${test.c})) pyFail(${s.line}, ${msg});`, s.line);
        return;
      }
      default:
        return; // pass, global, import: nothing
    }
  }

  // ---- assignments -------------------------------------------------------------------------------------------

  private defOf(name: Name): DefSite | null {
    const ref = this.resolved.refs.get(name);
    return ref && ref.kind === 'symbol' ? ref.def : null;
  }

  /** `name = value` with the declaration where D1–D3 put it; nothing for a global with this initialiser. */
  private assignName(target: Name, value: Code | string, ctx: Ctx, py: number): void {
    const v = this.typing.variableOf(target);
    const def = this.defOf(target);
    if (!v || !def) return;
    if (this.globalInit(v) === def) return;
    const text = typeof value === 'string' ? value : value.c;
    const name = this.nameOf(v, ctx);
    if (this.declaredAt(v, def)) ctx.out.line(`${this.declarator(v, name)} = ${text};`, py, this.againComment(v));
    else ctx.out.line(`${name} = ${text};`, py);
  }

  private assign(s: Assign, ctx: Ctx): void {
    const value = s.value;
    const first = s.targets[0];
    if (first.type === 'TupleTarget') return this.tupleAssign(s, ctx);
    if (value.type === 'Call') {
      const t = this.typing.callTarget(value);
      if (t.kind === 'class' && first.type === 'Name') return this.construct(first, value, s, ctx);
      if (t.kind === 'list-method' && t.name === 'pop' && first.type === 'Name') return this.popStmt(value, first, s, ctx);
    }
    if ((value.type === 'ListLit' || value.type === 'ListRepeat') && first.type === 'Name') return this.listCreation(first, value, s, ctx);
    const kind = this.typing.kindOf(value);
    const valueCode = this.valueOf(value, kind, ctx);
    this.flushPre(ctx, s.line);
    // a = b = e: `a = e; b = a;` when `a` is a name, else a temporary.
    const firstIsName = first.type === 'Name';
    let source: Code = valueCode;
    if (s.targets.length > 1 && !firstIsName) {
      const tmp = this.fresh(ctx.scope, 't');
      ctx.out.line(`${cppType(kind ?? 'int')} ${tmp} = ${valueCode.c};`, s.line);
      source = atom(tmp, valueCode.t);
    }
    s.targets.forEach((t, i) => {
      const from = i > 0 && firstIsName ? this.nameCode(first as Name, ctx) : source;
      this.assignTarget(t, from, value, s, ctx);
    });
  }

  /** The C++ name a written name has here (for `b = a` after `a = e`). */
  private nameCode(n: Name, ctx: Ctx): Code {
    const v = this.typing.variableOf(n);
    return atom(v ? this.nameOf(v, ctx) : n.id, v ? ctypeOf(v.kind) : 'long');
  }

  private assignTarget(t: Expr | Stmt | { type: string }, value: Code, valueExpr: Expr | null, s: Stmt, ctx: Ctx): void {
    const e = t as Expr;
    if (e.type === 'Name') {
      const v = this.typing.variableOf(e);
      if (v && v.constant) return; // declared with its value in the globals section
      this.assignName(e, value, ctx, s.line);
      return;
    }
    if (e.type === 'Subscript') {
      const base = this.typing.kindOf(e.value);
      if (base === 'NeoPixel') {
        const np = this.expr(e.value, ctx).c;
        const index = this.pixelIndex(e.value, e.index, ctx);
        const colour = valueExpr && valueExpr.type === 'TupleLit' && this.typing.constValue(valueExpr) === null ? valueExpr.elts.map((x) => this.expr(x, ctx).c).join(', ') : value.c;
        this.flushPre(ctx, s.line);
        ctx.out.line(`${np}.setPixelColor(${index}, ${colour});`, s.line);
        return;
      }
      const item = this.subscriptTarget(e, ctx);
      this.flushPre(ctx, s.line);
      ctx.out.line(`${item} = ${value.c};`, s.line);
    }
  }

  /** `lst[i]` as something to assign to. */
  private subscriptTarget(e: Subscript, ctx: Ctx): string {
    const v = e.value.type === 'Name' ? this.typing.variableOf(e.value) : null;
    const base = this.expr(e.value, ctx);
    return `${wrap(base, Order.UNARY_POSTFIX)}[${v ? this.listIndex(v, e.index, e.line, ctx) : this.expr(e.index, ctx).c}]`;
  }

  /** `a, b = e1, e2`: each temporary of its own target's kind, then the targets (§2.4). */
  private tupleAssign(s: Assign, ctx: Ctx): void {
    const tuple = s.targets[0] as { type: 'TupleTarget'; elts: Array<Name | Subscript | Expr> };
    const values = (s.value as TupleLit).elts;
    const targetNames = new Set(tuple.elts.filter((x): x is Name => x.type === 'Name').map((x) => x.id));
    const readsTarget = values.some((x) => {
      let hit = false;
      walkExpr(x, (y) => {
        if (y.type === 'Name' && targetNames.has(y.id)) hit = true;
        if (y.type === 'Subscript') hit = true;
      });
      return hit;
    });
    const codes = values.map((x, i) => this.valueOf(x, this.targetKind(tuple.elts[i] as Expr) ?? this.typing.kindOf(x), ctx));
    this.flushPre(ctx, s.line);
    if (!readsTarget) {
      tuple.elts.forEach((t, i) => this.assignTarget(t, codes[i], values[i], s, ctx));
      return;
    }
    // Targets declared here get their zero value first; then one block with the temporaries.
    for (const t of tuple.elts) {
      if (t.type !== 'Name') continue;
      const v = this.typing.variableOf(t);
      const def = this.defOf(t);
      if (v && def && this.declaredAt(v, def)) ctx.out.line(`${this.declarator(v, this.nameOf(v, ctx))} = ${zeroValue(v.kind)};`, s.line);
    }
    const temps = tuple.elts.map((_, i) => this.fresh(ctx.scope, `t${i + 1}`));
    const parts: string[] = [];
    tuple.elts.forEach((t, i) => parts.push(`${cppType(this.targetKind(t as Expr) ?? this.typing.kindOf(values[i]) ?? 'int')} ${temps[i]} = ${codes[i].c};`));
    tuple.elts.forEach((t, i) => {
      const e = t as Expr;
      if (e.type === 'Name') {
        const v = this.typing.variableOf(e);
        parts.push(`${v ? this.nameOf(v, ctx) : e.id} = ${temps[i]};`);
      } else if (e.type === 'Subscript') {
        parts.push(`${this.subscriptTarget(e, ctx)} = ${temps[i]};`);
      }
    });
    this.flushPre(ctx, s.line);
    ctx.out.line(`{ ${parts.join(' ')} }`, s.line);
  }

  /** The kind a target holds (the variable written, or a list's items). */
  private targetKind(t: Expr): Kind | null {
    if (t.type === 'Name') return this.typing.variableOf(t)?.kind ?? null;
    if (t.type === 'Subscript') return elementOf(this.typing.kindOf(t.value)) as Kind | null;
    return null;
  }

  private augAssign(s: AugAssign, ctx: Ctx): void {
    const t = s.target;
    if (t.type === 'Name') {
      const rv = this.typing.readVariableOf(t);
      const wv = this.typing.variableOf(t);
      if (!rv || !wv) return;
      const def = this.defOf(t);
      const read = atom(this.nameOf(rv, ctx), ctypeOf(rv.kind));
      const simple = rv === wv && this.simpleAug(s.op, wv.kind, s.value);
      if (simple) {
        const value = this.augValue(s, wv.kind, ctx);
        this.flushPre(ctx, s.line);
        ctx.out.line(`${this.nameOf(wv, ctx)} ${s.op}= ${value.c};`, s.line);
        return;
      }
      const result = this.binop(s.op, read, t, s.value, wv.kind, s.value.line, ctx, null, rv.kind);
      this.flushPre(ctx, s.line);
      if (def && this.declaredAt(wv, def)) ctx.out.line(`${this.declarator(wv, this.nameOf(wv, ctx))} = ${result.c};`, s.line, this.againComment(wv));
      else ctx.out.line(`${this.nameOf(wv, ctx)} = ${result.c};`, s.line);
      return;
    }
    if (t.type === 'Subscript') {
      const elem = elementOf(this.typing.kindOf(t.value)) as Kind | null;
      const item = this.subscriptTarget(t, ctx);
      if (elem && this.simpleAug(s.op, elem, s.value)) {
        const value = this.augValue(s, elem, ctx);
        this.flushPre(ctx, s.line);
        ctx.out.line(`${item} ${s.op}= ${value.c};`, s.line);
        return;
      }
      const result = this.binop(s.op, atom(item, ctypeOf(elem)), t, s.value, elem ?? 'int', s.value.line, ctx, null, elem);
      this.flushPre(ctx, s.line);
      ctx.out.line(`${item} = ${result.c};`, s.line);
    }
  }

  /** `x op= e` stays a C++ compound assignment: + - * on numbers and text, bit operations on ints, / on a decimal number. */
  private simpleAug(op: string, kind: Kind, value: Expr): boolean {
    const vk = this.typing.kindOf(value);
    if (kind === 'str') return op === '+';
    if (kind === 'int') return ['+', '-', '*', '&', '|', '^', '<<', '>>'].includes(op) && vk !== 'float';
    if (kind === 'float') return ['+', '-', '*', '/'].includes(op);
    if (kind === 'bool') return ['&', '|', '^'].includes(op) && vk === 'bool';
    return false;
  }

  /** The right side of a compound assignment (a guarded divisor for `/=`). */
  private augValue(s: AugAssign, kind: Kind, ctx: Ctx): Code {
    if (s.op === '/' && !this.nonZeroConstant(s.value)) return this.guard(this.expr(s.value, ctx), this.typing.kindOf(s.value), s.value.line);
    if (kind === 'str') return this.textCode(s.value, ctx);
    return this.expr(s.value, ctx);
  }

  // ---- parts (§3) ------------------------------------------------------------------------------------------------

  /** `x = Class(…)`: the declaration (D4) and the lines the part needs where it is made. */
  private construct(target: Name, call: Call, s: Stmt, ctx: Ctx): void {
    const v = this.typing.variableOf(target);
    const def = this.defOf(target);
    const t = this.typing.callTarget(call);
    if (!v || t.kind !== 'class') return;
    const part = t.cls.part;
    const name = this.nameOf(v, ctx);
    if (part === 'Servo' || part === 'LCD' || part === 'NeoPixel' || part === 'DHT') this.libraryObject(v, call, ctx);
    if (part === 'Pin' || part === 'ADC' || part === 'PWM') {
      const pin = this.pinCode(call.args[0] ?? call.keywords.find((k) => k.name.name === 'id' || k.name.name === 'pin')?.value, ctx);
      if (v.storage === 'global') {
        if (this.globalInit(v) !== def) {
          this.flushPre(ctx, s.line);
          ctx.out.line(`${name} = ${pin.c};`, s.line);
        }
      } else if (def && this.declaredAt(v, def)) {
        this.flushPre(ctx, s.line);
        ctx.out.line(`const int ${name} = ${pin.c};`, s.line);
      } else {
        this.flushPre(ctx, s.line);
        ctx.out.line(`${name} = ${pin.c};`, s.line);
      }
    }
    this.flushPre(ctx, s.line);
    for (const l of this.setupLines(part, call, name, ctx)) ctx.out.line(l, s.line);
  }

  /** The lines a part needs when it is made (§3.2–§3.8). `name` is its C++ name (a pin for Pin / PWM). */
  private setupLines(part: PartName, call: Call, name: string, ctx: Ctx): string[] {
    const arg = (n: string, pos: number): Expr | null => call.keywords.find((k) => k.name.name === n)?.value ?? (pos >= 0 ? call.args[pos] ?? null : null);
    switch (part) {
      case 'Pin': {
        const out: string[] = [];
        const mode = arg('mode', 1);
        const pull = arg('pull', 2);
        const value = arg('value', -1);
        const m = mode ? this.typing.apiConstant(mode) : null;
        const p = pull ? this.typing.apiConstant(pull) : null;
        if (m?.id === 'Pin.OUT') out.push(`pinMode(${name}, OUTPUT);`);
        else if (m?.id === 'Pin.IN') out.push(`pinMode(${name}, ${p?.id === 'Pin.PULL_UP' ? 'INPUT_PULLUP' : 'INPUT'});`);
        if (value) {
          const c = this.typing.constValue(value);
          const level = c && (c.type === 'int' || c.type === 'bool') ? (Number(c.type === 'bool' ? c.value : c.value) ? 'HIGH' : 'LOW') : this.expr(value, ctx).c;
          out.push(`digitalWrite(${name}, ${level});`);
        }
        return out;
      }
      case 'PWM': {
        const out = [`pinMode(${name}, OUTPUT);`];
        const u16 = arg('duty_u16', -1);
        const duty = arg('duty', -1);
        if (u16) out.push(`analogWrite(${name}, ${this.scaled(u16, 257, ctx)});`);
        else if (duty) out.push(`analogWrite(${name}, ${this.scaled(duty, 4, ctx)});`);
        return out;
      }
      case 'I2C':
        this.libraries.add('Wire');
        return ['Wire.begin();'];
      case 'NeoPixel':
      case 'DHT':
        return [`${name}.begin();`];
      case 'HCSR04':
        this.pins.add('TRIG_PIN');
        this.pins.add('ECHO_PIN');
        return ['pinMode(TRIG_PIN, OUTPUT);', 'pinMode(ECHO_PIN, INPUT);'];
      case 'Servo':
        this.pins.add('SERVO_PIN');
        return [`${name}.attach(SERVO_PIN);`];
      case 'LCD':
        return [`${name}.init();`, `${name}.backlight();`];
      case 'Buzzer':
        this.pins.add('BUZZER');
        return ['pinMode(BUZZER, OUTPUT);'];
      case 'SevenSegment':
        for (const p of ['SEG_DATA', 'SEG_LATCH', 'SEG_CLOCK'] as const) this.pins.add(p);
        return ['pinMode(SEG_DATA, OUTPUT);', 'pinMode(SEG_LATCH, OUTPUT);', 'pinMode(SEG_CLOCK, OUTPUT);'];
      default:
        return [];
    }
  }

  /** `v / 257` for duty_u16 (`/ 4` for duty), folded for a literal (§3.2). */
  private scaled(e: Expr, by: number, ctx: Ctx): string {
    const c = this.typing.constValue(e);
    if (c && c.type === 'int' && e.type === 'Num') return String(Math.floor(c.value / by));
    return binary(this.expr(e, ctx), '/', atom(String(by), 'lit'), Order.MULTIPLICATIVE, 'long').c;
  }

  /** A part used on the spot (`Pin(MOTOR, Pin.OUT).on()`, `ADC(Pin(POT_LDR))`): its lines go before the statement; gives its pin. */
  private inPlacePart(call: Call, ctx: Ctx): Code {
    const t = this.typing.callTarget(call);
    if (t.kind !== 'class') return this.expr(call, ctx);
    const part = t.cls.part;
    if (part === 'Pin' || part === 'ADC' || part === 'PWM') {
      const pin = this.pinCode(call.args[0] ?? call.keywords.find((k) => k.name.name === 'id' || k.name.name === 'pin')?.value, ctx);
      ctx.pre.push(...this.setupLines(part, call, pin.c, ctx));
      return pin;
    }
    ctx.pre.push(...this.setupLines(part, call, '', ctx));
    return atom('', 'void');
  }

  /** The C++ pin of a pin argument (§3 "Pins"): a ZERO1 name, an Arduino number or name, a Pin. */
  private pinCode(e: Expr | null | undefined, ctx: Ctx): Code {
    if (!e) return atom('0', 'lit');
    if (e.type === 'Call' && this.typing.callTarget(e).kind === 'class') return this.inPlacePart(e, ctx);
    const c = this.typing.constValue(e);
    if (c && c.type === 'str') {
      const pin = pinOfText(c.value);
      const zero1 = Object.keys(ZERO1_PINS).find((n) => n === c.value) ?? (c.value === 'LED' ? 'LED_BUILTIN' : null);
      if (zero1) return this.pinName(zero1);
      if (/^A[0-5]$/.test(c.value)) return atom(c.value, 'narrow');
      return atom(String(pin ?? 0), 'lit');
    }
    return this.expr(e, ctx);
  }

  /** A zero1 pin constant (declared once, §3.1). */
  private pinName(name: string): Code {
    if (PINS.some((p) => p.name === name)) this.pins.add(name as PinName);
    return atom(name, 'narrow');
  }

  /** The C++ receiver of a part's method: its variable, a Pin list item, or a part made on the spot. */
  private receiver(e: Expr, ctx: Ctx): Code {
    if (e.type === 'Call') return this.inPlacePart(e, ctx);
    return this.expr(e, ctx);
  }

  // ---- lists (§2.10) ------------------------------------------------------------------------------------------

  /** The C++ items of a list literal or `[v] * N`. */
  private listItems(e: Expr, v: Variable | null, ctx: Ctx): string[] {
    const item = (x: Expr) => {
      if (v?.list?.elem === 'Pin') return this.pinCode(x, ctx).c;
      return this.valueOf(x, (v?.list?.elem as Kind | undefined) ?? this.typing.kindOf(x), ctx).c;
    };
    if (e.type === 'ListLit') return e.elts.map(item);
    if (e.type === 'ListRepeat') {
      const n = this.typing.constValue(e.count);
      const count = n && n.type === 'int' ? Math.max(0, n.value) : 0;
      const one = e.list.elts.map(item);
      const out: string[] = [];
      for (let k = 0; k < count; k++) out.push(...one);
      return out;
    }
    return [];
  }

  private listStartLength(e: Expr): number {
    if (e.type === 'ListLit') return e.elts.length;
    if (e.type === 'ListRepeat') {
      const n = this.typing.constValue(e.count);
      return n && n.type === 'int' ? Math.max(0, n.value) * e.list.elts.length : 0;
    }
    return 0;
  }

  /** `lst = [a, b]` / `lst = [v] * N`: the declaration, or the items one by one when the list is declared elsewhere. */
  private listCreation(target: Name, value: ListLit | ListRepeat, s: Stmt, ctx: Ctx): void {
    const v = this.typing.variableOf(target);
    const def = this.defOf(target);
    if (!v || !v.list || !def) return;
    const items = this.listItems(value, v, ctx);
    this.flushPre(ctx, s.line); // Pins made in the list: their pinMode() lines
    if (this.globalInit(v) === def) return;
    const name = this.nameOf(v, ctx);
    const count = this.counts.get(v);
    if (this.declaredAt(v, def)) {
      const allZero = items.every((x) => x === '0' || x === 'false' || x === '0.0' || x === '""');
      const init = items.length === 0 || allZero ? this.listZeroInit(v) : ` = {${items.join(', ')}}`;
      const room = v.list.growable ? `the list '${v.sym.name}' has room for ${v.list.capacity} items` : null;
      ctx.out.line(`${this.constList(v) ? 'const ' : ''}${this.declarator(v, name)}${init};`, s.line, room);
      if (count) ctx.out.line(`long ${count} = ${items.length};`, s.line);
      return;
    }
    items.forEach((x, i) => ctx.out.line(`${name}[${i}] = ${x};`, s.line));
    if (count) ctx.out.line(`${count} = ${items.length};`, s.line);
  }

  /** The index of `lst[i]` (§2.10): a literal in range (negative ones folded), a safe loop variable, else pyIndex(). */
  private listIndex(v: Variable, index: Expr, line: number, ctx: Ctx): string {
    const c = this.typing.constValue(index);
    const fixed = v.list && !v.list.growable && !v.isParam ? v.list.length : null;
    if (fixed !== null && c && (c.type === 'int' || c.type === 'bool')) {
      const n = Number(c.type === 'bool' ? c.value : c.value);
      if (n >= 0 && n < fixed) return this.expr(index, ctx).c;
      if (n < 0 && n >= -fixed) return String(fixed + n);
    }
    if (index.type === 'Name') {
      const iv = this.typing.variableOf(index);
      const safe = ctx.safe.find((x) => x.v === iv);
      if (safe && (safe.lists.has(v) || (fixed !== null && safe.upTo <= fixed))) return this.expr(index, ctx).c;
    }
    this.helpers.add('pyIndex');
    return `pyIndex(${this.expr(index, ctx).c}, ${this.sizeOf(v).c}, ${line})`;
  }

  /** `np[i]`: a negative literal index counts from the end (the pixel count is fixed). */
  private pixelIndex(np: Expr, index: Expr, ctx: Ctx): string {
    const c = this.typing.constValue(index);
    if (c && c.type === 'int' && c.value < 0) {
      const n = this.pixelCount(np);
      if (n !== null) return String(n + c.value);
    }
    return this.expr(index, ctx).c;
  }

  private pixelCount(np: Expr): number | null {
    const v = np.type === 'Name' ? this.typing.variableOf(np) : null;
    const call = v?.object?.call;
    const n = call ? call.keywords.find((k) => k.name.name === 'n')?.value ?? call.args[1] : null;
    const c = n ? this.typing.constValue(n) : null;
    return c && c.type === 'int' ? c.value : null;
  }

  private listSuffix(v: Variable): ListSuffix {
    return SUFFIX[this.itemType(v)] ?? 'L';
  }

  /** `lst, n` for a helper or a function with a list parameter. */
  private listArgs(e: Expr, ctx: Ctx): { list: string; size: string; v: Variable | null } {
    const v = e.type === 'Name' ? this.typing.variableOf(e) : null;
    if (v?.list) return { list: this.nameOf(v, ctx), size: this.sizeOf(v).c, v };
    return { list: this.expr(e, ctx).c, size: '0', v: null };
  }

  /** A list literal given to a helper or the API: a temporary array before the statement. */
  private tempArray(e: ListLit | ListRepeat, base: string, type: string, ctx: Ctx): { list: string; size: string } {
    const name = this.fresh(ctx.scope, base);
    const kind = this.typing.kindOf(e);
    const elem = elementOf(kind) ?? 'int';
    const items = e.type === 'ListLit' ? e.elts.map((x) => this.valueOf(x, elem as Kind, ctx).c) : this.listItems(e, null, ctx);
    ctx.pre.push(`${type === 'byte' ? '' : 'const '}${type} ${name}[${items.length}] = {${items.join(', ')}};`);
    return { list: name, size: String(items.length) };
  }

  /** `x = lst.pop(i)` / `lst.pop(i)`: the item out, then the count down by one (§2.10). */
  private popStmt(call: Call, target: Name | null, s: Stmt, ctx: Ctx): void {
    const recv = call.func.type === 'Attribute' ? call.func.value : null;
    const v = recv && recv.type === 'Name' ? this.typing.variableOf(recv) : null;
    if (!v || !v.list) return;
    const count = this.counts.get(v)!;
    const helper = `pyPop${this.listSuffix(v)}`;
    this.helpers.add(helper);
    const index = call.args[0] ? this.expr(call.args[0], ctx).c : '-1';
    const text = `${helper}(${this.nameOf(v, ctx)}, ${count}, ${index}, ${call.line})`;
    this.flushPre(ctx, s.line);
    if (target) this.assignName(target, text, ctx, s.line);
    else ctx.out.line(`${text};`, s.line);
    ctx.out.line(`${count}--;`, s.line);
  }

  // ---- compound statements ---------------------------------------------------------------------------------

  private nested(ctx: Ctx, loop: 'main' | 'loop' | null = null): Ctx {
    return { ...ctx, loops: loop ? [...ctx.loops, loop] : ctx.loops, pre: [] };
  }

  private ifStmt(s: If, ctx: Ctx): void {
    // The tests of the whole chain first: a part made on the spot in a test goes before the if.
    const chain: Array<{ node: If; test: Code }> = [];
    for (let node: If | null = s; node; ) {
      chain.push({ node, test: this.truth(node.test, ctx) });
      const next: Stmt | undefined = node.orelse?.stmts[0];
      node = node.orelse && node.orelse.stmts.length === 1 && next?.type === 'If' && next.isElif ? next : null;
    }
    this.flushPre(ctx, s.line);
    const out = ctx.out;
    chain.forEach(({ node, test }, k) => {
      if (k === 0) out.line(`if (${test.c}) {`, node.line);
      else {
        out.depth--;
        out.setTrailing(node.trailing);
        out.line(`} else if (${test.c}) {`, node.line);
      }
      out.depth++;
      this.block(node.body.stmts, node.body.endComments, this.nested(ctx));
      const last = k === chain.length - 1;
      if (last && node.orelse) {
        out.depth--;
        out.line('} else {', 0);
        out.depth++;
        this.block(node.orelse.stmts, node.orelse.endComments, this.nested(ctx));
      }
    });
    out.depth--;
    out.line('}', 0);
  }

  private whileStmt(s: Stmt & { type: 'While' }, ctx: Ctx): void {
    const test = isEndlessTest(s.test) ? atom('true', 'bool') : this.truth(s.test, ctx);
    this.flushPre(ctx, s.line);
    ctx.out.line(`while (${test.c}) {`, s.line);
    ctx.out.depth++;
    this.block(s.body.stmts, s.body.endComments, this.nested(ctx, 'loop'));
    ctx.out.depth--;
    ctx.out.line('}', 0);
  }

  private forStmt(s: For, ctx: Ctx): void {
    const out = ctx.out;
    const target = s.target.type === 'Name' ? s.target : null;
    const v = target ? this.typing.variableOf(target) : null;
    const def = target ? this.defOf(target) : null;
    if (!v || !def) return;
    const info = this.flow.forLoops.get(s);
    const simple = this.headerOnly(v) || (this.declaredAt(v, def) && !!info && info.assignedInBody.length === 0 && !info.readAfter);
    const inner = this.nested(ctx, 'loop');
    inner.names = new Map(ctx.names);
    const underscore = v.sym.name === '_';
    const letter = underscore ? this.loopLetter(ctx) : null;
    // The C++ loop variable: `i`, `j`, … for `_` (§2.4), else the variable's own name.
    const name = letter && (simple || s.iter.type !== 'Call') ? letter : this.nameOf(v, ctx);
    const it = s.iter;
    const t = it.type === 'Call' ? this.typing.callTarget(it) : null;
    // for v in range(…)
    if (t && t.kind === 'builtin' && t.name === 'range' && it.type === 'Call') {
      const args = it.args;
      const [startE, stopE, stepE] = args.length === 1 ? [null, args[0], null] : [args[0], args[1], args[2] ?? null];
      const start = startE ? this.expr(startE, ctx).c : '0';
      const stepC = stepE ? this.typing.constValue(stepE) : null;
      const step = stepC && (stepC.type === 'int' || stepC.type === 'bool') ? Number(stepC.value) : 1;
      let stop = this.expr(stopE, ctx);
      if (!this.stopIsStable(stopE, s)) {
        const stopName = this.fresh(ctx.scope, `${name}Stop`);
        this.flushPre(ctx, s.line);
        out.line(`const long ${stopName} = ${stop.c};`, s.line);
        stop = atom(stopName, 'long');
      }
      this.flushPre(ctx, s.line);
      const counter = simple ? name : letter ?? this.fresh(ctx.scope, `${name}Counter`);
      const cmp = step > 0 ? '<' : '>';
      const incr = step === 1 ? `${counter}++` : step === -1 ? `${counter}--` : stepE && stepE.type === 'Num' ? `${counter} += ${step}` : stepE && stepE.type === 'UnaryOp' ? `${counter} -= ${-step}` : `${counter} += ${this.expr(stepE!, ctx).c}`;
      out.line(`for (long ${counter} = ${start}; ${counter} ${cmp} ${wrap(stop, Order.RELATIONAL, true)}; ${incr}) {`, s.line);
      out.depth++;
      if (simple) {
        inner.names.set(v, counter);
        inner.safe = [...ctx.safe, { v, lists: this.rangeLists(args, step), upTo: this.rangeUpTo(args, step) }];
      } else {
        this.loopVariable(v, def, atom(counter, 'long'), inner, s.line);
      }
      this.block(s.body.stmts, s.body.endComments, inner);
      out.depth--;
      out.line('}', 0);
      return;
    }
    // for a in i2c.scan()
    if (t && t.kind === 'method' && t.part === 'I2C' && it.type === 'Call' && it.func.type === 'Attribute') {
      this.libraries.add('Wire');
      this.receiver(it.func.value, ctx);
      this.flushPre(ctx, s.line);
      const counter = simple ? name : letter ?? this.fresh(ctx.scope, `${name}Counter`);
      out.line(`for (byte ${counter} = 1; ${counter} < 127; ${counter}++) {`, s.line);
      out.depth++;
      out.line(`Wire.beginTransmission(${counter});`, s.line);
      out.line('if (Wire.endTransmission() == 0) {', s.line);
      out.depth++;
      if (simple) inner.names.set(v, counter);
      else this.loopVariable(v, def, atom(counter, 'narrow'), inner, s.line);
      this.block(s.body.stmts, s.body.endComments, inner);
      out.depth--;
      out.line('}', 0);
      out.depth--;
      out.line('}', 0);
      return;
    }
    const kind = this.typing.kindOf(it);
    const index = this.fresh(ctx.scope, `${name}Index`);
    const declare = this.headerOnly(v) || this.declaredAt(v, def);
    // for ch in text
    if (kind === 'str') {
      let text = this.textCode(it, ctx);
      if (it.type !== 'Name') {
        const hoisted = this.fresh(ctx.scope, `${name}Text`);
        this.flushPre(ctx, s.line);
        out.line(`String ${hoisted} = ${text.c};`, s.line);
        text = atom(hoisted, 'String');
      }
      this.flushPre(ctx, s.line);
      out.line(`for (long ${index} = 0; ${index} < (long)${wrap(text, Order.UNARY_POSTFIX)}.length(); ${index}++) {`, s.line);
      out.depth++;
      const item = `String(${wrap(text, Order.UNARY_POSTFIX)}.charAt(${index}))`;
      out.line(declare ? `String ${name} = ${item};` : `${name} = ${item};`, s.line);
      inner.names.set(v, name);
      this.block(s.body.stmts, s.body.endComments, inner);
      out.depth--;
      out.line('}', 0);
      return;
    }
    // for x in lst
    let list: { list: string; size: string; v: Variable | null };
    let itemType: string;
    if (it.type === 'ListLit' || it.type === 'ListRepeat') {
      itemType = cppType(elementOf(kind) ?? 'int');
      list = { ...this.tempArray(it, `${name}Items`, itemType, ctx), v: null };
    } else {
      list = this.listArgs(it, ctx);
      itemType = list.v ? this.itemType(list.v) : cppType(elementOf(kind) ?? 'int');
    }
    this.flushPre(ctx, s.line);
    out.line(`for (long ${index} = 0; ${index} < ${list.size}; ${index}++) {`, s.line);
    out.depth++;
    out.line(declare ? `${cppType(v.kind)} ${name} = ${list.list}[${index}];` : `${name} = ${list.list}[${index}];`, s.line);
    inner.names.set(v, name);
    this.block(s.body.stmts, s.body.endComments, inner);
    out.depth--;
    out.line('}', 0);
  }

  /** The first of i, j, k, … free here (for `for _ in …`). */
  private loopLetter(ctx: Ctx): string {
    const used = new Set(ctx.names.values());
    const module = this.resolved.moduleScope;
    for (const l of 'ijklmnpqrs') {
      if (used.has(l) || RESERVED_NAMES.has(l) || ctx.scope.cppNames.has(l) || (ctx.scope !== module && module.cppNames.has(l))) continue;
      return l;
    }
    return this.fresh(ctx.scope, 'i');
  }

  /** A loop variable changed in the body or read after the loop: set from the hidden counter each round (§2.4). */
  private loopVariable(v: Variable, def: DefSite, counter: Code, ctx: Ctx, py: number): void {
    const name = this.nameOf(v, ctx);
    if (this.declaredAt(v, def)) ctx.out.line(`${cppType(v.kind)} ${name} = ${counter.c};`, py);
    else ctx.out.line(`${name} = ${counter.c};`, py);
  }

  /** range()'s stop needs no hoisting: a literal, a constant, len() of a fixed list, or a name the body does not assign. */
  private stopIsStable(e: Expr, loop: For): boolean {
    if (this.typing.constValue(e) !== null) return true;
    if (e.type === 'Call') {
      const t = this.typing.callTarget(e);
      const arg = e.args[0];
      const v = arg && arg.type === 'Name' ? this.typing.variableOf(arg) : null;
      return t.kind === 'builtin' && t.name === 'len' && !!v?.list && !v.list.growable && !v.isParam;
    }
    if (e.type === 'Name') {
      const v = this.typing.variableOf(e);
      if (!v) return false;
      return !v.sym.defs.some((d) => d.stmt && d.stmt !== loop && this.inside(d.stmt, loop));
    }
    return false;
  }

  private inside(s: Stmt, ancestor: Stmt): boolean {
    for (let p: Stmt | null | undefined = s; p; p = this.resolved.parentOf.get(p)) if (p === ancestor) return true;
    return false;
  }

  /** The lists a range loop's variable indexes safely: `range(len(lst))`, `range(a, len(lst))` with a constant a ≥ 0. */
  private rangeLists(args: readonly Expr[], step: number): Set<Variable> {
    const out = new Set<Variable>();
    if (step <= 0 || args.length > 2) return out;
    if (args.length === 2) {
      const a = this.typing.constValue(args[0]);
      if (!a || a.type !== 'int' || a.value < 0) return out;
    }
    const stop = args[args.length - 1];
    if (stop.type === 'Call' && stop.func.type === 'Name' && stop.args[0]?.type === 'Name') {
      const t = this.typing.callTarget(stop);
      const v = this.typing.variableOf(stop.args[0]);
      if (t.kind === 'builtin' && t.name === 'len' && v?.list && !this.shrinking.has(v)) out.add(v);
    }
    return out;
  }

  /** `range(N)` / `range(a, N)` with constant N (and a ≥ 0): indexes below N (Infinity when not constant). */
  private rangeUpTo(args: readonly Expr[], step: number): number {
    if (step <= 0 || args.length > 2) return Infinity;
    if (args.length === 2) {
      const a = this.typing.constValue(args[0]);
      if (!a || a.type !== 'int' || a.value < 0) return Infinity;
    }
    const c = this.typing.constValue(args[args.length - 1]);
    return c && c.type === 'int' ? c.value : Infinity;
  }

  // ---- try / except (§2.12) ------------------------------------------------------------------------------------

  private tryStmt(s: Try, ctx: Ctx): void {
    const out = ctx.out;
    const first = s.body.stmts[0];
    const rest = s.body.stmts.slice(1);
    const handler = s.handler;
    const except = `except${handler.typeName ? ` ${handler.typeName.name}` : ''}${handler.alias ? ` as ${handler.alias.name}` : ''}:`;
    const tryComment = `try: ${this.pySource(first)}`;
    const aliasDef = handler.alias ? this.resolved.defs.find((d) => d.kind === 'except' && d.stmt === s) ?? null : null;
    const aliasLine = (text: string) => {
      if (!aliasDef) return;
      const v = this.typing.variableOfWeb.get(this.flow.webOfDef.get(aliasDef)!) ?? null;
      if (!v || v.uses.length === 0) return;
      if (this.declaredAt(v, aliasDef)) out.line(`String ${this.nameOf(v, ctx)} = ${text};`, handler.line);
      else out.line(`${this.nameOf(v, ctx)} = ${text};`, handler.line);
    };
    const trailing = out.takeTrailing();
    for (const c of first.leading) out.comment(c.text, c.line);
    const inner = this.nested(ctx);
    const body = () => {
      out.depth++;
      this.block(rest, s.orelse ? s.body.endComments : s.body.endComments, inner);
      if (s.orelse) this.block(s.orelse.stmts, s.orelse.endComments, this.nested(ctx));
      out.depth--;
    };
    const handlerBlock = (aliasText: string) => {
      out.depth++;
      aliasLine(aliasText);
      this.block(handler.body.stmts, handler.body.endComments, this.nested(ctx));
      out.depth--;
    };
    const withTrailing = (extra: readonly Comment[]) => out.setTrailing([...trailing.map((text) => ({ text })), ...extra]);
    // Form S, the DHT sensor: sensor.measure()
    if (first.type === 'ExprStmt' && first.value.type === 'Call') {
      const t = this.typing.callTarget(first.value);
      if (t.kind === 'method' && t.part === 'DHT') {
        const sensor = this.receiver(t.receiver, ctx).c;
        this.flushPre(ctx, first.line);
        const errno = '"[Errno 110] ETIMEDOUT"';
        withTrailing(first.trailing);
        if (rest.length === 0 && !s.orelse) {
          out.line(`if (!${sensor}.read()) {`, first.line, `${tryComment}  ${except}`);
          handlerBlock(errno);
          out.line('}', 0);
          return;
        }
        out.line(`if (${sensor}.read()) {`, first.line, tryComment);
        body();
        out.line('} else {', handler.line, except);
        handlerBlock(errno);
        out.line('}', 0);
        return;
      }
    }
    if (first.type !== 'Assign' || first.targets[0].type !== 'Name' || first.value.type !== 'Call') return;
    const target = first.targets[0];
    const call = first.value;
    const t = this.typing.callTarget(call);
    // Form S, the ultrasonic sensor: NAME = sonar.distance_cm()
    if (t.kind === 'method' && t.part === 'HCSR04') {
      this.receiver(t.receiver, ctx);
      this.pins.add('TRIG_PIN');
      this.pins.add('ECHO_PIN');
      this.helpers.add('pyDistanceCm');
      const reading = t.member.name === 'distance_mm' ? '(long)(pyDistanceCm(TRIG_PIN, ECHO_PIN, 0) * 10)' : 'pyDistanceCm(TRIG_PIN, ECHO_PIN, 0)';
      this.flushPre(ctx, first.line);
      out.setTrailing(first.trailing);
      this.assignName(target, reading, ctx, first.line);
      const name = this.nameCode(target, ctx).c;
      withTrailing([]);
      if (rest.length === 0 && !s.orelse) {
        out.line(`if (${name} <= 0) {`, first.line, `${tryComment}  ${except}`);
        handlerBlock('"Out of range"');
        out.line('}', 0);
        return;
      }
      out.line(`if (${name} > 0) {`, first.line, tryComment);
      body();
      out.line('} else {', handler.line, except);
      handlerBlock('"Out of range"');
      out.line('}', 0);
      return;
    }
    // Form V: NAME = int(text) / float(text)
    if (t.kind === 'builtin' && (t.name === 'int' || t.name === 'float') && call.args[0]) {
      const arg = call.args[0];
      let text = this.textCode(arg, ctx);
      if (arg.type !== 'Name') {
        const hoisted = this.fresh(ctx.scope, `${this.nameCode(target, ctx).c.replace(/_\d+$/, '')}Text`);
        this.flushPre(ctx, first.line);
        withTrailing(first.trailing);
        out.line(`String ${hoisted} = ${text.c};`, first.line);
        text = atom(hoisted, 'String');
      }
      const isInt = t.name === 'int';
      this.helpers.add(isInt ? 'pyInt' : 'pyFloatOf');
      this.helpers.add(isInt ? 'pyIsInt' : 'pyIsFloat');
      this.flushPre(ctx, first.line);
      out.line(`if (${isInt ? 'pyIsInt' : 'pyIsFloat'}(${text.c})) {`, first.line);
      out.depth++;
      this.assignName(target, `${isInt ? 'pyInt' : 'pyFloatOf'}(${text.c}, 0)`, ctx, first.line);
      out.depth--;
      body();
      out.line('} else {', handler.line);
      const words = isInt ? 'invalid literal for int() with base 10: ' : 'could not convert string to float: ';
      handlerBlock(`String("${words}'") + ${wrap(text, Order.ADDITIVE)} + "'"`);
      out.line('}', 0);
    }
  }

  // ---- other statements ---------------------------------------------------------------------------------------

  private returnStmt(s: Stmt & { type: 'Return' }, ctx: Ctx): void {
    const ft = ctx.fn ? this.typing.functions.get(ctx.fn) : null;
    const kind = ft?.returnKind ?? 'none';
    if (!s.value || s.value.type === 'NoneLit') {
      ctx.out.line(kind === 'none' ? 'return;' : `return ${zeroValue(kind)};`, s.line);
      return;
    }
    const value = this.valueOf(s.value, kind, ctx);
    this.flushPre(ctx, s.line);
    ctx.out.line(`return ${value.c};`, s.line);
  }

  private raiseStmt(s: Stmt & { type: 'Raise' }, ctx: Ctx): void {
    const e = s.exc;
    const name = e.type === 'Name' ? e.id : e.type === 'Call' && e.func.type === 'Name' ? e.func.id : 'Exception';
    const arg = e.type === 'Call' ? e.args[0] : undefined;
    const text = arg ? this.textWith(`${name}: `, arg, ctx) : cString(name);
    this.flushPre(ctx, s.line);
    this.fail();
    ctx.out.line(`pyFail(${s.line}, ${text});`, s.line);
  }

  /** `prefix` + a text expression, as one C++ text (a literal when both are literals). */
  private textWith(prefixText: string, e: Expr, ctx: Ctx): string {
    return this.buildText([{ text: prefixText }, ...this.pieces(e, ctx, true)]).c;
  }

  private fail(): void {
    this.helpers.add('pyFail');
  }

  // ---- statement calls --------------------------------------------------------------------------------------

  /** A call on its own line: print(), list methods, the DHT measure(), putstr() and the rest. */
  private callStmt(call: Call, s: Stmt, ctx: Ctx): void {
    const t = this.typing.callTarget(call);
    const out = ctx.out;
    if (t.kind === 'builtin' && t.name === 'print') return this.printStmt(call, s, ctx);
    if (t.kind === 'list-method') {
      const v = t.receiver.type === 'Name' ? this.typing.variableOf(t.receiver) : null;
      if (!v || !v.list) return;
      const count = this.counts.get(v);
      if (t.name === 'pop') return this.popStmt(call, null, s, ctx);
      if (t.name === 'clear' && count) {
        out.line(`${count} = 0;`, s.line);
        return;
      }
      if (t.name === 'append' && count && call.args[0]) {
        const helper = `pyAppend${this.listSuffix(v)}`;
        this.helpers.add(helper);
        const value = v.list.elem === 'Pin' ? this.pinCode(call.args[0], ctx) : this.valueOf(call.args[0], v.list.elem as Kind, ctx);
        this.flushPre(ctx, s.line);
        out.line(`${count} = ${helper}(${this.nameOf(v, ctx)}, ${count}, ${v.list.capacity}, ${value.c}, ${call.line});`, s.line);
      }
      return;
    }
    if (t.kind === 'method') {
      switch (t.member.id) {
        case 'DHT.measure': {
          const sensor = this.receiver(t.receiver, ctx).c;
          this.flushPre(ctx, s.line);
          this.fail();
          out.line(`if (!${sensor}.read()) pyFail(${call.line}, "OSError: [Errno 110] ETIMEDOUT");`, s.line);
          return;
        }
        case 'LCD.putstr':
          return this.lcdPrint(call, t.receiver, s, ctx);
        case 'PWM.freq':
          this.receiver(t.receiver, ctx);
          this.flushPre(ctx, s.line);
          return; // the UNO's PWM frequency is fixed (W-pwm-freq)
        default:
          break;
      }
    }
    const c = this.call(call, ctx);
    this.flushPre(ctx, s.line);
    if (c.c !== '') out.line(`${c.c};`, s.line);
  }

  // ---- print() and text pieces (§2.11) ------------------------------------------------------------------------

  /** print(a, b, sep=…, end=…): one Serial.print per piece, the last one println (§2.11). */
  private printStmt(call: Call, s: Stmt, ctx: Ctx): void {
    this.serial = true;
    const kw = (n: string) => call.keywords.find((k) => k.name.name === n)?.value;
    const sepE = kw('sep');
    const endE = kw('end');
    const sep = sepE && sepE.type === 'Str' ? sepE.value : ' ';
    const end = endE && endE.type === 'Str' ? endE.value : '\n';
    const pieces: Piece[] = [];
    call.args.forEach((a, i) => {
      if (i > 0) pieces.push({ text: sep });
      pieces.push(...this.pieces(a, ctx, false));
    });
    pieces.push({ text: end });
    const merged = mergePieces(pieces);
    let newline = false;
    const last = merged[merged.length - 1];
    if (last && 'text' in last && last.text.endsWith('\n')) {
      newline = true;
      last.text = last.text.slice(0, -1);
      if (last.text === '') merged.pop();
    }
    this.flushPre(ctx, s.line);
    if (merged.length === 0) {
      if (newline) ctx.out.line('Serial.println();', s.line);
      return;
    }
    merged.forEach((p, i) => {
      const fn = i === merged.length - 1 && newline ? 'println' : 'print';
      ctx.out.line(`Serial.${fn}(${'text' in p ? cString(p.text) : p.print});`, s.line);
    });
  }

  /** lcd.putstr(…): one lcd.print per piece, `°` as the LCD's own degree sign (§3.8). */
  private lcdPrint(call: Call, recv: Expr, s: Stmt, ctx: Ctx): void {
    const lcd = this.receiver(recv, ctx).c;
    const arg = call.args[0];
    if (!arg) return;
    const merged = mergePieces(this.pieces(arg, ctx, true));
    this.flushPre(ctx, s.line);
    for (const p of merged) ctx.out.line(`${lcd}.print(${'text' in p ? cString(p.text, true) : p.print});`, s.line);
  }

  /** The pieces of a print() argument, a putstr() text or an f-string: literal texts and values (§2.11). */
  private pieces(e: Expr, ctx: Ctx, lcd: boolean): Piece[] {
    if (e.type === 'Str') return [{ text: e.value }];
    if (e.type === 'FString') return e.parts.map((p) => (p.type === 'text' ? { text: p.value } : this.field(p.value, p.spec?.text ?? null, ctx)));
    if (lcd) {
      const t = this.textCode(e, ctx);
      return [{ print: t.c, asText: t }];
    }
    return [this.valuePiece(e, ctx)];
  }

  /** A value as a print piece and as text: int `n`, float `pyFloat(x)`, bool `pyBool(b)`, list `pyListTextL(lst, n)`. */
  private valuePiece(e: Expr, ctx: Ctx): Piece {
    const kind = this.typing.kindOf(e);
    if (kind === 'str') {
      const t = this.textCode(e, ctx);
      return { print: t.c, asText: t };
    }
    if (isListKind(kind)) {
      const text = atom(this.listText(e, ctx), 'String');
      return { print: text.c, asText: text };
    }
    const c = this.expr(e, ctx);
    if (kind === 'float' || kind === 'bool') {
      const h = kind === 'float' ? 'pyFloat' : 'pyBool';
      this.helpers.add(h);
      const text = atom(`${h}(${c.c})`, 'String');
      return { print: text.c, asText: text };
    }
    return { print: c.c, asText: atom(`String(${c.c})`, 'String') };
  }

  /** `pyListTextL(lst, n)` for print(lst) / str(lst). */
  private listText(e: Expr, ctx: Ctx): string {
    const { list, size, v } = this.listArgs(e, ctx);
    const helper = `pyListText${v ? this.listSuffix(v) : 'L'}`;
    this.helpers.add(helper);
    return `${helper}(${list}, ${size})`;
  }

  /** An f-string field `{x:spec}` (§2.11 table). */
  private field(e: Expr, spec: string | null, ctx: Ctx): Piece {
    const m = spec ? /^([<>])?(0)?(\d+)?(?:\.(\d+))?([dfxXbs])?$/.exec(spec) : null;
    if (!m) return this.valuePiece(e, ctx);
    const [, align, zero, width, precision, type] = m;
    const kind = this.typing.kindOf(e);
    const isText = kind === 'str';
    let piece: Piece;
    if (type === 'f' || (precision !== undefined && !isText)) {
      const digits = precision ?? '6';
      const c = this.expr(e, ctx);
      const value = kind === 'float' ? c.c : prefix('(float)', c, 'float').c;
      piece = { print: `${value}, ${digits}`, asText: atom(`String(${value}, ${digits})`, 'String') };
    } else if (type === 'x' || type === 'X' || type === 'b') {
      const h = type === 'b' ? 'pyBin' : 'pyHex';
      this.helpers.add(h);
      const text = atom(`${h}(${this.expr(e, ctx).c}${type === 'b' ? '' : type === 'X' ? ', true' : ', false'})`, 'String');
      piece = { print: text.c, asText: text };
    } else if (type === 'd') {
      const c = this.expr(e, ctx);
      const n = kind === 'bool' ? prefix('(long)', c, 'long').c : c.c;
      piece = { print: n, asText: atom(`String(${n})`, 'String') };
    } else if (isText && precision !== undefined) {
      const text = code(`${wrap(this.receiverText(this.textCode(e, ctx)), Order.UNARY_POSTFIX)}.substring(0, ${precision})`, Order.UNARY_POSTFIX, 'String');
      piece = { print: text.c, asText: text };
    } else {
      piece = this.valuePiece(e, ctx);
    }
    if (width === undefined || 'text' in piece) return piece;
    this.helpers.add('pyPad');
    const how = zero ? '0' : align ?? (isText ? '<' : '>');
    const padded = atom(`pyPad(${piece.asText.c}, ${width}, '${how}')`, 'String');
    return { print: padded.c, asText: padded };
  }

  /** A text value for building text: a literal stays a literal; `str(x)` as its text. */
  private textCode(e: Expr, ctx: Ctx): Code {
    if (e.type === 'Str') return atom(cString(e.value), 'cstr');
    return this.expr(e, ctx);
  }

  /** A text that is the receiver of a String method: a literal becomes `String("…")`. */
  private receiverText(t: Code): Code {
    return t.t === 'cstr' ? atom(`String(${t.c})`, 'String') : t;
  }

  /** Text built from pieces (an f-string outside print): `String("T = ") + pyFloat(t)`. */
  private buildText(pieces: Piece[]): Code {
    const merged = mergePieces(pieces);
    if (merged.length === 0) return atom('""', 'cstr');
    const parts = merged.map((p) => ('text' in p ? atom(cString(p.text), 'cstr') : p.asText));
    if (parts.length === 1) return parts[0];
    let acc = this.receiverText(parts[0]);
    for (const p of parts.slice(1)) acc = binary(acc, '+', p, Order.ADDITIVE, 'String');
    return acc;
  }

  // ---- values ----------------------------------------------------------------------------------------------

  /** A value that goes into a place of kind `kind` (a colour tuple, a text literal, …). */
  private valueOf(e: Expr, kind: Kind | null, ctx: Ctx): Code {
    if (kind === 'str') return this.textCode(e, ctx);
    return this.expr(e, ctx);
  }

  private nonZeroConstant(e: Expr): boolean {
    const c = this.typing.constValue(e);
    return !!c && (c.type === 'int' || c.type === 'float' || c.type === 'bool') && Number(c.value) !== 0;
  }

  /** N4: a divisor that is not a non-zero constant, wrapped in pyNonZero / pyNonZeroF. */
  private guard(d: Code, kind: Kind | null, line: number): Code {
    const helper = kind === 'float' ? 'pyNonZeroF' : 'pyNonZero';
    this.helpers.add(helper);
    return atom(`${helper}(${d.c}, ${line})`, kind === 'float' ? 'float' : 'long');
  }

  /** N1: an int-kinded operand of arithmetic (`L` on literals, `(long)` on narrower values). */
  private intOperand(c: Code): Code {
    if (c.t === 'lit') return code(withL(c.c), c.p, 'long');
    if (c.t === 'narrow' || c.t === 'bool') return prefix('(long)', c, 'long');
    return c;
  }

  private isIntLiteral(e: Expr): boolean {
    if (e.type === 'Num') return !e.isFloat;
    return e.type === 'UnaryOp' && e.op === '-' && e.operand.type === 'Num' && !e.operand.isFloat;
  }

  private expr(e: Expr, ctx: Ctx): Code {
    switch (e.type) {
      case 'Num':
        return e.isFloat ? atom(floatLiteral(e.value), 'float') : atom(intLiteral(e.raw, e.value), 'lit');
      case 'Str':
        return atom(cString(e.value), 'cstr');
      case 'Bool':
        return atom(e.value ? 'true' : 'false', 'bool');
      case 'FString':
        return this.buildText(e.parts.flatMap((p) => (p.type === 'text' ? [{ text: p.value }] : [this.field(p.value, p.spec?.text ?? null, ctx)])));
      case 'Name':
        return this.name(e, ctx);
      case 'Attribute': {
        const c = this.typing.apiConstant(e);
        return c ? this.apiConstant(c) : atom(e.attr.name, 'long');
      }
      case 'BinOp':
        return this.binop(e.op, null, e.left, e.right, this.typing.kindOf(e) ?? 'int', e.line, ctx, e);
      case 'UnaryOp':
        return this.unary(e, ctx);
      case 'BoolOp': {
        const op = e.op === 'and' ? '&&' : '||';
        const p = e.op === 'and' ? Order.LOGICAL_AND : Order.LOGICAL_OR;
        return code(e.values.map((v) => wrap(this.truth(v, ctx), p)).join(` ${op} `), p, 'bool');
      }
      case 'Compare':
        return this.compare(e, ctx);
      case 'IfExp': {
        const kind = this.typing.kindOf(e);
        const test = this.truth(e.test, ctx);
        const branch = (x: Expr) => {
          const c = this.valueOf(x, kind, ctx);
          return c.t === 'cstr' ? `String(${c.c})` : wrap(c, Order.CONDITIONAL);
        };
        return atom(`(${wrap(test, Order.CONDITIONAL)} ? ${branch(e.body)} : ${branch(e.orelse)})`, ctypeOf(kind));
      }
      case 'Call':
        return this.call(e, ctx);
      case 'Subscript':
        return this.subscript(e, ctx);
      case 'TupleLit':
        return this.colour(e, ctx);
      default:
        return atom('0', 'lit');
    }
  }

  private name(e: Name, ctx: Ctx): Code {
    const b = this.flow.bindingOf(e);
    if (b.kind === 'variable') {
      const v = this.typing.variableOf(e);
      if (v) {
        if (v.list) return atom(this.nameOf(v, ctx), 'long');
        if (v.object) return atom(this.nameOf(v, ctx), 'narrow');
        return atom(this.nameOf(v, ctx), ctypeOf(v.kind));
      }
    }
    if (b.kind === 'function') return atom(b.fn.cppName, 'void');
    const c = this.typing.apiConstant(e);
    if (c) return this.apiConstant(c);
    return atom(e.id, 'long');
  }

  /** An API constant (§3.1, §3.9): a ZERO1 pin name, A0…A5, LCD_ADDRESS, math.pi, Pin.OUT … */
  private apiConstant(c: ApiConstant): Code {
    if (c.id.startsWith('zero1.')) {
      if (c.name === 'LCD_ADDRESS') return atom('0x27', 'lit');
      if (/^A[0-5]$/.test(c.name)) return atom(c.name, 'narrow');
      return this.pinName(c.name);
    }
    if (c.id === 'math.pi') return atom('PI', 'float');
    if (c.id === 'math.e') return atom('EULER', 'float');
    return c.valueKind === 'float' ? atom(floatLiteral(c.value), 'float') : atom(String(c.value), 'lit');
  }

  /** A colour (§3.6): a literal is `0xRRGGBB`, a computed one the NeoPixel's Color(r, g, b). */
  private colour(e: TupleLit, ctx: Ctx): Code {
    const c = this.typing.constValue(e);
    if (c && c.type === 'color') return atom(`0x${c.value.toString(16).toUpperCase().padStart(6, '0')}`, 'color');
    const np = this.typing.neoPixel?.cppName ?? 'np';
    return atom(`${np}.Color(${e.elts.map((x) => this.expr(x, ctx).c).join(', ')})`, 'color');
  }

  // ---- operators (§2.5, N1–N5) -------------------------------------------------------------------------------

  /**
   * `left op right` of kind `kind`. `leftCode` is given for `x op= e` (the variable read);
   * `node` is the BinOp for the folding of literal powers.
   */
  private binop(op: string, leftCode: Code | null, leftE: Expr, rightE: Expr, kind: Kind, line: number, ctx: Ctx, node: BinOp | null = null, leftKind: Kind | null = null): Code {
    const L = () => leftCode ?? this.expr(leftE, ctx);
    const kl = leftKind ?? this.typing.kindOf(leftE);
    const kr = this.typing.kindOf(rightE);
    const isInt = (k: Kind | null) => k === 'int' || k === 'bool';
    switch (op) {
      case '+':
      case '-':
      case '*': {
        if (kind === 'str') {
          if (op === '*') {
            const c = node ? this.typing.constValue(node) : null;
            return atom(cString(c && c.type === 'str' ? c.value : ''), 'cstr');
          }
          const a = this.textCode(leftE, ctx);
          const left = leftCode ?? (a.t === 'cstr' ? atom(`String(${a.c})`, 'String') : a);
          return binary(left, '+', this.textCode(rightE, ctx), Order.ADDITIVE, 'String');
        }
        const p = op === '*' ? Order.MULTIPLICATIVE : Order.ADDITIVE;
        if (kind === 'int') return binary(this.intOperand(L()), op, this.intOperand(this.expr(rightE, ctx)), p, 'long');
        return binary(L(), op, this.expr(rightE, ctx), p, 'float');
      }
      case '/': {
        const nonZero = this.nonZeroConstant(rightE);
        if (isInt(kl) && isInt(kr)) {
          if (nonZero && this.isIntLiteral(rightE)) return binary(L(), '/', atom(floatLiteral(Number(this.typing.constValue(rightE)!.type === 'bool' ? 1 : (this.typing.constValue(rightE) as { value: number }).value)), 'float'), Order.MULTIPLICATIVE, 'float');
          const right = nonZero ? this.expr(rightE, ctx) : this.guard(this.expr(rightE, ctx), kr, line);
          if (!leftCode && this.isIntLiteral(leftE)) {
            const v = (this.typing.constValue(leftE) as { value: number }).value;
            return binary(atom(floatLiteral(v), 'float'), '/', right, Order.MULTIPLICATIVE, 'float');
          }
          return binary(prefix('(float)', L(), 'float'), '/', right, Order.MULTIPLICATIVE, 'float');
        }
        const right = nonZero ? this.expr(rightE, ctx) : this.guard(this.expr(rightE, ctx), kr, line);
        return binary(L(), '/', right, Order.MULTIPLICATIVE, 'float');
      }
      case '//':
      case '%': {
        const nonZero = this.nonZeroConstant(rightE);
        if (kind === 'int') {
          const rc = this.typing.constValue(rightE);
          const positive = !!rc && (rc.type === 'int' || rc.type === 'bool') && Number(rc.value) > 0;
          const leftNonNeg = leftCode ? (leftE.type === 'Name' ? this.typing.readVariableOf(leftE)?.nonNegative ?? false : false) : this.typing.nonNegative(leftE);
          if (leftNonNeg && positive) return binary(this.intOperand(L()), op === '//' ? '/' : '%', this.intOperand(this.expr(rightE, ctx)), Order.MULTIPLICATIVE, 'long');
          const helper = op === '//' ? 'pyFloorDiv' : 'pyMod';
          this.helpers.add(helper);
          const right = nonZero ? this.intOperand(this.expr(rightE, ctx)) : this.guard(this.expr(rightE, ctx), kr, line);
          return atom(`${helper}(${this.intOperand(L()).c}, ${right.c})`, 'long');
        }
        const right = nonZero ? this.expr(rightE, ctx) : this.guard(this.expr(rightE, ctx), kr, line);
        if (op === '//') return atom(`floor(${binary(L(), '/', right, Order.MULTIPLICATIVE, 'float').c})`, 'float');
        this.helpers.add('pyFloatMod');
        return atom(`pyFloatMod(${L().c}, ${right.c})`, 'float');
      }
      case '**': {
        if (kind === 'int') {
          if (!leftCode && leftE.type === 'Num' && rightE.type === 'Num' && node) {
            const c = this.typing.constValue(node);
            if (c && c.type === 'int') return atom(String(c.value), 'lit');
          }
          this.helpers.add('pyPow');
          return atom(`pyPow(${L().c}, ${this.expr(rightE, ctx).c}, ${line})`, 'long');
        }
        return atom(`pow(${L().c}, ${this.expr(rightE, ctx).c})`, 'float');
      }
      default: {
        const p = op === '&' ? Order.BITWISE_AND : op === '|' ? Order.BITWISE_OR : op === '^' ? Order.BITWISE_XOR : Order.SHIFT;
        if (kind === 'bool') return binary(L(), op, this.expr(rightE, ctx), p, 'bool');
        return binary(this.intOperand(L()), op, this.intOperand(this.expr(rightE, ctx)), p, 'long');
      }
    }
  }

  private unary(e: UnaryOp, ctx: Ctx): Code {
    if (e.op === 'not') return this.notTruth(e.operand, ctx);
    if (e.op === '-' && e.operand.type === 'Num') return atom(`-${e.operand.isFloat ? floatLiteral(e.operand.value) : intLiteral(e.operand.raw, e.operand.value)}`, e.operand.isFloat ? 'float' : 'lit');
    if (e.op === '-' && e.operand.type === 'BinOp' && e.operand.op === '**' && e.operand.left.type === 'Num' && e.operand.right.type === 'Num') {
      const c = this.typing.constValue(e);
      if (c && c.type === 'int') return atom(String(c.value), 'lit');
    }
    const x = this.expr(e.operand, ctx);
    if (e.op === '+') return x;
    const t: CType = x.t === 'bool' ? 'narrow' : x.t;
    return prefix(e.op, x, t);
  }

  private compare(e: Compare, ctx: Ctx): Code {
    const operands = [e.left, ...e.comparators];
    const parts = e.ops.map((op, k) => (op === 'in' || op === 'not in' ? this.inTest(operands[k], operands[k + 1], op === 'not in', ctx) : this.compare2(operands[k], op, operands[k + 1], ctx)));
    if (parts.length === 1) return parts[0];
    return code(parts.map((p) => wrap(p, Order.LOGICAL_AND)).join(' && '), Order.LOGICAL_AND, 'bool');
  }

  private compare2(a: Expr, op: string, b: Expr, ctx: Ctx): Code {
    const ka = this.typing.kindOf(a);
    const kb = this.typing.kindOf(b);
    const isNum = (k: Kind | null) => k === 'int' || k === 'float' || k === 'bool';
    if ((op === '==' || op === '!=') && ((ka === 'str' && isNum(kb)) || (kb === 'str' && isNum(ka)))) return atom(op === '==' ? 'false' : 'true', 'bool');
    const p = op === '==' || op === '!=' ? Order.EQUALITY : Order.RELATIONAL;
    let left = this.expr(a, ctx);
    if (ka === 'str' && left.t === 'cstr') left = atom(`String(${left.c})`, 'String');
    return binary(left, op, this.expr(b, ctx), p, 'bool');
  }

  /** `x in "text"`, `x in [1, 2, 3]`, `x in lst` (and `not in`). */
  private inTest(x: Expr, container: Expr, negate: boolean, ctx: Ctx): Code {
    if (container.type === 'ListLit') {
      if (container.elts.length === 0) return atom(negate ? 'true' : 'false', 'bool');
      const parts = container.elts.map((item) => this.compare2(x, negate ? '!=' : '==', item, ctx));
      const p = negate ? Order.LOGICAL_AND : Order.LOGICAL_OR;
      return code(parts.map((c) => wrap(c, p)).join(negate ? ' && ' : ' || '), p, 'bool');
    }
    const kind = this.typing.kindOf(container);
    if (kind === 'str') {
      const text = this.receiverText(this.textCode(container, ctx));
      return code(`${wrap(text, Order.UNARY_POSTFIX)}.indexOf(${this.textCode(x, ctx).c}) ${negate ? '<' : '>='} 0`, Order.RELATIONAL, 'bool');
    }
    const { list, size, v } = this.listArgs(container, ctx);
    const helper = `pyInList${v ? this.listSuffix(v) : 'L'}`;
    this.helpers.add(helper);
    const test = atom(`${helper}(${list}, ${size}, ${this.valueOf(x, v?.list?.elem as Kind ?? null, ctx).c})`, 'bool');
    return negate ? prefix('!', test, 'bool') : test;
  }

  /** §2.8: a condition. */
  private truth(e: Expr, ctx: Ctx): Code {
    const pin = this.pinRead(e, ctx);
    if (pin) return binary(pin, '==', atom('HIGH', 'narrow'), Order.EQUALITY, 'bool');
    const kind = this.typing.kindOf(e);
    if (isListKind(kind)) {
      const v = e.type === 'Name' ? this.typing.variableOf(e) : null;
      return binary(v ? this.sizeOf(v) : atom('0', 'lit'), '>', atom('0', 'lit'), Order.RELATIONAL, 'bool');
    }
    const c = this.expr(e, ctx);
    switch (kind) {
      case 'int':
      case 'float':
        return binary(c, '!=', atom('0', 'lit'), Order.EQUALITY, 'bool');
      case 'str':
        return binary(atom(`${wrap(this.receiverText(c), Order.UNARY_POSTFIX)}.length()`, 'narrow'), '>', atom('0', 'lit'), Order.RELATIONAL, 'bool');
      case 'color':
        return atom('true', 'bool');
      default:
        return c;
    }
  }

  /** §2.8: `not x`. */
  private notTruth(e: Expr, ctx: Ctx): Code {
    const pin = this.pinRead(e, ctx);
    if (pin) return binary(pin, '==', atom('LOW', 'narrow'), Order.EQUALITY, 'bool');
    const kind = this.typing.kindOf(e);
    if (isListKind(kind)) {
      const v = e.type === 'Name' ? this.typing.variableOf(e) : null;
      return binary(v ? this.sizeOf(v) : atom('0', 'lit'), '==', atom('0', 'lit'), Order.EQUALITY, 'bool');
    }
    const c = this.expr(e, ctx);
    switch (kind) {
      case 'int':
      case 'float':
        return binary(c, '==', atom('0', 'lit'), Order.EQUALITY, 'bool');
      case 'str':
        return binary(atom(`${wrap(this.receiverText(c), Order.UNARY_POSTFIX)}.length()`, 'narrow'), '==', atom('0', 'lit'), Order.EQUALITY, 'bool');
      case 'color':
        return atom('false', 'bool');
      default:
        return prefix('!', c, 'bool');
    }
  }

  /** `digitalRead(p)` when `e` reads a Pin (`p.value()`, `p()`), else null. */
  private pinRead(e: Expr, ctx: Ctx): Code | null {
    if (e.type !== 'Call' || e.args.length > 0 || e.keywords.length > 0) return null;
    const t = this.typing.callTarget(e);
    if (t.kind === 'method' && t.member.id === 'Pin.value') return atom(`digitalRead(${this.receiver(t.receiver, ctx).c})`, 'narrow');
    if (t.kind === 'pin-call') return atom(`digitalRead(${this.receiver(t.receiver, ctx).c})`, 'narrow');
    return null;
  }

  private subscript(e: Subscript, ctx: Ctx): Code {
    const base = this.typing.kindOf(e.value);
    if (base === 'str') {
      this.helpers.add('pyCharAt');
      return atom(`pyCharAt(${this.textCode(e.value, ctx).c}, ${this.expr(e.index, ctx).c}, ${e.line})`, 'String');
    }
    const v = e.value.type === 'Name' ? this.typing.variableOf(e.value) : null;
    const elem = elementOf(base);
    const t: CType = v && this.byteLists.has(v) ? 'narrow' : elem === 'Pin' ? 'narrow' : ctypeOf(elem);
    const listName = this.expr(e.value, ctx);
    return code(`${wrap(listName, Order.UNARY_POSTFIX)}[${v ? this.listIndex(v, e.index, e.line, ctx) : this.expr(e.index, ctx).c}]`, Order.UNARY_POSTFIX, t);
  }

  // ---- calls ---------------------------------------------------------------------------------------------------------

  private call(e: Call, ctx: Ctx): Code {
    const t = this.typing.callTarget(e);
    switch (t.kind) {
      case 'function':
        return this.ownCall(t.fn, e, ctx);
      case 'builtin':
        return this.builtin(t.name, e, ctx);
      case 'api':
        return this.apiCall(t.member, e, ctx);
      case 'method':
        return this.method(t.member, t.receiver, e, ctx);
      case 'pin-call': {
        const p = this.receiver(t.receiver, ctx).c;
        if (e.args.length === 0) return atom(`digitalRead(${p})`, 'narrow');
        return atom(`digitalWrite(${p}, ${this.expr(e.args[0], ctx).c})`, 'void');
      }
      case 'str-method':
        return this.strMethod(t.name, t.receiver, e, ctx);
      case 'list-method': {
        const v = t.receiver.type === 'Name' ? this.typing.variableOf(t.receiver) : null;
        if (t.name === 'pop' && v?.list) {
          const helper = `pyPop${this.listSuffix(v)}`;
          this.helpers.add(helper);
          return atom(`${helper}(${this.nameOf(v, ctx)}, ${this.counts.get(v)}, ${e.args[0] ? this.expr(e.args[0], ctx).c : '-1'}, ${e.line})`, ctypeOf(v.list.elem));
        }
        return atom('', 'void');
      }
      case 'class':
        return this.inPlacePart(e, ctx);
      default:
        return atom('', 'void');
    }
  }

  /** The arguments of an own function call: positional, keywords, defaults; a list gives its length too. */
  private ownCall(fn: FunctionInfo, e: Call, ctx: Ctx): Code {
    const ft = this.typing.functions.get(fn)!;
    const params = fn.def.params;
    const bound: Array<Expr | null> = params.map(() => null);
    e.args.forEach((a, i) => i < bound.length && (bound[i] = a));
    for (const k of e.keywords) {
      const i = params.findIndex((p) => p.name === k.name.name);
      if (i >= 0) bound[i] = k.value;
    }
    const args = params.map((p, i) => {
      const a = bound[i] ?? p.default;
      if (!a) return '0';
      const kind = ft.paramKinds[i];
      if (isListKind(kind)) {
        const { list, size } = this.listArgs(a, ctx);
        return `${list}, ${size}`;
      }
      if (kind === 'Pin') return this.pinCode(a, ctx).c;
      return this.valueOf(a, kind, ctx).c;
    });
    return atom(`${fn.cppName}(${args.join(', ')})`, ctypeOf(ft.returnKind));
  }

  /** The arguments of an API function or method by parameter name (positional, then keywords). */
  private bindApi(params: readonly ApiParam[], e: Call): Map<string, Expr> {
    const bound = new Map<string, Expr>();
    const positional = params.filter((p) => !p.keywordOnly);
    e.args.forEach((a, i) => positional[i] && bound.set(positional[i].name, a));
    for (const k of e.keywords) bound.set(k.name.name, k.value);
    return bound;
  }

  private apiCall(m: ApiFunction, e: Call, ctx: Ctx): Code {
    const args = this.bindApi(m.params, e);
    const a = (n: string) => args.get(n) ?? null;
    const v = (n: string) => this.expr(a(n)!, ctx);
    const line = e.line;
    switch (m.id) {
      case 'machine.time_pulse_us': {
        const timeout = a('timeout_us');
        return prefix('(long)', atom(`pulseIn(${this.pinCode(a('pin'), ctx).c}, ${v('pulse_level').c}${timeout ? `, ${this.expr(timeout, ctx).c}` : ''})`, 'long'), 'long');
      }
      case 'time.sleep':
        return this.sleep(a('seconds')!, line, ctx);
      case 'time.sleep_ms': {
        const ms = a('ms')!;
        const c = this.typing.constValue(ms);
        if (c && (c.type === 'int' || c.type === 'bool') && Number(c.value) >= 0) return atom(`delay(${this.expr(ms, ctx).c})`, 'void');
        this.helpers.add('pySleepMs');
        return atom(`pySleepMs(${this.expr(ms, ctx).c}, ${line})`, 'void');
      }
      case 'time.sleep_us':
        return atom(`delayMicroseconds(${v('us').c})`, 'void');
      case 'time.ticks_ms':
        return prefix('(long)', atom('millis()', 'long'), 'long');
      case 'time.ticks_us':
        return prefix('(long)', atom('micros()', 'long'), 'long');
      case 'time.ticks_diff':
        return atom(`(${binary(this.intOperand(v('new')), '-', this.intOperand(v('old')), Order.ADDITIVE, 'long').c})`, 'long');
      case 'time.ticks_add':
        return atom(`(${binary(this.intOperand(v('ticks')), '+', this.intOperand(v('delta')), Order.ADDITIVE, 'long').c})`, 'long');
      case 'time.time':
        return prefix('(long)', atom('(millis() / 1000)', 'long'), 'long');
      case 'math.floor':
      case 'math.ceil':
      case 'math.trunc':
        return prefix('(long)', atom(`${m.name}(${v('x').c})`, 'float'), 'long');
      case 'math.pow':
        return atom(`pow(${v('x').c}, ${v('y').c})`, 'float');
      case 'math.isnan':
      case 'math.isinf':
        return atom(`${m.name}(${v('x').c})`, 'bool');
      case 'math.atan2':
        return atom(`atan2(${v('y').c}, ${v('x').c})`, 'float');
      case 'random.randint': {
        const b = a('b')!;
        const bc = this.typing.constValue(b);
        const upper = b.type === 'Num' && bc && bc.type === 'int' ? String(bc.value + 1) : binary(this.intOperand(this.expr(b, ctx)), '+', atom('1L', 'long'), Order.ADDITIVE, 'long').c;
        return atom(`random(${v('a').c}, ${upper})`, 'long');
      }
      case 'random.randrange': {
        const stop = a('stop');
        return atom(stop ? `random(${v('start').c}, ${this.expr(stop, ctx).c})` : `random(${v('start').c})`, 'long');
      }
      case 'random.random':
        return atom('(random(0, 1000000) / 1000000.0)', 'float');
      case 'random.uniform': {
        const x = v('a');
        const y = v('b');
        return atom(`(${wrap(x, Order.ADDITIVE)} + (${binary(y, '-', x, Order.ADDITIVE, 'float').c}) * (random(0, 1000000) / 1000000.0))`, 'float');
      }
      case 'random.choice': {
        const items = a('items')!;
        let list: { list: string; size: string; v: Variable | null };
        if (items.type === 'ListLit' || items.type === 'ListRepeat') {
          const kind = elementOf(this.typing.kindOf(items)) ?? 'int';
          list = { ...this.tempArray(items, 'choices', cppType(kind), ctx), v: null };
        } else list = this.listArgs(items, ctx);
        const t = ctypeOf(elementOf(this.typing.kindOf(items)));
        if (list.v && (list.v.list?.growable || list.v.isParam)) {
          this.helpers.add('pyIndex');
          return code(`${list.list}[pyIndex(random(0, ${list.size}), ${list.size}, ${line})]`, Order.UNARY_POSTFIX, t);
        }
        return code(`${list.list}[random(0, ${list.size})]`, Order.UNARY_POSTFIX, t);
      }
      case 'random.seed': {
        const n = a('n');
        return atom(n ? `randomSeed(${this.expr(n, ctx).c})` : 'randomSeed(micros())', 'void');
      }
      case 'micropython.const':
        return v('value');
      case 'zero1.map_range':
        return atom(`map(${['x', 'in_min', 'in_max', 'out_min', 'out_max'].map((n) => v(n).c).join(', ')})`, 'long');
      case 'zero1.input_available':
        this.serial = true;
        return atom('(Serial.available() > 0)', 'bool');
      default:
        if (m.id.startsWith('math.')) return atom(`${m.name}(${m.params.map((p) => v(p.name).c).join(', ')})`, 'float');
        return atom('', 'void');
    }
  }

  /** time.sleep(s) (§3.3): a literal → delay(ms); a constant → delay(NAME * 1000L) / delay(round(NAME * 1000)); else pySleep. */
  private sleep(s: Expr, line: number, ctx: Ctx): Code {
    const c = this.typing.constValue(s);
    if (c && (c.type === 'int' || c.type === 'float' || c.type === 'bool') && Number(c.value) >= 0) {
      const value = Number(c.value);
      if (s.type === 'Num') return atom(`delay(${Math.round(value * 1000)})`, 'void');
      const x = this.expr(s, ctx);
      if (c.type === 'float') return atom(`delay(round(${binary(x, '*', atom('1000', 'lit'), Order.MULTIPLICATIVE, 'float').c}))`, 'void');
      return atom(`delay(${binary(this.intOperand(x), '*', atom('1000L', 'long'), Order.MULTIPLICATIVE, 'long').c})`, 'void');
    }
    this.helpers.add('pySleep');
    return atom(`pySleep(${this.expr(s, ctx).c}, ${line})`, 'void');
  }

  private method(m: ApiFunction, recv: Expr, e: Call, ctx: Ctx): Code {
    const args = this.bindApi(m.params, e);
    const a = (n: string) => args.get(n) ?? null;
    const v = (n: string) => this.expr(a(n)!, ctx);
    const r = () => this.receiver(recv, ctx).c;
    switch (m.id) {
      case 'Pin.on':
        return atom(`digitalWrite(${r()}, HIGH)`, 'void');
      case 'Pin.off':
        return atom(`digitalWrite(${r()}, LOW)`, 'void');
      case 'Pin.value': {
        const x = a('x');
        return x ? atom(`digitalWrite(${r()}, ${this.expr(x, ctx).c})`, 'void') : atom(`digitalRead(${r()})`, 'narrow');
      }
      case 'Pin.toggle': {
        const p = r();
        return atom(`digitalWrite(${p}, !digitalRead(${p}))`, 'void');
      }
      case 'PWM.duty_u16':
        return atom(`analogWrite(${r()}, ${this.scaled(a('value')!, 257, ctx)})`, 'void');
      case 'PWM.duty':
        return atom(`analogWrite(${r()}, ${this.scaled(a('value')!, 4, ctx)})`, 'void');
      case 'PWM.deinit':
        return atom(`analogWrite(${r()}, 0)`, 'void');
      case 'ADC.read':
        return atom(`analogRead(${r()})`, 'narrow');
      case 'ADC.read_u16':
        return atom(`map(analogRead(${r()}), 0, 1023, 0, 65535)`, 'long');
      case 'NeoPixel.fill': {
        const np = r();
        const c = a('colour')!;
        const colour = c.type === 'TupleLit' && this.typing.constValue(c) === null ? `${np}.Color(${c.elts.map((x) => this.expr(x, ctx).c).join(', ')})` : this.expr(c, ctx).c;
        return atom(`${np}.fill(${colour})`, 'void');
      }
      case 'NeoPixel.write':
        return atom(`${r()}.show()`, 'void');
      case 'DHT.temperature':
        return atom(`${r()}.readTemperature()`, 'float');
      case 'DHT.humidity':
        return atom(`${r()}.readHumidity()`, 'float');
      case 'HCSR04.distance_cm':
        r();
        this.pins.add('TRIG_PIN');
        this.pins.add('ECHO_PIN');
        this.helpers.add('pyDistanceCm');
        return atom(`pyDistanceCm(TRIG_PIN, ECHO_PIN, ${e.line})`, 'float');
      case 'HCSR04.distance_mm':
        r();
        this.pins.add('TRIG_PIN');
        this.pins.add('ECHO_PIN');
        this.helpers.add('pyDistanceCm');
        return prefix('(long)', atom(`(pyDistanceCm(TRIG_PIN, ECHO_PIN, ${e.line}) * 10)`, 'float'), 'long');
      case 'Servo.angle': {
        const d = a('degrees');
        return d ? atom(`${r()}.write(${this.expr(d, ctx).c})`, 'void') : atom(`${r()}.read()`, 'narrow');
      }
      case 'Servo.detach':
        return atom(`${r()}.detach()`, 'void');
      case 'LCD.clear':
        return atom(`${r()}.clear()`, 'void');
      case 'LCD.move_to':
        return atom(`${r()}.setCursor(${v('col').c}, ${v('row').c})`, 'void');
      case 'LCD.putchar': {
        const lcd = r();
        const c = a('char')!;
        if (c.type === 'Call') {
          const t = this.typing.callTarget(c);
          if (t.kind === 'builtin' && t.name === 'chr' && c.args[0]) return atom(`${lcd}.write((byte)${wrap(this.expr(c.args[0], ctx), Order.UNARY_PREFIX)})`, 'void');
        }
        if (c.type === 'Str') return atom(`${lcd}.print(${cString(c.value, true)})`, 'void');
        return atom(`${lcd}.print(${this.textCode(c, ctx).c})`, 'void');
      }
      case 'LCD.custom_char': {
        const lcd = r();
        const bm = a('bitmap')!;
        const list = bm.type === 'ListLit' || bm.type === 'ListRepeat' ? this.tempArray(bm, 'bitmap', 'byte', ctx).list : this.listArgs(bm, ctx).list;
        return atom(`${lcd}.createChar(${v('slot').c}, ${list})`, 'void');
      }
      case 'LCD.putstr':
        return atom(`${r()}.print(${this.textCode(a('text')!, ctx).c})`, 'void');
      case 'Buzzer.tone': {
        r();
        this.pins.add('BUZZER');
        const ms = a('ms');
        return atom(`tone(BUZZER, ${v('freq').c}${ms ? `, ${this.expr(ms, ctx).c}` : ''})`, 'void');
      }
      case 'Buzzer.no_tone':
        r();
        this.pins.add('BUZZER');
        return atom('noTone(BUZZER)', 'void');
      case 'SevenSegment.show':
        r();
        this.helpers.add('showDigit');
        this.segmentPins();
        return atom(`showDigit(${v('digit').c})`, 'void');
      case 'SevenSegment.segments':
        r();
        this.helpers.add('showSegments');
        this.segmentPins();
        return atom(`showSegments(${v('bits').c})`, 'void');
      case 'SevenSegment.clear':
        r();
        this.helpers.add('showSegments');
        this.segmentPins();
        return atom('showSegments(0)', 'void');
      default: {
        const LCD_CALLS: Record<string, string> = {
          'LCD.backlight_on': 'backlight',
          'LCD.backlight_off': 'noBacklight',
          'LCD.display_on': 'display',
          'LCD.display_off': 'noDisplay',
          'LCD.show_cursor': 'cursor',
          'LCD.hide_cursor': 'noCursor',
          'LCD.blink_cursor_on': 'blink',
          'LCD.blink_cursor_off': 'noBlink',
        };
        if (LCD_CALLS[m.id]) return atom(`${r()}.${LCD_CALLS[m.id]}()`, 'void');
        return atom('', 'void');
      }
    }
  }

  private segmentPins(): void {
    for (const p of ['SEG_DATA', 'SEG_LATCH', 'SEG_CLOCK'] as const) this.pins.add(p);
  }

  private strMethod(name: string, recv: Expr, e: Call, ctx: Ctx): Code {
    const text = this.textCode(recv, ctx);
    const arg = (i: number) => this.textCode(e.args[i], ctx).c;
    const helper = (h: string, ...more: string[]) => {
      this.helpers.add(h);
      return atom(`${h}(${[text.c, ...more].join(', ')})`, 'String');
    };
    const member = (m: string, t: CType, ...more: string[]) => code(`${wrap(this.receiverText(text), Order.UNARY_POSTFIX)}.${m}(${more.join(', ')})`, Order.UNARY_POSTFIX, t);
    switch (name) {
      case 'upper':
        return helper('pyUpper');
      case 'lower':
        return helper('pyLower');
      case 'strip':
        return helper('pyStrip');
      case 'replace':
        return helper('pyReplace', arg(0), arg(1));
      case 'isdigit':
        this.helpers.add('pyIsDigit');
        return atom(`pyIsDigit(${text.c})`, 'bool');
      case 'startswith':
        return member('startsWith', 'bool', arg(0));
      case 'endswith':
        return member('endsWith', 'bool', arg(0));
      case 'find':
        return prefix('(long)', member('indexOf', 'narrow', arg(0)), 'long');
      default:
        return text;
    }
  }

  private builtin(name: string, e: Call, ctx: Ctx): Code {
    const arg = e.args[0];
    const kind = arg ? this.typing.kindOf(arg) : null;
    const line = e.line;
    switch (name) {
      case 'input':
        this.serial = true;
        this.helpers.add('pyInput');
        return atom(`pyInput(${arg ? this.textCode(arg, ctx).c : '""'})`, 'String');
      case 'len': {
        if (!arg) return atom('0', 'lit');
        if (kind === 'str') {
          if (arg.type === 'Str') return atom(String(new TextEncoder().encode(arg.value).length), 'lit');
          return prefix('(long)', atom(`${wrap(this.receiverText(this.textCode(arg, ctx)), Order.UNARY_POSTFIX)}.length()`, 'narrow'), 'long');
        }
        if (kind === 'NeoPixel') return atom(String(this.pixelCount(arg) ?? 1), 'lit');
        const v = arg.type === 'Name' ? this.typing.variableOf(arg) : null;
        return v?.list ? this.sizeOf(v) : atom('0', 'lit');
      }
      case 'int': {
        if (!arg) return atom('0', 'lit');
        if (kind === 'str') {
          this.helpers.add('pyInt');
          return atom(`pyInt(${this.textCode(arg, ctx).c}, ${line})`, 'long');
        }
        const c = this.expr(arg, ctx);
        return kind === 'int' ? c : prefix('(long)', c, 'long');
      }
      case 'float': {
        if (!arg) return atom('0.0', 'float');
        if (kind === 'str') {
          this.helpers.add('pyFloatOf');
          return atom(`pyFloatOf(${this.textCode(arg, ctx).c}, ${line})`, 'float');
        }
        const c = this.expr(arg, ctx);
        if (kind === 'float') return c;
        if (c.t === 'lit') return atom(floatLiteral(Number((this.typing.constValue(arg) as { value: number } | null)?.value ?? 0)), 'float');
        return prefix('(float)', c, 'float');
      }
      case 'str': {
        if (!arg) return atom('""', 'cstr');
        if (kind === 'str') return this.textCode(arg, ctx);
        const p = this.valuePiece(arg, ctx);
        return 'text' in p ? atom(cString(p.text), 'cstr') : p.asText;
      }
      case 'bool':
        return arg ? this.truth(arg, ctx) : atom('false', 'bool');
      case 'abs': {
        const c = this.expr(arg, ctx);
        if (pure(arg)) return atom(`abs(${c.c})`, kind === 'float' ? 'float' : 'long');
        const h = kind === 'float' ? 'pyAbsF' : 'pyAbsL';
        this.helpers.add(h);
        return atom(`${h}(${c.c})`, kind === 'float' ? 'float' : 'long');
      }
      case 'min':
      case 'max': {
        const result = this.typing.kindOf(e);
        if (e.args.length === 1) {
          const { list, size, v } = this.listArgs(arg, ctx);
          const h = `py${name === 'min' ? 'Min' : 'Max'}List${v ? this.listSuffix(v) : 'L'}`;
          this.helpers.add(h);
          return atom(`${h}(${list}, ${size}, ${line})`, ctypeOf(result));
        }
        const codes = e.args.map((x) => this.expr(x, ctx));
        if (e.args.every(pure)) return codes.reduceRight((acc, c) => atom(`${name}(${c.c}, ${acc.c})`, ctypeOf(result)));
        const h = `py${name === 'min' ? 'Min' : 'Max'}${result === 'float' ? 'F' : 'L'}`;
        this.helpers.add(h);
        return codes.reduceRight((acc, c) => atom(`${h}(${c.c}, ${acc.c})`, ctypeOf(result)));
      }
      case 'round': {
        if (e.args.length >= 2) {
          this.helpers.add('pyRoundTo');
          return atom(`pyRoundTo(${this.expr(arg, ctx).c}, ${this.expr(e.args[1], ctx).c})`, 'float');
        }
        const c = this.expr(arg, ctx);
        if (kind === 'float') {
          this.helpers.add('pyRound');
          return atom(`pyRound(${c.c})`, 'long');
        }
        return kind === 'bool' ? prefix('(long)', c, 'long') : c;
      }
      case 'pow':
        return this.binop('**', null, e.args[0], e.args[1], this.typing.kindOf(e) ?? 'int', line, ctx);
      case 'chr':
        return atom(`String((char)${wrap(this.expr(arg, ctx), Order.UNARY_PREFIX)})`, 'String');
      case 'ord': {
        if (arg.type === 'Str') return atom(String(new TextEncoder().encode(arg.value)[0] ?? 0), 'lit');
        return prefix('(long)', prefix('(byte)', atom(`${wrap(this.receiverText(this.textCode(arg, ctx)), Order.UNARY_POSTFIX)}.charAt(0)`, 'narrow'), 'narrow'), 'long');
      }
      case 'sum': {
        const { list, size, v } = this.listArgs(arg, ctx);
        const h = `pySum${v ? this.listSuffix(v) : 'L'}`;
        this.helpers.add(h);
        return atom(`${h}(${list}, ${size})`, ctypeOf(this.typing.kindOf(e)));
      }
      default:
        return atom('', 'void');
    }
  }

  // ---- source text ------------------------------------------------------------------------------------------------

  /** The Python text of a span (lines joined by a space). */
  private pySource(s: Span): string {
    const lines = this.sourceLines;
    if (s.line === s.endLine) return (lines[s.line - 1] ?? '').slice(s.column - 1, s.endColumn - 1);
    const parts = [(lines[s.line - 1] ?? '').slice(s.column - 1)];
    for (let l = s.line + 1; l < s.endLine; l++) parts.push(lines[l - 1] ?? '');
    parts.push((lines[s.endLine - 1] ?? '').slice(0, s.endColumn - 1));
    return parts.map((p) => p.trim()).join(' ');
  }
}

// ---------------------------------------------------------------------------
// helpers of the emitter
// ---------------------------------------------------------------------------

/** A print() / putstr() / f-string piece: a literal text, or a value (how to print it, and it as text). */
type Piece = { text: string } | { print: string; asText: Code };

function mergePieces(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if ('text' in p && last && 'text' in last) last.text += p.text;
    else if (!('text' in p) || p.text !== '') out.push('text' in p ? { text: p.text } : p);
  }
  return out;
}

/** An expression that can be written twice (for Arduino's abs / min / max macros): no calls, no subscripts, no guarded divisions. */
function pure(e: Expr): boolean {
  let ok = true;
  walkExpr(e, (x) => {
    if (x.type === 'Call' || x.type === 'Subscript' || x.type === 'FString' || (x.type === 'BinOp' && ['/', '//', '%', '**'].includes(x.op))) ok = false;
  });
  return ok;
}

/** The expressions of a statement, targets included (for the program scan). */
function stmtExpressions(s: Stmt): Expr[] {
  switch (s.type) {
    case 'Assign': {
      const out: Expr[] = [s.value];
      const add = (t: Expr | { type: 'TupleTarget'; elts: Expr[] }) => (t.type === 'TupleTarget' ? t.elts.forEach(add) : out.push(t));
      s.targets.forEach((t) => add(t as Expr));
      return out;
    }
    case 'AugAssign':
      return s.target.type === 'Unsupported' ? [s.value] : [s.target, s.value];
    case 'ExprStmt':
      return [s.value];
    case 'Return':
      return s.value ? [s.value] : [];
    case 'If':
    case 'While':
      return [s.test];
    case 'For':
      return [s.iter];
    case 'Raise':
      return [s.exc];
    case 'Assert':
      return s.msg ? [s.test, s.msg] : [s.test];
    default:
      return [];
  }
}

/** The lines of a module docstring: one leading and one trailing newline dropped. */
function moduleDocLines(value: string): string[] {
  const text = value.replace(/^\n/, '').replace(/\n$/, '');
  return text === '' ? [] : text.split('\n');
}

/** The lines of a function docstring, dedented like inspect.cleandoc(). */
function docLines(value: string): string[] {
  const lines = value.split('\n');
  const rest = lines.slice(1).filter((l) => l.trim() !== '');
  const indent = rest.length > 0 ? Math.min(...rest.map((l) => l.length - l.trimStart().length)) : 0;
  const out = [lines[0].trim(), ...lines.slice(1).map((l) => l.slice(indent).replace(/\s+$/, ''))];
  while (out.length > 0 && out[0] === '') out.shift();
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

