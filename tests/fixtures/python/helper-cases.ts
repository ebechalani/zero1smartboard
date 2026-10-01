/**
 * The helper cases of tests/python-helpers.test.ts (the simulator) and
 * tests-hardware-sim/python-board.test.ts (the chip, avr8js): sketches that call each helper of
 * docs/PYTHON.md §4.8 and what Python gives for each call (§2.13, §5.6).
 */
import { PY_HELPERS, helperTexts } from '../../../src/python/helpers';
import { message } from '../../../src/python/messages';

/** A sketch that prints each expression on its own line (the helpers after loop(), as the emitter writes them). */
export function helperSketch(lines: readonly string[], globals = ''): string {
  return `${globals}void setup() {\n  Serial.begin(9600);\n${lines.map((l) => `  ${l}\n`).join('')}}\n\nvoid loop() {\n}\n\n${helperTexts(Object.keys(PY_HELPERS).filter((n) => n.startsWith('py'))).join('\n\n')}\n`;
}

/** Each helper call and what Python gives (CPython 3.12; decimal numbers printed like MicroPython, §2.11). */
export const HELPER_VALUES: ReadonlyArray<readonly [string, string]> = [
  // // and % (floor division, the sign of the divisor)
  ['pyFloorDiv(7, 2)', '3'], ['pyFloorDiv(-7, 2)', '-4'], ['pyFloorDiv(7, -2)', '-4'], ['pyFloorDiv(-7, -2)', '3'], ['pyFloorDiv(-6, 3)', '-2'], ['pyFloorDiv(0, 5)', '0'],
  ['pyMod(7, 3)', '1'], ['pyMod(-7, 3)', '2'], ['pyMod(7, -3)', '-2'], ['pyMod(-7, -3)', '-1'], ['pyMod(-6, 3)', '0'],
  ['pyFloat(pyFloatMod(5.5, 2))', '1.5'], ['pyFloat(pyFloatMod(-5.5, 2))', '0.5'], ['pyFloat(pyFloatMod(5.5, -2))', '-0.5'], ['pyFloat(pyFloatMod(-1.0, 3.0))', '2.0'],
  ['pyNonZero(-3, 1)', '-3'], ['pyFloat(pyNonZeroF(0.5, 1))', '0.5'],
  // ** and round()
  ['pyPow(2, 10, 1)', '1024'], ['pyPow(-3, 3, 1)', '-27'], ['pyPow(5, 0, 1)', '1'],
  ['pyFloat(pyPow10(3))', '1000.0'], ['pyFloat(pyPow10(-2))', '0.01'],
  ['pyRound(2.5)', '2'], ['pyRound(3.5)', '4'], ['pyRound(-2.5)', '-2'], ['pyRound(0.5)', '0'], ['pyRound(1.5)', '2'], ['pyRound(2.4)', '2'], ['pyRound(2.6)', '3'], ['pyRound(-0.6)', '-1'],
  ['pyFloat(pyRoundTo(3.14159, 2))', '3.14'], ['pyFloat(pyRoundTo(-1.25, 1))', '-1.2'], ['pyFloat(pyRoundTo(2.0, 3))', '2.0'],
  // round(x, n) sends halves to the even number too (all exact in float32), and keeps the sign of 0
  ['pyFloat(pyRoundTo(1.25, 1))', '1.2'], ['pyFloat(pyRoundTo(0.125, 2))', '0.12'], ['pyFloat(pyRoundTo(2.5, 0))', '2.0'], ['pyFloat(pyRoundTo(3.5, 0))', '4.0'], ['pyFloat(pyRoundTo(-0.4, 0))', '-0.0'],
  // << and >> by a count worked out while running
  ['pyShift(5, 2, true, 1)', '20'], ['pyShift(1024, 3, false, 1)', '128'], ['pyShift(-1024, 3, false, 1)', '-128'], ['pyShift(-1024, 40, false, 1)', '-1'], ['pyShift(1024, 40, false, 1)', '0'],
  // abs, min, max
  ['pyAbsL(-5)', '5'], ['pyAbsL(7)', '7'], ['pyFloat(pyAbsF(-2.5))', '2.5'], ['pyMinL(3, -2)', '-2'], ['pyMaxL(3, -2)', '3'], ['pyFloat(pyMinF(2.5, 1.5))', '1.5'], ['pyFloat(pyMaxF(2.5, -2))', '2.5'],
  // how Python shows values
  ['pyBool(true)', 'True'], ['pyBool(false)', 'False'],
  ['pyFloat(0.1 + 0.2)', '0.3'], ['pyFloat(1.0 / 3)', '0.3333333'], ['pyFloat(24.3)', '24.3'], ['pyFloat(1234567.0)', '1234567.0'], ['pyFloat(12345678.0)', '1.234568e+07'],
  ['pyFloat(0.0001)', '0.0001'], ['pyFloat(0.00012345678)', '0.0001234568'], ['pyFloat(1e-07)', '1e-07'], ['pyFloat(1.5e-05)', '1.5e-05'], ['pyFloat(1e+10)', '1e+10'], ['pyFloat(1e+07)', '1e+07'],
  ['pyFloat(-2.5e-06)', '-2.5e-06'], ['pyFloat(99999.99)', '99999.99'], ['pyFloat(3.0)', '3.0'], ['pyFloat(-0.5)', '-0.5'], ['pyFloat(9999999.6)', '1e+07'], ['pyFloat(100.0)', '100.0'], ['pyFloat(123456.7)', '123456.7'],
  ['pyFloat(0.0)', '0.0'], ['pyFloat(-0.0)', '-0.0'], ['pyFloat(0.0 * -5)', '-0.0'], ['pyFloat(sqrt(-1))', 'nan'], ['pyFloat(1.0 / 0.0)', 'inf'], ['pyFloat(-1.0 / 0.0)', '-inf'],
  // f-string widths, hex and binary
  [`pyPad("5", 3, '>')`, '  5'], [`pyPad("-5", 3, '0')`, '-05'], [`pyPad("7", 3, '0')`, '007'], [`pyPad("ab", 5, '<') + "|"`, 'ab   |'], [`pyPad("abc", 2, '<')`, 'abc'],
  ['pyHex(255, false)', 'ff'], ['pyHex(255, true)', 'FF'], ['pyHex(-1, false)', '-1'], ['pyHex(-255, true)', '-FF'], ['pyHex(0, false)', '0'],
  ['pyBin(5)', '101'], ['pyBin(-5)', '-101'], ['pyBin(0)', '0'],
  // int() and float() of text
  ['pyBool(pyIsInt(" 42 "))', 'True'], ['pyBool(pyIsInt("-7"))', 'True'], ['pyBool(pyIsInt("+3"))', 'True'], ['pyBool(pyIsInt("12abc"))', 'False'], ['pyBool(pyIsInt(""))', 'False'], ['pyBool(pyIsInt("-"))', 'False'], ['pyBool(pyIsInt("4.0"))', 'False'],
  ['pyInt(" 42 ", 1)', '42'], ['pyInt("-7", 1)', '-7'],
  ['pyBool(pyIsFloat("2.5"))', 'True'], ['pyBool(pyIsFloat(" -1e3 "))', 'True'], ['pyBool(pyIsFloat(".5"))', 'True'], ['pyBool(pyIsFloat("5."))', 'True'], ['pyBool(pyIsFloat("1e"))', 'False'], ['pyBool(pyIsFloat("1.5.2"))', 'False'], ['pyBool(pyIsFloat("abc"))', 'False'], ['pyBool(pyIsFloat(""))', 'False'],
  ['pyFloat(pyFloatOf(" 2.5 ", 1))', '2.5'], ['pyFloat(pyFloatOf("-1e3", 1))', '-1000.0'],
  // text methods
  ['pyBool(pyIsDigit("123"))', 'True'], ['pyBool(pyIsDigit(""))', 'False'], ['pyBool(pyIsDigit("12a"))', 'False'], ['pyBool(pyIsDigit("-1"))', 'False'],
  ['pyUpper("abc")', 'ABC'], ['pyLower("AbC")', 'abc'], ['pyStrip("  hi  ") + "|"', 'hi|'], ['pyReplace("banana", "a", "o")', 'bonono'],
  ['pyCharAt("hello", 1, 1)', 'e'], ['pyCharAt("hello", -1, 1)', 'o'], ['pyIndex(-1, 3, 1)', '2'], ['pyIndex(2, 3, 1)', '2'],
  // lists: [3, 1, 2]
  // map_range() and the math functions with a domain
  ['pyMapRange(5, 0, 10, 0, 100, 1)', '50'], ['pyFloat(pySqrt(6.25, 1))', '2.5'], ['pyFloat(pyLog(1, 1))', '0.0'], ['pyFloat(pyLog10(0.01, 1))', '-2.0'], ['pyFloat(pyAsin(0, 1))', '0.0'], ['pyFloat(pyAcos(1, 1))', '0.0'],
  ['pyListTextL(nums, numsCount)', '[3, 1, 2]'], ['pySumL(nums, numsCount)', '6'], ['pyMinListL(nums, numsCount, 1)', '1'], ['pyMaxListL(nums, numsCount, 1)', '3'],
  ['pyBool(pyInListL(nums, numsCount, 2))', 'True'], ['pyBool(pyInListL(nums, numsCount, 5))', 'False'],
  ['pyListTextF(decimals, 2)', '[1.5, 2.0]'], ['pyFloat(pySumF(decimals, 2))', '3.5'], ['pyListTextS(words, 2)', "['a', 'b']"], ['pyListTextB(flags, 2)', '[True, False]'], ['pyListTextC(colours, 2)', '[(255, 0, 0), (0, 128, 255)]'],
];

