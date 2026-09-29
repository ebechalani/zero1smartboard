/**
 * Tokenizer of ZERO1 Python (docs/PYTHON.md §2.2, §4.3).
 *
 * `normalize()` turns CRLF and lone CR into LF and drops a leading byte-order mark; `tokenize()`
 * turns the text into NAME / NUMBER / STRING / FSTRING / OP tokens plus the NEWLINE, INDENT and
 * DEDENT tokens of Python's line structure, with comments as COMMENT tokens (trivia for the
 * parser). Positions are 1-based lines and columns counted in UTF-16 code units, like the editor;
 * `endColumn` is exclusive.
 *
 * The first lexical error stops tokenizing, like CPython: a PythonSyntaxError with the §5.1 code.
 * C habits get their own messages: `x++`, `&&`, `||`, `!x`, `//` at the start of a line and `{`
 * after a condition. Things that are valid Python but not ZERO1 Python are not errors here: they
 * are marked on the tokens (imaginary numbers, bytes, unknown escapes, `\N{…}`, f-string
 * conversions) for the parser and the checker.
 */
import type { EscapeNote, Span } from './ast';
import { message, type MessageCode } from './messages';

export type TokenKind = 'NAME' | 'NUMBER' | 'STRING' | 'FSTRING' | 'OP' | 'NEWLINE' | 'INDENT' | 'DEDENT' | 'COMMENT' | 'EOF';

export interface NumberInfo {
  /** The value; ints are exact up to 2^53 (anything that large is E-big-int anyway). */
  value: number;
  isFloat: boolean;
  /** `1j` (NA-complex). */
  imaginary: boolean;
  base: 2 | 8 | 10 | 16;
}

export interface StringInfo {
  /** The prefix as written (`''`, `r`, `U`, `b`, …). */
  prefix: string;
  /** The text with the escapes worked out (bytes and raw strings: as written). */
  value: string;
  raw: boolean;
  /** `b'…'` (NA-bytes). */
  bytes: boolean;
  triple: boolean;
  escapes: EscapeNote[];
}

export interface FStringTextPart extends Span {
  type: 'text';
  value: string;
  escapes: EscapeNote[];
}

export interface FStringFieldPart extends Span {
  type: 'field';
  /** The tokens of the expression (no NEWLINE/INDENT; ends with EOF), positioned in the program. */
  tokens: Token[];
  /** The format spec after `:`, as written. */
  spec: (Span & { text: string }) | null;
  /** `!r`, `=` (in `{x=}`) or a spec with a `{…}` inside: NA-fstring-spec, with the part as written. */
  unsupported: (Span & { text: string }) | null;
}

export interface FStringInfo {
  prefix: string;
  triple: boolean;
  parts: Array<FStringTextPart | FStringFieldPart>;
}

export interface Token extends Span {
  kind: TokenKind;
  /** The source text ('' for NEWLINE, INDENT, DEDENT and EOF; a COMMENT includes its '#'). */
  text: string;
  number?: NumberInfo;
  string?: StringInfo;
  fstring?: FStringInfo;
  /** COMMENT: true when the comment is alone on its line (not after code, not inside brackets). */
  ownLine?: boolean;
  /** INDENT and own-line COMMENT: the indentation width (a tab advances to the next multiple of 8). */
  indent?: number;
}

/** A syntax or indentation error (§5.1): parsing stops at the first one. */
export class PythonSyntaxError extends Error implements Span {
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;

  constructor(
    readonly code: MessageCode,
    span: Span,
    readonly params: Readonly<Record<string, string | number>> = {},
  ) {
    super(message(code, params));
    this.name = 'PythonSyntaxError';
    this.line = span.line;
    this.column = span.column;
    this.endLine = span.endLine;
    this.endColumn = span.endColumn;
  }
}

/** The 35 keywords of Python 3.12 (`match`, `case` and `_` are soft keywords: names). */
export const PYTHON_KEYWORDS: ReadonlySet<string> = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or',
  'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

