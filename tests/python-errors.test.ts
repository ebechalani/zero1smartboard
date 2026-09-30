/**
 * The error and warning catalogue of Python mode (docs/PYTHON.md §5, §10.2), table-driven from
 * MESSAGES: one row per code with a minimal program, the expected code, exact text, line and
 * columns; the review cases of §10.2; the other forms of a message (MESSAGE_VARIANTS); and the
 * meta-tests on the catalogue itself (every entry covered, ≤ 240 characters, Python's error
 * class first where CPython would stop too, no C++ word the student did not write, ZERO1 limits
 * worded "ZERO1 Python …").
 */
import { describe, expect, it } from 'vitest';
import { pythonToArduino } from '../src/python';
import { check } from '../src/python/check';
import { analyzeFlow } from '../src/python/flow';
import { infer } from '../src/python/kinds';
import { MESSAGES, MESSAGE_VARIANTS, message, type MessageCode } from '../src/python/messages';
import { parseSource } from '../src/python/parser';
import { resolve } from '../src/python/scope';
import { analyze } from '../src/python/translate';
import { normalize } from '../src/python/tokens';

/** [code, program, line, column, endLine, endColumn, exact text] — the diagnostic of that code pythonToArduino gives first. */
type Row = [MessageCode, string, number, number, number | undefined, number | undefined, string];

