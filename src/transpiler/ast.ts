/**
 * AST for the Arduino C++ subset understood by the simulator.
 *
 * The parser (parser.ts) produces exactly these nodes; the code generator
 * (codegen.ts) consumes them. Both sides must follow the conventions documented
 * here. See docs/ARCHITECTURE.md §4 for the supported language subset.
 */

/** 1-based source position. */
export interface Pos {
  line: number;
  column: number;
}

/**
 * Normalized primitive type names. The parser folds multi-keyword specifiers
 * (`unsigned long int`) and Arduino aliases (`byte`, `uint8_t`) into these using
 * TYPE_ALIASES below. Any other TypeSpec.name is a class / enum name.
 */
export type PrimitiveTypeName =
  | 'void'
  | 'bool'
  | 'char'
  | 'unsigned char'
  | 'short'
  | 'unsigned short'
  | 'int'
  | 'unsigned int'
  | 'long'
  | 'unsigned long'
  | 'long long'
  | 'unsigned long long'
  | 'float'
  | 'double'
  | 'String';

export const PRIMITIVE_TYPES: ReadonlySet<string> = new Set<PrimitiveTypeName>([
  'void',
  'bool',
  'char',
  'unsigned char',
  'short',
  'unsigned short',
  'int',
  'unsigned int',
  'long',
  'unsigned long',
  'long long',
  'unsigned long long',
  'float',
  'double',
  'String',
]);

/**
 * Aliases the parser must normalize. Keys may be multi-word (joined by single
 * spaces, keywords in source order after sorting `signed/unsigned` first, then
 * `short/long`, then the base). The parser is expected to canonicalise the
 * keyword sequence before lookup (e.g. `long unsigned int` -> `unsigned long`).
 */
export const TYPE_ALIASES: Readonly<Record<string, PrimitiveTypeName>> = {
  byte: 'unsigned char',
  uint8_t: 'unsigned char',
  int8_t: 'char',
  boolean: 'bool',
  uint16_t: 'unsigned int',
  int16_t: 'int',
  word: 'unsigned int',
  size_t: 'unsigned int',
  uint32_t: 'unsigned long',
  int32_t: 'long',
  uint64_t: 'unsigned long long',
  int64_t: 'long long',
  unsigned: 'unsigned int',
  signed: 'int',
  'signed int': 'int',
  'signed char': 'char',
  'signed short': 'short',
  'signed long': 'long',
  'short int': 'short',
  'long int': 'long',
  'long long int': 'long long',
  'unsigned short int': 'unsigned short',
  'unsigned long int': 'unsigned long',
  'unsigned long long int': 'unsigned long long',
  'long double': 'double',
};

/** Keywords that start a type in a declaration (plus any identifier followed by an identifier). */
export const TYPE_KEYWORDS: ReadonlySet<string> = new Set([
  'void',
  'bool',
  'boolean',
  'char',
  'short',
  'int',
  'long',
  'float',
  'double',
  'unsigned',
  'signed',
  'byte',
  'word',
  'size_t',
  'uint8_t',
  'int8_t',
  'uint16_t',
  'int16_t',
  'uint32_t',
  'int32_t',
  'uint64_t',
  'int64_t',
  'String',
]);

/** Qualifiers the parser accepts and records/ignores. */
export const QUALIFIER_KEYWORDS: ReadonlySet<string> = new Set([
  'const',
  'static',
  'volatile',
  'PROGMEM',
  'constexpr',
  'inline',
  'extern',
  'register',
]);

export interface TypeSpec {
  /** A PrimitiveTypeName, or a class/enum identifier such as 'Servo'. */
  name: string;
  isConst: boolean;
  isStatic: boolean;
  /** Number of `*` after the type. Only `char*` (pointer===1) is supported by codegen. */
  pointer: number;
  /** `&` reference. Recorded by the parser; rejected by codegen with a clear error. */
  reference: boolean;
}

// ---------------------------------------------------------------------------
// Program & declarations
// ---------------------------------------------------------------------------

export interface Program {
  kind: 'Program';
  pos: Pos;
  body: TopLevel[];
}

export type TopLevel = IncludeDirective | DefineDirective | VarDecl | FunctionDecl | EnumDecl;

