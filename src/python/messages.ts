/**
 * Every student-facing text of Python mode (docs/PYTHON.md §5), keyed by a stable code that the
 * translator puts on its diagnostics and that tests assert on.
 *
 * `MessageCode` lists every code of the §5 catalogue (plus NA-value: a function, module, class,
 * method or part used where a value is needed, which §5 has no code for); `MESSAGES` has the text
 * of every code, `MESSAGE_VARIANTS` the other forms where one code needs several (checked by the
 * meta-tests of §10.2, tests/python-errors.test.ts). Runtime messages get their Python words in
 * pythonizeRuntimeMessage (§5.9).
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
  | 'NA-value'
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
 * The texts, by code (§5). `{name}` is a parameter filled in by message(); other braces (the
 * f-string examples inside a text, such as f"T = {t}" or {x:.2f}) are literal. A parameter given
 * as `null` leaves out the sentence it is in (an optional "Did you mean" or hint).
 */
export const MESSAGES: { readonly [C in MessageCode]: string } = {
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

  // §5.2 Names, imports and attributes (scope.ts, flow.ts, check.ts)
  'E-name': "NameError: name '{x}' is not defined. Did you mean: '{y}'?",
  'E-name-true': "NameError: name '{x}' is not defined. Did you mean: '{y}'?",
  'E-name-later': "NameError: name '{x}' is not defined. It gets its value on line {n}, below this line: move that line up.",
  'E-missing-import': "NameError: name '{x}' is not defined. Did you forget: {fix}",
  'E-unbound-local':
    "UnboundLocalError: cannot access local variable '{x}' where it is not associated with a value. To change the global '{x}', write global {x} as the first line of '{f}'.",
  'E-module': "ModuleNotFoundError: No module named '{m}'. On the ZERO1 you can import: machine, time, neopixel, dht, hcsr04, math, random, micropython, zero1.",
  'E-import-name': "ImportError: cannot import name '{x}' from '{m}'. Did you mean: '{y}'?",
  'E-attr': "AttributeError: module '{m}' has no attribute '{x}'. Did you mean: '{y}'?",
  'E-attr-object': "AttributeError: '{type}' object has no attribute '{x}'. A {type} has: {list}.",
  'E-attr-int-pin': "AttributeError: 'int' object has no attribute '{x}'. {pin} is the pin number of the {part}: make a Pin first: {make}",
  'E-class-not-part': "TypeError: {cls}.{x}() missing 1 required positional argument: 'self'. {cls} is a kind of part: make one first: {make}",
  'E-not-callable': "TypeError: '{type}' object is not callable. '{x}' was given a value on line {n}.",

  // §5.3 Kinds and values found before running (Python would stop at run time)
  'E-concat': 'TypeError: can only concatenate str (not "{type}") to str. Use str(x): "T = " + str(t)',
  'E-operand': "TypeError: unsupported operand type(s) for {op}: '{a}' and '{b}'",
  'E-compare': "TypeError: '{op}' not supported between instances of '{a}' and '{b}'",
  'E-index-float': 'TypeError: list indices must be integers or slices, not float. Use // to divide whole numbers: middle = len(readings) // 2',
  'E-range-float': "TypeError: 'float' object cannot be interpreted as an integer. Use int(x) or //.",
  'E-bitop-float': "TypeError: unsupported operand type(s) for {op}: '{a}' and '{b}'",
  'E-repeat-float': "TypeError: can't multiply sequence by non-int of type 'float'",
  'E-len': "TypeError: object of type '{type}' has no len()",
  'E-not-iterable': "TypeError: '{type}' object is not iterable. To repeat 5 times write: for i in range(5):",
  'E-range-value': 'ZERO1 Python does not have range() outside a for loop yet: for i in range(5):',
  'E-range-step': 'ValueError: range() arg 3 must not be zero (a variable step: ZERO1 Python needs a fixed step such as 2 or -1)',
  'E-args-count': 'TypeError: {f}() takes {takes} but {given} given',
  'E-kwarg': "TypeError: {f}() got an unexpected keyword argument '{k}'",
  'E-api-kind': 'TypeError: {f}() needs {need}: use {fix}',
  'E-format-code': "ValueError: Unknown format code '{c}' for object of type '{type}'. Use {x:.0f} or int(x).",
  'E-format-zero-text': "ValueError: '=' alignment not allowed in string format specifier",
  'E-sleep-ms-float': 'TypeError: sleep_ms() needs a whole number of milliseconds: time.sleep_ms(int(ms)), or time.sleep(1.5 / 1000) for seconds',

  // §5.4 ZERO1 limits
  'NA-class': 'ZERO1 Python does not have classes yet. Use functions and variables instead.',
  'NA-try':
    'ZERO1 Python has try / except only around a sensor reading or int() / float() of text, for example: try: sensor.measure() except OSError: print("no answer")',
  'NA-raise': 'ZERO1 Python does not have raise without an error yet: raise ValueError("too hot")',
  'NA-with': 'ZERO1 Python does not have with yet.',
  'NA-lambda': 'ZERO1 Python does not have lambda yet. Write a small def function instead.',
  'NA-comprehension': 'ZERO1 Python does not have [… for … in …] yet. Make the list first, then fill it in a for loop: squares = [0] * 10',
  'NA-dict': 'ZERO1 Python does not have dictionaries and sets yet. Use lists or separate variables.',
  'NA-tuple': 'ZERO1 Python does not have tuples yet, except colours: np[0] = (255, 0, 0)',
  'NA-unpack': 'ZERO1 Python does not have this unpacking yet. Write a, b = x, y or one assignment per line.',
  'NA-slice': 'ZERO1 Python does not have slices [a:b] yet.',
  'NA-nested-def': "ZERO1 Python does not have a def inside another def yet. Move '{f}' to the left edge of the program.",
  'NA-nonlocal': 'ZERO1 Python does not have nonlocal yet.',
  'NA-generator': 'ZERO1 Python does not have yield (generators) yet.',
  'NA-async': 'ZERO1 Python does not have async / await yet. Use time.sleep() to wait.',
  'NA-decorator': 'ZERO1 Python does not have decorators (@) yet.',
  'NA-annotation': "ZERO1 Python does not have type annotations yet: remove '{annotation}'.",
  'NA-star-args': 'ZERO1 Python does not have *args and **kwargs yet. Pass the values one by one.',
  'NA-default-value': 'ZERO1 Python needs a fixed default value such as 100 or "on" here.',
  'NA-none': 'ZERO1 Python does not have None as a value yet. Use 0, -1, "" or False to mean "nothing yet".',
  'NA-none-value': 'ZERO1 Python does not have None as a value yet: {f}() gives no value, so there is nothing to store.',
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
  'NA-list-method': 'ZERO1 Python does not have list.{m}() yet. {hint}',
  'NA-list-size': 'ZERO1 Python needs a fixed size for [v] * n: readings = [0] * 10',
  'NA-list-value': 'ZERO1 Python does not have whole-list values here yet. Use the items: {lst}[0], {lst}[1], …',
  'NA-list-param-grow': 'ZERO1 Python does not have append() on a list passed to a function yet: append to the list where it is made.',
  'NA-pop-here': 'ZERO1 Python needs pop() on its own line: x = {lst}.pop()',
  'NA-nested-list': 'ZERO1 Python does not have lists inside lists yet.',
  'NA-str-method':
    'ZERO1 Python does not have str.{m}() yet. Text can use: upper, lower, strip, startswith, endswith, find, replace, isdigit, len, in, ==, +.',
  'NA-str-format': 'ZERO1 Python does not have % formatting and .format() yet. Use an f-string: f"T = {t}"',
  'NA-str-repeat': 'ZERO1 Python repeats text only with fixed values, like "-" * 16.',
  'NA-bool-value': 'ZERO1 Python does not have and / or with values that are not True or False yet. Use if / else.',
  'NA-chain': 'ZERO1 Python needs the value in a variable first: value = adc.read() then if 0 < value < 500:',
  'NA-builtin':
    'ZERO1 Python does not have {f}() yet. {hint} Built-ins you can use: print, input, len, range, int, float, str, bool, abs, min, max, round, pow, chr, ord, sum.',
  'NA-builtin-arg': 'ZERO1 Python does not have this form of {f}() yet.',
  'NA-print-file': 'ZERO1 Python prints only to the Serial Monitor: remove file=.',
  'NA-fstring-spec': 'ZERO1 Python does not have this format ({spec}) yet. You can use {x}, {x:.2f}, {n:5d}, {n:03d}, {s:<8}, {n:x}, {n:X}, {n:b}.',
  'NA-api': 'ZERO1 Python does not have {name} yet. {hint}',
  'NA-object-here': 'Make the {part} at the top of the program (not inside a def, a loop or an if): the board prepares it once when it starts.',
  'NA-object-reassign': "ZERO1 Python keeps one part per variable: '{x}' already holds a {part}. Use another name.",
  'NA-value': 'ZERO1 Python does not have {what} as values yet: {hint}',
  'E-retype':
    "ZERO1 Python does not have variables that are sometimes text and sometimes a number yet: '{x}' can be text (line {a}) or a number (line {b}) on line {c}. Use two names.",
  'E-param-kinds':
    'ZERO1 Python does not have functions that take text and numbers in the same place yet: {f}() gets a number on line {a} and text on line {b}. Use str(): {f}(str(42))',
  'E-return-kinds': "ZERO1 Python does not have functions that give text and numbers yet: '{f}' gives text on line {a} and a number on line {b}.",
  'E-list-kinds': "ZERO1 Python does not have lists that mix text and numbers yet: '{x}' gets a number on line {a} and text on line {b}.",

  // §5.5 Board limits
  'E-big-int': 'This number is too big for the board: whole numbers must stay between -2147483648 and 2147483647.',
  'E-pin': 'Pin {pin} does not exist on the Arduino UNO: use 0-13, A0-A5 or a ZERO1 name such as LED_RED.',
  'E-adc-pin': 'ADC needs an analog pin: A0-A5, for example POT_LDR.',
  'E-i2c-pins': "The UNO's I2C pins are fixed: SDA = A4 and SCL = A5.",
  'E-part-pin': 'The ZERO1 {part} is wired to {pin}: write {fix} without a pin.',
  'E-colour': 'A colour (r, g, b) needs a NeoPixel: np = NeoPixel(Pin(RGB_PIN), 1)',
  'E-scan': 'i2c.scan() can only be used in a for loop: for address in i2c.scan():',

  // §5.6 Runtime stops (printed by pyFail on the Serial Monitor as "Line {n}: {text}")
  'R-index': 'IndexError: list index out of range',
  'R-str-index': 'IndexError: string index out of range',
  'R-pop-empty': 'IndexError: pop from empty list',
  'R-pop-index': 'IndexError: pop index out of range',
  'R-zero': 'ZeroDivisionError: division by zero',
  'R-int': "ValueError: invalid literal for int() with base 10: '{text}'",
  'R-float': "ValueError: could not convert string to float: '{text}'",
  'R-min-empty': 'ValueError: min() arg is an empty sequence',
  'R-max-empty': 'ValueError: max() arg is an empty sequence',
  'R-sleep': 'ValueError: sleep length must be non-negative',
  'R-list-full': 'MemoryError: the list is full ({n} items on the board)',
  'R-dht': 'OSError: [Errno 110] ETIMEDOUT',
  'R-sonar': 'OSError: Out of range',
  'R-neg-power': 'a negative power of a whole number is a decimal number: write 2.0 ** n',
  'R-assert': 'AssertionError: {message}',
  'R-raise': '{name}: {message}',

  // §5.7 Warnings (only computed when there is no error)
  'W-shadow': "'{x}' is a Python built-in function: from here on, {x}() cannot be used in this program.",
  'W-global-shadow':
    "'{x}' is also a global variable: this line makes a new '{x}' that exists only inside '{f}'. To change the global one, write global {x} as the first line of '{f}'.",
  'W-no-effect': 'This line does nothing: it works out a value and throws it away. {hint}',
  'W-unreachable': 'This line is never reached: the while True loop above never ends.',
  'W-loop-var-changed': "Changing '{i}' inside the for loop does not change the next round: the loop goes on with the next number of the range.",
  'W-missing-return': "'{f}' does not give a value on every path: the board gives 0 there (Python gives None).",
  'W-unused-function': "The function '{f}' is never used.",
  'W-maybe-unassigned': "'{x}' may have no value here: it only gets one inside the {where} on line {n}. The board then uses 0; Python would stop with NameError.",
  'W-int-float': "'{x}' is a whole number on line {a} and a decimal number on line {b}: the board keeps a decimal number, so print({x}) shows 5.0 where Python shows 5.",
  'W-bool-int': "'{x}' is a number on line {a} and True/False on line {b}: print({x}) shows 1 and 0 on the board. Write {x} = False on line {a} to keep True and False.",
  'W-str-num-eq': '{a} is text and {b} is a number: they are never equal. Did you mean {a} == "{b}" or int({a}) == {b}?',
  'W-sleep-long': 'time.sleep() counts in seconds: time.sleep({n}) waits more than {time}. For milliseconds use time.sleep_ms({n}).',
  'W-ticks-diff': 'Use time.ticks_diff(time.ticks_ms(), {start}) to subtract ticks: that is how MicroPython programs keep working when the counter wraps around.',
  'W-pwm-pin': 'Pin {n} ({label}, the {part}) cannot dim: only pins 3, 5, 6, 9, 10 and 11 have PWM on the UNO. duty_u16() of 32768 or more switches it on, less switches it off.',
  'W-pwm-freq': 'The PWM frequency of the UNO is fixed (490 Hz, 980 Hz on pins 5 and 6): freq() is ignored.',
  'W-pwm-buzzer': 'To play a note on the buzzer use Buzzer().tone(440): PWM().freq() is ignored on the UNO.',
  'W-pwm-servo': "To move the servo use Servo().angle(90): the UNO's PWM cannot make the 50 Hz servo signal.",
  'W-pull-down': 'The Arduino UNO has no built-in pull-down resistors: Pin.PULL_DOWN is ignored. The ZERO1 buttons already have their own resistor.',
  'W-pin-no-out': "Pin '{x}' was made without Pin.OUT: write Pin({pin}, Pin.OUT) to switch it on and off.",
  'W-echo-timeout': 'echo_timeout_us is fixed at 30000 µs (about 5 m) on the ZERO1.',
  'W-list-capacity': "The board keeps at most {n} items in the list '{x}' (Python lists have no limit): one more append stops the program with MemoryError.",
  'W-memory': "Your variables and lists use about {n} of the board's 2,048 bytes of memory: the program may not run on the real board.",
  'W-lcd-char': "The LCD cannot show '{c}': it shows another symbol. Use plain letters on the LCD (° works).",
  'W-text-bytes': "'{c}' takes {n} bytes on the board: len(), [i], for … in and ord() count bytes there, so they give other results than Python.",
  'W-escape': "'\\{d}' is not an escape sequence: Python keeps the backslash. Write '\\\\{d}', or use a raw string r'…'.",
  'W-recursion': "'{f}' calls itself: each call uses memory on the board, and about 50 calls deep the board crashes (the simulator does not notice).",
  'W-sketch': 'In the Arduino sketch made from this line: {warning}',

  // §5.8 Translator-internal
  'X-internal': 'The simulator could not read this program: {error}. Please tell your teacher.',
  'X-sketch-error': 'Python translation error (a bug in the simulator, please tell your teacher): {message}',
  'X-too-long': 'This program is too long for the simulator: 50,000 bytes at most (it has {bytes}).',
  'X-sketch-too-long': 'The Arduino sketch made from this program is too long to hand in: 50,000 bytes at most (it has {bytes}). Make the program shorter.',
  'X-too-many': '… and {count} more errors',
};

