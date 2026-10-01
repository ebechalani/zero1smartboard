/**
 * Data flow of a ZERO1 Python program (docs/PYTHON.md §2.9, §4.5): per scope (the module's
 * top-level code, each function) a control-flow graph over statements, reaching definitions by
 * the classic iterative algorithm, webs (union-find over "this use can see this definition"),
 * definite assignment and dominators.
 *
 * Definite assignment asks, for a use that the "not assigned yet" pseudo-definition reaches,
 * whether *some first visit* of the use can see a real definition: if none can (`while True:
 * count += 1`, or a use above the only assignment in a loop), Python stops with NameError on the
 * first round — an error; if some can, W-maybe-unassigned.
 */
import type { Expr, For, Name, Stmt } from './ast';
import { isEndlessTest, type DefSite, type FlowEvent, type FunctionInfo, type ImportBinding, type PySymbol, type Resolved, type Scope, type UseSite } from './scope';

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface CfgNode {
  id: number;
  /** The statement this node evaluates (null for entry, exit and the test of a for loop). */
  stmt: Stmt | null;
  /** main: the statement's own evaluation; head: a for loop's target, each round; handler: an except (its alias). */
  part: 'entry' | 'exit' | 'main' | 'head' | 'handler' | 'test';
  events: FlowEvent[];
  succ: number[];
  pred: number[];
}

export interface Cfg {
  scope: Scope;
  nodes: CfgNode[];
  entry: number;
  exit: number;
  /** The node of each statement's own evaluation. */
  nodeOf: Map<Stmt, number>;
  /** For loops: the node that assigns the target each round. */
  headOf: Map<For, number>;
  /** Nodes reachable from the entry. */
  reachable: Set<number>;
  /** The end of the body can be reached without a return (functions: the board gives 0 there). */
  fallsOff: boolean;
}

/** A maximal set of definitions and uses of one name connected by "this use can see this definition" (§2.9). */
export interface Web {
  id: number;
  sym: PySymbol;
  /** Its definitions (assignments, loop targets, parameters, except aliases) in program order. */
  defs: DefSite[];
  uses: UseSite[];
}

/** What a name is where it is read (from the definitions that reach it). */
export type Binding =
  | { kind: 'variable'; web: Web }
  | { kind: 'function'; fn: FunctionInfo }
  | { kind: 'import'; binding: ImportBinding }
  | { kind: 'builtin'; name: string }
  /** Nothing reaches (an error is reported, or the code is unreachable). */
  | { kind: 'undefined' };

/** The definite-assignment result of a use the "not assigned yet" pseudo-definition reaches. */
export interface Unassigned {
  use: UseSite;
  /** error: no first visit of the use sees a value (NameError / UnboundLocalError); maybe: some do (W-maybe-unassigned). */
  certain: boolean;
  /** maybe: a definition some first visit sees (for "it only gets one inside the if on line n"). */
  seen: DefSite | null;
}

export interface ForInfo {
  /** Assignments to the loop variable inside the body (W-loop-var-changed, a hidden counter). */
  assignedInBody: DefSite[];
  /** A value the loop gave its variable is read after the loop (a hidden counter keeps Python's meaning, §2.4). */
  readAfter: boolean;
}

export interface Flow {
  cfgs: Map<Scope, Cfg>;
  /** The definitions (real and pseudo) each use can see. */
  reaching: Map<UseSite, DefSite[]>;
  /** Every web; `webOfDef` / `webOfUse` map into them. */
  webs: Web[];
  webOfDef: Map<DefSite, Web>;
  webOfUse: Map<UseSite, Web>;
  /** Uses that may run before their name has a value. */
  unassigned: Unassigned[];
  /** Definitions that reach the head of the main loop (their value lives on into the next round, §4.7 D2). */
  reachesLoopHead: Set<DefSite>;
  forLoops: Map<For, ForInfo>;
  /** What a Name expression is where it stands (reads and writes). */
  bindingOf(name: Name): Binding;
  /** `a` dominates `b` (same scope): every path from the entry to `b` goes through `a`. */
  dominates(a: Stmt, b: Stmt): boolean;
  /** The node of a definition or use (the statement's main node, a for loop's head, an except's handler node). */
  nodeOfEvent(event: DefSite | UseSite): number;
}

