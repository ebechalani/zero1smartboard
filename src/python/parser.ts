/**
 * Recursive-descent parser of ZERO1 Python (docs/PYTHON.md §2.3, §4.4) over the tokens of
 * tokens.ts; binary operators by one function per precedence level, like src/transpiler.
 *
 * `parse()` returns the Module or throws the first PythonSyntaxError (§5.1), like CPython: first
 * the errors of the grammar in source order (an unexpected token, a missing ':', an indentation
 * error, …), then — for a program that parses — the rules CPython checks after parsing
 * ('return' outside a function, 'break' outside a loop, a global declared after use, a repeated
 * keyword argument or parameter), the earliest one in the program.
 *
 * Everything CPython parses is parsed; what ZERO1 Python does not have becomes an `Unsupported`
 * node with its NA code (§5.4) for the checker. Comments are attached by indentation (§4.4).
 */
import type {
  AssignTarget,
  AugOp,
  BinaryOp,
  Block,
  Comment,
  CompareOp,
  EscapeNote,
  ExceptHandler,
  Expr,
  FString,
  FStringField,
  FStringText,
  For,
  FunctionDef,
  Identifier,
  If,
  ImportAlias,
  Keyword,
  ListLit,
  Module,
  Name,
  Param,
  Span,
  Stmt,
  StmtBase,
  Str,
  StrPart,
  Subscript,
  Attribute,
  Unsupported,
  UnsupportedStmt,
  While,
} from './ast';
import type { MessageCode } from './messages';
import { PYTHON_KEYWORDS, PythonSyntaxError, tokenize, type FStringFieldPart, type Token } from './tokens';

export { PythonSyntaxError };

/** Parses the tokens of a whole program (tokenize() output). */
export function parse(tokens: readonly Token[]): Module {
  return new Parser(tokens).parseModule();
}

/** tokenize() then parse(). */
export function parseSource(source: string): Module {
  return parse(tokenize(source));
}

const AUG_OPS: ReadonlySet<string> = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=', '@=']);
const COMPARE_OPS: ReadonlySet<string> = new Set(['==', '!=', '<', '<=', '>', '>=']);
/** Python's binary operators below the unary ones (higher binds tighter; '@' is NA-matmul). */
const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  '|': 1,
  '^': 2,
  '&': 3,
  '<<': 4,
  '>>': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '//': 6,
  '%': 6,
  '@': 6,
};
/** Keywords that start an expression (the other keywords cannot). */
const EXPRESSION_KEYWORDS: ReadonlySet<string> = new Set(['True', 'False', 'None', 'not', 'lambda', 'await']);

/** How S-cannot-assign names what stands left of '=' (CPython's words). */
const UNSUPPORTED_TARGET_WORDS: Partial<Record<MessageCode, string>> = {
  'NA-dict': 'dict literal',
  'NA-comprehension': 'comprehension',
  'NA-lambda': 'lambda',
  'NA-walrus': 'named expression',
  'NA-generator': 'yield expression',
  'NA-ellipsis': 'ellipsis',
  'NA-complex': 'literal',
  'NA-bytes': 'literal',
  'NA-is': 'comparison',
  'NA-none': 'comparison',
  'NA-async': 'await expression',
  'NA-star-args': 'starred',
};

/** Names seen in one scope (module, function, class body), for S-global-after-use. */
interface Scope {
  kind: 'module' | 'function' | 'class';
  seen: Set<string>;
  /** Loops open in this scope (break / continue). */
  loops: number;
}

class Parser {
  /** The tokens without comments. */
  private toks: Token[];
  private pos = 0;
  /** The last token consumed that is not NEWLINE / INDENT / DEDENT / EOF (node ends). */
  private prev: Token;
  private readonly comments: Token[];
  private readonly claimed: boolean[];
  /** Index of the first comment that may still be unclaimed. */
  private commentCursor = 0;
  private readonly scopes: Scope[] = [{ kind: 'module', seen: new Set(), loops: 0 }];
  /** Brackets (and f-string fields) open around the current expression: S-comma applies. */
  private bracketDepth = 0;
  /** Errors CPython finds after parsing; the earliest is thrown once the whole program parses. */
  private readonly deferred: PythonSyntaxError[] = [];

  constructor(tokens: readonly Token[]) {
    this.toks = tokens.filter((t) => t.kind !== 'COMMENT');
    this.comments = tokens.filter((t) => t.kind === 'COMMENT');
    this.claimed = this.comments.map(() => false);
    this.prev = this.toks[0];
  }

  // ---- tokens ---------------------------------------------------------------

  private peek(k = 0): Token {
    return this.toks[Math.min(this.pos + k, this.toks.length - 1)];
  }

  private next(): Token {
    const t = this.toks[this.pos];
    if (this.pos < this.toks.length - 1) this.pos++;
    if (t.kind !== 'NEWLINE' && t.kind !== 'INDENT' && t.kind !== 'DEDENT' && t.kind !== 'EOF') this.prev = t;
    return t;
  }

  private isOp(t: Token, op: string): boolean {
    return t.kind === 'OP' && t.text === op;
  }

  private isKw(t: Token, kw: string): boolean {
    return t.kind === 'NAME' && t.text === kw;
  }

  private isKeyword(t: Token): boolean {
    return t.kind === 'NAME' && PYTHON_KEYWORDS.has(t.text);
  }

  private fail(code: MessageCode, span: Span, params: Record<string, string | number> = {}): never {
    throw new PythonSyntaxError(code, span, params);
  }

  /** S-syntax at a token (NEWLINE and EOF are empty: the error is a point right after the line's code). */
  private unexpected(t: Token = this.peek()): never {
    this.fail('S-syntax', t);
  }

  private expectOp(op: string): Token {
    const t = this.peek();
    if (!this.isOp(t, op)) this.unexpected(t);
    return this.next();
  }

  private expectKw(kw: string): Token {
    const t = this.peek();
    if (!this.isKw(t, kw)) this.unexpected(t);
    return this.next();
  }

  /** A name that is not a keyword. */
  private identifier(): Identifier {
    const t = this.peek();
    if (t.kind !== 'NAME' || this.isKeyword(t)) this.unexpected(t);
    this.next();
    return { name: t.text.normalize('NFKC'), ...span(t, t) };
  }

  /** From `start` to the end of the last token consumed. */
  private spanFrom(start: Span): Span {
    return span(start, this.prev);
  }

  private startsExpression(t: Token): boolean {
    if (t.kind === 'NAME') return !this.isKeyword(t) || EXPRESSION_KEYWORDS.has(t.text);
    if (t.kind === 'NUMBER' || t.kind === 'STRING' || t.kind === 'FSTRING') return true;
    return t.kind === 'OP' && ['(', '[', '{', '-', '+', '~', '...', '*'].includes(t.text);
  }

  // ---- scopes (checks CPython makes after parsing) -----------------------------

  private get scope(): Scope {
    return this.scopes[this.scopes.length - 1];
  }

  private see(name: string): void {
    this.scope.seen.add(name);
  }

  /** An error CPython finds after parsing (reported once the whole program has parsed). */
  private defer(code: MessageCode, at: Span, params: Record<string, string | number> = {}): void {
    this.deferred.push(new PythonSyntaxError(code, at, params));
  }