/**
 * The other forms of a message where §5 gives more than one ("… / …"), or where one trigger
 * needs other words than the first form. `message(code, params, n)` uses form n (1-based here;
 * form 0 is MESSAGES).
 */
export const MESSAGE_VARIANTS: { readonly [C in MessageCode]?: readonly string[] } = {
  // "missing 1 required positional argument: 'x'" (form 0: "takes 1 positional argument but 2 were given")
  'E-args-count': ['TypeError: {f}() missing {missing}: {names}'],
  // `~` on a float (a unary operator: CPython's own words)
  'E-bitop-float': ["TypeError: bad operand type for unary {op}: '{a}'"],
  // unary - / + on text
  'E-operand': ["TypeError: bad operand type for unary {op}: '{a}'"],
  // `x in "text"` with a number on the left
  'E-compare': ["TypeError: 'in <string>' requires string as left operand, not {a}"],
  // an index of another kind than float, and indexing something that has no items
  'E-index-float': [
    'TypeError: list indices must be integers or slices, not {type}',
    "TypeError: '{type}' object is not subscriptable",
    "TypeError: '{type}' object does not support item assignment",
  ],
  // `f(a, a=1)` for an own function
  'E-kwarg': ["TypeError: {f}() got multiple values for argument '{k}'"],
  // the sensor: measure() gives no value
  'NA-none-value': [
    'ZERO1 Python does not have None as a value yet: measure() gives no value, so there is nothing to store. For the sensor: call {sensor}.measure() on its own line, then read {sensor}.temperature().',
  ],
  // a list, colour or part mixed with something else in one variable; a conditional expression that gives text or a number
  'E-retype': [
    "ZERO1 Python does not have variables that are sometimes {a} and sometimes {b} yet: '{x}' can be {a} (line {la}) or {b} (line {lb}) on line {c}. Use two names.",
    'ZERO1 Python does not have values that are sometimes text and sometimes a number yet: this line gives text or a number. Use str() on the number.',
  ],
  // the same limits for other kinds than text and numbers (lists, colours, Pins)
  'E-param-kinds': ['ZERO1 Python does not have functions that take {ka} and {kb} in the same place yet: {f}() gets {ka} on line {a} and {kb} on line {b}.'],
  'E-return-kinds': ["ZERO1 Python does not have functions that give {ka} and {kb} yet: '{f}' gives {ka} on line {a} and {kb} on line {b}."],
  'E-list-kinds': ["ZERO1 Python does not have lists that mix {ka} and {kb} yet: '{x}' gets {ka} on line {a} and {kb} on line {b}."],
  // a pin without a ZERO1 part
  'W-pwm-pin': ['Pin {n} ({label}) cannot dim: only pins 3, 5, 6, 9, 10 and 11 have PWM on the UNO. duty_u16() of 32768 or more switches it on, less switches it off.'],
  // a standard part (NeoPixel, DHT22) on another pin: it takes a pin, the ZERO1 one
  'E-part-pin': ['The ZERO1 {part} is wired to {pin}: write {fix}.'],
  // shadowing an imported name
  'W-shadow': ["'{x}' was imported from {m}: from here on, {x}() cannot be used in this program."],
  // assert without a message
  'R-assert': ['AssertionError'],
};

