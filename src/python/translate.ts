/**
 * `pythonToArduino` (docs/PYTHON.md §4.1): a Python program → an Arduino sketch, its source map
 * and the diagnostics. Never throws (X-internal).
 *
 * The front end is real: normalize → tokenize → parse, so a syntax or indentation error (§5.1)
 * comes back as its diagnostic, with the T9 placeholder (§4.10), and a program over 50,000 bytes
 * is X-too-long (§4.11). The rest is still the Day-1 stub (§11.2) until the analysis and the
 * emitter land (resolve → flow → infer → check → emit): it recognises the Blink program of
 * example 01 / golden T1 (with any module docstring, or none) and returns the T1 sketch; every
 * other program that parses gets the placeholder with one X-internal error.
 */
import { pythonPlaceholder } from '../sketch/placeholder';
import type { PythonDiagnostic, PythonTranslation } from './index';
import { message } from './messages';
import { parse } from './parser';
import { SourceMap } from './sourcemap';
import { PythonSyntaxError, normalize, tokenize } from './tokens';

/** The largest program the translator reads (§4.11), in UTF-8 bytes. */
export const MAX_PYTHON_BYTES = 50_000;

/** The statements of T1 after its module docstring, line by line. */
const T1_CODE = [
  'from machine import Pin',
  'from zero1 import LED_RED',
  'import time',
  '',
  'BLINK_TIME = 0.5              # how long the LED stays on (and off), in seconds',
  '',
  'led = Pin(LED_RED, Pin.OUT)   # the red LED is an output',
  '',
  'while True:',
  '    led.on()                  # 5 V on the pin: the LED lights up',
  '    print("ON")',
  '    time.sleep(BLINK_TIME)    # wait; the board does nothing else meanwhile',
  '',
  '    led.off()                 # 0 V on the pin: the LED goes off',
  '    print("OFF")',
  '    time.sleep(BLINK_TIME)',
].join('\n');

/** A module docstring on lines of its own: `"""` newline … newline `"""` (no escapes, no quotes inside). */
const DOCSTRING = /^"""\n((?:[^\n]*\n)*?)"""\n/;

/** One line of the generated sketch and the Python line it was made from (0 = scaffolding). */
type SketchLine = readonly [text: string, pythonLine: number];

export function pythonToArduino(source: string): PythonTranslation {
  try {
    const text = normalize(source);
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_PYTHON_BYTES) {
      return failed({ code: 'X-too-long', line: 1, column: 1, severity: 'error', message: message('X-too-long', { bytes: String(bytes).replace(/\B(?=(\d{3})+$)/g, ',') }) });
    }
    try {
      parse(tokenize(text));
    } catch (err) {
      if (err instanceof PythonSyntaxError) return failed(syntaxDiagnostic(err));
      throw err;
    }
    return translateStub(text);
  } catch (err) {
    return notTranslated(err instanceof Error ? err.message : String(err));
  }
}

/** A syntax or indentation error (§5.1) as the diagnostic of the Python editor. */
export function syntaxDiagnostic(err: PythonSyntaxError): PythonDiagnostic {
  return {
    code: err.code,
    line: err.line,
    column: err.column,
    endLine: err.endLine,
    endColumn: err.endColumn,
    severity: 'error',
    message: err.message,
  };
}

/** `text` is normalised (§2.2 source normalisation: CRLF and lone CR → LF, a leading BOM dropped). */
function translateStub(text: string): PythonTranslation {
  const doc = DOCSTRING.exec(text);
  const docstring = doc && !/\\|"""/.test(doc[1]) ? doc[1] : null;
  const code = doc && docstring !== null ? text.slice(doc[0].length) : text;
  if (code.replace(/\s+$/, '') !== T1_CODE) {
    return notTranslated('only the example "Blink the red LED" can be turned into a sketch until Python mode is finished');
  }
  return blinkSketch(docstring, docstring === null ? 0 : docstring.split('\n').length + 1);
}

/** T1 (§4.10): `docstring` is the text between the quotes, `offset` the Python lines before the code. */
function blinkSketch(docstring: string | null, offset: number): PythonTranslation {
  const at = (codeLine: number) => offset + codeLine; // Python line of T1_CODE's line `codeLine` (1-based)
  // §4.7 C3: the module docstring becomes the /* … */ header, with every */ written * /.
  const docLines = docstring === null || docstring === '' ? [] : docstring.replace(/\n$/, '').split('\n');
  const header: SketchLine[] =
    docstring === null ? [] : [['/*', 0], ...docLines.map((line): SketchLine => [line.replace(/\*\//g, '* /'), 0]), ['*/', 0]];
  const lines: SketchLine[] = [
    ['// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.', 0],
    ...header,
    ['', 0],
    ['const int LED_RED = A1;        // red LED', 0],
    ['', 0],
    ['const float BLINK_TIME = 0.5;  // how long the LED stays on (and off), in seconds', at(5)],
    ['const int led = LED_RED;', at(7)],
    ['', 0],
    ['// Runs once: the lines before "while True:"', 0],
    ['void setup() {', 0],
    ['  Serial.begin(9600);', 0],
    ['  pinMode(led, OUTPUT);        // the red LED is an output', at(7)],
    ['}', 0],
    ['', 0],
    [`// Runs forever: the body of "while True:" (line ${at(9)})`, 0],
    ['void loop() {', 0],
    ['  digitalWrite(led, HIGH);     // 5 V on the pin: the LED lights up', at(10)],
    ['  Serial.println("ON");', at(11)],
    ['  delay(round(BLINK_TIME * 1000));  // wait; the board does nothing else meanwhile', at(12)],
    ['', 0],
    ['  digitalWrite(led, LOW);      // 0 V on the pin: the LED goes off', at(14)],
    ['  Serial.println("OFF");', at(15)],
    ['  delay(round(BLINK_TIME * 1000));', at(16)],
    ['}', 0],
  ];
  return {
    ok: true,
    sketch: lines.map(([line]) => line).join('\n') + '\n',
    map: new SourceMap(lines.map(([, pythonLine]) => pythonLine)),
    diagnostics: [],
    endsAfterSetup: false,
    usesInput: false,
  };
}

/** The T9 placeholder with one X-internal error on line 1. */
function notTranslated(reason: string): PythonTranslation {
  return failed({ code: 'X-internal', line: 1, column: 1, severity: 'error', message: message('X-internal', { error: reason }) });
}

/** The T9 placeholder for one error. */
function failed(diagnostic: PythonDiagnostic): PythonTranslation {
  const sketch = pythonPlaceholder(1);
  return {
    ok: false,
    sketch,
    map: new SourceMap(sketch.replace(/\n$/, '').split('\n').map(() => 0)),
    diagnostics: [diagnostic],
    endsAfterSetup: false,
    usesInput: false,
  };
}
