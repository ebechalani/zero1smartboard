/**
 * Kinds of a ZERO1 Python program (docs/PYTHON.md §2.9, §2.10, §3.6): the C++ type of every
 * value. Python has no types on variables, so the translator infers a *kind* for every web
 * (flow.ts), parameter, return value, list element and expression, by a fixed point over the
 * whole program (§2.9: recursion ≤ 8 rounds; anything still unknown is a whole number).
 *
 * The result (`Typing`) is what the emitter builds on: the C++ variables (webs of one name and
 * one kind merged, `name_2` for another kind), where each is declared (§4.7 D1–D3), constants,
 * fixed and growable lists with their capacity, board objects, what every call and attribute
 * is, constant values and the non-negative facts of N3. The conflicts it meets (E-retype,
 * E-param-kinds, E-return-kinds, E-list-kinds) are reported by check.ts.
 */
import type { Call, Expr, For, Name, Stmt } from './ast';
import {
  API_PARTS,
  isPartName,
  lookupMember,
  pinOfText,
  type ApiClass,
  type ApiConstant,
  type ApiFunction,
  type ApiRefused,
  type ApiResult,
  type ModuleName,
  type PartName,
} from './api';
import { isVariableDef, type Flow, type Web } from './flow';
import { childBlocks, freshName, walkExpr, type DefSite, type FunctionInfo, type PySymbol, type Resolved, type UseSite } from './scope';

// ---------------------------------------------------------------------------
// kinds
// ---------------------------------------------------------------------------

/** The kinds of §2.9: `color` is an (r, g, b) tuple (`unsigned long` 0xRRGGBB). */
export type ScalarKind = 'int' | 'float' | 'bool' | 'str' | 'color';
/** What a list holds: one scalar kind, or Pin objects (fixed lists only). */
export type ElementKind = ScalarKind | 'Pin';
export type ListKind = `list<${ElementKind}>`;
/** A value's kind: scalar, list, board object (a part), or `none` (a call that gives nothing). */
export type Kind = ScalarKind | ListKind | PartName | 'none';

/** During inference a list may not know its items yet. */
type IKind = Kind | 'list<?>';

export function listOf(elem: ElementKind): ListKind {
  return `list<${elem}>`;
}

/** The item kind of a list kind; null for anything else. */
export function elementOf(kind: Kind | null): ElementKind | null {
  const m = kind ? /^list<(\w+)>$/.exec(kind) : null;
  return m ? (m[1] as ElementKind) : null;
}

export function isListKind(kind: Kind | null): kind is ListKind {
  return !!kind && kind.startsWith('list<');
}

/** int, float or bool (bool counts as a number in arithmetic, like Python). */
export function isNumeric(kind: Kind | null): kind is 'int' | 'float' | 'bool' {
  return kind === 'int' || kind === 'float' || kind === 'bool';
}

export function isPartKind(kind: Kind | null): kind is PartName {
  return !!kind && isPartName(kind);
}

/** Python's name for the type of a value of this kind (the words of TypeError messages). */
export function pythonType(kind: Kind | null): string {
  if (kind === null) return 'object';
  if (kind === 'color') return 'tuple';
  if (kind === 'none') return 'NoneType';
  if (isListKind(kind)) return 'list';
  return kind;
}

const NUMERIC_RANK: Readonly<Record<string, number>> = { bool: 0, int: 1, float: 2 };

/** §2.9 "combining kinds": bool+int → int, int/bool+float → float; null when they cannot be one. */
export function combineKinds(a: Kind, b: Kind): Kind | null {
  if (a === b) return a;
  if (a in NUMERIC_RANK && b in NUMERIC_RANK) return NUMERIC_RANK[a] > NUMERIC_RANK[b] ? a : b;
  const ea = elementOf(a);
  const eb = elementOf(b);
  if (ea && eb) {
    const e = combineKinds(ea, eb);
    return e && !isListKind(e) && e !== 'none' && !isPartName(e) ? listOf(e as ScalarKind) : e === 'Pin' ? 'list<Pin>' : null;
  }
  return null;
}

function combineI(a: IKind | null, b: IKind | null): { kind: IKind | null; conflict: boolean } {
  if (a === null) return { kind: b, conflict: false };
  if (b === null) return { kind: a, conflict: false };
  if (a === 'list<?>' && (b === 'list<?>' || isListKind(b as Kind))) return { kind: b, conflict: false };
  if (b === 'list<?>' && isListKind(a as Kind)) return { kind: a, conflict: false };
  if (a === 'list<?>' || b === 'list<?>') return { kind: a, conflict: true };
  const c = combineKinds(a, b);
  return c ? { kind: c, conflict: false } : { kind: a, conflict: true };
}

// ---------------------------------------------------------------------------
// public types
// ---------------------------------------------------------------------------

/** A constant value (§2.9 Constants, §4.7 E2 folding): a number, text, True/False, a colour 0xRRGGBB or a list of them. */
export type ConstValue = { type: 'int'; value: number } | { type: 'float'; value: number } | { type: 'str'; value: string } | { type: 'bool'; value: boolean } | { type: 'color'; value: number } | { type: 'list'; items: ConstValue[] };

/** What an expression stands for when it is not (only) a value. */
export type Denotation =
  | { kind: 'value'; type: Kind | null }
  /** `import time`: the module (null: unknown module, E-module). */
  | { kind: 'module'; module: ModuleName | null }
  /** A class that makes a part (`Pin`, `dht.DHT22`). */
  | { kind: 'class'; cls: ApiClass; module: ModuleName }
  /** A module function (`time.sleep`, `randint` after `from random import randint`). */
  | { kind: 'api'; member: ApiFunction; module: ModuleName }
  /** A MicroPython name ZERO1 Python does not have (NA-api). */
  | { kind: 'refused'; member: ApiRefused }
  | { kind: 'function'; fn: FunctionInfo }
  /** A Python built-in (allowed or not) or an exception name. */
  | { kind: 'builtin'; name: string }
  /** A part's method, not called (`led.on`). */
  | { kind: 'method'; part: PartName; member: ApiFunction | ApiRefused; receiver: Expr }
  | { kind: 'str-method'; name: string; receiver: Expr }
  | { kind: 'list-method'; name: string; receiver: Expr }
  /** Could not be resolved (an error is reported for it). */
  | { kind: 'unknown' };

/** What a call calls. */
export type CallTarget =
  | { kind: 'function'; fn: FunctionInfo }
  | { kind: 'builtin'; name: string }
  | { kind: 'api'; member: ApiFunction; module: ModuleName }
  | { kind: 'class'; cls: ApiClass; module: ModuleName }
  | { kind: 'method'; part: PartName; member: ApiFunction; receiver: Expr }
  /** `p()` / `p(x)` on a Pin: `p.value()` / `p.value(x)`. */
  | { kind: 'pin-call'; receiver: Expr }
  | { kind: 'str-method'; name: string; receiver: Expr }
  | { kind: 'list-method'; name: string; receiver: Expr }
  | { kind: 'refused'; member: ApiRefused }
  /** Calling a value that is not a function (E-not-callable). */
  | { kind: 'not-callable'; type: Kind | null }
  | { kind: 'unknown' };

export interface ListInfo {
  elem: ElementKind;
  /** Appended, popped or cleared somewhere (§2.10): `T name[CAP]` + `long nameCount`. */
  growable: boolean;
  /** Fixed: its number of items; growable: the starting number (null for a list parameter). */
  length: number | null;
  /** Growable: room for this many items (starting length + provable appends, or + 20). */
  capacity: number;
  /** The capacity is the default + 20 (W-list-capacity). */
  capacityGuessed: boolean;
  /** Never written after its creation (no item assignment, append, pop or clear). */
  neverWritten: boolean;
}

export interface ObjectInfo {
  part: PartName;
  /** The class it was made with (`Pin`, `DHT22`, `SoftI2C`, …). */
  cls: ApiClass;
  /** The constructor call. */
  call: Call;
  /** The pin, when it is fixed (Pin, PWM, ADC, NeoPixel, DHT and pinned parts). */
  pin: number | null;
  /** Pin: made with Pin.OUT. */
  output: boolean;
}