/**
 * The text of `code` (form `variant`, see MESSAGE_VARIANTS) with its `{name}` parameters filled
 * in. A parameter given as `null` leaves out the sentence it is in; an empty one leaves no double
 * space. Unknown parameters stay as written.
 */
export function message(code: MessageCode, params: Readonly<Record<string, string | number | null>> = {}, variant = 0): string {
  const text = variant === 0 ? MESSAGES[code] : MESSAGE_VARIANTS[code]?.[variant - 1] ?? MESSAGES[code];
  const has = (name: string) => Object.prototype.hasOwnProperty.call(params, name);
  // Sentences end with '.', '?' or '!' followed by a space; a parameter in braces never ends one.
  const sentences = text.split(/(?<=[.?!]) (?=[^ ])/);
  const kept = sentences.filter((s) => ![...s.matchAll(/\{(\w+)\}/g)].some((m) => has(m[1]) && params[m[1]] === null));
  let out = kept.join(' ');
  // A Python error text (CPython's words) has no final period when its last sentence was left out.
  if (kept.length < sentences.length && /^\w+(?:Error|Warning|Exception): /.test(out) && sentences[sentences.length - 1] !== kept[kept.length - 1]) {
    out = out.replace(/\.$/, '');
  }
  out = out.replace(/\{(\w+)\}/g, (field, name: string) => (has(name) && params[name] !== null ? String(params[name]) : field));
  return out.replace(/ {2,}/g, ' ').trim();
}

