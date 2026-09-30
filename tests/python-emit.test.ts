/**
 * The emitter's goldens (docs/PYTHON.md §4.7, §4.10, §10.2): every
 * tests/fixtures/python/<case>.py translates to <case>.ino byte for byte (UPDATE_GOLDEN=1
 * regenerates them; review the diff). T1–T9 are the spec's own text; the other cases cover one
 * rule each. Every golden sketch transpiles without errors and without warnings (§4.7 E3) and,
 * where the WebAssembly toolchain is built, compiles with avr-g++ -Wall -Wextra without warnings
 * and fits the UNO (§10.6).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BLANK_PYTHON, pythonToArduino } from '../src/python';
import { cString, floatLiteral } from '../src/python/emit';
import { helperTexts } from '../src/python/helpers';
import { transpile } from '../src/transpiler';
import { buildSketch, loadBundle } from '../src/upload/toolchain/arduino-build';
import { WasmToolchain } from '../src/upload/toolchain/wasm-toolchain';
import { pythonPlaceholder } from '../src/sketch/placeholder';
import { toolchainPaths } from './fakes/upload/toolchain-paths';

const FIXTURES = new URL('./fixtures/python/', import.meta.url);
const CASES = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.py'))
  .map((f) => f.slice(0, -3))
  .sort();

const python = (name: string) => readFileSync(new URL(`${name}.py`, FIXTURES), 'utf8');
const goldenFile = (name: string) => new URL(`${name}.ino`, FIXTURES);

if (process.env.UPDATE_GOLDEN) {
  for (const name of CASES) writeFileSync(goldenFile(name), pythonToArduino(python(name)).sketch);
}
const golden = (name: string) => readFileSync(goldenFile(name), 'utf8');

/** The diagnostics each case expects (code@line); every other case has none. */
const EXPECTED: Record<string, string[]> = {
  decl_parts: ['W-pwm-freq@11'],
  functions: ['W-recursion@3', 'W-missing-return@8'],
  loops_range: ['W-maybe-unassigned@10', 'W-loop-var-changed@13'],
  operators: ['W-bool-int@12'],
  lists_growable: ['W-list-capacity@7'],
  main_unreachable: ['W-unreachable@7'],
  names: ['W-shadow@2'],
  numbers_n1: ['W-ticks-diff@16'],
  t4_growable_list: ['W-list-capacity@6'],
  t9_placeholder: ['E-missing-import@3', 'E-missing-import@6'],
  text_methods: ['W-str-num-eq@14'],
};

describe('the goldens (tests/fixtures/python/*.py → *.ino)', () => {
  it('every case has its golden sketch', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(45);
    for (const name of CASES) expect(existsSync(goldenFile(name)), name).toBe(true);
  });

  it.each(CASES)('%s', (name) => {
    const result = pythonToArduino(python(name));
    expect(result.diagnostics.map((d) => `${d.code}@${d.line}`)).toEqual(EXPECTED[name] ?? []);
    expect(result.ok).toBe(!name.startsWith('t9'));
    expect(result.sketch).toBe(golden(name));
    expect(result.map.sketchToPython).toHaveLength(result.sketch.split('\n').length - 1);
    if (!result.ok) return;
    const js = transpile(result.sketch);
    expect(js.ok ? [] : js.errors).toEqual([]);
    expect(js.warnings).toEqual([]);
  });

  it('blank.py is the New template (§7.7) and gives the two comments in empty setup() and loop() (§10.4)', () => {
    expect(python('blank')).toBe(BLANK_PYTHON);
    expect(golden('blank')).toBe(
      '// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.\n\n' +
        '// Runs once: the lines before "while True:"\nvoid setup() {\n  // Code here runs once, when the board starts.\n}\n\n' +
        '// Runs forever: the body of "while True:" (line 8)\nvoid loop() {\n  // Code here runs again and again, forever.\n}\n',
    );
  });

  it('endsAfterSetup only without a main loop; usesInput when input() is called', () => {
    const flagged = (flag: 'endsAfterSetup' | 'usesInput') => CASES.filter((n) => pythonToArduino(python(n))[flag]);
    expect(flagged('endsAfterSetup')).toEqual([
      'api_math_random', 'assign_forms', 'functions', 'lists_fixed', 'loops_range', 'main_break_after', 'main_def_main', 'names',
      'numbers_n2_n5', 'operators', 'print_fstrings', 'raise_assert', 'strings', 't8_ends', 'text_methods', 'unreachable',
    ]);
    expect(flagged('usesInput')).toEqual(['api_zero1', 'ex_serial_echo', 'input_numbers', 'loops_range', 'names', 'operators', 'raise_assert', 't3_webs', 't6_form_v', 'text_methods', 'try_forms']);
  });
});