/** One C++ variable (§2.9): the webs of one Python name and one kind. */
export interface Variable {
  id: number;
  sym: PySymbol;
  kind: Kind;
  webs: Web[];
  /** Every definition and use of its webs, in program order. */
  defs: DefSite[];
  uses: UseSite[];
  /** The C++ name: the symbol's for the first variable of a name, then `name_2`, `name_3` (§2.14 step 3). */
  cppName: string;
  /** 1 for the first variable of a name; 2 for `name_2` (the sketch says "// 'answer' again, now a number"). */
  index: number;
  /**
   * §4.7 D1–D3: `global` (the globals section), `setup` / `loop` (a local of setup() / loop()),
   * `local` (a function's local or parameter).
   */
  storage: 'global' | 'setup' | 'loop' | 'local';
  /**
   * Where a local is declared: at this definition (`long value = analogRead(adc);` — it dominates
   * every use and every use is in its block), or null: at the top of its function / setup() /
   * loop() with its zero value. Globals: null.
   */
  declareAt: DefSite | null;
  /** A global whose first definition is a top-level constant expression that runs before any use: its initialiser (D1). */
  init: DefSite | null;
  /** `const` (§2.9 Constants). */
  constant: boolean;
  constValue: ConstValue | null;
  list: ListInfo | null;
  object: ObjectInfo | null;
  /** Known ≥ 0 (§2.9, N3). */
  nonNegative: boolean;
  /** A function parameter's variable. */
  isParam: boolean;
}

export interface FunctionTyping {
  fn: FunctionInfo;
  /** The kind of each parameter (a list parameter gets a hidden length, §2.10). */
  paramKinds: Kind[];
  /** The variable of each parameter (its first web). */
  paramVariables: Array<Variable | null>;
  /** `none` for a function that gives nothing (`void`). */
  returnKind: Kind;
  /** The calls to it (program order). */
  calls: Call[];
  /** It calls itself, directly or through other functions (W-recursion). */
  recursive: boolean;
}

/** A kind conflict (check.ts reports it). */
export type KindConflict =
  /** One web holds text and a number, or a list / object / colour and something else. */
  | { code: 'E-retype'; sym: PySymbol; a: DefSite; b: DefSite; at: UseSite | null; kinds: [Kind, Kind] }
  /** A conditional expression that gives text or a number. */
  | { code: 'E-retype-ifexp'; expr: Expr }
  | { code: 'E-param-kinds'; fn: FunctionInfo; param: number; a: { kind: Kind; line: number }; b: { kind: Kind; line: number } }
  | { code: 'E-return-kinds'; fn: FunctionInfo; a: { kind: Kind; line: number }; b: { kind: Kind; line: number } }
  | { code: 'E-list-kinds'; sym: PySymbol; a: { kind: Kind; line: number }; b: { kind: Kind; line: number }; at: Expr };

export interface Typing {
  /** The kind of a value expression (null: unknown, or not a value). */
  kindOf(e: Expr): Kind | null;
  denote(e: Expr): Denotation;
  callTarget(call: Call): CallTarget;
  /** Every C++ variable, by the program order of its first definition. */
  variables: Variable[];
  variableOfWeb: Map<Web, Variable>;
  /** The variable a name reads or writes (null: not a variable there). For `x += e` it is the variable written. */
  variableOf(name: Name): Variable | null;
  /** The variable a name reads: for the target of `x += e`, the variable whose value is read (it may differ: `x = 10; x /= 4`). */
  readVariableOf(name: Name): Variable | null;
  /** The kind each definition gives its name. */
  defKind: Map<DefSite, Kind | null>;
  functions: Map<FunctionInfo, FunctionTyping>;
  /** The value of a constant expression (literals, constants, API constants, colour and list literals of them). */
  constValue(e: Expr): ConstValue | null;
  /** Known ≥ 0 (N3): non-negative literals and constants, readings, + * // % of such values, variables whose every definition is. */
  nonNegative(e: Expr): boolean;
  /** The API constant an expression names (`Pin.OUT`, `LED_RED`, `math.pi`). */
  apiConstant(e: Expr): ApiConstant | null;
  /** The pin an expression gives to a part (§3 "Pins"): a number 0..19, a ZERO1 name, its text form, a Pin; null when not fixed; -1 when it is no pin. */
  pinOf(e: Expr): number | null;
  conflicts: KindConflict[];
  /** The program's first NeoPixel (computed colours use its Color(), §3.6). */
  neoPixel: Variable | null;
}

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------

/** The text methods ZERO1 Python has (§2.7) and what they give. */
export const STR_METHODS: Readonly<Record<string, Kind>> = {
  upper: 'str',
  lower: 'str',
  strip: 'str',
  replace: 'str',
  startswith: 'bool',
  endswith: 'bool',
  find: 'int',
  isdigit: 'bool',
};

/** The list methods ZERO1 Python has (§2.10). */
export const LIST_METHODS: ReadonlySet<string> = new Set(['append', 'pop', 'clear']);

/** Calls whose value is known ≥ 0 (N3 readings). */
const NON_NEGATIVE_API = new Set(['ADC.read', 'ADC.read_u16', 'Pin.value', 'time.ticks_ms', 'time.ticks_us', 'time.time', 'machine.time_pulse_us', 'HCSR04.distance_mm']);

/** Bytes of RAM per kind for W-memory (String: 6 + its text). */
export const KIND_BYTES: Readonly<Record<string, number>> = { int: 4, float: 4, bool: 1, str: 6, color: 4, Pin: 2 };

// ---------------------------------------------------------------------------
// inference
// ---------------------------------------------------------------------------

export function infer(resolved: Resolved, flow: Flow): Typing {
  return new Inference(resolved, flow).run();
}

class Inference {
  private webKind = new Map<Web, IKind | null>();
  private paramKind = new Map<FunctionInfo, Array<IKind | null>>();
  private returnKind = new Map<FunctionInfo, IKind | null>();
  private memo = new Map<Expr, IKind | null>();
  /** Webs whose kind fell back to the default (unknown after the fixed point). */
  private defaulted = new Map<Web, IKind>();
  private defaultedParams = new Map<FunctionInfo, Array<IKind | null>>();
  private defaultedReturns = new Map<FunctionInfo, IKind>();
  /** Where each list web gets items after its creation: append(v), lst[i] = v, lst[i] op= v. */
  private readonly listWrites = new Map<Web, Array<{ value: Expr; op: string | null; at: Expr }>>();
  private readonly listGrowth = new Map<Web, Call[]>();
  private readonly listItemWrites = new Set<Web>();
  private readonly callsTo = new Map<FunctionInfo, Call[]>();
  private readonly allCalls: Array<{ call: Call; stmt: Stmt }> = [];
  private readonly conflicts: KindConflict[] = [];
  private finalPass = false;
  private stepChanged = false;

  constructor(
    private readonly resolved: Resolved,
    private readonly flow: Flow,
  ) {}

  run(): Typing {
    this.collect();
    for (const fn of this.resolved.functions) {
      this.paramKind.set(fn, fn.params.map(() => null));
      this.returnKind.set(fn, null);
    }
    // Fixed point, then defaults for what is still unknown, then again.
    this.iterate(24);
    this.applyDefaults();
    this.iterate(24);
    this.finalPass = true;
    this.memo.clear();
    this.step();
    this.memo.clear();
    for (const { call } of this.allCalls) this.kindOfI(call);
    this.typeEverything();
    return this.build();
  }

  // ---- program scan ------------------------------------------------------------

  private collect(): void {
    const visitStmt = (s: Stmt) => {
      for (const e of this.stmtExprsDeep(s)) {
        walkExpr(e, (x) => {
          if (x.type === 'Call') this.allCalls.push({ call: x, stmt: s });
        });
      }
    };
    const visitBlock = (stmts: readonly Stmt[]) => {
      for (const s of stmts) {
        visitStmt(s);
        for (const b of childBlocks(s)) visitBlock(b.stmts);
      }
    };
    visitBlock(this.resolved.body);
    for (const fn of this.resolved.functions) visitBlock(fn.def.body.stmts);
  }

