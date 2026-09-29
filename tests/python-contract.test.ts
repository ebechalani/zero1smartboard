/**
 * The Day-1 contract of Python mode (docs/PYTHON.md §4.2, §11.2): the public surface of
 * src/python, example 01 and its T1 sketch, the T9 placeholder (src/sketch/placeholder.ts), the
 * source map and the message helpers. The "stub" block describes the stub translator and goes
 * when stream A's real pipeline lands; everything else stays true.
 */
import { describe, expect, it } from 'vitest';
import { BLANK_PYTHON, PYTHON_EXAMPLES, SourceMap, pythonToArduino, pythonizeRuntimeMessage } from '../src/python';
import { MESSAGES, PY_FAIL_LINE, message, type MessageCode } from '../src/python/messages';
import { PYTHON_PLACEHOLDER_PREFIX, placeholderErrorCount, pythonPlaceholder } from '../src/sketch/placeholder';
import { EXAMPLES } from '../src/examples';
import { transpile } from '../src/transpiler';

/** T1 of §4.10, input and output verbatim (docstring shortened to lines 1–4). */
const T1_PYTHON = `"""
ZERO1 Smart Board - 01 Blink the red LED
...
"""
from machine import Pin
from zero1 import LED_RED
import time

BLINK_TIME = 0.5              # how long the LED stays on (and off), in seconds

led = Pin(LED_RED, Pin.OUT)   # the red LED is an output

while True:
    led.on()                  # 5 V on the pin: the LED lights up
    print("ON")
    time.sleep(BLINK_TIME)    # wait; the board does nothing else meanwhile

    led.off()                 # 0 V on the pin: the LED goes off
    print("OFF")
    time.sleep(BLINK_TIME)
`;

const T1_SKETCH = `// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
ZERO1 Smart Board - 01 Blink the red LED
...
*/

const int LED_RED = A1;        // red LED

const float BLINK_TIME = 0.5;  // how long the LED stays on (and off), in seconds
const int led = LED_RED;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(led, OUTPUT);        // the red LED is an output
}

// Runs forever: the body of "while True:" (line 13)
void loop() {
  digitalWrite(led, HIGH);     // 5 V on the pin: the LED lights up
  Serial.println("ON");
  delay(round(BLINK_TIME * 1000));  // wait; the board does nothing else meanwhile

  digitalWrite(led, LOW);      // 0 V on the pin: the LED goes off
  Serial.println("OFF");
  delay(round(BLINK_TIME * 1000));
}
`;

/** T9 of §4.10, verbatim. */
const T9_SKETCH = `// Your Python program has 2 errors, so there is no Arduino sketch yet.
// Fix them in the Python tab (see the console), then this tab shows the sketch.
`;

const sketchLineOf = (sketch: string, text: string) => sketch.split('\n').indexOf(text) + 1;

describe('Python examples', () => {
  it('example 01 is the twin of the .ino example (id, title, group) and keeps the lesson order', () => {
    expect(PYTHON_EXAMPLES[0]).toMatchObject({ id: '01_blink_red', title: 'Blink the red LED', group: 'Outputs' });
    let last = -1;
    for (const example of PYTHON_EXAMPLES) {
      const index = EXAMPLES.findIndex((e) => e.id === example.id);
      expect(index, example.id).toBeGreaterThan(last);
      expect(EXAMPLES[index]).toMatchObject({ title: example.title, group: example.group });
      expect(example.description).not.toBe('');
      expect('source' in example).toBe(false);
      last = index;
    }
  });
  it('each starts with a docstring header with the four sections of the .ino headers', () => {
    for (const example of PYTHON_EXAMPLES) {
      const header = /^"""\n([\s\S]*?)\n"""\n/.exec(example.python)?.[1] ?? '';
      expect(header.split('\n')[0]).toBe(`ZERO1 Smart Board - ${example.id.slice(0, 2)} ${example.title}`);
      for (const section of ['WHAT IT TEACHES', 'PARTS AND PINS', 'EXPECTED BEHAVIOUR', 'TRY THIS']) expect(header, section).toMatch(new RegExp(`^${section}$`, 'm'));
    }
  });
  it('BLANK_PYTHON is the New template of §7.7', () => {
    expect(BLANK_PYTHON).toBe(
      'from machine import Pin\nfrom zero1 import *   # ZERO1 names: LED_RED, BUTTON_1, BUZZER, …\nimport time\n\n# Code here runs once, when the board starts.\n\n\nwhile True:\n    # Code here runs again and again, forever.\n    pass\n',
    );
  });
});

