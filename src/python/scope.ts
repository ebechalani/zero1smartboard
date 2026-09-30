/**
 * Name resolution of a ZERO1 Python program (docs/PYTHON.md §2.1, §2.14, §4.5): the module
 * scope and one scope per function, every Python name bound in them (a `PySymbol`), every place
 * a name gets a value (`DefSite`) or is read (`UseSite`) in evaluation order, the imports and
 * their API bindings, the main-loop split and the C++ name of every Python name.
 *
 * `resolve()` never reports anything itself: it records what the later stages need —
 * flow.ts builds the control-flow graphs from `stmtEvents`, kinds.ts types the defs, check.ts
 * reports (unknown modules, undefined names, …).
 */
import type {
  AssignTarget,
  Block,
  Expr,
  FunctionDef,
  Global,
  Identifier,
  Import,
  ImportFrom,
  ImportAlias,
  Module,
  Name,
  Param,
  Span,
  Stmt,
  Try,
  While,
} from './ast';
import { API_MODULES, BUILTINS, EXCEPTION_NAMES, REFUSED_BUILTINS, isModuleName, type ApiMember, type ModuleName } from './api';
import { RESERVED_NAMES } from './reserved-names';

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type ScopeKind = 'module' | 'function';

export interface Scope {
  kind: ScopeKind;
  /** The function whose body this is; null for the module. */
  fn: FunctionInfo | null;
  /** Every name bound in this scope: module names, or a function's parameters and locals. */
  symbols: Map<string, PySymbol>;
  /** The `global` declarations of a function, by name (the first one). */
  globals: Map<string, Global>;
  /** C++ names taken in this scope (§2.14); fresh names for the emitter come from `freshName`. */
  cppNames: Set<string>;
}

/** What gives a name its value. `undefined` and `builtin` are pseudo-definitions at the scope's entry. */
export type DefKind = 'assign' | 'augassign' | 'for' | 'import' | 'function' | 'param' | 'except' | 'builtin' | 'undefined';

export interface DefSite {
  /** Unique in the program (also the index in `Resolved.defs`). */
  id: number;
  kind: DefKind;
  sym: PySymbol;
  /** The name written: an assignment / for target, a def / parameter / alias identifier; null for pseudo-definitions and star imports. */
  node: Name | Identifier | null;
  /** The statement that makes the definition; null for parameters and pseudo-definitions. */
  stmt: Stmt | null;
  /** The scope whose code runs it (a function for a `global` write to a module name). */
  scope: Scope;
  /**
   * assign: the value (the right side, or its item for `a, b = x, y`); augassign: the right side
   * of `x op= e` (the operator is `stmt.op`); for: the iterable; param: the default (or null);
   * otherwise null.
   */
  value: Expr | null;
  /** import: what the name is bound to. */
  import?: ImportBinding;
  /** function: the function. */
  fn?: FunctionInfo;
}

export interface UseSite {
  id: number;
  sym: PySymbol;
  /** The name read (for `x += 1`, the target itself). */
  node: Name;
  stmt: Stmt;
  /** The scope whose code reads it (a function for a module name read there). */
  scope: Scope;
}

/** A Python name bound in a scope (§2.14: module names are C++ globals, a name assigned in a def is local unless global). */
export interface PySymbol {
  name: string;
  scope: Scope;
  /** The C++ name (§2.14 steps 1–2); a web of another kind gets `_2`, `_3` (kinds.ts Variable.cppName). */
  cppName: string;
  /** Real definitions in program order (a module name's `global` writes in functions included). */
  defs: DefSite[];
  /** Every read (module names: also the reads in functions). */
  uses: UseSite[];
  /** The "not assigned yet" pseudo-definition at the scope's entry. */
  undefinedDef: DefSite;
  /** A module name that is also a Python built-in: the built-in until the program assigns it (W-shadow). */
  builtinDef: DefSite | null;
  /** A module name read or assigned by a function (with global): one web (§2.9). */
  shared: boolean;
  /** Assigned by a function after `global` (then a C++ global even without a top-level assignment). */
  writtenByFunction: boolean;
  /** The parameter, for a function's parameter. */
  param: Param | null;
}