export interface IncludeDirective {
  kind: 'Include';
  pos: Pos;
  /** e.g. 'Servo.h' */
  path: string;
  /** true for <...>, false for "..." */
  system: boolean;
}

/**
 * Object-like macro: `#define NAME tokens`. The value tokens are parsed as an
 * expression (null for `#define NAME` with no value). Function-like macros are
 * a parse error.
 */
export interface DefineDirective {
  kind: 'Define';
  pos: Pos;
  name: string;
  value: Expression | null;
}

export interface Declarator {
  pos: Pos;
  name: string;
  /**
   * One entry per `[...]`. null for an unsized dimension (`int a[] = {...}`).
   * `int m[2][3]` -> [IntLiteral 2, IntLiteral 3].
   */
  arrayDims: (Expression | null)[];
  /** `= expr` or `= { ... }` initializer. */
  init: Expression | InitializerList | null;
  /**
   * Direct-initialization / constructor arguments: `Servo s(4)`, `String s("x")`,
   * `int x(5)`. null when not used. `Servo s;` -> ctorArgs null, init null.
   */
  ctorArgs: Expression[] | null;
}

export interface VarDecl {
  kind: 'VarDecl';
  pos: Pos;
  type: TypeSpec;
  declarators: Declarator[];
}

export interface Param {
  pos: Pos;
  type: TypeSpec;
  /** null for unnamed parameters (prototypes). */
  name: string | null;
  /** `int arr[]` -> [null]; `int m[][3]` -> [null, IntLiteral 3]. */
  arrayDims: (Expression | null)[];
}

export interface FunctionDecl {
  kind: 'FunctionDecl';
  /** Position of the function name. */
  pos: Pos;
  returnType: TypeSpec;
  name: string;
  params: Param[];
  /** null for a prototype (`void f(int);`). */
  body: Block | null;
}

export interface EnumMember {
  pos: Pos;
  name: string;
  value: Expression | null;
}

