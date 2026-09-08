/**
 * Tokenizer for the Arduino C++ subset (docs/ARCHITECTURE.md §4.1).
 *
 * Produces a flat token list with 1-based line/column positions. Preprocessor
 * directives are returned as single 'directive' tokens (with `\` line
 * continuations joined and trailing `//` comments removed) and parsed later by
 * the parser.
 */

export type TokenType = 'ident' | 'keyword' | 'int' | 'float' | 'char' | 'string' | 'punct' | 'directive' | 'eof';

export interface Token {
  type: TokenType;
  /** Source text for punctuators/keywords/identifiers, decoded value for literals (see `num`). */
  value: string;
  line: number;
  column: number;
  /** Numeric value for 'int' / 'float' / 'char' tokens. */
  num?: number;
  /** Integer literal suffix flags. */
  unsigned?: boolean;
  long?: boolean;
}

/** Error thrown by the lexer and the parser; carries a 1-based position. */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/** Words that are never identifiers. Type keywords are included so that `int(x)` and `byte b` parse. */
export const KEYWORDS: ReadonlySet<string> = new Set([
  // control flow
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'return',
  'sizeof',
  'true',
  'false',
  // types & qualifiers
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
  'const',
  'static',
  'volatile',
  'PROGMEM',
  'constexpr',
  'inline',
  'extern',
  'register',
  'enum',
  // recognised only to give a good error message
  'struct',
  'class',
  'union',
  'typedef',
  'template',
  'typename',
  'namespace',
  'using',
  'goto',
  'new',
  'delete',
  'this',
  'public',
  'private',
  'protected',
  'virtual',
  'operator',
  'auto',
  'friend',
  'throw',
  'try',
  'catch',
]);

/** Punctuators, longest first so that the scanner can try them in order. */
const PUNCTUATORS = [
  '<<=',
  '>>=',
  '...',
  '->',
  '++',
  '--',
  '<<',
  '>>',
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '::',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
  '!',
  '~',
  '&',
  '|',
  '^',
  '?',
  ':',
  ';',
  ',',
  '.',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
];