  // ---- comments -----------------------------------------------------------------

  /** Comments before `line` that are still unclaimed (own-line ones; any left-over too). */
  private takeBefore(line: number): Comment[] {
    const out: Comment[] = [];
    for (let k = this.commentCursor; k < this.comments.length && this.comments[k].line < line; k++) {
      if (!this.claimed[k]) out.push(this.claim(k));
    }
    this.advanceCursor();
    return out;
  }

  /** End-of-line comments (after code, or inside brackets) on lines up to `line`. */
  private takeTrailing(line: number): Comment[] {
    const out: Comment[] = [];
    for (let k = this.commentCursor; k < this.comments.length && this.comments[k].line <= line; k++) {
      if (!this.claimed[k] && !this.comments[k].ownLine) out.push(this.claim(k));
    }
    this.advanceCursor();
    return out;
  }

  /** The comment lines before `line` that belong to a block indented by `indent` (§4.4). */
  private takeBlockEnd(line: number, indent: number): Comment[] {
    const out: Comment[] = [];
    for (let k = this.commentCursor; k < this.comments.length && this.comments[k].line < line; k++) {
      if (this.claimed[k]) continue;
      const c = this.comments[k];
      if (!c.ownLine || (c.indent ?? 0) < indent) break;
      out.push(this.claim(k));
    }
    this.advanceCursor();
    return out;
  }

  private claim(k: number): Comment {
    this.claimed[k] = true;
    const t = this.comments[k];
    return { text: t.text.slice(1), line: t.line, column: t.column, endLine: t.endLine, endColumn: t.endColumn };
  }

  private advanceCursor(): void {
    while (this.commentCursor < this.comments.length && this.claimed[this.commentCursor]) this.commentCursor++;
  }

  // ---- module and blocks ----------------------------------------------------------

  parseModule(): Module {
    const stmts: Stmt[] = [];
    while (this.peek().kind !== 'EOF') stmts.push(...this.statement());
    const eof = this.peek();
    const block: Block = { stmts, endComments: this.takeBefore(Number.MAX_SAFE_INTEGER) };
    const docstring = takeDocstring(block);
    if (this.deferred.length > 0) {
      throw this.deferred.reduce((a, b) => (b.line < a.line || (b.line === a.line && b.column < a.column) ? b : a));
    }
    return { type: 'Module', body: block, docstring, line: 1, column: 1, endLine: eof.endLine, endColumn: eof.endColumn };
  }

  /**
   * The block after a header's ':' — an indented block or a one-line suite. The header's
   * end-of-line comments go to `headerComments`.
   */
  private block(header: Token, headerComments: Comment[]): Block {
    if (this.peek().kind !== 'NEWLINE') return { stmts: this.simpleStatements(), endComments: [] };
    const newline = this.next();
    headerComments.push(...this.takeTrailing(newline.line));
    const indent = this.peek();
    if (indent.kind !== 'INDENT') {
      let at = this.pos;
      while (this.toks[at].kind === 'DEDENT') at++;
      this.fail('S-indent-expected', this.toks[at], { kw: header.text, n: header.line });
    }
    this.next();
    const stmts: Stmt[] = [];
    while (this.peek().kind !== 'DEDENT' && this.peek().kind !== 'EOF') stmts.push(...this.statement());
    const endComments = this.takeBlockEnd(this.peek().line, indent.indent ?? 0);
    if (this.peek().kind === 'DEDENT') this.next();
    return { stmts, endComments };
  }

  /** One statement line: a compound statement, or simple statements separated by ';'. */
  private statement(): Stmt[] {
    const t = this.peek();
    const leading = this.takeBefore(t.line);
    if (t.kind === 'INDENT') this.fail('S-indent-unexpected', this.peek(1));
    const stmts = this.compound() ?? this.simpleStatements();
    stmts[0].leading.unshift(...leading);
    return stmts;
  }

  private simpleStatements(): Stmt[] {
    const stmts: Stmt[] = [this.simple()];
    while (this.isOp(this.peek(), ';')) {
      this.next();
      if (this.peek().kind === 'NEWLINE') break;
      stmts.push(this.simple());
    }
    const end = this.peek();
    if (end.kind !== 'NEWLINE') this.unexpected(end);
    this.next();
    stmts[stmts.length - 1].trailing.push(...this.takeTrailing(end.line));
    return stmts;
  }

  // ---- compound statements --------------------------------------------------------

  /** A compound statement (with the decorators before it), or null when the line is simple. */
  private compound(): Stmt[] | null {
    const t = this.peek();
    if (this.isOp(t, '@')) return this.decorated();
    if (t.kind !== 'NAME') return null;
    switch (t.text) {
      case 'if':
        return [this.ifStatement()];
      case 'while':
        return [this.whileStatement()];
      case 'for':
        return [this.forStatement()];
      case 'def':
        return [this.functionDef()];
      case 'try':
        return [this.tryStatement()];
      case 'class':
        return [this.classDef()];
      case 'with':
        return [this.withStatement()];
      case 'async':
        return [this.asyncStatement()];
      case 'elif':
      case 'else':
      case 'except':
      case 'finally':
        return this.unexpected(t);
      case 'match':
      case 'case':
        return this.isMatchHeader() ? [this.matchStatement()] : null;
      default:
        return null;
    }
  }

  private stmtBase<T extends string>(type: T, start: Span): { type: T; leading: Comment[]; trailing: Comment[] } & Span {
    return { type, leading: [], trailing: [], ...this.spanFrom(start) };
  }

  /** The ':' that ends a header (S-colon when the line ends, S-assign-in-if for `if x = 5`). */
  private headerColon(test: { start: Token } | null = null): void {
    const t = this.peek();
    if (this.isOp(t, ':')) {
      this.next();
      return;
    }
    if (test && this.isOp(t, '=')) this.assignInCondition(test.start);
    if (t.kind === 'NEWLINE' || t.kind === 'EOF') this.fail('S-colon', t);
    this.unexpected(t);
  }

  /** `if x = 5:` — S-assign-in-if from `x` to the end of `5`. */
  private assignInCondition(start: Token): never {
    this.next(); // '='
    try {
      this.expression();
    } catch {
      /* the underline ends at the '=' */
    }
    this.fail('S-assign-in-if', this.spanFrom(start));
  }

  private ifStatement(isElif = false): If {
    const kw = this.next();
    const testStart = this.peek();
    const test = this.namedExpression();
    this.headerColon({ start: testStart });
    const node: If = { type: 'If', test, body: { stmts: [], endComments: [] }, orelse: null, isElif, leading: [], trailing: [], ...span(kw, kw) };
    node.body = this.block(kw, node.trailing);
    const t = this.peek();
    if (this.isKw(t, 'elif')) {
      node.body.endComments.push(...this.takeBefore(t.line));
      node.orelse = { stmts: [this.ifStatement(true)], endComments: [] };
    } else if (this.isKw(t, 'else')) {
      node.body.endComments.push(...this.takeBefore(t.line));
      node.orelse = this.elseBlock();
    }
    Object.assign(node, this.spanFrom(kw));
    return node;
  }