/** A pyFail() line on the Serial Monitor: "Line 12: IndexError: list index out of range". */
export const PY_FAIL_LINE = /^Line (\d+): (.+)$/;

/**
 * The console text of the Executor when the sketch calls abort() (src/runtime/values.ts
 * ABORT_MESSAGE, §6 item 3); kept here so the Python chunk does not load the runtime for it.
 */
export const ABORT_TEXT = 'The sketch stopped: abort() was called.';

/**
 * Python-mode rewording of a runtime console message. When the Executor reports abort()
 * (§6 item 3), the last PY_FAIL_LINE of `serialTail` becomes the message and its line number
 * (works on every browser: no stack frames needed). Known runtime texts get Python words.
 *
 * Only the abort() part is done so far: other messages are returned unchanged (the table of
 * §5.9 comes with the runtime tests of §10.3).
 */
export function pythonizeRuntimeMessage(msg: ConsoleMessage, serialTail: string): ConsoleMessage {
  if (msg.text !== ABORT_TEXT) return msg;
  const lines = serialTail.split('\n');
  for (let k = lines.length - 1; k >= 0; k--) {
    const m = PY_FAIL_LINE.exec(lines[k].replace(/\r$/, ''));
    if (m) return { ...msg, text: m[2], line: Number(m[1]), source: 'python' };
  }
  return msg;
}
