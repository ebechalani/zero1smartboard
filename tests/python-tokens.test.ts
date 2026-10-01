/**
 * The tokenizer of Python mode (docs/PYTHON.md §2.2, §4.3, §10.1): line structure (NEWLINE /
 * INDENT / DEDENT, joining, comments), numbers, strings, f-strings, the characters pasted from
 * documents, C habits, and every lexical error with its exact message and position.
 */
import { describe, expect, it } from 'vitest';
import { PYTHON_KEYWORDS, C_HABIT_NAMES, PythonSyntaxError, normalize, tokenize, type Token } from '../src/python/tokens';
import { message } from '../src/python/messages';

/** "KIND(text)" for every token but EOF, e.g. ['NAME(x)', 'OP(=)', 'NUMBER(1)', 'NEWLINE']. */
function kinds(source: string, withComments = false): string[] {
  return tokenize(source)
    .filter((t) => t.kind !== 'EOF' && (withComments || t.kind !== 'COMMENT'))
    .map((t) => (t.text ? `${t.kind}(${t.text})` : t.kind));
}

const at = (t: Token) => [t.line, t.column, t.endLine, t.endColumn];
const find = (source: string, kind: Token['kind'], text?: string) => tokenize(source).find((t) => t.kind === kind && (text === undefined || t.text === text))!;
const number = (literal: string) => find(`x = ${literal}\n`, 'NUMBER').number!;
const string = (literal: string) => find(`x = ${literal}\n`, 'STRING').string!;

/** The error tokenize() throws: code, message and [line, column, endLine, endColumn]. */
function lexError(source: string): { code: string; message: string; at: number[] } {
  try {
    tokenize(source);
  } catch (err) {
    if (err instanceof PythonSyntaxError) return { code: err.code, message: err.message, at: [err.line, err.column, err.endLine, err.endColumn] };
    throw err;
  }
  throw new Error(`no error for ${JSON.stringify(source)}`);
}