const ROWS: Row[] = [
  // §5.1 Syntax and indentation (their full coverage: tests/python-tokens.test.ts, tests/python-parser.test.ts)
  ['S-syntax', 'x = = 1\n', 1, 5, 1, 6, 'SyntaxError: invalid syntax'],
  ['S-comma', 'print(1 2)\n', 1, 7, 1, 10, 'SyntaxError: invalid syntax. Perhaps you forgot a comma?'],
  ['S-colon', 'if x\n    pass\n', 1, 5, 1, 5, "SyntaxError: expected ':'"],
  ['S-else-if', 'if x:\n    pass\nelse if y:\n    pass\n', 3, 1, 3, 8, "SyntaxError: expected ':'. In Python, else if is written elif: elif x > 5:"],
  ['S-assign-in-if', 'if x = 5:\n    pass\n', 1, 4, 1, 9, "SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='?"],
  ['S-never-closed', 'print(1\n', 1, 6, 1, 7, "SyntaxError: '(' was never closed"],
  ['S-unmatched', 'print(1))\n', 1, 9, 1, 10, "SyntaxError: unmatched ')'"],
  ['S-unterminated', 'print("hi)\n', 1, 7, 1, 8, 'SyntaxError: unterminated string literal (detected at line 1)'],
  ['S-unterminated-triple', 'x = """abc\n', 1, 5, 1, 6, 'SyntaxError: unterminated triple-quoted string literal (detected at line 1)'],
  ['S-leading-zero', 'x = 007\n', 1, 5, 1, 8, 'SyntaxError: leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers'],
  ['S-nbsp', 'x =\u00a01\n', 1, 4, 1, 5, 'SyntaxError: invalid non-printable character U+00A0. It is an invisible space copied from a document: delete it and type a normal space.'],
  ['S-curly-quote', 'print(\u201chi\u201d)\n', 1, 7, 1, 8, 'SyntaxError: invalid character \'\u201c\' (U+201C). Use straight quotes: " or \'.'],
  ['S-invalid-char', 'x = 5 \u20ac\n', 1, 7, 1, 8, "SyntaxError: invalid character '\u20ac' (U+20AC)"],
  ['S-plusplus', 'x = 1\nx++\n', 2, 2, 2, 4, 'SyntaxError: invalid syntax. Python has no ++ or --: write x += 1'],
  ['S-c-operator', 'if a && b:\n    pass\n', 1, 6, 1, 8, 'SyntaxError: invalid syntax. In Python, && is written and, || is written or, ! is written not.'],
  ['S-c-comment', '// hi\n', 1, 1, 1, 6, 'SyntaxError: invalid syntax. Comments in Python start with #, not //.'],
  ['S-brace', 'if x {\n', 1, 6, 1, 7, 'SyntaxError: invalid syntax. Python uses a colon and indentation instead of { }: if x > 5:'],
  ['S-cannot-assign', 'f() = 1\n', 1, 1, 1, 4, "SyntaxError: cannot assign to function call here. Maybe you meant '==' instead of '='?"],
  ['S-return-outside', 'return 5\n', 1, 1, 1, 9, "SyntaxError: 'return' outside function"],
  ['S-break-outside', 'break\n', 1, 1, 1, 6, "SyntaxError: 'break' outside loop"],
  ['S-continue-outside', 'continue\n', 1, 1, 1, 9, "SyntaxError: 'continue' not properly in loop"],
  ['S-global-after-use', 'def f():\n    print(x)\n    global x\n', 3, 5, 3, 13, "SyntaxError: name 'x' is used prior to global declaration"],
  ['S-keyword-repeated', 'print(sep="", sep="")\n', 1, 15, 1, 21, 'SyntaxError: keyword argument repeated: sep'],
  ['S-positional-after-keyword', 'print(sep="", 1)\n', 1, 15, 1, 16, 'SyntaxError: positional argument follows keyword argument'],
  ['S-default-order', 'def f(a=1, b):\n    pass\n', 1, 12, 1, 13, 'SyntaxError: parameter without a default follows parameter with a default'],
  ['S-duplicate-param', 'def f(a, a):\n    pass\n', 1, 10, 1, 11, "SyntaxError: duplicate argument 'a' in function definition"],
  ['S-indent-expected', 'if True:\npass\n', 2, 1, 2, 5, "IndentationError: expected an indented block after 'if' statement on line 1. Indent the lines inside it by 4 spaces (press Tab)."],
  ['S-indent-unexpected', 'x = 1\n    y = 2\n', 2, 5, 2, 6, 'IndentationError: unexpected indent'],
  ['S-unindent', 'if True:\n        x = 1\n    y = 2\n', 3, 1, 3, 5, 'IndentationError: unindent does not match any outer indentation level'],
  ['S-tab', 'if True:\n\tx = 1\n        y = 2\n', 3, 1, 3, 9, 'TabError: inconsistent use of tabs and spaces in indentation'],

  // §5.2 Names, imports and attributes
  ['E-name', 'count = 0\nprint(coutn)\n', 2, 7, 2, 12, "NameError: name 'coutn' is not defined. Did you mean: 'count'?"],
  ['E-name-true', 'x = true\n', 1, 5, 1, 9, "NameError: name 'true' is not defined. Did you mean: 'True'?"],
  ['E-name-later', 'print(value)\nvalue = 5\n', 1, 7, 1, 12, "NameError: name 'value' is not defined. It gets its value on line 2, below this line: move that line up."],
  ['E-missing-import', 'led = Pin(13)\n', 1, 7, 1, 10, "NameError: name 'Pin' is not defined. Did you forget: from machine import Pin"],
  ['E-unbound-local', 'total = 0\ndef add():\n    total += 1\nadd()\n', 3, 5, 3, 10,
    "UnboundLocalError: cannot access local variable 'total' where it is not associated with a value. To change the global 'total', write global total as the first line of 'add'."],
  ['E-module', 'import foo\n', 1, 8, 1, 11, "ModuleNotFoundError: No module named 'foo'. On the ZERO1 you can import: machine, time, neopixel, dht, hcsr04, math, random, micropython, zero1."],
  ['E-import-name', 'from time import sleeep\n', 1, 18, 1, 24, "ImportError: cannot import name 'sleeep' from 'time'. Did you mean: 'sleep'?"],
  ['E-attr', 'import time\ntime.sleeep(1)\n', 2, 1, 2, 12, "AttributeError: module 'time' has no attribute 'sleeep'. Did you mean: 'sleep'?"],
  ['E-attr-object', 'from machine import Pin\nled = Pin(13, Pin.OUT)\nled.blink()\n', 3, 1, 3, 10, "AttributeError: 'Pin' object has no attribute 'blink'. A Pin has: on, off, value, toggle."],
  ['E-attr-int-pin', 'from zero1 import LED_RED\nLED_RED.on()\n', 2, 1, 2, 11,
    "AttributeError: 'int' object has no attribute 'on'. LED_RED is the pin number of the red LED: make a Pin first: led = Pin(LED_RED, Pin.OUT)"],
  ['E-class-not-part', 'from zero1 import Buzzer\nBuzzer.tone(440)\n', 2, 1, 2, 12,
    "TypeError: Buzzer.tone() missing 1 required positional argument: 'self'. Buzzer is a kind of part: make one first: buzzer = Buzzer()"],
  ['E-not-callable', 'max = 0\nprint(max(1, 2))\n', 2, 7, 2, 10, "TypeError: 'int' object is not callable. 'max' was given a value on line 1."],

  // §5.3 Kinds and values found before running
  ['E-concat', 't = 21\nprint("T = " + t)\n', 2, 7, 2, 17, 'TypeError: can only concatenate str (not "int") to str. Use str(x): "T = " + str(t)'],
  ['E-operand', 'text = "abc"\nprint(text - 1)\n', 2, 7, 2, 15, "TypeError: unsupported operand type(s) for -: 'str' and 'int'"],
  ['E-compare', 'print("M" > 5)\n', 1, 7, 1, 14, "TypeError: '>' not supported between instances of 'str' and 'int'"],
  ['E-index-float', 'readings = [1, 2, 3]\nprint(readings[len(readings) / 2])\n', 2, 16, 2, 33,
    'TypeError: list indices must be integers or slices, not float. Use // to divide whole numbers: middle = len(readings) // 2'],
  ['E-range-float', 'for i in range(2.0):\n    pass\n', 1, 16, 1, 19, "TypeError: 'float' object cannot be interpreted as an integer. Use int(x) or //."],
  ['E-bitop-float', 'print(1.5 & 1)\n', 1, 7, 1, 14, "TypeError: unsupported operand type(s) for &: 'float' and 'int'"],
  ['E-repeat-float', 'zeros = [0] * 2.5\n', 1, 9, 1, 18, "TypeError: can't multiply sequence by non-int of type 'float'"],
  ['E-len', 'print(len(5))\n', 1, 7, 1, 13, "TypeError: object of type 'int' has no len()"],
  ['E-not-iterable', 'for x in 5:\n    pass\n', 1, 10, 1, 11, "TypeError: 'int' object is not iterable. To repeat 5 times write: for i in range(5):"],
  ['E-range-value', 'r = range(5)\n', 1, 5, 1, 13, 'ZERO1 Python does not have range() outside a for loop yet: for i in range(5):'],
  ['E-range-step', 'for i in range(0, 10, 0):\n    pass\n', 1, 23, 1, 24, 'ValueError: range() arg 3 must not be zero (a variable step: ZERO1 Python needs a fixed step such as 2 or -1)'],
  ['E-args-count', 'def f(a):\n    return a\nprint(f(1, 2))\n', 3, 7, 3, 14, 'TypeError: f() takes 1 positional argument but 2 were given'],
  ['E-kwarg', 'def beep(ms=100):\n    pass\nbeep(time=5)\n', 3, 6, 3, 12, "TypeError: beep() got an unexpected keyword argument 'time'"],
  ['E-api-kind', 'from zero1 import LCD\nlcd = LCD()\nlcd.putstr(42)\n', 3, 12, 3, 14, 'TypeError: putstr() needs text: use lcd.putstr(str(x))'],
  ['E-format-code', 'print(f"{1.5:d}")\n', 1, 14, 1, 15, "ValueError: Unknown format code 'd' for object of type 'float'. Use {x:.0f} or int(x)."],
  ['E-format-zero-text', 'print(f"{\'ab\':05}")\n', 1, 15, 1, 17, "ValueError: '=' alignment not allowed in string format specifier"],
  ['E-sleep-ms-float', 'import time\ntime.sleep_ms(0.5)\n', 2, 15, 2, 18,
    'TypeError: sleep_ms() needs a whole number of milliseconds: time.sleep_ms(int(ms)), or time.sleep(1.5 / 1000) for seconds'],

  // §5.4 ZERO1 limits
  ['NA-class', 'class Robot:\n    pass\n', 1, 1, 1, 13, 'ZERO1 Python does not have classes yet. Use functions and variables instead.'],
  ['NA-try', 'try:\n    x = 1\nfinally:\n    pass\n', 3, 1, 3, 8,
    'ZERO1 Python has try / except only around a sensor reading or int() / float() of text, for example: try: sensor.measure() except OSError: print("no answer")'],
  ['NA-raise', 'raise\n', 1, 1, 1, 6, 'ZERO1 Python does not have raise without an error yet: raise ValueError("too hot")'],
  ['NA-with', 'with open("f") as f:\n    pass\n', 1, 1, 1, 21, 'ZERO1 Python does not have with yet.'],
  ['NA-lambda', 'double = lambda x: x * 2\n', 1, 10, 1, 25, 'ZERO1 Python does not have lambda yet. Write a small def function instead.'],
  ['NA-comprehension', 'squares = [i * i for i in range(10)]\n', 1, 11, 1, 37, 'ZERO1 Python does not have [… for … in …] yet. Make the list first, then fill it in a for loop: squares = [0] * 10'],
  ['NA-dict', 'ages = {"ali": 12}\n', 1, 8, 1, 19, 'ZERO1 Python does not have dictionaries and sets yet. Use lists or separate variables.'],
  ['NA-tuple', 'pair = (1, 2)\n', 1, 8, 1, 14, 'ZERO1 Python does not have tuples yet, except colours: np[0] = (255, 0, 0)'],
  ['NA-unpack', 'a, b = [1, 2]\n', 1, 1, 1, 5, 'ZERO1 Python does not have this unpacking yet. Write a, b = x, y or one assignment per line.'],
  ['NA-slice', 'items = [1, 2, 3]\nprint(items[0:2])\n', 2, 7, 2, 17, 'ZERO1 Python does not have slices [a:b] yet.'],
  ['NA-nested-def', 'def outer():\n    def inner():\n        pass\n', 2, 5, 2, 17, "ZERO1 Python does not have a def inside another def yet. Move 'inner' to the left edge of the program."],
  ['NA-nonlocal', 'def f():\n    nonlocal x\n', 2, 5, 2, 15, 'ZERO1 Python does not have nonlocal yet.'],
  ['NA-generator', 'def f():\n    yield 1\n', 2, 5, 2, 12, 'ZERO1 Python does not have yield (generators) yet.'],
  ['NA-async', 'async def f():\n    pass\n', 1, 1, 1, 10, 'ZERO1 Python does not have async / await yet. Use time.sleep() to wait.'],
  ['NA-decorator', '@staticmethod\ndef f():\n    pass\n', 1, 1, 1, 14, 'ZERO1 Python does not have decorators (@) yet.'],
  ['NA-annotation', 'def f(x: int):\n    pass\n', 1, 8, 1, 13, "ZERO1 Python does not have type annotations yet: remove ': int'."],
  ['NA-star-args', 'def f(*args):\n    pass\n', 1, 7, 1, 12, 'ZERO1 Python does not have *args and **kwargs yet. Pass the values one by one.'],
  ['NA-default-value', 'def f(n=len("ab")):\n    pass\nf()\n', 1, 9, 1, 18, 'ZERO1 Python needs a fixed default value such as 100 or "on" here.'],
  ['NA-none', 'x = None\n', 1, 5, 1, 9, 'ZERO1 Python does not have None as a value yet. Use 0, -1, "" or False to mean "nothing yet".'],
  ['NA-none-value', 'def show():\n    pass\nx = show()\n', 3, 5, 3, 11, 'ZERO1 Python does not have None as a value yet: show() gives no value, so there is nothing to store.'],
  ['NA-is', 'x = 1\nif x is 1:\n    pass\n', 2, 4, 2, 10, 'ZERO1 Python does not have is / is not yet. Compare with == or != instead.'],
  ['NA-loop-else', 'for i in range(3):\n    pass\nelse:\n    pass\n', 3, 1, 3, 5, 'ZERO1 Python does not have else after a loop yet.'],
  ['NA-del', 'x = 1\ndel x\n', 2, 1, 2, 6, 'ZERO1 Python does not have del yet.'],
  ['NA-walrus', 'if (n := 5) > 3:\n    pass\n', 1, 5, 1, 11, 'ZERO1 Python does not have := yet. Assign on its own line first.'],
  ['NA-match', 'x = 1\nmatch x:\n    case 1:\n        pass\n', 2, 1, 2, 9, 'ZERO1 Python does not have match / case yet. Use if / elif / else.'],
  ['NA-ellipsis', 'x = ...\n', 1, 5, 1, 8, 'ZERO1 Python does not have ... yet. Use pass.'],
  ['NA-matmul', 'print(a @ b)\n', 1, 7, 1, 12, 'ZERO1 Python does not have the @ operator.'],
  ['NA-complex', 'x = 1j\n', 1, 5, 1, 7, 'ZERO1 Python does not have complex numbers.'],
  ['NA-bytes', "x = b'abc'\n", 1, 5, 1, 11, "ZERO1 Python does not have bytes (b'…') yet. Use text."],
  ['NA-escape-N', 'print("\\N{DEGREE SIGN}")\n', 1, 8, 1, 23, 'ZERO1 Python does not have \\N{…} yet: type the character itself, for example °'],
  ['NA-list-method', 'items = [3, 1, 2]\nitems.sort()\n', 2, 1, 2, 11, 'ZERO1 Python does not have list.sort() yet. Write a bubble sort with a, b = b, a.'],
  ['NA-list-size', 'n = 5\nreadings = [0] * n\n', 2, 12, 2, 19, 'ZERO1 Python needs a fixed size for [v] * n: readings = [0] * 10'],
  ['NA-list-value', 'a = [1, 2]\nb = a\n', 2, 5, 2, 6, 'ZERO1 Python does not have whole-list values here yet. Use the items: a[0], a[1], …'],
  ['NA-list-param-grow', 'def add(values):\n    values.append(1)\nitems = [1]\nadd(items)\n', 2, 5, 2, 21,
    'ZERO1 Python does not have append() on a list passed to a function yet: append to the list where it is made.'],
  ['NA-pop-here', 'items = [1, 2]\nprint(items.pop() + 1)\n', 2, 7, 2, 18, 'ZERO1 Python needs pop() on its own line: x = items.pop()'],
  ['NA-nested-list', 'grid = [[1, 2], [3, 4]]\n', 1, 9, 1, 15, 'ZERO1 Python does not have lists inside lists yet.'],
  ['NA-str-method', 'text = "a,b"\nparts = text.split(",")\n', 2, 9, 2, 19,
    'ZERO1 Python does not have str.split() yet. Text can use: upper, lower, strip, startswith, endswith, find, replace, isdigit, len, in, ==, +.'],
  ['NA-str-format', 'print("%d" % 5)\n', 1, 7, 1, 15, 'ZERO1 Python does not have % formatting and .format() yet. Use an f-string: f"T = {t}"'],
  ['NA-str-repeat', 'n = 3\nprint("ab" * n)\n', 2, 7, 2, 15, 'ZERO1 Python repeats text only with fixed values, like "-" * 16.'],
  ['NA-bool-value', 'name = input() or "guest"\n', 1, 8, 1, 26, 'ZERO1 Python does not have and / or with values that are not True or False yet. Use if / else.'],
  ['NA-chain', 'from machine import ADC\nadc = ADC(17)\nif 0 < adc.read() < 500:\n    pass\n', 3, 8, 3, 18,
    'ZERO1 Python needs the value in a variable first: value = adc.read() then if 0 < value < 500:'],
  ['NA-builtin', 'items = [3, 1]\nprint(sorted(items))\n', 2, 7, 2, 13,
    'ZERO1 Python does not have sorted() yet. Write a bubble sort with a, b = b, a. Built-ins you can use: print, input, len, range, int, float, str, bool, abs, min, max, round, pow, chr, ord, sum.'],
  ['NA-builtin-arg', 'print(int("ff", 16))\n', 1, 7, 1, 20, 'ZERO1 Python does not have this form of int() yet.'],
  ['NA-print-file', 'print("hi", file=5)\n', 1, 13, 1, 19, 'ZERO1 Python prints only to the Serial Monitor: remove file=.'],
  ['NA-fstring-spec', 'print(f"{3.5:^8}")\n', 1, 14, 1, 16,
    'ZERO1 Python does not have this format (^8) yet. You can use {x}, {x:.2f}, {n:5d}, {n:03d}, {s:<8}, {n:x}, {n:X}, {n:b}.'],
  ['NA-api', 'from machine import Pin\nbutton = Pin(6, Pin.IN)\nbutton.irq()\n', 3, 1, 3, 11, 'ZERO1 Python does not have Pin.irq() yet. Check the pin in your while True loop instead.'],
  ['NA-object-here', 'from zero1 import Servo\nwhile True:\n    servo = Servo()\n', 3, 13, 3, 20,
    'Make the Servo at the top of the program (not inside a def, a loop or an if): the board prepares it once when it starts.'],
  ['NA-object-reassign', 'from machine import Pin\nled = Pin(15, Pin.OUT)\nled = 5\n', 3, 1, 3, 4, "ZERO1 Python keeps one part per variable: 'led' already holds a Pin. Use another name."],
  ['NA-value', 'def beep():\n    pass\nx = beep\n', 3, 5, 3, 9, 'ZERO1 Python does not have functions as values yet: call it with (): beep()'],
  ['E-retype', 'x = 0\nwhile True:\n    print(x)\n    x = "hi"\n', 3, 11, 3, 12,
    "ZERO1 Python does not have variables that are sometimes text and sometimes a number yet: 'x' can be text (line 4) or a number (line 1) on line 3. Use two names."],
  ['E-param-kinds', 'def show(x):\n    print(x)\nshow(42)\nshow("hi")\n', 4, 1, 4, 11,
    'ZERO1 Python does not have functions that take text and numbers in the same place yet: show() gets a number on line 3 and text on line 4. Use str(): show(str(42))'],
  ['E-return-kinds', 'def check(t):\n    if t > 30:\n        return "hot"\n    return t\nprint(check(5))\n', 4, 5, 4, 13,
    "ZERO1 Python does not have functions that give text and numbers yet: 'check' gives text on line 3 and a number on line 4."],
  ['E-list-kinds', 'items = [1, "two"]\n', 1, 13, 1, 18, "ZERO1 Python does not have lists that mix text and numbers yet: 'items' gets a number on line 1 and text on line 1."],

  // §5.5 Board limits
  ['E-big-int', 'x = 2147483648\n', 1, 5, 1, 15, 'This number is too big for the board: whole numbers must stay between -2147483648 and 2147483647.'],
  ['E-pin', 'from machine import Pin\np = Pin(25, Pin.OUT)\n', 2, 9, 2, 11, 'Pin 25 does not exist on the Arduino UNO: use 0-13, A0-A5 or a ZERO1 name such as LED_RED.'],
  ['E-adc-pin', 'from machine import ADC\nadc = ADC(5)\n', 2, 11, 2, 12, 'ADC needs an analog pin: A0-A5, for example POT_LDR.'],
  ['E-i2c-pins', 'from machine import I2C, Pin\ni2c = I2C(0, scl=Pin(4), sda=Pin(5))\n', 2, 7, 2, 37, "The UNO's I2C pins are fixed: SDA = A4 and SCL = A5."],
  ['E-part-pin', 'from zero1 import Servo\nservo = Servo(9)\n', 2, 15, 2, 16, 'The ZERO1 servo is wired to D4: write Servo() without a pin.'],
  ['E-colour', 'r = 100\ncolour = (r, 0, 0)\n', 2, 10, 2, 19, 'A colour (r, g, b) needs a NeoPixel: np = NeoPixel(Pin(RGB_PIN), 1)'],
  ['E-scan', 'from machine import I2C\ni2c = I2C(0)\nfound = i2c.scan()\n', 3, 9, 3, 19, 'i2c.scan() can only be used in a for loop: for address in i2c.scan():'],

  // §5.7 Warnings (the program has no error)
  ['W-shadow', 'max = 0\nprint(max)\n', 1, 1, 1, 4, "'max' is a Python built-in function: from here on, max() cannot be used in this program."],
  ['W-global-shadow', 'count = 0\ndef reset():\n    count = 0\nreset()\n', 3, 5, 3, 10,
    "'count' is also a global variable: this line makes a new 'count' that exists only inside 'reset'. To change the global one, write global count as the first line of 'reset'."],
  ['W-no-effect', 'x = 1\nx == 5\n', 2, 1, 2, 7, 'This line does nothing: it works out a value and throws it away. Did you mean x = 5?'],
  ['W-unreachable', 'while True:\n    pass\nprint("done")\n', 3, 1, 3, 14, 'This line is never reached: the while True loop above never ends.'],
  ['W-loop-var-changed', 'for i in range(10):\n    i = i + 1\n', 2, 5, 2, 6,
    "Changing 'i' inside the for loop does not change the next round: the loop goes on with the next number of the range."],
  ['W-missing-return', 'def half(n):\n    if n > 0:\n        return n // 2\nprint(half(4))\n', 1, 5, 1, 9, "'half' does not give a value on every path: the board gives 0 there (Python gives None)."],
  ['W-unused-function', 'def blink():\n    pass\n', 1, 5, 1, 10, "The function 'blink' is never used."],
  ['W-maybe-unassigned', 'if input() == "y":\n    z = 1\nprint(z)\n', 3, 7, 3, 8,
    "'z' may have no value here: it only gets one inside the if on line 1. The board then uses 0; Python would stop with NameError."],
  ['W-int-float', 'x = 0\nwhile True:\n    x = x + 0.5\n    print(x)\n', 4, 11, 4, 12,
    "'x' is a whole number on line 1 and a decimal number on line 3: the board keeps a decimal number, so print(x) shows 5.0 where Python shows 5."],
  ['W-bool-int', 'state = 0\nwhile True:\n    state = not state\n    print(state)\n', 4, 11, 4, 16,
    "'state' is a number on line 1 and True/False on line 3: print(state) shows 1 and 0 on the board. Write state = False on line 1 to keep True and False."],
  ['W-str-num-eq', 'command = input()\nif command == 1:\n    pass\n', 2, 4, 2, 16, 'command is text and 1 is a number: they are never equal. Did you mean command == "1" or int(command) == 1?'],
  ['W-sleep-long', 'import time\ntime.sleep(500)\n', 2, 12, 2, 15, 'time.sleep() counts in seconds: time.sleep(500) waits more than 8 minutes. For milliseconds use time.sleep_ms(500).'],
  ['W-ticks-diff', 'import time\nstart = time.ticks_ms()\nprint(time.ticks_ms() - start)\n', 3, 7, 3, 30,
    'Use time.ticks_diff(time.ticks_ms(), start) to subtract ticks: that is how MicroPython programs keep working when the counter wraps around.'],
  ['W-pwm-pin', 'from machine import Pin, PWM\nfrom zero1 import LED_RED\npwm = PWM(Pin(LED_RED))\n', 3, 7, 3, 24,
    'Pin 15 (A1, the red LED) cannot dim: only pins 3, 5, 6, 9, 10 and 11 have PWM on the UNO. duty_u16() of 32768 or more switches it on, less switches it off.'],
  ['W-pwm-freq', 'from machine import Pin, PWM\npwm = PWM(Pin(9))\npwm.freq(1000)\n', 3, 1, 3, 15, 'The PWM frequency of the UNO is fixed (490 Hz, 980 Hz on pins 5 and 6): freq() is ignored.'],
  ['W-pwm-buzzer', 'from machine import Pin, PWM\nfrom zero1 import BUZZER\npwm = PWM(Pin(BUZZER))\n', 3, 7, 3, 23, 'To play a note on the buzzer use Buzzer().tone(440): PWM().freq() is ignored on the UNO.'],
  ['W-pwm-servo', 'from machine import Pin, PWM\nfrom zero1 import SERVO_PIN\npwm = PWM(Pin(SERVO_PIN))\n', 3, 7, 3, 26, "To move the servo use Servo().angle(90): the UNO's PWM cannot make the 50 Hz servo signal."],
  ['W-pull-down', 'from machine import Pin\nbutton = Pin(6, Pin.IN, Pin.PULL_DOWN)\n', 2, 25, 2, 38,
    'The Arduino UNO has no built-in pull-down resistors: Pin.PULL_DOWN is ignored. The ZERO1 buttons already have their own resistor.'],
  ['W-pin-no-out', 'from machine import Pin\nfrom zero1 import LED_RED\nled = Pin(LED_RED)\nled.on()\n', 4, 1, 4, 9, "Pin 'led' was made without Pin.OUT: write Pin(LED_RED, Pin.OUT) to switch it on and off."],
  ['W-echo-timeout', 'from zero1 import HCSR04\nsonar = HCSR04(echo_timeout_us=1000)\n', 2, 32, 2, 36, 'echo_timeout_us is fixed at 30000 µs (about 5 m) on the ZERO1.'],
  ['W-list-capacity', 'readings = []\nwhile True:\n    readings.append(1)\n', 1, 1, 1, 9,
    "The board keeps at most 20 items in the list 'readings' (Python lists have no limit): one more append stops the program with MemoryError."],
  ['W-memory', 'readings = [0] * 400\n', 1, 1, 1, 9, "Your variables and lists use about 1,600 of the board's 2,048 bytes of memory: the program may not run on the real board."],
  ['W-lcd-char', 'from zero1 import LCD\nlcd = LCD()\nlcd.putstr("été")\n', 3, 12, 3, 17, "The LCD cannot show 'é': it shows another symbol. Use plain letters on the LCD (° works)."],
  ['W-text-bytes', 'print(len("été"))\n', 1, 11, 1, 16, "'é' takes 2 bytes on the board: len(), [i], for … in and ord() count bytes there, so they give other results than Python."],
  ['W-escape', 'print("a\\d")\n', 1, 9, 1, 11, "'\\d' is not an escape sequence: Python keeps the backslash. Write '\\\\d', or use a raw string r'…'."],
  ['W-recursion', 'def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nprint(fact(5))\n', 1, 5, 1, 9,
    "'fact' calls itself: each call uses memory on the board, and about 50 calls deep the board crashes (the simulator does not notice)."],

  // §5.8 Translator-internal
  ['X-too-long', `x = 1\n${'#'.repeat(50_001)}\n`, 1, 1, undefined, undefined, 'This program is too long for the simulator: 50,000 bytes at most (it has 50,008).'],
];