/** C and JavaScript spellings of True / False / None (E-name-true "Did you mean: 'True'?", §4.3). */
export const C_HABIT_NAMES: Readonly<Record<string, 'True' | 'False' | 'None'>> = {
  true: 'True',
  false: 'False',
  null: 'None',
  none: 'None',
};

/** Keywords that start a block header: a `{` after one of these is a C habit (S-brace). */
const HEADER_KEYWORDS: ReadonlySet<string> = new Set(['if', 'elif', 'else', 'while', 'for', 'def', 'try', 'except', 'finally', 'class', 'with']);

/** Operators and delimiters, longest first. */
const OPERATORS = [
  '**=', '//=', '>>=', '<<=', '...',
  '**', '//', '>>', '<<', '<=', '>=', '==', '!=', '->', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', ':=',
  '+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '=',
];

const CLOSING: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

/** CPython's limits: brackets nested deeper, or more indentation levels, are a SyntaxError (not a stack overflow). */
const MAX_BRACKETS = 200;
const MAX_INDENTS = 100;

/** Curly quotes that word processors put in pasted code (S-curly-quote). */
const CURLY_QUOTES: ReadonlySet<number> = new Set([0x2018, 0x2019, 0x201c, 0x201d, 0x201e]);

/** Keywords that may follow a number directly (`1if x else 2`), as CPython allows. */
const AFTER_NUMBER_KEYWORDS = /(?:and|else|for|if|in|is|not|or)(?![\p{XID_Continue}])/uy;

const DECIMAL_DIGITS = /[0-9](?:_?[0-9])*/y;
const HEX_DIGITS = /(?:_?[0-9a-fA-F])+/y;
const OCT_DIGITS = /(?:_?[0-7])+/y;
const BIN_DIGITS = /(?:_?[01])+/y;

const ID_START = /[\p{XID_Start}_]/u;
const ID_CONTINUE = /[\p{XID_Continue}]/u;
const STRING_PREFIX = /^(?:[rRuUfFbB]|[bB][rR]|[rR][bB]|[fF][rR]|[rR][fF])$/;

/** §2.2 source normalisation: CRLF and lone CR → LF; a leading U+FEFF is dropped. */
export function normalize(source: string): string {
  return source.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
}