  /** The expressions of a statement, targets included. */
  private stmtExprsDeep(s: Stmt): Expr[] {
    switch (s.type) {
      case 'Assign': {
        const out: Expr[] = [s.value];
        const add = (t: Expr | { type: 'TupleTarget'; elts: Expr[] }) => {
          if (t.type === 'TupleTarget') t.elts.forEach(add);
          else out.push(t);
        };
        s.targets.forEach(add);
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
        return [s.target, s.iter];
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

  /** Types every expression of the program once (so conditional-expression conflicts are recorded). */
  private typeEverything(): void {
    const visit = (stmts: readonly Stmt[]) => {
      for (const st of stmts) {
        for (const e of this.stmtExprsDeep(st)) walkExpr(e, (x) => void this.kindOfI(x));
        for (const b of childBlocks(st)) visit(b.stmts);
      }
    };
    visit(this.resolved.body);
    for (const fn of this.resolved.functions) visit(fn.def.body.stmts);
  }

  /** Calls to own functions, list writes (after the webs are known). */
  private collectUses(): void {
    this.callsTo.clear();
    this.listWrites.clear();
    this.listGrowth.clear();
    this.listItemWrites.clear();
    for (const { call } of this.allCalls) {
      const t = this.callTarget(call);
      if (t.kind === 'function') {
        const list = this.callsTo.get(t.fn) ?? [];
        list.push(call);
        this.callsTo.set(t.fn, list);
      }
      if (call.func.type === 'Attribute' && call.func.value.type === 'Name') {
        const web = this.webOfName(call.func.value);
        const name = call.func.attr.name;
        if (web && (name === 'append' || name === 'pop' || name === 'clear')) {
          const g = this.listGrowth.get(web) ?? [];
          g.push(call);
          this.listGrowth.set(web, g);
          if (name === 'append' && call.args.length === 1) this.addListWrite(web, { value: call.args[0], op: null, at: call });
        }
      }
    }
    const visit = (stmts: readonly Stmt[]) => {
      for (const s of stmts) {
        if (s.type === 'Assign') {
          const targets: Expr[] = [];
          const add = (t: Expr | { type: 'TupleTarget'; elts: Expr[] }) => (t.type === 'TupleTarget' ? t.elts.forEach(add) : targets.push(t));
          s.targets.forEach(add);
          for (const t of targets) {
            if (t.type !== 'Subscript' || t.value.type !== 'Name') continue;
            const web = this.webOfName(t.value);
            if (!web) continue;
            this.listItemWrites.add(web);
            const tuple = s.targets.find((x) => x.type === 'TupleTarget');
            const k = tuple && tuple.type === 'TupleTarget' ? tuple.elts.findIndex((x) => x === t) : -1;
            const value = k >= 0 && s.value.type === 'TupleLit' ? s.value.elts[k] ?? s.value : s.value;
            this.addListWrite(web, { value, op: null, at: t });
          }
        } else if (s.type === 'AugAssign' && s.target.type === 'Subscript' && s.target.value.type === 'Name') {
          const web = this.webOfName(s.target.value);
          if (web) {
            this.listItemWrites.add(web);
            this.addListWrite(web, { value: s.value, op: s.op, at: s.target });
          }
        }
        for (const b of childBlocks(s)) visit(b.stmts);
      }
    };
    visit(this.resolved.body);
    for (const fn of this.resolved.functions) visit(fn.def.body.stmts);
  }

  private addListWrite(web: Web, w: { value: Expr; op: string | null; at: Expr }): void {
    const list = this.listWrites.get(web) ?? [];
    list.push(w);
    this.listWrites.set(web, list);
  }

  private webOfName(name: Name): Web | null {
    const b = this.flow.bindingOf(name);
    return b.kind === 'variable' ? b.web : null;
  }

  // ---- the fixed point ----------------------------------------------------------

  private iterate(max: number): void {
    for (let k = 0; k < max; k++) {
      this.memo.clear();
      if (!this.step()) return;
    }
  }

  /** One round: every web, parameter and return kind, each committed at once (Gauss-Seidel); true when something changed. */
  private step(): boolean {
    this.collectUses();
    const conflicts: KindConflict[] = [];
    for (const web of this.flow.webs) {
      let kind: IKind | null = null;
      let first: DefSite | null = null;
      let conflict: { a: DefSite; b: DefSite } | null = null;
      for (const d of web.defs) {
        const k = this.defKindI(d);
        if (k === null) continue;
        const c = combineI(kind, k);
        if (c.conflict && !conflict && first) conflict = { a: first, b: d };
        kind = c.kind;
        if (!first) first = d;
      }
      // A list's items: its writes after the creation.
      if (kind === 'list<?>' || (kind && isListKind(kind))) {
        let elem: IKind | null = kind === 'list<?>' ? null : elementOf(kind);
        let elemLine = first?.node?.line ?? 0;
        for (const w of this.listWrites.get(web) ?? []) {
          const vk = w.op ? this.binKind(w.op, elem as Kind | null, this.kindOfI(w.value), w.value) : this.kindOfI(w.value);
          if (vk === null || vk === 'none') continue;
          const c = combineI(elem, vk);
          if (c.conflict && elem && this.finalPass) {
            const textFirst = elem === 'str';
            conflicts.push({
              code: 'E-list-kinds',
              sym: web.sym,
              a: textFirst ? { kind: vk as Kind, line: w.at.line } : { kind: elem as Kind, line: elemLine },
              b: textFirst ? { kind: 'str', line: elemLine } : { kind: vk as Kind, line: w.at.line },
              at: w.at,
            });
          }
          if (!c.conflict) {
            if (elem === null) elemLine = w.at.line;
            elem = c.kind;
          }
        }
        const scalar = elem === 'int' || elem === 'float' || elem === 'bool' || elem === 'str' || elem === 'color' || elem === 'Pin';
        kind = scalar ? listOf(elem as ElementKind) : 'list<?>';
      }
      if (kind === null && this.defaulted.has(web)) kind = this.defaulted.get(web)!;
      if (kind === 'list<?>' && this.defaulted.has(web)) kind = this.defaulted.get(web)!;
      // Gauss-Seidel: later webs see this one's new kind at once.
      if ((this.webKind.get(web) ?? null) !== kind) {
        this.webKind.set(web, kind);
        this.memo.clear();
        this.stepChanged = true;
      }
      if (conflict && this.finalPass) {
        const ka = this.defKindI(conflict.a) as Kind;
        const kb = this.defKindI(conflict.b) as Kind;
        const at = web.uses.find((u) => {
          const seen = this.flow.reaching.get(u) ?? [];
          return seen.includes(conflict!.a) && seen.includes(conflict!.b);
        });
        conflicts.push({ code: 'E-retype', sym: web.sym, a: conflict.a, b: conflict.b, at: at ?? null, kinds: [ka, kb] });
      }
    }
    // Parameters: the arguments of every call (+ the default); returns: every `return e`.
    for (const fn of this.resolved.functions) {
      const kinds: Array<IKind | null> = fn.params.map(() => null);
      const seen: Array<{ kind: Kind; line: number } | null> = fn.params.map(() => null);
      const flagged = new Set<number>();
      const add = (i: number, k: IKind | null, line: number) => {
        if (k === null || k === 'none' || k === 'list<?>') return;
        const c = combineI(kinds[i], k);
        if (c.conflict && this.finalPass && !flagged.has(i) && seen[i]) {
          flagged.add(i);
          // The number first, then the text (the message's order); other kinds in program order.
          const now = { kind: k as Kind, line };
          const [a, b] = seen[i]!.kind === 'str' && k !== 'str' ? [now, seen[i]!] : [seen[i]!, now];
          conflicts.push({ code: 'E-param-kinds', fn, param: i, a, b });
        }
        if (!c.conflict) kinds[i] = c.kind;
        if (!seen[i]) seen[i] = { kind: k as Kind, line };
      };
      for (const call of this.callsTo.get(fn) ?? []) {
        const args = this.bindArgs(fn, call);
        args.forEach((a, i) => a && add(i, this.kindOfI(a), a.line));
      }
      fn.def.params.forEach((p, i) => p.default && add(i, this.kindOfI(p.default), p.default.line));
      const dp = this.defaultedParams.get(fn);
      if (dp) dp.forEach((k, i) => kinds[i] === null && k !== null && (kinds[i] = k));
      if (kinds.some((k, i) => this.paramKind.get(fn)![i] !== k)) {
        this.paramKind.set(fn, kinds);
        this.memo.clear();
        this.stepChanged = true;
      }
      let ret: IKind | null = null;
      let retSeen: { kind: Kind; line: number } | null = null;
      let retFlagged = false;
      for (const r of fn.returns) {
        if (!r.value || r.value.type === 'NoneLit') continue;
        const k = this.kindOfI(r.value);
        if (k === null || k === 'none') continue;
        const c = combineI(ret, k);
        if (c.conflict && this.finalPass && !retFlagged && retSeen) {
          retFlagged = true;
          // The text first, then the number (the message's order); other kinds in program order.
          const now = { kind: k as Kind, line: r.line };
          const [a, b] = k === 'str' && retSeen.kind !== 'str' ? [now, retSeen] : [retSeen, now];
          conflicts.push({ code: 'E-return-kinds', fn, a, b });
        }
        if (!c.conflict) ret = c.kind;
        if (!retSeen) retSeen = { kind: k as Kind, line: r.line };
      }
      if (ret === null && this.defaultedReturns.has(fn)) ret = this.defaultedReturns.get(fn)!;
      if (this.returnKind.get(fn) !== ret) {
        this.returnKind.set(fn, ret);
        this.memo.clear();
        this.stepChanged = true;
      }
    }
    const changed = this.stepChanged;
    this.stepChanged = false;
    if (this.finalPass) this.conflicts.push(...conflicts);
    return changed;
  }

  private applyDefaults(): void {
    for (const web of this.flow.webs) {
      const k = this.webKind.get(web) ?? null;
      if (k === null) this.defaulted.set(web, 'int');
      else if (k === 'list<?>') this.defaulted.set(web, 'list<int>');
    }
    for (const fn of this.resolved.functions) {
      this.defaultedParams.set(
        fn,
        this.paramKind.get(fn)!.map((k) => (k === null ? 'int' : k === 'list<?>' ? 'list<int>' : null)),
      );
      if (this.returnKind.get(fn) === null && fn.returns.some((r) => r.value && r.value.type !== 'NoneLit')) this.defaultedReturns.set(fn, 'int');
    }
  }

  /** The arguments that go to each parameter of `fn` at `call` (defaults excluded); extra or unknown ones are left out. */
  bindArgs(fn: FunctionInfo, call: Call): Array<Expr | null> {
    const out: Array<Expr | null> = fn.params.map(() => null);
    call.args.forEach((a, i) => {
      if (i < out.length && a.type !== 'Unsupported') out[i] = a;
    });
    for (const k of call.keywords) {
      const i = fn.def.params.findIndex((p) => p.name === k.name.name);
      if (i >= 0 && out[i] === null) out[i] = k.value;
    }
    return out;
  }

  // ---- definitions ---------------------------------------------------------------

  private defKindI(d: DefSite): IKind | null {
    switch (d.kind) {
      case 'assign': {
        if (!d.value) return null;
        const k = this.kindOfI(d.value);
        return k === 'none' ? null : k;
      }
      case 'augassign': {
        const stmt = d.stmt;
        if (!stmt || stmt.type !== 'AugAssign' || !d.value) return null;
        const target = stmt.target.type === 'Name' ? stmt.target : null;
        const ref = target ? this.resolved.refs.get(target) : null;
        const use = ref && ref.kind === 'symbol' ? ref.use : null;
        const left = use ? this.useKindI(use) : null;
        return this.binKind(stmt.op, left as Kind | null, this.kindOfI(d.value), d.value);
      }
      case 'for':
        return d.value ? this.iterElementKind(d.value) : null;
      case 'except':
        return 'str';
      case 'param': {
        const fn = d.scope.fn;
        if (!fn) return null;
        const i = fn.params.indexOf(d.sym);
        return i >= 0 ? this.paramKind.get(fn)![i] ?? null : null;
      }
      default:
        return null;
    }
  }

  private useKindI(use: UseSite): IKind | null {
    const web = this.flow.webOfUse.get(use);
    return web ? this.webKind.get(web) ?? null : null;
  }

  /** The kind of the items a `for` loop goes over (null: E-not-iterable or unknown). */
  private iterElementKind(iter: Expr): IKind | null {
    if (iter.type === 'Call') {
      const t = this.callTarget(iter);
      if (t.kind === 'builtin' && t.name === 'range') return 'int';
      if (t.kind === 'method' && t.part === 'I2C' && t.member.name === 'scan') return 'int';
    }
    const k = this.kindOfI(iter);
    if (k === 'str') return 'str';
    if (k && isListKind(k as Kind)) return elementOf(k as Kind);
    return null;
  }

  // ---- expressions ------------------------------------------------------------------

  kindOfI(e: Expr): IKind | null {
    if (this.memo.has(e)) return this.memo.get(e)!;
    this.memo.set(e, null); // cycles (never in a tree, but safe)
    const k = this.computeKind(e);
    this.memo.set(e, k);
    return k;
  }

  private computeKind(e: Expr): IKind | null {
    switch (e.type) {
      case 'Num':
        return e.isFloat ? 'float' : 'int';
      case 'Str':
      case 'FString':
        return 'str';
      case 'Bool':
        return 'bool';
      case 'NoneLit':
        return 'none';
      case 'Name':
      case 'Attribute': {
        const d = this.denote(e);
        return d.kind === 'value' ? d.type : null;
      }
      case 'BinOp':
        return this.binKind(e.op, this.kindOfI(e.left) as Kind | null, this.kindOfI(e.right) as Kind | null, e.right);
      case 'UnaryOp': {
        const k = this.kindOfI(e.operand);
        if (e.op === 'not') return 'bool';
        if (e.op === '~') return k === 'int' || k === 'bool' ? 'int' : null;
        if (k === 'bool') return 'int';
        return k === 'int' || k === 'float' ? k : null;
      }
      case 'BoolOp':
      case 'Compare':
        return 'bool';
      case 'IfExp': {
        const a = this.kindOfI(e.body);
        const b = this.kindOfI(e.orelse);
        const c = combineI(a, b);
        if (c.conflict && this.finalPass && !this.conflicts.some((x) => x.code === 'E-retype-ifexp' && x.expr === e)) this.conflicts.push({ code: 'E-retype-ifexp', expr: e });
        return c.conflict ? null : c.kind;
      }
      case 'Call':
        return this.callKind(e);
      case 'Subscript': {
        const k = this.kindOfI(e.value);
        if (k === 'str') return 'str';
        if (k === 'list<?>') return null;
        return k ? elementOf(k as Kind) : null;
      }
      case 'ListLit': {
        let elem: IKind | null = null;
        for (const x of e.elts) {
          const k = this.kindOfI(x);
          if (k === null || k === 'none') continue;
          if (isListKind(k as Kind) || k === 'list<?>') return null; // NA-nested-list
          if (isPartName(k) && k !== 'Pin') return null;
          const c = combineI(elem, k);
          if (c.conflict) return elem && !isListKind(elem as Kind) ? listOf(elem as ElementKind) : null; // E-list-kinds (check.ts)
          elem = c.kind;
        }
        return elem === null ? 'list<?>' : listOf(elem as ElementKind);
      }
      case 'ListRepeat':
        return this.kindOfI(e.list);
      case 'TupleLit':
        return e.parenthesized && e.elts.length === 3 ? 'color' : null;
      default:
        return null;
    }
  }

  /** §2.5 / §2.9: the kind of `a op b` (null when Python would stop or ZERO1 Python refuses it). */
  binKind(op: string, a: Kind | null | IKind, b: Kind | null | IKind, right: Expr | null): IKind | null {
    if (a === null || b === null) return null;
    const num = (k: IKind) => k === 'int' || k === 'float' || k === 'bool';
    const wider = (x: IKind, y: IKind): IKind => (x === 'float' || y === 'float' ? 'float' : 'int');
    switch (op) {
      case '+':
        if (a === 'str' && b === 'str') return 'str';
        return num(a) && num(b) ? wider(a, b) : null;
      case '-':
        return num(a) && num(b) ? wider(a, b) : null;
      case '*':
        if ((a === 'str' && (b === 'int' || b === 'bool')) || (b === 'str' && (a === 'int' || a === 'bool'))) return 'str';
        return num(a) && num(b) ? wider(a, b) : null;
      case '/':
        return num(a) && num(b) ? 'float' : null;
      case '//':
      case '%':
        return num(a) && num(b) ? wider(a, b) : null;
      case '**': {
        if (!num(a) || !num(b)) return null;
        if (a === 'float' || b === 'float') return 'float';
        const negLiteral = right && right.type === 'UnaryOp' && right.op === '-' && right.operand.type === 'Num';
        return negLiteral ? 'float' : 'int';
      }
      case '&':
      case '|':
      case '^':
        if (a === 'bool' && b === 'bool') return 'bool';
        return (a === 'int' || a === 'bool') && (b === 'int' || b === 'bool') ? 'int' : null;
      case '<<':
      case '>>':
        return (a === 'int' || a === 'bool') && (b === 'int' || b === 'bool') ? 'int' : null;
      default:
        return null;
    }
  }

  denote(e: Expr): Denotation {
    if (e.type === 'Name') {
      const b = this.flow.bindingOf(e);
      switch (b.kind) {
        case 'variable': {
          const k = this.webKind.get(b.web) ?? null;
          return { kind: 'value', type: k === 'list<?>' ? null : (k as Kind | null) };
        }
        case 'function':
          return { kind: 'function', fn: b.fn };
        case 'builtin':
          return { kind: 'builtin', name: b.name };
        case 'import': {
          const imp = b.binding;
          if (!imp.module) return { kind: 'unknown' };
          if (imp.memberName === null) return { kind: 'module', module: imp.module };
          const m = imp.member;
          if (!m) return { kind: 'unknown' };
          return this.memberDenotation(m, imp.module);
        }
        default:
          return { kind: 'unknown' };
      }
    }
    if (e.type === 'Attribute') {
      const base = this.denote(e.value);
      const name = e.attr.name;
      if (base.kind === 'module') {
        if (!base.module) return { kind: 'unknown' };
        const m = lookupMember(base.module, name);
        return m ? this.memberDenotation(m, base.module) : { kind: 'unknown' };
      }
      if (base.kind === 'class') {
        const part = API_PARTS[base.cls.part];
        const s = Object.prototype.hasOwnProperty.call(part.statics, name) ? part.statics[name] : null;
        if (s && s.kind === 'constant') return { kind: 'value', type: s.valueKind };
        if (s && s.kind === 'refused') return { kind: 'refused', member: s };
        return { kind: 'unknown' };
      }
      if (base.kind === 'value' && base.type) {
        const t = base.type;
        if (isPartName(t)) {
          const part = API_PARTS[t];
          if (Object.prototype.hasOwnProperty.call(part.methods, name)) return { kind: 'method', part: t, member: part.methods[name], receiver: e.value };
          const s = Object.prototype.hasOwnProperty.call(part.statics, name) ? part.statics[name] : null;
          if (s && s.kind === 'constant') return { kind: 'value', type: s.valueKind };
          if (s && s.kind === 'refused') return { kind: 'refused', member: s };
          return { kind: 'unknown' };
        }
        if (t === 'str') return { kind: 'str-method', name, receiver: e.value };
        if (isListKind(t)) return { kind: 'list-method', name, receiver: e.value };
      }
      return { kind: 'unknown' };
    }
    return { kind: 'value', type: this.kindOfI(e) as Kind | null };
  }

  private memberDenotation(m: ApiConstant | ApiFunction | ApiClass | ApiRefused, module: ModuleName): Denotation {
    switch (m.kind) {
      case 'class':
        return { kind: 'class', cls: m, module };
      case 'constant':
        return { kind: 'value', type: m.valueKind };
      case 'refused':
        return { kind: 'refused', member: m };
      default:
        return { kind: 'api', member: m, module };
    }
  }

  callTarget(call: Call): CallTarget {
    const d = this.denote(call.func);
    switch (d.kind) {
      case 'function':
        return { kind: 'function', fn: d.fn };
      case 'builtin':
        return { kind: 'builtin', name: d.name };
      case 'api':
        return { kind: 'api', member: d.member, module: d.module };
      case 'class':
        return { kind: 'class', cls: d.cls, module: d.module };
      case 'method':
        return d.member.kind === 'refused' ? { kind: 'refused', member: d.member } : { kind: 'method', part: d.part, member: d.member, receiver: d.receiver };
      case 'str-method':
        return { kind: 'str-method', name: d.name, receiver: d.receiver };
      case 'list-method':
        return { kind: 'list-method', name: d.name, receiver: d.receiver };
      case 'refused':
        return { kind: 'refused', member: d.member };
      case 'value':
        if (d.type === 'Pin') return { kind: 'pin-call', receiver: call.func };
        return { kind: 'not-callable', type: d.type };
      case 'module':
        return { kind: 'not-callable', type: null };
      default:
        return { kind: 'unknown' };
    }
  }

  private resultKind(r: ApiResult, call: Call): IKind | null {
    switch (r) {
      case 'item': {
        const k = call.args[0] ? this.kindOfI(call.args[0]) : null;
        return k && k !== 'list<?>' ? elementOf(k as Kind) : null;
      }
      case 'same':
        return call.args[0] ? this.kindOfI(call.args[0]) : null;
      default:
        return r;
    }
  }

  private callKind(call: Call): IKind | null {
    const t = this.callTarget(call);
    const arg = (i: number) => (call.args[i] ? this.kindOfI(call.args[i]) : null);
    switch (t.kind) {
      case 'function': {
        const hasValue = t.fn.returns.some((r) => r.value && r.value.type !== 'NoneLit');
        return hasValue ? this.returnKind.get(t.fn) ?? null : 'none';
      }
      case 'builtin':
        switch (t.name) {
          case 'print':
            return 'none';
          case 'input':
          case 'str':
          case 'chr':
            return 'str';
          case 'len':
          case 'int':
          case 'ord':
            return 'int';
          case 'float':
            return 'float';
          case 'bool':
            return 'bool';
          case 'abs': {
            const k = arg(0);
            return k === 'float' ? 'float' : k === 'int' || k === 'bool' ? 'int' : null;
          }
          case 'min':
          case 'max': {
            if (call.args.length === 1) {
              const k = arg(0);
              const el = k && k !== 'list<?>' ? elementOf(k as Kind) : null;
              return el === 'bool' ? 'int' : el === 'int' || el === 'float' ? el : null;
            }
            let out: IKind | null = null;
            for (let i = 0; i < call.args.length; i++) {
              const k = arg(i);
              if (k !== 'int' && k !== 'float' && k !== 'bool') return null;
              out = out === 'float' || k === 'float' ? 'float' : 'int';
            }
            return out;
          }
          case 'round':
            return call.args.length >= 2 ? 'float' : arg(0) === 'int' || arg(0) === 'bool' || arg(0) === 'float' ? 'int' : null;
          case 'pow':
            return this.binKind('**', arg(0), arg(1), call.args[1] ?? null);
          case 'sum': {
            const k = arg(0);
            const el = k && k !== 'list<?>' ? elementOf(k as Kind) : null;
            return el === 'bool' || el === 'int' ? 'int' : el === 'float' ? 'float' : null;
          }
          default:
            return null;
        }
      case 'api':
        return this.resultKind(t.member.result, call);
      case 'class':
        return t.cls.part;
      case 'method': {
        const reads = t.member.read !== undefined && call.args.length === 0 && call.keywords.length === 0;
        if (reads) return typeof t.member.read === 'string' ? this.resultKind(t.member.read, call) : null;
        return this.resultKind(t.member.result, call);
      }
      case 'pin-call':
        return call.args.length === 0 && call.keywords.length === 0 ? 'int' : 'none';
      case 'str-method':
        return Object.prototype.hasOwnProperty.call(STR_METHODS, t.name) ? STR_METHODS[t.name] : null;
      case 'list-method': {
        if (t.name === 'append' || t.name === 'clear') return 'none';
        if (t.name === 'pop') {
          const k = this.kindOfI(t.receiver);
          return k && k !== 'list<?>' ? elementOf(k as Kind) : null;
        }
        return null;
      }
      default:
        return null;
    }
  }

  // ---- the result ----------------------------------------------------------------------

  private build(): Typing {
    const resolved = this.resolved;
    const flow = this.flow;
    const kindOf = (e: Expr): Kind | null => {
      const k = this.kindOfI(e);
      return k === 'list<?>' ? 'list<int>' : (k as Kind | null);
    };
    const defKind = new Map<DefSite, Kind | null>();
    for (const d of resolved.defs) if (isVariableDef(d)) defKind.set(d, fixList(this.defKindI(d)));

    // Variables: the webs of one symbol and one kind, first definition first.
    const variables: Variable[] = [];
    const variableOfWeb = new Map<Web, Variable>();
    const bySym = new Map<PySymbol, Web[]>();
    for (const web of flow.webs) {
      const list = bySym.get(web.sym) ?? [];
      list.push(web);
      bySym.set(web.sym, list);
    }
    const posOf = (d: DefSite) => (d.node ? d.node.line * 100000 + d.node.column : 0);
    for (const [sym, webs] of bySym) {
      webs.sort((a, b) => posOf(a.defs[0]) - posOf(b.defs[0]));
      const groups = new Map<Kind, Web[]>();
      for (const w of webs) {
        const k = fixList(this.webKind.get(w) ?? 'int') ?? 'int';
        const g = groups.get(k) ?? [];
        g.push(w);
        groups.set(k, g);
      }
      let index = 0;
      const base = sym.cppName.replace(/_+$/, '') || sym.cppName;
      for (const [kind, ws] of groups) {
        index++;
        const defs = ws.flatMap((w) => w.defs).sort((a, b) => posOf(a) - posOf(b));
        const uses = ws.flatMap((w) => w.uses).sort((a, b) => a.node.line - b.node.line || a.node.column - b.node.column);
        const v: Variable = {
          id: 0,
          sym,
          kind,
          webs: ws,
          defs,
          uses,
          cppName: index === 1 ? sym.cppName : freshName(sym.scope, `${base}_${index}`),
          index,
          storage: 'global',
          declareAt: null,
          init: null,
          constant: false,
          constValue: null,
          list: null,
          object: null,
          nonNegative: false,
          isParam: defs.some((d) => d.kind === 'param'),
        };
        variables.push(v);
        for (const w of ws) variableOfWeb.set(w, v);
      }
    }
    variables.sort((a, b) => posOf(a.defs[0]) - posOf(b.defs[0]));
    variables.forEach((v, i) => (v.id = i));

    const variableOf = (name: Name): Variable | null => {
      const b = flow.bindingOf(name);
      return b.kind === 'variable' ? variableOfWeb.get(b.web) ?? null : null;
    };

    const readVariableOf = (name: Name): Variable | null => {
      const ref = resolved.refs.get(name);
      if (ref && ref.kind === 'symbol' && ref.use) {
        const w = flow.webOfUse.get(ref.use);
        return w ? variableOfWeb.get(w) ?? null : null;
      }
      return variableOf(name);
    };
    const typing: Typing = {
      kindOf,
      denote: (e) => this.denote(e),
      callTarget: (c) => this.callTarget(c),
      variables,
      variableOfWeb,
      variableOf,
      readVariableOf,
      defKind,
      functions: new Map(),
      constValue: (e) => null,
      nonNegative: () => false,
      apiConstant: (e) => null,
      pinOf: () => null,
      conflicts: this.conflicts,
      neoPixel: null,
    };
    const consts = new ConstEvaluator(typing, flow);
    typing.constValue = (e) => consts.value(e);
    typing.apiConstant = (e) => consts.apiConstant(e);
    typing.pinOf = (e) => consts.pinOf(e);

    // Constants (§2.9).
    for (const v of variables) {
      if (v.defs.length !== 1 || v.defs[0].kind !== 'assign' || !v.defs[0].value || v.sym.writtenByFunction) continue;
      const d = v.defs[0];
      const all = v.sym.defs.filter(isVariableDef);
      if (all.length !== 1) continue;
      const isConstCall = d.value!.type === 'Call' && consts.isConstCall(d.value as Call);
      const upper = /^[A-Z][A-Z0-9_]*$/.test(v.sym.name) && v.sym.scope === resolved.moduleScope && resolved.parentOf.get(d.stmt!) === null && resolved.main.setup.includes(d.stmt!);
      if (!isConstCall && !upper) continue;
      if (isPartKind(v.kind)) continue;
      const value = consts.value(d.value!);
      if (value === null) continue;
      v.constant = true;
      v.constValue = value;
    }

    // Lists (§2.10).
    for (const v of variables) {
      const elem = elementOf(v.kind);
      if (!elem) continue;
      const growth = v.webs.flatMap((w) => this.listGrowth.get(w) ?? []);
      const itemWrites = v.webs.some((w) => this.listItemWrites.has(w));
      const creation = v.defs.find((d) => d.kind === 'assign') ?? null;
      const length = creation && creation.value ? listLength(creation.value, consts) : null;
      const growable = growth.length > 0;
      let capacity = length ?? 0;
      let guessed = false;
      if (growable) {
        let provable = 0;
        for (const call of growth) {
          if (call.func.type !== 'Attribute' || call.func.attr.name !== 'append') continue;
          const bound = this.appendBound(call, consts);
          if (bound === null) {
            guessed = true;
            break;
          }
          provable += bound;
        }
        capacity = (length ?? 0) + (guessed ? 20 : provable);
      }
      if (v.constant && (growable || itemWrites)) {
        v.constant = false;
        v.constValue = null;
      }
      v.list = { elem, growable, length, capacity, capacityGuessed: growable && guessed, neverWritten: !growable && !itemWrites };
    }

    // Board objects (§2.9, §3).
    for (const v of variables) {
      if (!isPartKind(v.kind)) continue;
      const d = v.defs.find((x) => x.kind === 'assign' && x.value?.type === 'Call');
      const call = d?.value as Call | undefined;
      const t = call ? this.callTarget(call) : null;
      if (call && t && t.kind === 'class') v.object = objectInfo(t.cls, call, consts);
    }
    // Aliases of a Pin / ADC (`b = a`) share the original's object.
    for (const v of variables) {
      if (v.object || !isPartKind(v.kind)) continue;
      const d = v.defs.find((x) => x.kind === 'assign' && x.value?.type === 'Name');
      const other = d ? variableOf(d.value as Name) : null;
      if (other?.object) v.object = other.object;
    }
    typing.neoPixel = variables.find((v) => v.object?.part === 'NeoPixel') ?? null;

    // Non-negative facts (N3): greatest fixed point over the int variables' webs.
    const nonNeg = new NonNegative(typing, resolved, flow);
    nonNeg.solve(flow.webs, variableOfWeb);
    typing.nonNegative = (e) => nonNeg.expr(e);
    for (const v of variables) v.nonNegative = v.kind === 'int' && v.webs.every((w) => nonNeg.web(w));

    // Functions.
    for (const fn of resolved.functions) {
      const hasValue = fn.returns.some((r) => r.value && r.value.type !== 'NoneLit');
      const params = this.paramKind.get(fn)!.map((k, i) => fixList(k) ?? (fn.def.params[i].default ? kindOf(fn.def.params[i].default!) : null) ?? 'int');
      typing.functions.set(fn, {
        fn,
        paramKinds: params,
        paramVariables: fn.params.map((sym) => {
          const d = sym.defs.find((x) => x.kind === 'param');
          const w = d ? flow.webOfDef.get(d) : null;
          return w ? variableOfWeb.get(w) ?? null : null;
        }),
        returnKind: hasValue ? fixList(this.returnKind.get(fn) ?? 'int') ?? 'int' : 'none',
        calls: this.callsTo.get(fn) ?? [],
        recursive: false,
      });
    }
    // Recursion: a function on a cycle of the call graph.
    const callees = new Map<FunctionInfo, Set<FunctionInfo>>();
    for (const { call, stmt } of this.allCalls) {
      const scope = resolved.scopeOf.get(stmt);
      const caller = scope?.fn;
      const t = this.callTarget(call);
      if (!caller || t.kind !== 'function') continue;
      const set = callees.get(caller) ?? new Set();
      set.add(t.fn);
      callees.set(caller, set);
    }
    for (const fn of resolved.functions) {
      const seen = new Set<FunctionInfo>();
      const stack = [...(callees.get(fn) ?? [])];
      while (stack.length > 0) {
        const f = stack.pop()!;
        if (f === fn) {
          typing.functions.get(fn)!.recursive = true;
          break;
        }
        if (seen.has(f)) continue;
        seen.add(f);
        stack.push(...(callees.get(f) ?? []));
      }
    }

    // Storage and declarations (§4.7 D1–D3).
    placeVariables(resolved, flow, typing, consts);
    return typing;
  }

  /** How many times an append can run (§2.10 capacity): the product of constant `for … in range()` counts around it; null when not provable. */
  private appendBound(call: Call, consts: ConstEvaluator): number | null {
    const stmt = this.allCalls.find((c) => c.call === call)?.stmt;
    if (!stmt) return null;
    if (this.resolved.scopeOf.get(stmt) !== this.resolved.moduleScope) return null;
    let count = 1;
    for (let p: Stmt | null | undefined = this.resolved.parentOf.get(stmt); p; p = this.resolved.parentOf.get(p)) {
      if (p.type === 'While') return null;
      if (p.type === 'For') {
        const n = rangeCount(p, consts, this);
        if (n === null) return null;
        count *= n;
      }
    }
    return count;
  }
}

function fixList(k: IKind | null): Kind | null {
  return k === 'list<?>' ? 'list<int>' : (k as Kind | null);
}

/** The number of items a list literal or `[v] * N` makes (null when not fixed). */
function listLength(e: Expr, consts: ConstEvaluator): number | null {
  if (e.type === 'ListLit') return e.elts.length;
  if (e.type === 'ListRepeat') {
    const n = consts.value(e.count);
    return n && n.type === 'int' ? Math.max(0, n.value) * e.list.elts.length : null;
  }
  return null;
}

/** How many rounds a `for … in range(…)` with constant arguments makes (null when not constant). */
export function rangeCount(loop: For, consts: { value(e: Expr): ConstValue | null }, inf?: { callTarget(c: Call): CallTarget }): number | null {
  const it = loop.iter;
  if (it.type !== 'Call' || it.func.type !== 'Name' || it.func.id !== 'range' || it.keywords.length > 0) return null;
  if (inf) {
    const t = inf.callTarget(it);
    if (t.kind !== 'builtin') return null;
  }
  const vals = it.args.map((a) => consts.value(a));
  if (vals.some((v) => !v || v.type !== 'int')) return null;
  const n = vals.map((v) => (v as { value: number }).value);
  const [start, stop, step] = n.length === 1 ? [0, n[0], 1] : n.length === 2 ? [n[0], n[1], 1] : n.length === 3 ? n : [0, 0, 0];
  if (step === 0 || n.length === 0 || n.length > 3) return null;
  return Math.max(0, Math.ceil((stop - start) / step));
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

class ConstEvaluator {
  private readonly busy = new Set<Expr>();
  constructor(
    private readonly typing: Typing,
    private readonly flow: Flow,
  ) {}

  isConstCall(call: Call): boolean {
    const t = this.typing.callTarget(call);
    return t.kind === 'api' && t.member.id === 'micropython.const';
  }

  apiConstant(e: Expr): ApiConstant | null {
    if (e.type !== 'Name' && e.type !== 'Attribute') return null;
    if (e.type === 'Attribute') {
      const base = this.typing.denote(e.value);
      if (base.kind === 'module' && base.module) {
        const m = lookupMember(base.module, e.attr.name);
        return m && m.kind === 'constant' ? m : null;
      }
      if (base.kind === 'class') {
        const s = API_PARTS[base.cls.part].statics[e.attr.name];
        return s && s.kind === 'constant' ? s : null;
      }
      if (base.kind === 'value' && isPartKind(base.type)) {
        const s = API_PARTS[base.type].statics[e.attr.name];
        return s && s.kind === 'constant' ? s : null;
      }
      return null;
    }
    const b = this.flow.bindingOf(e);
    if (b.kind !== 'import') return null;
    const m = b.binding.member;
    return m && m.kind === 'constant' ? m : null;
  }

  value(e: Expr): ConstValue | null {
    if (this.busy.has(e)) return null;
    this.busy.add(e);
    try {
      return this.compute(e);
    } finally {
      this.busy.delete(e);
    }
  }

  private compute(e: Expr): ConstValue | null {
    switch (e.type) {
      case 'Num':
        return e.isFloat ? { type: 'float', value: e.value } : { type: 'int', value: e.value };
      case 'Str':
        return { type: 'str', value: e.value };
      case 'Bool':
        return { type: 'bool', value: e.value };
      case 'Name':
      case 'Attribute': {
        const c = this.apiConstant(e);
        if (c) return c.valueKind === 'int' ? { type: 'int', value: c.value } : { type: 'float', value: c.value };
        if (e.type === 'Name') {
          const v = this.typing.variableOf(e);
          if (v && v.constant) return v.constValue;
        }
        return null;
      }
      case 'UnaryOp': {
        const x = this.value(e.operand);
        if (!x) return null;
        if (e.op === '-' && (x.type === 'int' || x.type === 'float')) return { type: x.type, value: -x.value };
        if (e.op === '+' && (x.type === 'int' || x.type === 'float')) return x;
        if (e.op === '~' && x.type === 'int') return { type: 'int', value: ~x.value };
        if (e.op === 'not' && x.type === 'bool') return { type: 'bool', value: !x.value };
        return null;
      }
      case 'BinOp': {
        const a = this.value(e.left);
        const b = this.value(e.right);
        if (!a || !b) return null;
        return foldBinOp(e.op, a, b);
      }
      case 'TupleLit': {
        if (!e.parenthesized || e.elts.length !== 3) return null;
        const parts = e.elts.map((x) => this.value(x));
        if (parts.some((p) => !p || p.type !== 'int')) return null;
        const [r, g, b] = parts.map((p) => (p as { value: number }).value & 0xff);
        return { type: 'color', value: ((r << 16) | (g << 8) | b) >>> 0 };
      }
      case 'ListLit': {
        const items = e.elts.map((x) => this.value(x));
        return items.every((x) => x !== null) ? { type: 'list', items: items as ConstValue[] } : null;
      }
      case 'ListRepeat': {
        const list = this.value(e.list);
        const n = this.value(e.count);
        if (!list || list.type !== 'list' || !n || n.type !== 'int' || n.value > 10000) return null;
        const items: ConstValue[] = [];
        for (let k = 0; k < n.value; k++) items.push(...list.items);
        return { type: 'list', items };
      }
      case 'Call':
        if (this.isConstCall(e) && e.args.length === 1) return this.value(e.args[0]);
        return null;
      default:
        return null;
    }
  }

  /** The pin a part argument gives (§3 "Pins"); null: not fixed (a variable); -1: not a pin at all (E-pin). */
  pinOf(e: Expr): number | null {
    if (e.type === 'Call') {
      const t = this.typing.callTarget(e);
      if (t.kind === 'class' && t.cls.part === 'Pin') return e.args[0] ? this.pinOf(e.args[0]) : -1;
      return this.typing.kindOf(e) === 'int' ? null : -1;
    }
    const c = this.value(e);
    if (c) {
      if (c.type === 'int') return c.value >= 0 && c.value <= 19 ? c.value : -1;
      if (c.type === 'str') return pinOfText(c.value) ?? -1;
      return -1;
    }
    const k = this.typing.kindOf(e);
    if (k === 'Pin') {
      const v = e.type === 'Name' ? this.typing.variableOf(e) : null;
      return v?.object?.pin ?? null;
    }
    if (k === 'int' || k === 'bool') return null;
    return k === null ? null : -1;
  }
}

/** Python's arithmetic on two constants (ints exact; E-big-int is the checker's). */
export function foldBinOp(op: string, a: ConstValue, b: ConstValue): ConstValue | null {
  const num = (x: ConstValue) => x.type === 'int' || x.type === 'float' || x.type === 'bool';
  const val = (x: ConstValue) => (x.type === 'bool' ? (x.value ? 1 : 0) : (x as { value: number }).value);
  if (a.type === 'str' && b.type === 'str' && op === '+') return { type: 'str', value: a.value + b.value };
  if (op === '*' && a.type === 'str' && b.type === 'int') return { type: 'str', value: a.value.repeat(Math.max(0, Math.min(b.value, 10000))) };
  if (op === '*' && b.type === 'str' && a.type === 'int') return { type: 'str', value: b.value.repeat(Math.max(0, Math.min(a.value, 10000))) };
  if (!num(a) || !num(b)) return null;
  const x = val(a);
  const y = val(b);
  const isInt = a.type !== 'float' && b.type !== 'float';
  const f = (v: number): ConstValue => ({ type: 'float', value: Math.fround(v) });
  const i = (v: number): ConstValue => ({ type: 'int', value: v });
  switch (op) {
    case '+':
      return isInt ? i(x + y) : f(x + y);
    case '-':
      return isInt ? i(x - y) : f(x - y);
    case '*':
      return isInt ? i(x * y) : f(x * y);
    case '/':
      return y === 0 ? null : f(x / y);
    case '//':
      return y === 0 ? null : isInt ? i(Math.floor(x / y)) : f(Math.floor(x / y));
    case '%':
      if (y === 0) return null;
      return isInt ? i(x - Math.floor(x / y) * y) : f(x - Math.floor(x / y) * y);
    case '**':
      if (isInt && y >= 0) return i(Math.pow(x, y));
      return f(Math.pow(x, y));
    case '<<':
      return isInt && y >= 0 && y < 32 ? i(Number(BigInt.asIntN(32, BigInt(x) << BigInt(y)))) : null;
    case '>>':
      return isInt && y >= 0 ? i(x >> Math.min(y, 31)) : null;
    case '&':
      return isInt ? i(x & y) : null;
    case '|':
      return isInt ? i(x | y) : null;
    case '^':
      return isInt ? i(x ^ y) : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// objects
// ---------------------------------------------------------------------------

function objectInfo(cls: ApiClass, call: Call, consts: ConstEvaluator): ObjectInfo {
  const arg = (name: string, pos: number): Expr | null => call.keywords.find((k) => k.name.name === name)?.value ?? (pos >= 0 ? call.args[pos] ?? null : null);
  let pin: number | null = null;
  const fixed: Partial<Record<PartName, number>> = { Servo: 4, Buzzer: 8 };
  switch (cls.part) {
    case 'Pin':
    case 'PWM':
    case 'ADC':
    case 'NeoPixel':
    case 'DHT': {
      const p = arg(cls.part === 'Pin' ? 'id' : 'pin', 0);
      pin = p ? consts.pinOf(p) : null;
      if (pin === -1) pin = null;
      break;
    }
    case 'Servo':
    case 'Buzzer': {
      const p = arg('pin', 0);
      pin = p ? consts.pinOf(p) : fixed[cls.part]!;
      if (pin === -1) pin = null;
      break;
    }
    case 'HCSR04':
      pin = 3;
      break;
    default:
      pin = null;
  }
  let output = false;
  if (cls.part === 'Pin') {
    const mode = arg('mode', 1);
    const c = mode ? consts.apiConstant(mode) : null;
    output = !!c && c.id === 'Pin.OUT';
  }
  return { part: cls.part, cls, call, pin, output };
}

// ---------------------------------------------------------------------------
// non-negative facts (N3)
// ---------------------------------------------------------------------------

class NonNegative {
  private readonly webFact = new Map<Web, boolean>();
  constructor(
    private readonly typing: Typing,
    private readonly resolved: Resolved,
    private readonly flow: Flow,
  ) {}

  web(w: Web): boolean {
    return this.webFact.get(w) ?? false;
  }

  solve(webs: Web[], variableOfWeb: Map<Web, Variable>): void {
    const intWebs = webs.filter((w) => variableOfWeb.get(w)?.kind === 'int');
    for (const w of intWebs) this.webFact.set(w, true);
    for (let changed = true; changed; ) {
      changed = false;
      for (const w of intWebs) {
        if (!this.webFact.get(w)) continue;
        if (!w.defs.every((d) => this.defFact(d))) {
          this.webFact.set(w, false);
          changed = true;
        }
      }
    }
  }

  private defFact(d: DefSite): boolean {
    switch (d.kind) {
      case 'assign':
        return !!d.value && this.expr(d.value);
      case 'augassign': {
        const s = d.stmt;
        if (!s || s.type !== 'AugAssign' || !['+', '*', '//', '%'].includes(s.op) || s.target.type !== 'Name') return false;
        const ref = this.resolved.refs.get(s.target);
        const use = ref && ref.kind === 'symbol' ? ref.use : null;
        const web = use ? this.flow.webOfUse.get(use) : null;
        return !!web && this.web(web) && this.expr(s.value);
      }
      case 'for': {
        const loop = d.stmt;
        if (!loop || loop.type !== 'For' || loop.iter.type !== 'Call') return false;
        const t = this.typing.callTarget(loop.iter);
        if (t.kind !== 'builtin' || t.name !== 'range') return false;
        const args = loop.iter.args;
        if (args.length === 1) return true;
        const step = args.length === 3 ? this.typing.constValue(args[2]) : { type: 'int' as const, value: 1 };
        return this.expr(args[0]) && !!step && step.type === 'int' && step.value > 0;
      }
      default:
        return false;
    }
  }

  expr(e: Expr): boolean {
    const c = this.typing.constValue(e);
    if (c) return (c.type === 'int' || c.type === 'float') && c.value >= 0 ? true : c.type === 'bool';
    switch (e.type) {
      case 'Name': {
        if (this.typing.kindOf(e) !== 'int') return false;
        const b = this.flow.bindingOf(e);
        return b.kind === 'variable' && this.web(b.web);
      }
      case 'BinOp':
        return ['+', '*', '//', '%'].includes(e.op) && this.expr(e.left) && this.expr(e.right);
      case 'Call': {
        const t = this.typing.callTarget(e);
        if (t.kind === 'builtin') return t.name === 'len' || (t.name === 'abs' && this.typing.kindOf(e) === 'int');
        if (t.kind === 'api') return NON_NEGATIVE_API.has(t.member.id);
        if (t.kind === 'method') return NON_NEGATIVE_API.has(t.member.id) && (t.member.id !== 'Pin.value' || e.args.length === 0);
        if (t.kind === 'pin-call') return e.args.length === 0;
        return false;
      }
      default:
        return false;
    }
  }
}

// ---------------------------------------------------------------------------
// storage and declarations (§4.7 D1–D3)
// ---------------------------------------------------------------------------

function placeVariables(resolved: Resolved, flow: Flow, typing: Typing, consts: ConstEvaluator): void {
  const loop = resolved.main.loop;
  const isInside = (s: Stmt, ancestor: Stmt): boolean => {
    for (let p: Stmt | null | undefined = s; p; p = resolved.parentOf.get(p)) if (p === ancestor) return true;
    return false;
  };
  const stmtOfUse = (u: UseSite) => u.stmt;
  const unassignedUses = new Set(flow.unassigned.map((u) => u.use));
  for (const v of typing.variables) {
    const sym = v.sym;
    const defStmts = v.defs.map((d) => d.stmt).filter((s): s is Stmt => s !== null);
    const useStmts = v.uses.map(stmtOfUse);
    if (sym.scope !== resolved.moduleScope) {
      v.storage = 'local';
      v.declareAt = v.isParam ? v.defs.find((d) => d.kind === 'param') ?? null : declarationSite(resolved, flow, v);
      continue;
    }
    if (v.constant || v.object || sym.shared) {
      v.storage = 'global';
      v.init = globalInit(resolved, flow, typing, consts, v);
      continue;
    }
    const all = [...defStmts, ...useStmts];
    const inLoop = (s: Stmt) => !!loop && s !== loop && isInside(s, loop);
    if (loop && all.length > 0 && all.every(inLoop) && !v.uses.some((u) => unassignedUses.has(u))) {
      v.storage = 'loop';
      v.declareAt = declarationSite(resolved, flow, v);
      continue;
    }
    if (all.length > 0 && all.every((s) => !inLoop(s) && s !== loop && resolved.scopeOf.get(s) === resolved.moduleScope)) {
      v.storage = 'setup';
      v.declareAt = declarationSite(resolved, flow, v);
      continue;
    }
    v.storage = 'global';
    v.init = globalInit(resolved, flow, typing, consts, v);
  }
}

/** Program-order position of an event: its node's line and column. */
function at(d: DefSite | UseSite): number {
  const n = d.node;
  return n ? n.line * 100000 + n.column : 0;
}

/**
 * The definition a local can be declared at (D2, D3): its first definition, when that
 * definition's statement dominates every use and every other definition (a use in the same
 * statement must come after it: `x = x + 1` does not qualify), and every one of them is in the
 * definition's C++ block (the block it is directly in; for a `for` loop's variable, the loop's
 * body; the `else:` of a try goes with the try's body, as the emitter joins them). Else null.
 */
function declarationSite(resolved: Resolved, flow: Flow, v: Variable): DefSite | null {
  const first = [...v.defs].sort((a, b) => at(a) - at(b))[0];
  if (!first || !first.stmt) return null;
  const ds = first.stmt;
  const events: Array<DefSite | UseSite> = [...v.defs.filter((d) => d !== first), ...v.uses];
  for (const e of events) {
    const s = e.stmt;
    if (!s) return null;
    if (s === ds) {
      // Same statement: only other targets of it (`a = b = 0`); a read there comes before the definition.
      if (!('kind' in e)) return null;
      continue;
    }
    if (first.kind === 'for') {
      if (!insideBlock(resolved, s, (ds as For).body.stmts)) return null;
      continue;
    }
    if (!flow.dominates(ds, s)) return null;
    const block = resolved.blockOf.get(ds) ?? null;
    const parent = resolved.parentOf.get(ds) ?? null;
    const siblings = block ? block.stmts : parent === null ? (resolved.scopeOf.get(ds)?.fn?.def.body.stmts ?? resolved.body) : [];
    const extra = parent && parent.type === 'Try' && block === parent.body && parent.orelse ? parent.orelse.stmts : [];
    if (!insideBlock(resolved, s, siblings, siblings.indexOf(ds)) && !insideBlock(resolved, s, extra)) return null;
  }
  return first;
}

/** `s` is one of `stmts` (from index `from` on) or inside one of them. */
function insideBlock(resolved: Resolved, s: Stmt, stmts: readonly Stmt[], from = 0): boolean {
  for (let p: Stmt | null | undefined = s; p; p = resolved.parentOf.get(p)) {
    const k = stmts.indexOf(p);
    if (k >= from && k >= 0) return true;
  }
  return false;
}

/** D1: a global's first definition is its initialiser when it is a top-level constant expression that runs before any use. */
function globalInit(resolved: Resolved, flow: Flow, typing: Typing, consts: ConstEvaluator, v: Variable): DefSite | null {
  const first = [...v.defs].sort((a, b) => at(a) - at(b))[0];
  if (!first || first.kind !== 'assign' || !first.stmt || !first.value) return null;
  if (resolved.parentOf.get(first.stmt) !== null || !resolved.main.setup.includes(first.stmt)) return null;
  if (resolved.scopeOf.get(first.stmt) !== resolved.moduleScope) return null;
  const value = first.value;
  const constant = consts.value(value) !== null || (value.type === 'ListLit' && value.elts.length === 0) || (value.type === 'Call' && typing.callTarget(value).kind === 'class');
  if (!constant) return null;
  for (const u of v.uses) {
    if (u.scope !== resolved.moduleScope) continue;
    if (u.stmt === first.stmt || !flow.dominates(first.stmt, u.stmt)) return null;
  }
  return first;
}