/** Codes no program can produce from pythonToArduino yet: the emitter's, the running board's, the app's. */
const OTHER_STAGES: Partial<Record<MessageCode, string>> = {
  'X-internal': 'a bug in the translator (pythonToArduino catches every exception)',
  'X-sketch-error': 'the app, when transpile() refuses a generated sketch (§7.8)',
  'X-sketch-too-long': 'a generated sketch over 50,000 bytes (tests/python-emit.test.ts)',
  'W-sketch': 'the app, when transpile() warns about a generated sketch (§7.8)',
  'R-index': 'pyIndex at run time',
  'R-str-index': 'pyCharAt at run time',
  'R-pop-empty': 'pyPop… at run time',
  'R-pop-index': 'pyPop… at run time',
  'R-zero': 'pyNonZero at run time',
  'R-int': 'pyInt at run time',
  'R-float': 'pyFloatOf at run time',
  'R-min-empty': 'pyMinList… at run time',
  'R-max-empty': 'pyMaxList… at run time',
  'R-sleep': 'pySleep at run time',
  'R-list-full': 'pyAppend… at run time',
  'R-dht': 'the DHT check at run time',
  'R-sonar': 'pyDistanceCm at run time',
  'R-neg-power': 'pyPow at run time',
  'R-assert': 'assert at run time',
  'R-raise': 'raise at run time',
};

