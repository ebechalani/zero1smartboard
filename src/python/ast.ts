/**
 * The syntax tree of a ZERO1 Python program (docs/PYTHON.md §4.4), made by parser.ts.
 *
 * Every node carries its source range: `line`/`column` of its first character and
 * `endLine`/`endColumn` just after its last one (1-based; the end column is exclusive, like
 * Diagnostic.endColumn). Constructs that parse but ZERO1 Python refuses become `Unsupported`
 * nodes with the message code the checker reports (§5.4); everything else follows the grammar of
 * §2.3. Comments are kept: leading comment lines, end-of-line comments and the comment lines at
 * the end of a block (attached by indentation, §4.4), for the emitter (§4.7 C1–C4).
 */
import type { MessageCode } from './messages';

/** A source range: first character to just after the last one (1-based, end column exclusive). */
export interface Span {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/** A `# …` comment. */
export interface Comment extends Span {
  /** The text after the `#`, as written (the emitter writes it after `//`). */
  text: string;
}

/** A name written in the program where it is not an expression (a def, a parameter, an import). */
export interface Identifier extends Span {
  /** NFKC-normalised, like Python (§2.2). */
  name: string;
}

/**
 * A construct that parses but that ZERO1 Python does not have (§5.4): the checker reports `code`
 * with `params` at this range. Used as a statement and as an expression.
 */
export interface Unsupported extends Span {
  type: 'Unsupported';
  code: MessageCode;
  params: Readonly<Record<string, string>>;
}

/** A backslash escape the tokenizer could not turn into a character (§2.2). */
export interface EscapeNote extends Span {
  /** `unknown`: `\d` and friends, kept with the backslash (W-escape); `N`: `\N{…}` (NA-escape-N). */
  kind: 'unknown' | 'N';
  /** The escape as written, e.g. `\d` or `\N{DEGREE SIGN}`. */
  text: string;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/** What every statement has besides its own fields. */
export interface StmtBase extends Span {
  /** Comment lines just before the statement (at its block's indentation). */
  leading: Comment[];
  /** Comments at the end of the statement's lines (for a compound statement: of its header). */
  trailing: Comment[];
}

/** The statements of an indented block (or of a one-line suite: `while True: pass`). */
export interface Block {
  stmts: Stmt[];
  /**
   * Comment lines after the last statement that belong to this block (indented at least as far
   * as it, or before an `elif` / `else` / `except` of the statement that owns the block).
   */
  endComments: Comment[];
}

export type Stmt =
  | Assign
  | AugAssign
  | If
  | While
  | For
  | FunctionDef
  | Return
  | Global
  | Import
  | ImportFrom
  | ExprStmt
  | Pass
  | Break
  | Continue
  | Try
  | Raise
  | Assert
  | UnsupportedStmt;

/** `a, b` on the left of `=` (also written `(a, b)`). */
export interface TupleTarget extends Span {
  type: 'TupleTarget';
  elts: Array<Name | Subscript | Attribute>;
}

/** What can stand left of `=`. `Unsupported` is NA-unpack (`[a, b] = …`, `a, *b = …`) or NA-slice. */
export type AssignTarget = Name | Subscript | Attribute | TupleTarget | Unsupported;

/** `x = e`; `a = b = e` has two targets, assigned left to right (§2.4). */
export interface Assign extends StmtBase {
  type: 'Assign';
  targets: AssignTarget[];
  value: Expr;
}

export type AugOp = '+' | '-' | '*' | '/' | '//' | '%' | '**' | '&' | '|' | '^' | '<<' | '>>';

/** `x op= e`. */
export interface AugAssign extends StmtBase {
  type: 'AugAssign';
  target: Name | Subscript | Attribute | Unsupported;
  op: AugOp;
  value: Expr;
}

/** `if` / `elif` / `else`: an `elif` is an If (with `isElif`) alone in the `orelse` block. */
export interface If extends StmtBase {
  type: 'If';
  test: Expr;
  body: Block;
  orelse: Block | null;
  isElif: boolean;
}

export interface While extends StmtBase {
  type: 'While';
  test: Expr;
  body: Block;
  /** `while … else:` (NA-loop-else, at the `else`); its block is not kept. */
  orelse: Unsupported | null;
}

export interface For extends StmtBase {
  type: 'For';
  /** A loop variable; anything else (`for a, b in …`) is NA-unpack. */
  target: Name | Unsupported;
  iter: Expr;
  body: Block;
  /** `for … else:` (NA-loop-else, at the `else`); its block is not kept. */
  orelse: Unsupported | null;
}

export interface Param extends Identifier {
  default: Expr | null;
}

export interface FunctionDef extends StmtBase {
  type: 'FunctionDef';
  name: Identifier;
  params: Param[];
  /** The body without its docstring. */
  body: Block;
  docstring: Str | null;
  /** Parts of the header ZERO1 Python refuses: `*args` / `**kw` / `/` (NA-star-args), annotations (NA-annotation). */
  unsupported: Unsupported[];
}

export interface Return extends StmtBase {
  type: 'Return';
  value: Expr | null;
}

export interface Global extends StmtBase {
  type: 'Global';
  names: Identifier[];
}

/** One `module [as name]` or `name [as name]` of an import. */
export interface ImportAlias extends Span {
  /** For `import a.b`, the dotted name as written (the checker refuses dots: E-module). */
  name: string;
  asname: Identifier | null;
}

export interface Import extends StmtBase {
  type: 'Import';
  names: ImportAlias[];
}

export interface ImportFrom extends StmtBase {
  type: 'ImportFrom';
  /** The module as written, with the dots of a relative import (`.`, `..x`); the checker refuses those (E-module). */
  module: Identifier;
  /** `from m import *`. */
  star: boolean;
  names: ImportAlias[];
}

export interface ExprStmt extends StmtBase {
  type: 'ExprStmt';
  value: Expr;
}

export interface Pass extends StmtBase {
  type: 'Pass';
}

export interface Break extends StmtBase {
  type: 'Break';
}

export interface Continue extends StmtBase {
  type: 'Continue';
}

/** `except [Name [as alias]]:`. */
export interface ExceptHandler extends Span {
  /** The exception class, or null for a bare `except:`. */
  typeName: Identifier | null;
  alias: Identifier | null;
  body: Block;
}

/** The one `try` shape the parser keeps (§2.12): one `except`, an optional `else`, no `finally`. */
export interface Try extends StmtBase {
  type: 'Try';
  body: Block;
  handler: ExceptHandler;
  orelse: Block | null;
}

/** `raise e` / `raise e from c`; a bare `raise` is NA-raise. */
export interface Raise extends StmtBase {
  type: 'Raise';
  exc: Expr;
  cause: Expr | null;
}

export interface Assert extends StmtBase {
  type: 'Assert';
  test: Expr;
  msg: Expr | null;
}

/** A statement ZERO1 Python does not have (class, with, del, match, …); its body is not kept. */
export interface UnsupportedStmt extends Unsupported, StmtBase {}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type Expr =
  | Name
  | Num
  | Str
  | FString
  | Bool
  | NoneLit
  | BinOp
  | UnaryOp
  | BoolOp
  | Compare
  | IfExp
  | Call
  | Attribute
  | Subscript
  | ListLit
  | ListRepeat
  | TupleLit
  | Unsupported;

export interface Name extends Span {
  type: 'Name';
  /** NFKC-normalised, like Python (§2.2). */
  id: string;
}

export interface Num extends Span {
  type: 'Num';
  /** The value (an int outside 32 bits is E-big-int, found by the checker after folding a leading '-'). */
  value: number;
  isFloat: boolean;
  /** The literal as written (`0x3F`, `1_000`, `.5`). */
  raw: string;
  base: 2 | 8 | 10 | 16;
}

/** One literal of a string (adjacent literals concatenate: `"ab" "cd"`). */
export interface StrPart extends Span {
  value: string;
  /** The prefix as written (`r`, `u`, `''`). */
  prefix: string;
  escapes: EscapeNote[];
}

export interface Str extends Span {
  type: 'Str';
  value: string;
  parts: StrPart[];
}

export interface FStringText extends Span {
  type: 'text';
  value: string;
  escapes: EscapeNote[];
}

/** The format spec of an f-string field: the text after `:` (§2.11; the checker reads it). */
export interface FormatSpec extends Span {
  text: string;
}

export interface FStringField extends Span {
  type: 'field';
  value: Expr;
  spec: FormatSpec | null;
  /** `!r` / `!s` / `!a`, `{x=}`, a `{…}` inside the spec: NA-fstring-spec. */
  unsupported: Unsupported | null;
}

/** An f-string, with the literals concatenated to it. */
export interface FString extends Span {
  type: 'FString';
  parts: Array<FStringText | FStringField>;
}

export interface Bool extends Span {
  type: 'Bool';
  value: boolean;
}

/** `None`: only `return None` is allowed (the checker: NA-none elsewhere). */
export interface NoneLit extends Span {
  type: 'NoneLit';
}

export type BinaryOp = '+' | '-' | '*' | '/' | '//' | '%' | '**' | '<<' | '>>' | '&' | '|' | '^';

export interface BinOp extends Span {
  type: 'BinOp';
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

export interface UnaryOp extends Span {
  type: 'UnaryOp';
  op: '-' | '+' | '~' | 'not';
  operand: Expr;
}

/** `a and b and c` (one node for a run of the same operator, like CPython). */
export interface BoolOp extends Span {
  type: 'BoolOp';
  op: 'and' | 'or';
  values: Expr[];
}

export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not in';

/** `a < b < c`: ops ['<', '<'], comparators [b, c]. */
export interface Compare extends Span {
  type: 'Compare';
  left: Expr;
  ops: CompareOp[];
  comparators: Expr[];
}

/** `body if test else orelse`. */
export interface IfExp extends Span {
  type: 'IfExp';
  test: Expr;
  body: Expr;
  orelse: Expr;
}

export interface Keyword extends Span {
  name: Identifier;
  value: Expr;
}

export interface Call extends Span {
  type: 'Call';
  func: Expr;
  /** Positional arguments (`*x`, `**x` and generator arguments are Unsupported). */
  args: Expr[];
  keywords: Keyword[];
}

export interface Attribute extends Span {
  type: 'Attribute';
  value: Expr;
  attr: Identifier;
}

/** `value[index]` (a slice `a[i:j]` is NA-slice instead). */
export interface Subscript extends Span {
  type: 'Subscript';
  value: Expr;
  index: Expr;
}

export interface ListLit extends Span {
  type: 'ListLit';
  elts: Expr[];
}

/** `[v] * N` (also `N * [v]`, and a longer list literal times a count). */
export interface ListRepeat extends Span {
  type: 'ListRepeat';
  list: ListLit;
  count: Expr;
}

/** `(a, b, c)` or `a, b` (a colour, or the right side of `a, b = b, a`; other uses are NA-tuple). */
export interface TupleLit extends Span {
  type: 'TupleLit';
  elts: Expr[];
  parenthesized: boolean;
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export interface Module extends Span {
  type: 'Module';
  /** The program without its docstring. */
  body: Block;
  /** The module docstring (§4.7 C3), or null. */
  docstring: Str | null;
}
