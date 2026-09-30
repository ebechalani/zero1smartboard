/**
 * The checks of ZERO1 Python (docs/PYTHON.md §2, §3, §4.6, §5): one walk over the resolved,
 * typed program that turns every rule into a diagnostic with its code, exact position (`line`,
 * `column` of the first token; `endLine`, `endColumn` of the construct) and text.
 *
 * Errors: names, imports and attributes (§5.2), kinds and values (§5.3), ZERO1 limits — the
 * parser's `Unsupported` nodes included (§5.4) — and board limits (§5.5). Warnings (§5.7) are
 * computed too; the caller keeps them only when there is no error (§4.6). Not here: syntax
 * errors (parser.ts), what only the emitter or the running board knows (W-sketch, X-sketch-*,
 * the R- runtime stops).
 */
import type { PythonDiagnostic } from './index';
import type { Attribute, Call, Expr, FString, FunctionDef, Name, Span, Stmt, Str, Subscript, Try } from './ast';
import {
  API_KIND_WORDS,
  API_MODULES,
  API_PARTS,
  BUILTINS,
  EXCEPTION_NAMES,
  MODULE_NAMES,
  PWM_PINS,
  REFUSED_BUILTINS,
  ZERO1_PINS,
  pinLabel,
  type ApiClass,
  type ApiFunction,
  type ApiParam,
  type ModuleName,
  type PartName,
} from './api';
import { isVariableDef, type Flow } from './flow';
import {
  LIST_METHODS,
  STR_METHODS,
  elementOf,
  isListKind,
  isNumeric,
  isPartKind,
  pythonType,
  type Kind,
  type Typing,
  type Variable,
} from './kinds';
import { message, type MessageCode } from './messages';
import { C_HABIT_NAMES } from './tokens';
import { isBuiltinFunction, type DefSite, type FunctionInfo, type PySymbol, type Resolved, type Scope, type UseSite } from './scope';

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------

/** Python's str methods ZERO1 Python does not have (NA-str-method; `format` is NA-str-format). */
const PYTHON_STR_METHODS = new Set([
  'capitalize', 'casefold', 'center', 'count', 'encode', 'expandtabs', 'format', 'format_map', 'index', 'isalnum', 'isalpha',
  'isascii', 'isdecimal', 'isidentifier', 'islower', 'isnumeric', 'isprintable', 'isspace', 'istitle', 'isupper', 'join',
  'ljust', 'lstrip', 'maketrans', 'partition', 'removeprefix', 'removesuffix', 'rfind', 'rindex', 'rjust', 'rpartition',
  'rsplit', 'rstrip', 'split', 'splitlines', 'swapcase', 'title', 'translate', 'zfill',
]);

/** Python's list methods ZERO1 Python does not have, with the NA-list-method hint (§2.10). */
const LIST_METHOD_HINTS: Readonly<Record<string, string>> = {
  sort: 'Write a bubble sort with a, b = b, a.',
  insert: 'Use append(), or make the list in the order you need.',
  remove: 'Find the item with a for loop, then use pop(i).',
  reverse: 'Use a for loop that counts down: for i in range(len(items) - 1, -1, -1):',
  index: 'Use a for loop with an if.',
  count: 'Use a for loop and a counter.',
  extend: 'Use append() in a for loop.',
  copy: 'Make a new list with [0] * n and copy the items in a for loop.',
};

/** The modules a missing name is looked up in for E-missing-import (ZERO1 names from zero1 first). */
const IMPORT_ORDER: readonly ModuleName[] = ['machine', 'time', 'neopixel', 'dht', 'zero1', 'math', 'random', 'micropython', 'hcsr04'];

/** How to make each part, for the messages (E-class-not-part, E-attr-int-pin). */
const MAKE_PART: Readonly<Record<PartName, string>> = {
  Pin: 'led = Pin(LED_RED, Pin.OUT)',
  PWM: 'pwm = PWM(Pin(RGB_PIN))',
  ADC: 'adc = ADC(POT_LDR)',
  I2C: 'i2c = I2C(0)',
  NeoPixel: 'np = NeoPixel(Pin(RGB_PIN), 1)',
  DHT: 'sensor = dht.DHT22(Pin(DHT_PIN))',
  HCSR04: 'sonar = HCSR04()',
  Servo: 'servo = Servo()',
  LCD: 'lcd = LCD()',
  Buzzer: 'buzzer = Buzzer()',
  SevenSegment: 'display = SevenSegment()',
};

/** The ZERO1 wiring of the parts that are fixed (E-part-pin). */
const PART_WIRING: Partial<Record<PartName, { pin: number; part: string; label: string; fix: string; standard: boolean }>> = {
  Servo: { pin: 4, part: 'servo', label: 'D4', fix: 'Servo()', standard: false },
  Buzzer: { pin: 8, part: 'buzzer', label: 'D8', fix: 'Buzzer()', standard: false },
  NeoPixel: { pin: 9, part: 'RGB LED', label: 'D9 (RGB_PIN)', fix: 'NeoPixel(Pin(RGB_PIN), 1)', standard: true },
  DHT: { pin: 5, part: 'DHT22 sensor', label: 'D5 (DHT_PIN)', fix: 'dht.DHT22(Pin(DHT_PIN))', standard: true },
};

/** Where a value may stand, for the checks of lists, parts and values that are not values. */
type Mode =
  /** A value is needed (assignment, argument, operand, …). */
  | 'value'
  /** A truth value (if, while, not, and/or in a condition). */
  | 'truth'
  /** An expression statement: the value is thrown away. */
  | 'stmt'
  /** A print() piece, an f-string field or str()'s argument: lists are shown. */
  | 'piece'
  /** A position that takes a whole list (a list parameter, len, sum, for, in, random.choice …). */
  | 'list'
  /** A position that takes a Pin (a pin argument, a Pin parameter, a list item). */
  | 'pin'
  /** The function of a call, or the value of an attribute: checked by the call / attribute. */
  | 'callee';

interface Ctx {
  scope: Scope;
  stmt: Stmt;
}

// ---------------------------------------------------------------------------
// suggestions (CPython's rule)
// ---------------------------------------------------------------------------

const MOVE_COST = 2;
const CASE_COST = 1;

function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  if (a.toLowerCase() === b.toLowerCase()) return CASE_COST;
  return MOVE_COST;
}

/** CPython's Levenshtein distance with case changes cheaper, stopped above `max`. */
function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const row: number[] = [];
  for (let j = 0; j <= b.length; j++) row.push(j * MOVE_COST);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i * MOVE_COST;
    let best = row[0];
    for (let j = 1; j <= b.length; j++) {
      const cur = Math.min(row[j] + MOVE_COST, row[j - 1] + MOVE_COST, prev + substitutionCost(a[i - 1], b[j - 1]));
      prev = row[j];
      row[j] = cur;
      best = Math.min(best, cur);
    }
    if (best > max) return max + 1;
  }
  return row[b.length];
}