/** Codes whose texts start with Python's error class (CPython would stop there too, §5.0). */
const PYTHON_ERROR_CLASSES = new Set([
  'SyntaxError', 'IndentationError', 'TabError', 'NameError', 'UnboundLocalError', 'ModuleNotFoundError', 'ImportError', 'AttributeError',
  'TypeError', 'ValueError', 'IndexError', 'ZeroDivisionError', 'MemoryError', 'OSError', 'AssertionError',
]);
const classFirst = (code: MessageCode) =>
  code.startsWith('S-') ||
  ['E-name', 'E-name-true', 'E-name-later', 'E-missing-import', 'E-unbound-local', 'E-module', 'E-import-name', 'E-attr', 'E-attr-object', 'E-attr-int-pin', 'E-class-not-part', 'E-not-callable'].includes(code) ||
  ['E-concat', 'E-operand', 'E-compare', 'E-index-float', 'E-range-float', 'E-bitop-float', 'E-repeat-float', 'E-len', 'E-not-iterable', 'E-range-step', 'E-args-count', 'E-kwarg', 'E-api-kind', 'E-format-code', 'E-format-zero-text', 'E-sleep-ms-float'].includes(code) ||
  (code.startsWith('R-') && code !== 'R-neg-power' && code !== 'R-raise');
