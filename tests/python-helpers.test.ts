/**
 * The C++ helpers that make a sketch behave like Python (docs/PYTHON.md §4.8, §2.13, §5.6):
 * their texts are §4.8's, verbatim; the list variants follow the …L template; each is emitted
 * with the helpers it needs; and, run in the simulator, each gives the value Python gives
 * (CPython 3.12 for the arithmetic and text, MicroPython ≤ 1.25 on a single-precision port for
 * printing decimal numbers, §2.11) or stops with Python's error on the Python line (§5.6). The
 * same sketches on the real chip (avr8js): tests-hardware-sim/python-board.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PY_HELPERS, helperOrder, helperTexts, stopsProgram, withNeeds } from '../src/python/helpers';
import { pythonizeRuntimeMessage } from '../src/python/messages';
import { RESERVED_NAMES } from '../src/python/reserved-names';
import { ABORT_MESSAGE } from '../src/runtime/values';
import { SEGMENT_HELPERS } from '../src/sketch/helpers';
import { runSketch } from './helpers';
import { HELPER_BOARD_VALUES, HELPER_GLOBALS, HELPER_STOPS, HELPER_VALUES, helperSketch } from './fixtures/python/helper-cases';

/** The helpers §4.8 lists, in its order. */
const SPEC_HELPERS = [
  'pyFail', 'pyFloorDiv', 'pyMod', 'pyFloatMod', 'pyNonZero', 'pyNonZeroF', 'pyPow', 'pyPow10', 'pyRound', 'pyRoundTo', 'pyShift',
  'pyAbsL', 'pyAbsF', 'pyMinL', 'pyMaxL', 'pyMinF', 'pyMaxF', 'pyBool', 'pyFloat', 'pyDigits', 'pySignificant', 'pyPad',
  'pyHex', 'pyBin', 'pyInput', 'pyIsInt', 'pyInt', 'pyIsFloat', 'pyFloatOf', 'pyIsDigit', 'pyUpper', 'pyLower', 'pyStrip',
  'pyReplace', 'pyCharAt', 'pyIndex', 'pyAppendL', 'pyPopL', 'pyListTextL', 'pySumL', 'pyMinListL', 'pyMaxListL', 'pyInListL',
  'pySleep', 'pySleepMs', 'pyMapRange', 'pySqrt', 'pyLog', 'pyLog10', 'pyAsin', 'pyAcos', 'pyDistanceCm',
];

function specHelperBlock(): string {
  const spec = readFileSync(new URL('../docs/PYTHON.md', import.meta.url), 'utf8');
  const section = spec.slice(spec.indexOf('### 4.8'), spec.indexOf('### 4.9'));
  return /```cpp\n([\s\S]*?)\n```/.exec(section)![1];
}