  /** `else:` and its block; `else if` is S-else-if. */
  private elseBlock(): Block {
    const kw = this.next();
    const t = this.peek();
    if (this.isKw(t, 'if')) this.fail('S-else-if', span(kw, t));
    this.headerColon();
    const headerComments: Comment[] = [];
    const block = this.block(kw, headerComments);
    return withHeaderComments(block, headerComments);
  }

  /** `else:` after a loop: NA-loop-else at the `else` (its block is parsed, then dropped). */
  private loopElse(body: Block): Unsupported | null {
    const t = this.peek();
    if (!this.isKw(t, 'else')) return null;
    body.endComments.push(...this.takeBefore(t.line));
    const kw = this.next();
    this.headerColon();
    this.block(kw, []);
    return unsupported('NA-loop-else', span(kw, kw));
  }

  private loopBody(header: Token, headerComments: Comment[]): Block {
    this.scope.loops++;
    try {
      return this.block(header, headerComments);
    } finally {
      this.scope.loops--;
    }
  }

  private whileStatement(): While {
    const kw = this.next();
    const testStart = this.peek();
    const test = this.namedExpression();
    this.headerColon({ start: testStart });
    const node: While = { type: 'While', test, body: { stmts: [], endComments: [] }, orelse: null, leading: [], trailing: [], ...span(kw, kw) };
    node.body = this.loopBody(kw, node.trailing);
    node.orelse = this.loopElse(node.body);
    Object.assign(node, this.spanFrom(kw));
    return node;
  }

  private forStatement(): For {
    const kw = this.next();
    const targetStart = this.peek();
    const targets = this.targetList();
    const target = targets.length === 1 && targets[0].type === 'Name' ? targets[0] : unsupported('NA-unpack', this.spanFrom(targetStart));
    for (const t of targets) this.assignTarget(t, false);
    this.expectKw('in');
    const iter = this.starExpressions();
    this.headerColon();
    const node: For = { type: 'For', target, iter, body: { stmts: [], endComments: [] }, orelse: null, leading: [], trailing: [], ...span(kw, kw) };
    node.body = this.loopBody(kw, node.trailing);
    node.orelse = this.loopElse(node.body);
    Object.assign(node, this.spanFrom(kw));
    return node;
  }

  /** The loop variables of `for … in` (comma separated; parsed below the `in` operator). */
  private targetList(): Expr[] {
    const targets: Expr[] = [this.starOr(() => this.bitOr())];
    while (this.isOp(this.peek(), ',')) {
      this.next();
      if (this.isKw(this.peek(), 'in')) break;
      targets.push(this.starOr(() => this.bitOr()));
    }
    return targets;
  }

  private functionDef(): Stmt {
    const kw = this.next();
    const name = this.identifier();
    this.see(name.name);
    this.expectOp('(');
    this.bracketDepth++;
    const { params, unsupported: notes } = this.parameters(')');
    this.bracketDepth--;
    this.expectOp(')');
    if (this.isOp(this.peek(), '->')) {
      const arrow = this.next();
      this.expression();
      notes.push(unsupported('NA-annotation', this.spanFrom(arrow), { annotation: this.textFrom(arrow) }));
    }
    this.headerColon();
    const header = this.spanFrom(kw);
    const nested = this.scopes.some((s) => s.kind === 'function');
    const trailing: Comment[] = [];
    this.scopes.push({ kind: 'function', seen: new Set(params.map((p) => p.name)), loops: 0 });
    let body: Block;
    try {
      body = this.block(kw, trailing);
    } finally {
      this.scopes.pop();
    }
    if (nested) return { ...unsupported('NA-nested-def', header, { f: name.name }), leading: [], trailing };
    const docstring = takeDocstring(body);
    const node: FunctionDef = { type: 'FunctionDef', name, params, body, docstring, unsupported: notes, leading: [], trailing, ...this.spanFrom(kw) };
    return node;
  }

  /** Parameters up to `close` (def: ')'; lambda: ':'). */
  private parameters(close: string): { params: Param[]; unsupported: Unsupported[] } {
    const params: Param[] = [];
    const notes: Unsupported[] = [];
    const names = new Set<string>();
    let seenDefault = false;
    let keywordOnly = false;
    while (!this.isOp(this.peek(), close)) {
      const t = this.peek();
      if (this.isOp(t, '*') || this.isOp(t, '**')) {
        this.next();
        if (t.text === '*') keywordOnly = true;
        if (this.peek().kind === 'NAME' && !this.isKeyword(this.peek())) this.see(this.identifier().name);
        notes.push(unsupported('NA-star-args', this.spanFrom(t)));
      } else if (this.isOp(t, '/')) {
        this.next();
        notes.push(unsupported('NA-star-args', span(t, t)));
      } else {
        const name = this.identifier();
        if (close === ')' && this.isOp(this.peek(), ':')) {
          const colon = this.next();
          this.expression();
          notes.push(unsupported('NA-annotation', this.spanFrom(colon), { annotation: this.textFrom(colon) }));
        }
        let value: Expr | null = null;
        if (this.isOp(this.peek(), '=')) {
          this.next();
          value = this.expression();
        } else if (seenDefault && !keywordOnly) {
          this.fail('S-default-order', name);
        }
        if (value) seenDefault = true;
        if (names.has(name.name)) this.defer('S-duplicate-param', name, { a: name.name });
        names.add(name.name);
        params.push({ ...name, default: value, ...this.spanFrom(name) });
      }
      if (!this.isOp(this.peek(), ',')) break;
      this.next();
    }
    return { params, unsupported: notes };
  }

  private tryStatement(): Stmt {
    const kw = this.next();
    this.headerColon();
    const trailing: Comment[] = [];
    const body = this.block(kw, trailing);
    let last = body;
    const handlers: Array<{ kw: Token; type: Expr | null; star: boolean; alias: Identifier | null; body: Block; header: Span }> = [];
    let orelse: Block | null = null;
    let finallyKw: Token | null = null;
    while (this.isKw(this.peek(), 'except')) {
      last.endComments.push(...this.takeBefore(this.peek().line));
      const ex = this.next();
      const star = this.isOp(this.peek(), '*');
      if (star) this.next();
      let type: Expr | null = null;
      let alias: Identifier | null = null;
      if (!this.isOp(this.peek(), ':')) {
        type = this.expression();
        if (this.isKw(this.peek(), 'as')) {
          this.next();
          alias = this.identifier();
          this.see(alias.name);
        }
      }
      this.headerColon();
      const header = this.spanFrom(ex);
      const headerComments: Comment[] = [];
      const handlerBody = withHeaderComments(this.block(ex, headerComments), headerComments);
      handlers.push({ kw: ex, type, star, alias, body: handlerBody, header });
      last = handlerBody;
    }
    if (handlers.length > 0 && this.isKw(this.peek(), 'else')) {
      last.endComments.push(...this.takeBefore(this.peek().line));
      orelse = this.elseBlock();
      last = orelse;
    }
    if (this.isKw(this.peek(), 'finally')) {
      last.endComments.push(...this.takeBefore(this.peek().line));
      finallyKw = this.next();
      this.headerColon();
      this.block(finallyKw, []);
    }
    if (handlers.length === 0 && finallyKw === null) this.unexpected(); // expected 'except' or 'finally' block
    // Only one `except [Name [as alias]]:` (+ else) is kept (§2.12); anything else is NA-try.
    const refused =
      handlers.find((h, i) => i > 0 || h.star || (h.type !== null && h.type.type !== 'Name'))?.header ??
      (finallyKw ? span(finallyKw, finallyKw) : null);
    if (refused || handlers.length !== 1) {
      return { ...unsupported('NA-try', refused ?? span(kw, kw)), leading: [], trailing };
    }
    const h = handlers[0];
    const typeName = h.type && h.type.type === 'Name' ? { name: h.type.id, ...spanOf(h.type) } : null;
    const handler: ExceptHandler = { typeName, alias: h.alias, body: h.body, ...span(h.kw, this.prevOf(h.body, h.header)) };
    return { type: 'Try', body, handler, orelse, leading: [], trailing, ...this.spanFrom(kw) };
  }

