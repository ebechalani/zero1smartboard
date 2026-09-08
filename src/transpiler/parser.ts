/**
 * Recursive-descent parser for the Arduino C++ subset (docs/ARCHITECTURE.md §4.2–4.3).
 * Produces the AST described in ./ast.ts. Throws ParseError with a 1-based position.
 */
import type {
  AssignOp,
  BinaryOp,
  Block,
  Declarator,
  DefineDirective,
  EnumDecl,
  EnumMember,
  Expression,
  ForStmt,
  FunctionDecl,
  IncludeDirective,
  InitializerList,
  Param,
  Pos,
  Program,
  Statement,
  SwitchCase,
  TopLevel,
  TypeSpec,
  VarDecl,
} from './ast';
import { PRIMITIVE_TYPES, QUALIFIER_KEYWORDS, TYPE_ALIASES, TYPE_KEYWORDS } from './ast';
import { ParseError, tokenize, type Token } from './lexer';

export { ParseError };

const ASSIGN_OPS: ReadonlySet<string> = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=']);

/** Binary operator precedence (higher binds tighter). */
const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6,
  '!=': 6,
  '<': 7,
  '>': 7,
  '<=': 7,
  '>=': 7,
  '<<': 8,
  '>>': 8,
  '+': 9,
  '-': 9,
  '*': 10,
  '/': 10,
  '%': 10,
};

/** Keywords that may be used as functional casts: `int(x)`, `byte(x)`. */
const FUNCTIONAL_CAST_KEYWORDS: ReadonlySet<string> = new Set([
  'int',
  'long',
  'float',
  'double',
  'char',
  'byte',
  'word',
  'bool',
  'boolean',
  'short',
  'unsigned',
  'uint8_t',
  'int8_t',
  'uint16_t',
  'int16_t',
  'uint32_t',
  'int32_t',
]);

const UNSUPPORTED_KEYWORD_MESSAGES: Readonly<Record<string, string>> = {
  struct: "'struct' is not supported by the simulator; use separate variables or arrays instead",
  class: "'class' definitions are not supported by the simulator",
  union: "'union' is not supported by the simulator",
  typedef: "'typedef' is not supported by the simulator; use the type directly",
  template: 'templates are not supported by the simulator',
  typename: 'templates are not supported by the simulator',
  namespace: "'namespace' is not supported by the simulator",
  using: "'using' is not supported by the simulator",
  goto: "'goto' is not supported; use loops and functions instead",
  new: "'new' is not supported by the simulator; declare variables and arrays directly",
  delete: "'delete' is not supported by the simulator",
  this: "'this' is not supported by the simulator",
  public: "'public' is not supported by the simulator",
  private: "'private' is not supported by the simulator",
  protected: "'protected' is not supported by the simulator",
  virtual: "'virtual' is not supported by the simulator",
  operator: 'operator overloading is not supported by the simulator',
  auto: "'auto' is not supported; write the type (int, float, String...)",
  friend: "'friend' is not supported by the simulator",
  throw: 'exceptions are not supported on Arduino',
  try: 'exceptions are not supported on Arduino',
  catch: 'exceptions are not supported on Arduino',
};

class Parser {
  private i = 0;

  constructor(private readonly tokens: Token[]) {}