describe('the helper texts (§4.8)', () => {
  it('are §4.8 verbatim, comments and order included', () => {
    expect(helperTexts(SPEC_HELPERS).join('\n\n')).toBe(specHelperBlock());
  });

  it('the list variants follow the …L template: pyListTextF uses pyFloat, …S quotes, …B uses pyBool; no sum/min/max of text', () => {
    expect(PY_HELPERS.pyAppendF).toBe(PY_HELPERS.pyAppendL.replace(/long list\[\]/, 'float list[]').replace('long value', 'float value').replace('pyAppendL', 'pyAppendF'));
    expect(PY_HELPERS.pyListTextF).toContain('text += pyFloat(list[i]);');
    expect(PY_HELPERS.pyListTextS).toContain(`text += String("'") + list[i] + "'";`);
    expect(PY_HELPERS.pyListTextB).toContain('text += pyBool(list[i]);');
    expect(PY_HELPERS.pyPopS).toContain('String pyPopS(String list[], long count, long index, int line) {');
    expect(PY_HELPERS.pySumF).toContain('float pySumF(float list[], long count) {');
    for (const name of ['pySumS', 'pyMinListS', 'pyMaxListS', 'pySumC', 'pySumP']) expect(PY_HELPERS[name], name).toBeUndefined();
  });

  it('come with the helpers they call, in §4.8 order; the ones that can stop the program need Serial', () => {
    expect(withNeeds(['pyFloat'])).toEqual(['pyPow10', 'pyFloat', 'pyDigits', 'pySignificant']);
    expect(withNeeds(['pyListTextF', 'pyIndex'])).toEqual(['pyFail', 'pyPow10', 'pyFloat', 'pyDigits', 'pySignificant', 'pyIndex', 'pyListTextF']);
    expect(withNeeds(['showDigit'])).toEqual(['showSegments', 'showDigit']);
    expect(helperTexts(['showDigit'])).toEqual([SEGMENT_HELPERS.showSegments, SEGMENT_HELPERS.showDigit]);
    expect(helperTexts(['pyMaxF', 'pyAbsL']).map((t) => t.split('\n')[0])).toEqual([
      "// Python's abs(), min() and max(): each value is worked out once (Arduino's abs/min/max are macros)",
      'float pyMaxF(float a, float b) {',
    ]);
    expect(stopsProgram(['pyFloat', 'pyPad'])).toBe(false);
    expect(stopsProgram(['pyIndex'])).toBe(true);
    expect(stopsProgram(['pyAppendB'])).toBe(true);
  });

  it('every helper is in helperOrder, and every helper name is reserved (§2.14)', () => {
    expect([...helperOrder].sort()).toEqual(Object.keys(PY_HELPERS).sort());
    for (const name of helperOrder) expect(RESERVED_NAMES.has(name), name).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// behaviour in the simulator
// ---------------------------------------------------------------------------

describe('the helpers in the simulator give Python’s values', () => {
  it('for every value of the table', async () => {
    const r = await runSketch(helperSketch(HELPER_VALUES.map(([expr]) => `Serial.println(${expr});`), HELPER_GLOBALS), { stopAfterMs: 500 });
    expect(r.console.filter((m) => m.level === 'error')).toEqual([]);
    const lines = r.serial.split('\r\n').slice(0, -1);
    expect(lines.map((l, i) => [HELPER_VALUES[i][0], l])).toEqual(HELPER_VALUES.map(([expr, value]) => [expr, value]));
  });

  it('and the board’s values where the board differs from CPython on purpose (§2.13)', async () => {
    const r = await runSketch(helperSketch(HELPER_BOARD_VALUES.map(([expr]) => `Serial.println(${expr});`)), { stopAfterMs: 500 });
    expect(r.serial.split('\r\n').slice(0, -1)).toEqual(HELPER_BOARD_VALUES.map(([, board]) => board));
  });

  it('append, pop and the count: [3, 1, 2] → append(9) → pop(0) → pop() → pop(-1)', async () => {
    const r = await runSketch(
      helperSketch([
        'numsCount = pyAppendL(nums, numsCount, 5, 9, 1);',
        'Serial.println(pyListTextL(nums, numsCount));',
        'Serial.println(pyPopL(nums, numsCount, 0, 1));',
        'numsCount--;',
        'Serial.println(pyPopL(nums, numsCount, -1, 1));',
        'numsCount--;',
        'Serial.println(pyPopL(nums, numsCount, -1, 1));',
        'numsCount--;',
        'Serial.println(pyListTextL(nums, numsCount));',
      ], HELPER_GLOBALS),
      { stopAfterMs: 200 },
    );
    expect(r.serial).toBe('[3, 1, 2, 9]\r\n3\r\n9\r\n2\r\n[1]\r\n');
  });

  it("input() waits for a line, shows it like a terminal and gives it without the line ending (§2.6)", async () => {
    const r = await runSketch(helperSketch(['String a = pyInput("Name? ");', 'Serial.println("[" + a + "]");']), {
      stopAfterMs: 300,
      before: (board) => board.serial.inject('Ann\r\n'),
    });
    expect(r.serial).toBe('Name? Ann\r\n[Ann]\r\n');
  });

  it('the ultrasonic distance matches the Arduino twins (49.7 cm at 50 cm), 0 without an echo', async () => {
    const r = await runSketch(helperSketch(['pinMode(3, OUTPUT);', 'pinMode(2, INPUT);', 'Serial.println(pyDistanceCm(3, 2, 0), 1);']), { stopAfterMs: 300, before: (b) => b.ultrasonic.setDistance(50) });
    expect(r.serial).toBe('49.7\r\n');
    const none = await runSketch(helperSketch(['pinMode(3, OUTPUT);', 'pinMode(2, INPUT);', 'Serial.println(pyDistanceCm(3, 2, 0), 1);']), { stopAfterMs: 300, before: (b) => b.ultrasonic.setConnected(false) });
    expect(none.serial).toBe('0.0\r\n');
  });
});

describe('the helpers that stop the program (§5.6)', () => {
  it.each(HELPER_STOPS)('%s: "Line N: …" on the Serial Monitor, then abort(); the console shows it on the Python line', async (name, call, text) => {
    const r = await runSketch(helperSketch([call], HELPER_GLOBALS), { stopAfterMs: 1000, before: (b) => b.ultrasonic.setConnected(false) });
    const line = name === 'pyFail' ? 3 : 12;
    expect(r.status).toBe('error');
    expect(r.serial.split('\r\n').filter(Boolean).at(-1)).toBe(`Line ${line}: ${text}`);
    const errors = r.console.filter((m) => m.level === 'error');
    expect(errors.map((m) => m.text)).toEqual([ABORT_MESSAGE]);
    expect(pythonizeRuntimeMessage(errors[0], r.serial)).toEqual({ level: 'error', text, line, source: 'python' });
  });
});