  /** Where a block ends (its last statement), or `fallback` for an empty one. */
  private prevOf(block: Block, fallback: Span): Span {
    const last = block.stmts[block.stmts.length - 1];
    return last ?? fallback;
  }

  private classDef(): Stmt {
    const kw = this.next();
    const name = this.identifier();
    this.see(name.name);
    if (this.isOp(this.peek(), '(')) {
      this.next();
      this.callArguments();
    }
    this.headerColon();
    const header = this.spanFrom(kw);
    const trailing: Comment[] = [];
    this.scopes.push({ kind: 'class', seen: new Set(), loops: 0 });
    try {
      this.block(kw, trailing);
    } finally {
      this.scopes.pop();
    }
    return { ...unsupported('NA-class', header), leading: [], trailing };
  }

  private withStatement(): Stmt {
    const kw = this.next();
    for (;;) {
      this.expression();
      if (this.isKw(this.peek(), 'as')) {
        this.next();
        this.assignTarget(this.starOr(() => this.bitOr()), false);
      }
      if (!this.isOp(this.peek(), ',')) break;
      this.next();
    }
    this.headerColon();
    const header = this.spanFrom(kw);
    const trailing: Comment[] = [];
    this.block(kw, trailing);
    return { ...unsupported('NA-with', header), leading: [], trailing };
  }

  /** `async def` / `async for` / `async with`: NA-async (the statement is parsed, then dropped). */
  private asyncStatement(): Stmt {
    const kw = this.next();
    const t = this.peek();
    if (!this.isKw(t, 'def') && !this.isKw(t, 'for') && !this.isKw(t, 'with')) this.unexpected(t);
    const stmt = this.compound()![0];
    return { ...unsupported('NA-async', span(kw, t)), leading: [], trailing: stmt.trailing };
  }

  /** `@decorator` lines before a def or class: NA-decorator, then the def / class itself. */
  private decorated(): Stmt[] {
    const at = this.peek();
    let end: Span = at;
    while (this.isOp(this.peek(), '@')) {
      this.next();
      this.namedExpression();
      end = this.prev;
      const newline = this.peek();
      if (newline.kind !== 'NEWLINE') this.unexpected(newline);
      this.next();
      this.takeTrailing(newline.line);
    }
    const t = this.peek();
    if (!this.isKw(t, 'def') && !this.isKw(t, 'class') && !this.isKw(t, 'async')) this.unexpected(t);
    const decorator: UnsupportedStmt = { ...unsupported('NA-decorator', span(at, end)), leading: [], trailing: [] };
    return [decorator, ...this.compound()!];
  }

  /** `match x:` / `case y:` at the start of a statement (soft keywords, §2.2). */
  private isMatchHeader(): boolean {
    let k = this.pos;
    while (this.toks[k].kind !== 'NEWLINE' && this.toks[k].kind !== 'EOF') k++;
    return k - this.pos >= 3 && this.isOp(this.toks[k - 1], ':') && !this.isOp(this.toks[this.pos + 1], '=');
  }

  /**
   * `match …:` (NA-match): the header and the whole block are skipped without parsing (case
   * patterns have a grammar of their own).
   */
  private matchStatement(): Stmt {
    const kw = this.next();
    while (this.peek(1).kind !== 'NEWLINE' && this.peek(1).kind !== 'EOF') this.next();
    this.next(); // the ':' that ends the line
    const header = this.spanFrom(kw);
    const newline = this.next();
    const trailing = this.takeTrailing(newline.line);
    if (this.peek().kind === 'INDENT') {
      let depth = 0;
      do {
        const t = this.next();
        if (t.kind === 'INDENT') depth++;
        else if (t.kind === 'DEDENT') depth--;
      } while (depth > 0 && this.peek().kind !== 'EOF');
      this.takeBefore(this.peek().line);
    }
    return { ...unsupported('NA-match', header), leading: [], trailing };
  }

  // ---- simple statements ------------------------------------------------------------

  private simple(): Stmt {
    const t = this.peek();
    if (t.kind === 'NAME') {
      switch (t.text) {
        case 'pass':
          this.next();
          return this.stmtBase('Pass', t);
        case 'break':
          this.next();
          if (this.scope.loops === 0) this.defer('S-break-outside', t);
          return this.stmtBase('Break', t);
        case 'continue':
          this.next();
          if (this.scope.loops === 0) this.defer('S-continue-outside', t);
          return this.stmtBase('Continue', t);
        case 'return':
          return this.returnStatement();
        case 'global':
        case 'nonlocal':
          return this.globalStatement();
        case 'import':
          return this.importStatement();
        case 'from':
          return this.importFrom();
        case 'raise':
          return this.raiseStatement();
        case 'assert':
          return this.assertStatement();
        case 'del':
          return this.delStatement();
        case 'yield': {
          const value = this.yieldExpression();
          return { type: 'ExprStmt', value, leading: [], trailing: [], ...this.spanFrom(t) };
        }
        default:
          if (this.isKeyword(t) && !EXPRESSION_KEYWORDS.has(t.text)) this.unexpected(t);
      }
    }
    if (this.isOp(t, '@')) this.unexpected(t);
    return this.assignmentOrExpression();
  }

  private returnStatement(): Stmt {
    const kw = this.next();
    let value: Expr | null = null;
    if (this.peek().kind !== 'NEWLINE' && !this.isOp(this.peek(), ';')) value = this.starExpressions();
    const node = { type: 'Return' as const, value, leading: [], trailing: [], ...this.spanFrom(kw) };
    if (this.scope.kind !== 'function') this.defer('S-return-outside', node);
    return node;
  }

  private globalStatement(): Stmt {
    const kw = this.next();
    const names: Identifier[] = [this.identifier()];
    while (this.isOp(this.peek(), ',')) {
      this.next();
      names.push(this.identifier());
    }
    const at = this.spanFrom(kw);
    if (kw.text === 'nonlocal') return { ...unsupported('NA-nonlocal', at), leading: [], trailing: [] };
    for (const n of names) if (this.scope.seen.has(n.name)) this.defer('S-global-after-use', at, { x: n.name });
    return { type: 'Global', names, leading: [], trailing: [], ...at };
  }