describe('line structure', () => {
  it('NEWLINE, INDENT and DEDENT on nested blocks', () => {
    expect(kinds('if a:\n    if b:\n        x = 1\n    y = 2\nz = 3\n')).toEqual([
      'NAME(if)', 'NAME(a)', 'OP(:)', 'NEWLINE',
      'INDENT', 'NAME(if)', 'NAME(b)', 'OP(:)', 'NEWLINE',
      'INDENT', 'NAME(x)', 'OP(=)', 'NUMBER(1)', 'NEWLINE',
      'DEDENT', 'NAME(y)', 'OP(=)', 'NUMBER(2)', 'NEWLINE',
      'DEDENT', 'NAME(z)', 'OP(=)', 'NUMBER(3)', 'NEWLINE',
    ]);
  });
  it('closes every open block at the end, also without a final newline', () => {
    expect(kinds('while True:\n    if x:\n        pass')).toEqual([
      'NAME(while)', 'NAME(True)', 'OP(:)', 'NEWLINE', 'INDENT', 'NAME(if)', 'NAME(x)', 'OP(:)', 'NEWLINE', 'INDENT', 'NAME(pass)', 'NEWLINE', 'DEDENT', 'DEDENT',
    ]);
    expect(tokenize('').map((t) => t.kind)).toEqual(['EOF']);
    expect(tokenize('\n\n# only a comment\n').map((t) => t.kind)).toEqual(['COMMENT', 'EOF']);
  });
  it('blank and comment-only lines do not count for indentation', () => {
    expect(kinds('if a:\n\n    x = 1\n  # a comment at another indentation\n\n    y = 2\n')).toEqual([
      'NAME(if)', 'NAME(a)', 'OP(:)', 'NEWLINE', 'INDENT', 'NAME(x)', 'OP(=)', 'NUMBER(1)', 'NEWLINE', 'NAME(y)', 'OP(=)', 'NUMBER(2)', 'NEWLINE', 'DEDENT',
    ]);
  });
  it('joins lines after a backslash and inside brackets', () => {
    expect(kinds('x = 1 + \\\n    2\n')).toEqual(['NAME(x)', 'OP(=)', 'NUMBER(1)', 'OP(+)', 'NUMBER(2)', 'NEWLINE']);
    expect(kinds('x = [1,\n  2,\n        3]\nprint(x,\n  end="")\n')).toEqual([
      'NAME(x)', 'OP(=)', 'OP([)', 'NUMBER(1)', 'OP(,)', 'NUMBER(2)', 'OP(,)', 'NUMBER(3)', 'OP(])', 'NEWLINE',
      'NAME(print)', 'OP(()', 'NAME(x)', 'OP(,)', 'NAME(end)', 'OP(=)', 'STRING("")', 'OP())', 'NEWLINE',
    ]);
  });
  it('keeps ; separators, a trailing ; and one-line suites', () => {
    expect(kinds('a = 1; b = 2;\nwhile True: pass\n')).toEqual([
      'NAME(a)', 'OP(=)', 'NUMBER(1)', 'OP(;)', 'NAME(b)', 'OP(=)', 'NUMBER(2)', 'OP(;)', 'NEWLINE', 'NAME(while)', 'NAME(True)', 'OP(:)', 'NAME(pass)', 'NEWLINE',
    ]);
  });
  it('comments are trivia with their column; own-line comments know their indentation', () => {
    const tokens = tokenize('x = 1  # one\nif x:\n    # inside\n    pass\n');
    const comments = tokens.filter((t) => t.kind === 'COMMENT');
    expect(comments.map((c) => [c.text, c.ownLine, c.indent, ...at(c)])).toEqual([
      ['# one', false, undefined, 1, 8, 1, 13],
      ['# inside', true, 4, 3, 5, 3, 13],
    ]);
    const bracketed = tokenize('x = [1,  # one\n  # two\n  2]\n').filter((t) => t.kind === 'COMMENT');
    expect(bracketed.map((c) => c.ownLine)).toEqual([false, false]); // inside brackets: part of the statement
  });
  it('NEWLINE sits right after the last token of the line; INDENT and DEDENT at the first token of the next', () => {
    const tokens = tokenize('if x:   # c\n    y = 1\nz = 2\n');
    expect(at(tokens.find((t) => t.kind === 'NEWLINE')!)).toEqual([1, 6, 1, 6]);
    expect(at(tokens.find((t) => t.kind === 'INDENT')!)).toEqual([2, 5, 2, 5]);
    expect(tokens.find((t) => t.kind === 'INDENT')!.indent).toBe(4);
    expect(at(tokens.find((t) => t.kind === 'DEDENT')!)).toEqual([3, 1, 3, 1]);
  });
  it('the keywords are the 35 of Python 3.12 (match and case stay names)', () => {
    expect(PYTHON_KEYWORDS.size).toBe(35);
    for (const soft of ['match', 'case', '_', 'print', 'type']) expect(PYTHON_KEYWORDS.has(soft)).toBe(false);
  });
});

describe('source normalisation', () => {
  it('CRLF and lone CR become LF, a byte-order mark is dropped', () => {
    expect(normalize('\uFEFFa\r\nb\rc\n')).toBe('a\nb\nc\n');
    expect(normalize('x = "\uFEFF"')).toBe('x = "\uFEFF"'); // only a leading one
  });
  it('positions are the same as with LF', () => {
    const lf = tokenize('if x:\n    y = "é"\n');
    expect(tokenize('if x:\r\n    y = "é"\r\n')).toEqual(lf);
    expect(tokenize('if x:\r    y = "é"\r')).toEqual(lf);
    expect(tokenize('\uFEFFif x:\n    y = "é"\n')).toEqual(lf);
  });
});