/** CPython 3.12's "Did you mean" (Python/suggestions.c): the closest name within (len(a) + len(b) + 3) * 2 // 6. */
export function suggest(name: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const item of candidates) {
    if (item === name || item.length > 40) continue;
    let max = Math.floor(((name.length + item.length + 3) * MOVE_COST) / 6);
    max = Math.min(max, bestDistance - 1);
    const d = levenshtein(name, item, max);
    if (d > max) continue;
    if (best === null || d < bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// the checker
// ---------------------------------------------------------------------------

export function check(resolved: Resolved, flow: Flow, typing: Typing): PythonDiagnostic[] {
  return new Checker(resolved, flow, typing).run();
}

class Checker {
  private readonly out: PythonDiagnostic[] = [];
  private readonly seen = new Set<string>();
  private readonly lineStarts: number[] = [0];
  /** Names printed or turned into text (W-int-float, W-bool-int). */
  private readonly printed = new Set<UseSite>();
  /** Nodes whose error is already reported (no second error on the same construct). */
  private readonly reported = new Set<object>();
  private readonly docstrings = new Set<Str>();
  /** Undefined names already reported (CPython stops at the first; one error per name is enough). */
  private readonly undefinedNames = new Set<string>();

  constructor(
    private readonly resolved: Resolved,
    private readonly flow: Flow,
    private readonly typing: Typing,
  ) {
    const src = resolved.source;
    for (let k = 0; k < src.length; k++) if (src[k] === '\n') this.lineStarts.push(k + 1);
    if (resolved.module.docstring) this.docstrings.add(resolved.module.docstring);
    for (const fn of resolved.functions) if (fn.def.docstring) this.docstrings.add(fn.def.docstring);
  }

  run(): PythonDiagnostic[] {
    this.block(this.resolved.body);
    if (this.resolved.unreachable) this.warn('W-unreachable', this.resolved.unreachable.first);
    this.unassigned();
    this.conflicts();
    this.variables();
    this.functionsAfter();
    this.memory();
    return this.out;
  }

  // ---- diagnostics ------------------------------------------------------------------

  private add(code: MessageCode, severity: 'error' | 'warning', at: Span, params: Record<string, string | number | null> = {}, variant = 0): void {
    const key = `${code}@${at.line}:${at.column}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.out.push({ code, severity, line: at.line, column: at.column, endLine: at.endLine, endColumn: at.endColumn, message: message(code, params, variant) });
  }

  private error(code: MessageCode, at: Span, params: Record<string, string | number | null> = {}, variant = 0): void {
    this.reported.add(at);
    this.add(code, 'error', at, params, variant);
  }

  private warn(code: MessageCode, at: Span, params: Record<string, string | number | null> = {}, variant = 0): void {
    this.add(code, 'warning', at, params, variant);
  }

  /** The source text of a span (lines joined by a space). */
  private text(s: Span): string {
    const src = this.resolved.source;
    const from = (this.lineStarts[s.line - 1] ?? 0) + s.column - 1;
    const to = (this.lineStarts[s.endLine - 1] ?? 0) + s.endColumn - 1;
    return src.slice(from, to).replace(/\s*\n\s*/g, ' ');
  }

  // ---- statements ----------------------------------------------------------------------

  private block(stmts: readonly Stmt[]): void {
    for (const s of stmts) this.stmt(s);
  }

  private stmt(s: Stmt): void {
    const scope = this.resolved.scopeOf.get(s) ?? this.resolved.moduleScope;
    const ctx: Ctx = { scope, stmt: s };
    switch (s.type) {
      case 'Assign':
        return this.assign(s, ctx);
      case 'AugAssign':
        return this.augAssign(s, ctx);
      case 'ExprStmt':
        return this.exprStmt(s, ctx);
      case 'If':
        this.expr(s.test, 'truth', ctx);
        this.block(s.body.stmts);
        if (s.orelse) this.block(s.orelse.stmts);
        return;
      case 'While':
        this.expr(s.test, 'truth', ctx);
        if (s.orelse) this.unsupported(s.orelse);
        this.block(s.body.stmts);
        return;
      case 'For':
        return this.forStmt(s, ctx);
      case 'FunctionDef':
        return this.functionDef(s);
      case 'Return':
        return this.returnStmt(s, ctx);
      case 'Import':
        return this.importStmt(s);
      case 'ImportFrom':
        return this.importFrom(s);
      case 'Try':
        return this.tryStmt(s);
      case 'Raise':
        return this.raiseStmt(s, ctx);
      case 'Assert':
        this.expr(s.test, 'truth', ctx);
        if (s.msg) this.expr(s.msg, 'piece', ctx);
        return;
      case 'Unsupported':
        this.unsupported(s);
        return;
      default:
        return;
    }
  }

  private unsupported(u: { code: MessageCode; params: Readonly<Record<string, string>> } & Span): void {
    this.error(u.code, u, { ...u.params });
  }

  private assign(s: Stmt & { type: 'Assign' }, ctx: Ctx): void {
    const tuple = s.targets.find((t) => t.type === 'TupleTarget');
    if (tuple && tuple.type === 'TupleTarget') {
      const v = s.value;
      if (v.type !== 'TupleLit' || v.elts.length !== tuple.elts.length || s.targets.length > 1) {
        this.error('NA-unpack', tuple);
        if (v.type === 'TupleLit') v.elts.forEach((x) => this.expr(x, 'value', ctx));
        else if (v.type === 'ListLit' || v.type === 'ListRepeat') this.listCreation(v, null, ctx);
        else this.expr(v, 'list', ctx);
      } else {
        for (const x of v.elts) this.expr(x, 'value', ctx);
      }
      for (const t of tuple.elts) this.target(t, s, ctx);
      return;
    }
    // The value: a list creation, a part creation, a Pin alias or a plain value.
    const single = s.targets.length === 1 && s.targets[0].type === 'Name' ? (s.targets[0] as Name) : null;
    const v = s.value;
    if (v.type === 'ListLit' || v.type === 'ListRepeat') {
      if (!single) this.error('NA-list-value', v, { lst: 'items' });
      this.listCreation(v, single, ctx);
    } else if (v.type === 'Call' && this.typing.callTarget(v).kind === 'class') {
      this.construct(v, single, ctx);
    } else if (v.type === 'Call' && this.isPop(v)) {
      this.call(v, 'stmt', ctx, true);
    } else {
      const k = this.typing.kindOf(v);
      this.expr(v, isPartKind(k) && (k === 'Pin' || k === 'ADC') && v.type === 'Name' && single ? 'pin' : 'value', ctx);
    }
    for (const t of s.targets) this.target(t, s, ctx);
  }

  /** An assignment target (a name is written; a subscript or attribute is checked). */
  private target(t: Expr | { type: 'TupleTarget' } | Stmt, s: Stmt, ctx: Ctx): void {
    const e = t as Expr;
    switch (e.type) {
      case 'Name':
        this.nameWrite(e, ctx);
        return;
      case 'Subscript':
        this.subscriptWrite(e, s, ctx);
        return;
      case 'Attribute':
        this.expr(e.value, 'callee', ctx);
        this.error('NA-api', e, { name: `${this.text(e)} = …`, hint: 'Change a part with its methods.' });
        return;
      case 'Unsupported':
        this.unsupported(e);
        return;
      default:
        return;
    }
  }

  /** W-shadow, W-global-shadow at a name's first assignment. */
  private nameWrite(n: Name, ctx: Ctx): void {
    const ref = this.resolved.refs.get(n);
    if (!ref || ref.kind !== 'symbol' || !ref.def) return;
    const sym = ref.sym;
    const def = ref.def;
    const firstVar = sym.defs.find(isVariableDef);
    if (firstVar === def) {
      const imported = sym.defs.find((d) => d.kind === 'import' && d.import?.module);
      if (imported && imported.import) this.warn('W-shadow', n, { x: sym.name, m: imported.import.module ?? '' }, 1);
      else if (sym.builtinDef && isBuiltinFunction(sym.name)) this.warn('W-shadow', n, { x: sym.name });
    }
    if (ctx.scope.kind === 'function' && sym.scope === ctx.scope && sym.defs.find((d) => isVariableDef(d) && d.kind !== 'param') === def) {
      const global = this.resolved.moduleScope.symbols.get(sym.name);
      const hasGlobalValue = global?.defs.some((d) => isVariableDef(d) && d.scope === this.resolved.moduleScope);
      const readBefore = this.flow.unassigned.some((u) => u.use.sym === sym && u.certain);
      if (hasGlobalValue && !readBefore && !sym.param) this.warn('W-global-shadow', n, { x: sym.name, f: ctx.scope.fn!.name });
    }
  }

  private subscriptWrite(t: Subscript, s: Stmt, ctx: Ctx): void {
    this.expr(t.value, 'callee', ctx);
    const k = this.typing.kindOf(t.value);
    if (k === 'NeoPixel') {
      this.index(t.index, ctx);
      const value = s.type === 'Assign' ? s.value : s.type === 'AugAssign' ? s.value : null;
      if (value && s.type === 'Assign') {
        const vk = this.typing.kindOf(value);
        if (vk !== null && vk !== 'color') this.error('E-api-kind', value, { f: `${this.text(t.value)}[i] =`, need: API_KIND_WORDS.colour.need, fix: `${this.text(t.value)}[0] = (255, 0, 0)` });
      }
      return;
    }
    if (k === null) {
      this.expr(t.index, 'value', ctx);
      return;
    }
    if (isListKind(k)) {
      this.index(t.index, ctx);
      return;
    }
    this.expr(t.index, 'value', ctx);
    this.error('E-index-float', t, { type: pythonType(k) }, 3);
  }

  /** A list or text index: a whole number. */
  private index(i: Expr, ctx: Ctx): void {
    this.expr(i, 'value', ctx);
    const k = this.typing.kindOf(i);
    if (k === 'float') this.error('E-index-float', i);
    else if (k !== null && k !== 'int' && k !== 'bool') this.error('E-index-float', i, { type: pythonType(k) }, 1);
  }

  private augAssign(s: Stmt & { type: 'AugAssign' }, ctx: Ctx): void {
    const t = s.target;
    if (t.type === 'Unsupported') {
      this.unsupported(t);
      this.expr(s.value, 'value', ctx);
      return;
    }
    if (t.type === 'Attribute') {
      this.target(t, s, ctx);
      this.expr(s.value, 'value', ctx);
      return;
    }
    let left: Kind | null;
    if (t.type === 'Name') {
      this.nameRead(t, 'value', ctx);
      left = this.typing.readVariableOf(t)?.kind ?? null;
      this.nameWrite(t, ctx);
    } else {
      this.subscriptWrite(t, s, ctx);
      const base = this.typing.kindOf(t.value);
      left = base === 'str' ? null : elementOf(base) as Kind | null;
    }
    this.expr(s.value, 'value', ctx);
    this.binOpKinds(s.op, left, this.typing.kindOf(s.value), s, t, s.value);
  }

  private exprStmt(s: Stmt & { type: 'ExprStmt' }, ctx: Ctx): void {
    const v = s.value;
    if (v.type === 'Call') {
      this.call(v, 'stmt', ctx);
      return;
    }
    if (v.type === 'Unsupported') {
      this.unsupported(v);
      return;
    }
    this.expr(v, 'stmt', ctx);
    let hint: string | null = null;
    if (v.type === 'Compare' && v.ops.length === 1 && v.ops[0] === '==' && (v.left.type === 'Name' || v.left.type === 'Subscript')) {
      hint = `Did you mean ${this.text(v.left)} = ${this.text(v.comparators[0])}?`;
    } else if (v.type === 'Attribute' || v.type === 'Name') {
      const d = this.typing.denote(v);
      if (d.kind === 'method' || d.kind === 'function' || d.kind === 'api' || d.kind === 'str-method' || d.kind === 'list-method') hint = `Did you mean ${this.text(v)}()?`;
    }
    this.warn('W-no-effect', s, { hint });
  }

  private returnStmt(s: Stmt & { type: 'Return' }, ctx: Ctx): void {
    const v = s.value;
    if (!v || v.type === 'NoneLit') return;
    if (v.type === 'TupleLit' && !(v.parenthesized && v.elts.length === 3)) {
      this.error('NA-tuple', v);
      return;
    }
    const k = this.typing.kindOf(v);
    if (isListKind(k)) {
      this.expr(v, 'list', ctx);
      this.error('NA-list-value', s, { lst: v.type === 'Name' ? v.id : 'items' });
      return;
    }
    this.expr(v, 'value', ctx);
  }

  private forStmt(s: Stmt & { type: 'For' }, ctx: Ctx): void {
    if (s.target.type === 'Unsupported') this.unsupported(s.target);
    if (s.orelse) this.unsupported(s.orelse);
    const it = s.iter;
    let isRange = false;
    if (it.type === 'Call') {
      const t = this.typing.callTarget(it);
      if (t.kind === 'builtin' && t.name === 'range') {
        isRange = true;
        this.rangeArgs(it, ctx);
      } else if (t.kind === 'method' && t.part === 'I2C' && t.member.name === 'scan') {
        if (it.func.type === 'Attribute') this.attribute(it.func, 'callee', ctx, true);
        this.args(it, t.member.params, 'scan', ctx);
      } else {
        this.call(it, 'list', ctx);
        this.iterable(it);
      }
    } else if (it.type === 'ListLit') {
      this.listCreation(it, null, ctx);
    } else {
      this.expr(it, 'list', ctx);
      this.iterable(it);
    }
    if (isRange) {
      const info = this.flow.forLoops.get(s);
      const first = info?.assignedInBody[0];
      // `_` is Python's "not used" name: nested `for _ in …` loops are no mistake.
      if (first?.node && first.sym.name !== '_') this.warn('W-loop-var-changed', first.node, { i: first.sym.name });
    }
    this.block(s.body.stmts);
  }

  /** What a `for` goes over: a list, text (W-text-bytes), else E-not-iterable. */
  private iterable(it: Expr): void {
    const k = this.typing.kindOf(it);
    if (k === null || isListKind(k)) return;
    if (k === 'str') {
      this.textBytes(it);
      return;
    }
    if (it.type === 'Call' && this.reported.has(it)) return;
    this.error('E-not-iterable', it, { type: pythonType(k) });
  }

  private rangeArgs(call: Call, ctx: Ctx): void {
    this.expr(call.func, 'callee', ctx);
    for (const k of call.keywords) this.error('E-kwarg', k, { f: 'range', k: k.name.name });
    if (call.args.length === 0 || call.args.length > 3) {
      this.error('E-args-count', call, call.args.length === 0 ? { f: 'range', missing: '1 required positional argument', names: "'stop'" } : { f: 'range', takes: 'from 1 to 3 positional arguments', given: `${call.args.length} were` }, call.args.length === 0 ? 1 : 0);
    }
    for (const a of call.args) {
      this.expr(a, 'value', ctx);
      const k = this.typing.kindOf(a);
      if (k === 'float') this.error('E-range-float', a);
      else if (k !== null && k !== 'int' && k !== 'bool') this.error('E-api-kind', a, { f: 'range', need: API_KIND_WORDS.int.need, fix: 'range(int(x))' });
    }
    if (call.args.length === 3) {
      const step = this.typing.constValue(call.args[2]);
      if (!step || step.type !== 'int' || step.value === 0) {
        if (this.typing.kindOf(call.args[2]) !== 'float') this.error('E-range-step', call.args[2]);
      }
    }
  }

  private functionDef(def: FunctionDef): void {
    const info = this.resolved.functionOf.get(def);
    for (const u of def.unsupported) this.unsupported(u);
    for (const p of def.params) {
      if (!p.default) continue;
      const ctx: Ctx = { scope: this.resolved.moduleScope, stmt: def };
      this.expr(p.default, 'value', ctx);
      const d = p.default;
      const ok = this.typing.constValue(d) !== null || (d.type === 'TupleLit' && d.parenthesized && d.elts.length === 3 && this.typing.constValue(d) !== null) || d.type === 'Str';
      if (!ok && !this.reported.has(d)) this.error('NA-default-value', d);
    }
    if (info) {
      // W-shadow: a def named like a built-in or an imported name.
      const sym = info.defSite.sym;
      const imported = sym.defs.find((d) => d.kind === 'import' && d.import?.module);
      if (sym.defs.find((d) => d.kind === 'function') === info.defSite) {
        if (imported?.import) this.warn('W-shadow', def.name, { x: sym.name, m: imported.import.module }, 1);
        else if (sym.builtinDef && isBuiltinFunction(sym.name)) this.warn('W-shadow', def.name, { x: sym.name });
      }
    }
    this.block(def.body.stmts);
  }

  private importStmt(s: Stmt & { type: 'Import' }): void {
    for (const a of s.names) {
      if (!Object.prototype.hasOwnProperty.call(API_MODULES, a.name)) this.error('E-module', a, { m: a.name });
    }
  }

  private importFrom(s: Stmt & { type: 'ImportFrom' }): void {
    const m = s.module.name;
    if (!Object.prototype.hasOwnProperty.call(API_MODULES, m)) {
      this.error('E-module', s.module, { m });
      return;
    }
    const module = API_MODULES[m as ModuleName];
    for (const a of s.names) {
      const member = Object.prototype.hasOwnProperty.call(module.members, a.name) ? module.members[a.name] : null;
      if (!member) {
        const y = suggest(a.name, Object.values(module.members).filter((x) => x.kind !== 'refused').map((x) => x.name));
        this.error('E-import-name', a, { x: a.name, m, y });
      } else if (member.kind === 'refused') {
        this.error('NA-api', a, { name: member.display, hint: member.hint });
      }
    }
  }

  private raiseStmt(s: Stmt & { type: 'Raise' }, ctx: Ctx): void {
    const e = s.exc;
    const okName = (x: Expr) => x.type === 'Name';
    if (s.cause) {
      this.error('NA-raise', s);
      return;
    }
    if (okName(e)) return;
    if (e.type === 'Call' && okName(e.func) && e.keywords.length === 0 && e.args.length <= 1) {
      const a = e.args[0];
      if (!a) return;
      if (a.type === 'Str' || a.type === 'FString') {
        this.expr(a, 'piece', ctx);
        return;
      }
    }
    this.error('NA-raise', s);
  }

  /** §2.12: form S (a sensor reading) or form V (int() / float() of text); anything else NA-try. */
  private tryStmt(s: Try): void {
    const first = s.body.stmts[0];
    const handler = s.handler.typeName?.name ?? null;
    const form = first ? this.tryForm(first) : null;
    const handlerOk = handler === null || handler === 'Exception' || (form === 'S' && handler === 'OSError') || (form === 'V' && handler === 'ValueError');
    if (!form || !handlerOk) this.error('NA-try', { line: s.line, column: s.column, endLine: s.line, endColumn: s.column + 3 });
    this.block(s.body.stmts);
    this.block(s.handler.body.stmts);
    if (s.orelse) this.block(s.orelse.stmts);
  }

  /** The try form a first statement makes: S (DHT measure(), sonar distance), V (int() / float() of text) or null. */
  tryForm(first: Stmt): 'S' | 'V' | null {
    if (first.type === 'ExprStmt' && first.value.type === 'Call') {
      const t = this.typing.callTarget(first.value);
      if (t.kind === 'method' && t.part === 'DHT' && t.member.name === 'measure') return 'S';
      return null;
    }
    if (first.type !== 'Assign' || first.targets.length !== 1 || first.targets[0].type !== 'Name' || first.value.type !== 'Call') return null;
    const call = first.value;
    const t = this.typing.callTarget(call);
    if (t.kind === 'method' && t.part === 'HCSR04' && (t.member.name === 'distance_cm' || t.member.name === 'distance_mm')) return 'S';
    if (t.kind === 'builtin' && (t.name === 'int' || t.name === 'float') && call.args.length === 1 && call.keywords.length === 0 && this.typing.kindOf(call.args[0]) === 'str') return 'V';
    return null;
  }

  // ---- expressions ------------------------------------------------------------------------

  private expr(e: Expr, mode: Mode, ctx: Ctx): void {
    switch (e.type) {
      case 'Name':
        this.nameRead(e, mode, ctx);
        return;
      case 'Num':
        this.num(e, null);
        return;
      case 'Str':
        this.str(e);
        this.valueMode(e, mode);
        return;
      case 'FString':
        this.fstring(e, ctx);
        return;
      case 'Bool':
        return;
      case 'NoneLit':
        this.error('NA-none', e);
        return;
      case 'BinOp':
        return this.binOp(e, ctx);
      case 'UnaryOp':
        return this.unaryOp(e, ctx);
      case 'BoolOp':
        for (const v of e.values) this.expr(v, mode === 'truth' ? 'truth' : 'value', ctx);
        if (mode !== 'truth' && mode !== 'stmt' && e.values.some((v) => this.typing.kindOf(v) !== null && this.typing.kindOf(v) !== 'bool')) this.error('NA-bool-value', e);
        return;
      case 'Compare':
        return this.compare(e, ctx);
      case 'IfExp':
        this.expr(e.test, 'truth', ctx);
        this.expr(e.body, mode === 'truth' ? 'value' : mode, ctx);
        this.expr(e.orelse, mode === 'truth' ? 'value' : mode, ctx);
        return;
      case 'Call':
        this.call(e, mode, ctx);
        return;
      case 'Attribute':
        this.attribute(e, mode, ctx);
        return;
      case 'Subscript':
        return this.subscriptRead(e, mode, ctx);
      case 'ListLit':
      case 'ListRepeat':
        if (mode === 'list') {
          this.listCreation(e, null, ctx);
          return;
        }
        this.listCreation(e, null, ctx);
        this.error('NA-list-value', e, { lst: 'items' });
        return;
      case 'TupleLit':
        return this.tuple(e, mode, ctx);
      case 'Unsupported':
        this.unsupported(e);
        return;
      default:
        return;
    }
  }

  /** A value of a kind that cannot stand where `mode` needs one. */
  private valueMode(e: Expr, mode: Mode): void {
    const k = this.typing.kindOf(e);
    if (k === null || this.reported.has(e)) return;
    // A list is a condition (§2.8: `if items:` → n > 0), a whole-list argument or a print piece; nothing else.
    if (isListKind(k) && mode !== 'list' && mode !== 'piece' && mode !== 'callee' && mode !== 'stmt' && mode !== 'truth') {
      this.error('NA-list-value', e, { lst: e.type === 'Name' ? e.id : 'items' });
    } else if (isPartKind(k) && mode !== 'callee' && mode !== 'stmt' && !(mode === 'pin' && (k === 'Pin' || k === 'ADC'))) {
      this.error('NA-value', e, { what: 'parts', hint: `use their methods, for example ${MAKE_PART[k].split(' = ')[0]}.${firstMethod(k)}()` });
    } else if (k === 'color' && mode === 'piece') {
      this.error('NA-tuple', e);
    } else if (k === 'none' && mode !== 'stmt') {
      // reported by the call
    }
  }

  private nameRead(n: Name, mode: Mode, ctx: Ctx): void {
    const ref = this.resolved.refs.get(n);
    if (!ref) return;
    if (ref.kind === 'unbound') {
      this.undefinedName(n, ctx);
      return;
    }
    if (ref.kind === 'builtin') {
      this.builtinName(n, n.id, mode);
      return;
    }
    const sym = ref.sym;
    // A module name read in a function that nothing ever assigns.
    if (ref.use && ref.use.scope !== sym.scope && !sym.defs.some((d) => d.kind !== 'undefined') && !sym.builtinDef) {
      this.nameError(n, ctx);
      return;
    }
    if (mode === 'piece' && ref.use) this.printed.add(ref.use);
    const b = this.flow.bindingOf(n);
    switch (b.kind) {
      case 'variable':
        this.valueMode(n, mode);
        return;
      case 'function':
        if (mode !== 'callee' && mode !== 'stmt') this.error('NA-value', n, { what: 'functions', hint: `call it with (): ${n.id}()` });
        return;
      case 'builtin':
        this.builtinName(n, b.name, mode);
        return;
      case 'import': {
        const d = this.typing.denote(n);
        if (d.kind === 'value') {
          this.valueMode(n, mode);
          return;
        }
        if (mode === 'callee' || mode === 'stmt') return;
        if (d.kind === 'module') this.error('NA-value', n, { what: 'modules', hint: `use their names, for example ${d.module === 'time' ? 'time.sleep(1)' : `${n.id}.…`}` });
        else if (d.kind === 'class') this.error('NA-value', n, { what: 'kinds of part', hint: `make one: ${MAKE_PART[d.cls.part]}` });
        else if (d.kind === 'api') this.error('NA-value', n, { what: 'functions', hint: `call it with (): ${n.id}()` });
        return;
      }
      default:
        return;
    }
  }

  /** A Python built-in name where it is read. */
  private builtinName(n: Name, name: string, mode: Mode): void {
    if (mode === 'callee') return;
    if (Object.prototype.hasOwnProperty.call(BUILTINS, name)) {
      if (mode !== 'stmt') this.error('NA-value', n, { what: 'built-in functions', hint: `call it with (): ${name}()` });
      return;
    }
    if (EXCEPTION_NAMES.has(name)) {
      this.error('NA-value', n, { what: 'errors', hint: `raise one: raise ${name}("…")` });
      return;
    }
    this.error('NA-builtin', n, { f: name, hint: REFUSED_BUILTINS[name] ?? '' });
  }

  /** An undefined name (E-name-true, E-missing-import, E-name): once per name, where it is first used. */
  private undefinedName(n: Name, ctx: Ctx): void {
    if (this.undefinedNames.has(n.id)) return;
    this.undefinedNames.add(n.id);
    const habit = Object.prototype.hasOwnProperty.call(C_HABIT_NAMES, n.id) ? C_HABIT_NAMES[n.id] : null;
    if (habit) {
      this.error('E-name-true', n, { x: n.id, y: habit });
      return;
    }
    const fix = missingImport(n.id);
    if (fix) {
      this.error('E-missing-import', n, { x: n.id, fix });
      return;
    }
    this.nameError(n, ctx);
  }

  /** E-name with CPython's suggestion (locals, then globals, then built-ins). */
  private nameError(n: Name, ctx: Ctx): void {
    const bound = (scope: Scope) => [...scope.symbols.values()].filter((s) => s.defs.some((d) => d.kind !== 'undefined')).map((s) => s.name);
    const groups = [ctx.scope.kind === 'function' ? bound(ctx.scope) : [], bound(this.resolved.moduleScope), [...Object.keys(BUILTINS), 'True', 'False']];
    let y: string | null = null;
    for (const g of groups) {
      y = suggest(n.id, g);
      if (y) break;
    }
    this.error('E-name', n, { x: n.id, y });
  }

  private num(e: Expr & { type: 'Num' }, negated: boolean | null): void {
    if (e.isFloat) return;
    const v = negated ? -e.value : e.value;
    if (v > 2147483647 || v < -2147483648) this.error('E-big-int', e);
  }

  private str(e: Str): void {
    if (this.docstrings.has(e)) return;
    for (const p of e.parts) for (const esc of p.escapes) this.escape(esc);
  }

  private escape(esc: { kind: 'unknown' | 'N'; text: string } & Span): void {
    if (esc.kind === 'N') this.error('NA-escape-N', esc);
    else this.warn('W-escape', esc, { d: esc.text.slice(1) });
  }

  private fstring(e: FString, ctx: Ctx): void {
    for (const p of e.parts) {
      if (p.type === 'text') {
        for (const esc of p.escapes) this.escape(esc);
        continue;
      }
      if (p.unsupported) {
        this.unsupported(p.unsupported);
        continue;
      }
      this.expr(p.value, 'piece', ctx);
      if (!p.spec) continue;
      this.formatSpec(p.spec.text, p.spec, this.typing.kindOf(p.value));
    }
  }

  /** §2.11: `[align][0][width][.precision][type]`, align < or >, type d f x X b s. */
  private formatSpec(spec: string, at: Span, kind: Kind | null): void {
    const m = /^([<>])?(0)?(\d+)?(?:\.(\d+))?([dfxXbs])?$/.exec(spec);
    if (!m) {
      this.error('NA-fstring-spec', at, { spec });
      return;
    }
    const [, align, zero, , precision, type] = m;
    if (kind === null) return;
    const isText = kind === 'str';
    const isInt = kind === 'int' || kind === 'bool';
    const isNum = isInt || kind === 'float';
    if (!isText && !isNum) {
      this.error('NA-fstring-spec', at, { spec });
      return;
    }
    if (zero && align === '<') {
      this.error('NA-fstring-spec', at, { spec });
      return;
    }
    if (type === 'f' || (precision !== undefined && type === undefined && !isText)) {
      if (type === undefined) {
        this.error('NA-fstring-spec', at, { spec });
        return;
      }
      if (isText) {
        this.error('E-format-code', at, { c: 'f', type: 'str' });
        return;
      }
      if (precision !== undefined && Number(precision) > 7) this.error('NA-fstring-spec', at, { spec });
      return;
    }
    if (type === 'd' || type === 'x' || type === 'X' || type === 'b') {
      if (!isInt) this.error('E-format-code', at, { c: type, type: pythonType(kind) });
      else if (precision !== undefined) this.error('NA-fstring-spec', at, { spec });
      return;
    }
    if (type === 's' && !isText) {
      this.error('E-format-code', at, { c: 's', type: pythonType(kind) });
      return;
    }
    if (zero && isText) this.error('E-format-zero-text', at);
  }

  private binOp(e: Expr & { type: 'BinOp' }, ctx: Ctx): void {
    this.expr(e.left, 'value', ctx);
    this.expr(e.right, 'value', ctx);
    if (this.reported.has(e.left) || this.reported.has(e.right)) return;
    this.binOpKinds(e.op, this.typing.kindOf(e.left), this.typing.kindOf(e.right), e, e.left, e.right);
    if (e.op === '**' && e.left.type === 'Num' && e.right.type === 'Num' && !e.left.isFloat && !e.right.isFloat) {
      const v = this.typing.constValue(e);
      if (v && v.type === 'int' && (v.value > 2147483647 || v.value < -2147483648)) this.error('E-big-int', e);
    }
    if (e.op === '-' && this.isTicks(e.left) && this.isTicks(e.right)) this.warn('W-ticks-diff', e, { start: this.text(e.right) });
  }

  /** §2.5 kind rules of `a op b` (also `x op= b`). */
  private binOpKinds(op: string, a: Kind | null, b: Kind | null, at: Span, left: Expr, right: Expr): void {
    if (a === null || b === null) return;
    const ta = pythonType(a);
    const tb = pythonType(b);
    const num = (k: Kind) => isNumeric(k);
    if (isListKind(a) || isListKind(b)) {
      this.error('NA-list-value', at, { lst: left.type === 'Name' && isListKind(a) ? left.id : right.type === 'Name' ? right.id : 'items' });
      return;
    }
    if (isPartKind(a) || isPartKind(b) || a === 'none' || b === 'none') return; // reported where the value is
    if (op === '+' && a === 'str' && b !== 'str') {
      this.error('E-concat', at, { type: tb });
      return;
    }
    if (op === '*' && (a === 'str' || b === 'str')) {
      const other = a === 'str' ? b : a;
      if (other === 'float') {
        this.error('E-repeat-float', at);
        return;
      }
      if (other === 'int' || other === 'bool') {
        const folded = this.typing.constValue(left) && this.typing.constValue(right);
        if (!folded) this.error('NA-str-repeat', at);
        return;
      }
      this.error('E-operand', at, { op, a: ta, b: tb });
      return;
    }
    if (op === '%' && a === 'str') {
      this.error('NA-str-format', at);
      return;
    }
    if (['&', '|', '^', '<<', '>>'].includes(op) && (a === 'float' || b === 'float') && num(a) && num(b)) {
      this.error('E-bitop-float', at, { op, a: ta, b: tb });
      return;
    }
    if (op === '+' && a === 'str' && b === 'str') return;
    if (!num(a) || !num(b)) this.error('E-operand', at, { op, a: ta, b: tb });
  }

  private unaryOp(e: Expr & { type: 'UnaryOp' }, ctx: Ctx): void {
    if (e.op === 'not') {
      this.expr(e.operand, 'truth', ctx);
      return;
    }
    if (e.op === '-' && e.operand.type === 'Num') {
      this.num(e.operand, true);
      return;
    }
    this.expr(e.operand, 'value', ctx);
    const k = this.typing.kindOf(e.operand);
    if (k === null || this.reported.has(e.operand)) return;
    if (e.op === '~' && k === 'float') this.error('E-bitop-float', e, { op: '~', a: 'float' }, 1);
    else if (!isNumeric(k) && !isPartKind(k)) this.error('E-operand', e, { op: e.op, a: pythonType(k) }, 1);
  }

  private compare(e: Expr & { type: 'Compare' }, ctx: Ctx): void {
    const operands = [e.left, ...e.comparators];
    // A call in the middle of a chain would be evaluated twice in C++ (§2.5).
    for (let k = 1; k < operands.length - 1; k++) if (hasCall(operands[k])) this.error('NA-chain', operands[k]);
    e.ops.forEach((op, k) => {
      const left = operands[k];
      const right = operands[k + 1];
      if (op === 'in' || op === 'not in') {
        if (k === 0) this.expr(left, 'value', ctx);
        if (right.type === 'ListLit') {
          this.listCreation(right, null, ctx);
          if (hasCall(left)) this.error('NA-chain', left);
          return;
        }
        this.expr(right, 'list', ctx);
        const rk = this.typing.kindOf(right);
        const lk = this.typing.kindOf(left);
        if (rk === null || lk === null) return;
        if (rk === 'str') {
          if (lk !== 'str') this.error('E-compare', e, { a: pythonType(lk) }, 1);
          return;
        }
        if (!isListKind(rk)) this.error('E-not-iterable', right, { type: pythonType(rk) });
        return;
      }
      if (k === 0) this.expr(left, 'value', ctx);
      this.expr(right, 'value', ctx);
      const a = this.typing.kindOf(left);
      const b = this.typing.kindOf(right);
      if (a === null || b === null || this.reported.has(left) || this.reported.has(right)) return;
      if (isListKind(a) || isListKind(b)) {
        this.error('NA-list-value', e, { lst: left.type === 'Name' ? left.id : right.type === 'Name' ? right.id : 'items' });
        return;
      }
      if (isPartKind(a) || isPartKind(b) || a === 'none' || b === 'none') return;
      const textNumber = (a === 'str' && isNumeric(b)) || (b === 'str' && isNumeric(a));
      if (op === '==' || op === '!=') {
        if (textNumber) {
          const [t, n] = a === 'str' ? [left, right] : [right, left];
          this.warn('W-str-num-eq', e, { a: this.text(t), b: this.text(n) });
        }
        return;
      }
      if (textNumber || (a === 'color') !== (b === 'color') || (a === 'color' && b === 'color')) {
        this.error('E-compare', e, { op, a: pythonType(a), b: pythonType(b) });
        return;
      }
      if (this.isTicks(left) && this.isTicks(right)) this.warn('W-ticks-diff', e, { start: this.text(right) });
    });
  }

  private tuple(e: Expr & { type: 'TupleLit' }, mode: Mode, ctx: Ctx): void {
    if (!e.parenthesized || e.elts.length !== 3) {
      for (const x of e.elts) this.expr(x, 'value', ctx);
      this.error('NA-tuple', e);
      return;
    }
    for (const x of e.elts) {
      this.expr(x, 'value', ctx);
      const k = this.typing.kindOf(x);
      if (k === 'float') this.error('E-range-float', x);
      else if (k !== null && k !== 'int' && k !== 'bool' && !this.reported.has(x)) this.error('E-api-kind', x, { f: 'the colour (r, g, b)', need: API_KIND_WORDS.int.need, fix: '(255, 0, 0)' });
    }
    if (this.typing.constValue(e) === null && !this.typing.neoPixel && !e.elts.some((x) => this.reported.has(x))) this.error('E-colour', e);
    if (mode === 'piece') this.error('NA-tuple', e);
  }

  private subscriptRead(e: Subscript, mode: Mode, ctx: Ctx): void {
    this.expr(e.value, 'callee', ctx);
    const k = this.typing.kindOf(e.value);
    if (k === null) {
      this.expr(e.index, 'value', ctx);
      return;
    }
    if (isListKind(k) || k === 'str') {
      this.index(e.index, ctx);
      if (k === 'str') this.textBytes(e.value);
      this.valueMode(e, mode);
      return;
    }
    this.expr(e.index, 'value', ctx);
    if (k === 'NeoPixel') this.error('NA-api', e, { name: `reading ${this.text(e.value)}[i]`, hint: 'Keep the colours in variables or a list of your own.' });
    else this.error('E-index-float', e, { type: pythonType(k) }, 2);
  }

  private attribute(e: Attribute, mode: Mode, ctx: Ctx, called = false): void {
    this.expr(e.value, 'callee', ctx);
    if (this.reported.has(e.value)) return;
    const base = this.typing.denote(e.value);
    const name = e.attr.name;
    switch (base.kind) {
      case 'module': {
        if (!base.module) return;
        const m = API_MODULES[base.module].members;
        const member = Object.prototype.hasOwnProperty.call(m, name) ? m[name] : null;
        if (!member) {
          const y = suggest(name, Object.values(m).filter((x) => x.kind !== 'refused').map((x) => x.name));
          this.error('E-attr', e, { m: base.module, x: name, y });
          return;
        }
        if (member.kind === 'refused') {
          this.error('NA-api', e, { name: member.display, hint: member.hint });
          return;
        }
        if (!called && (member.kind === 'function' || member.kind === 'class') && mode !== 'callee') {
          if (mode !== 'stmt') this.error('NA-value', e, { what: member.kind === 'class' ? 'kinds of part' : 'functions', hint: member.kind === 'class' ? `make one: ${MAKE_PART[member.part]}` : `call it with (): ${this.text(e)}()` });
          return;
        }
        if (member.kind === 'constant') this.valueMode(e, mode);
        return;
      }
      case 'class': {
        const part = API_PARTS[base.cls.part];
        if (Object.prototype.hasOwnProperty.call(part.statics, name)) {
          const s = part.statics[name];
          if (s.kind === 'refused') this.error('NA-api', e, { name: s.display, hint: s.hint });
          return;
        }
        if (Object.prototype.hasOwnProperty.call(part.methods, name)) {
          const cls = base.cls.name;
          this.error('E-class-not-part', e, { cls, x: name, make: MAKE_PART[base.cls.part] });
          return;
        }
        this.error('E-attr-object', e, { type: base.cls.name, x: name, list: this.memberList(base.cls.part) });
        return;
      }
      case 'value': {
        const t = base.type;
        if (t === null) return;
        if (isPartKind(t)) {
          const part = API_PARTS[t];
          if (Object.prototype.hasOwnProperty.call(part.methods, name)) {
            const m = part.methods[name];
            if (m.kind === 'refused') {
              this.error('NA-api', e, { name: m.display, hint: m.hint });
              return;
            }
            if (!called && mode !== 'stmt') this.error('NA-value', e, { what: 'methods', hint: `call it with (): ${this.text(e)}()` });
            return;
          }
          if (Object.prototype.hasOwnProperty.call(part.statics, name)) {
            const s = part.statics[name];
            if (s.kind === 'refused') this.error('NA-api', e, { name: s.display, hint: s.hint });
            return;
          }
          this.error('E-attr-object', e, { type: this.partDisplay(e.value, t), x: name, list: this.memberList(t) });
          return;
        }
        if (t === 'str') {
          if (Object.prototype.hasOwnProperty.call(STR_METHODS, name)) {
            if (!called && mode !== 'stmt') this.error('NA-value', e, { what: 'methods', hint: `call it with (): ${this.text(e)}()` });
            return;
          }
          if (name === 'format') this.error('NA-str-format', e);
          else if (PYTHON_STR_METHODS.has(name)) this.error('NA-str-method', e, { m: name });
          else this.error('E-attr-object', e, { type: 'str', x: name, list: null });
          return;
        }
        if (isListKind(t)) {
          if (LIST_METHODS.has(name)) {
            if (!called && mode !== 'stmt') this.error('NA-value', e, { what: 'methods', hint: `call it with (): ${this.text(e)}()` });
            return;
          }
          if (Object.prototype.hasOwnProperty.call(LIST_METHOD_HINTS, name)) this.error('NA-list-method', e, { m: name, hint: LIST_METHOD_HINTS[name] });
          else this.error('E-attr-object', e, { type: 'list', x: name, list: null });
          return;
        }
        if (t === 'int') {
          const c = this.typing.apiConstant(e.value);
          if (c?.pin) {
            const pinName = this.text(e.value);
            const input = ['BUTTON_1', 'BUTTON_2', 'ECHO_PIN'].includes(c.name);
            const make = c.name === 'POT_LDR' || /^A\d$/.test(c.name) ? `adc = ADC(${pinName})` : input ? `button = Pin(${pinName}, Pin.IN)` : `led = Pin(${pinName}, Pin.OUT)`;
            this.error('E-attr-int-pin', e, { x: name, pin: pinName, part: c.pin, make });
            return;
          }
        }
        this.error('E-attr-object', e, { type: pythonType(t), x: name, list: null });
        return;
      }
      case 'function':
        this.error('E-attr-object', e, { type: 'function', x: name, list: null });
        return;
      case 'builtin':
        this.error('E-attr-object', e, { type: 'builtin_function_or_method', x: name, list: null });
        return;
      default:
        return;
    }
  }

  /** The methods of a part, for E-attr-object ("A Pin has: on, off, …"). */
  private memberList(part: PartName): string {
    return Object.values(API_PARTS[part].methods)
      .filter((m) => m.kind !== 'refused')
      .map((m) => m.name)
      .join(', ');
  }

  /** How E-attr-object names a part: the class the program made it with (DHT22, SoftI2C). */
  private partDisplay(e: Expr, part: PartName): string {
    const v = e.type === 'Name' ? this.typing.variableOf(e) : null;
    return v?.object?.cls.name ?? part;
  }

  // ---- calls -----------------------------------------------------------------------------------

  private isPop(call: Call): boolean {
    const t = this.typing.callTarget(call);
    return t.kind === 'list-method' && t.name === 'pop';
  }

  /** A call; `mode` is where its value goes (`stmt`: thrown away); `wholeValue`: the whole right side of an assignment. */
  private call(call: Call, mode: Mode, ctx: Ctx, wholeValue = false): void {
    const t = this.typing.callTarget(call);
    // The function part.
    if (call.func.type === 'Attribute') this.attribute(call.func, 'callee', ctx, true);
    else this.expr(call.func, 'callee', ctx);
    if (this.reported.has(call.func)) {
      for (const a of call.args) this.expr(a, 'value', ctx);
      for (const k of call.keywords) this.expr(k.value, 'value', ctx);
      return;
    }
    switch (t.kind) {
      case 'function':
        this.ownCall(call, t.fn, ctx);
        break;
      case 'builtin':
        this.builtinCall(call, t.name, ctx);
        break;
      case 'api':
        this.apiCall(call, t.member, ctx);
        break;
      case 'class': {
        // A Pin made in place is a pin argument (`ADC(Pin(POT_LDR))`) or a Pin list item; a part
        // without a library can be used on the spot (`Pin(LED_RED, Pin.OUT).on()`).
        const inPlace = (mode === 'pin' && t.cls.part === 'Pin') || (mode === 'callee' && !API_PARTS[t.cls.part].library);
        if (!inPlace && !this.reported.has(call)) {
          if (API_PARTS[t.cls.part].library) this.error('NA-object-here', call, { part: t.cls.name });
          else this.error('NA-value', call, { what: 'parts made on the spot', hint: `give the part a name first: ${MAKE_PART[t.cls.part]}` });
        }
        this.construct(call, null, ctx, true);
        return;
      }
      case 'method':
        this.methodCall(call, t.part, t.member, t.receiver, ctx);
        break;
      case 'pin-call':
        this.pinCall(call, t.receiver, ctx);
        break;
      case 'str-method':
        this.strMethod(call, t.name, t.receiver, ctx);
        break;
      case 'list-method':
        this.listMethod(call, t.name, t.receiver, mode, ctx, wholeValue);
        break;
      case 'refused':
        for (const a of call.args) this.expr(a, 'value', ctx);
        return;
      case 'not-callable': {
        for (const a of call.args) this.expr(a, 'value', ctx);
        const f = call.func;
        let x: string | null = null;
        let n: number | null = null;
        if (f.type === 'Name') {
          const v = this.typing.variableOf(f);
          const def = v?.defs.find((d) => d.node);
          x = f.id;
          n = def?.node?.line ?? null;
        }
        this.error('E-not-callable', call.func, { type: pythonType(t.type), x: x ?? null, n: n === null ? null : n }, 0);
        return;
      }
      default:
        for (const a of call.args) this.expr(a, 'value', ctx);
        for (const k of call.keywords) this.expr(k.value, 'value', ctx);
        return;
    }
    // A call that gives nothing where a value is needed.
    const k = this.typing.kindOf(call);
    if (k === 'none' && mode !== 'stmt' && !this.reported.has(call)) {
      if (t.kind === 'method' && t.part === 'DHT' && t.member.name === 'measure') this.error('NA-none-value', call, { sensor: this.text(t.receiver) }, 1);
      else this.error('NA-none-value', call, { f: calledName(call) });
    } else if (k !== null && k !== 'none') {
      this.valueMode(call, mode);
    }
  }

  /** E-args-count / E-kwarg of a call to `f` whose parameters are `params` (Python's rules). */
  private argCount(call: Call, f: string, params: ReadonlyArray<{ name: string; optional: boolean; keywordOnly?: boolean; positionalOnly?: boolean }>): boolean {
    const positional = params.filter((p) => !p.keywordOnly);
    const required = positional.filter((p) => !p.optional);
    const args = call.args.filter((a) => a.type !== 'Unsupported');
    if (args.length > positional.length) {
      const takes = required.length === positional.length ? `${positional.length} positional argument${positional.length === 1 ? '' : 's'}` : `from ${required.length} to ${positional.length} positional arguments`;
      this.error('E-args-count', call, { f, takes, given: `${args.length} ${args.length === 1 ? 'was' : 'were'}` });
      return false;
    }
    const given = new Set(positional.slice(0, args.length).map((p) => p.name));
    for (const k of call.keywords) {
      const p = params.find((x) => x.name === k.name.name && !x.positionalOnly);
      if (!p) {
        this.error('E-kwarg', k, { f, k: k.name.name });
        return false;
      }
      if (given.has(p.name)) {
        this.error('E-kwarg', k, { f, k: k.name.name }, 1);
        return false;
      }
      given.add(p.name);
    }
    const missing = params.filter((p) => !p.optional && !given.has(p.name));
    if (missing.length > 0) {
      const names = missing.map((p) => `'${p.name}'`);
      const list = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
      this.error('E-args-count', call, { f, missing: `${missing.length} required positional argument${missing.length === 1 ? '' : 's'}`, names: list }, 1);
      return false;
    }
    return true;
  }

  private ownCall(call: Call, fn: FunctionInfo, ctx: Ctx): void {
    const params = fn.def.params.map((p) => ({ name: p.name, optional: p.default !== null }));
    this.argCount(call, fn.name, params);
    const ft = this.typing.functions.get(fn);
    const bind = new Map<Expr, number>();
    call.args.forEach((a, i) => bind.set(a, i));
    for (const k of call.keywords) {
      const i = fn.def.params.findIndex((p) => p.name === k.name.name);
      if (i >= 0) bind.set(k.value, i);
    }
    for (const [a, i] of bind) {
      const pk = ft?.paramKinds[i] ?? null;
      const mode: Mode = isListKind(pk) ? 'list' : pk === 'Pin' ? 'pin' : 'value';
      if (a.type === 'ListLit' || a.type === 'ListRepeat') {
        this.listCreation(a, null, ctx);
        this.error('NA-list-value', a, { lst: 'items' });
        continue;
      }
      this.expr(a, mode, ctx);
    }
  }

  private builtinCall(call: Call, name: string, ctx: Ctx): void {
    const argsAll = () => {
      for (const a of call.args) this.expr(a, 'value', ctx);
      for (const k of call.keywords) this.expr(k.value, 'value', ctx);
    };
    if (!Object.prototype.hasOwnProperty.call(BUILTINS, name)) {
      for (const a of call.args) {
        if (a.type === 'ListLit' || a.type === 'ListRepeat') this.listCreation(a, null, ctx);
        else this.expr(a, 'list', ctx);
      }
      for (const k of call.keywords) this.expr(k.value, 'value', ctx);
      if (name === 'dict' || name === 'set' || name === 'frozenset') this.error('NA-dict', call);
      else if (EXCEPTION_NAMES.has(name)) this.error('NA-value', call, { what: 'errors', hint: `raise one: raise ${name}("…")` });
      else this.error('NA-builtin', call.func, { f: name, hint: REFUSED_BUILTINS[name] ?? '' });
      return;
    }
    const kinds = () => call.args.map((a) => this.typing.kindOf(a));
    const noKeywords = () => {
      for (const k of call.keywords) {
        this.expr(k.value, 'value', ctx);
        this.error('E-kwarg', k, { f: name, k: k.name.name });
      }
    };
    const count = (min: number, max: number, names: string[]) => {
      if (call.args.length < min) {
        const missing = names.slice(call.args.length, min).map((n) => `'${n}'`);
        this.error('E-args-count', call, { f: name, missing: `${missing.length} required positional argument${missing.length === 1 ? '' : 's'}`, names: missing.join(' and ') }, 1);
        return false;
      }
      if (call.args.length > max) {
        this.error('E-args-count', call, { f: name, takes: min === max ? `${max} positional argument${max === 1 ? '' : 's'}` : `from ${min} to ${max} positional arguments`, given: `${call.args.length} were` });
        return false;
      }
      return true;
    };
    const apiKind = (a: Expr, need: string, fix: string) => this.error('E-api-kind', a, { f: name, need, fix });
    switch (name) {
      case 'print': {
        for (const a of call.args) {
          if (a.type === 'ListLit' || a.type === 'ListRepeat') {
            this.listCreation(a, null, ctx);
            this.error('NA-list-value', a, { lst: 'items' });
          } else {
            this.expr(a, 'piece', ctx);
          }
        }
        for (const k of call.keywords) {
          this.expr(k.value, 'value', ctx);
          if (k.name.name === 'file') this.error('NA-print-file', k);
          else if (k.name.name === 'sep' || k.name.name === 'end') {
            if (k.value.type !== 'Str') this.error('NA-builtin-arg', k, { f: 'print' });
          } else if (k.name.name === 'flush') this.error('NA-builtin-arg', k, { f: 'print' });
          else this.error('E-kwarg', k, { f: 'print', k: k.name.name });
        }
        return;
      }
      case 'input':
        argsAll();
        noKeywords();
        if (count(0, 1, ['prompt']) && call.args[0]) {
          const k = kinds()[0];
          if (k !== null && k !== 'str') apiKind(call.args[0], API_KIND_WORDS.text.need, 'input(str(x))');
        }
        return;
      case 'len': {
        noKeywords();
        // len(np) is the pixel count (§3.5): the NeoPixel is not used as a value there.
        call.args.forEach((a) => this.expr(a, this.typing.kindOf(a) === 'NeoPixel' ? 'callee' : 'list', ctx));
        if (!count(1, 1, ['obj'])) return;
        const k = kinds()[0];
        if (k === 'str') this.textBytes(call.args[0]);
        else if (k !== null && !isListKind(k) && k !== 'NeoPixel') this.error('E-len', call, { type: pythonType(k) });
        return;
      }
      case 'range':
        argsAll();
        this.error('E-range-value', call);
        return;
      case 'int':
      case 'float':
      case 'str':
      case 'bool': {
        call.args.forEach((a) => this.expr(a, name === 'str' ? 'piece' : 'value', ctx));
        noKeywords();
        if (call.args.length !== 1) {
          this.error('NA-builtin-arg', call, { f: name });
          return;
        }
        const k = kinds()[0];
        if (k === null) return;
        if ((name === 'int' || name === 'float') && !isNumeric(k) && k !== 'str') apiKind(call.args[0], 'a number or text', `${name}(x)`);
        if (name === 'bool' && (isPartKind(k) || k === 'none')) apiKind(call.args[0], 'a value', 'bool(x)');
        return;
      }
      case 'abs':
        argsAll();
        noKeywords();
        if (count(1, 1, ['x']) && kinds()[0] !== null && !isNumeric(kinds()[0])) apiKind(call.args[0], API_KIND_WORDS.number.need, 'abs(x)');
        return;
      case 'min':
      case 'max': {
        for (const k of call.keywords) this.error('NA-builtin-arg', k, { f: name });
        if (call.args.length === 0) {
          this.error('E-args-count', call, { f: name, missing: '1 required positional argument', names: "'iterable'" }, 1);
          return;
        }
        if (call.args.length === 1) {
          const a = call.args[0];
          if (a.type === 'ListLit' || a.type === 'ListRepeat') {
            this.listCreation(a, null, ctx);
            this.error('NA-list-value', a, { lst: 'items' });
            return;
          }
          this.expr(a, 'list', ctx);
          const k = this.typing.kindOf(a);
          if (k === null) return;
          if (!isListKind(k)) this.error('E-not-iterable', a, { type: pythonType(k) });
          else if (!isNumeric(elementOf(k) as Kind)) apiKind(a, 'a list of numbers', `${name}(numbers)`);
          return;
        }
        call.args.forEach((a) => this.expr(a, 'value', ctx));
        call.args.forEach((a, i) => {
          const k = kinds()[i];
          if (k !== null && !isNumeric(k)) apiKind(a, 'numbers', `${name}(a, b)`);
        });
        return;
      }
      case 'round': {
        argsAll();
        noKeywords();
        if (!count(1, 2, ['number', 'ndigits'])) return;
        const k = kinds()[0];
        if (k !== null && !isNumeric(k)) apiKind(call.args[0], API_KIND_WORDS.number.need, 'round(x)');
        if (call.args[1]) {
          const n = this.typing.constValue(call.args[1]);
          if (!n || n.type !== 'int' || n.value < 0 || n.value > 7) this.error('NA-builtin-arg', call, { f: 'round' });
        }
        return;
      }
      case 'pow': {
        argsAll();
        noKeywords();
        if (call.args.length === 3) {
          this.error('NA-builtin-arg', call, { f: 'pow' });
          return;
        }
        if (!count(2, 2, ['base', 'exp'])) return;
        const [a, b] = kinds();
        if (a !== null && b !== null && (!isNumeric(a) || !isNumeric(b))) this.error('E-operand', call, { op: '** or pow()', a: pythonType(a), b: pythonType(b) });
        return;
      }
      case 'chr': {
        argsAll();
        noKeywords();
        if (!count(1, 1, ['i'])) return;
        const k = kinds()[0];
        if (k === 'float') this.error('E-range-float', call.args[0]);
        else if (k !== null && k !== 'int' && k !== 'bool') apiKind(call.args[0], API_KIND_WORDS.int.need, 'chr(65)');
        return;
      }
      case 'ord': {
        argsAll();
        noKeywords();
        if (!count(1, 1, ['c'])) return;
        const k = kinds()[0];
        if (k !== null && k !== 'str') apiKind(call.args[0], API_KIND_WORDS.text.need, 'ord("A")');
        else if (k === 'str') this.textBytes(call.args[0]);
        return;
      }
      case 'sum': {
        noKeywords();
        if (call.args.length !== 1) {
          argsAll();
          this.error('NA-builtin-arg', call, { f: 'sum' });
          return;
        }
        const a = call.args[0];
        if (a.type === 'ListLit' || a.type === 'ListRepeat') {
          this.listCreation(a, null, ctx);
          this.error('NA-list-value', a, { lst: 'items' });
          return;
        }
        this.expr(a, 'list', ctx);
        const k = this.typing.kindOf(a);
        if (k === null) return;
        if (!isListKind(k)) this.error('NA-builtin-arg', call, { f: 'sum' });
        else if (!isNumeric(elementOf(k) as Kind)) apiKind(a, 'a list of numbers', 'sum(numbers)');
        return;
      }
      default:
        argsAll();
        return;
    }
  }

  /** Arguments of an API function or method against its parameters (count, keywords, kinds, refused ones). */
  private args(call: Call, params: readonly ApiParam[], f: string, ctx: Ctx): Map<string, Expr> {
    const bound = new Map<string, Expr>();
    const ok = this.argCount(
      call,
      f,
      params.map((p) => ({ name: p.name, optional: !!p.optional, keywordOnly: p.keywordOnly, positionalOnly: p.positionalOnly })),
    );
    const positional = params.filter((p) => !p.keywordOnly);
    call.args.forEach((a, i) => positional[i] && bound.set(positional[i].name, a));
    for (const k of call.keywords) bound.set(k.name.name, k.value);
    for (const [name, a] of bound) {
      const p = params.find((x) => x.name === name);
      const kind = p?.kind;
      if (a.type === 'ListLit' || a.type === 'ListRepeat') {
        this.listCreation(a, null, ctx);
        if (kind !== 'list' && kind !== 'intList') this.error('NA-list-value', a, { lst: 'items' });
      } else {
        this.expr(a, kind === 'list' || kind === 'intList' ? 'list' : kind === 'pin' ? 'pin' : 'value', ctx);
      }
      if (!p || !ok) continue;
      if (p.refused) {
        this.error('NA-api', a, { name: `${f}(${name}=…)`, hint: p.refused });
        continue;
      }
      this.argKind(a, p, call, f);
    }
    for (const a of call.args.slice(positional.length)) if (!bound.has('')) this.expr(a, 'value', ctx);
    return bound;
  }

  /** E-api-kind (and E-pin, E-sleep-ms-float) for one argument. */
  private argKind(a: Expr, p: ApiParam, call: Call, f: string): void {
    if (this.reported.has(a)) return;
    const k = this.typing.kindOf(a);
    const shown = this.text(call.func);
    const fail = () => {
      const words = API_KIND_WORDS[p.kind];
      this.error('E-api-kind', a, { f, need: words.need, fix: words.fix.replace('{f}', shown) });
    };
    switch (p.kind) {
      case 'pin': {
        const pin = this.typing.pinOf(a);
        if (pin === -1) {
          const c = this.typing.constValue(a);
          this.error('E-pin', a, { pin: c && (c.type === 'int' || c.type === 'str') ? String(c.value) : this.text(a) });
        }
        return;
      }
      case 'int':
        if (k === 'float') {
          if (f === 'sleep_ms') this.error('E-sleep-ms-float', a);
          else fail();
        } else if (k !== null && k !== 'int' && k !== 'bool') fail();
        return;
      case 'number':
      case 'truth':
        if (k !== null && !isNumeric(k)) fail();
        return;
      case 'text':
        if (k !== null && k !== 'str') fail();
        return;
      case 'colour':
        if (k !== null && k !== 'color') fail();
        return;
      case 'list':
        if (k !== null && !isListKind(k)) fail();
        return;
      case 'intList':
        if (k !== null && k !== 'list<int>' && k !== 'list<bool>') fail();
        return;
      case 'pinMode':
      case 'pull': {
        const c = this.typing.apiConstant(a);
        if (!c || c.tag !== p.kind) fail();
        return;
      }
      default:
        return;
    }
  }

  private apiCall(call: Call, member: ApiFunction, ctx: Ctx): void {
    const bound = this.args(call, member.params, member.name, ctx);
    switch (member.id) {
      case 'time.sleep': {
        const s = bound.get('seconds');
        const v = s ? this.typing.constValue(s) : null;
        if (v && (v.type === 'int' || v.type === 'float') && v.value >= 60) {
          const n = this.text(s!);
          this.warn('W-sleep-long', s!, { n, time: longTime(v.value) });
        }
        return;
      }
      case 'machine.time_pulse_us':
        return;
      default:
        return;
    }
  }

  private methodCall(call: Call, part: PartName, member: ApiFunction, receiver: Expr, ctx: Ctx): void {
    const reads = member.read !== undefined && call.args.length === 0 && call.keywords.length === 0;
    if (reads && typeof member.read === 'object') {
      this.error('NA-api', call, { name: `${part}.${member.name}()`, hint: member.read.refused });
      return;
    }
    const bound = this.args(call, member.params, member.name, ctx);
    const obj = receiver.type === 'Name' ? this.typing.variableOf(receiver)?.object ?? null : null;
    switch (member.id) {
      case 'Pin.on':
      case 'Pin.off':
      case 'Pin.toggle':
      case 'Pin.value':
        if (member.id === 'Pin.value' && reads) return;
        if (obj && !obj.output) this.warn('W-pin-no-out', call, { x: this.text(receiver), pin: this.text(obj.call.args[0] ?? receiver) });
        return;
      case 'PWM.freq': {
        const f = bound.get('f');
        const v = f ? this.typing.constValue(f) : null;
        if (v && v.type === 'int' && v.value === 50) this.warn('W-pwm-servo', call);
        else this.warn('W-pwm-freq', call);
        return;
      }
      case 'I2C.scan':
        this.error('E-scan', call);
        return;
      case 'LCD.putstr':
      case 'LCD.putchar': {
        const a = call.args[0];
        if (a) this.lcdChars(a);
        return;
      }
      default:
        return;
    }
  }

  private pinCall(call: Call, receiver: Expr, ctx: Ctx): void {
    this.args(call, API_PARTS.Pin.methods.value.kind === 'refused' ? [] : (API_PARTS.Pin.methods.value as ApiFunction).params, this.text(receiver), ctx);
    if (call.args.length === 1) {
      const obj = receiver.type === 'Name' ? this.typing.variableOf(receiver)?.object ?? null : null;
      if (obj && !obj.output) this.warn('W-pin-no-out', call, { x: this.text(receiver), pin: this.text(obj.call.args[0] ?? receiver) });
    }
  }

  private strMethod(call: Call, name: string, receiver: Expr, ctx: Ctx): void {
    for (const a of call.args) this.expr(a, 'value', ctx);
    for (const k of call.keywords) this.expr(k.value, 'value', ctx);
    if (!Object.prototype.hasOwnProperty.call(STR_METHODS, name)) return; // reported by the attribute
    const arity: Record<string, number> = { upper: 0, lower: 0, strip: 0, isdigit: 0, startswith: 1, endswith: 1, find: 1, replace: 2 };
    if (call.args.length !== arity[name] || call.keywords.length > 0) {
      if (call.args.length < arity[name]) {
        const names = name === 'replace' ? ["'old'", "'new'"] : ["'prefix'"];
        this.error('E-args-count', call, { f: name, missing: `${arity[name] - call.args.length} required positional argument${arity[name] - call.args.length === 1 ? '' : 's'}`, names: names.slice(call.args.length).join(' and ') }, 1);
      } else {
        this.error('NA-builtin-arg', call, { f: name });
      }
      return;
    }
    call.args.forEach((a) => {
      const k = this.typing.kindOf(a);
      if (k !== null && k !== 'str') this.error('E-api-kind', a, { f: name, need: API_KIND_WORDS.text.need, fix: `${this.text(receiver)}.${name}(str(x))` });
    });
  }

  private listMethod(call: Call, name: string, receiver: Expr, mode: Mode, ctx: Ctx, wholeValue: boolean): void {
    if (!LIST_METHODS.has(name)) {
      for (const a of call.args) this.expr(a, 'value', ctx);
      return; // reported by the attribute
    }
    const v = receiver.type === 'Name' ? this.typing.variableOf(receiver) : null;
    if ((name === 'append' || name === 'pop' || name === 'clear') && v?.isParam) this.error('NA-list-param-grow', call);
    if (name === 'append') {
      this.argCount(call, 'append', [{ name: 'object', optional: false }]);
      for (const a of call.args) {
        if (a.type === 'ListLit' || a.type === 'ListRepeat') {
          this.listCreation(a, null, ctx);
          this.error('NA-nested-list', a);
        } else this.expr(a, 'pin', ctx);
        const k = this.typing.kindOf(a);
        if (isListKind(k) && a.type !== 'ListLit' && a.type !== 'ListRepeat') this.error('NA-nested-list', a);
      }
      return;
    }
    if (name === 'pop') {
      this.argCount(call, 'pop', [{ name: 'index', optional: true }]);
      for (const a of call.args) this.index(a, ctx);
      if (mode !== 'stmt' && !wholeValue) this.error('NA-pop-here', call, { lst: this.text(receiver) });
      return;
    }
    this.argCount(call, 'clear', []);
  }

  // ---- lists and parts -----------------------------------------------------------------------

  /** A list literal or `[v] * N` (§2.10). */
  private listCreation(e: Expr, target: Name | null, ctx: Ctx): void {
    if (e.type === 'ListRepeat') {
      this.listCreation(e.list, target, ctx);
      this.expr(e.count, 'value', ctx);
      const k = this.typing.kindOf(e.count);
      if (k === 'float') this.error('E-repeat-float', e);
      else if (k !== null && k !== 'int' && k !== 'bool') this.error('E-operand', e, { op: '*', a: 'list', b: pythonType(k) });
      else if (k !== null) {
        const n = this.typing.constValue(e.count);
        if (!n || n.type !== 'int') this.error('NA-list-size', e);
      }
      return;
    }
    if (e.type !== 'ListLit') return;
    let first: { kind: Kind; line: number } | null = null;
    for (const x of e.elts) {
      if (x.type === 'ListLit' || x.type === 'ListRepeat') {
        this.listCreation(x, null, ctx);
        this.error('NA-nested-list', x);
        continue;
      }
      this.expr(x, 'pin', ctx);
      const k = this.typing.kindOf(x);
      if (k === null || this.reported.has(x)) continue;
      if (isListKind(k)) {
        this.error('NA-nested-list', x);
        continue;
      }
      if (isPartKind(k) && k !== 'Pin') {
        this.error('NA-value', x, { what: 'parts', hint: 'put Pins in a list, or give each part its own name' });
        continue;
      }
      if (!first) {
        first = { kind: k, line: x.line };
        continue;
      }
      const textNumber = (first.kind === 'str') !== (k === 'str') && (isNumeric(first.kind) || isNumeric(k));
      if (textNumber) {
        const [num, text] = first.kind === 'str' ? [{ line: x.line }, first] : [first, { line: x.line }];
        this.error('E-list-kinds', x, { x: target?.id ?? 'the list', a: num.line, b: text.line });
        return;
      }
      if (first.kind !== k && !(isNumeric(first.kind) && isNumeric(k))) {
        this.error('E-list-kinds', x, { x: target?.id ?? 'the list', a: first.line, b: x.line, ka: kindWords(first.kind), kb: kindWords(k) }, 1);
        return;
      }
    }
  }

  /** A part made with its class (§2.9 Objects, §3): where it may be made, its pins. */
  private construct(call: Call, target: Name | null, ctx: Ctx, argsOnly = false): void {
    const t = this.typing.callTarget(call);
    if (t.kind !== 'class') return;
    const cls = t.cls;
    this.expr(call.func, 'callee', ctx);
    const bound = this.args(call, cls.params, cls.name, ctx);
    if (argsOnly) return;
    const lib = API_PARTS[cls.part].library;
    const topLevel = ctx.scope === this.resolved.moduleScope && this.resolved.parentOf.get(ctx.stmt) === null && this.resolved.main.setup.includes(ctx.stmt);
    if (lib && (!topLevel || !target)) this.error('NA-object-here', call, { part: cls.name });
    this.pins(call, cls, bound);
  }

  /** E-adc-pin, E-i2c-pins, E-part-pin, W-pwm-*, W-pull-down, W-echo-timeout. */
  private pins(call: Call, cls: ApiClass, bound: Map<string, Expr>): void {
    const pinArg = bound.get(cls.part === 'Pin' ? 'id' : 'pin');
    const pin = pinArg ? this.typing.pinOf(pinArg) : null;
    switch (cls.part) {
      case 'Pin': {
        const pull = bound.get('pull');
        const c = pull ? this.typing.apiConstant(pull) : null;
        if (c?.id === 'Pin.PULL_DOWN') this.warn('W-pull-down', pull!);
        return;
      }
      case 'ADC':
        if (pin !== null && pin !== -1 && (pin < 14 || pin > 19)) this.error('E-adc-pin', pinArg!);
        return;
      case 'PWM': {
        const freq = bound.get('freq');
        const fv = freq ? this.typing.constValue(freq) : null;
        if (pin === 8) this.warn('W-pwm-buzzer', call);
        else if (pin === 4 || (fv && fv.type === 'int' && fv.value === 50)) this.warn('W-pwm-servo', call);
        else if (pin !== null && pin !== -1 && !PWM_PINS.has(pin)) {
          const part = Object.values(ZERO1_PINS).find((x) => x.value === pin)?.part;
          if (part) this.warn('W-pwm-pin', call, { n: pin, label: pinLabel(pin), part });
          else this.warn('W-pwm-pin', call, { n: pin, label: pinLabel(pin) }, 1);
        } else if (freq) this.warn('W-pwm-freq', freq);
        return;
      }
      case 'I2C': {
        const scl = bound.get('scl');
        const sda = bound.get('sda');
        const id = bound.get('id');
        const bad = (e: Expr | undefined, want: number) => {
          if (!e) return false;
          const p = this.typing.pinOf(e);
          return p !== null && p !== want;
        };
        const idv = id ? this.typing.constValue(id) : null;
        if (bad(scl, 19) || bad(sda, 18) || (idv && idv.type === 'int' && idv.value !== 0)) this.error('E-i2c-pins', call);
        return;
      }
      case 'NeoPixel': {
        const n = bound.get('n');
        const nv = n ? this.typing.constValue(n) : null;
        if (n && (!nv || nv.type !== 'int')) this.error('NA-builtin-arg', n, { f: 'NeoPixel' });
        break;
      }
      case 'HCSR04': {
        const trig = bound.get('trigger_pin');
        const echo = bound.get('echo_pin');
        const tp = trig ? this.typing.pinOf(trig) : null;
        const ep = echo ? this.typing.pinOf(echo) : null;
        if ((tp !== null && tp !== 3) || (ep !== null && ep !== 2)) this.error('E-part-pin', call, { part: 'ultrasonic sensor', pin: 'D3 (TRIG_PIN) and D2 (ECHO_PIN)', fix: 'HCSR04()' });
        const to = bound.get('echo_timeout_us');
        const tv = to ? this.typing.constValue(to) : null;
        if (to && !(tv && tv.type === 'int' && tv.value === 30000)) this.warn('W-echo-timeout', to);
        return;
      }
      default:
        break;
    }
    const wiring = PART_WIRING[cls.part];
    if (wiring && pinArg && pin !== null && pin !== -1 && pin !== wiring.pin) {
      this.error('E-part-pin', pinArg, { part: wiring.part, pin: wiring.label, fix: wiring.fix }, wiring.standard ? 1 : 0);
    }
  }

  // ---- text on the board -------------------------------------------------------------------

  /** W-text-bytes: len(), [i], for … in and ord() on text that can hold non-ASCII characters. */
  private textBytes(e: Expr): void {
    const c = this.nonAscii(e, new Set());
    if (c) this.warn('W-text-bytes', e, { c, n: new TextEncoder().encode(c).length });
  }

  /** The first non-ASCII character a text expression can hold (from its literals), or null. */
  private nonAscii(e: Expr, seen: Set<object>): string | null {
    if (seen.has(e)) return null;
    seen.add(e);
    const first = (s: string) => [...s].find((ch) => ch.codePointAt(0)! > 0x7f) ?? null;
    switch (e.type) {
      case 'Str':
        return first(e.value);
      case 'FString':
        for (const p of e.parts) {
          const c = p.type === 'text' ? first(p.value) : this.nonAscii(p.value, seen);
          if (c) return c;
        }
        return null;
      case 'BinOp':
        return this.nonAscii(e.left, seen) ?? this.nonAscii(e.right, seen);
      case 'IfExp':
        return this.nonAscii(e.body, seen) ?? this.nonAscii(e.orelse, seen);
      case 'Call':
        if (e.func.type === 'Attribute' && this.typing.kindOf(e.func.value) === 'str') return this.nonAscii(e.func.value, seen) ?? e.args.map((a) => this.nonAscii(a, seen)).find((x) => x) ?? null;
        return null;
      case 'Name': {
        const v = this.typing.readVariableOf(e);
        if (!v) return null;
        for (const d of v.defs) {
          if (d.kind === 'assign' && d.value) {
            const c = this.nonAscii(d.value, seen);
            if (c) return c;
          }
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** W-lcd-char: characters the LCD cannot show (ASCII and ° work). */
  private lcdChars(e: Expr): void {
    const bad = (s: string) => [...s].find((ch) => (ch.codePointAt(0)! > 0x7e || ch.codePointAt(0)! < 0x20) && ch !== '°') ?? null;
    let c: string | null = null;
    if (e.type === 'Str') c = bad(e.value);
    else if (e.type === 'FString') c = e.parts.map((p) => (p.type === 'text' ? bad(p.value) : null)).find((x) => x) ?? null;
    else if (e.type === 'Name') {
      const v = this.typing.constValue(e);
      if (v && v.type === 'str') c = bad(v.value);
    }
    if (c) this.warn('W-lcd-char', e, { c });
  }

  /** A tick value (`time.ticks_ms()`, `ticks_us()`, `ticks_add()`, or a variable that only holds them), for W-ticks-diff. */
  private isTicks(e: Expr, seen = new Set<object>()): boolean {
    if (e.type === 'Call') {
      const t = this.typing.callTarget(e);
      return t.kind === 'api' && (t.member.id === 'time.ticks_ms' || t.member.id === 'time.ticks_us' || t.member.id === 'time.ticks_add');
    }
    if (e.type !== 'Name') return false;
    const v = this.typing.readVariableOf(e);
    if (!v || seen.has(v)) return false;
    seen.add(v);
    return v.defs.length > 0 && v.defs.every((d) => d.kind === 'assign' && d.value !== null && this.isTicks(d.value, seen));
  }

  // ---- after the walk ------------------------------------------------------------------------

  /** Definite assignment (§2.9): E-name / E-name-later / E-unbound-local, W-maybe-unassigned. */
  private unassigned(): void {
    for (const u of this.flow.unassigned) {
      const n = u.use.node;
      if (this.reported.has(n)) continue;
      const sym = u.use.sym;
      if (!u.certain) {
        const def = u.seen;
        const where = def?.stmt ? this.whereOf(def, u.use) : null;
        this.warn('W-maybe-unassigned', n, { x: sym.name, where: where?.word ?? 'if', n: where?.line ?? def?.node?.line ?? n.line });
        continue;
      }
      if (sym.scope.kind === 'function') {
        const global = this.resolved.moduleScope.symbols.get(sym.name);
        const hasGlobal = !!global && global.defs.some((d) => d.kind !== 'undefined');
        this.error('E-unbound-local', n, { x: sym.name, f: hasGlobal ? sym.scope.fn!.name : null });
        continue;
      }
      const later = sym.defs.filter((d) => d.kind !== 'undefined' && d.kind !== 'builtin' && d.node && d.node.line > n.line).sort((a, b) => a.node!.line - b.node!.line)[0];
      if (later) this.error('E-name-later', n, { x: sym.name, n: later.node!.line });
      else this.nameError(n, { scope: sym.scope, stmt: u.use.stmt });
    }
  }

  /** "inside the if on line n": the compound statement around a definition that the use is not in. */
  private whereOf(def: DefSite, use: UseSite): { word: string; line: number } | null {
    const chain = (s: Stmt) => {
      const out: Stmt[] = [];
      for (let p: Stmt | null | undefined = s; p; p = this.resolved.parentOf.get(p)) out.push(p);
      return out;
    };
    const defChain = chain(def.stmt!);
    const useChain = new Set(chain(use.stmt));
    // The outermost compound statement around the definition that does not contain the use.
    let pick: Stmt | null = null;
    for (const s of defChain) {
      if (useChain.has(s)) break;
      if (['If', 'For', 'While', 'Try'].includes(s.type)) pick = s;
    }
    const s = pick;
    if (!s) return null;
    const word = s.type === 'If' ? 'if' : s.type === 'For' ? 'for loop' : s.type === 'While' ? 'while loop' : 'try';
    return { word, line: s.line };
  }

  private conflicts(): void {
    for (const c of this.typing.conflicts) {
      switch (c.code) {
        case 'E-retype': {
          const [ka, kb] = c.kinds;
          if (isPartKind(ka) || isPartKind(kb)) continue; // NA-object-reassign
          if (isListKind(ka) || isListKind(kb)) continue; // NA-list-value (a list is made once)
          const at = c.at?.node ?? c.b.node ?? c.a.node!;
          const textNumber = (ka === 'str' && isNumeric(kb)) || (kb === 'str' && isNumeric(ka));
          if (textNumber) {
            const [text, num] = ka === 'str' ? [c.a, c.b] : [c.b, c.a];
            this.error('E-retype', at, { x: c.sym.name, a: text.node?.line ?? 0, b: num.node?.line ?? 0, c: at.line });
          } else {
            this.error('E-retype', at, { x: c.sym.name, a: kindWords(ka), b: kindWords(kb), la: c.a.node?.line ?? 0, lb: c.b.node?.line ?? 0, c: at.line }, 1);
          }
          break;
        }
        case 'E-retype-ifexp':
          this.error('E-retype', c.expr, {}, 2);
          break;
        case 'E-param-kinds': {
          const textNumber = (c.a.kind === 'str' || c.b.kind === 'str') && (isNumeric(c.a.kind) || isNumeric(c.b.kind));
          const call = this.typing.functions.get(c.fn)?.calls.find((x) => x.line === c.b.line) ?? c.fn.def.name;
          if (textNumber) this.error('E-param-kinds', call, { f: c.fn.name, a: c.a.line, b: c.b.line });
          else this.error('E-param-kinds', call, { f: c.fn.name, ka: kindWords(c.a.kind), kb: kindWords(c.b.kind), a: c.a.line, b: c.b.line }, 1);
          break;
        }
        case 'E-return-kinds': {
          const ret = c.fn.returns.find((r) => r.line === c.b.line) ?? c.fn.def.name;
          const textNumber = (c.a.kind === 'str' || c.b.kind === 'str') && (isNumeric(c.a.kind) || isNumeric(c.b.kind));
          if (textNumber) this.error('E-return-kinds', ret, { f: c.fn.name, a: c.a.line, b: c.b.line });
          else this.error('E-return-kinds', ret, { f: c.fn.name, ka: kindWords(c.a.kind), kb: kindWords(c.b.kind), a: c.a.line, b: c.b.line }, 1);
          break;
        }
        case 'E-list-kinds': {
          const textNumber = (c.a.kind === 'str' || c.b.kind === 'str') && (isNumeric(c.a.kind) || isNumeric(c.b.kind));
          if (textNumber) this.error('E-list-kinds', c.at, { x: c.sym.name, a: c.a.line, b: c.b.line });
          else this.error('E-list-kinds', c.at, { x: c.sym.name, ka: kindWords(c.a.kind), kb: kindWords(c.b.kind), a: c.a.line, b: c.b.line }, 1);
          break;
        }
        default:
          break;
      }
    }
  }

  /** Per variable: lists made once, parts never re-bound, widening warnings, list capacity. */
  private variables(): void {
    const bySym = new Map<PySymbol, Variable[]>();
    for (const v of this.typing.variables) {
      const list = bySym.get(v.sym) ?? [];
      list.push(v);
      bySym.set(v.sym, list);
    }
    for (const [sym, vars] of bySym) {
      // NA-object-reassign: a name that holds a part gets another value in the same scope.
      const objectVar = vars.find((v) => isPartKind(v.kind) && v.object);
      if (objectVar) {
        const first = objectVar.defs[0];
        for (const d of sym.defs) {
          if (d === first || !isVariableDef(d) || d.scope !== first.scope || d.kind === 'param' || !d.node) continue;
          this.error('NA-object-reassign', d.node, { x: sym.name, part: objectVar.object!.cls.name === 'DHT22' || objectVar.object!.cls.name === 'DHT11' ? objectVar.object!.cls.name : objectVar.kind });
        }
      }
      for (const v of vars) {
        // A list is made once (a second whole-list value is NA-list-value).
        if (v.list) {
          const made = v.defs.filter((d) => d.kind === 'assign');
          for (const d of made.slice(1)) if (d.node) this.error('NA-list-value', d.node, { lst: sym.name });
          const alias = made[0];
          if (alias?.value && alias.value.type !== 'ListLit' && alias.value.type !== 'ListRepeat' && alias.node && !this.reported.has(alias.value)) {
            this.error('NA-list-value', alias.value, { lst: alias.value.type === 'Name' ? alias.value.id : sym.name });
          }
          if (v.list.capacityGuessed && alias?.node) this.warn('W-list-capacity', alias.node, { n: v.list.capacity, x: sym.name });
        }
        // Widening warnings, only when the value is shown (§2.9).
        const shown = v.uses.find((u) => this.printed.has(u));
        if (!shown) continue;
        const kinds = new Map<Kind, DefSite>();
        for (const d of v.defs) {
          const k = this.typing.defKind.get(d);
          if (k && !kinds.has(k)) kinds.set(k, d);
        }
        if (v.kind === 'float' && kinds.has('int') && kinds.has('float')) {
          this.warn('W-int-float', shown.node, { x: sym.name, a: kinds.get('int')!.node?.line ?? 0, b: kinds.get('float')!.node?.line ?? 0 });
        } else if (v.kind === 'int' && kinds.has('int') && kinds.has('bool')) {
          this.warn('W-bool-int', shown.node, { x: sym.name, a: kinds.get('int')!.node?.line ?? 0, b: kinds.get('bool')!.node?.line ?? 0 });
        }
      }
    }
  }

  private functionsAfter(): void {
    for (const fn of this.resolved.functions) {
      const ft = this.typing.functions.get(fn);
      if (!ft) continue;
      const used = ft.calls.length > 0 || fn.defSite.sym.uses.length > 0;
      if (!used) this.warn('W-unused-function', fn.def.name, { f: fn.name });
      if (ft.recursive) this.warn('W-recursion', fn.def.name, { f: fn.name });
      if (ft.returnKind !== 'none') {
        const cfg = this.flow.cfgs.get(fn.scope);
        const bare = fn.returns.find((r) => (!r.value || r.value.type === 'NoneLit') && cfg && cfg.reachable.has(cfg.nodeOf.get(r) ?? -1));
        if (cfg?.fallsOff || bare) this.warn('W-missing-return', fn.def.name, { f: fn.name });
      }
    }
  }

  /** W-memory (§4.11): globals, lists with their capacity, String 6 bytes + text, library objects. */
  private memory(): void {
    const LIB: Partial<Record<PartName, number>> = { Servo: 3, LCD: 12, DHT: 13, NeoPixel: 22 };
    let bytes = 0;
    for (const v of this.typing.variables) {
      if (v.object) {
        const extra = v.object.part === 'NeoPixel' ? 3 * Number((this.typing.constValue(v.object.call.args[1] ?? v.object.call) as { value?: number } | null)?.value ?? 1) : 0;
        bytes += (LIB[v.object.part] ?? 0) + extra;
        continue;
      }
      if (v.constant && !v.list) continue;
      if (v.list) {
        const el = v.list.elem;
        const size = el === 'str' ? 6 : el === 'bool' ? 1 : el === 'Pin' ? 2 : 4;
        bytes += size * (v.list.growable ? v.list.capacity : v.list.length ?? 0) + (v.list.growable ? 4 : 0);
        continue;
      }
      bytes += v.kind === 'str' ? 6 + (v.constValue?.type === 'str' ? v.constValue.value.length : 0) : v.kind === 'bool' ? 1 : v.kind === 'none' ? 0 : 4;
    }
    if (bytes > 1500) {
      const first = this.typing.variables[0]?.defs[0]?.node ?? { line: 1, column: 1, endLine: 1, endColumn: 1 };
      this.warn('W-memory', first, { n: String(bytes).replace(/\B(?=(\d{3})+$)/g, ',') });
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** "from machine import Pin" / "import time" for a §3 name used without its import. */
function missingImport(name: string): string | null {
  if ((MODULE_NAMES as readonly string[]).includes(name) || name === 'utime') return `import ${name}`;
  for (const m of IMPORT_ORDER) {
    const members = API_MODULES[m].members;
    if (Object.prototype.hasOwnProperty.call(members, name) && members[name].kind !== 'refused') return `from ${m} import ${name}`;
  }
  return null;
}

/** The name a call calls, as written (`beep`, `print`, `on`). */
function calledName(call: Call): string {
  const f = call.func;
  return f.type === 'Name' ? f.id : f.type === 'Attribute' ? f.attr.name : 'it';
}

function hasCall(e: Expr): boolean {
  let found = false;
  const visit = (x: Expr): void => {
    if (found) return;
    if (x.type === 'Call') {
      found = true;
      return;
    }
    switch (x.type) {
      case 'BinOp':
        visit(x.left);
        visit(x.right);
        break;
      case 'UnaryOp':
        visit(x.operand);
        break;
      case 'Attribute':
        visit(x.value);
        break;
      case 'Subscript':
        visit(x.value);
        visit(x.index);
        break;
      case 'BoolOp':
        x.values.forEach(visit);
        break;
      case 'Compare':
        visit(x.left);
        x.comparators.forEach(visit);
        break;
      case 'IfExp':
        visit(x.test);
        visit(x.body);
        visit(x.orelse);
        break;
      default:
        break;
    }
  };
  visit(e);
  return found;
}

/** A kind in words for the ZERO1-limit messages. */
function kindWords(k: Kind): string {
  if (k === 'str') return 'text';
  if (k === 'int' || k === 'float') return 'a number';
  if (k === 'bool') return 'True / False';
  if (k === 'color') return 'a colour';
  if (k === 'none') return 'nothing';
  if (isListKind(k)) return 'a list';
  return `a ${k}`;
}

/** "8 minutes" for W-sleep-long. */
function longTime(seconds: number): string {
  if (seconds >= 7200) return `${Math.floor(seconds / 3600)} hours`;
  if (seconds >= 3600) return 'an hour';
  if (seconds >= 120) return `${Math.floor(seconds / 60)} minutes`;
  return 'a minute';
}

/** The first method of a part, for NA-value's example. */
function firstMethod(part: PartName): string {
  return Object.values(API_PARTS[part].methods).find((m) => m.kind !== 'refused')?.name ?? 'on';
}