// ---------------------------------------------------------------------------
// T1–T9 are §4.10's text
// ---------------------------------------------------------------------------

/** The ```python and ```cpp blocks of §4.10's example `T<n>`. */
function specExample(n: number): { python: string | null; cpp: string } {
  const spec = readFileSync(new URL('../docs/PYTHON.md', import.meta.url), 'utf8');
  const start = spec.indexOf(`**T${n} —`);
  const end = n < 9 ? spec.indexOf(`**T${n + 1} —`) : spec.indexOf('### 4.11');
  const section = spec.slice(start, end);
  const block = (lang: string) => {
    const m = new RegExp('```' + lang + '\\n([\\s\\S]*?)```').exec(section);
    return m ? m[1] : null;
  };
  return { python: block('python'), cpp: block('cpp')! };
}

const T_CASES = ['t1_blink', 't2_numbers', 't3_webs', 't4_growable_list', 't5_dht_form_s', 't6_form_v', 't7_functions', 't8_ends', 't9_placeholder'];

describe('T1–T9 are the examples of §4.10, byte for byte', () => {
  it.each(T_CASES.map((name, i) => [i + 1, name] as const))('T%i (%s)', (n, name) => {
    const { python: input, cpp } = specExample(n);
    if (input !== null) expect(python(name)).toBe(input);
    // T2 writes its helpers as "<pyFail, pyNonZero, pyPad verbatim>".
    const expected = cpp.replace(/^<([\w, ]+) verbatim>\n$/m, (_, names: string) => helperTexts(names.split(', ')).join('\n\n') + '\n');
    const sketch = golden(name);
    // T1, T2 and T9 are whole sketches; the others show the part that matters.
    if (n === 1 || n === 2 || n === 9) expect(sketch).toBe(expected);
    else expect(sketch).toContain(expected);
  });
});

// ---------------------------------------------------------------------------
// The rules the goldens show (§10.2), one assertion each
// ---------------------------------------------------------------------------