describe('indentation with tabs (CPython rules, §2.2)', () => {
  it('a tab advances to the next multiple of 8', () => {
    expect(find('if x:\n\tpass\n', 'INDENT').indent).toBe(8);
    expect(find('if x:\n  \tpass\n', 'INDENT').indent).toBe(8);
    expect(kinds('if x:\n\tif y:\n\t\tpass\n\tpass\n')).toContain('DEDENT');
  });
  it('TabError when the comparison with tab size 1 disagrees (like CPython 3.11: a tab then 8 spaces too)', () => {
    const tab = message('S-tab');
    expect(lexError('if x:\n    pass\n\tpass\n')).toEqual({ code: 'S-tab', message: tab, at: [3, 1, 3, 2] });
    expect(lexError('if x:\n\tpass\n        pass\n')).toEqual({ code: 'S-tab', message: tab, at: [3, 1, 3, 9] });
    expect(lexError('if x:\n    if y:\n\tpass\n')).toMatchObject({ code: 'S-tab', at: [3, 1, 3, 2] });
  });
  it('a dedent to an unknown level is S-unindent (a tab, then 4 spaces)', () => {
    expect(lexError('if x:\n\tpass\n    pass\n')).toEqual({ code: 'S-unindent', message: 'IndentationError: unindent does not match any outer indentation level', at: [3, 1, 3, 5] });
    expect(lexError('if x:\n        a\n    b\n')).toMatchObject({ code: 'S-unindent', at: [3, 1, 3, 5] });
  });
});

describe('numbers', () => {
  it('reads every accepted form', () => {
    expect(number('0')).toEqual({ value: 0, isFloat: false, imaginary: false, base: 10 });
    expect(number('00')).toEqual({ value: 0, isFloat: false, imaginary: false, base: 10 });
    expect(number('0_0')).toMatchObject({ value: 0 });
    expect(number('42')).toMatchObject({ value: 42, isFloat: false });
    expect(number('1_000')).toMatchObject({ value: 1000, isFloat: false, base: 10 });
    expect(number('0x3F')).toEqual({ value: 63, isFloat: false, imaginary: false, base: 16 });
    expect(number('0X_3f')).toMatchObject({ value: 63, base: 16 });
    expect(number('0o17')).toEqual({ value: 15, isFloat: false, imaginary: false, base: 8 });
    expect(number('0b0101')).toEqual({ value: 5, isFloat: false, imaginary: false, base: 2 });
    expect(number('0B1_0')).toMatchObject({ value: 2, base: 2 });
    expect(number('1.')).toEqual({ value: 1, isFloat: true, imaginary: false, base: 10 });
    expect(number('.5')).toMatchObject({ value: 0.5, isFloat: true });
    expect(number('5.')).toMatchObject({ value: 5, isFloat: true });
    expect(number('1e3')).toMatchObject({ value: 1000, isFloat: true });
    expect(number('1.5e-3')).toMatchObject({ value: 0.0015, isFloat: true });
    expect(number('1E+30')).toMatchObject({ value: 1e30, isFloat: true });
    expect(number('1_000.5')).toMatchObject({ value: 1000.5, isFloat: true });
    expect(number('007.5')).toMatchObject({ value: 7.5, isFloat: true });
    expect(find('x = 0x3F\n', 'NUMBER').text).toBe('0x3F');
  });
  it('marks imaginary numbers (NA-complex in the parser)', () => {
    expect(number('1j')).toEqual({ value: 1, isFloat: false, imaginary: true, base: 10 });
    expect(number('1.5J')).toMatchObject({ value: 1.5, imaginary: true });
    expect(number('07j')).toMatchObject({ value: 7, imaginary: true });
  });
  it('keeps big ints exact to 2^53 (E-big-int is found after folding a leading -)', () => {
    expect(number('2147483647')).toMatchObject({ value: 2147483647 });
    expect(number('2147483648')).toMatchObject({ value: 2147483648 });
    expect(kinds('x = -2147483648\n')).toEqual(['NAME(x)', 'OP(=)', 'OP(-)', 'NUMBER(2147483648)', 'NEWLINE']);
    expect(number('0xFFFFFFFFFF')).toMatchObject({ value: 0xffffffffff });
  });
  it('a keyword may follow a number directly, like CPython', () => {
    expect(kinds('x = 1if y else 2\n')).toEqual(['NAME(x)', 'OP(=)', 'NUMBER(1)', 'NAME(if)', 'NAME(y)', 'NAME(else)', 'NUMBER(2)', 'NEWLINE']);
  });
  it('S-leading-zero for 007 (C++ would read it as octal)', () => {
    const text = 'SyntaxError: leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers';
    expect(lexError('x = 007\n')).toEqual({ code: 'S-leading-zero', message: text, at: [1, 5, 1, 8] });
    expect(lexError('x = 0_7\n')).toMatchObject({ code: 'S-leading-zero', at: [1, 5, 1, 8] });
    expect(lexError('x = 09\n')).toMatchObject({ code: 'S-leading-zero' });
  });
  it('invalid literals are S-syntax', () => {
    expect(lexError('x = 1_\n')).toMatchObject({ code: 'S-syntax', at: [1, 6, 1, 7] });
    expect(lexError('x = 1__0\n')).toMatchObject({ code: 'S-syntax', at: [1, 6, 1, 7] });
    expect(lexError('x = 0x\n')).toMatchObject({ code: 'S-syntax', at: [1, 5, 1, 7] });
    expect(lexError('x = 0b12\n')).toMatchObject({ code: 'S-syntax', at: [1, 8, 1, 9] });
    expect(lexError('x = 0o8\n')).toMatchObject({ code: 'S-syntax' });
    expect(lexError('x = 1e\n')).toMatchObject({ code: 'S-syntax', at: [1, 5, 1, 7] });
    expect(lexError('x = 12abc\n')).toEqual({ code: 'S-syntax', message: 'SyntaxError: invalid syntax', at: [1, 5, 1, 10] });
  });
});