const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  n: 10,
  t: 9,
  r: 13,
  '0': 0,
  '\\': 92,
  "'": 39,
  '"': 34,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
  '?': 63,
};

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isIdentChar(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

function isHexDigit(c: string): boolean {
  return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

class Scanner {
  private pos = 0;
  private line = 1;
  private column = 1;
  readonly tokens: Token[] = [];

  constructor(private readonly src: string) {}

  private peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  private advance(count = 1): void {
    for (let i = 0; i < count; i++) {
      const c = this.src[this.pos];
      if (c === undefined) return;
      this.pos++;
      if (c === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
    }
  }

  private error(message: string, line = this.line, column = this.column): ParseError {
    return new ParseError(message, line, column);
  }

  private push(type: TokenType, value: string, line: number, column: number, extra?: Partial<Token>): void {
    this.tokens.push({ type, value, line, column, ...extra });
  }

  scan(): Token[] {
    while (this.pos < this.src.length) {
      const c = this.peek();
      if (c === '\n' || c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
        this.advance();
        continue;
      }
      if (c === '/' && this.peek(1) === '/') {
        this.skipLineComment();
        continue;
      }
      if (c === '/' && this.peek(1) === '*') {
        this.skipBlockComment();
        continue;
      }
      if (c === '#' && this.atLineStart()) {
        this.scanDirective();
        continue;
      }
      if (c === '#') throw this.error("stray '#' in program (directives must start at the beginning of a line)");
      if (isIdentStart(c)) {
        this.scanIdentOrBinary();
        continue;
      }
      if (isDigit(c) || (c === '.' && isDigit(this.peek(1)))) {
        this.scanNumber();
        continue;
      }
      if (c === "'") {
        this.scanChar();
        continue;
      }
      if (c === '"') {
        this.scanString();
        continue;
      }
      if (this.scanPunct()) continue;
      throw this.error(`unexpected character '${c}'`);
    }
    this.push('eof', '', this.line, this.column);
    return this.tokens;
  }

  private atLineStart(): boolean {
    let i = this.pos - 1;
    while (i >= 0) {
      const c = this.src[i];
      if (c === '\n') return true;
      if (c !== ' ' && c !== '\t' && c !== '\r') return false;
      i--;
    }
    return true;
  }

  private skipLineComment(): void {
    while (this.pos < this.src.length && this.peek() !== '\n') this.advance();
  }

  private skipBlockComment(): void {
    const line = this.line;
    const column = this.column;
    this.advance(2);
    while (this.pos < this.src.length && !(this.peek() === '*' && this.peek(1) === '/')) this.advance();
    if (this.pos >= this.src.length) throw this.error('unterminated comment', line, column);
    this.advance(2);
  }

  /** Whole directive line, with `\` continuations joined and `//` comments stripped. */
  private scanDirective(): void {
    const line = this.line;
    const column = this.column;
    let text = '';
    let inString: string | null = null;
    while (this.pos < this.src.length) {
      const c = this.peek();
      if (c === '\\' && (this.peek(1) === '\n' || (this.peek(1) === '\r' && this.peek(2) === '\n'))) {
        this.advance(this.peek(1) === '\r' ? 3 : 2);
        text += ' ';
        continue;
      }
      if (c === '\n') break;
      if (inString) {
        if (c === '\\') {
          text += c + this.peek(1);
          this.advance(2);
          continue;
        }
        if (c === inString) inString = null;
        text += c;
        this.advance();
        continue;
      }
      if (c === '"' || c === "'") inString = c;
      if (c === '/' && this.peek(1) === '/') {
        this.skipLineComment();
        break;
      }
      if (c === '/' && this.peek(1) === '*') {
        this.skipBlockComment();
        text += ' ';
        continue;
      }
      text += c;
      this.advance();
    }
    this.push('directive', text.replace(/\r/g, '').trim(), line, column);
  }

  private scanIdentOrBinary(): void {
    const line = this.line;
    const column = this.column;
    let text = '';
    while (isIdentChar(this.peek())) {
      text += this.peek();
      this.advance();
    }
    // Arduino binary constants: B0 .. B11111111
    if (/^B[01]{1,8}$/.test(text)) {
      this.push('int', text, line, column, { num: parseInt(text.slice(1), 2), unsigned: false, long: false });
      return;
    }
    this.push(KEYWORDS.has(text) ? 'keyword' : 'ident', text, line, column);
  }

  private scanNumber(): void {
    const line = this.line;
    const column = this.column;
    const start = this.pos;
    let isFloat = false;
    let value: number;

    if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
      this.advance(2);
      const digitsStart = this.pos;
      while (isHexDigit(this.peek())) this.advance();
      if (this.pos === digitsStart) throw this.error('invalid hexadecimal number', line, column);
      value = parseInt(this.src.slice(digitsStart, this.pos), 16);
    } else if (this.peek() === '0' && (this.peek(1) === 'b' || this.peek(1) === 'B')) {
      this.advance(2);
      const digitsStart = this.pos;
      while (this.peek() === '0' || this.peek() === '1') this.advance();
      if (this.pos === digitsStart) throw this.error('invalid binary number', line, column);
      value = parseInt(this.src.slice(digitsStart, this.pos), 2);
    } else {
      while (isDigit(this.peek())) this.advance();
      if (this.peek() === '.' && this.peek(1) !== '.') {
        isFloat = true;
        this.advance();
        while (isDigit(this.peek())) this.advance();
      }
      if ((this.peek() === 'e' || this.peek() === 'E') && (isDigit(this.peek(1)) || ((this.peek(1) === '+' || this.peek(1) === '-') && isDigit(this.peek(2))))) {
        isFloat = true;
        this.advance(2);
        while (isDigit(this.peek())) this.advance();
      }
      const text = this.src.slice(start, this.pos);
      if (isFloat) {
        value = parseFloat(text);
      } else if (text.length > 1 && text[0] === '0' && /^[0-7]+$/.test(text)) {
        value = parseInt(text, 8);
      } else {
        value = parseInt(text, 10);
      }
    }

    // suffixes
    let unsigned = false;
    let long = false;
    if (isFloat) {
      if (this.peek() === 'f' || this.peek() === 'F' || this.peek() === 'l' || this.peek() === 'L') this.advance();
    } else {
      for (let i = 0; i < 3; i++) {
        const c = this.peek();
        if (c === 'u' || c === 'U') {
          unsigned = true;
          this.advance();
        } else if (c === 'l' || c === 'L') {
          long = true;
          this.advance();
        } else {
          break;
        }
      }
    }
    if (isIdentChar(this.peek())) {
      throw this.error(`invalid suffix "${this.peek()}" on number`, line, column);
    }
    const text = this.src.slice(start, this.pos);
    if (isFloat) this.push('float', text, line, column, { num: value });
    else this.push('int', text, line, column, { num: value, unsigned, long });
  }

  /** Reads one (possibly escaped) character inside a quoted literal; returns its code. */
  private readCharCode(quote: string): number {
    const c = this.peek();
    if (c === '' || c === '\n') throw this.error(`missing terminating ${quote} character`);
    if (c !== '\\') {
      this.advance();
      return c.codePointAt(0) ?? 0;
    }
    this.advance();
    const e = this.peek();
    if (e === 'x') {
      this.advance();
      let hex = '';
      while (isHexDigit(this.peek()) && hex.length < 2) {
        hex += this.peek();
        this.advance();
      }
      if (!hex) throw this.error('\\x used with no following hex digits');
      return parseInt(hex, 16);
    }
    if (e >= '0' && e <= '7') {
      let oct = '';
      while (this.peek() >= '0' && this.peek() <= '7' && oct.length < 3) {
        oct += this.peek();
        this.advance();
      }
      return parseInt(oct, 8) & 0xff;
    }
    const code = SIMPLE_ESCAPES[e];
    if (code === undefined) throw this.error(`unknown escape sequence '\\${e}'`);
    this.advance();
    return code;
  }

  private scanChar(): void {
    const line = this.line;
    const column = this.column;
    this.advance();
    if (this.peek() === "'") throw this.error('empty character constant', line, column);
    const code = this.readCharCode("'");
    if (this.peek() !== "'") {
      throw this.error("character constant too long (use double quotes \" for text)", line, column);
    }
    this.advance();
    this.push('char', String.fromCharCode(code), line, column, { num: code });
  }

  private scanString(): void {
    const line = this.line;
    const column = this.column;
    this.advance();
    let text = '';
    while (this.peek() !== '"') {
      const code = this.readCharCode('"');
      text += String.fromCodePoint(code);
    }
    this.advance();
    this.push('string', text, line, column);
  }

  private scanPunct(): boolean {
    for (const p of PUNCTUATORS) {
      if (this.src.startsWith(p, this.pos)) {
        const line = this.line;
        const column = this.column;
        this.advance(p.length);
        this.push('punct', p, line, column);
        return true;
      }
    }
    return false;
  }
}

/** Tokenize a sketch. Throws ParseError on malformed input. */
export function tokenize(source: string): Token[] {
  return new Scanner(source).scan();
}
