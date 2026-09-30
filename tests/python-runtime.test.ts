/**
 * Python programs on the simulator (docs/PYTHON.md §10.3): every row of §2.13 with the board's
 * value; the runtime stops of §5.6 (the run ends with status `error`, the console shows the
 * Python text on the Python line, the Serial Monitor shows `Line N: …` like the real board);
 * input() echoes the typed line; a program without `while True:` finishes, letting a last
 * tone finish (§7.8); duty_u16() on a pin without PWM (W-pwm-pin, §3.2); and the simulator's own
 * runtime texts in Python words (§5.9, RUNTIME_WORDINGS: each entry is triggered by a real
 * Python program and matched against the text the simulator really prints).
 *
 * Programs run as Python mode runs them (src/ui/app.ts): the composed line map and every console
 * message through pythonizeRuntimeMessage() with the last 2 KB of the Serial Monitor.
 */
import { describe, expect, it } from 'vitest';
import { pythonToArduino, pythonizeRuntimeMessage, type PythonTranslation } from '../src/python';
import { RUNTIME_WORDINGS, message } from '../src/python/messages';
import { ORDER_CASES } from './fixtures/python/order-cases';
import { VirtualClock } from '../src/runtime/clock';
import { Executor } from '../src/runtime/executor';
import { transpile } from '../src/transpiler';
import type { ConsoleMessage, ExecutorStatus } from '../src/types';
import { createZero1Board, type Zero1Board } from '../src/zero1';
import { TICK_COST_MS } from './helpers';

interface PythonRun {
  translation: PythonTranslation;
  /** The console as Python mode shows it (pythonized). */
  console: ConsoleMessage[];
  /** The console texts as the simulator printed them. */
  raw: string[];
  serial: string;
  status: ExecutorStatus;
  board: Zero1Board;
  clock: FinishClock;
  loops: number;
  /** For a program without "while True:" (§7.8): when the app finished the run, in board ms; null when it did not. */
  finishedAt: number | null;
  /** When setup() returned (the first loop() call ended), in board ms. */
  setupEndedAt: number | null;
}

interface RunPythonOptions {
  /** The sketch may have transpile() warnings (W-sketch; only with a translator warning such as W-pwm-pin). */
  sketchWarnings?: boolean;
  /** Stop once the virtual clock reaches this many ms (default 2000). */
  ms?: number;
  /** Text typed in the Serial Monitor before the run (Python mode sends Newline). */
  input?: string;
  before?: (board: Zero1Board, clock: VirtualClock) => void;
}

/** The virtual clock with a hook on every step, where the app's frame loop would look at the board. */
class FinishClock extends VirtualClock {
  onAdvance: (() => void) | null = null;
  override advance(ms: number): void {
    super.advance(ms);
    this.onAdvance?.();
  }
}

/** The last 2 KB of the Serial Monitor, as the app gives pythonize() (§7.8). */
const SERIAL_TAIL = 2048;
/** A program without a main loop may let a tone sound this long after setup() (§7.8). */
const FINISH_TONE_MS = 2000;

/** Translates `source` (no errors allowed), then runs the sketch like Python mode does. */
async function runPython(source: string, opts: RunPythonOptions = {}): Promise<PythonRun> {
  const translation = pythonToArduino(source);
  if (!translation.ok) throw new Error(translation.diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('; '));
  const js = transpile(translation.sketch);
  if (!js.ok) throw new Error(`transpile failed: ${js.errors.map((e) => e.message).join('; ')}`);
  if (!opts.sketchWarnings) expect(js.warnings).toEqual([]);
  const clock = new FinishClock({ yieldCostMs: TICK_COST_MS });
  const board = createZero1Board(clock);
  let serial = '';
  board.serial.onTx((text) => (serial += text));
  if (opts.input !== undefined) board.serial.inject(opts.input);
  opts.before?.(board, clock);
  const console: ConsoleMessage[] = [];
  const raw: string[] = [];
  const executor = new Executor({
    board,
    lineMap: translation.map.composeJsLineMap(js.lineMap),
    stopAfterMs: opts.ms ?? 2000,
    maxLoops: 400000,
    onConsole: (m) => {
      raw.push(m.text);
      console.push(pythonizeRuntimeMessage(m, serial.slice(-SERIAL_TAIL)));
    },
  });
  // The app's finish rule for a program without "while True:" (src/ui/app.ts checkFinished).
  let finishedAt: number | null = null;
  let setupEndedAt: number | null = null;
  if (translation.endsAfterSetup) {
    clock.onAdvance = () => {
      if (finishedAt !== null || executor.loops < 1) return;
      setupEndedAt ??= clock.now();
      if (board.buzzer.state.freq && clock.now() - setupEndedAt < FINISH_TONE_MS) return;
      finishedAt = clock.now();
      void executor.stop();
    };
  }
  await executor.run(js.js);
  return { translation, console, raw, serial, status: executor.status, board, clock, loops: executor.loops, finishedAt, setupEndedAt };
}