describe('pythonToArduino: T1 (example 01)', () => {
  it('translates the T1 golden to its sketch, byte for byte', () => {
    const result = pythonToArduino(T1_PYTHON);
    expect(result).toMatchObject({ ok: true, diagnostics: [], endsAfterSetup: false, usesInput: false });
    expect(result.sketch).toBe(T1_SKETCH);
  });
  it('translates example 01 with its whole docstring as the header and its own line numbers', () => {
    const python = PYTHON_EXAMPLES[0].python;
    const result = pythonToArduino(python);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    const docstring = /^"""\n([\s\S]*?)\n"""\n/.exec(python)![1];
    const whileLine = python.split('\n').indexOf('while True:') + 1;
    expect(result.sketch.startsWith(`// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.\n/*\n${docstring}\n*/\n\n`)).toBe(true);
    expect(result.sketch.slice(result.sketch.indexOf('\n*/\n') + 4)).toBe(T1_SKETCH.slice(T1_SKETCH.indexOf('\n*/\n') + 4).replace('(line 13)', `(line ${whileLine})`));
  });
  it('reads CRLF and a byte-order mark like LF text', () => {
    const python = PYTHON_EXAMPLES[0].python;
    expect(pythonToArduino(`\uFEFF${python.replace(/\n/g, '\r\n')}`)).toEqual(pythonToArduino(python));
  });
  it('the sketch transpiles without errors or warnings', () => {
    for (const source of [T1_PYTHON, PYTHON_EXAMPLES[0].python]) {
      const result = transpile(pythonToArduino(source).sketch);
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([]);
    }
  });
  it('maps every statement line to its Python line and scaffolding to 0', () => {
    const { sketch, map } = pythonToArduino(T1_PYTHON);
    expect(map.sketchToPython).toHaveLength(sketch.split('\n').length - 1);
    const at = (text: string) => map.pythonLineOf(sketchLineOf(sketch, text));
    expect(at('const int LED_RED = A1;        // red LED')).toBe(0);
    expect(at('const float BLINK_TIME = 0.5;  // how long the LED stays on (and off), in seconds')).toBe(9);
    expect(at('const int led = LED_RED;')).toBe(11);
    expect(at('  Serial.begin(9600);')).toBe(0);
    expect(at('void loop() {')).toBe(0);
    expect(at('  digitalWrite(led, HIGH);     // 5 V on the pin: the LED lights up')).toBe(14);
    expect(at('  Serial.println("OFF");')).toBe(19);
    expect(at('  delay(round(BLINK_TIME * 1000));')).toBe(20);
    expect(map.sketchLinesOf(11)).toEqual([sketchLineOf(sketch, 'const int led = LED_RED;'), sketchLineOf(sketch, '  pinMode(led, OUTPUT);        // the red LED is an output')]);
    expect(map.sketchLinesOf(13)).toEqual([]); // `while True:` itself makes no line
  });
});

describe('pythonToArduino: Day-1 stub (until the real pipeline lands)', () => {
  it('gives every other program that parses the placeholder with one X-internal error on line 1 (syntax errors: tests/python-parser.test.ts)', () => {
    for (const source of [BLANK_PYTHON, '', 'print("Hi")\n', T1_PYTHON.replace('0.5', '0.25'), `"""\n\\N{DEGREE SIGN}\n"""\n${T1_PYTHON.slice(T1_PYTHON.indexOf('from'))}`]) {
      const result = pythonToArduino(source);
      expect(result.ok, source).toBe(false);
      expect(result.sketch).toBe(pythonPlaceholder(1));
      expect(placeholderErrorCount(result.sketch)).toBe(1);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({ code: 'X-internal', severity: 'error', line: 1, column: 1 });
      expect(result.diagnostics[0].message).toMatch(/^The simulator could not read this program: .+\. Please tell your teacher\.$/);
      expect(result.map.sketchToPython).toEqual([0, 0]);
      expect(result).toMatchObject({ endsAfterSetup: false, usesInput: false });
    }
  });
  it('accepts T1 without a docstring (line numbers start at the imports)', () => {
    const result = pythonToArduino(T1_PYTHON.slice(T1_PYTHON.indexOf('from')));
    expect(result.ok).toBe(true);
    expect(result.sketch).toContain('// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.\n\nconst int LED_RED = A1;');
    expect(result.sketch).toContain('(line 9)');
  });
});