/** ZERO1 limits worded "ZERO1 Python …" (§5.0, §5.4): every NA code but NA-object-here (its §5.4 text starts "Make the …"), and the E- codes of §5.4 and E-range-value. */
const zero1Limit = (code: MessageCode) => (code.startsWith('NA-') && code !== 'NA-object-here') || ['E-retype', 'E-param-kinds', 'E-return-kinds', 'E-list-kinds', 'E-range-value'].includes(code);

/** C++ words a student did not write (§5.0): only board-fact hints may use them, and none does. */
const CPP_WORDS =
  /\b(?:digitalWrite|digitalRead|analogWrite|analogRead|pinMode|String|delay|millis|micros|setup\(\)|loop\(\)|OUTPUT|INPUT_PULLUP|HIGH|LOW|boolean|uint\w*|nullptr)\b|Serial\.|#include|\b(?:long|void|byte|unsigned|const)\s+[a-z_]\w*\s*[=;([]/;

const allTexts = (): Array<[string, string]> => [
  ...Object.entries(MESSAGES).map(([code, text]): [string, string] => [code, text]),
  ...Object.entries(MESSAGE_VARIANTS).flatMap(([code, texts]) => (texts ?? []).map((t, i): [string, string] => [`${code} (form ${i + 1})`, t])),
];

