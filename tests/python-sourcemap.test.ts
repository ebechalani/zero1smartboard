/**
 * The source map of Python mode (docs/PYTHON.md §4.9): every sketch line records the first line
 * of the Python statement it was made from (0 for scaffolding and helpers); composed with
 * transpile()'s line map it gives the Python line of a JS line; a runtime stop reaches the
 * console on its Python line even when the browser records no stack frames (§5.6, §6 item 3);
 * an error in a generated sketch is X-sketch-error on the Python line it was made from.
 */
import { describe, expect, it } from 'vitest';
import { pythonToArduino } from '../src/python';
import { message, pythonizeRuntimeMessage } from '../src/python/messages';
import { Executor } from '../src/runtime/executor';
import { ABORT_MESSAGE } from '../src/runtime/values';
import { transpile } from '../src/transpiler';
import type { ConsoleMessage } from '../src/types';
import { makeBoard } from './helpers';

const PROGRAM = `"""The source map of every kind of statement."""
from machine import Pin, ADC
from zero1 import LED_RED, POT_LDR, Servo
import time

LIMIT = 500
servo = Servo()
led = Pin(LED_RED,
          Pin.OUT)
adc = ADC(POT_LDR)
readings = []
start = time.ticks_ms()


def level(value, scale=2):
    if value > LIMIT:
        return value // scale
    return 0


while True:
    value = adc.read()
    readings.append(value)
    if len(readings) > 5:
        readings.pop(0)
    elif value < 10:
        print("dark")
    else:
        led.on()
    for i in range(len(readings)):
        print(i,
              readings[i])
    total = 0
    n = 0
    while n < 3:
        n += 1
    try:
        x = int("12")
    except ValueError:
        x = 0
    servo.angle(level(value) % 180)
    print(total, x, time.ticks_diff(time.ticks_ms(), start))
    time.sleep(1)
`;

const result = pythonToArduino(PROGRAM);
const sketchLines = result.sketch.split('\n');
/** The Python line of the (first) sketch line that is `text`, trimmed. */
const at = (text: string) => {
  const i = sketchLines.findIndex((l) => l.trim() === text);
  if (i < 0) throw new Error(`not in the sketch: ${text}`);
  return result.map.pythonLineOf(i + 1);
};

describe('sketchToPython (§4.9)', () => {
  it('the program translates', () => {
    expect(result.ok).toBe(true);
    expect(result.map.sketchToPython).toHaveLength(sketchLines.length - 1);
  });

  it('scaffolding and helper bodies are 0', () => {
    for (const text of [
      '// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.',
      '#include <Servo.h>',
      'const int LED_RED = A1;        // red LED',
      '// Runs once: the lines before "while True:"',
      'void setup() {',
      'Serial.begin(9600);',
      'void loop() {',
      '// ---- Helpers that make C++ behave like Python ----',
      'long pyIndex(long index, long size, int line) {',
      'if (index < 0) index += size;',
    ])
      expect(at(text), text).toBe(0);
    const helpers = sketchLines.indexOf('// ---- Helpers that make C++ behave like Python ----');
    expect(result.map.sketchToPython.slice(helpers).every((py) => py === 0)).toBe(true);
    expect(sketchLines.filter((l, i) => l === '}' && result.map.sketchToPython[i] !== 0)).toEqual([]);
  });

  it('declarations: constants, globals and library objects map to the statement that made them', () => {
    expect(at('const long LIMIT = 500;')).toBe(6);
    expect(at('Servo servo;')).toBe(7);
    expect(at('const int led = LED_RED;')).toBe(8);
    expect(at("long readings[20];             // the list 'readings' has room for 20 items")).toBe(11);
    expect(at('long readingsCount = 0;')).toBe(11);
    expect(at('long start = 0;')).toBe(12);
    expect(at('long total = 0;')).toBe(33);
    expect(at('long x = 0;')).toBe(38); // declared at the top of loop(): its first definition
  });

  it('setup lines map to the construction; a statement over several lines maps to its first line', () => {
    expect(at('servo.attach(SERVO_PIN);')).toBe(7);
    expect(at('pinMode(led, OUTPUT);')).toBe(8);
    expect(at('start = (long)millis();')).toBe(12);
    expect(at('Serial.print(i);')).toBe(31);
    expect(at('Serial.println(readings[pyIndex(i, readingsCount, 32)]);')).toBe(31);
  });

  it('functions, compound statements and their headers', () => {
    expect(at('long level(long value, long scale) {')).toBe(15);
    expect(at('if (value > LIMIT) {')).toBe(16);
    expect(at('return pyFloorDiv(value, pyNonZero(scale, 17));')).toBe(17);
    expect(at('return 0;')).toBe(18);
    expect(at('long value = analogRead(adc);')).toBe(22);
    expect(at('readingsCount = pyAppendL(readings, readingsCount, 20, value, 23);')).toBe(23);
    expect(at('if (readingsCount > 5) {')).toBe(24);
    expect(at('pyPopL(readings, readingsCount, 0, 25);')).toBe(25);
    expect(at('readingsCount--;')).toBe(25);
    expect(at('} else if (value < 10) {')).toBe(26);
    expect(at('} else {')).toBe(0); // `else:` has no line of its own
    expect(at('const long iStop = readingsCount;')).toBe(30);
    expect(at('for (long i = 0; i < iStop; i++) {')).toBe(30);
    expect(at('while (n < 3) {')).toBe(35);
    expect(at('n += 1;')).toBe(36);
    expect(at('if (pyIsInt("12")) {')).toBe(38);
    expect(at('x = pyInt("12", 0);')).toBe(38);
    expect(at('x = 0;')).toBe(40);
    expect(at('servo.write(pyMod(level(value, 2), 180L));')).toBe(41);
    expect(at('delay(1000);')).toBe(43);
    const printed = sketchLines.indexOf('    Serial.print(i);') + 1;
    expect(result.map.sketchLinesOf(31)).toEqual([printed, printed + 1, printed + 2]);
    expect(result.map.sketchLinesOf(21)).toEqual([]); // `while True:` itself
  });

  it('composes with transpile()’s line map: JS line → Python line', () => {
    const js = transpile(result.sketch);
    if (!js.ok) throw new Error('transpile failed');
    const composed = result.map.composeJsLineMap(js.lineMap);
    expect(composed).toHaveLength(js.lineMap.length);
    const jsLines = js.js.split('\n');
    const pythonLineOfJs = (fragment: string) => composed[jsLines.findIndex((l) => l.includes(fragment))];
    expect(pythonLineOfJs('analogRead')).toBe(22);
    expect(pythonLineOfJs('pyAppendL(readings')).toBe(23);
    expect(pythonLineOfJs('.attach(')).toBe(7);
    js.lineMap.forEach((sketchLine, i) => expect(composed[i]).toBe(sketchLine ? result.map.sketchToPython[sketchLine - 1] : 0));
  });
});

