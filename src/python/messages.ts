/**
 * Every student-facing text of Python mode (docs/PYTHON.md §5), keyed by a stable code that the
 * translator puts on its diagnostics and that tests assert on.
 *
 * `MessageCode` lists every code of the §5 catalogue; `MESSAGES` has the texts of the front end
 * (every syntax and indentation error of §5.1, the ZERO1 limits the parser marks, the lexical
 * warnings) and those the app needs so far. The analysis stage fills in the rest (then
 * `MESSAGES` becomes a complete `Record<MessageCode, string>`, checked by the meta-tests of
 * §10.2) and gives runtime messages their Python words (§5.9).
 */
import type { ConsoleMessage } from '../types';

/** The code of a message of §5 (S- syntax, E- error, NA- ZERO1 limit, R- runtime stop, W- warning, X- internal). */
export type MessageCode =
  // §5.1 Syntax and indentation
  | 'S-syntax'
  | 'S-comma'
  | 'S-colon'
  | 'S-else-if'
  | 'S-assign-in-if'
  | 'S-never-closed'
  | 'S-unmatched'
  | 'S-unterminated'
  | 'S-unterminated-triple'
  | 'S-leading-zero'
  | 'S-nbsp'
  | 'S-curly-quote'
  | 'S-invalid-char'
  | 'S-plusplus'
  | 'S-c-operator'
  | 'S-c-comment'
  | 'S-brace'
  | 'S-cannot-assign'
  | 'S-return-outside'
  | 'S-break-outside'
  | 'S-continue-outside'
  | 'S-global-after-use'
  | 'S-keyword-repeated'
  | 'S-positional-after-keyword'
  | 'S-default-order'
  | 'S-duplicate-param'
  | 'S-indent-expected'
  | 'S-indent-unexpected'
  | 'S-unindent'
  | 'S-tab'
  // §5.2 Names, imports and attributes
  | 'E-name'
  | 'E-name-true'
  | 'E-name-later'
  | 'E-missing-import'
  | 'E-unbound-local'
  | 'E-module'
  | 'E-import-name'
  | 'E-attr'
  | 'E-attr-object'
  | 'E-attr-int-pin'
  | 'E-class-not-part'
  | 'E-not-callable'
  // §5.3 Kinds and values found before running
  | 'E-concat'
  | 'E-operand'
  | 'E-compare'
  | 'E-index-float'
  | 'E-range-float'
  | 'E-bitop-float'
  | 'E-repeat-float'
  | 'E-len'
  | 'E-not-iterable'
  | 'E-range-value'
  | 'E-range-step'
  | 'E-args-count'
  | 'E-kwarg'
  | 'E-api-kind'
  | 'E-format-code'
  | 'E-format-zero-text'
  | 'E-sleep-ms-float'
  // §5.4 ZERO1 limits
  | 'NA-class'
  | 'NA-try'
  | 'NA-raise'
  | 'NA-with'
  | 'NA-lambda'
  | 'NA-comprehension'
  | 'NA-dict'
  | 'NA-tuple'
  | 'NA-unpack'
  | 'NA-slice'
  | 'NA-nested-def'
  | 'NA-nonlocal'
  | 'NA-generator'
  | 'NA-async'
  | 'NA-decorator'
  | 'NA-annotation'
  | 'NA-star-args'
  | 'NA-default-value'
  | 'NA-none'
  | 'NA-none-value'
  | 'NA-is'
  | 'NA-loop-else'
  | 'NA-del'
  | 'NA-walrus'
  | 'NA-match'
  | 'NA-ellipsis'
  | 'NA-matmul'
  | 'NA-complex'
  | 'NA-bytes'
  | 'NA-escape-N'
  | 'NA-list-method'
  | 'NA-list-size'
  | 'NA-list-value'
  | 'NA-list-param-grow'
  | 'NA-pop-here'
  | 'NA-nested-list'
  | 'NA-str-method'
  | 'NA-str-format'
  | 'NA-str-repeat'
  | 'NA-bool-value'
  | 'NA-chain'
  | 'NA-builtin'
  | 'NA-builtin-arg'
  | 'NA-print-file'
  | 'NA-fstring-spec'
  | 'NA-api'
  | 'NA-object-here'
  | 'NA-object-reassign'
  | 'E-retype'
  | 'E-param-kinds'
  | 'E-return-kinds'
  | 'E-list-kinds'
  // §5.5 Board limits
  | 'E-big-int'
  | 'E-pin'
  | 'E-adc-pin'
  | 'E-i2c-pins'
  | 'E-part-pin'
  | 'E-colour'
  | 'E-scan'
  // §5.6 Runtime stops
  | 'R-index'
  | 'R-str-index'
  | 'R-pop-empty'
  | 'R-pop-index'
  | 'R-zero'
  | 'R-int'
  | 'R-float'
  | 'R-min-empty'
  | 'R-max-empty'
  | 'R-sleep'
  | 'R-list-full'
  | 'R-dht'
  | 'R-sonar'
  | 'R-neg-power'
  | 'R-assert'
  | 'R-raise'
  // §5.7 Warnings
  | 'W-shadow'
  | 'W-global-shadow'
  | 'W-no-effect'
  | 'W-unreachable'
  | 'W-loop-var-changed'
  | 'W-missing-return'
  | 'W-unused-function'
  | 'W-maybe-unassigned'
  | 'W-int-float'
  | 'W-bool-int'
  | 'W-str-num-eq'
  | 'W-sleep-long'
  | 'W-ticks-diff'
  | 'W-pwm-pin'
  | 'W-pwm-freq'
  | 'W-pwm-buzzer'
  | 'W-pwm-servo'
  | 'W-pull-down'
  | 'W-pin-no-out'
  | 'W-echo-timeout'
  | 'W-list-capacity'
  | 'W-memory'
  | 'W-lcd-char'
  | 'W-text-bytes'
  | 'W-escape'
  | 'W-recursion'
  | 'W-sketch'
  // §5.8 Translator-internal
  | 'X-internal'
  | 'X-sketch-error'
  | 'X-too-long'
  | 'X-sketch-too-long'
  | 'X-too-many';