  /** A module name: NAME ('.' NAME)* (dots are refused later: E-module). */
  private dottedName(): Identifier {
    const first = this.identifier();
    let name = first.name;
    while (this.isOp(this.peek(), '.')) {
      this.next();
      name += '.' + this.identifier().name;
    }
    return { name, ...this.spanFrom(first) };
  }

  private importStatement(): Stmt {
    const kw = this.next();
    const names: ImportAlias[] = [];
    do {
      if (names.length > 0) this.next();
      const module = this.dottedName();
      let asname: Identifier | null = null;
      if (this.isKw(this.peek(), 'as')) {
        this.next();
        asname = this.identifier();
      }
      this.see(asname?.name ?? module.name.split('.')[0]);
      names.push({ name: module.name, asname, ...this.spanFrom(module) });
    } while (this.isOp(this.peek(), ','));
    return { type: 'Import', names, leading: [], trailing: [], ...this.spanFrom(kw) };
  }

  private importFrom(): Stmt {
    const kw = this.next();
    const start = this.peek();
    let dots = '';
    while (this.isOp(this.peek(), '.') || this.isOp(this.peek(), '...')) dots += this.next().text;
    let name = dots;
    if (!(dots !== '' && this.isKw(this.peek(), 'import'))) name += this.dottedName().name;
    const module: Identifier = { name, ...this.spanFrom(start) };
    this.expectKw('import');
    const names: ImportAlias[] = [];
    let star = false;
    if (this.isOp(this.peek(), '*')) {
      this.next();
      star = true;
    } else {
      const parenthesized = this.isOp(this.peek(), '(');
      if (parenthesized) this.next();
      for (;;) {
        const n = this.identifier();
        let asname: Identifier | null = null;
        if (this.isKw(this.peek(), 'as')) {
          this.next();
          asname = this.identifier();
        }
        this.see((asname ?? n).name);
        names.push({ name: n.name, asname, ...this.spanFrom(n) });
        if (!this.isOp(this.peek(), ',')) break;
        this.next();
        if (parenthesized && this.isOp(this.peek(), ')')) break;
        if (!parenthesized && (this.peek().kind === 'NEWLINE' || this.isOp(this.peek(), ';'))) this.unexpected(); // trailing comma needs brackets
      }
      if (parenthesized) this.expectOp(')');
    }
    return { type: 'ImportFrom', module, star, names, leading: [], trailing: [], ...this.spanFrom(kw) };
  }

  private raiseStatement(): Stmt {
    const kw = this.next();
    if (this.peek().kind === 'NEWLINE' || this.isOp(this.peek(), ';')) {
      return { ...unsupported('NA-raise', span(kw, kw)), leading: [], trailing: [] };
    }
    const exc = this.expression();
    let cause: Expr | null = null;
    if (this.isKw(this.peek(), 'from')) {
      this.next();
      cause = this.expression();
    }
    return { type: 'Raise', exc, cause, leading: [], trailing: [], ...this.spanFrom(kw) };
  }

  private assertStatement(): Stmt {
    const kw = this.next();
    const test = this.expression();
    let msg: Expr | null = null;
    if (this.isOp(this.peek(), ',')) {
      this.next();
      msg = this.expression();
    }
    return { type: 'Assert', test, msg, leading: [], trailing: [], ...this.spanFrom(kw) };
  }

  private delStatement(): Stmt {
    const kw = this.next();
    const targets = this.starExpressions();
    for (const t of targets.type === 'TupleLit' && !targets.parenthesized ? targets.elts : [targets]) this.assignTarget(t, false);
    return { ...unsupported('NA-del', this.spanFrom(kw)), leading: [], trailing: [] };
  }

  /** Assignments (`=`, chained, augmented, annotated) and expression statements. */
  private assignmentOrExpression(): Stmt {
    const start = this.peek();
    const first = this.starExpressions();
    const t = this.peek();
    if (this.isOp(t, ':') && (first.type === 'Name' || first.type === 'Attribute' || first.type === 'Subscript')) {
      const colon = this.next();
      this.expression();
      const annotation = this.textFrom(colon);
      const at = this.spanFrom(colon);
      if (this.isOp(this.peek(), '=')) {
        this.next();
        this.isKw(this.peek(), 'yield') ? this.yieldExpression() : this.starExpressions();
      }
      return { ...unsupported('NA-annotation', at, { annotation }), leading: [], trailing: [] };
    }
    if (t.kind === 'OP' && AUG_OPS.has(t.text)) {
      const target = this.augTarget(first);
      this.next();
      const value = this.isKw(this.peek(), 'yield') ? this.yieldExpression() : this.starExpressions();
      if (t.text === '@=') return { ...unsupported('NA-matmul', this.spanFrom(start)), leading: [], trailing: [] };
      return { type: 'AugAssign', target, op: t.text.slice(0, -1) as AugOp, value, leading: [], trailing: [], ...this.spanFrom(start) };
    }
    if (this.isOp(t, '=')) {
      const sides: Expr[] = [first];
      while (this.isOp(this.peek(), '=')) {
        this.next();
        sides.push(this.isKw(this.peek(), 'yield') ? this.yieldExpression() : this.starExpressions());
      }
      const value = sides.pop()!;
      const targets = sides.map((s) => this.assignTarget(s, true));
      return { type: 'Assign', targets, value, leading: [], trailing: [], ...this.spanFrom(start) };
    }
    return { type: 'ExprStmt', value: first, leading: [], trailing: [], ...this.spanFrom(start) };
  }

  /**
   * What stands left of '=' (or after `for` / `del` / `as`): a name, subscript, attribute or a
   * tuple of them; other targets Python allows are NA-unpack; anything else is S-cannot-assign.
   */
  private assignTarget(e: Expr, top: boolean): AssignTarget {
    switch (e.type) {
      case 'Name':
      case 'Subscript':
      case 'Attribute':
        return e;
      case 'TupleLit':
      case 'ListLit': {
        const elts = e.elts.map((x) => this.assignTarget(x, false));
        const plain = elts.filter((x): x is Name | Subscript | Attribute => x.type === 'Name' || x.type === 'Subscript' || x.type === 'Attribute');
        if (e.type === 'TupleLit' && top && plain.length === elts.length && elts.length > 0) return { type: 'TupleTarget', elts: plain, ...spanOf(e) };
        return unsupported('NA-unpack', e);
      }
      case 'Unsupported':
        if (e.code === 'NA-slice') return e;
        if (e.code === 'NA-star-args') return unsupported('NA-unpack', e);
        return this.fail('S-cannot-assign', e, { what: UNSUPPORTED_TARGET_WORDS[e.code] ?? 'expression' });
      default:
        return this.fail('S-cannot-assign', e, { what: targetWord(e) });
    }
  }