  // ---------------------------------------------------------------------------
  // token helpers
  // ---------------------------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const t = this.peek();
    if (t.type !== 'eof') this.i++;
    return t;
  }

  private pos(t: Token = this.peek()): Pos {
    return { line: t.line, column: t.column };
  }

  private isPunct(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.type === 'punct' && t.value === value;
  }

  private isKeyword(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.type === 'keyword' && t.value === value;
  }

  private describe(t: Token): string {
    if (t.type === 'eof') return 'end of input';
    if (t.type === 'string') return `"${t.value}"`;
    if (t.type === 'directive') return `'${t.value.split(/\s/)[0]}'`;
    return `'${t.value}'`;
  }

  private error(message: string, t: Token = this.peek()): ParseError {
    return new ParseError(message, t.line, t.column);
  }

  private expectPunct(value: string): Token {
    if (!this.isPunct(value)) {
      const t = this.peek();
      throw this.error(`expected '${value}' before ${this.describe(t)}`, t);
    }
    return this.next();
  }

  private expectIdent(what = 'identifier'): Token {
    const t = this.peek();
    if (t.type === 'keyword') {
      const unsupported = UNSUPPORTED_KEYWORD_MESSAGES[t.value];
      if (unsupported) throw this.error(unsupported, t);
    }
    if (t.type !== 'ident') throw this.error(`expected ${what} before ${this.describe(t)}`, t);
    return this.next();
  }

  private isTypeKeyword(t: Token = this.peek()): boolean {
    return t.type === 'keyword' && TYPE_KEYWORDS.has(t.value);
  }

  private isQualifier(t: Token = this.peek()): boolean {
    return t.type === 'keyword' && QUALIFIER_KEYWORDS.has(t.value);
  }

  // ---------------------------------------------------------------------------
  // program
  // ---------------------------------------------------------------------------

  parseProgram(): Program {
    const pos = this.pos();
    const body: TopLevel[] = [];
    while (this.peek().type !== 'eof') {
      const t = this.peek();
      if (t.type === 'directive') {
        const d = this.parseDirective(this.next());
        if (d) body.push(d);
        continue;
      }
      if (this.isPunct(';')) {
        this.next();
        continue;
      }
      if (this.isPunct('}')) throw this.error("unexpected '}' (there is one closing brace too many)");
      if (this.isKeyword('enum')) {
        body.push(this.parseEnum());
        continue;
      }
      this.checkUnsupportedKeyword();
      if (!this.isDeclarationStart()) {
        throw this.error(
          `expected a declaration before ${this.describe(t)} (code must be inside a function such as setup() or loop())`,
        );
      }
      body.push(this.parseTopLevelDeclaration());
    }
    return { kind: 'Program', pos, body };
  }

  private checkUnsupportedKeyword(): void {
    const t = this.peek();
    if (t.type !== 'keyword') return;
    const message = UNSUPPORTED_KEYWORD_MESSAGES[t.value];
    if (message) throw this.error(message, t);
  }

  private parseDirective(t: Token): IncludeDirective | DefineDirective | null {
    const pos = this.pos(t);
    const text = t.value;
    const m = /^#\s*([A-Za-z_]+)\s*(.*)$/s.exec(text);
    if (!m) throw this.error('malformed preprocessor directive', t);
    const name = m[1]!;
    const rest = (m[2] ?? '').trim();
    switch (name) {
      case 'include': {
        const inc = /^(<([^>]*)>|"([^"]*)")/.exec(rest);
        if (!inc) throw this.error('#include expects <file.h> or "file.h"', t);
        return { kind: 'Include', pos, path: inc[2] ?? inc[3] ?? '', system: inc[1]!.startsWith('<') };
      }
      case 'define': {
        const dm = /^([A-Za-z_][A-Za-z0-9_]*)(\(?)\s*(.*)$/s.exec(rest);
        if (!dm) throw this.error('#define expects a name', t);
        if (dm[2] === '(') {
          throw new ParseError(
            `function-like macros (#define ${dm[1]}(...)) are not supported; write a function instead`,
            t.line,
            t.column,
          );
        }
        const valueText = (dm[3] ?? '').trim();
        let value: Expression | null = null;
        if (valueText) {
          const sub = new Parser(shiftTokens(tokenize(valueText), t.line, t.column + (text.length - valueText.length)));
          value = sub.parseExpression();
          if (sub.peek().type !== 'eof') {
            throw this.error(`#define ${dm[1]}: could not understand the value '${valueText}'`, t);
          }
        }
        return { kind: 'Define', pos, name: dm[1]!, value };
      }
      case 'pragma':
      case 'undef':
      case 'line':
        return null;
      case 'if':
      case 'ifdef':
      case 'ifndef':
      case 'elif':
      case 'else':
      case 'endif':
        throw this.error(`conditional compilation (#${name}) is not supported by the simulator`, t);
      case 'error':
        throw this.error(`#error ${rest}`, t);
      default:
        throw this.error(`unknown preprocessor directive #${name}`, t);
    }
  }

  private parseEnum(): EnumDecl {
    const pos = this.pos();
    this.next(); // enum
    if (this.isKeyword('class')) throw this.error("'enum class' is not supported; use a plain 'enum'");
    let name: string | null = null;
    if (this.peek().type === 'ident') name = this.next().value;
    this.expectPunct('{');
    const members: EnumMember[] = [];
    while (!this.isPunct('}')) {
      const mt = this.expectIdent('enum member name');
      let value: Expression | null = null;
      if (this.isPunct('=')) {
        this.next();
        value = this.parseConditional();
      }
      members.push({ pos: this.pos(mt), name: mt.value, value });
      if (this.isPunct(',')) {
        this.next();
        continue;
      }
      if (!this.isPunct('}')) throw this.error(`expected ',' or '}' before ${this.describe(this.peek())}`);
    }
    this.next(); // }
    if (this.peek().type === 'ident') {
      throw this.error("declaring a variable in the enum statement is not supported; write 'enum Name {...}; Name x;'");
    }
    this.expectPunct(';');
    return { kind: 'EnumDecl', pos, name, members };
  }

  // ---------------------------------------------------------------------------
  // types & declarations
  // ---------------------------------------------------------------------------

  /**
   * Does a declaration start here? (§4.3) A type keyword / qualifier, or the
   * `Identifier Identifier` pattern for class types.
   */
  private isDeclarationStart(): boolean {
    const t = this.peek();
    if (this.isTypeKeyword(t) || this.isQualifier(t)) return true;
    if (t.type === 'ident') {
      const n = this.peek(1);
      if (n.type === 'ident') return true;
      // `Type *name` / `Type &name` for a class type: treat as declaration when followed by identifier
      if (n.type === 'punct' && (n.value === '*' || n.value === '&') && this.peek(2).type === 'ident') {
        const after = this.peek(3);
        return after.type === 'punct' && (after.value === ';' || after.value === '=' || after.value === ',' || after.value === '[' || after.value === '(' || after.value === ')');
      }
    }
    return false;
  }

  /** Parses qualifiers + base type + `*`/`&`. */
  private parseTypeSpec(): TypeSpec {
    let isConst = false;
    let isStatic = false;
    const words: string[] = [];
    let className: string | null = null;
    const start = this.peek();

    const takeQualifiers = (): void => {
      while (this.isQualifier()) {
        const q = this.next().value;
        if (q === 'const' || q === 'constexpr') isConst = true;
        if (q === 'static') isStatic = true;
      }
    };

    takeQualifiers();
    while (this.isTypeKeyword()) {
      words.push(this.next().value);
      takeQualifiers();
    }
    if (words.length === 0) {
      const t = this.peek();
      if (t.type === 'ident') {
        className = this.next().value;
        takeQualifiers();
      } else {
        this.checkUnsupportedKeyword();
        throw this.error(`expected a type before ${this.describe(t)}`, t);
      }
    }
    let pointer = 0;
    while (this.isPunct('*')) {
      this.next();
      pointer++;
      takeQualifiers();
    }
    let reference = false;
    if (this.isPunct('&')) {
      this.next();
      reference = true;
    }
    const name = className ?? normalizeTypeWords(words, start);
    return { name, isConst, isStatic, pointer, reference };
  }

  private parseTopLevelDeclaration(): VarDecl | FunctionDecl {
    const start = this.pos();
    const type = this.parseTypeSpec();
    const nameTok = this.expectIdent('a name');
    if (this.isPunct('(') && this.looksLikeParameterList()) {
      return this.parseFunctionRest(type, nameTok);
    }
    return this.parseVarDeclRest(type, nameTok, start);
  }

  /**
   * After `Type name (`: parameter list or constructor arguments? (§4.3)
   */
  private looksLikeParameterList(): boolean {
    const t = this.peek(1); // token after '('
    if (t.type === 'punct' && t.value === ')') return true;
    if (this.isTypeKeyword(t) || this.isQualifier(t)) return true;
    if (t.type === 'ident') {
      const n = this.peek(2);
      if (n.type === 'ident') return true;
      if (n.type === 'punct' && (n.value === '*' || n.value === '&' || n.value === '[')) return true;
    }
    return false;
  }

  private parseFunctionRest(returnType: TypeSpec, nameTok: Token): FunctionDecl {
    this.expectPunct('(');
    const params: Param[] = [];
    if (!this.isPunct(')')) {
      for (;;) {
        params.push(this.parseParam());
        if (this.isPunct(',')) {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expectPunct(')');
    if (this.isKeyword('const')) this.next();
    let body: Block | null = null;
    if (this.isPunct('{')) {
      body = this.parseBlock();
      if (this.isPunct(';')) this.next();
    } else if (this.isPunct(';')) {
      this.next();
    } else if (this.isPunct('=')) {
      throw this.error('default parameter values and function assignment are not supported');
    } else {
      throw this.error(`expected '{' or ';' after the function declaration, before ${this.describe(this.peek())}`);
    }
    return { kind: 'FunctionDecl', pos: this.pos(nameTok), returnType, name: nameTok.value, params, body };
  }

  private parseParam(): Param {
    const pos = this.pos();
    if (this.isKeyword('void') && this.isPunct(')', 1)) {
      this.next();
      return { pos, type: { name: 'void', isConst: false, isStatic: false, pointer: 0, reference: false }, name: null, arrayDims: [] };
    }
    const type = this.parseTypeSpec();
    let name: string | null = null;
    if (this.peek().type === 'ident') name = this.next().value;
    const arrayDims = this.parseArrayDims();
    if (this.isPunct('=')) throw this.error('default parameter values are not supported; pass the value explicitly');
    return { pos, type, name, arrayDims };
  }

  private parseArrayDims(): (Expression | null)[] {
    const dims: (Expression | null)[] = [];
    while (this.isPunct('[')) {
      this.next();
      if (this.isPunct(']')) {
        dims.push(null);
      } else {
        dims.push(this.parseConditional());
      }
      this.expectPunct(']');
    }
    return dims;
  }

  private parseVarDeclRest(type: TypeSpec, firstName: Token, start: Pos = this.pos(firstName)): VarDecl {
    const declarators: Declarator[] = [this.parseDeclaratorRest(firstName)];
    while (this.isPunct(',')) {
      this.next();
      while (this.isPunct('*')) this.next(); // `int a, *b` — pointer marker ignored (codegen rejects non-char pointers via type)
      const n = this.expectIdent('a variable name');
      declarators.push(this.parseDeclaratorRest(n));
    }
    this.expectPunct(';');
    return { kind: 'VarDecl', pos: start, type, declarators };
  }

  private parseDeclaratorRest(nameTok: Token): Declarator {
    const arrayDims = this.parseArrayDims();
    let init: Expression | InitializerList | null = null;
    let ctorArgs: Expression[] | null = null;
    if (this.isPunct('=')) {
      this.next();
      init = this.isPunct('{') ? this.parseInitializerList() : this.parseAssignment();
    } else if (this.isPunct('(')) {
      this.next();
      ctorArgs = [];
      if (!this.isPunct(')')) {
        for (;;) {
          ctorArgs.push(this.parseAssignment());
          if (this.isPunct(',')) {
            this.next();
            continue;
          }
          break;
        }
      }
      this.expectPunct(')');
    } else if (this.isPunct('{')) {
      init = this.parseInitializerList();
    }
    return { pos: this.pos(nameTok), name: nameTok.value, arrayDims, init, ctorArgs };
  }

  private parseInitializerList(): InitializerList {
    const pos = this.pos();
    this.expectPunct('{');
    const elements: (Expression | InitializerList)[] = [];
    while (!this.isPunct('}')) {
      elements.push(this.isPunct('{') ? this.parseInitializerList() : this.parseAssignment());
      if (this.isPunct(',')) {
        this.next();
        continue;
      }
      if (!this.isPunct('}')) throw this.error(`expected ',' or '}' before ${this.describe(this.peek())}`);
    }
    this.next();
    return { kind: 'InitializerList', pos, elements };
  }

  // ---------------------------------------------------------------------------
  // statements
  // ---------------------------------------------------------------------------

  private parseBlock(): Block {
    const pos = this.pos();
    this.expectPunct('{');
    const body: Statement[] = [];
    while (!this.isPunct('}')) {
      if (this.peek().type === 'eof') throw this.error("expected '}' at end of input (a closing brace is missing)");
      body.push(this.parseStatement());
    }
    this.next();
    return { kind: 'Block', pos, body };
  }

  private parseStatement(): Statement {
    const t = this.peek();
    const pos = this.pos(t);
    if (t.type === 'directive') {
      throw this.error('preprocessor directives must be at the top of the sketch, outside functions', t);
    }
    if (t.type === 'punct') {
      if (t.value === '{') return this.parseBlock();
      if (t.value === ';') {
        this.next();
        return { kind: 'EmptyStmt', pos };
      }
    }
    if (t.type === 'keyword') {
      switch (t.value) {
        case 'if':
          return this.parseIf();
        case 'for':
          return this.parseFor();
        case 'while':
          return this.parseWhile();
        case 'do':
          return this.parseDoWhile();
        case 'switch':
          return this.parseSwitch();
        case 'return': {
          this.next();
          let argument: Expression | null = null;
          if (!this.isPunct(';')) argument = this.parseExpression();
          this.expectPunct(';');
          return { kind: 'ReturnStmt', pos, argument };
        }
        case 'break':
          this.next();
          this.expectPunct(';');
          return { kind: 'BreakStmt', pos };
        case 'continue':
          this.next();
          this.expectPunct(';');
          return { kind: 'ContinueStmt', pos };
        case 'else':
          throw this.error("'else' without a previous 'if'", t);
        case 'case':
        case 'default':
          throw this.error(`'${t.value}' label not inside a switch statement`, t);
        case 'enum':
          throw this.error('enum declarations must be at the top of the sketch, outside functions', t);
        default:
          this.checkUnsupportedKeyword();
      }
    }
    if (this.isDeclarationStart()) {
      const type = this.parseTypeSpec();
      const nameTok = this.expectIdent('a variable name');
      if (this.isPunct('(') && this.looksLikeParameterList()) {
        throw this.error(
          `a function cannot be defined inside another function: a '}' is probably missing before '${type.name} ${nameTok.value}'`,
          nameTok,
        );
      }
      return this.parseVarDeclRest(type, nameTok, pos);
    }
    const expr = this.parseExpression();
    this.expectPunct(';');
    return { kind: 'ExprStmt', pos, expr };
  }

  private parseParenExpression(): Expression {
    this.expectPunct('(');
    const e = this.parseExpression();
    this.expectPunct(')');
    return e;
  }

  private parseIf(): Statement {
    const pos = this.pos();
    this.next();
    const test = this.parseParenExpression();
    const consequent = this.parseStatement();
    let alternate: Statement | null = null;
    if (this.isKeyword('else')) {
      this.next();
      alternate = this.parseStatement();
    }
    return { kind: 'IfStmt', pos, test, consequent, alternate };
  }

  private parseFor(): ForStmt {
    const pos = this.pos();
    this.next();
    this.expectPunct('(');
    let init: VarDecl | Expression | null = null;
    if (!this.isPunct(';')) {
      if (this.isDeclarationStart()) {
        const start = this.pos();
        const type = this.parseTypeSpec();
        const nameTok = this.expectIdent('a variable name');
        init = this.parseVarDeclRest(type, nameTok, start); // consumes ';'
      } else {
        init = this.parseExpression();
        this.expectPunct(';');
      }
    } else {
      this.next();
    }
    let test: Expression | null = null;
    if (!this.isPunct(';')) test = this.parseExpression();
    this.expectPunct(';');
    let update: Expression | null = null;
    if (!this.isPunct(')')) update = this.parseExpression();
    this.expectPunct(')');
    const body = this.parseStatement();
    return { kind: 'ForStmt', pos, init, test, update, body };
  }

  private parseWhile(): Statement {
    const pos = this.pos();
    this.next();
    const test = this.parseParenExpression();
    const body = this.parseStatement();
    return { kind: 'WhileStmt', pos, test, body };
  }

  private parseDoWhile(): Statement {
    const pos = this.pos();
    this.next();
    const body = this.parseStatement();
    if (!this.isKeyword('while')) throw this.error(`expected 'while' after the 'do' body, before ${this.describe(this.peek())}`);
    this.next();
    const test = this.parseParenExpression();
    this.expectPunct(';');
    return { kind: 'DoWhileStmt', pos, body, test };
  }

  private parseSwitch(): Statement {
    const pos = this.pos();
    this.next();
    const discriminant = this.parseParenExpression();
    this.expectPunct('{');
    const cases: SwitchCase[] = [];
    while (!this.isPunct('}')) {
      const ct = this.peek();
      if (ct.type === 'eof') throw this.error("expected '}' at end of input (a closing brace is missing)");
      let test: Expression | null;
      if (this.isKeyword('case')) {
        this.next();
        test = this.parseConditional();
      } else if (this.isKeyword('default')) {
        this.next();
        test = null;
      } else {
        throw this.error(`expected 'case' or 'default' inside switch, before ${this.describe(ct)}`, ct);
      }
      this.expectPunct(':');
      const body: Statement[] = [];
      while (!this.isKeyword('case') && !this.isKeyword('default') && !this.isPunct('}')) {
        if (this.peek().type === 'eof') throw this.error("expected '}' at end of input (a closing brace is missing)");
        body.push(this.parseStatement());
      }
      cases.push({ pos: this.pos(ct), test, body });
    }
    this.next();
    return { kind: 'SwitchStmt', pos, discriminant, cases };
  }

  // ---------------------------------------------------------------------------
  // expressions
  // ---------------------------------------------------------------------------

  /** Comma expression. */
  parseExpression(): Expression {
    const first = this.parseAssignment();
    if (!this.isPunct(',')) return first;
    const expressions = [first];
    while (this.isPunct(',')) {
      this.next();
      expressions.push(this.parseAssignment());
    }
    return { kind: 'CommaExpr', pos: first.pos, expressions };
  }

  private parseAssignment(): Expression {
    const left = this.parseConditional();
    const t = this.peek();
    if (t.type === 'punct' && ASSIGN_OPS.has(t.value)) {
      if (left.kind !== 'Identifier' && left.kind !== 'IndexExpr' && left.kind !== 'MemberExpr') {
        throw this.error('the left side of an assignment must be a variable or an array element', t);
      }
      this.next();
      const value = this.parseAssignment();
      return { kind: 'AssignExpr', pos: left.pos, op: t.value as AssignOp, target: left, value };
    }
    return left;
  }

  private parseConditional(): Expression {
    const test = this.parseBinary(1);
    if (!this.isPunct('?')) return test;
    this.next();
    const consequent = this.parseAssignment();
    this.expectPunct(':');
    const alternate = this.parseConditional();
    return { kind: 'ConditionalExpr', pos: test.pos, test, consequent, alternate };
  }

  private parseBinary(minPrec: number): Expression {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'punct') break;
      const prec = BINARY_PRECEDENCE[t.value];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = { kind: 'BinaryExpr', pos: left.pos, op: t.value as BinaryOp, left, right };
    }
    return left;
  }

  private parseUnary(): Expression {
    const t = this.peek();
    const pos = this.pos(t);
    if (t.type === 'punct') {
      if (t.value === '-' || t.value === '+' || t.value === '!' || t.value === '~' || t.value === '&' || t.value === '*') {
        this.next();
        const argument = this.parseUnary();
        return { kind: 'UnaryExpr', pos, op: t.value, prefix: true, argument };
      }
      if (t.value === '++' || t.value === '--') {
        this.next();
        const argument = this.parseUnary();
        return { kind: 'UnaryExpr', pos, op: t.value, prefix: true, argument };
      }
      if (t.value === '(' && this.isCastStart()) {
        this.next();
        const type = this.parseTypeSpec();
        this.expectPunct(')');
        const argument = this.parseUnary();
        return { kind: 'CastExpr', pos, type, argument };
      }
    }
    if (t.type === 'keyword' && t.value === 'sizeof') {
      this.next();
      if (this.isPunct('(')) {
        if (this.isTypeKeyword(this.peek(1)) || this.isQualifier(this.peek(1))) {
          this.next();
          const type = this.parseTypeSpec();
          this.expectPunct(')');
          return { kind: 'SizeofExpr', pos, argument: type };
        }
        const argument = this.parseParenExpression();
        return { kind: 'SizeofExpr', pos, argument };
      }
      const argument = this.parseUnary();
      return { kind: 'SizeofExpr', pos, argument };
    }
    return this.parsePostfix();
  }

  /** `(int) x`, `(unsigned long) x`, `(const char*) x` … — only primitive types. */
  private isCastStart(): boolean {
    let k = 1;
    if (!this.isTypeKeyword(this.peek(k)) && !this.isQualifier(this.peek(k))) return false;
    while (this.isTypeKeyword(this.peek(k)) || this.isQualifier(this.peek(k))) k++;
    while (this.isPunct('*', k)) k++;
    return this.isPunct(')', k);
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'punct') break;
      if (t.value === '(') {
        this.next();
        const args = this.parseArguments();
        expr = { kind: 'CallExpr', pos: expr.pos, callee: expr, args };
      } else if (t.value === '[') {
        this.next();
        const index = this.parseExpression();
        this.expectPunct(']');
        expr = { kind: 'IndexExpr', pos: expr.pos, object: expr, index };
      } else if (t.value === '.' || t.value === '->') {
        this.next();
        const prop = this.expectIdent('a member name');
        expr = { kind: 'MemberExpr', pos: expr.pos, object: expr, property: prop.value, arrow: t.value === '->' };
      } else if (t.value === '++' || t.value === '--') {
        this.next();
        expr = { kind: 'UnaryExpr', pos: expr.pos, op: t.value, prefix: false, argument: expr };
      } else {
        break;
      }
    }
    return expr;
  }

  private parseArguments(): Expression[] {
    const args: Expression[] = [];
    if (this.isPunct(')')) {
      this.next();
      return args;
    }
    for (;;) {
      args.push(this.parseAssignment());
      if (this.isPunct(',')) {
        this.next();
        continue;
      }
      break;
    }
    this.expectPunct(')');
    return args;
  }

  private parsePrimary(): Expression {
    const t = this.peek();
    const pos = this.pos(t);
    switch (t.type) {
      case 'int':
        this.next();
        return { kind: 'IntLiteral', pos, value: t.num ?? 0, unsigned: !!t.unsigned, long: !!t.long };
      case 'float':
        this.next();
        return { kind: 'FloatLiteral', pos, value: t.num ?? 0 };
      case 'char':
        this.next();
        return { kind: 'CharLiteral', pos, value: t.num ?? 0 };
      case 'string': {
        this.next();
        let value = t.value;
        while (this.peek().type === 'string') value += this.next().value;
        return { kind: 'StringLiteral', pos, value };
      }
      case 'ident':
        this.next();
        return { kind: 'Identifier', pos, name: t.value };
      case 'keyword':
        if (t.value === 'true' || t.value === 'false') {
          this.next();
          return { kind: 'BoolLiteral', pos, value: t.value === 'true' };
        }
        if (t.value === 'String' && this.isPunct('(', 1)) {
          this.next();
          return { kind: 'Identifier', pos, name: 'String' };
        }
        if (FUNCTIONAL_CAST_KEYWORDS.has(t.value) && this.isPunct('(', 1)) {
          this.next();
          const type: TypeSpec = { name: normalizeTypeWords([t.value], t), isConst: false, isStatic: false, pointer: 0, reference: false };
          this.next(); // (
          const argument = this.parseExpression();
          this.expectPunct(')');
          return { kind: 'CastExpr', pos, type, argument };
        }
        this.checkUnsupportedKeyword();
        if (this.isTypeKeyword(t) || this.isQualifier(t)) {
          throw this.error(`unexpected type keyword '${t.value}' here (a declaration is not allowed at this point)`, t);
        }
        throw this.error(`unexpected keyword '${t.value}'`, t);
      case 'punct':
        if (t.value === '(') {
          this.next();
          const e = this.parseExpression();
          this.expectPunct(')');
          return e;
        }
        if (t.value === '{') throw this.error("unexpected '{' (initializer lists can only be used to initialise a variable)", t);
        throw this.error(`expected an expression before ${this.describe(t)}`, t);
      case 'directive':
        throw this.error('preprocessor directives must be at the top of the sketch, outside functions', t);
      case 'eof':
        throw this.error('unexpected end of input (a closing brace or parenthesis is probably missing)', t);
    }
  }
}