describe('every code of §5 with a minimal program (table-driven from MESSAGES)', () => {
  it.each(ROWS)('%s', (code, program, line, column, endLine, endColumn, text) => {
    const result = pythonToArduino(program);
    const d = result.diagnostics.find((x) => x.code === code);
    expect(d, JSON.stringify(result.diagnostics.map((x) => `${x.code}: ${x.message}`))).toBeDefined();
    expect(d!.message).toBe(text);
    expect([d!.line, d!.column, d!.endLine, d!.endColumn]).toEqual([line, column, endLine, endColumn]);
    expect(d!.severity).toBe(code.startsWith('W-') ? 'warning' : 'error');
    if (d!.severity === 'error') expect(result.ok).toBe(false);
  });
});

describe('the other forms of a message (MESSAGE_VARIANTS)', () => {
  const cases: Array<[MessageCode, string, string]> = [
    ['E-args-count', 'def f(a, b):\n    return a\nprint(f(1))\n', "TypeError: f() missing 1 required positional argument: 'b'"],
    ['E-args-count', 'import time\ntime.sleep()\n', "TypeError: sleep() missing 1 required positional argument: 'seconds'"],
    ['E-args-count', 'def f(a, b, c):\n    return a\nprint(f())\n', "TypeError: f() missing 3 required positional arguments: 'a', 'b', and 'c'"],
    ['E-args-count', 'def f(a, b=1):\n    return a\nprint(f(1, 2, 3))\n', 'TypeError: f() takes from 1 to 2 positional arguments but 3 were given'],
    ['E-args-count', 'def f():\n    return 1\nprint(f(1))\n', 'TypeError: f() takes 0 positional arguments but 1 was given'],
    ['E-bitop-float', 'x = 2.5\nprint(~x)\n', "TypeError: bad operand type for unary ~: 'float'"],
    ['E-operand', 'print(-"abc")\n', "TypeError: bad operand type for unary -: 'str'"],
    ['E-compare', 'if 5 in "abc":\n    pass\n', "TypeError: 'in <string>' requires string as left operand, not int"],
    ['E-index-float', 'items = [1, 2]\nprint(items["a"])\n', 'TypeError: list indices must be integers or slices, not str'],
    ['E-index-float', 'x = 5\nprint(x[0])\n', "TypeError: 'int' object is not subscriptable"],
    ['E-index-float', 'x = 5\nx[0] = 1\n', "TypeError: 'int' object does not support item assignment"],
    ['E-kwarg', 'def f(a):\n    pass\nf(1, a=2)\n', "TypeError: f() got multiple values for argument 'a'"],
    ['NA-none-value', 'import dht\nfrom machine import Pin\nsensor = dht.DHT22(Pin(5))\nok = sensor.measure()\n',
      'ZERO1 Python does not have None as a value yet: measure() gives no value, so there is nothing to store. For the sensor: call sensor.measure() on its own line, then read sensor.temperature().'],
    ['E-retype', 'x = (255, 0, 0)\nwhile True:\n    print(x == 1)\n    x = "red"\n',
      "ZERO1 Python does not have variables that are sometimes a colour and sometimes text yet: 'x' can be a colour (line 1) or text (line 4) on line 3. Use two names."],
    ['E-retype', 'x = 1\nprint("a" if x else 2)\n', 'ZERO1 Python does not have values that are sometimes text and sometimes a number yet: this line gives text or a number. Use str() on the number.'],
    ['W-pwm-pin', 'from machine import Pin, PWM\npwm = PWM(Pin(13))\n', 'Pin 13 (D13, the built-in LED) cannot dim: only pins 3, 5, 6, 9, 10 and 11 have PWM on the UNO. duty_u16() of 32768 or more switches it on, less switches it off.'],
    ['W-pwm-pin', 'from machine import Pin, PWM\npwm = PWM(Pin(1))\n', 'Pin 1 (D1) cannot dim: only pins 3, 5, 6, 9, 10 and 11 have PWM on the UNO. duty_u16() of 32768 or more switches it on, less switches it off.'],
    ['E-part-pin', 'from machine import Pin\nfrom neopixel import NeoPixel\nnp = NeoPixel(Pin(5), 1)\n', 'The ZERO1 RGB LED is wired to D9 (RGB_PIN): write NeoPixel(Pin(RGB_PIN), 1).'],
    ['E-part-pin', 'from zero1 import HCSR04\nsonar = HCSR04(trigger_pin=5)\n', 'The ZERO1 ultrasonic sensor is wired to D3 (TRIG_PIN) and D2 (ECHO_PIN): write HCSR04() without a pin.'],
    ['W-shadow', 'from machine import Pin\nPin = 5\nprint(Pin)\n', "'Pin' was imported from machine: from here on, Pin() cannot be used in this program."],
    ['E-param-kinds', 'def show(x):\n    print(x)\nitems = [1, 2]\nshow(5)\nshow(items)\n',
      'ZERO1 Python does not have functions that take a number and a list in the same place yet: show() gets a number on line 4 and a list on line 5.'],
    ['E-return-kinds', 'def pick(t):\n    if t:\n        return 5\n    return (255, 0, 0)\nprint(pick(1) == 1)\n',
      "ZERO1 Python does not have functions that give a number and a colour yet: 'pick' gives a number on line 3 and a colour on line 4."],
    ['E-list-kinds', 'items = [1, (255, 0, 0)]\n', "ZERO1 Python does not have lists that mix a number and a colour yet: 'items' gets a number on line 1 and a colour on line 1."],
    ['E-unbound-local', 'def f():\n    print(y)\n    y = 1\nf()\n', "UnboundLocalError: cannot access local variable 'y' where it is not associated with a value"],
    ['E-name', 'print(zzz)\n', "NameError: name 'zzz' is not defined"],
    ['E-not-callable', 'lst = [1]\nlst[0]()\n', "TypeError: 'int' object is not callable"],
    ['E-attr-object', 'x = 5\nx.foo()\n', "AttributeError: 'int' object has no attribute 'foo'"],
    ['W-no-effect', 'from machine import Pin\nled = Pin(15, Pin.OUT)\nled.on\n', 'This line does nothing: it works out a value and throws it away. Did you mean led.on()?'],
    ['W-no-effect', 'x = 5\nx + 1\n', 'This line does nothing: it works out a value and throws it away.'],
    ['NA-value', 'import time\nx = time\n', 'ZERO1 Python does not have modules as values yet: use their names, for example time.sleep(1)'],
    ['NA-value', 'from machine import Pin\nx = Pin\n', 'ZERO1 Python does not have kinds of part as values yet: make one: led = Pin(LED_RED, Pin.OUT)'],
    ['NA-value', 'x = len\n', 'ZERO1 Python does not have built-in functions as values yet: call it with (): len()'],
    ['NA-value', 'from machine import Pin\nled = Pin(15, Pin.OUT)\nprint(led)\n', 'ZERO1 Python does not have parts as values yet: use their methods, for example led.on()'],
    ['NA-builtin', 'print(divmod(7, 2))\n', 'ZERO1 Python does not have divmod() yet. Use // and %. Built-ins you can use: print, input, len, range, int, float, str, bool, abs, min, max, round, pow, chr, ord, sum.'],
    ['NA-builtin', 'x = [1]\nprint(id(x))\n', 'ZERO1 Python does not have id() yet. Built-ins you can use: print, input, len, range, int, float, str, bool, abs, min, max, round, pow, chr, ord, sum.'],
    ['E-api-kind', 'from zero1 import Servo\nservo = Servo()\nservo.angle("x")\n', 'TypeError: angle() needs a whole number: use servo.angle(int(x))'],
    ['E-api-kind', 'from machine import Pin\np = Pin(13, 5)\n', 'TypeError: Pin() needs Pin.IN or Pin.OUT: use Pin(LED_RED, Pin.OUT)'],
  ];
  it.each(cases)('%s: %j', (code, program, text) => {
    const result = pythonToArduino(program);
    expect(result.diagnostics.filter((d) => d.code === code).map((d) => d.message)).toContain(text);
  });
});