/**
 * The texts, by code. `{name}` is a parameter filled in by message(); other braces (the f-string
 * examples inside a text, such as f"T = {t}") are literal.
 */
export const MESSAGES: { readonly [C in MessageCode]?: string } = {
  // §5.1 Syntax and indentation (tokens.ts, parser.ts; parsing stops at the first one)
  'S-syntax': 'SyntaxError: invalid syntax',
  'S-comma': 'SyntaxError: invalid syntax. Perhaps you forgot a comma?',
  'S-colon': "SyntaxError: expected ':'",
  'S-else-if': "SyntaxError: expected ':'. In Python, else if is written elif: elif x > 5:",
  'S-assign-in-if': "SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='?",
  'S-never-closed': "SyntaxError: '{bracket}' was never closed",
  'S-unmatched': "SyntaxError: unmatched '{bracket}'",
  'S-unterminated': 'SyntaxError: unterminated string literal (detected at line {n})',
  'S-unterminated-triple': 'SyntaxError: unterminated triple-quoted string literal (detected at line {n})',
  'S-leading-zero': 'SyntaxError: leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers',
  'S-nbsp': 'SyntaxError: invalid non-printable character U+00A0. It is an invisible space copied from a document: delete it and type a normal space.',
  'S-curly-quote': 'SyntaxError: invalid character \'{c}\' (U+{hex}). Use straight quotes: " or \'.',
  'S-invalid-char': "SyntaxError: invalid character '{c}' (U+{hex})",
  'S-plusplus': 'SyntaxError: invalid syntax. Python has no ++ or --: write x += 1',
  'S-c-operator': 'SyntaxError: invalid syntax. In Python, && is written and, || is written or, ! is written not.',
  'S-c-comment': 'SyntaxError: invalid syntax. Comments in Python start with #, not //.',
  'S-brace': 'SyntaxError: invalid syntax. Python uses a colon and indentation instead of { }: if x > 5:',
  'S-cannot-assign': "SyntaxError: cannot assign to {what} here. Maybe you meant '==' instead of '='?",
  'S-return-outside': "SyntaxError: 'return' outside function",
  'S-break-outside': "SyntaxError: 'break' outside loop",
  'S-continue-outside': "SyntaxError: 'continue' not properly in loop",
  'S-global-after-use': "SyntaxError: name '{x}' is used prior to global declaration",
  'S-keyword-repeated': 'SyntaxError: keyword argument repeated: {a}',
  'S-positional-after-keyword': 'SyntaxError: positional argument follows keyword argument',
  'S-default-order': 'SyntaxError: parameter without a default follows parameter with a default',
  'S-duplicate-param': "SyntaxError: duplicate argument '{a}' in function definition",
  'S-indent-expected': "IndentationError: expected an indented block after '{kw}' statement on line {n}. Indent the lines inside it by 4 spaces (press Tab).",
  'S-indent-unexpected': 'IndentationError: unexpected indent',
  'S-unindent': 'IndentationError: unindent does not match any outer indentation level',
  'S-tab': 'TabError: inconsistent use of tabs and spaces in indentation',
  // §5.2 Names: C spellings of True / False / None (tokens.ts C_HABIT_NAMES; reported by the resolver)
  'E-name-true': "NameError: name '{x}' is not defined. Did you mean: '{y}'?",
  // §5.4 ZERO1 limits that the parser marks (Unsupported nodes; reported by the checker)
  'NA-class': 'ZERO1 Python does not have classes yet. Use functions and variables instead.',
  'NA-try':
    'ZERO1 Python has try / except only around a sensor reading or int() / float() of text, for example: try: sensor.measure() except OSError: print("no answer")',
  'NA-raise': 'ZERO1 Python does not have raise without an error yet: raise ValueError("too hot")',
  'NA-with': 'ZERO1 Python does not have with yet.',
  'NA-lambda': 'ZERO1 Python does not have lambda yet. Write a small def function instead.',
  'NA-comprehension': 'ZERO1 Python does not have [… for … in …] yet. Make the list first, then fill it in a for loop: squares = [0] * 10',
  'NA-dict': 'ZERO1 Python does not have dictionaries and sets yet. Use lists or separate variables.',
  'NA-unpack': 'ZERO1 Python does not have this unpacking yet. Write a, b = x, y or one assignment per line.',
  'NA-slice': 'ZERO1 Python does not have slices [a:b] yet.',
  'NA-nested-def': "ZERO1 Python does not have a def inside another def yet. Move '{f}' to the left edge of the program.",
  'NA-nonlocal': 'ZERO1 Python does not have nonlocal yet.',
  'NA-generator': 'ZERO1 Python does not have yield (generators) yet.',
  'NA-async': 'ZERO1 Python does not have async / await yet. Use time.sleep() to wait.',
  'NA-decorator': 'ZERO1 Python does not have decorators (@) yet.',
  'NA-annotation': "ZERO1 Python does not have type annotations yet: remove '{annotation}'.",
  'NA-star-args': 'ZERO1 Python does not have *args and **kwargs yet. Pass the values one by one.',
  'NA-none': 'ZERO1 Python does not have None as a value yet. Use 0, -1, "" or False to mean "nothing yet".',
  'NA-is': 'ZERO1 Python does not have is / is not yet. Compare with == or != instead.',
  'NA-loop-else': 'ZERO1 Python does not have else after a loop yet.',
  'NA-del': 'ZERO1 Python does not have del yet.',
  'NA-walrus': 'ZERO1 Python does not have := yet. Assign on its own line first.',
  'NA-match': 'ZERO1 Python does not have match / case yet. Use if / elif / else.',
  'NA-ellipsis': 'ZERO1 Python does not have ... yet. Use pass.',
  'NA-matmul': 'ZERO1 Python does not have the @ operator.',
  'NA-complex': 'ZERO1 Python does not have complex numbers.',
  'NA-bytes': "ZERO1 Python does not have bytes (b'…') yet. Use text.",
  'NA-escape-N': 'ZERO1 Python does not have \\N{…} yet: type the character itself, for example °',
  'NA-fstring-spec': 'ZERO1 Python does not have this format ({spec}) yet. You can use {x}, {x:.2f}, {n:5d}, {n:03d}, {s:<8}, {n:x}, {n:X}, {n:b}.',
  // §5.5 Board limits (found by the checker after folding a leading '-')
  'E-big-int': 'This number is too big for the board: whole numbers must stay between -2147483648 and 2147483647.',
  // §5.7 Warnings
  'W-escape': "'\\{d}' is not an escape sequence: Python keeps the backslash. Write '\\\\{d}', or use a raw string r'…'.",
  'W-sketch': 'In the Arduino sketch made from this line: {warning}',
  // §5.8 Translator-internal
  'X-internal': 'The simulator could not read this program: {error}. Please tell your teacher.',
  'X-sketch-error': 'Python translation error (a bug in the simulator, please tell your teacher): {message}',
  'X-too-long': 'This program is too long for the simulator: 50,000 bytes at most (it has {bytes}).',
  'X-sketch-too-long': 'The Arduino sketch made from this program is too long to hand in: 50,000 bytes at most (it has {bytes}). Make the program shorter.',
  'X-too-many': '… and {count} more errors',
};

/** The text of `code` with its `{name}` parameters filled in (the code itself while it has no text yet). */
export function message(code: MessageCode, params: Readonly<Record<string, string | number>> = {}): string {
  const text = MESSAGES[code] ?? code;
  return text.replace(/\{(\w+)\}/g, (field, name: string) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : field));
}

/** A pyFail() line on the Serial Monitor: "Line 12: IndexError: list index out of range". */
export const PY_FAIL_LINE = /^Line (\d+): (.+)$/;

/**
 * Python-mode rewording of a runtime console message. When the Executor reports abort()
 * (§6 item 3), the last PY_FAIL_LINE of `serialTail` becomes the message and its line number
 * (works on every browser: no stack frames needed). Known runtime texts get Python words.
 *
 * Day-1 stub: returns `msg` unchanged (§11.2).
 */
export function pythonizeRuntimeMessage(msg: ConsoleMessage, serialTail: string): ConsoleMessage {
  return msg;
}