export interface FunctionInfo {
  def: FunctionDef;
  name: string;
  /** The C++ function name (§2.14). */
  cppName: string;
  scope: Scope;
  /** The parameters' symbols, in order. */
  params: PySymbol[];
  /** Its definition of the module name. */
  defSite: DefSite;
  /** Every `return` of its body. */
  returns: Array<Stmt & { type: 'Return' }>;
}

/** What an import binds a name to (`module` null: an unknown module, E-module). */
export interface ImportBinding {
  stmt: Import | ImportFrom;
  /** The `a [as b]` item; null for `from m import *`. */
  alias: ImportAlias | null;
  /** The module (null when unknown). */
  module: ModuleName | null;
  /** `import m`: null. `from m import x`: the member (null when m has no x: E-import-name, or m is unknown). */
  member: ApiMember | null;
  /** The name after `import` in `from m import x` (the member's name as written). */
  memberName: string | null;
}

/** A read or write of a name, event by event in evaluation order. */
export type FlowEvent = { use: UseSite; def?: undefined } | { def: DefSite; use?: undefined };

/** The events of one statement: `main` when it runs; `head` each round of a `for` (the target); `handler` at an `except` (its alias). */
export interface StmtEvents {
  main: FlowEvent[];
  head?: FlowEvent[];
  handler?: FlowEvent[];
}

/** What a Name expression refers to. */
export type NameRef =
  | { kind: 'symbol'; sym: PySymbol; use: UseSite | null; def: DefSite | null }
  /** Not bound anywhere in the program: a Python built-in function (allowed or not) or exception name. */
  | { kind: 'builtin'; name: string }
  /** Not bound anywhere and not a built-in (E-name family). */
  | { kind: 'unbound'; name: string };

/** The main-loop split (§2.1). */
export interface MainSplit {
  /** The final top-level `while True:` (or `while 1:`), or null (no main loop: everything runs in setup()). */
  loop: While | null;
  /** The top-level statements before it (all of them without a main loop). */
  setup: Stmt[];
  /** The statements after it (only defs). */
  after: Stmt[];
}

export interface Resolved {
  module: Module;
  /** The normalised source (for texts quoted in messages). */
  source: string;
  /** The top-level statements, with `if __name__ == "__main__":` unwrapped (its body in its place). */
  body: Stmt[];
  /** The `if __name__ == "__main__":` statements that were unwrapped (the emitter skips them). */
  mainGuards: Stmt[];
  main: MainSplit;
  /** No main loop: the app finishes the run after setup() (§2.1 rule 2). */
  endsAfterSetup: boolean;
  /** A top-level `while True:` that never ends but is not the main loop, and the first statement after it (W-unreachable). */
  unreachable: { loop: While; first: Stmt } | null;
  moduleScope: Scope;
  /** Every function, in program order. */
  functions: FunctionInfo[];
  functionOf: Map<FunctionDef, FunctionInfo>;
  /** Every definition and use, by id. */
  defs: DefSite[];
  uses: UseSite[];
  /** What every Name expression refers to. */
  refs: Map<Name, NameRef>;
  /** The flow events of every statement (in every scope). */
  stmtEvents: Map<Stmt, StmtEvents>;
  /** The scope whose code a statement is. */
  scopeOf: Map<Stmt, Scope>;
  /** The statement whose block a statement is directly in (null: the module's or the function's top level). */
  parentOf: Map<Stmt, Stmt | null>;
  /** The block a statement is directly in (null: the module's top level, with the main guard unwrapped, or a function's body). */
  blockOf: Map<Stmt, Block | null>;
  /** Every import binding, in program order. */
  imports: ImportBinding[];
  /** The program calls input() (§7.9). */
  usesInput: boolean;
}