export interface EnumDecl {
  kind: 'EnumDecl';
  pos: Pos;
  /** null for anonymous enums. */
  name: string | null;
  members: EnumMember[];
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export type Statement =
  | Block
  | ExprStmt
  | VarDecl
  | IfStmt
  | ForStmt
  | WhileStmt
  | DoWhileStmt
  | SwitchStmt
  | ReturnStmt
  | BreakStmt
  | ContinueStmt
  | EmptyStmt;

export interface Block {
  kind: 'Block';
  pos: Pos;
  body: Statement[];
}

export interface ExprStmt {
  kind: 'ExprStmt';
  pos: Pos;
  expr: Expression;
}

export interface IfStmt {
  kind: 'IfStmt';
  pos: Pos;
  test: Expression;
  consequent: Statement;
  alternate: Statement | null;
}

export interface ForStmt {
  kind: 'ForStmt';
  pos: Pos;
  init: VarDecl | Expression | null;
  test: Expression | null;
  update: Expression | null;
  body: Statement;
}

export interface WhileStmt {
  kind: 'WhileStmt';
  pos: Pos;
  test: Expression;
  body: Statement;
}

export interface DoWhileStmt {
  kind: 'DoWhileStmt';
  pos: Pos;
  body: Statement;
  test: Expression;
}

export interface SwitchCase {
  pos: Pos;
  /** null for `default:` */
  test: Expression | null;
  body: Statement[];
}

export interface SwitchStmt {
  kind: 'SwitchStmt';
  pos: Pos;
  discriminant: Expression;
  cases: SwitchCase[];
}

export interface ReturnStmt {
  kind: 'ReturnStmt';
  pos: Pos;
  argument: Expression | null;
}

export interface BreakStmt {
  kind: 'BreakStmt';
  pos: Pos;
}

export interface ContinueStmt {
  kind: 'ContinueStmt';
  pos: Pos;
}

export interface EmptyStmt {
  kind: 'EmptyStmt';
  pos: Pos;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type Expression =
  | IntLiteral
  | FloatLiteral
  | CharLiteral
  | StringLiteral
  | BoolLiteral
  | Identifier
  | UnaryExpr
  | BinaryExpr
  | AssignExpr
  | ConditionalExpr
  | CallExpr
  | MemberExpr
  | IndexExpr
  | CastExpr
  | SizeofExpr
  | CommaExpr;

/**
 * Integer literal. Decimal, hex (0x), binary (0b / B10101010 Arduino style),
 * octal (leading 0). `value` is the numeric value; `unsigned`/`long` come from
 * suffixes (u, U, l, L, ul, UL, ...).
 */
export interface IntLiteral {
  kind: 'IntLiteral';
  pos: Pos;
  value: number;
  unsigned: boolean;
  long: boolean;
}

export interface FloatLiteral {
  kind: 'FloatLiteral';
  pos: Pos;
  value: number;
}

/** 'A' -> value 65. Escapes (\n, \t, \\, \', \0, \xHH) resolved. */
export interface CharLiteral {
  kind: 'CharLiteral';
  pos: Pos;
  value: number;
}

/** "text" with escapes resolved. Adjacent literals are concatenated by the parser. */
export interface StringLiteral {
  kind: 'StringLiteral';
  pos: Pos;
  value: string;
}

export interface BoolLiteral {
  kind: 'BoolLiteral';
  pos: Pos;
  value: boolean;
}

export interface Identifier {
  kind: 'Identifier';
  pos: Pos;
  name: string;
}

export type UnaryOp = '-' | '+' | '!' | '~' | '++' | '--' | '&' | '*';

export interface UnaryExpr {
  kind: 'UnaryExpr';
  pos: Pos;
  op: UnaryOp;
  /** true for prefix (`++x`, `-x`), false for postfix (`x++`, `x--`). */
  prefix: boolean;
  argument: Expression;
}

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '<<'
  | '>>'
  | '<'
  | '>'
  | '<='
  | '>='
  | '=='
  | '!='
  | '&'
  | '|'
  | '^'
  | '&&'
  | '||';

export interface BinaryExpr {
  kind: 'BinaryExpr';
  pos: Pos;
  op: BinaryOp;
  left: Expression;
  right: Expression;
}

export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '<<=' | '>>=' | '&=' | '|=' | '^=';

export interface AssignExpr {
  kind: 'AssignExpr';
  pos: Pos;
  op: AssignOp;
  /** Identifier, IndexExpr or MemberExpr. */
  target: Expression;
  value: Expression;
}

export interface ConditionalExpr {
  kind: 'ConditionalExpr';
  pos: Pos;
  test: Expression;
  consequent: Expression;
  alternate: Expression;
}

/**
 * Function or method call. `callee` is an Identifier (`digitalWrite`,
 * `String`, `Servo`) or a MemberExpr (`Serial.println`). Whether an Identifier
 * callee names a function, a type constructor or a macro is decided by codegen.
 */
export interface CallExpr {
  kind: 'CallExpr';
  pos: Pos;
  callee: Expression;
  args: Expression[];
}

export interface MemberExpr {
  kind: 'MemberExpr';
  pos: Pos;
  object: Expression;
  property: string;
  /** true for `->` */
  arrow: boolean;
}

export interface IndexExpr {
  kind: 'IndexExpr';
  pos: Pos;
  object: Expression;
  index: Expression;
}

/** `(int) x`, `(unsigned long) x`, and functional casts `int(x)`, `float(x)`, `char(x)`. */
export interface CastExpr {
  kind: 'CastExpr';
  pos: Pos;
  type: TypeSpec;
  argument: Expression;
}

export interface SizeofExpr {
  kind: 'SizeofExpr';
  pos: Pos;
  /** `sizeof(int)` -> TypeSpec; `sizeof(arr)` / `sizeof arr` -> Expression. */
  argument: Expression | TypeSpec;
}

export interface CommaExpr {
  kind: 'CommaExpr';
  pos: Pos;
  expressions: Expression[];
}

/** `{ 1, 2, 3 }` or nested `{ {1,2}, {3,4} }` — only valid as a Declarator.init. */
export interface InitializerList {
  kind: 'InitializerList';
  pos: Pos;
  elements: (Expression | InitializerList)[];
}

export type Node = Program | TopLevel | Statement | Expression | InitializerList;

export function isTypeSpec(x: unknown): x is TypeSpec {
  return typeof x === 'object' && x !== null && 'pointer' in x && 'isConst' in x && !('kind' in x);
}