/** The Serial Monitor text with plain newlines. */
const lines = (r: { serial: string }): string[] => r.serial.replace(/\r\n/g, '\n').split('\n').slice(0, -1);
const errorsOf = (r: PythonRun) => r.console.filter((m) => m.level === 'error');

/** Runs a program that prints; the Serial lines. */
async function printed(source: string, opts: RunPythonOptions = {}): Promise<string[]> {
  const r = await runPython(source, opts);
  expect(errorsOf(r)).toEqual([]);
  return lines(r);
}

describe('§2.13: numbers and other things that differ from Python on a computer', () => {
  it('whole numbers are 32-bit longs in every expression (adc.read() * 100 // 1023 is 50, 60 * 1000 is 60000, 1 << 20 is 1048576)', async () => {
    const out = await printed(
      'from machine import ADC\nfrom zero1 import POT_LDR\nadc = ADC(POT_LDR)\nprint(adc.read() * 100 // 1023)\nsecond = 1000\nprint(60 * second)\nshift = 20\nprint(1 << shift)\nprint(60 * 1000, 1 << 20)\n',
    );
    expect(out).toEqual(['50', '60000', '1048576', '60000 1048576']);
  });

  it('a = 50000; print(a * a) wraps like an odometer: -1794967296 (Python: 2500000000)', async () => {
    expect(await printed('a = 50000\nprint(a * a)\nb = 2147483647\nprint(b + 1)\n')).toEqual(['-1794967296', '-2147483648']);
  });

  it('decimal numbers are 32-bit floats printed with 7 significant digits: 1/3 is 0.3333333', async () => {
    expect(await printed('x = 1\nprint(x / 3)\nprint(2 / 3)\nprint(1e10 / 3)\n')).toEqual(['0.3333333', '0.6666667', '3.333333e+09']);
  });

  it('0.1 + 0.2 == 0.3 is True (float32 rounding; Python: False)', async () => {
    expect(await printed('a = 0.1\nb = 0.2\nprint(a + b == 0.3)\nprint(0.1 + 0.2 == 0.3)\n')).toEqual(['True', 'True']);
  });

  it('print(0.1 + 0.2) shows 0.3 (Python: 0.30000000000000004)', async () => {
    expect(await printed('a = 0.1\nprint(a + 0.2)\nprint(0.1 + 0.2)\n')).toEqual(['0.3', '0.3']);
  });

  it('f"{2.5:.0f}" is 3: Arduino rounds halves up (Python: 2)', async () => {
    expect(await printed('x = 2.5\nprint(f"{x:.0f}")\nprint(f"{2.5:.0f}", f"{0.5:.0f}", f"{-2.5:.0f}")\n')).toEqual(['3', '3 1 -3']); // Python: 2 0 -2
  });

  it('round(2.675, 2) is 2.68: in float32, 2.675 × 100 is exactly 267.5 (Python: 2.67)', async () => {
    expect(await printed('x = 2.675\nprint(round(x, 2))\nprint(round(2.675, 2))\n')).toEqual(['2.68', '2.68']);
  });

  it('min(2, 2.5) printed is 2.0: one kind per expression (Python: 2)', async () => {
    expect(await printed('a = 2\nprint(min(a, 2.5))\nprint(min(2, 2.5), max(3, 2.5))\n')).toEqual(['2.0', '2.0 3.0']);
  });

  it('//, %, round() and int() behave like Python: floor, the sign of the divisor, halves to even, truncation', async () => {
    const out = await printed(
      'a = -7\nb = 2\nc = 3\nprint(a // b, a % c, 7 % -c, -a // -b)\nprint(round(2.5), round(3.5), round(-2.5), round(0.5))\nx = -2.7\nprint(int(x), int(2.7), int(True))\nprint(-7 // 2, -7 % 3, 5.5 // 2, -5.5 % 2)\n',
    );
    expect(out).toEqual(['-4 2 -2 -4', '2 4 -2 0', '-2 2 1', '-4 2 2.0 0.5']); // CPython 3.12 prints the same
  });

  it('/ always gives a decimal number', async () => {
    expect(await printed('a = 7\nb = 2\nprint(a / b, 6 / 3, a / 2)\n')).toEqual(['3.5 2.0 3.5']);
  });

  it('division by zero stops: ZeroDivisionError: division by zero on the Python line', async () => {
    const r = await runPython('d = 0\nprint("before")\nprint(10 // d)\nprint("after")\n');
    expect(r.status).toBe('error');
    expect(lines(r)).toEqual(['before', 'Line 3: ZeroDivisionError: division by zero']);
    expect(errorsOf(r)).toEqual([{ level: 'error', text: 'ZeroDivisionError: division by zero', line: 3, source: 'python' }]);
  });

  it('a list or text index out of range stops with IndexError on the Python line', async () => {
    const list = await runPython('items = [1, 2, 3]\ni = 3\nprint(items[i - 1])\nprint(items[i])\n');
    expect(lines(list)).toEqual(['3', 'Line 4: IndexError: list index out of range']);
    expect(errorsOf(list)).toMatchObject([{ text: 'IndexError: list index out of range', line: 4 }]);
    const text = await runPython('name = "abc"\ni = -4\nprint(name[-1])\nprint(name[i])\n');
    expect(lines(text)).toEqual(['c', 'Line 4: IndexError: string index out of range']);
    expect(errorsOf(text)).toMatchObject([{ text: 'IndexError: string index out of range', line: 4 }]);
  });

  it('int("12abc") stops with the same ValueError as Python', async () => {
    const r = await runPython('text = "12abc"\nprint(int(" 12 "))\nprint(int(text))\n');
    expect(r.status).toBe('error');
    expect(lines(r)).toEqual(['12', "Line 3: ValueError: invalid literal for int() with base 10: '12abc'"]);
    expect(errorsOf(r)).toMatchObject([{ text: "ValueError: invalid literal for int() with base 10: '12abc'", line: 3 }]);
  });

  it('2 ** -1 with a variable exponent stops: whole numbers have no negative powers on the board (Python: 0.5)', async () => {
    const r = await runPython('n = 3\nprint(2 ** n)\nn = -1\nprint(2 ** n)\n');
    expect(lines(r)).toEqual(['8', `Line 4: ${message('R-neg-power')}`]);
    expect(errorsOf(r)).toMatchObject([{ text: 'a negative power of a whole number is a decimal number: write 2.0 ** n', line: 4 }]);
  });

  it('time.sleep(-1) stops with the same ValueError as Python', async () => {
    const r = await runPython('import time\nprint("start")\ntime.sleep(-1)\n');
    expect(lines(r)).toEqual(['start', 'Line 3: ValueError: sleep length must be non-negative']);
    expect(errorsOf(r)).toMatchObject([{ text: 'ValueError: sleep length must be non-negative', line: 3 }]);
    const ms = await runPython('import time\nwait = -5\ntime.sleep_ms(wait)\n');
    expect(errorsOf(ms)).toMatchObject([{ text: 'ValueError: sleep length must be non-negative', line: 3 }]);
  });

  it('time.sleep_ms(1.5) is refused before running (E-sleep-ms-float; MicroPython: TypeError)', () => {
    const t = pythonToArduino('import time\ntime.sleep_ms(1.5)\n');
    expect(t.ok).toBe(false);
    expect(t.diagnostics.map((d) => [d.code, d.line])).toEqual([['E-sleep-ms-float', 2]]);
  });

  it('a growing list keeps 20 more items, then stops with MemoryError', async () => {
    const r = await runPython('readings = []\nwhile True:\n    readings.append(len(readings))\n    print(len(readings))\n', { ms: 100 });
    expect(r.translation.diagnostics.map((d) => d.code)).toEqual(['W-list-capacity']);
    expect(lines(r)).toEqual([...Array.from({ length: 20 }, (_, i) => String(i + 1)), 'Line 3: MemoryError: the list is full (20 items on the board)']);
    expect(errorsOf(r)).toMatchObject([{ text: 'MemoryError: the list is full (20 items on the board)', line: 3 }]);
  });

  it('len("été"): W-text-bytes, because the board counts bytes (5; Python: 3); the simulator still counts characters', async () => {
    const r = await runPython('word = "été"\nprint(len(word), word)\n');
    expect(r.translation.diagnostics.map((d) => d.code)).toEqual(['W-text-bytes']);
    // KNOWN GAP (reported): the simulator keeps text as characters, so it prints 3 where the
    // board prints 5 (tests-hardware-sim/python-board.test.ts checks the chip's 5). Printing the
    // text itself is the same on both.
    expect(lines(r)).toEqual(['3 été']);
  });

  it('time.ticks_ms() wraps after 24.8 days (a negative number after 2147483647 ms); ticks_diff() still measures right', async () => {
    const r = await runPython('import time\nstart = time.ticks_ms()\ntime.sleep(1)\nnow = time.ticks_ms()\nprint(start, now, time.ticks_diff(now, start))\n', {
      before: (_board, clock) => clock.advance(2 ** 31 - 500),
      ms: 2 ** 31 + 2000,
    });
    expect(lines(r)).toEqual(['2147483148 -2147483148 1000']);
  });

  it('deep recursion: W-recursion; the simulator does not notice (the board crashes at about 50 levels)', async () => {
    const r = await runPython('def depth(n):\n    if n == 0:\n        return 0\n    return 1 + depth(n - 1)\n\nprint(depth(100))\n');
    expect(r.translation.diagnostics.map((d) => d.code)).toEqual(['W-recursion']);
    expect(lines(r)).toEqual(['100']);
  });

  it('input() reads a line, shows it like a terminal, and waits while nothing is sent', async () => {
    const source = 'name = input("Name? ")\nprint("Hello", name)\n';
    const typed = await runPython(source, { input: 'Ada\n' });
    expect(typed.translation.usesInput).toBe(true);
    expect(typed.serial).toBe('Name? Ada\r\nHello Ada\r\n');
    const crlf = await runPython(source, { input: 'Bob\r\n' });
    expect(crlf.serial).toBe('Name? Bob\r\nHello Bob\r\n');
    const waiting = await runPython(source, { ms: 1000 });
    expect(waiting.status).toBe('stopped');
    expect(waiting.serial).toBe('Name? ');
  });
});