describe('strings', () => {
  it('every quote kind and prefix', () => {
    expect(string("'a'")).toMatchObject({ value: 'a', prefix: '', raw: false, bytes: false, triple: false });
    expect(string('"a"')).toMatchObject({ value: 'a' });
    expect(string("'''a\nb'''")).toMatchObject({ value: 'a\nb', triple: true });
    expect(string('"""a"b"""')).toMatchObject({ value: 'a"b', triple: true });
    expect(string("u'a'")).toMatchObject({ value: 'a', prefix: 'u' });
    expect(string("R'\\d'")).toMatchObject({ value: '\\d', prefix: 'R', raw: true, escapes: [] });
    expect(string("'it\\'s'")).toMatchObject({ value: "it's" });
    for (const prefix of ['f', 'F', 'rf', 'fR', 'Rf', 'FR']) expect(find(`x = ${prefix}'a'\n`, 'FSTRING').fstring!.prefix).toBe(prefix);
  });
  it('bytes are marked (NA-bytes in the parser)', () => {
    expect(string("b'ab'")).toMatchObject({ bytes: true, value: 'ab' });
    expect(string("Rb'\\x'")).toMatchObject({ bytes: true, raw: true });
  });
  it('works out the escapes', () => {
    expect(string(String.raw`'\\ \' \" \a \b \f \n \r \t \v'`).value).toBe('\\ \' " \x07 \b \f \n \r \t \v');
    expect(string(String.raw`'\x41\u00e9\U0001F600\101\0'`).value).toBe('Aé\u{1F600}A\0');
    expect(string("'a\\\nb'").value).toBe('ab'); // backslash-newline continues the text
  });
  it('an unknown escape keeps its backslash and is noted (W-escape)', () => {
    const s = string(String.raw`"C:\data\d"`);
    expect(s.value).toBe(String.raw`C:\data\d`);
    expect(s.escapes).toEqual([
      { kind: 'unknown', text: '\\d', line: 1, column: 8, endLine: 1, endColumn: 10 },
      { kind: 'unknown', text: '\\d', line: 1, column: 13, endLine: 1, endColumn: 15 },
    ]);
  });
  it('\\N{…} is noted (NA-escape-N)', () => {
    const s = string(String.raw`"20\N{DEGREE SIGN}C"`);
    expect(s.escapes).toEqual([{ kind: 'N', text: '\\N{DEGREE SIGN}', line: 1, column: 8, endLine: 1, endColumn: 23 }]);
  });
  it('malformed escapes are S-syntax at the escape', () => {
    expect(lexError(String.raw`x = "\x4"` + '\n')).toMatchObject({ code: 'S-syntax', at: [1, 6, 1, 9] });
    expect(lexError(String.raw`x = "\u12"` + '\n')).toMatchObject({ code: 'S-syntax', at: [1, 6, 1, 10] });
    expect(lexError(String.raw`x = "\N"` + '\n')).toMatchObject({ code: 'S-syntax', at: [1, 6, 1, 8] });
  });
  it('adjacent literals are separate tokens (the parser concatenates them)', () => {
    expect(kinds('x = "ab" \'cd\' f"{e}"\n')).toEqual(['NAME(x)', 'OP(=)', 'STRING("ab")', "STRING('cd')", 'FSTRING(f"{e}")', 'NEWLINE']);
  });
  it('unterminated strings: the exact messages, at the start of the literal', () => {
    expect(lexError("x = 'abc\ny = 2\n")).toEqual({ code: 'S-unterminated', message: 'SyntaxError: unterminated string literal (detected at line 1)', at: [1, 5, 1, 6] });
    expect(lexError('print("hi)')).toMatchObject({ code: 'S-unterminated', at: [1, 7, 1, 8] });
    expect(lexError('x = (1,\ny = f"abc\n')).toMatchObject({ code: 'S-unterminated', message: 'SyntaxError: unterminated string literal (detected at line 2)', at: [2, 5, 2, 6] });
    expect(lexError("x = 'a\\\n")).toMatchObject({ code: 'S-unterminated', message: 'SyntaxError: unterminated string literal (detected at line 1)' });
    expect(lexError('x = """abc\n\nmore\n')).toEqual({
      code: 'S-unterminated-triple',
      message: 'SyntaxError: unterminated triple-quoted string literal (detected at line 3)',
      at: [1, 5, 1, 6],
    });
    expect(lexError("x = r'''a")).toMatchObject({ code: 'S-unterminated-triple', message: 'SyntaxError: unterminated triple-quoted string literal (detected at line 1)' });
  });
});