  private augTarget(e: Expr): Name | Subscript | Attribute | Unsupported {
    if (e.type === 'Name' || e.type === 'Subscript' || e.type === 'Attribute') return e;
    if (e.type === 'Unsupported' && e.code === 'NA-slice') return e;
    const what =
      e.type === 'TupleLit' ? 'tuple' : e.type === 'ListLit' ? 'list' : e.type === 'Unsupported' ? UNSUPPORTED_TARGET_WORDS[e.code] ?? 'expression' : targetWord(e);
    return this.fail('S-cannot-assign', e, { what });
  }

  // ---- expressions ----------------------------------------------------------------

  /** `a, b, c` (a TupleLit without brackets when there is a comma); `*x` items are NA-star-args. */
  private starExpressions(): Expr {
    const start = this.peek();
    const first = this.starOr(() => this.expression());
    if (!this.isOp(this.peek(), ',')) return first;
    const elts = [first];
    while (this.isOp(this.peek(), ',')) {
      this.next();
      if (!this.startsExpression(this.peek())) break;
      elts.push(this.starOr(() => this.expression()));
    }
    return { type: 'TupleLit', elts, parenthesized: false, ...this.spanFrom(start) };
  }

  /** `*x` (NA-star-args) or the item parsed by `item`. */
  private starOr(item: () => Expr): Expr {
    const t = this.peek();
    if (!this.isOp(t, '*')) return item();
    this.next();
    this.bitOr();
    return unsupported('NA-star-args', this.spanFrom(t));
  }

  /** An expression that may be `name := value` (NA-walrus): conditions, arguments, items. */
  private namedExpression(): Expr {
    const t = this.peek();
    if (t.kind === 'NAME' && !this.isKeyword(t) && this.isOp(this.peek(1), ':=')) {
      this.next();
      this.see(t.text.normalize('NFKC'));
      this.next();
      this.expression();
      return unsupported('NA-walrus', this.spanFrom(t));
    }
    return this.expression();
  }

  /** expr := disjunction ['if' disjunction 'else' expr] | lambda. */
  private expression(): Expr {
    const start = this.peek();
    if (this.isKw(start, 'lambda')) return this.lambda();
    const body = this.disjunction();
    if (!this.isKw(this.peek(), 'if')) return body;
    this.next();
    const test = this.disjunction();
    if (!this.isKw(this.peek(), 'else')) this.unexpected(); // expected 'else' after 'if' expression
    this.next();
    const orelse = this.expression();
    return { type: 'IfExp', test, body, orelse, ...this.spanFrom(start) };
  }

  private lambda(): Expr {
    const kw = this.next();
    this.parameters(':');
    this.expectOp(':');
    this.expression();
    return unsupported('NA-lambda', this.spanFrom(kw));
  }

  private yieldExpression(): Expr {
    const kw = this.next();
    if (this.isKw(this.peek(), 'from')) {
      this.next();
      this.expression();
    } else if (this.startsExpression(this.peek())) {
      this.starExpressions();
    }
    return unsupported('NA-generator', this.spanFrom(kw));
  }

  private disjunction(): Expr {
    const start = this.peek();
    const first = this.conjunction();
    if (!this.isKw(this.peek(), 'or')) return first;
    const values = [first];
    while (this.isKw(this.peek(), 'or')) {
      this.next();
      values.push(this.conjunction());
    }
    return { type: 'BoolOp', op: 'or', values, ...this.spanFrom(start) };
  }

  private conjunction(): Expr {
    const start = this.peek();
    const first = this.inversion();
    if (!this.isKw(this.peek(), 'and')) return first;
    const values = [first];
    while (this.isKw(this.peek(), 'and')) {
      this.next();
      values.push(this.inversion());
    }
    return { type: 'BoolOp', op: 'and', values, ...this.spanFrom(start) };
  }

  private inversion(): Expr {
    const t = this.peek();
    if (!this.isKw(t, 'not')) return this.comparison();
    this.next();
    const operand = this.inversion();
    return { type: 'UnaryOp', op: 'not', operand, ...this.spanFrom(t) };
  }

  private comparison(): Expr {
    const start = this.peek();
    const left = this.bitOr();
    const ops: CompareOp[] = [];
    const comparators: Expr[] = [];
    let isOp = false;
    let withNone = left.type === 'NoneLit';
    for (;;) {
      const t = this.peek();
      if (t.kind === 'OP' && COMPARE_OPS.has(t.text)) {
        this.next();
        ops.push(t.text as CompareOp);
      } else if (this.isKw(t, 'in')) {
        this.next();
        ops.push('in');
      } else if (this.isKw(t, 'not') && this.isKw(this.peek(1), 'in')) {
        this.next();
        this.next();
        ops.push('not in');
      } else if (this.isKw(t, 'is')) {
        this.next();
        if (this.isKw(this.peek(), 'not')) this.next();
        isOp = true;
        ops.push('==');
      } else {
        break;
      }
      const right = this.bitOr();
      if (right.type === 'NoneLit') withNone = true;
      comparators.push(right);
    }
    if (ops.length === 0) return left;
    // `x is None` is NA-none (its message says what to use instead); other `is` comparisons NA-is.
    if (isOp) return unsupported(withNone ? 'NA-none' : 'NA-is', this.spanFrom(start));
    return { type: 'Compare', left, ops, comparators, ...this.spanFrom(start) };
  }

  /** bitor … term: the binary operators, by precedence climbing (§2.3). */
  private bitOr(): Expr {
    return this.binary(1);
  }

  /** Left-associative binary operators that bind at least as tightly as `minPrecedence`. */
  private binary(minPrecedence: number): Expr {
    const start = this.peek();
    let left = this.factor();
    for (;;) {
      const t = this.peek();
      const precedence = t.kind === 'OP' ? BINARY_PRECEDENCE[t.text] : undefined;
      if (precedence === undefined || precedence < minPrecedence) return left;
      this.next();
      const right = this.binary(precedence + 1);
      const at = this.spanFrom(start);
      if (t.text === '@') left = unsupported('NA-matmul', at);
      else if (t.text === '*' && (left.type === 'ListLit' || right.type === 'ListLit')) {
        left = left.type === 'ListLit' ? { type: 'ListRepeat', list: left, count: right, ...at } : { type: 'ListRepeat', list: right as ListLit, count: left, ...at };
      } else left = { type: 'BinOp', op: t.text as BinaryOp, left, right, ...at };
    }
  }

  private factor(): Expr {
    const t = this.peek();
    if (t.kind === 'OP' && (t.text === '-' || t.text === '+' || t.text === '~')) {
      this.next();
      const operand = this.factor();
      return { type: 'UnaryOp', op: t.text, operand, ...this.spanFrom(t) };
    }
    return this.power();
  }

  /** power := ['await'] primary ['**' factor] (right-associative through factor). */
  private power(): Expr {
    const start = this.peek();
    let base: Expr;
    if (this.isKw(start, 'await')) {
      this.next();
      this.primary();
      base = unsupported('NA-async', this.spanFrom(start));
    } else {
      base = this.primary();
    }
    if (!this.isOp(this.peek(), '**')) return base;
    this.next();
    const exponent = this.factor();
    return { type: 'BinOp', op: '**', left: base, right: exponent, ...this.spanFrom(start) };
  }