/** Reposition tokens produced from a directive's value so that errors point into the sketch. */
function shiftTokens(tokens: Token[], line: number, columnBase: number): Token[] {
  return tokens.map((t) => ({ ...t, line, column: columnBase + t.column - 1 }));
}

/** Fold `unsigned long int`, `byte`, `uint8_t` … into a canonical PrimitiveTypeName. */
function normalizeTypeWords(words: string[], at: Token): string {
  const invalid = (): ParseError => new ParseError(`invalid type '${words.join(' ')}'`, at.line, at.column);
  if (words.length === 1) {
    const w = words[0]!;
    if (PRIMITIVE_TYPES.has(w)) return w;
    const alias = TYPE_ALIASES[w];
    if (alias) return alias;
  }
  let unsigned = false;
  let signed = false;
  let short = false;
  let longs = 0;
  let intSeen = false;
  let base: string | null = null;
  for (const w of words) {
    if (w === 'unsigned') unsigned = true;
    else if (w === 'signed') signed = true;
    else if (w === 'short') short = true;
    else if (w === 'long') longs++;
    else if (w === 'int') {
      if (intSeen) throw invalid();
      intSeen = true;
    } else if (base === null) base = TYPE_ALIASES[w] ?? w;
    else throw invalid();
  }
  if (unsigned && signed) throw new ParseError("'signed' and 'unsigned' used together", at.line, at.column);
  let name: string;
  if (short) {
    if (base !== null || longs > 0) throw invalid();
    name = 'short';
  } else if (longs === 2) {
    if (base !== null) throw invalid();
    name = 'long long';
  } else if (longs === 1) {
    if (base === 'double') name = 'double';
    else if (base === null) name = 'long';
    else throw invalid();
  } else if (base === null) {
    name = 'int';
  } else {
    if (intSeen) throw invalid();
    name = base;
  }
  if (unsigned || signed) {
    const integral = name === 'char' || name === 'short' || name === 'int' || name === 'long' || name === 'long long';
    if (!integral) {
      if (unsigned && (name === 'unsigned char' || name === 'unsigned int' || name === 'unsigned long')) return name;
      throw new ParseError(`'${unsigned ? 'unsigned' : 'signed'}' cannot be applied to '${name}'`, at.line, at.column);
    }
    if (unsigned) name = `unsigned ${name}`;
  }
  if (!PRIMITIVE_TYPES.has(name)) throw invalid();
  return name;
}

/** Parse a whole sketch. Throws ParseError on the first problem. */
export function parse(source: string): Program {
  return new Parser(tokenize(source)).parseProgram();
}