describe('characters outside text', () => {
  it('Unicode letters make names; text may hold anything', () => {
    expect(kinds('print("Lumière allumée")\ntempérature = 25\n')).toEqual(['NAME(print)', 'OP(()', 'STRING("Lumière allumée")', 'OP())', 'NEWLINE', 'NAME(température)', 'OP(=)', 'NUMBER(25)', 'NEWLINE']);
    expect(kinds('حرارة = 1\n')[0]).toBe('NAME(حرارة)');
    expect(find('# é “ ” € \u00a0\nx = 1\n', 'COMMENT').text).toBe('# é “ ” € \u00a0');
  });
  it('U+00A0 is S-nbsp, at the character', () => {
    expect(lexError('x\u00a0= 1\n')).toEqual({
      code: 'S-nbsp',
      message: 'SyntaxError: invalid non-printable character U+00A0. It is an invisible space copied from a document: delete it and type a normal space.',
      at: [1, 2, 1, 3],
    });
    expect(lexError('if x:\n    y = 1 +\u00a02\n')).toMatchObject({ code: 'S-nbsp', at: [2, 12, 2, 13] });
  });
  it('curly quotes are S-curly-quote', () => {
    expect(lexError('x = “hi”\n')).toEqual({ code: 'S-curly-quote', message: 'SyntaxError: invalid character \'“\' (U+201C). Use straight quotes: " or \'.', at: [1, 5, 1, 6] });
    for (const [q, hex] of [['‘', '2018'], ['’', '2019'], ['”', '201D'], ['„', '201E']]) {
      expect(lexError(`x = ${q}a\n`)).toMatchObject({ code: 'S-curly-quote', message: `SyntaxError: invalid character '${q}' (U+${hex}). Use straight quotes: " or '.` });
    }
  });
  it('any other stray character is S-invalid-char', () => {
    expect(lexError('x = 5 €\n')).toEqual({ code: 'S-invalid-char', message: "SyntaxError: invalid character '€' (U+20AC)", at: [1, 7, 1, 8] });
    expect(lexError('x = $\n')).toMatchObject({ code: 'S-invalid-char', message: "SyntaxError: invalid character '$' (U+0024)" });
    expect(lexError('x = 5 ?\n')).toMatchObject({ code: 'S-invalid-char', at: [1, 7, 1, 8] });
    expect(lexError('x = 😀\n')).toMatchObject({ code: 'S-invalid-char', message: "SyntaxError: invalid character '😀' (U+1F600)", at: [1, 5, 1, 7] });
  });
});