describe('the placeholder sketch (T9)', () => {
  it('is the text of §4.10 and counts its errors back', () => {
    expect(pythonPlaceholder(2)).toBe(T9_SKETCH);
    expect(pythonPlaceholder(2).startsWith(PYTHON_PLACEHOLDER_PREFIX)).toBe(true);
    expect(pythonPlaceholder(1)).toBe('// Your Python program has 1 error, so there is no Arduino sketch yet.\n// Fix it in the Python tab (see the console), then this tab shows the sketch.\n');
    for (const n of [1, 2, 20, 21]) expect(placeholderErrorCount(pythonPlaceholder(n))).toBe(n);
    expect(placeholderErrorCount(T9_SKETCH.replace(/\n/g, '\r\n'))).toBe(2);
  });
  it('is null for a real sketch', () => {
    expect(placeholderErrorCount(T1_SKETCH)).toBeNull();
    expect(placeholderErrorCount('')).toBeNull();
    expect(placeholderErrorCount('void setup() {}\n// Your Python program has 2 errors, so there is no Arduino sketch yet.\n')).toBeNull();
    expect(placeholderErrorCount('// Your Python program has many errors, so there is no Arduino sketch yet.\n')).toBeNull();
    expect(placeholderErrorCount('// Your Python program has 2 errors, so there is no Arduino sketch yet. Or is there\n')).toBeNull();
  });
});

describe('SourceMap', () => {
  const map = new SourceMap([0, 3, 3, 0, 5]);
  it('looks lines up both ways (0 when unknown)', () => {
    expect(map.pythonLineOf(2)).toBe(3);
    expect(map.pythonLineOf(1)).toBe(0);
    expect(map.pythonLineOf(0)).toBe(0);
    expect(map.pythonLineOf(99)).toBe(0);
    expect(map.sketchLinesOf(3)).toEqual([2, 3]);
    expect(map.sketchLinesOf(5)).toEqual([5]);
    expect(map.sketchLinesOf(4)).toEqual([]);
    expect(map.sketchLinesOf(0)).toEqual([]);
  });
  it('composes the transpiler line map (JS line → sketch line) into JS line → Python line', () => {
    expect(map.composeJsLineMap([0, 1, 2, 3, 5, 6, 0])).toEqual([0, 0, 3, 3, 5, 0, 0]);
  });
  it('keeps its own copy of the lines', () => {
    const lines = [1, 2];
    const copy = new SourceMap(lines);
    lines[0] = 9;
    expect(copy.pythonLineOf(1)).toBe(1);
  });
});

describe('messages', () => {
  it('fills the {name} parameters and leaves other braces alone', () => {
    expect(message('X-internal', { error: 'boom' })).toBe('The simulator could not read this program: boom. Please tell your teacher.');
    expect(message('X-too-many', { count: 7 })).toBe('… and 7 more errors');
    expect(message('X-sketch-error')).toBe('Python translation error (a bug in the simulator, please tell your teacher): {message}');
  });
  it('falls back to the code while a text is missing, and keeps every text short', () => {
    const codes: MessageCode[] = ['S-syntax', 'E-name', 'NA-class', 'R-index', 'W-shadow', 'X-internal'];
    for (const code of codes.filter((c) => MESSAGES[c] === undefined)) expect(message(code)).toBe(code);
    for (const [code, text] of Object.entries(MESSAGES)) expect(text!.length, code).toBeLessThanOrEqual(240);
  });
  it('PY_FAIL_LINE reads a pyFail() line; pythonizeRuntimeMessage leaves messages alone for now', () => {
    expect(PY_FAIL_LINE.exec('Line 12: IndexError: list index out of range')?.slice(1)).toEqual(['12', 'IndexError: list index out of range']);
    expect(PY_FAIL_LINE.test('IndexError: list index out of range')).toBe(false);
    const msg = { level: 'error' as const, text: 'The sketch stopped: abort() was called.', line: 3 };
    expect(pythonizeRuntimeMessage(msg, 'Line 12: IndexError: list index out of range\r\n')).toEqual(msg);
  });
});