describe('§5.6: a runtime stop ends the run like an uncaught Python error', () => {
  /** Each stop: program, its Python line, the text (the Serial Monitor shows "Line N: text"). */
  const STOPS: ReadonlyArray<{ name: string; source: string; line: number; text: string; before?: (b: Zero1Board) => void; input?: string }> = [
    { name: 'IndexError (list)', source: 'items = [1, 2]\nk = 5\nitems[k] = 0\n', line: 3, text: message('R-index') },
    { name: 'IndexError (pop from empty list)', source: 'items = []\nitems.append(1)\nitems.pop()\nitems.pop()\n', line: 4, text: message('R-pop-empty') },
    { name: 'ZeroDivisionError', source: 'n = 0\nx = 1.5\nprint(x / n)\n', line: 3, text: message('R-zero') },
    { name: 'ValueError (int)', source: 'print(int(input("n? ")))\n', line: 1, text: "ValueError: invalid literal for int() with base 10: 'ten'", input: 'ten\n' },
    { name: 'ValueError (float)', source: 'print(float(input()))\n', line: 1, text: "ValueError: could not convert string to float: '1.2.3'", input: '1.2.3\n' },
    { name: 'ValueError (max of an empty list)', source: 'items = []\nitems.append(1)\nitems.clear()\nprint(max(items))\n', line: 4, text: message('R-max-empty') },
    { name: 'MemoryError', source: 'items = []\nn = 0\nwhile n < 25:\n    items.append(n)\n    n += 1\n', line: 4, text: message('R-list-full', { n: 20 }) },
    {
      name: 'OSError (DHT22 unplugged)',
      source: 'import dht\nfrom machine import Pin\nfrom zero1 import DHT_PIN\nsensor = dht.DHT22(Pin(DHT_PIN))\nsensor.measure()\nprint(sensor.temperature())\n',
      line: 5,
      text: message('R-dht'),
      before: (b) => b.dht.setConnected(false),
    },
    {
      name: 'OSError (no echo)',
      source: 'from zero1 import HCSR04\nsonar = HCSR04()\nprint(sonar.distance_cm())\n',
      line: 3,
      text: message('R-sonar'),
      before: (b) => b.ultrasonic.setConnected(false),
    },
    { name: 'negative sleep', source: 'import time\nt = -0.5\ntime.sleep(t)\n', line: 3, text: message('R-sleep') },
    // map() would divide by in_max - in_min: the board would go on with any value (pyMapRange)
    { name: 'map_range() with in_min equal to in_max', source: 'from zero1 import map_range\nlow = 5\nprint("start")\nprint(map_range(3, low, low, 0, 100))\n', line: 4, text: message('R-zero') },
    { name: 'a negative shift count', source: 'n = 3 - 4\nprint(1 << n)\n', line: 2, text: message('R-shift') },
    { name: 'math.sqrt() of a negative number', source: 'import math\nx = -1\nprint(math.sqrt(x))\n', line: 3, text: message('R-math-domain') },
    { name: 'math.log(0)', source: 'import math\nx = 0\nprint(math.log(x))\n', line: 3, text: message('R-math-domain') },
    { name: 'assert', source: 'level = 7\nassert level < 5, "too high"\n', line: 2, text: 'AssertionError: too high' },
    { name: 'assert without a message', source: 'ok = False\nassert ok\n', line: 2, text: 'AssertionError' },
    { name: 'raise', source: 'temperature = 40\nif temperature > 35:\n    raise ValueError(f"too hot: {temperature}")\n', line: 3, text: 'ValueError: too hot: 40' },
  ];

  it.each(STOPS)('$name', async ({ source, line, text, before, input }) => {
    const r = await runPython(source, { before: before && ((b) => before(b)), input, ms: 5000 });
    expect(r.status).toBe('error');
    expect(lines(r).at(-1)).toBe(`Line ${line}: ${text}`);
    expect(errorsOf(r)).toEqual([{ level: 'error', text, line, source: 'python' }]);
  });

  /** Stops while the Serial line is not finished: "Line N: …" follows the program's own text on that line. */
  const MID_LINE: ReadonlyArray<{ name: string; source: string; line: number; text: string; last: string; input?: string }> = [
    { name: "print('x', lst[99])", source: 'lst = [1, 2]\nk = 99\nprint("x", lst[k])\n', line: 3, text: message('R-index'), last: `x Line 3: ${message('R-index')}` },
    {
      name: 'print("Item:", nums[k]) with k typed',
      source: 'nums = [3, 1, 2]\nk = int(input("Which item? "))\nprint("Item:", nums[k])\n',
      input: '5\n',
      line: 3,
      text: message('R-index'),
      last: `Item: Line 3: ${message('R-index')}`,
    },
    {
      name: 'an error after print(…, end=" ")',
      source: 'for i in range(5):\n    print(10 // (2 - i), end=" ")\n',
      line: 2,
      text: message('R-zero'),
      last: `5 10 Line 2: ${message('R-zero')}`,
    },
    { name: 'the program’s own "Line 7: " earlier on the line', source: 'print("Line 7: ", end="")\nn = 0\nprint(1 // n)\n', line: 3, text: message('R-zero'), last: `Line 7: Line 3: ${message('R-zero')}` },
    { name: 'a raise whose text has "Line 5: "', source: 'x = 1\nprint("a", end="")\nif x:\n    raise ValueError("Line 5: bad")\n', line: 4, text: 'ValueError: Line 5: bad', last: 'aLine 4: ValueError: Line 5: bad' },
    { name: 'a raise of an own error name', source: 'print("a", end=" ")\nraise Stop("now")\n', line: 2, text: 'Stop: now', last: 'a Line 2: Stop: now' },
  ];

  it.each(MID_LINE)('in the middle of a line: $name', async ({ source, line, text, last, input }) => {
    const r = await runPython(source, { input, ms: 3000 });
    expect(r.status).toBe('error');
    expect(lines(r).at(-1)).toBe(last);
    expect(errorsOf(r)).toEqual([{ level: 'error', text, line, source: 'python' }]);
  });

  it('the capacity of a list filled in a for loop is exact: 25 appends in range(25) never stop', async () => {
    const r = await runPython('items = []\nfor i in range(25):\n    items.append(i)\nprint(len(items), items[24])\n');
    expect(r.translation.diagnostics).toEqual([]);
    expect(lines(r)).toEqual(['25 24']);
  });
});