describe('what the goldens show', () => {
  it('program shape (§2.1): setup(), loop(), continue → return;, while 1:, the main guard, def main(), code that never runs', () => {
    expect(golden('main_continue')).toContain('    return;                    // continue: start the next round of the loop  too dark: try again\n');
    expect(golden('main_continue')).toContain('      continue;\n');
    expect(golden('main_while_1')).toContain('// Runs forever: the body of "while 1:" (line 8)\n');
    expect(golden('main_guard')).toContain('void setup() {\n  pinMode(led, OUTPUT);\n  // Blink three times, then once a second.\n  blink(3);\n}\n');
    expect(golden('main_def_main')).toContain('void main_() {\n  long presses = 0;\n  while (true) {\n');
    expect(golden('main_break_after')).toContain('// Runs once: the whole program\n');
    expect(golden('main_break_after')).toContain('// The Python program has no "while True:": it has ended.\nvoid loop() {\n}\n');
    expect(golden('main_unreachable')).toContain('  while (true) {\n    Serial.println("tick");\n    delay(1000);\n  }\n  // Python line 7 is never reached, so it is left out.\n}\n');
  });

  it('for loops and assignments (§2.4)', () => {
    const l = golden('loops_range');
    expect(l).toContain('  for (long iCounter = 0; iCounter < n; iCounter++) {\n    i = iCounter;\n'); // i is read after the loop
    expect(l).toContain('  const long jStop = n * 2L;\n  for (long jCounter = 0; jCounter < jStop; jCounter += 2) {\n    long j = jCounter;\n'); // j changes in the body
    expect(l).toContain('  for (long k = n; k > 0; k -= 3) {\n');
    expect(l).toContain('  for (long l = 0; l < 2; l++) {\n    for (long m = 0; m < 3; m++) {\n'); // _ gets the first free letters
    expect(l).toContain('  long a = 0;\n  long b = a;\n  { long t1 = b + 1L; long t2 = a + 2L; a = t1; b = t2; }\n');
    expect(l).toContain('  { long t1 = nums[2]; long t2 = nums[0]; nums[0] = t1; nums[2] = t2; }\n');
    const a = golden('assign_forms');
    expect(a).toContain('  long t = 5;\n  lst[0] = t;\n  long x = t;\n  long a = 7;\n  long b = a;\n  long c = a;\n');
    expect(a).toContain('  { long t1 = bump(); long t2 = count; p = t1; q = t2; }\n');
    const u = golden('unreachable');
    expect(u).toContain('    return -1;\n    // Python line 5 is never reached, so it is left out.\n  }\n');
    expect(u).toContain('    break;\n    // Python line 16 is never reached, so it is left out.\n');
  });

  it('functions and parts in lists (§2.4, §2.9)', () => {
    const f = golden('functions');
    expect(f).toContain('long maybe(long x) {\n  if (x > 0) {\n    return x * 2L;\n  }\n  return 0;\n}\n'); // W-missing-return
    expect(f).toContain('void greet(String name, long times, bool loud) {');
    expect(f).toContain('  greet("ann", 1, false);\n  greet("bob", 2, true);\n'); // defaults and keywords at the call
    expect(f).toContain('float average(long values[], long valuesCount) {\n  return (float)pySumL(values, valuesCount) / pyNonZero(valuesCount, 20);\n}');
    expect(f).toContain('pyFloat(average(DATA, 3))');
    const p = golden('pins_lists');
    expect(p).toContain('const int leds[2] = {LED_RED, LED_GREEN};\nconst int buttons[2] = {BUTTON_1, BUTTON_2};\n');
    expect(p).toContain('void blink(int pin, long times) {');
    expect(p).toContain('    pinMode(MOTOR, OUTPUT);\n    digitalWrite(MOTOR, LOW);\n');
    expect(p).toContain('  digitalWrite(leds[0], digitalRead(leds[1]) == LOW);\n');
    expect(golden('lists_empty')).toContain('long EMPTY[1];\nlong names[1];                 // the list \'names\' has room for 0 items\n');
  });

  it('declarations D1–D4', () => {
    expect(golden('decl_globals')).toContain('long total = 0;                // the sum of every reading\nlong start = 0;\n');
    expect(golden('decl_globals')).toContain('  start = (long)millis();      // not a fixed value: assigned in setup()\n');
    expect(golden('decl_globals')).toContain('long best = 0;\n'); // a global made in a function
    expect(golden('decl_locals')).toContain('void loop() {\n  long highest = 0;\n  long value = analogRead(adc);');
    expect(golden('decl_locals')).toContain('String describe(long value) {\n  String word_ = "";\n');
    expect(golden('t7_functions')).toContain('    long n = count_press();\n'); // declared inside the if
    expect(golden('decl_parts')).toContain('Servo servo;\nLiquidCrystal_I2C lcd(0x27, 16, 2);\nAdafruit_NeoPixel np(1, RGB_PIN, NEO_GRB + NEO_KHZ800);\nDHT sensor(DHT_PIN, DHT22);\n');
    expect(golden('decl_parts')).toContain('const int builtin = LED_BUILTIN;\nconst int dimmer = RGB_PIN;\nconst int adc = POT_LDR;\n');
    for (const part of ['i2c', 'buzzer', 'display', 'sonar']) expect(golden('decl_parts')).not.toMatch(new RegExp(`^[^/]*\\b${part}\\b`, 'm')); // parts without a variable
  });

  it('numbers N1–N6', () => {
    const n1 = golden('numbers_n1');
    expect(n1).toContain('long big = 60L * 1000L;\nlong shifted = 1L << 20L;\n');
    expect(n1).toContain('  long percent = (long)analogRead(adc) * 100L / 1023L;\n');
    expect(n1).toContain('  long mixed = (long)LED_RED + 1L + (long)true;\n');
    expect(n1).toContain('  Serial.print((long)millis() - start);\n');
    const n2 = golden('numbers_n2_n5');
    expect(n2).toContain('Serial.print(pyFloat(x / 2.0));');
    expect(n2).toContain('Serial.print(pyFloat((float)x / pyNonZero(y, 6)));');
    expect(n2).toContain('Serial.print(x / 2L);'); // x ≥ 0 and a positive divisor: plain C++
    expect(n2).toContain('Serial.print(pyFloorDiv(y, 2L));');
    expect(n2).toContain('Serial.print(pyFloat(floor(f / 2)));');
    expect(n2).toContain('Serial.println(pyFloat(pyFloatMod(-f, 3)));');
    expect(n2).toContain('Serial.print(pyPow(x, 2, 9));\n  Serial.print(" ");\n  Serial.print(1024);\n  Serial.print(" ");\n  Serial.print(-4);');
    expect(n2).toContain('Serial.println(-pyPow(x, 2, 9));');
    expect(n2).toContain('Serial.print(pyFloat(pow(2, -1)));');
    expect(n2).toContain('  total = pyFloorDiv(total, 3L);\n  total = pyMod(total, 4L);\n  total = pyPow(total, 2, 14);\n');
    expect(n2).toContain("  float ratio_2 = ratio / 4.0;  // 'ratio' again, now a decimal number\n");
    expect(golden('api_math_random')).toContain('  float x = 1 + (2 - 1) * (random(0, 1000000) / 1000000.0);\n');
  });

  it('print() and f-strings (§2.11)', () => {
    const p = golden('print_fstrings');
    expect(p).toContain('  Serial.println();\n  Serial.print("one ");\n  Serial.print(2);\n');
    expect(p).toContain('  Serial.println("a-b!");\n  Serial.print("no newline");\n  Serial.print(" then");\n  Serial.println(n);\n');
    for (const piece of ["pyPad(String(n), 3, '0')", 'pyHex(-1, false)', 'pyBin(n)', "pyPad(name, 5, '<')", '(float)512, 2', 'x, 6', "pyPad(String(n), 6, '>')", 'name.substring(0, 1)', "pyPad(String(x, 3), 8, '0')", 'pyHex(255, true)', '(long)ok'])
      expect(p).toContain(`Serial.print${piece === '(long)ok' ? 'ln' : ''}(${piece});`);
    expect(p).toContain('  String text = String("T = ") + String(x, 1) + " C, n = " + String(n) + ", ok = " + pyBool(ok);\n');
  });

  it('text (§2.7) and strings (S1)', () => {
    const t = golden('text_methods');
    expect(t).toContain('  String command = pyLower(pyStrip(pyInput("Command? ")));\n  String line = "----------------";\n');
    expect(t).toContain('} else if (command == "" || String("M") > command) {');
    expect(t).toContain('Serial.print(pyCharAt(command, -1, 8));');
    expect(t).toContain('Serial.println(pyBool(false));'); // text == number (W-str-num-eq)
    const s = golden('strings');
    expect(s).toContain('Serial.println("ABC tab\\there quote \\" and \\\\ backslash What?" "? Lumière allumée");');
    expect(s).toContain('Serial.println("\\x01" "A a\\x7F" "b");   // an escape before a hex digit: the literal is split');
    expect(s).toContain('lcd.print("Temp: 23\\xDF" "C");');
  });

  it('lists (§2.10)', () => {
    const f = golden('lists_fixed');
    expect(f).toContain('const long NOTES[3] = {262, 294, 330};\n');
    expect(f).toContain('float average(float values[], long valuesCount) {');
    expect(f).toContain('const int leds[2] = {LED_RED, LED_GREEN};');
    expect(f).toContain('Serial.print(NOTES[i]);\n    Serial.print(" ");\n    Serial.print(NOTES[2]);'); // safe index, a[-1] folded
    expect(f).toContain('names[pyIndex(i % 2L, 2, 20)]');
    const g = golden('lists_growable');
    expect(g).toContain("long squares[5];               // the list 'squares' has room for 5 items\n");
    expect(g).toContain("long log_[20];                 // the list 'log' has room for 20 items");
    expect(g).toContain('    long first = pyPopL(log_, log_Count, 0, 12);\n    log_Count--;\n');
    expect(g).toContain('squares[pyIndex(random(0, squaresCount), squaresCount, 17)]');
    expect(golden('ex_melody')).toContain('    tone(BUZZER, MELODY[i]);   // start the note\n    pySleepMs(DURATIONS[i], 27);  // let it sound\n');
  });

  it('try forms S and V (§2.12), raise and assert', () => {
    const t = golden('try_forms');
    expect(t).toContain('  } else {                     // except OSError as e:\n    String e = "[Errno 110] ETIMEDOUT";\n');
    expect(t).toContain('  if (d <= 0) {                // try: d = sonar.distance_cm()  except OSError:\n');
    expect(t).toContain('      String e = String("could not convert string to float: \'") + valueText + "\'";\n');
    expect(golden('api_modules')).toContain('  if (!sensor.read()) pyFail(19, "OSError: [Errno 110] ETIMEDOUT");\n  float d = pyDistanceCm(TRIG_PIN, ECHO_PIN, 20);\n');
    const r = golden('raise_assert');
    expect(r).toContain('  if (!(level >= 0)) pyFail(3, "AssertionError: the level cannot be negative");\n  if (!(level < 100)) pyFail(4, "AssertionError");\n');
    expect(r).toContain('pyFail(6, String("ValueError: no ") + String(level) + ", please");');
    expect(r).toContain('pyFail(8, "RuntimeError");');
  });

  it('names (§2.14) and comments (C1–C4)', () => {
    const n = golden('names');
    for (const decl of ['const long B1_ = 0b1010;', 'long map_ = 5;', 'long square_ = 3;', 'float temperature = 21.5;', 'long x_ = 1;', 'long x = 2;', "long answer_2 = pyInt(answer, 9);   // 'answer' again, now a number", 'for (long round__ = 1; round__ < 3; round__++) {'])
      expect(n).toContain(decl);
    const c = golden('comments');
    expect(c).toContain('/*\nA docstring header with * / inside,\nand a / * too.\n*/\n// The comment of the imports stays with them.\n\n');
    expect(c).toContain('// Flash the red LED.\n//\n// A second paragraph.\nvoid flash(long times) {');
    expect(c).toContain('    // the end of the loop body stays inside its braces \\.\n  }\n  // the end of the function body too\n}\n');
    expect(c).toContain('  flash(2);                    // two flashes\n\n  // after a blank line\n  delay(1000);\n  // the end of the main loop\n}\n');
  });

  it('includes, pin constants and helpers only when used, in their order; Serial.begin only when needed (§3.4)', () => {
    expect(golden('serial_none')).not.toMatch(/^\s*Serial\./m);
    expect(golden('colours')).not.toMatch(/^\s*Serial\./m);
    expect(golden('t7_functions')).toContain('void setup() {\n  Serial.begin(9600);\n'); // pySleepMs can stop the program
    const parts = golden('decl_parts');
    expect(parts.indexOf('#include <Wire.h>\n#include <LiquidCrystal_I2C.h>\n#include <DHT.h>\n#include <Adafruit_NeoPixel.h>\n#include <Servo.h>\n')).toBeGreaterThan(0);
    for (const name of CASES.filter((n) => !n.startsWith('t9'))) {
      const sketch = golden(name);
      const helpers = sketch.includes('// ---- Helpers') ? sketch.slice(sketch.indexOf('// ---- Helpers')) : '';
      for (const m of helpers.matchAll(/^\w[\w ]*? (py\w+|show\w+)\(/gm)) {
        const body = sketch.replace(helpers, '');
        const calledOutside = body.includes(`${m[1]}(`);
        const calledByHelper = helpers.split('\n').filter((l) => l.includes(`${m[1]}(`)).length > 1;
        expect(calledOutside || calledByHelper, `${name}: ${m[1]} is unused`).toBe(true);
      }
    }
  });
});

describe('limits (§4.11)', () => {
  it('a sketch over 50,000 bytes is X-sketch-too-long, with the placeholder', () => {
    const work = (k: number) => `\ndef work${k}(value, scale=2):\n    result = value * scale // 3\n    if result > 100:\n        print(f"work${k}: {result:5d} {value / 3:.2f}")\n    return result\n`;
    const program = `${Array.from({ length: 220 }, (_, k) => work(k)).join('')}\nwhile True:\n${Array.from({ length: 220 }, (_, k) => `    work${k}(${k})\n`).join('')}`;
    expect(new TextEncoder().encode(program).length).toBeLessThan(50_000);
    const result = pythonToArduino(program);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'X-sketch-too-long', severity: 'error', line: 1, column: 1 });
    expect(result.diagnostics[0].message).toMatch(/^The Arduino sketch made from this program is too long to hand in: 50,000 bytes at most \(it has \d\d,\d{3}\)\. Make the program shorter\.$/);
    expect(result.sketch).toBe(pythonPlaceholder(1));
  });
});