// ---------------------------------------------------------------------------
// C++ names (§2.14)
// ---------------------------------------------------------------------------

const TRANSLITERATION: Readonly<Record<string, string>> = {
  ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ł: 'l', Ł: 'L', þ: 'th', Þ: 'TH',
};

/**
 * §2.14 step 1: NFD, combining marks dropped, then ß→ss æ→ae œ→oe ø→o đ→d ł→l þ→th (and the
 * capitals); any other non-ASCII character → `u` + its code point in (at least) 4 hex digits.
 */
export function transliterate(name: string): string {
  let out = '';
  for (const ch of name.normalize('NFD').replace(/\p{M}/gu, '')) {
    if (ch.charCodeAt(0) < 0x80) out += ch;
    else if (Object.prototype.hasOwnProperty.call(TRANSLITERATION, ch)) out += TRANSLITERATION[ch];
    else out += 'u' + ch.codePointAt(0)!.toString(16).padStart(4, '0');
  }
  return out;
}

/** §2.14 step 2: `base` with `_` appended while it is reserved or already taken in `scope`; the result is taken. */
export function freshName(scope: Scope, base: string): string {
  let name = base;
  while (RESERVED_NAMES.has(name) || scope.cppNames.has(name)) name += '_';
  scope.cppNames.add(name);
  return name;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Every Python built-in the checker knows by name (allowed, refused, exceptions, and the rest of `builtins`). */
const OTHER_BUILTINS: ReadonlySet<string> = new Set(['__name__', '__file__', '__doc__', '__debug__', 'NotImplemented', 'Ellipsis', 'copyright', 'credits', 'license']);

export function isPythonBuiltin(name: string): boolean {
  const has = (o: object) => Object.prototype.hasOwnProperty.call(o, name);
  return has(BUILTINS) || has(REFUSED_BUILTINS) || EXCEPTION_NAMES.has(name) || OTHER_BUILTINS.has(name);
}

/** Python's built-in *functions* (W-shadow's "is a Python built-in function"). */
export function isBuiltinFunction(name: string): boolean {
  const has = (o: object) => Object.prototype.hasOwnProperty.call(o, name);
  return has(BUILTINS) || has(REFUSED_BUILTINS);
}

/** `while True:` / `while 1:`. */
export function isEndlessTest(test: Expr): boolean {
  return (test.type === 'Bool' && test.value) || (test.type === 'Num' && !test.isFloat && test.value === 1);
}

/** A `break` that leaves `loop` (directly in its body, or in ifs / tries there — not in a nested loop). */
export function hasBreakOut(block: Block): boolean {
  for (const s of block.stmts) {
    if (s.type === 'Break') return true;
    if (s.type === 'If' && (hasBreakOut(s.body) || (s.orelse && hasBreakOut(s.orelse)))) return true;
    if (s.type === 'Try' && (hasBreakOut(s.body) || hasBreakOut(s.handler.body) || (s.orelse && hasBreakOut(s.orelse)))) return true;
  }
  return false;
}

/** `if __name__ == "__main__":` without else. */
function isMainGuard(s: Stmt): s is Stmt & { type: 'If' } {
  if (s.type !== 'If' || s.orelse !== null) return false;
  const t = s.test;
  if (t.type !== 'Compare' || t.ops.length !== 1 || t.ops[0] !== '==') return false;
  const [a, b] = [t.left, t.comparators[0]];
  const isName = (e: Expr) => e.type === 'Name' && e.id === '__name__';
  const isMain = (e: Expr) => e.type === 'Str' && e.value === '__main__';
  return (isName(a) && isMain(b)) || (isMain(a) && isName(b));
}

/** The child blocks of a statement (not of a def: its body is another scope). */
export function childBlocks(s: Stmt): Block[] {
  switch (s.type) {
    case 'If':
      return s.orelse ? [s.body, s.orelse] : [s.body];
    case 'While':
    case 'For':
      return [s.body];
    case 'Try':
      return s.orelse ? [s.body, s.handler.body, s.orelse] : [s.body, s.handler.body];
    default:
      return [];
  }
}

/** Every sub-expression of `e` in evaluation order, `e` last (post-order). */
export function walkExpr(e: Expr, visit: (x: Expr) => void): void {
  switch (e.type) {
    case 'Call':
      walkExpr(e.func, visit);
      for (const a of e.args) walkExpr(a, visit);
      for (const k of e.keywords) walkExpr(k.value, visit);
      break;
    case 'Attribute':
      walkExpr(e.value, visit);
      break;
    case 'Subscript':
      walkExpr(e.value, visit);
      walkExpr(e.index, visit);
      break;
    case 'BinOp':
      walkExpr(e.left, visit);
      walkExpr(e.right, visit);
      break;
    case 'UnaryOp':
      walkExpr(e.operand, visit);
      break;
    case 'BoolOp':
      for (const v of e.values) walkExpr(v, visit);
      break;
    case 'Compare':
      walkExpr(e.left, visit);
      for (const c of e.comparators) walkExpr(c, visit);
      break;
    case 'IfExp':
      walkExpr(e.test, visit);
      walkExpr(e.body, visit);
      walkExpr(e.orelse, visit);
      break;
    case 'ListLit':
    case 'TupleLit':
      for (const x of e.elts) walkExpr(x, visit);
      break;
    case 'ListRepeat':
      walkExpr(e.list, visit);
      walkExpr(e.count, visit);
      break;
    case 'FString':
      for (const p of e.parts) if (p.type === 'field') walkExpr(p.value, visit);
      break;
    default:
      break;
  }
  visit(e);
}

/** The expressions a statement evaluates itself (not those of its blocks), in evaluation order. */
export function stmtExprs(s: Stmt): Expr[] {
  switch (s.type) {
    case 'Assign': {
      const out: Expr[] = [s.value];
      for (const t of s.targets) out.push(...targetExprs(t));
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
      return s.cause ? [s.exc, s.cause] : [s.exc];
    case 'Assert':
      return s.msg ? [s.test, s.msg] : [s.test];
    case 'FunctionDef':
      return s.params.filter((p) => p.default).map((p) => p.default!);
    default:
      return [];
  }
}

/** The expressions of an assignment target that are evaluated (subscripts and attributes; names are written). */
function targetExprs(t: AssignTarget): Expr[] {
  if (t.type === 'TupleTarget') return t.elts.flatMap((x) => targetExprs(x));
  if (t.type === 'Subscript') return [t.value, t.index];
  if (t.type === 'Attribute') return [t.value];
  return [];
}

// ---------------------------------------------------------------------------
// the resolver
// ---------------------------------------------------------------------------

/** Resolves a parsed program. `source` is the normalised text (for quoting the program in messages). */
export function resolve(module: Module, source = ''): Resolved {
  return new Resolver(module, source).run();
}

class Resolver {
  private readonly defs: DefSite[] = [];
  private readonly uses: UseSite[] = [];
  private readonly refs = new Map<Name, NameRef>();
  private readonly stmtEvents = new Map<Stmt, StmtEvents>();
  private readonly scopeOf = new Map<Stmt, Scope>();
  private readonly parentOf = new Map<Stmt, Stmt | null>();
  private readonly blockOf = new Map<Stmt, Block | null>();
  private readonly functions: FunctionInfo[] = [];
  private readonly functionOf = new Map<FunctionDef, FunctionInfo>();
  private readonly imports: ImportBinding[] = [];
  private readonly moduleScope: Scope = { kind: 'module', fn: null, symbols: new Map(), globals: new Map(), cppNames: new Set() };
  private usesInput = false;
  private body: Stmt[] = [];
  private readonly mainGuards: Stmt[] = [];

  constructor(
    private readonly module: Module,
    private readonly source: string,
  ) {}

  run(): Resolved {
    this.body = this.unwrap(this.module.body.stmts);
    const main = this.mainSplit();
    // Phase 1: which names each scope binds (Python decides locals by the whole function body).
    this.declareBlockStmts(this.body, this.moduleScope);
    for (const info of this.functions) this.declareFunction(info);
    // Phase 2: the events of every statement, in program order.
    this.eventsOfBlock(this.body, this.moduleScope, null);
    for (const info of this.functions) {
      for (const p of info.params) this.addDef('param', p, p.param!, null, info.scope, p.param!.default);
      this.eventsOfBlock(info.def.body.stmts, info.scope, null);
    }
    this.nameCpp();
    return {
      module: this.module,
      source: this.source,
      body: this.body,
      mainGuards: this.mainGuards,
      main,
      endsAfterSetup: main.loop === null,
      unreachable: this.unreachable(main),
      moduleScope: this.moduleScope,
      functions: this.functions,
      functionOf: this.functionOf,
      defs: this.defs,
      uses: this.uses,
      refs: this.refs,
      stmtEvents: this.stmtEvents,
      scopeOf: this.scopeOf,
      parentOf: this.parentOf,
      blockOf: this.blockOf,
      imports: this.imports,
      usesInput: this.usesInput,
    };
  }

  /** §2.1 rule 3: `if __name__ == "__main__":` at top level is unwrapped. */
  private unwrap(stmts: readonly Stmt[]): Stmt[] {
    const out: Stmt[] = [];
    for (const s of stmts) {
      if (isMainGuard(s)) {
        this.mainGuards.push(s);
        out.push(...this.unwrap(s.body.stmts));
      } else {
        out.push(s);
      }
    }
    return out;
  }

  /** §2.1 rule 1: the final top-level `while True:` with no break out of it and only defs after it. */
  private mainSplit(): MainSplit {
    let k = this.body.length - 1;
    while (k >= 0 && this.body[k].type === 'FunctionDef') k--;
    const last = this.body[k];
    if (last && last.type === 'While' && isEndlessTest(last.test) && !last.orelse && !hasBreakOut(last.body)) {
      return { loop: last, setup: this.body.slice(0, k), after: this.body.slice(k + 1) };
    }
    return { loop: null, setup: [...this.body], after: [] };
  }

  /** §2.1 rule 4: statements after an endless top-level `while True:` that is not the main loop. */
  private unreachable(main: MainSplit): { loop: While; first: Stmt } | null {
    for (let k = 0; k < this.body.length; k++) {
      const s = this.body[k];
      if (s === main.loop || s.type !== 'While' || !isEndlessTest(s.test) || s.orelse || hasBreakOut(s.body)) continue;
      const first = this.body.slice(k + 1).find((x) => x.type !== 'FunctionDef');
      if (first) return { loop: s, first };
    }
    return null;
  }

  // ---- phase 1: declarations ------------------------------------------------

  private symbol(scope: Scope, name: string): PySymbol {
    let sym = scope.symbols.get(name);
    if (!sym) {
      sym = {
        name,
        scope,
        cppName: '',
        defs: [],
        uses: [],
        undefinedDef: null as unknown as DefSite,
        builtinDef: null,
        shared: false,
        writtenByFunction: false,
        param: null,
      };
      sym.undefinedDef = this.pseudoDef('undefined', sym, scope);
      if (scope.kind === 'module' && isPythonBuiltin(name)) sym.builtinDef = this.pseudoDef('builtin', sym, scope);
      scope.symbols.set(name, sym);
    }
    return sym;
  }

  private pseudoDef(kind: 'undefined' | 'builtin', sym: PySymbol, scope: Scope): DefSite {
    const def: DefSite = { id: this.defs.length, kind, sym, node: null, stmt: null, scope, value: null };
    this.defs.push(def);
    return def;
  }

  /** Names bound by the statements of a block (and nested blocks) in `scope`; defs create function scopes. */
  private declareBlockStmts(stmts: readonly Stmt[], scope: Scope): void {
    for (const s of stmts) this.declareStmt(s, scope);
  }

  private declareStmt(s: Stmt, scope: Scope): void {
    const bind = (name: string) => {
      if (scope.kind === 'function' && scope.globals.has(name)) {
        const sym = this.symbol(this.moduleScope, name);
        sym.shared = true;
        sym.writtenByFunction = true;
      } else {
        this.symbol(scope, name);
      }
    };
    const bindTarget = (t: AssignTarget) => {
      if (t.type === 'Name') bind(t.id);
      else if (t.type === 'TupleTarget') t.elts.forEach(bindTarget);
    };
    switch (s.type) {
      case 'Assign':
        s.targets.forEach(bindTarget);
        break;
      case 'AugAssign':
        bindTarget(s.target);
        break;
      case 'For':
        bindTarget(s.target);
        break;
      case 'Import':
        for (const a of s.names) bind(a.asname?.name ?? a.name.split('.')[0]);
        break;
      case 'ImportFrom':
        if (s.star) {
          if (isModuleName(s.module.name)) for (const name of Object.keys(API_MODULES[s.module.name].members)) bind(name);
        } else {
          for (const a of s.names) bind(a.asname?.name ?? a.name);
        }
        break;
      case 'Try':
        if (s.handler.alias) bind(s.handler.alias.name);
        break;
      case 'FunctionDef': {
        bind(s.name.name);
        if (scope.kind === 'module') this.newFunction(s);
        break;
      }
      default:
        break;
    }
    for (const b of childBlocks(s)) this.declareBlockStmts(b.stmts, scope);
  }

  private newFunction(def: FunctionDef): void {
    const scope: Scope = { kind: 'function', fn: null, symbols: new Map(), globals: new Map(), cppNames: new Set() };
    const info: FunctionInfo = { def, name: def.name.name, cppName: '', scope, params: [], defSite: null as unknown as DefSite, returns: [] };
    scope.fn = info;
    this.functions.push(info);
    this.functionOf.set(def, info);
  }

  private declareFunction(info: FunctionInfo): void {
    const scope = info.scope;
    // `global` applies to the whole function (the parser reports one written after a use).
    const collectGlobals = (stmts: readonly Stmt[]) => {
      for (const s of stmts) {
        if (s.type === 'Global') for (const n of s.names) if (!scope.globals.has(n.name)) scope.globals.set(n.name, s);
        for (const b of childBlocks(s)) collectGlobals(b.stmts);
      }
    };
    collectGlobals(info.def.body.stmts);
    for (const name of scope.globals.keys()) this.symbol(this.moduleScope, name).shared = true;
    for (const p of info.def.params) {
      const sym = this.symbol(scope, p.name);
      sym.param = p;
      info.params.push(sym);
    }
    this.declareBlockStmts(info.def.body.stmts, scope);
  }

  // ---- phase 2: events ---------------------------------------------------------

  private addDef(kind: DefKind, sym: PySymbol, node: Name | Identifier | null, stmt: Stmt | null, scope: Scope, value: Expr | null): DefSite {
    const def: DefSite = { id: this.defs.length, kind, sym, node, stmt, scope, value };
    this.defs.push(def);
    sym.defs.push(def);
    return def;
  }

  /** The symbol a name written in `scope` binds. */
  private targetSymbol(name: string, scope: Scope): PySymbol {
    if (scope.kind === 'function' && !scope.globals.has(name)) return this.symbol(scope, name);
    return this.symbol(this.moduleScope, name);
  }

  /** The symbol a name read in `scope` refers to, or null (a built-in or an unbound name). */
  private lookup(name: string, scope: Scope): PySymbol | null {
    if (scope.kind === 'function' && !scope.globals.has(name)) {
      const local = scope.symbols.get(name);
      if (local) return local;
    }
    const sym = this.moduleScope.symbols.get(name) ?? null;
    if (sym && scope.kind === 'function') sym.shared = true;
    return sym;
  }

  private eventsOfBlock(stmts: readonly Stmt[], scope: Scope, parent: Stmt | null, block: Block | null = null): void {
    for (const s of stmts) {
      this.scopeOf.set(s, scope);
      this.parentOf.set(s, parent);
      this.blockOf.set(s, block);
      this.stmtEvents.set(s, this.eventsOf(s, scope));
      for (const b of childBlocks(s)) this.eventsOfBlock(b.stmts, scope, s, b);
    }
  }

  private eventsOf(s: Stmt, scope: Scope): StmtEvents {
    const main: FlowEvent[] = [];
    const read = (e: Expr) => this.reads(e, s, scope, main);
    const write = (t: AssignTarget, value: Expr | null, kind: DefKind) => {
      if (t.type === 'Name') {
        const sym = this.targetSymbol(t.id, scope);
        const def = this.addDef(kind, sym, t, s, scope, value);
        this.refs.set(t, { kind: 'symbol', sym, use: null, def });
        main.push({ def });
      } else if (t.type === 'TupleTarget') {
        t.elts.forEach((x, k) => write(x, value && value.type === 'TupleLit' && value.elts.length === t.elts.length ? value.elts[k] : null, kind));
      } else if (t.type === 'Subscript') {
        read(t.value);
        read(t.index);
      } else if (t.type === 'Attribute') {
        read(t.value);
      }
    };
    switch (s.type) {
      case 'Assign':
        read(s.value);
        for (const t of s.targets) write(t, s.value, 'assign');
        return { main };
      case 'AugAssign': {
        if (s.target.type === 'Name') {
          const sym = this.targetSymbol(s.target.id, scope);
          const use = this.addUse(sym, s.target, s, scope);
          main.push({ use });
          read(s.value);
          const def = this.addDef('augassign', sym, s.target, s, scope, s.value);
          this.refs.set(s.target, { kind: 'symbol', sym, use, def });
          main.push({ def });
        } else {
          if (s.target.type !== 'Unsupported') read(s.target);
          read(s.value);
        }
        return { main };
      }
      case 'For': {
        read(s.iter);
        const head: FlowEvent[] = [];
        if (s.target.type === 'Name') {
          const sym = this.targetSymbol(s.target.id, scope);
          const def = this.addDef('for', sym, s.target, s, scope, s.iter);
          this.refs.set(s.target, { kind: 'symbol', sym, use: null, def });
          head.push({ def });
        }
        return { main, head };
      }
      case 'Try': {
        const handler: FlowEvent[] = [];
        const alias = s.handler.alias;
        if (alias) handler.push({ def: this.addDef('except', this.targetSymbol(alias.name, scope), alias, s, scope, null) });
        return { main, handler };
      }
      case 'FunctionDef': {
        for (const p of s.params) if (p.default) read(p.default);
        const info = this.functionOf.get(s);
        const sym = this.targetSymbol(s.name.name, scope);
        const def = this.addDef('function', sym, s.name, s, scope, null);
        if (info) {
          def.fn = info;
          info.defSite = def;
        }
        main.push({ def });
        return { main };
      }
      case 'Import':
        for (const a of s.names) {
          const module = isModuleName(a.name) ? a.name : null;
          const binding: ImportBinding = { stmt: s, alias: a, module, member: null, memberName: null };
          this.imports.push(binding);
          const node = a.asname ?? { name: a.name.split('.')[0], line: a.line, column: a.column, endLine: a.line, endColumn: a.column + a.name.split('.')[0].length };
          const def = this.addDef('import', this.targetSymbol(node.name, scope), node, s, scope, null);
          def.import = binding;
          main.push({ def });
        }
        return { main };
      case 'ImportFrom': {
        const module = isModuleName(s.module.name) ? s.module.name : null;
        if (s.star) {
          const binding: ImportBinding = { stmt: s, alias: null, module, member: null, memberName: null };
          this.imports.push(binding);
          if (module) {
            for (const [name, member] of Object.entries(API_MODULES[module].members)) {
              const def = this.addDef('import', this.targetSymbol(name, scope), null, s, scope, null);
              def.import = { ...binding, member, memberName: name };
              main.push({ def });
            }
          }
          return { main };
        }
        for (const a of s.names) {
          const members = module ? API_MODULES[module].members : null;
          const member = members && Object.prototype.hasOwnProperty.call(members, a.name) ? members[a.name] : null;
          const binding: ImportBinding = { stmt: s, alias: a, module, member, memberName: a.name };
          this.imports.push(binding);
          const node: Identifier = a.asname ?? { name: a.name, line: a.line, column: a.column, endLine: a.line, endColumn: a.column + a.name.length };
          const def = this.addDef('import', this.targetSymbol(node.name, scope), node, s, scope, null);
          def.import = binding;
          main.push({ def });
        }
        return { main };
      }
      case 'Return':
        if (scope.fn) scope.fn.returns.push(s);
        for (const e of stmtExprs(s)) read(e);
        return { main };
      default:
        for (const e of stmtExprs(s)) read(e);
        return { main };
    }
  }

  private addUse(sym: PySymbol, node: Name, stmt: Stmt, scope: Scope): UseSite {
    const use: UseSite = { id: this.uses.length, sym, node, stmt, scope };
    this.uses.push(use);
    sym.uses.push(use);
    return use;
  }

  /** The reads of `e` in evaluation order (appended to `out`). */
  private reads(e: Expr, stmt: Stmt, scope: Scope, out: FlowEvent[]): void {
    walkExpr(e, (x) => {
      if (x.type === 'Call' && x.func.type === 'Name' && x.func.id === 'input') this.usesInput = true;
      if (x.type !== 'Name') return;
      const sym = this.lookup(x.id, scope);
      if (sym) {
        const use = this.addUse(sym, x, stmt, scope);
        this.refs.set(x, { kind: 'symbol', sym, use, def: null });
        out.push({ use });
      } else {
        this.refs.set(x, isPythonBuiltin(x.id) ? { kind: 'builtin', name: x.id } : { kind: 'unbound', name: x.id });
      }
    });
  }

  // ---- C++ names (§2.14) -----------------------------------------------------------

  private nameCpp(): void {
    // Module scope: every module name and function, in the order they first appear.
    const firstAt = (sym: PySymbol) => {
      const first = sym.defs.find((d) => d.kind !== 'function') ?? sym.uses[0];
      return first?.node ?? null;
    };
    const order = (a: Span | null, b: Span | null) => (a && b ? a.line - b.line || a.column - b.column : a ? -1 : b ? 1 : 0);
    const moduleItems: Array<{ at: Span | null; name: (n: string) => void; base: string }> = [];
    for (const sym of this.moduleScope.symbols.values()) {
      if (sym.defs.some((d) => d.kind !== 'function' && d.kind !== 'import')) {
        moduleItems.push({ at: firstAt(sym), base: transliterate(sym.name), name: (n) => (sym.cppName = n) });
      } else {
        sym.cppName = transliterate(sym.name);
      }
    }
    for (const info of this.functions) moduleItems.push({ at: info.def.name, base: transliterate(info.name), name: (n) => (info.cppName = n) });
    moduleItems.sort((a, b) => order(a.at, b.at));
    for (const item of moduleItems) item.name(freshName(this.moduleScope, item.base));
    // Function scopes: parameters first, then locals in order.
    for (const info of this.functions) {
      const syms = [...info.scope.symbols.values()].sort((a, b) => (a.param && !b.param ? -1 : b.param && !a.param ? 1 : order(firstAt(a), firstAt(b))));
      for (const sym of syms) sym.cppName = freshName(info.scope, transliterate(sym.name));
    }
  }
}