// ---------------------------------------------------------------------------
// bit sets
// ---------------------------------------------------------------------------

class BitSet {
  readonly words: Uint32Array;
  constructor(size: number) {
    this.words = new Uint32Array(Math.ceil(size / 32) || 1);
  }
  has(i: number): boolean {
    return (this.words[i >>> 5] & (1 << (i & 31))) !== 0;
  }
  add(i: number): void {
    this.words[i >>> 5] |= 1 << (i & 31);
  }
  copy(): BitSet {
    const b = new BitSet(0);
    (b as { words: Uint32Array }).words = this.words.slice();
    return b;
  }
  /** this |= other; true when something changed. */
  or(other: BitSet): boolean {
    let changed = false;
    for (let k = 0; k < this.words.length; k++) {
      const v = this.words[k] | other.words[k];
      if (v !== this.words[k]) {
        this.words[k] = v;
        changed = true;
      }
    }
    return changed;
  }
  andNot(other: BitSet): void {
    for (let k = 0; k < this.words.length; k++) this.words[k] &= ~other.words[k];
  }
}

// ---------------------------------------------------------------------------
// the control-flow graph
// ---------------------------------------------------------------------------

class CfgBuilder {
  readonly nodes: CfgNode[] = [];
  readonly nodeOf = new Map<Stmt, number>();
  readonly headOf = new Map<For, number>();
  private readonly loops: Array<{ cont: number; breaks: number[] }> = [];
  readonly exit: number;
  readonly entry: number;

  constructor(
    private readonly resolved: Resolved,
    private readonly scope: Scope,
  ) {
    this.entry = this.node(null, 'entry', this.entryEvents());
    this.exit = this.node(null, 'exit', []);
  }

  private entryEvents(): FlowEvent[] {
    const events: FlowEvent[] = [];
    for (const sym of this.scope.symbols.values()) {
      events.push({ def: sym.undefinedDef });
      if (sym.builtinDef) events.push({ def: sym.builtinDef });
    }
    for (const sym of this.scope.fn?.params ?? []) {
      const def = sym.defs.find((d) => d.kind === 'param');
      if (def) events.push({ def });
    }
    return events;
  }

  node(stmt: Stmt | null, part: CfgNode['part'], events: FlowEvent[]): number {
    // Only this scope's names take part (a function's reads and writes of module names do not).
    const own = events.filter((e) => (e.use ?? e.def)!.sym.scope === this.scope);
    const id = this.nodes.length;
    this.nodes.push({ id, stmt, part, events: own, succ: [], pred: [] });
    return id;
  }

  edge(a: number, b: number): void {
    if (!this.nodes[a].succ.includes(b)) {
      this.nodes[a].succ.push(b);
      this.nodes[b].pred.push(a);
    }
  }

  private link(ins: readonly number[], to: number): void {
    for (const i of ins) this.edge(i, to);
  }

  /** The statements of a block after `ins`; gives the nodes that fall through to what follows. */
  block(stmts: readonly Stmt[], ins: number[]): number[] {
    let outs = ins;
    for (const s of stmts) outs = this.stmt(s, outs);
    return outs;
  }