describe('the review cases of §10.2', () => {
  const codes = (program: string) => pythonToArduino(program).diagnostics.map((d) => d.code);
  /** Every diagnostic check() finds, warnings too (pythonToArduino drops warnings when there is an error). */
  const allCodes = (program: string) => {
    const text = normalize(program);
    const resolved = resolve(parseSource(text), text);
    const flow = analyzeFlow(resolved);
    return check(resolved, flow, infer(resolved, flow)).map((d) => d.code);
  };
  it('readings[len(readings) / 2] → E-index-float; range(2.0) → E-range-float; 1.5 & 1 → E-bitop-float', () => {
    expect(codes('readings = [1]\nprint(readings[len(readings) / 2])\n')).toContain('E-index-float');
    expect(codes('for i in range(2.0):\n    pass\n')).toContain('E-range-float');
    expect(codes('print(1.5 & 1)\n')).toContain('E-bitop-float');
  });
  it('f"{1.5:d}" → E-format-code; "M" > 5 → E-compare; name == 5 → W-str-num-eq', () => {
    expect(codes('print(f"{1.5:d}")\n')).toContain('E-format-code');
    expect(codes('print("M" > 5)\n')).toContain('E-compare');
    expect(codes('name = input()\nprint(name == 5)\n')).toContain('W-str-num-eq');
  });
  it('LED_RED.on() → E-attr-int-pin; Buzzer.tone(440) → E-class-not-part', () => {
    expect(codes('from zero1 import LED_RED\nLED_RED.on()\n')).toEqual(['E-attr-int-pin']);
    expect(codes('from zero1 import Buzzer\nBuzzer.tone(440)\n')).toEqual(['E-class-not-part']);
  });
  it('time.sleep(500) → W-sleep-long; time.sleep_ms(0.5) → E-sleep-ms-float', () => {
    expect(codes('import time\ntime.sleep(500)\n')).toContain('W-sleep-long');
    expect(codes('import time\ntime.sleep(59)\n')).not.toContain('W-sleep-long');
    expect(codes('import time\nWAIT = 90\ntime.sleep(WAIT)\n')).toContain('W-sleep-long');
    expect(codes('import time\ntime.sleep_ms(0.5)\n')).toEqual(['E-sleep-ms-float']);
  });
  it('max = 0 then max(1, 2) → W-shadow + E-not-callable', () => {
    expect(allCodes('max = 0\nprint(max(1, 2))\n')).toEqual(expect.arrayContaining(['W-shadow', 'E-not-callable']));
    expect(codes('max = 0\nprint(max(1, 2))\n')).toEqual(['E-not-callable']); // warnings only without errors
    expect(codes('print(max(1, 2))\nmax = 0\n')).toContain('W-shadow'); // before the assignment it is still the built-in
  });
  it('x = sensor.measure() → NA-none-value; try … finally → NA-try', () => {
    expect(codes('import dht\nfrom machine import Pin\nsensor = dht.DHT22(Pin(5))\nx = sensor.measure()\n')).toEqual(['NA-none-value']);
    expect(codes('try:\n    x = 1\nfinally:\n    pass\n')).toContain('NA-try');
  });
});