  /** atom followed by calls, subscripts and attributes. */
  private primary(): Expr {
    const start = this.peek();
    let e = this.atom();
    for (;;) {
      const t = this.peek();
      if (this.isOp(t, '.')) {
        this.next();
        const attr = this.identifier();
        e = { type: 'Attribute', value: e, attr, ...this.spanFrom(start) };
      } else if (this.isOp(t, '(')) {
        this.next();
        const { args, keywords } = this.callArguments();
        e = { type: 'Call', func: e, args, keywords, ...this.spanFrom(start) };
      } else if (this.isOp(t, '[')) {
        e = this.subscript(e, start);
      } else {
        return e;
      }
    }
  }

  /** The arguments after a '(' up to and including the ')'. */
  private callArguments(): { args: Expr[]; keywords: Keyword[] } {
    this.bracketDepth++;
    const args: Expr[] = [];
    const keywords: Keyword[] = [];
    const names = new Set<string>();
    let afterKeyword = false;
    while (!this.isOp(this.peek(), ')')) {
      const t = this.peek();
      if (this.isOp(t, '*') || this.isOp(t, '**')) {
        this.next();
        this.expression();
        args.push(unsupported('NA-star-args', this.spanFrom(t)));
        if (t.text === '**') afterKeyword = true;
      } else if (t.kind === 'NAME' && !this.isKeyword(t) && this.isOp(this.peek(1), '=')) {
        const name = this.identifier();
        this.next();
        const value = this.expression();
        const kw: Keyword = { name, value, ...this.spanFrom(name) };
        if (names.has(name.name)) this.defer('S-keyword-repeated', kw, { a: name.name });
        names.add(name.name);
        keywords.push(kw);
        afterKeyword = true;
      } else {
        let value = this.namedExpression();
        if (this.isKw(this.peek(), 'for') || this.isKw(this.peek(), 'async')) value = this.comprehension(t);
        if (afterKeyword) this.fail('S-positional-after-keyword', value);
        args.push(value);
        this.afterItem(t);
      }
      if (!this.isOp(this.peek(), ',')) break;
      this.next();
    }
    this.closeBracket(')');
    return { args, keywords };
  }

  /** `value[index]`; a slice anywhere in the index makes it NA-slice. */
  private subscript(value: Expr, start: Token): Expr {
    this.next(); // '['
    this.bracketDepth++;
    const indexStart = this.peek();
    const items: Expr[] = [];
    let slice = false;
    for (;;) {
      const itemStart = this.peek();
      let item: Expr | null = null;
      if (!this.isOp(itemStart, ':')) item = this.starOr(() => this.namedExpression());
      if (this.isOp(this.peek(), ':')) {
        slice = true;
        this.next();
        if (!this.isOp(this.peek(), ':') && !this.isOp(this.peek(), ']') && !this.isOp(this.peek(), ',')) this.expression();
        if (this.isOp(this.peek(), ':')) {
          this.next();
          if (!this.isOp(this.peek(), ']') && !this.isOp(this.peek(), ',')) this.expression();
        }
      } else if (item) {
        this.afterItem(itemStart);
        items.push(item);
      }
      if (!this.isOp(this.peek(), ',')) break;
      this.next();
      if (this.isOp(this.peek(), ']')) break;
    }
    const indexEnd = this.prev;
    this.closeBracket(']');
    if (slice) return unsupported('NA-slice', this.spanFrom(start));
    const index: Expr = items.length === 1 && !this.isOp(this.toks[this.pos - 2], ',') ? items[0] : { type: 'TupleLit', elts: items, parenthesized: false, ...span(indexStart, indexEnd) };
    return { type: 'Subscript', value, index, ...this.spanFrom(start) };
  }

  /**
   * After an item inside brackets: `=` there is S-assign-in-if (`[x = 1]`, `f(a.b = 1)`), and a
   * second expression right after the first is S-comma (§5.1).
   */
  private afterItem(start: Token): void {
    const t = this.peek();
    if (this.isOp(t, '=')) this.assignInCondition(start);
    if (this.bracketDepth > 0 && this.startsExpression(t) && !(t.kind === 'OP' && ['-', '+', '~', '*', '('].includes(t.text))) {
      try {
        this.expression();
      } catch {
        /* the underline then ends where the second expression stopped parsing */
      }
      this.fail('S-comma', span(start, this.prev));
    }
  }

  /** The closing bracket of a display / call / subscript. */
  private closeBracket(close: string): void {
    this.bracketDepth--;
    this.expectOp(close);
  }

  private atom(): Expr {
    const t = this.peek();
    switch (t.kind) {
      case 'NAME': {
        if (t.text === 'True' || t.text === 'False') {
          this.next();
          return { type: 'Bool', value: t.text === 'True', ...span(t, t) };
        }
        if (t.text === 'None') {
          this.next();
          return { type: 'NoneLit', ...span(t, t) };
        }
        if (this.isKeyword(t)) this.unexpected(t);
        this.next();
        const id = t.text.normalize('NFKC');
        this.see(id);
        return { type: 'Name', id, ...span(t, t) };
      }
      case 'NUMBER': {
        this.next();
        const n = t.number!;
        if (n.imaginary) return unsupported('NA-complex', t);
        return { type: 'Num', value: n.value, isFloat: n.isFloat, raw: t.text, base: n.base, ...span(t, t) };
      }
      case 'STRING':
      case 'FSTRING':
        return this.strings();
      case 'OP':
        if (t.text === '(') return this.parenthesized();
        if (t.text === '[') return this.list();
        if (t.text === '{') return this.dictOrSet();
        if (t.text === '...') {
          this.next();
          return unsupported('NA-ellipsis', t);
        }
        return this.unexpected(t);
      default:
        return this.unexpected(t);
    }
  }

  /** `( … )`: a parenthesised expression, a tuple, a generator (NA-comprehension) or `(yield)`. */
  private parenthesized(): Expr {
    const open = this.next();
    this.bracketDepth++;
    if (this.isOp(this.peek(), ')')) {
      this.closeBracket(')');
      return { type: 'TupleLit', elts: [], parenthesized: true, ...this.spanFrom(open) };
    }
    if (this.isKw(this.peek(), 'yield')) {
      const y = this.yieldExpression();
      this.closeBracket(')');
      return y;
    }
    const itemStart = this.peek();
    const first = this.starOr(() => this.namedExpression());
    if (this.isKw(this.peek(), 'for') || this.isKw(this.peek(), 'async')) {
      this.comprehension(itemStart);
      this.closeBracket(')');
      return unsupported('NA-comprehension', this.spanFrom(open));
    }
    if (!this.isOp(this.peek(), ',')) {
      this.afterItem(itemStart);
      this.closeBracket(')');
      return first;
    }
    const elts = [first];
    while (this.isOp(this.peek(), ',')) {
      this.next();
      if (this.isOp(this.peek(), ')')) break;
      const s = this.peek();
      const item = this.starOr(() => this.namedExpression());
      this.afterItem(s);
      elts.push(item);
    }
    this.closeBracket(')');
    return { type: 'TupleLit', elts, parenthesized: true, ...this.spanFrom(open) };
  }