describe('brackets', () => {
  it("S-never-closed at the innermost open bracket, S-unmatched at a stray closing one", () => {
    expect(lexError('x = (1,\n')).toEqual({ code: 'S-never-closed', message: "SyntaxError: '(' was never closed", at: [1, 5, 1, 6] });
    expect(lexError('x = (1, [2,\n')).toMatchObject({ code: 'S-never-closed', message: "SyntaxError: '[' was never closed", at: [1, 9, 1, 10] });
    expect(lexError('if x:\n    y = {\n')).toMatchObject({ code: 'S-never-closed', message: "SyntaxError: '{' was never closed", at: [2, 9, 2, 10] });
    expect(lexError('x = 1)\n')).toEqual({ code: 'S-unmatched', message: "SyntaxError: unmatched ')'", at: [1, 6, 1, 7] });
    expect(lexError('x = ]\n')).toMatchObject({ code: 'S-unmatched', message: "SyntaxError: unmatched ']'" });
  });
  it('a closing bracket of the wrong kind: the open one was never closed', () => {
    expect(lexError('print(a[1)\n')).toMatchObject({ code: 'S-never-closed', message: "SyntaxError: '[' was never closed", at: [1, 8, 1, 9] });
  });
  it("CPython's limits: 200 nested brackets and 100 indentation levels (a SyntaxError, never a stack overflow)", () => {
    expect(() => tokenize(`x = ${'('.repeat(200)}1${')'.repeat(200)}\n`)).not.toThrow();
    expect(lexError(`x = ${'('.repeat(201)}1${')'.repeat(201)}\n`)).toMatchObject({ code: 'S-syntax', at: [1, 205, 1, 206] });
    const nested = (levels: number) => Array.from({ length: levels }, (_, d) => `${' '.repeat(d)}if x:\n`).join('') + `${' '.repeat(levels)}pass\n`;
    expect(() => tokenize(nested(100))).not.toThrow();
    expect(lexError(nested(101))).toMatchObject({ code: 'S-syntax', at: [102, 1, 102, 102] });
  });
});

describe('line continuation', () => {
  it('a backslash must end the line; one at the very end is an error', () => {
    expect(lexError('x = 1 \\ 2\n')).toMatchObject({ code: 'S-syntax', at: [1, 8, 1, 9] });
    expect(lexError('x = 1\\\n')).toMatchObject({ code: 'S-syntax', at: [1, 6, 1, 7] });
  });
});