describe('the list of diagnostics', () => {
  it('lists errors first, each group by position, and warnings only when there is no error', () => {
    const result = pythonToArduino('print(zzz)\nx = true\nimport time\ntime.sleep(500)\n');
    expect(result.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['E-name', 1],
      ['E-name-true', 2],
    ]);
    expect(result.ok).toBe(false);
    expect(result.sketch).toBe('// Your Python program has 2 errors, so there is no Arduino sketch yet.\n// Fix them in the Python tab (see the console), then this tab shows the sketch.\n');
  });
  it('keeps at most 20 errors, then X-too-many; the placeholder counts all of them', () => {
    const program = Array.from({ length: 27 }, (_, i) => `print(undefined_${i})`).join('\n') + '\n';
    const result = pythonToArduino(program);
    expect(result.diagnostics).toHaveLength(21);
    expect(result.diagnostics[20]).toMatchObject({ code: 'X-too-many', severity: 'error', line: 21, message: '… and 7 more errors' });
    expect(result.sketch.startsWith('// Your Python program has 27 errors')).toBe(true);
  });
  it('reports an undefined name once, where it is first used', () => {
    expect(pythonToArduino('led = Pin(13)\nled2 = Pin(12)\n').diagnostics.map((d) => [d.code, d.line])).toEqual([['E-missing-import', 1]]);
  });
  it('analyze() gives the checked, typed program with its diagnostics', () => {
    const text = 'x = 5\nprint(x)\n';
    const a = analyze(parseSource(text), text);
    expect(a.errorCount).toBe(0);
    expect(a.diagnostics).toEqual([]);
    expect(a.typing.variables.map((v) => [v.sym.name, v.kind])).toEqual([['x', 'int']]);
  });
});

describe('meta-tests on the message catalogue (§10.2)', () => {
  it('every code has a text, and every one is covered by a row here or produced by a later stage', () => {
    const covered = new Set<string>([...ROWS.map((r) => r[0]), 'X-too-many', ...Object.keys(OTHER_STAGES)]);
    for (const code of Object.keys(MESSAGES)) expect(covered.has(code), code).toBe(true);
    for (const [code] of ROWS) expect(MESSAGES[code], code).toBeDefined();
  });
  it('every text (and every other form) is at most 240 characters, also filled in', () => {
    for (const [code, text] of allTexts()) expect(text.length, code).toBeLessThanOrEqual(240);
    for (const [code, , , , , , text] of ROWS) expect(text.length, code).toBeLessThanOrEqual(240);
  });
  it("starts with Python's error class where CPython would stop too, and only there", () => {
    for (const [code, text] of Object.entries(MESSAGES) as Array<[MessageCode, string]>) {
      const cls = /^(\w+): /.exec(text)?.[1];
      if (classFirst(code)) expect(PYTHON_ERROR_CLASSES.has(cls ?? ''), `${code}: ${text}`).toBe(true);
      else expect(cls && PYTHON_ERROR_CLASSES.has(cls), `${code}: ${text}`).toBeFalsy();
    }
    for (const [code, texts] of Object.entries(MESSAGE_VARIANTS) as Array<[MessageCode, string[]]>) {
      for (const text of texts) expect(PYTHON_ERROR_CLASSES.has(/^(\w+)(?:: |$)/.exec(text)?.[1] ?? ''), `${code}: ${text}`).toBe(classFirst(code));
    }
  });
  it('words the ZERO1 limits "ZERO1 Python …" (NA-object-here keeps its §5.4 text)', () => {
    for (const [code, text] of allTexts()) {
      const base = code.split(' ')[0] as MessageCode;
      if (zero1Limit(base)) expect(text.startsWith('ZERO1 Python'), `${code}: ${text}`).toBe(true);
    }
    expect(MESSAGES['NA-object-here'].startsWith('Make the {part} at the top of the program')).toBe(true);
  });
  it('uses no C++ word the student did not write', () => {
    for (const [code, text] of allTexts()) expect(CPP_WORDS.test(text), `${code}: ${text}`).toBe(false);
  });
  it('fills parameters; a null one leaves out its sentence (and the final period of a Python error)', () => {
    expect(message('E-name', { x: 'a', y: 'b' })).toBe("NameError: name 'a' is not defined. Did you mean: 'b'?");
    expect(message('E-name', { x: 'a', y: null })).toBe("NameError: name 'a' is not defined");
    expect(message('W-no-effect', { hint: null })).toBe('This line does nothing: it works out a value and throws it away.');
    expect(message('NA-builtin', { f: 'id', hint: '' })).toBe(
      'ZERO1 Python does not have id() yet. Built-ins you can use: print, input, len, range, int, float, str, bool, abs, min, max, round, pow, chr, ord, sum.',
    );
    expect(message('E-args-count', { f: 'f', missing: '1 required positional argument', names: "'x'" }, 1)).toBe("TypeError: f() missing 1 required positional argument: 'x'");
    expect(message('R-assert', {}, 1)).toBe('AssertionError');
    expect(message('R-assert', { message: 'too hot' })).toBe('AssertionError: too hot');
    expect(message('NA-str-format')).toBe('ZERO1 Python does not have % formatting and .format() yet. Use an f-string: f"T = {t}"');
  });
});