  private list(): Expr {
    const open = this.next();
    this.bracketDepth++;
    const elts: Expr[] = [];
    while (!this.isOp(this.peek(), ']')) {
      const s = this.peek();
      const item = this.starOr(() => this.namedExpression());
      if (elts.length === 0 && (this.isKw(this.peek(), 'for') || this.isKw(this.peek(), 'async'))) {
        this.comprehension(s);
        this.closeBracket(']');
        return unsupported('NA-comprehension', this.spanFrom(open));
      }
      this.afterItem(s);
      elts.push(item);
      if (!this.isOp(this.peek(), ',')) break;
      this.next();
    }
    this.closeBracket(']');
    return { type: 'ListLit', elts, ...this.spanFrom(open) };
  }

  /** `{…}`: a dict or set display or comprehension — NA-dict / NA-comprehension. */
  private dictOrSet(): Expr {
    const open = this.next();
    this.bracketDepth++;
    let first = true;
    while (!this.isOp(this.peek(), '}')) {
      const s = this.peek();
      if (this.isOp(s, '**')) {
        this.next();
        this.bitOr();
      } else {
        this.starOr(() => this.namedExpression());
        if (this.isOp(this.peek(), ':')) {
          this.next();
          this.expression();
        }
        if (first && (this.isKw(this.peek(), 'for') || this.isKw(this.peek(), 'async'))) {
          this.comprehension(s);
          this.closeBracket('}');
          return unsupported('NA-comprehension', this.spanFrom(open));
        }
        this.afterItem(s);
      }
      first = false;
      if (!this.isOp(this.peek(), ',')) break;
      this.next();
    }
    this.closeBracket('}');
    return unsupported('NA-dict', this.spanFrom(open));
  }

  /** The `for … in … [if …]` clauses after the element of a comprehension (NA-comprehension). */
  private comprehension(start: Token): Expr {
    while (this.isKw(this.peek(), 'for') || this.isKw(this.peek(), 'async')) {
      if (this.isKw(this.peek(), 'async')) this.next();
      this.expectKw('for');
      for (const t of this.targetList()) this.assignTarget(t, false);
      this.expectKw('in');
      this.disjunction();
      while (this.isKw(this.peek(), 'if')) {
        this.next();
        this.disjunction();
      }
    }
    return unsupported('NA-comprehension', this.spanFrom(start));
  }

  /** Adjacent string literals (`"ab" "cd"`, also with f-strings), concatenated. */
  private strings(): Expr {
    const start = this.peek();
    const toks: Token[] = [];
    while (this.peek().kind === 'STRING' || this.peek().kind === 'FSTRING') toks.push(this.next());
    const at = this.spanFrom(start);
    if (toks.some((t) => t.string?.bytes)) return unsupported('NA-bytes', at);
    if (toks.every((t) => t.kind === 'STRING')) {
      const parts: StrPart[] = toks.map((t) => ({ value: t.string!.value, prefix: t.string!.prefix, escapes: t.string!.escapes, ...span(t, t) }));
      const node: Str = { type: 'Str', value: parts.map((p) => p.value).join(''), parts, ...at };
      return node;
    }
    const parts: Array<FStringText | FStringField> = [];
    const addText = (value: string, escapes: EscapeNote[], where: Span) => {
      const last = parts[parts.length - 1];
      if (last && last.type === 'text') {
        last.value += value;
        last.escapes.push(...escapes);
        Object.assign(last, span(last, where));
      } else {
        parts.push({ type: 'text', value, escapes: [...escapes], ...spanOf(where) });
      }
    };
    for (const t of toks) {
      if (t.kind === 'STRING') {
        addText(t.string!.value, t.string!.escapes, t);
        continue;
      }
      for (const part of t.fstring!.parts) {
        if (part.type === 'text') addText(part.value, part.escapes, part);
        else parts.push(this.field(part));
      }
    }
    const node: FString = { type: 'FString', parts, ...at };
    return node;
  }

  /** One `{…}` field of an f-string: its expression is parsed from its own tokens (§2.2). */
  private field(part: FStringFieldPart): FStringField {
    const saved = { toks: this.toks, pos: this.pos, prev: this.prev };
    this.toks = part.tokens;
    this.pos = 0;
    this.bracketDepth++;
    try {
      const start = this.peek();
      const value = this.isKw(start, 'yield') ? this.yieldExpression() : this.starExpressions();
      if (this.peek().kind !== 'EOF') {
        this.afterItem(start);
        this.unexpected();
      }
      const spec = part.spec ? { text: part.spec.text, ...spanOf(part.spec) } : null;
      const notSupported = part.unsupported ? unsupported('NA-fstring-spec', part.unsupported, { spec: part.unsupported.text }) : null;
      return { type: 'field', value, spec, unsupported: notSupported, ...spanOf(part) };
    } finally {
      this.bracketDepth--;
      this.toks = saved.toks;
      this.pos = saved.pos;
      this.prev = saved.prev;
    }
  }

  /** The source text from token `start` to the last token consumed (spaces kept on one line). */
  private textFrom(start: Token): string {
    const from = this.toks.indexOf(start);
    const to = this.toks.indexOf(this.prev);
    let text = '';
    for (let k = from; k <= to; k++) {
      const t = this.toks[k];
      if (k > from) {
        const before = this.toks[k - 1];
        text += before.endLine === t.line ? ' '.repeat(Math.max(0, t.column - before.endColumn)) : ' ';
      }
      text += t.text;
    }
    return text;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function span(start: Span, end: Span): Span {
  return { line: start.line, column: start.column, endLine: end.endLine, endColumn: end.endColumn };
}

function spanOf(s: Span): Span {
  return { line: s.line, column: s.column, endLine: s.endLine, endColumn: s.endColumn };
}

function unsupported(code: MessageCode, at: Span, params: Record<string, string> = {}): Unsupported {
  return { type: 'Unsupported', code, params, ...spanOf(at) };
}

/** CPython's name for what cannot stand left of '=' (S-cannot-assign). */
function targetWord(e: Expr): string {
  switch (e.type) {
    case 'Call':
      return 'function call';
    case 'Num':
    case 'Str':
      return 'literal';
    case 'FString':
      return 'f-string expression';
    case 'Bool':
      return e.value ? 'True' : 'False';
    case 'NoneLit':
      return 'None';
    case 'Compare':
      return 'comparison';
    case 'IfExp':
      return 'conditional expression';
    default:
      return 'expression';
  }
}

/** Removes a docstring (a first statement that is only a string) from a block and returns it. */
function takeDocstring(block: Block): Str | null {
  const first = block.stmts[0];
  if (!first || first.type !== 'ExprStmt' || first.value.type !== 'Str') return null;
  block.stmts.shift();
  const comments = [...first.leading, ...first.trailing];
  const next: StmtBase | undefined = block.stmts[0];
  if (next) next.leading.unshift(...comments);
  else block.endComments.unshift(...comments);
  return first.value;
}

/** The end-of-line comments of an `else:` / `except:` header go before the first statement of its block. */
function withHeaderComments(block: Block, comments: Comment[]): Block {
  if (comments.length === 0) return block;
  const first = block.stmts[0];
  if (first) first.leading.unshift(...comments);
  else block.endComments.unshift(...comments);
  return block;
}