describe('f-strings', () => {
  const parts = (source: string) => find(source, 'FSTRING').fstring!.parts;
  it('literal parts, {{ and }}, fields with their own tokens and positions, specs as text', () => {
    const p = parts('print(f"T = {t:.1f} C {{ok}} {a + b}")\n');
    expect(p.map((x) => x.type)).toEqual(['text', 'field', 'text', 'field']);
    expect(p[0]).toMatchObject({ type: 'text', value: 'T = ', line: 1, column: 9, endColumn: 13 });
    expect(p[1]).toMatchObject({ type: 'field', spec: { text: '.1f', line: 1, column: 16, endColumn: 19 }, unsupported: null, line: 1, column: 13, endColumn: 20 });
    expect(p[2]).toMatchObject({ type: 'text', value: ' C {ok} ' });
    const field = p[3];
    if (field.type !== 'field') throw new Error('field expected');
    expect(field.tokens.map((t) => `${t.kind}(${t.text})@${t.column}`)).toEqual(['NAME(a)@31', 'OP(+)@33', 'NAME(b)@35', 'EOF()@36']);
    expect(field.spec).toBeNull();
  });
  it('the other quote kind inside a field; any quote inside a triple-quoted f-string; fields over several lines', () => {
    const p = parts('x = f"{d[\'k\']}"\n');
    expect(p[0].type === 'field' && p[0].tokens.map((t) => t.text)).toEqual(['d', '[', "'k'", ']', '']);
    const multi = parts('x = f"""{\na\n}"""\n');
    expect(multi[0].type === 'field' && multi[0].tokens.map((t) => [t.text, t.line])).toEqual([['a', 2], ['', 3]]);
    const triple = parts('x = f"""{"a"}"""\n');
    expect(triple[0].type === 'field' && triple[0].tokens[0].string!.value).toBe('a');
  });
  it('escapes in the literal parts; raw f-strings keep them', () => {
    expect(parts('x = f"a\\tb{c}"\n')[0]).toMatchObject({ value: 'a\tb' });
    expect(parts('x = rf"a\\tb{c}"\n')[0]).toMatchObject({ value: 'a\\tb' });
    expect(parts('x = f"\\N{DEGREE SIGN}{t}"\n')[0]).toMatchObject({ type: 'text', escapes: [{ kind: 'N' }] });
  });
  it('!r / !s / !a, {x=} and a {…} inside the spec are noted (NA-fstring-spec)', () => {
    expect(parts('x = f"{v!r}"\n')[0]).toMatchObject({ unsupported: { text: '!r', column: 9, endColumn: 11 } });
    expect(parts('x = f"{v!s:>5}"\n')[0]).toMatchObject({ unsupported: { text: '!s' }, spec: { text: '>5' } });
    expect(parts('x = f"{v=}"\n')[0]).toMatchObject({ unsupported: { text: '=', column: 9, endColumn: 10 } });
    expect(parts('x = f"{v = }"\n')[0]).toMatchObject({ unsupported: { text: '=' } });
    expect(parts('x = f"{v:{w}}"\n')[0]).toMatchObject({ unsupported: { text: '{w}' }, spec: { text: '{w}' } });
    expect(parts('x = f"{a == b} {a != b} {a <= b}"\n').filter((q) => q.type === 'field').map((q) => q.type === 'field' && q.unsupported)).toEqual([null, null, null]);
  });
  it('errors inside a field point into the field', () => {
    expect(lexError('x = f"{a $ b}"\n')).toMatchObject({ code: 'S-invalid-char', at: [1, 10, 1, 11] });
    expect(lexError('x = f"{}"\n')).toMatchObject({ code: 'S-syntax', at: [1, 7, 1, 9] });
    expect(lexError('x = f"{ }"\n')).toMatchObject({ code: 'S-syntax', at: [1, 7, 1, 10] });
    expect(lexError('x = f"a}"\n')).toMatchObject({ code: 'S-syntax', at: [1, 8, 1, 9] });
    expect(lexError('x = f"{a"\n')).toMatchObject({ code: 'S-syntax', at: [1, 7, 1, 9] });
    expect(lexError('x = f"{a\\n}"\n')).toMatchObject({ code: 'S-syntax', at: [1, 9, 1, 10] });
    expect(lexError('x = f"{a#}"\n')).toMatchObject({ code: 'S-syntax', at: [1, 9, 1, 10] });
    expect(lexError('x = f"{a!}"\n')).toMatchObject({ code: 'S-syntax' });
    expect(lexError('x = f"{(a}"\n')).toMatchObject({ code: 'S-syntax' });
  });
});