  private stmt(s: Stmt, ins: number[]): number[] {
    const events = this.resolved.stmtEvents.get(s) ?? { main: [] };
    const main = (part: CfgNode['part'] = 'main') => {
      const n = this.node(s, part, events.main);
      this.nodeOf.set(s, n);
      this.link(ins, n);
      return n;
    };
    switch (s.type) {
      case 'If': {
        const t = main();
        const body = this.block(s.body.stmts, [t]);
        const orelse = s.orelse ? this.block(s.orelse.stmts, [t]) : [t];
        return [...body, ...orelse];
      }
      case 'While': {
        const t = main();
        this.loops.push({ cont: t, breaks: [] });
        const body = this.block(s.body.stmts, [t]);
        this.link(body, t);
        const loop = this.loops.pop()!;
        return [...(isEndlessTest(s.test) ? [] : [t]), ...loop.breaks];
      }
      case 'For': {
        const pre = main();
        const test = this.node(s, 'test', []);
        const head = this.node(s, 'head', events.head ?? []);
        this.headOf.set(s, head);
        // `for … in range(3)` with literal bounds runs at least once: the first round cannot skip the body.
        this.edge(pre, literalRangeRuns(s) ? head : test);
        this.edge(test, head);
        this.loops.push({ cont: test, breaks: [] });
        const body = this.block(s.body.stmts, [head]);
        this.link(body, test);
        const loop = this.loops.pop()!;
        return [test, ...loop.breaks];
      }
      case 'Try': {
        const t = main();
        const body = this.block(s.body.stmts, [t]);
        const h = this.node(s, 'handler', events.handler ?? []);
        this.edge(t, h);
        const handler = this.block(s.handler.body.stmts, [h]);
        const orelse = s.orelse ? this.block(s.orelse.stmts, body) : body;
        return [...orelse, ...handler];
      }
      case 'Break': {
        const n = main();
        this.loops[this.loops.length - 1]?.breaks.push(n);
        return [];
      }
      case 'Continue': {
        const n = main();
        const loop = this.loops[this.loops.length - 1];
        if (loop) this.edge(n, loop.cont);
        return [];
      }
      case 'Return':
        this.edge(main(), this.exit);
        return [];
      case 'Raise':
        main();
        return [];
      default:
        return [main()];
    }
  }
}

/** `range(…)` with literal whole-number arguments that makes at least one round. */
function literalRangeRuns(loop: For): boolean {
  const it = loop.iter;
  if (it.type !== 'Call' || it.func.type !== 'Name' || it.func.id !== 'range' || it.keywords.length > 0) return false;
  const lit = (e: Expr): number | null => {
    if (e.type === 'Num' && !e.isFloat) return e.value;
    if (e.type === 'UnaryOp' && e.op === '-' && e.operand.type === 'Num' && !e.operand.isFloat) return -e.operand.value;
    return null;
  };
  const n = it.args.map(lit);
  if (n.length === 0 || n.length > 3 || n.some((x) => x === null)) return false;
  const [start, stop, step] = n.length === 1 ? [0, n[0]!, 1] : n.length === 2 ? [n[0]!, n[1]!, 1] : (n as number[]);
  return step > 0 ? start < stop : step < 0 ? start > stop : false;
}

function buildCfg(resolved: Resolved, scope: Scope): Cfg {
  const b = new CfgBuilder(resolved, scope);
  const stmts = scope.fn ? scope.fn.def.body.stmts : resolved.body;
  const outs = b.block(stmts, [b.entry]);
  for (const o of outs) b.edge(o, b.exit);
  const reachable = new Set<number>();
  const stack = [b.entry];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (reachable.has(n)) continue;
    reachable.add(n);
    stack.push(...b.nodes[n].succ);
  }
  return {
    scope,
    nodes: b.nodes,
    entry: b.entry,
    exit: b.exit,
    nodeOf: b.nodeOf,
    headOf: b.headOf,
    reachable,
    fallsOff: outs.some((o) => reachable.has(o)),
  };
}

// ---------------------------------------------------------------------------
// the analysis
// ---------------------------------------------------------------------------

const REAL_VARIABLE_DEF = new Set(['assign', 'augassign', 'for', 'param', 'except']);

/** A definition that gives a variable its value (not an import, a def or a pseudo-definition). */
export function isVariableDef(def: DefSite): boolean {
  return REAL_VARIABLE_DEF.has(def.kind);
}