describe('§7.8: a program without "while True:" finishes', () => {
  it('after setup() returns (the board then only runs the empty loop())', async () => {
    const r = await runPython('from machine import Pin\nfrom zero1 import LED_RED\nimport time\nled = Pin(LED_RED, Pin.OUT)\nfor _ in range(3):\n    led.on()\n    time.sleep(0.2)\n    led.off()\n    time.sleep(0.2)\nprint("Done")\n', { ms: 10000 });
    expect(r.translation.endsAfterSetup).toBe(true);
    expect(r.status).toBe('stopped');
    expect(r.serial).toBe('Done\r\n');
    expect(r.setupEndedAt).toBeCloseTo(1200, 0);
    expect(r.finishedAt).toBe(r.setupEndedAt); // nothing sounds: at once
    expect(r.board.ledRed.state.on).toBe(false);
  });

  it('lets a last tone(…, 500) finish, then stops', async () => {
    const tones: Array<[number | null, number]> = [];
    const r = await runPython('from zero1 import Buzzer\nbuzzer = Buzzer()\nprint("Beep")\nbuzzer.tone(440, 500)\n', {
      ms: 10000,
      before: (b, clock) => b.on((e) => e.type === 'tone' && tones.push([e.freq, Math.round(clock.now())])),
    });
    expect(r.serial).toBe('Beep\r\n');
    expect(tones).toEqual([[440, 0], [null, 500]]); // the whole 500 ms tone was played ...
    expect(r.finishedAt).not.toBeNull();
    expect(r.finishedAt!).toBeGreaterThanOrEqual(500); // ... before the run finished
    expect(r.finishedAt! - r.setupEndedAt!).toBeLessThanOrEqual(FINISH_TONE_MS);
    expect(r.status).toBe('stopped');
    expect(r.board.buzzer.state.freq).toBeNull();
  });

  it('stops at most 2 s later when a tone never ends', async () => {
    const r = await runPython('from zero1 import Buzzer\nbuzzer = Buzzer()\nbuzzer.tone(440)\n', { ms: 10000 });
    expect(r.finishedAt! - r.setupEndedAt!).toBeGreaterThanOrEqual(FINISH_TONE_MS);
    expect(r.finishedAt! - r.setupEndedAt!).toBeLessThan(FINISH_TONE_MS + 1);
    expect(r.status).toBe('stopped');
  });
});