describe('C habits (§4.3)', () => {
  it('x++ and x-- are S-plusplus', () => {
    const text = 'SyntaxError: invalid syntax. Python has no ++ or --: write x += 1';
    expect(lexError('x++\n')).toEqual({ code: 'S-plusplus', message: text, at: [1, 2, 1, 4] });
    expect(lexError('count--  # down\n')).toMatchObject({ code: 'S-plusplus', at: [1, 6, 1, 8] });
    expect(lexError('while True:\n    n++;\n')).toMatchObject({ code: 'S-plusplus', at: [2, 6, 2, 8] });
    expect(lexError('f(a[i]++)\n')).toMatchObject({ code: 'S-plusplus', at: [1, 7, 1, 9] });
    expect(kinds('x = a ++b\ny = 1 - -2\n')).toContain('NAME(b)'); // unary signs stay legal
  });
  it('&&, || and ! are S-c-operator', () => {
    const text = 'SyntaxError: invalid syntax. In Python, && is written and, || is written or, ! is written not.';
    expect(lexError('if a && b:\n    pass\n')).toEqual({ code: 'S-c-operator', message: text, at: [1, 6, 1, 8] });
    expect(lexError('if a || b:\n    pass\n')).toMatchObject({ code: 'S-c-operator', at: [1, 6, 1, 8] });
    expect(lexError('if !done:\n    pass\n')).toMatchObject({ code: 'S-c-operator', at: [1, 4, 1, 5] });
    expect(kinds('x = a != b\n')).toContain('OP(!=)');
  });
  it('// at the start of a line is S-c-comment (elsewhere it is floor division)', () => {
    expect(lexError('// blink the LED\nx = 1\n')).toEqual({ code: 'S-c-comment', message: 'SyntaxError: invalid syntax. Comments in Python start with #, not //.', at: [1, 1, 1, 17] });
    expect(lexError('if x:\n    // note   \n')).toMatchObject({ code: 'S-c-comment', at: [2, 5, 2, 12] });
    expect(kinds('x = 7 // 2\n')).toContain('OP(//)');
  });
  it('{ after a condition or a def is S-brace', () => {
    const text = 'SyntaxError: invalid syntax. Python uses a colon and indentation instead of { }: if x > 5:';
    expect(lexError('if x > 5 {\n    y = 1\n}\n')).toEqual({ code: 'S-brace', message: text, at: [1, 10, 1, 11] });
    expect(lexError('while (x < 5) {  // loop\n')).toMatchObject({ code: 'S-brace', at: [1, 15, 1, 16] });
    expect(lexError('def f() {\n')).toMatchObject({ code: 'S-brace' });
    expect(lexError('else {\n')).toMatchObject({ code: 'S-brace' });
    expect(lexError('if x { y = 1; }\n')).toMatchObject({ code: 'S-brace', at: [1, 6, 1, 7] });
    expect(kinds('if x in {1, 2}:\n    pass\n')).toContain('OP({)'); // a set display is not a brace (NA-dict later)
    expect(kinds('x = {\n}\n')).toContain('OP({)');
  });
  it('true / false / null / none are names; their Python spellings are known for E-name-true', () => {
    expect(kinds('x = true\n')).toEqual(['NAME(x)', 'OP(=)', 'NAME(true)', 'NEWLINE']);
    expect(C_HABIT_NAMES).toEqual({ true: 'True', false: 'False', null: 'None', none: 'None' });
    expect(message('E-name-true', { x: 'true', y: C_HABIT_NAMES.true })).toBe("NameError: name 'true' is not defined. Did you mean: 'True'?");
  });
});