/** The tokens of a program (normalised first), ending with NEWLINE (when there is code), DEDENTs and EOF. */
export function tokenize(source: string): Token[] {
  const text = normalize(source);
  return new Lexer(text, lineStartsOf(text), 0, text.length, false).run();
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** An open bracket: its character and where it is. */
interface OpenBracket {
  char: string;
  offset: number;
}

class Lexer {
  private readonly tokens: Token[] = [];
  private i: number;
  /** Indentation widths of the open blocks (tabs to multiples of 8), and with tab size 1 (TabError). */
  private readonly indents = [0];
  private readonly altIndents = [0];
  private readonly brackets: OpenBracket[] = [];
  private atLineStart: boolean;
  /** The first token of the current logical line (S-c-comment, S-brace). */
  private lineFirst: Token | null = null;
  /** A ':' outside brackets has been seen on the current logical line (the header colon). */
  private headerColon = false;
  /** The last token that is not a comment (NEWLINE's position, x++). */
  private last: Token | null = null;
  /** Offset of a `\` that continues the line, until something follows it. */
  private continuationAt = -1;

  /**
   * @param field true for the expression of an f-string field: implicitly inside brackets (no
   *   NEWLINE or indentation), ends with EOF only.
   */
  constructor(
    private readonly src: string,
    private readonly lineStarts: number[],
    start: number,
    private readonly end: number,
    private readonly field: boolean,
  ) {
    this.i = start;
    this.atLineStart = !field;
  }

  run(): Token[] {
    while (this.step()) {
      /* one token (or a line start) per step */
    }
    this.finish();
    return this.tokens;
  }

  // ---- positions ------------------------------------------------------------

  private pos(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.lineStarts[lo] + 1 };
  }

  private span(start: number, end: number): Span {
    const a = this.pos(start);
    const b = this.pos(end);
    return { line: a.line, column: a.column, endLine: b.line, endColumn: b.column };
  }

  private fail(code: MessageCode, start: number, end: number, params: Record<string, string | number> = {}): never {
    throw new PythonSyntaxError(code, this.span(start, end), params);
  }

  private push(kind: TokenKind, start: number, end: number, extra: Partial<Token> = {}): Token {
    const token: Token = { kind, text: this.src.slice(start, end), ...this.span(start, end), ...extra };
    this.tokens.push(token);
    if (kind !== 'COMMENT') {
      this.last = token;
      if (this.lineFirst === null && kind !== 'INDENT' && kind !== 'DEDENT') this.lineFirst = token;
    }
    return token;
  }

  /** A token without text at `at` (NEWLINE, INDENT, DEDENT, EOF). */
  private pushEmpty(kind: TokenKind, at: Span, extra: Partial<Token> = {}): void {
    this.tokens.push({ kind, text: '', line: at.line, column: at.column, endLine: at.line, endColumn: at.column, ...extra });
  }

  // ---- the main loop --------------------------------------------------------

  /** Reads the next token; false at the end. */
  private step(): boolean {
    if (this.atLineStart) {
      if (!this.lineStart()) return false;
      if (this.atLineStart) return true;
    }
    this.skipSpaces();
    const src = this.src;
    const i = this.i;
    if (i >= this.end) return false;
    const c = src[i];
    if (this.continuationAt >= 0 && c !== '\n' && c !== '#') this.continuationAt = -1;

    if (c === '\n') {
      this.i++;
      if (this.brackets.length > 0 || this.field) return true; // implicit line joining
      this.continuationAt = -1;
      this.newline();
      return true;
    }
    if (c === '#') {
      this.comment(false);
      return true;
    }
    if (c === '\\') {
      if (src[i + 1] === '\n' && i + 1 < this.end) {
        this.continuationAt = i;
        this.i += 2;
        return true;
      }
      if (i + 1 >= this.end) this.fail('S-syntax', i, i + 1); // unexpected EOF after the line continuation
      this.fail('S-syntax', i + 1, i + 2); // unexpected character after the line continuation character
    }
    if (c >= '0' && c <= '9') {
      this.number();
      return true;
    }
    if (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9') {
      this.number();
      return true;
    }
    if (c === '"' || c === "'") {
      this.string(i, i);
      return true;
    }
    const code = src.codePointAt(i)!;
    if (code === 0xa0) this.fail('S-nbsp', i, i + 1);
    if (CURLY_QUOTES.has(code)) this.fail('S-curly-quote', i, i + 1, { c, hex: hex(code) });
    const ch = String.fromCodePoint(code);
    if (ID_START.test(ch)) {
      this.nameOrPrefixedString();
      return true;
    }
    this.operator();
    return true;
  }

  /**
   * At the start of a physical line outside brackets: skips blank and comment lines, then works
   * out INDENT / DEDENT. False at the end of the text.
   */
  private lineStart(): boolean {
    const src = this.src;
    let col = 0;
    let altCol = 0;
    let j = this.i;
    for (; j < this.end; j++) {
      const c = src[j];
      if (c === ' ') {
        col++;
        altCol++;
      } else if (c === '\t') {
        col = (Math.floor(col / 8) + 1) * 8;
        altCol++;
      } else if (c === '\f') {
        col = 0;
        altCol = 0;
      } else {
        break;
      }
    }
    if (j >= this.end) {
      this.i = j;
      return false;
    }
    if (src[j] === '\n') {
      this.i = j + 1;
      return true;
    }
    if (src[j] === '#') {
      this.i = j;
      this.comment(true, col);
      return true;
    }
    this.atLineStart = false;
    this.i = j;
    this.indentation(col, altCol, this.lineStarts[this.pos(j).line - 1], j);
    return true;
  }

  /** CPython's indentation rules: an INDENT/DEDENT stack compared with tab size 8 and tab size 1 (§2.2). */
  private indentation(col: number, altCol: number, lineStart: number, first: number): void {
    const at = this.span(first, first);
    const top = this.indents.length - 1;
    if (col === this.indents[top]) {
      if (altCol !== this.altIndents[top]) this.fail('S-tab', lineStart, first);
    } else if (col > this.indents[top]) {
      if (altCol <= this.altIndents[top]) this.fail('S-tab', lineStart, first);
      if (this.indents.length > MAX_INDENTS) this.fail('S-syntax', lineStart, first); // too many levels of indentation
      this.indents.push(col);
      this.altIndents.push(altCol);
      this.pushEmpty('INDENT', at, { indent: col });
    } else {
      while (this.indents.length > 1 && col < this.indents[this.indents.length - 1]) {
        this.indents.pop();
        this.altIndents.pop();
        this.pushEmpty('DEDENT', at);
      }
      if (col !== this.indents[this.indents.length - 1]) this.fail('S-unindent', lineStart, first);
      if (altCol !== this.altIndents[this.altIndents.length - 1]) this.fail('S-tab', lineStart, first);
    }
  }

  private newline(): void {
    const last = this.last;
    const at = last ? { line: last.endLine, column: last.endColumn, endLine: last.endLine, endColumn: last.endColumn } : this.span(this.i, this.i);
    this.pushEmpty('NEWLINE', at);
    this.atLineStart = true;
    this.lineFirst = null;
    this.headerColon = false;
  }

  private finish(): void {
    if (this.continuationAt >= 0) this.fail('S-syntax', this.continuationAt, this.continuationAt + 1); // unexpected EOF
    const open = this.brackets[this.brackets.length - 1];
    if (open) this.fail('S-never-closed', open.offset, open.offset + 1, { bracket: open.char });
    const endAt = this.span(this.end, this.end);
    if (this.field) {
      this.pushEmpty('EOF', endAt);
      return;
    }
    if (!this.atLineStart && this.lineFirst !== null) this.newline();
    while (this.indents.length > 1) {
      this.indents.pop();
      this.pushEmpty('DEDENT', endAt);
    }
    this.pushEmpty('EOF', endAt);
  }

  private skipSpaces(): void {
    while (this.i < this.end) {
      const c = this.src[this.i];
      if (c !== ' ' && c !== '\t' && c !== '\f') break;
      this.i++;
    }
  }

  // ---- comments ---------------------------------------------------------------

  private comment(ownLine: boolean, indent?: number): void {
    const start = this.i;
    let end = this.src.indexOf('\n', start);
    if (end < 0 || end > this.end) end = this.end;
    this.push('COMMENT', start, end, ownLine ? { ownLine, indent } : { ownLine: false });
    this.i = end;
  }

  // ---- names --------------------------------------------------------------------

  private nameOrPrefixedString(): void {
    const start = this.i;
    let j = start;
    while (j < this.end) {
      const code = this.src.codePointAt(j)!;
      const ch = String.fromCodePoint(code);
      if (!ID_CONTINUE.test(ch)) break;
      j += ch.length;
    }
    const word = this.src.slice(start, j);
    if (STRING_PREFIX.test(word) && (this.src[j] === '"' || this.src[j] === "'") && j < this.end) {
      this.i = j;
      this.string(start, j);
      return;
    }
    this.i = j;
    this.push('NAME', start, j);
  }

  // ---- numbers ------------------------------------------------------------------

  private number(): void {
    const src = this.src;
    const start = this.i;
    let j = start;
    let base: 2 | 8 | 10 | 16 = 10;
    let isFloat = false;
    let imaginary = false;
    let value: number;
    const prefix = src[j] === '0' && j + 1 < this.end ? src[j + 1] : '';
    if (/^[xXoObB]$/.test(prefix)) {
      base = /[xX]/.test(prefix) ? 16 : /[oO]/.test(prefix) ? 8 : 2;
      const digitsEnd = this.match(base === 16 ? HEX_DIGITS : base === 8 ? OCT_DIGITS : BIN_DIGITS, j + 2);
      if (digitsEnd < 0) this.fail('S-syntax', start, j + 2); // invalid hexadecimal / octal / binary literal
      j = digitsEnd;
      if (src[j] === '_' || /[0-9]/.test(src[j] ?? '')) this.fail('S-syntax', j, j + 1); // invalid digit in the literal
      value = Number(BigInt(`0${prefix.toLowerCase()}${src.slice(start + 2, j).replace(/_/g, '')}`));
    } else {
      if (src[j] !== '.') j = this.decimalDigits(j);
      if (src[j] === '.' && j < this.end) {
        isFloat = true;
        j++;
        if (/[0-9]/.test(src[j] ?? '') && j < this.end) j = this.decimalDigits(j);
      }
      if ((src[j] === 'e' || src[j] === 'E') && j < this.end) {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (/[0-9]/.test(src[k] ?? '') && k < this.end) {
          isFloat = true;
          j = this.decimalDigits(k);
        } else if (!this.keywordAt(j)) {
          this.fail('S-syntax', start, k); // invalid decimal literal (`1e`)
        }
      }
      if ((src[j] === 'j' || src[j] === 'J') && j < this.end) {
        imaginary = true;
        j++;
      }
      const digits = src.slice(start, imaginary ? j - 1 : j).replace(/_/g, '');
      if (!isFloat && !imaginary && /^0/.test(digits) && /[1-9]/.test(digits)) this.fail('S-leading-zero', start, j);
      value = isFloat || imaginary ? Number(digits) : Number(BigInt(digits));
    }
    if (j < this.end && ID_CONTINUE.test(String.fromCodePoint(src.codePointAt(j)!)) && !this.keywordAt(j)) {
      let k = j;
      while (k < this.end && ID_CONTINUE.test(String.fromCodePoint(src.codePointAt(k)!))) k += String.fromCodePoint(src.codePointAt(k)!).length;
      this.fail('S-syntax', start, k); // invalid decimal literal (`12abc`)
    }
    this.i = j;
    this.push('NUMBER', start, j, { number: { value, isFloat, imaginary, base } });
  }

  /** Where a sticky regex matching at `at` ends (-1: no match), at most at the end of the text being read. */
  private match(re: RegExp, at: number): number {
    re.lastIndex = at;
    return re.test(this.src) ? Math.min(re.lastIndex, this.end) : -1;
  }

  /** A keyword that may follow a number directly (`1if x else 2`) starts at `at`. */
  private keywordAt(at: number): boolean {
    return this.match(AFTER_NUMBER_KEYWORDS, at) >= 0;
  }

  /** Decimal digits with single underscores between them, from the digit at `start`; returns their end. */
  private decimalDigits(start: number): number {
    const end = this.match(DECIMAL_DIGITS, start);
    if (this.src[end] === '_' && end < this.end) this.fail('S-syntax', end, end + 1); // invalid decimal literal (`1_`, `1__0`)
    return end;
  }

  // ---- strings ------------------------------------------------------------------

  /** A string literal: `start` is its first character (the prefix), `quoteAt` its opening quote. */
  private string(start: number, quoteAt: number): void {
    const src = this.src;
    const prefix = src.slice(start, quoteAt);
    const lower = prefix.toLowerCase();
    const raw = lower.includes('r');
    const bytes = lower.includes('b');
    const isF = lower.includes('f');
    const q = src[quoteAt];
    const triple = src.startsWith(q + q + q, quoteAt) && quoteAt + 2 < this.end;
    const bodyStart = quoteAt + (triple ? 3 : 1);
    let j = bodyStart;
    const unterminated = (detectedAt: number): never =>
      this.fail(triple ? 'S-unterminated-triple' : 'S-unterminated', start, start + 1, { n: this.pos(detectedAt).line });
    for (;;) {
      if (j >= this.end) unterminated(Math.max(this.end - 1, 0));
      const c = src[j];
      if (c === '\\') {
        if (j + 1 >= this.end) unterminated(j);
        j += 2;
        continue;
      }
      if (c === '\n' && !triple) unterminated(j);
      if (c === q && (!triple || (src.startsWith(q + q + q, j) && j + 2 < this.end))) break;
      j++;
    }
    const bodyEnd = j;
    const end = j + (triple ? 3 : 1);
    this.i = end;
    if (isF) {
      this.push('FSTRING', start, end, { fstring: { prefix, triple, parts: this.fstringParts(bodyStart, bodyEnd, raw) } });
      return;
    }
    const escapes: EscapeNote[] = [];
    const value = raw || bytes ? src.slice(bodyStart, bodyEnd) : this.decode(bodyStart, bodyEnd, escapes);
    this.push('STRING', start, end, { string: { prefix, value, raw, bytes, triple, escapes } });
  }

  /** The text of a string body with its escapes worked out (§2.2). */
  private decode(start: number, end: number, escapes: EscapeNote[]): string {
    let out = '';
    let k = start;
    while (k < end) {
      if (this.src[k] === '\\') {
        const escape = this.escape(k, end, escapes);
        out += escape.text;
        k = escape.end;
      } else {
        out += this.src[k++];
      }
    }
    return out;
  }

  /** One escape at `k` (a backslash): its text and where it ends. */
  private escape(k: number, end: number, escapes: EscapeNote[]): { text: string; end: number } {
    const src = this.src;
    const n = src[k + 1];
    const simple: Record<string, string> = { '\n': '', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
    if (n in simple) return { text: simple[n], end: k + 2 };
    if (n >= '0' && n <= '7') {
      let j = k + 1;
      let digits = '';
      while (j < end && digits.length < 3 && src[j] >= '0' && src[j] <= '7') digits += src[j++];
      return { text: String.fromCodePoint(parseInt(digits, 8)), end: j };
    }
    const hexDigits = n === 'x' ? 2 : n === 'u' ? 4 : n === 'U' ? 8 : 0;
    if (hexDigits > 0) {
      const digits = src.slice(k + 2, k + 2 + hexDigits);
      if (k + 2 + hexDigits > end || !/^[0-9a-fA-F]+$/.test(digits) || digits.length !== hexDigits) this.fail('S-syntax', k, Math.min(k + 2 + hexDigits, end)); // truncated escape
      const code = parseInt(digits, 16);
      if (code > 0x10ffff) this.fail('S-syntax', k, k + 2 + hexDigits); // illegal Unicode character
      return { text: String.fromCodePoint(code), end: k + 2 + hexDigits };
    }
    if (n === 'N') {
      const close = src.indexOf('}', k);
      if (src[k + 2] !== '{' || close < 0 || close >= end) this.fail('S-syntax', k, Math.min(k + 3, end)); // malformed \N escape
      escapes.push({ kind: 'N', text: src.slice(k, close + 1), ...this.span(k, close + 1) });
      return { text: '�', end: close + 1 };
    }
    // An unrecognised escape keeps its backslash (W-escape).
    const ch = String.fromCodePoint(src.codePointAt(k + 1)!);
    escapes.push({ kind: 'unknown', text: `\\${ch}`, ...this.span(k, k + 1 + ch.length) });
    return { text: `\\${ch}`, end: k + 1 + ch.length };
  }

  /** The literal parts and `{…}` fields of an f-string body (§2.2). */
  private fstringParts(start: number, end: number, raw: boolean): Array<FStringTextPart | FStringFieldPart> {
    const src = this.src;
    const parts: Array<FStringTextPart | FStringFieldPart> = [];
    let text = '';
    let textStart = start;
    let escapes: EscapeNote[] = [];
    const flush = (at: number) => {
      if (at > textStart) parts.push({ type: 'text', value: text, escapes, ...this.span(textStart, at) });
      text = '';
      escapes = [];
    };
    let k = start;
    while (k < end) {
      const c = src[k];
      if (c === '\\' && !raw) {
        const escape = this.escape(k, end, escapes);
        text += escape.text;
        k = escape.end;
      } else if (c === '{' && src[k + 1] === '{' && k + 1 < end) {
        text += '{';
        k += 2;
      } else if (c === '}' && src[k + 1] === '}' && k + 1 < end) {
        text += '}';
        k += 2;
      } else if (c === '{') {
        flush(k);
        const field = this.fstringField(k, end);
        parts.push(field.part);
        k = field.end;
        textStart = k;
      } else if (c === '}') {
        this.fail('S-syntax', k, k + 1); // f-string: single '}' is not allowed
      } else {
        text += c;
        k++;
      }
    }
    flush(end);
    return parts;
  }

  /** One `{expression[=][!c][:spec]}` field starting at the `{` at `open`. */
  private fstringField(open: number, end: number): { part: FStringFieldPart; end: number } {
    const src = this.src;
    const expecting = (): never => this.fail('S-syntax', open, end); // f-string: expecting '}'
    let k = open + 1;
    let depth = 0;
    let unsupported: (Span & { text: string }) | null = null;
    for (;;) {
      if (k >= end) expecting();
      const c = src[k];
      if (c === '\\') this.fail('S-syntax', k, k + 1); // f-string expression part cannot include a backslash
      if (c === '#') this.fail('S-syntax', k, k + 1); // f-string expression part cannot include '#'
      if (c === '"' || c === "'") {
        k = this.skipInnerString(k, end, expecting);
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if ((c === ')' || c === ']' || c === '}') && depth > 0) depth--;
      else if (depth === 0) {
        if (c === '}' || c === ':') break;
        if (c === '!' && src[k + 1] !== '=') break;
        if (c === '=' && src[k + 1] !== '=' && !'=!<>'.includes(src[k - 1]) && /^\s*[}!:]/.test(src.slice(k + 1, end))) break;
      }
      k++;
    }
    const exprStart = open + 1;
    const exprEnd = k;
    if (src.slice(exprStart, exprEnd).trim() === '') this.fail('S-syntax', open, Math.min(k + 1, end)); // empty expression
    if (src[k] === '=') {
      let j = k + 1;
      while (/\s/.test(src[j])) j++;
      unsupported = { text: '=', ...this.span(k, k + 1) };
      k = j;
    }
    if (src[k] === '!') {
      let j = k + 1;
      while (j < end && /\w/.test(src[j])) j++;
      if (j === k + 1 || (src[j] !== ':' && src[j] !== '}')) this.fail('S-syntax', k, j); // invalid conversion
      unsupported ??= { text: src.slice(k, j), ...this.span(k, j) };
      k = j;
    }
    let spec: (Span & { text: string }) | null = null;
    if (src[k] === ':') {
      const specStart = k + 1;
      let specDepth = 0;
      let nested = false;
      k = specStart;
      for (;;) {
        if (k >= end) expecting();
        const c = src[k];
        if (c === '{') {
          nested = true;
          specDepth++;
        } else if (c === '}') {
          if (specDepth === 0) break;
          specDepth--;
        } else if (c === '\\') {
          k++;
        }
        k++;
      }
      spec = { text: src.slice(specStart, k), ...this.span(specStart, k) };
      if (nested) unsupported ??= { text: spec.text, ...this.span(specStart, k) };
    }
    if (src[k] !== '}') expecting();
    const tokens = new Lexer(src, this.lineStarts, exprStart, exprEnd, true).run();
    return { part: { type: 'field', tokens, spec, unsupported, ...this.span(open, k + 1) }, end: k + 1 };
  }

  /** Skips a string inside an f-string field (the other quote kind, or any in a triple-quoted f-string). */
  private skipInnerString(k: number, end: number, expecting: () => never): number {
    const src = this.src;
    const q = src[k];
    const triple = src.startsWith(q + q + q, k) && k + 2 < end;
    let j = k + (triple ? 3 : 1);
    for (;;) {
      if (j >= end) expecting();
      if (src[j] === '\\') {
        j += 2;
        continue;
      }
      if (src[j] === q && (!triple || src.startsWith(q + q + q, j))) return j + (triple ? 3 : 1);
      j++;
    }
  }

  // ---- operators ------------------------------------------------------------------

  private operator(): void {
    const src = this.src;
    const i = this.i;
    const c = src[i];
    // C habits (§4.3, §5.1)
    if ((c === '&' && src[i + 1] === '&') || (c === '|' && src[i + 1] === '|')) this.fail('S-c-operator', i, i + 2);
    if (c === '!' && src[i + 1] !== '=') this.fail('S-c-operator', i, i + 1);
    if ((c === '+' || c === '-') && src[i + 1] === c && this.isPlusPlus(i)) this.fail('S-plusplus', i, i + 2);
    if (c === '/' && src[i + 1] === '/' && this.lineFirst === null && !this.field && this.brackets.length === 0) {
      let lineEnd = src.indexOf('\n', i);
      if (lineEnd < 0) lineEnd = this.end;
      while (lineEnd > i + 2 && /[ \t\f]/.test(src[lineEnd - 1])) lineEnd--;
      this.fail('S-c-comment', i, lineEnd);
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i) && i + o.length <= this.end);
    if (op === undefined) {
      const code = src.codePointAt(i)!;
      const ch = String.fromCodePoint(code);
      this.fail('S-invalid-char', i, i + ch.length, { c: ch, hex: hex(code) });
    }
    if (op === '{' && this.isBrace(i)) this.fail('S-brace', i, i + 1);
    if (op === '(' || op === '[' || op === '{') {
      if (this.brackets.length >= MAX_BRACKETS) this.fail('S-syntax', i, i + 1); // too many nested parentheses
      this.brackets.push({ char: op, offset: i });
    } else if (op === ')' || op === ']' || op === '}') {
      const open = this.brackets[this.brackets.length - 1];
      if (!open) this.fail('S-unmatched', i, i + 1, { bracket: op });
      if (open.char !== CLOSING[op]) this.fail('S-never-closed', open.offset, open.offset + 1, { bracket: open.char });
      this.brackets.pop();
    } else if (op === ':' && this.brackets.length === 0) {
      this.headerColon = true;
    }
    this.i = i + op.length;
    this.push('OP', i, i + op.length);
  }

  /** `x++` / `x--`: after an operand of the same logical line, before the end of the statement (§4.3: as a suffix). */
  private isPlusPlus(i: number): boolean {
    const last = this.last;
    if (!last || this.lineFirst === null) return false;
    const operand =
      (last.kind === 'NAME' && !PYTHON_KEYWORDS.has(last.text)) ||
      last.kind === 'NUMBER' ||
      last.kind === 'STRING' ||
      last.kind === 'FSTRING' ||
      (last.kind === 'OP' && (last.text === ')' || last.text === ']'));
    if (!operand) return false;
    let j = i + 2;
    while (j < this.end && (this.src[j] === ' ' || this.src[j] === '\t')) j++;
    return j >= this.end || '\n#;)],'.includes(this.src[j]);
  }

  /** A `{` right after an `if` / `def` / … header, where Python wants the colon (S-brace). */
  private isBrace(i: number): boolean {
    const first = this.lineFirst;
    if (this.field || this.brackets.length > 0 || this.headerColon || !first || first.kind !== 'NAME' || !HEADER_KEYWORDS.has(first.text)) return false;
    const src = this.src;
    let lineEnd = src.indexOf('\n', i);
    if (lineEnd < 0) lineEnd = this.end;
    const code = withoutComment(src.slice(i + 1, lineEnd)).trim();
    if (code === '') return true;
    return !withoutComment(src.slice(this.lineStarts[this.pos(i).line - 1], lineEnd)).trimEnd().endsWith(':');
  }
}

/** A line of code without its `# comment` (quotes are skipped). */
function withoutComment(line: string): string {
  let quote = '';
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (quote) {
      if (c === '\\') k++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#') {
      return line.slice(0, k);
    }
  }
  return line;
}

/** A code point as the 4+ hex digits of "U+00A0". */
function hex(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, '0');
}