describe('§4.7 E4: Python\'s order of evaluation, list indexes and numbers, as CPython prints them', () => {
  it.each(ORDER_CASES)('$name', async ({ source, input, cpython }) => {
    const r = await runPython(source, { input, ms: 3000 });
    expect(errorsOf(r)).toEqual([]);
    expect(lines(r)).toEqual(cpython);
  });

  it('a docstring with \\r keeps every sketch line whole (GCC ends a // comment at a carriage return)', async () => {
    const r = await runPython('def ask():\n    """Wait for Enter (\\r or \\n), then return the line."""\n    return input()\nprint(ask())\n', { input: 'hey\n' });
    expect(r.translation.sketch).not.toMatch(/[\r\v\f]/);
    expect(r.translation.sketch).toContain('// Wait for Enter (\n');
    expect(lines(r)).toEqual(['hey', 'hey']);
  });
});

describe('§3.2: duty_u16() on a pin without PWM (W-pwm-pin)', () => {
  it('32768 or more switches the pin on, less switches it off, as the warning says', async () => {
    const r = await runPython(
      'from machine import Pin, PWM\nfrom zero1 import LED_RED\nimport time\npwm = PWM(Pin(LED_RED))\nfor duty in [0, 32767, 32768, 65535, 100]:\n    pwm.duty_u16(duty)\n    print(duty, Pin(LED_RED).value())\n',
      { sketchWarnings: true },
    );
    expect(r.translation.diagnostics.map((d) => d.message)).toEqual([
      'Pin 15 (A1, the red LED) cannot dim: only pins 3, 5, 6, 9, 10 and 11 have PWM on the UNO. duty_u16() of 32768 or more switches it on, less switches it off.',
    ]);
    expect(lines(r)).toEqual(['0 0', '32767 0', '32768 1', '65535 1', '100 0']);
  });

  it('duty_u16 becomes 0..255 with v / 256: 65535 is fully on, 32768 is half', () => {
    const t = pythonToArduino('from machine import Pin, PWM\nfrom zero1 import RGB_PIN\npwm = PWM(Pin(RGB_PIN), duty_u16=32768)\nlevel = 65535\npwm.duty_u16(level)\npwm.duty_u16(65535)\n');
    expect(t.diagnostics).toEqual([]);
    expect(t.sketch).toContain('analogWrite(pwm, 128);');
    expect(t.sketch).toContain('analogWrite(pwm, level / 256);');
    expect(t.sketch).toContain('analogWrite(pwm, 255);');
  });
});