describe('C++ text helpers', () => {
  it('cString: escapes, UTF-8 kept, splits after \\xHH before a hex digit, after \\0 before a digit, and ?? (S1)', () => {
    expect(cString('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(cString('é\n\t\r')).toBe('"é\\n\\t\\r"');
    expect(cString('\x01A\x01g')).toBe('"\\x01" "A\\x01g"');
    expect(cString('\x001')).toBe('"\\0" "1"');
    expect(cString('??=')).toBe('"?" "?="');
    expect(cString('23°C', true)).toBe('"23\\xDF" "C"');
    expect(cString('23°')).toBe('"23°"');
  });
  it('floatLiteral: Python repr style (N6)', () => {
    expect([0.5, 3, 1e30, 1.5e-5, 0.1, 1234567.5, -2.5, 1e16, 1e-4].map(floatLiteral)).toEqual(['0.5', '3.0', '1e+30', '1.5e-05', '0.1', '1234567.5', '-2.5', '1e+16', '0.0001']);
  });
});

// ---------------------------------------------------------------------------
// avr-g++ (§4.7 E3, §10.6)
// ---------------------------------------------------------------------------

const paths = toolchainPaths();

describe.skipIf(!paths)('the goldens compile with avr-g++ -Wall -Wextra', () => {
  it('without warnings, and fit the UNO', async () => {
    const fetchBytes = async (u: string) => new Uint8Array(readFileSync(u.startsWith('file:') ? new URL(u) : u));
    const tc = new WasmToolchain({ toolsBase: pathToFileURL(paths!.toolsDir + '/').href, fetchBytes, importGlue: async (url) => (await import(url)).default });
    const bundle = await loadBundle(paths!.bundleDir + '/', fetchBytes);
    const problems: string[] = [];
    for (const name of CASES.filter((n) => !n.startsWith('t9'))) {
      const r = await buildSketch(tc, bundle, { source: golden(name), fileName: `${name}.ino`, warnings: 'all' });
      if (!r.ok) problems.push(`${name}: ${r.stage}: ${r.stderr.join(' ')}`);
      else if (r.warnings.length > 0 || !r.fits) problems.push(`${name}: ${r.warnings.map((w) => `${w.line}: ${w.message}`).join('; ')}${r.fits ? '' : ' (too big)'}`);
    }
    expect(problems).toEqual([]);
  }, 300_000);
});