export function analyzeFlow(resolved: Resolved): Flow {
  const cfgs = new Map<Scope, Cfg>();
  const reaching = new Map<UseSite, DefSite[]>();
  const unassigned: Unassigned[] = [];
  const reachesLoopHead = new Set<DefSite>();
  const nodeOfEvent = new Map<DefSite | UseSite, number>();
  const scopes: Scope[] = [resolved.moduleScope, ...resolved.functions.map((f) => f.scope)];

  for (const scope of scopes) {
    const cfg = buildCfg(resolved, scope);
    cfgs.set(scope, cfg);
    const index = new Map<DefSite, number>();
    const list: DefSite[] = [];
    for (const sym of scope.symbols.values()) {
      for (const d of [sym.undefinedDef, ...(sym.builtinDef ? [sym.builtinDef] : []), ...sym.defs]) {
        if (d.scope === scope && !index.has(d)) {
          index.set(d, list.length);
          list.push(d);
        }
      }
    }
    const size = list.length;
    const symMask = new Map<PySymbol, BitSet>();
    const symDefs = new Map<PySymbol, number[]>();
    for (const d of list) {
      let m = symMask.get(d.sym);
      if (!m) symMask.set(d.sym, (m = new BitSet(size)));
      const i = index.get(d)!;
      m.add(i);
      const ids = symDefs.get(d.sym) ?? [];
      ids.push(i);
      symDefs.set(d.sym, ids);
    }
    // Reaching definitions: IN(n) = ∪ OUT(pred); OUT = the node's defs applied in order.
    const ins = cfg.nodes.map(() => new BitSet(size));
    const transfer = (n: CfgNode, set: BitSet, onUse?: (use: UseSite, current: BitSet) => void) => {
      for (const e of n.events) {
        if (e.def) {
          const i = index.get(e.def);
          if (i === undefined) continue;
          set.andNot(symMask.get(e.def.sym)!);
          set.add(i);
        } else if (onUse) {
          onUse(e.use, set);
        }
      }
      return set;
    };
    const work: number[] = [cfg.entry];
    const queued = new Set(work);
    const outs = cfg.nodes.map(() => null as BitSet | null);
    for (let head = 0; head < work.length; head++) {
      const id = work[head];
      queued.delete(id);
      const node = cfg.nodes[id];
      const out = transfer(node, ins[id].copy());
      const prev = outs[id];
      if (prev && prev.words.every((w, k) => w === out.words[k])) continue;
      outs[id] = out;
      for (const s of node.succ) {
        if (ins[s].or(out) || !outs[s]) {
          if (!queued.has(s)) {
            queued.add(s);
            work.push(s);
          }
        }
      }
    }
    for (const node of cfg.nodes) {
      for (const e of node.events) nodeOfEvent.set((e.use ?? e.def)!, node.id);
      if (!cfg.reachable.has(node.id)) continue;
      transfer(node, ins[node.id].copy(), (use, current) => {
        const seen = (symDefs.get(use.sym) ?? []).filter((i) => current.has(i)).map((i) => list[i]);
        reaching.set(use, seen);
      });
    }
    // Definitions alive at the main loop's head (§4.7 D2).
    if (scope === resolved.moduleScope && resolved.main.loop) {
      const head = cfg.nodeOf.get(resolved.main.loop);
      if (head !== undefined) list.forEach((d, i) => ins[head].has(i) && reachesLoopHead.add(d));
    }
    // Definite assignment: first visits of the use.
    for (const node of cfg.nodes) {
      if (!cfg.reachable.has(node.id)) continue;
      for (const e of node.events) {
        if (!e.use) continue;
        const seen = reaching.get(e.use) ?? [];
        if (!seen.includes(e.use.sym.undefinedDef)) continue;
        if (scope === resolved.moduleScope && e.use.sym.writtenByFunction) continue;
        const firstDef = firstVisitDef(cfg, node.id, e.use.sym);
        unassigned.push({ use: e.use, certain: firstDef === null, seen: firstDef });
      }
    }
  }

  // Uses in functions of module names: every definition of the name (the call order is unknown).
  for (const use of resolved.uses) {
    if (use.sym.scope === use.scope) continue;
    const defs = use.sym.defs.filter((d) => d.kind !== 'undefined');
    reaching.set(use, defs.length > 0 ? defs : use.sym.builtinDef ? [use.sym.builtinDef] : [use.sym.undefinedDef]);
  }

  // Webs: union-find over "a use sees these variable definitions"; shared module names are one web.
  const parent = new Map<DefSite, DefSite>();
  const find = (d: DefSite): DefSite => {
    let r = d;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(d, r);
    return r;
  };
  const union = (a: DefSite, b: DefSite) => parent.set(find(a), find(b));
  const varDefs = resolved.defs.filter(isVariableDef);
  for (const d of varDefs) parent.set(d, d);
  for (const [, defs] of reaching) {
    const vs = defs.filter(isVariableDef);
    for (let k = 1; k < vs.length; k++) union(vs[0], vs[k]);
  }
  for (const sym of resolved.moduleScope.symbols.values()) {
    if (!sym.shared) continue;
    const vs = sym.defs.filter(isVariableDef);
    for (let k = 1; k < vs.length; k++) union(vs[0], vs[k]);
  }
  const webs: Web[] = [];
  const webOfDef = new Map<DefSite, Web>();
  const byRoot = new Map<DefSite, Web>();
  for (const d of varDefs) {
    const root = find(d);
    let web = byRoot.get(root);
    if (!web) {
      web = { id: webs.length, sym: d.sym, defs: [], uses: [] };
      byRoot.set(root, web);
      webs.push(web);
    }
    web.defs.push(d);
    webOfDef.set(d, web);
  }
  const webOfUse = new Map<UseSite, Web>();
  for (const use of resolved.uses) {
    const d = (reaching.get(use) ?? []).find(isVariableDef);
    if (!d) continue;
    const web = webOfDef.get(d)!;
    web.uses.push(use);
    webOfUse.set(use, web);
  }

  // For loops: assignments to the variable in the body, reads after the loop.
  const forLoops = new Map<For, ForInfo>();
  const inside = (s: Stmt, ancestor: Stmt) => {
    for (let p: Stmt | null | undefined = s; p; p = resolved.parentOf.get(p)) if (p === ancestor) return true;
    return false;
  };
  for (const def of resolved.defs) {
    if (def.kind !== 'for' || !def.stmt || def.stmt.type !== 'For') continue;
    const loop = def.stmt;
    const assignedInBody = def.sym.defs.filter((d) => d !== def && d.stmt && d.stmt !== loop && inside(d.stmt, loop) && isVariableDef(d));
    const inLoop = (d: DefSite) => d === def || assignedInBody.includes(d);
    const readAfter = def.sym.uses.some((u) => !(u.stmt !== loop && inside(u.stmt, loop)) && (reaching.get(u) ?? []).some(inLoop));
    forLoops.set(loop, { assignedInBody, readAfter });
  }

  // Dominators (Cooper, Harvey, Kennedy) per scope, on the reachable nodes.
  const idoms = new Map<Scope, number[]>();
  const rpoIndex = new Map<Scope, number[]>();
  for (const [scope, cfg] of cfgs) {
    const order: number[] = [];
    const seen = new Set<number>();
    const visit = (n: number) => {
      seen.add(n);
      for (const s of cfg.nodes[n].succ) if (!seen.has(s)) visit(s);
      order.push(n);
    };
    visit(cfg.entry);
    order.reverse();
    const pos: number[] = cfg.nodes.map(() => -1);
    order.forEach((n, i) => (pos[n] = i));
    const idom: number[] = cfg.nodes.map(() => -1);
    idom[cfg.entry] = cfg.entry;
    const intersect = (a: number, b: number) => {
      while (a !== b) {
        while (pos[a] > pos[b]) a = idom[a];
        while (pos[b] > pos[a]) b = idom[b];
      }
      return a;
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const n of order) {
        if (n === cfg.entry) continue;
        let d = -1;
        for (const p of cfg.nodes[n].pred) if (idom[p] !== -1) d = d === -1 ? p : intersect(p, d);
        if (d !== -1 && idom[n] !== d) {
          idom[n] = d;
          changed = true;
        }
      }
    }
    idoms.set(scope, idom);
    rpoIndex.set(scope, pos);
  }

  const bindings = new Map<Name, Binding>();
  const bindingOf = (name: Name): Binding => {
    let b = bindings.get(name);
    if (!b) bindings.set(name, (b = computeBinding(name)));
    return b;
  };
  const computeBinding = (name: Name): Binding => {
    const ref = resolved.refs.get(name);
    if (!ref) return { kind: 'undefined' };
    if (ref.kind === 'builtin') return { kind: 'builtin', name: ref.name };
    if (ref.kind === 'unbound') return { kind: 'undefined' };
    if (ref.def && isVariableDef(ref.def)) return { kind: 'variable', web: webOfDef.get(ref.def)! };
    if (!ref.use) return { kind: 'undefined' };
    const defs = reaching.get(ref.use) ?? [];
    const v = defs.find(isVariableDef);
    if (v) return { kind: 'variable', web: webOfDef.get(v)! };
    const last = <T>(xs: T[]) => xs[xs.length - 1];
    const fns = defs.filter((d) => d.kind === 'function' && d.fn);
    if (fns.length > 0) return { kind: 'function', fn: last(fns).fn! };
    const imports = defs.filter((d) => d.kind === 'import' && d.import);
    if (imports.length > 0) return { kind: 'import', binding: last(imports).import! };
    if (defs.some((d) => d.kind === 'builtin')) return { kind: 'builtin', name: ref.sym.name };
    return { kind: 'undefined' };
  };

  const dominates = (a: Stmt, b: Stmt): boolean => {
    const scope = resolved.scopeOf.get(a);
    if (!scope || scope !== resolved.scopeOf.get(b)) return false;
    const cfg = cfgs.get(scope)!;
    const idom = idoms.get(scope)!;
    const na = cfg.nodeOf.get(a);
    let nb = cfg.nodeOf.get(b);
    if (na === undefined || nb === undefined || idom[nb] === -1) return false;
    for (;;) {
      if (nb === na) return true;
      if (nb === cfg.entry) return false;
      nb = idom[nb];
    }
  };

  return {
    cfgs,
    reaching,
    webs,
    webOfDef,
    webOfUse,
    unassigned,
    reachesLoopHead,
    forLoops,
    bindingOf,
    dominates,
    nodeOfEvent: (event) => nodeOfEvent.get(event) ?? -1,
  };
}

/**
 * The earliest (in program order) definition of `sym` that some first visit of node `u` sees:
 * a defining node reachable from the entry without passing `u` and from which `u` can be reached
 * without passing `u`; null when every first visit of `u` comes without a value.
 */
function firstVisitDef(cfg: Cfg, u: number, sym: PySymbol): DefSite | null {
  const forward = new Set<number>();
  const stack = [cfg.entry];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (forward.has(n) || n === u) continue;
    forward.add(n);
    stack.push(...cfg.nodes[n].succ);
  }
  const backward = new Set<number>();
  stack.push(...cfg.nodes[u].pred);
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (backward.has(n) || n === u) continue;
    backward.add(n);
    stack.push(...cfg.nodes[n].pred);
  }
  let best: DefSite | null = null;
  for (const n of backward) {
    if (!forward.has(n)) continue;
    for (const e of cfg.nodes[n].events) {
      const d = e.def;
      if (!d || d.sym !== sym || !isVariableDef(d)) continue;
      if (!best || (d.node && best.node && (d.node.line < best.node.line || (d.node.line === best.node.line && d.node.column < best.node.column)))) best = d;
    }
  }
  return best;
}