/** Runs a translated program in the simulator with the composed line map (as Python mode does). */
async function runPython(source: string, ms = 500): Promise<{ console: ConsoleMessage[]; serial: string }> {
  const t = pythonToArduino(source);
  if (!t.ok) throw new Error(t.diagnostics.map((d) => d.message).join('; '));
  const js = transpile(t.sketch);
  if (!js.ok) throw new Error('transpile failed');
  const { board } = makeBoard();
  let serial = '';
  board.serial.onTx((text) => (serial += text));
  const messages: ConsoleMessage[] = [];
  const executor = new Executor({ board, onConsole: (m) => messages.push(m), stopAfterMs: ms, maxLoops: 100000, lineMap: t.map.composeJsLineMap(js.lineMap) });
  await executor.run(js.js);
  return { console: messages, serial };
}

describe('a runtime stop reaches the console on its Python line (§5.6, §5.9)', () => {
  const ZERO = 'print("start")\ny = 0\nx = 5 // y\nprint(x)\n';

  it('x = 5 // y with y = 0: ZeroDivisionError on line 3', async () => {
    const r = await runPython(ZERO);
    expect(r.serial).toBe('start\r\nLine 3: ZeroDivisionError: division by zero\r\n');
    const errors = r.console.filter((m) => m.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].text).toBe(ABORT_MESSAGE);
    expect(pythonizeRuntimeMessage(errors[0], r.serial)).toEqual({ level: 'error', text: 'ZeroDivisionError: division by zero', line: 3, source: 'python' });
  });

  it('also when the stack has no frames (no line from the stack at all)', async () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    try {
      const r = await runPython(ZERO);
      const error = r.console.find((m) => m.level === 'error')!;
      expect(error.line).toBeUndefined();
      expect(pythonizeRuntimeMessage(error, r.serial)).toEqual({ level: 'error', text: 'ZeroDivisionError: division by zero', line: 3, source: 'python' });
    } finally {
      Error.stackTraceLimit = limit;
    }
  });

  it('a stop inside a function, in the main loop: the line of the Python statement that failed', async () => {
    const r = await runPython('items = [1, 2, 3]\n\ndef third(i):\n    return items[i + 2]\n\nk = 0\nwhile True:\n    print(third(k))\n    k += 1\n');
    expect(r.serial).toBe('3\r\nLine 4: IndexError: list index out of range\r\n');
    expect(pythonizeRuntimeMessage(r.console.find((m) => m.level === 'error')!, r.serial)).toMatchObject({ text: 'IndexError: list index out of range', line: 4 });
  });
});

describe('an error in the generated sketch (X-sketch-error, §4.9 use 2)', () => {
  it('is reported on the Python line the bad sketch line was made from', () => {
    // A stubbed bad sketch: the line made from Python line 22 no longer compiles.
    const bad = result.sketch.replace('long value = analogRead(adc);', 'long value = analogRead(adc) +;');
    const js = transpile(bad);
    expect(js.ok).toBe(false);
    if (js.ok) return;
    const error = js.errors[0];
    const line = result.map.pythonLineOf(error.line);
    expect(line).toBe(22);
    expect(message('X-sketch-error', { message: error.message })).toBe(`Python translation error (a bug in the simulator, please tell your teacher): ${error.message}`);
  });
});