export const HELPER_GLOBALS =
  'long nums[5] = {3, 1, 2};\nlong numsCount = 3;\nfloat decimals[2] = {1.5, 2.0};\nString words[2] = {"a", "b"};\nbool flags[2] = {true, false};\nunsigned long colours[2] = {0xFF0000, 0x0080FF};\n\n';

/** Each helper that stops the program, the call, and Python's error (§5.6). */
export const HELPER_STOPS: ReadonlyArray<readonly [string, string, string]> = [
  ['pyFail', 'pyFail(3, "RuntimeError: stop");', 'RuntimeError: stop'],
  ['pyNonZero', 'Serial.println(10 / pyNonZero(0, 12));', message('R-zero')],
  ['pyNonZeroF', 'Serial.println(1.5 / pyNonZeroF(0.0, 12));', message('R-zero')],
  ['pyPow', 'Serial.println(pyPow(2, -1, 12));', message('R-neg-power')],
  ['pyShift', 'Serial.println(pyShift(1, -1, true, 12));', message('R-shift')],
  ['pyMapRange', 'Serial.println(pyMapRange(3, 5, 5, 0, 100, 12));', message('R-zero')],
  ['pySqrt', 'Serial.println(pySqrt(-1, 12));', message('R-math-domain')],
  ['pyLog', 'Serial.println(pyLog(0, 12));', message('R-math-domain')],
  ['pyLog10', 'Serial.println(pyLog10(-2.5, 12));', message('R-math-domain')],
  ['pyAsin', 'Serial.println(pyAsin(1.5, 12));', message('R-math-domain')],
  ['pyAcos', 'Serial.println(pyAcos(-2, 12));', message('R-math-domain')],
  ['pyInt', 'Serial.println(pyInt("12abc", 12));', message('R-int', { text: '12abc' })],
  ['pyFloatOf', 'Serial.println(pyFloatOf("abc", 12));', message('R-float', { text: 'abc' })],
  ['pyCharAt', 'Serial.println(pyCharAt("hi", 5, 12));', message('R-str-index')],
  ['pyIndex', 'Serial.println(nums[pyIndex(3, numsCount, 12)]);', message('R-index')],
  ['pyAppendL', 'for (int i = 0; i < 3; i++) numsCount = pyAppendL(nums, numsCount, 5, i, 12);', message('R-list-full', { n: 5 })],
  ['pyPopL (empty)', 'numsCount = 0;\n  pyPopL(nums, numsCount, -1, 12);', message('R-pop-empty')],
  ['pyPopL (index)', 'pyPopL(nums, numsCount, 3, 12);', message('R-pop-index')],
  ['pyMinListL', 'Serial.println(pyMinListL(nums, 0, 12));', message('R-min-empty')],
  ['pyMaxListL', 'Serial.println(pyMaxListL(nums, 0, 12));', message('R-max-empty')],
  ['pySleep', 'pySleep(-0.5, 12);', message('R-sleep')],
  ['pySleepMs', 'pySleepMs(-1, 12);', message('R-sleep')],
  ['pyDistanceCm', 'pinMode(3, OUTPUT);\n  pinMode(2, INPUT);\n  Serial.println(pyDistanceCm(3, 2, 12));', message('R-sonar')],
];

/** Where the board (and so the simulator) differs from CPython on purpose (§2.13): the call, the board's value, CPython's. */
export const HELPER_BOARD_VALUES: ReadonlyArray<readonly [string, string, string]> = [
  ['pyFloat(pyRoundTo(2.675, 2))', '2.68', '2.67'], // in float32, 2.675 × 100 is exactly 267.5
  ['pyPow(2, 31, 1)', '-2147483648', '2147483648'], // whole numbers are 32 bits
  ['pyShift(1, 31, true, 1)', '-2147483648', '2147483648'], // whole numbers are 32 bits
  ['pyShift(1, 40, true, 1)', '0', '1099511627776'], // whole numbers are 32 bits
  ['pyBool(pyIsInt("1_000"))', 'False', 'True'], // int() of text with _ is not supported on the board
];