describe('§5.9: the simulator’s runtime texts in Python words', () => {
  /** Programs that make the simulator print each text of RUNTIME_WORDINGS (in its order), and the Python words. */
  const CASES: ReadonlyArray<{ name: string; source: string; raw: string; python: string; line?: number; config?: (b: Zero1Board) => void }> = [
    {
      name: 'a Pin switched on without Pin.OUT',
      source: 'from machine import Pin\nfrom zero1 import LED_RED\nled = Pin(LED_RED)\nled.on()\n',
      raw: 'digitalWrite(A1) but pinMode(A1, OUTPUT) was never called',
      python: 'Pin 15 (A1, the red LED) is switched on or off but was not made with Pin.OUT: write Pin(LED_RED, Pin.OUT)',
    },
    {
      name: 'a pin number that does not exist, worked out while running',
      source: 'from machine import Pin\nn = 20 + 5\nled = Pin(n, Pin.OUT)\n',
      raw: 'pin 25 does not exist on the UNO (use 0-13 or A0-A5)',
      python: 'Pin 25 does not exist on the Arduino UNO: use 0-13, A0-A5 or a ZERO1 name such as LED_RED.',
      line: 3,
    },
    {
      name: 'ADC on a pin that is not analog, worked out while running',
      source: 'from machine import ADC\nn = 30\nsensor = ADC(n)\nprint(sensor.read())\n',
      raw: 'analogRead(30): that is not an analog pin (use A0-A5)',
      python: 'ADC needs an analog pin: A0-A5, for example POT_LDR.',
      line: 4,
    },
    {
      name: 'PWM on pin 9 or 10 with a Servo()',
      source: 'from machine import Pin, PWM\nfrom zero1 import Servo, RGB_PIN\nservo = Servo()\nlight = PWM(Pin(10), duty_u16=65535)\n',
      raw: 'PWM on pins 9 and 10 is disabled while a Servo is attached',
      python: 'PWM does not work on pins 9 and 10 while the program has a Servo(): the servo needs the timer that makes their PWM.',
    },
    {
      name: 'servo.angle() after servo.detach()',
      source: 'from zero1 import Servo\nservo = Servo()\nservo.detach()\nservo.angle(90)\n',
      raw: 'Servo.write() called before attach(): call myServo.attach(4) in setup()',
      python: 'servo.angle() does nothing here: the servo was detached with detach(), or the line servo = Servo() has not run yet.',
    },
    {
      name: 'an LCD at another address',
      source: 'from zero1 import LCD\nlcd = LCD(addr=0x3F)\nlcd.putstr("Hi")\n',
      raw: 'No I2C LCD found at address 0x3F (the ZERO1 LCD is at 0x27)',
      python: 'No LCD answers at I2C address 0x3F. The ZERO1 LCD is at 0x27 (LCD() uses it); example 34, the I2C scanner, shows the address of an LCD.',
    },
    {
      name: 'the LCD used by a function before lcd = LCD() ran',
      source: 'from zero1 import LCD\n\ndef greet():\n    lcd.putstr("Hi")\n\ngreet()\nlcd = LCD()\n',
      raw: 'the LCD was used before lcd.init(): call lcd.init() (or lcd.begin()) in setup()',
      python: 'The LCD is used before the line lcd = LCD() has run (Python would stop with NameError): make the LCD at the top of the program.',
    },
    {
      name: 'the RGB LED used by a function before np = NeoPixel(…) ran',
      source: 'from machine import Pin\nfrom neopixel import NeoPixel\nfrom zero1 import RGB_PIN\n\ndef show():\n    np.write()\n\nshow()\nnp = NeoPixel(Pin(RGB_PIN), 1)\n',
      raw: 'pixels.show() called before pixels.begin(): call pixels.begin() in setup()',
      python: 'The RGB LED is used before the line np = NeoPixel(…) has run (Python would stop with NameError): make it at the top of the program.',
    },
  ];

  it('has one case per entry of RUNTIME_WORDINGS', () => {
    expect(CASES).toHaveLength(RUNTIME_WORDINGS.length);
    CASES.forEach((c, i) => expect(RUNTIME_WORDINGS[i].pattern.test(c.raw), c.name).toBe(true));
  });

  it.each(CASES)('$name: the real text, in Python words', async ({ source, raw, python, line }) => {
    const r = await runPython(source, { ms: 300 });
    expect(r.raw).toContain(raw);
    const shown = r.console[r.raw.indexOf(raw)];
    expect(shown.text).toBe(python);
    if (line !== undefined) expect(shown).toMatchObject({ level: 'error', line });
    expect(python.length).toBeLessThanOrEqual(240);
    // No C++ words the student did not write (§5.0).
    expect(python).not.toMatch(/digitalWrite|pinMode|analogRead|analogWrite|attach\(|\binit\(|begin\(|setup\(\)|Serial|String|\blong\b/);
  });

  it('keeps the rest of the message (level, line) and passes unknown texts through unchanged', () => {
    const msg: ConsoleMessage = { level: 'warn', text: 'digitalWrite(13) but pinMode(13, OUTPUT) was never called', line: 7 };
    expect(pythonizeRuntimeMessage(msg, '')).toEqual({
      level: 'warn',
      text: 'Pin 13 (D13, the built-in LED) is switched on or off but was not made with Pin.OUT: write Pin(LED_BUILTIN, Pin.OUT)',
      line: 7,
    });
    expect(pythonizeRuntimeMessage({ level: 'warn', text: 'digitalWrite(0) but pinMode(0, OUTPUT) was never called' }, '').text).toBe(
      'Pin 0 (D0) is switched on or off but was not made with Pin.OUT: write Pin(0, Pin.OUT)',
    );
    expect(pythonizeRuntimeMessage({ level: 'warn', text: 'digitalWrite(A4) but pinMode(A4, OUTPUT) was never called' }, '').text).toBe(
      'Pin 18 (A4) is switched on or off but was not made with Pin.OUT: write Pin(A4, Pin.OUT)',
    );
    for (const text of ['runtime error: boom', 'external interrupts are not simulated on this board', 'The sketch stopped: abort() was called.']) {
      const other: ConsoleMessage = { level: 'error', text, line: 2 };
      expect(pythonizeRuntimeMessage(other, 'no pyFail line here\r\n')).toBe(other);
    }
  });
});
