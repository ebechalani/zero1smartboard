/**
 * Python mode on the real chip (docs/PYTHON.md §10.6): the sketches made from Python compile
 * with the project's avr-g++ 7.3 (WebAssembly) at -Wall -Wextra without warnings and fit the
 * UNO; the helpers of §4.8 and the deterministic goldens print the same Serial output on an
 * emulated ATmega328P (avr8js, tools/emulator/run-hex.mjs, wired like the ZERO1: A3 = 512,
 * DHT22 24.0 °C / 55 %, an object at 50 cm) as in the simulator; and every name a Python
 * program can have after renaming (§2.14) can be declared in a sketch.
 * Without the WebAssembly tools (no toolchain release yet, §0.1) the same builds run with the
 * avr-g++ 7.3 installed on the machine (native-toolchain.ts, §10.6), as on CI. Skips when neither
 * is there or the bundle is not built; ZERO1_REQUIRE_TOOLCHAIN=1 makes that a failure.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PYTHON_EXAMPLES, pythonToArduino } from '../src/python';
import { RESERVED_NAMES } from '../src/python/reserved-names';
import { buildSketch, loadBundle, type Bundle } from '../src/upload/toolchain/arduino-build';
import { WasmToolchain } from '../src/upload/toolchain/wasm-toolchain';
import { HELPER_BOARD_VALUES, HELPER_GLOBALS, HELPER_STOPS, HELPER_VALUES, helperSketch } from '../tests/fixtures/python/helper-cases';
import { ORDER_CASES } from '../tests/fixtures/python/order-cases';
import { COMPILE_CASES, PARAM_KIND_CASES } from '../tests/fixtures/python/sketch-cases';
import { toolchainPaths } from '../tests/fakes/upload/toolchain-paths';
import { nativeToolchain, type SketchToolchain } from './native-toolchain';
import { runSketch } from '../tests/helpers';
// @ts-expect-error plain JavaScript harness (avr8js), no types
import { simulate } from '../tools/emulator/run-hex.mjs';

interface SimResult {
  serial: { text: string };
  timing: { halted: unknown };
  warnings: string[];
}

const native = process.env.ZERO1_TOOLCHAIN === 'native' || !toolchainPaths() ? nativeToolchain() : null;
const paths = native ? null : toolchainPaths();
if (!paths && !native && process.env.ZERO1_REQUIRE_TOOLCHAIN) throw new Error('ZERO1_REQUIRE_TOOLCHAIN is set but no toolchain (WebAssembly tools, or avr-g++ on the PATH) or no bundle was found');

const FIXTURES = new URL('../tests/fixtures/python/', import.meta.url);
const CASES = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.py') && !f.startsWith('t9'))
  .map((f) => f.slice(0, -3))
  .sort();
const golden = (name: string) => readFileSync(new URL(`${name}.ino`, FIXTURES), 'utf8');

let tc: SketchToolchain;
let bundle: Bundle;

async function compile(source: string, fileName: string): Promise<string> {
  const r = await buildSketch(tc, bundle, { source, fileName, warnings: 'all' });
  if (!r.ok) throw new Error(`build failed at ${r.stage}:\n${r.stderr.join('\n')}`);
  expect(r.warnings.map((w) => `${fileName}:${w.line}: ${w.message}`)).toEqual([]);
  expect(r.fits).toBe(true);
  return r.hex;
}

/** The complete lines of a Serial text. */
const lines = (text: string) => text.split('\r\n').slice(0, -1);
/** run-hex records the chip's Serial bytes one character each: read them as UTF-8, as the Serial Monitor does. */
const utf8 = (bytes: string) => Buffer.from(bytes, 'latin1').toString('utf8');

describe.skipIf(!paths && !native)(`Python mode on the chip (§10.6)${native ? ', with the installed avr-g++' : ''}`, () => {
  beforeAll(async () => {
    const fetchBytes = async (u: string) => new Uint8Array(readFileSync(u.startsWith('file:') ? new URL(u) : u));
    tc = native ? native.tc : new WasmToolchain({ toolsBase: pathToFileURL(paths!.toolsDir + '/').href, fetchBytes, importGlue: async (url) => (await import(url)).default });
    bundle = await loadBundle((native ? native.bundleDir : paths!.bundleDir) + '/', fetchBytes);
  });

  // The compiler and the emulator run synchronously; between two tests let the worker answer
  // Vitest's messages, or a suite that runs longer than a minute ends with an RPC timeout.
  afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

  it('the compiler reports -Wall -Wextra warnings on sketch lines (a check of the checks below)', async () => {
    const r = await buildSketch(tc, bundle, { source: 'void setup() {\n  long x = 5;\n}\nvoid loop() {}\n', fileName: 'check.ino', warnings: 'all' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.warnings.map((w) => [w.line, w.message])).toEqual([[2, "unused variable 'x' [-Wunused-variable]"]]);
  });

  it('every golden sketch compiles without warnings and fits the UNO', async () => {
    for (const name of CASES) await compile(golden(name), `${name}.ino`);
  });

  it('every Python example’s sketch compiles without warnings and fits the UNO (§10.6)', async () => {
    for (const e of PYTHON_EXAMPLES) {
      const t = pythonToArduino(e.python);
      expect(t.ok, e.id).toBe(true);
      await compile(t.sketch, `${e.id}.ino`);
    }
  });

  it('the helpers print Python’s values on the chip, as in the simulator (§4.8, §2.13)', async () => {
    const calls = [...HELPER_VALUES.map(([expr]) => expr), ...HELPER_BOARD_VALUES.map(([expr]) => expr)];
    const hex = await compile(helperSketch(calls.map((expr) => `Serial.println(${expr});`), HELPER_GLOBALS), 'helpers.ino');
    const r = simulate(hex, { ms: 1500 }) as SimResult;
    expect(r.warnings).toEqual([]);
    const expected = [...HELPER_VALUES.map(([, value]) => value), ...HELPER_BOARD_VALUES.map(([, board]) => board)];
    expect(lines(r.serial.text).map((l, i) => [calls[i], l])).toEqual(calls.map((c, i) => [c, expected[i]]));
  });

  it.each(HELPER_STOPS)('%s stops the chip after "Line N: …" (pyFail + abort, §5.6)', async (name, call, text) => {
    const hex = await compile(helperSketch([call], HELPER_GLOBALS), 'stop.ino');
    const r = simulate(hex, { ms: 1500 }) as SimResult;
    expect(lines(r.serial.text).at(-1)).toBe(`Line ${name === 'pyFail' ? 3 : 12}: ${text}`);
    expect(r.timing.halted).not.toBeNull();
  });

  /** Goldens whose Serial output does not depend on timing details, random numbers or buttons; with their inputs. */
  const RUNS: ReadonlyArray<{ name: string; ms: number; input?: string }> = [
    { name: 't1_blink', ms: 2300 },
    { name: 't2_numbers', ms: 2300 },
    { name: 't3_webs', ms: 1000, input: '20\n' },
    { name: 't4_growable_list', ms: 3500 },
    { name: 't5_dht_form_s', ms: 4500 },
    { name: 't6_form_v', ms: 1000, input: '12\n' },
    { name: 't8_ends', ms: 4300 },
    { name: 'assign_forms', ms: 300 },
    { name: 'ex_melody', ms: 1000 },
    { name: 'ex_pot_serial', ms: 2300 },
    { name: 'ex_serial_echo', ms: 2000, input: 'on\n3\n' },
    { name: 'functions', ms: 500 },
    { name: 'input_numbers', ms: 1000, input: '12\n1.75\n' },
    { name: 'loops_range', ms: 1000, input: '5\n' },
    { name: 'main_break_after', ms: 2000 },
    { name: 'numbers_n2_n5', ms: 500 },
    { name: 'print_fstrings', ms: 500 },
    { name: 'raise_assert', ms: 500, input: '42\n' },
    { name: 'operators', ms: 500, input: '-4\n' },
    { name: 'strings', ms: 1500 },
    { name: 'unreachable', ms: 300 },
  ];

  it.each(RUNS)('$name prints the same on the chip as in the simulator', async ({ name, ms, input }) => {
    const sketch = golden(name);
    expect(pythonToArduino(readFileSync(new URL(`${name}.py`, FIXTURES), 'utf8')).sketch).toBe(sketch);
    const chip = simulate(await compile(sketch, `${name}.ino`), { ms, serialIn: input ?? null, dht: { t: 24, h: 55 }, distance: 50 }) as SimResult;
    const sim = await runSketch(sketch, { stopAfterMs: ms, before: (board) => input && board.serial.inject(input) });
    const a = lines(utf8(chip.serial.text));
    const b = lines(sim.serial);
    const n = Math.min(a.length, b.length);
    expect(n).toBeGreaterThan(0);
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1); // the window may end between two lines
    expect(a.slice(0, n)).toEqual(b.slice(0, n));
  });

  /**
   * The chip's line with each number replaced by the simulator's where the two differ by at most
   * `close[unit]`, `unit` being the word that follows the number (`49.8 cm`: `cm`). §10.6: the
   * chip times the echo pulse a little differently, so its distances are within 1 cm of the
   * simulator's (and so are the numbers made from them); every other character must be equal.
   */
  function closeTo(chip: string, sim: string, close: Readonly<Record<string, number>>): string {
    const number = /-?\d+(?:\.\d+)?/g;
    const simNumbers = sim.match(number) ?? [];
    if (chip.replace(number, '#') !== sim.replace(number, '#')) return chip;
    let i = 0;
    return chip.replace(number, (value, at: number) => {
      const other = simNumbers[i++]!;
      const unit = /^\s*([a-z]+)/i.exec(chip.slice(at + value.length))?.[1] ?? '';
      return unit in close && Math.abs(Number(value) - Number(other)) <= close[unit]! ? other : value;
    });
  }

  /**
   * Python examples whose Serial output does not depend on timing details, random numbers or
   * buttons; with their inputs, and `close` for the numbers that may differ a little (distances).
   */
  const EXAMPLE_RUNS: ReadonlyArray<{ id: string; ms: number; input?: string; close?: Readonly<Record<string, number>> }> = [
    { id: '01_blink_red', ms: 1200 },
    { id: '02_traffic_lights', ms: 2500 },
    { id: '03_buzzer_melody', ms: 500 },
    { id: '06_servo_sweep', ms: 3000 },
    { id: '07_dc_motor', ms: 2500 },
    { id: '11_button_toggle', ms: 300 },
    { id: '12_potentiometer_serial', ms: 700 },
    { id: '16_serial_echo', ms: 2000, input: 'on\n3\nhello\n' },
    { id: '31_greenhouse', ms: 2500 },
    { id: '32_reaction_game', ms: 300 },
    { id: '34_i2c_scanner', ms: 500 },
    { id: '42_led_blink_10_times', ms: 6500 },
    { id: '50_ldr_red_green', ms: 1200 },
    { id: '54_ultrasonic_beep_rate', ms: 2000, close: { cm: 1, ms: 11 } }, // the pause is int(distance * 10)
    { id: '56_servo_ultrasonic_10_times', ms: 3500, close: { cm: 1 } },
    { id: '57_dht_serial', ms: 4500 },
  ];

  it.each(EXAMPLE_RUNS)('the Python example $id prints the same on the chip as in the simulator', async ({ id, ms, input, close }) => {
    const sketch = pythonToArduino(PYTHON_EXAMPLES.find((e) => e.id === id)!.python).sketch;
    const chip = simulate(await compile(sketch, `${id}.ino`), { ms, serialIn: input ?? null, dht: { t: 24, h: 55 }, distance: 50 }) as SimResult;
    const sim = await runSketch(sketch, { stopAfterMs: ms, before: (board) => input && board.serial.inject(input) });
    const b = lines(sim.serial);
    const a = lines(utf8(chip.serial.text)).map((line, i) => (close && i < b.length ? closeTo(line, b[i]!, close) : line));
    const n = Math.min(a.length, b.length);
    expect(n).toBeGreaterThan(0);
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1); // the window may end between two lines
    expect(a.slice(0, n)).toEqual(b.slice(0, n));
  });

  it('the programs that once made avr-g++ warn or refuse the sketch compile without warnings (§4.7 E3; n08: an LCD bitmap given to a function)', async () => {
    for (const c of COMPILE_CASES) {
      const t = pythonToArduino(c.source);
      expect(t.ok, c.name).toBe(true);
      await compile(t.sketch, 'sketch.ino');
    }
  });

  it('n01 and n02 (lists of other items at two calls of one function) are refused before running, not by the compiler (§2.9)', () => {
    for (const c of PARAM_KIND_CASES) expect(pythonToArduino(c.source).diagnostics.map((d) => `${d.code}@${d.line}`), c.name).toEqual([`E-param-kinds@${c.line}`]);
  });

  it.each(ORDER_CASES)('$name: the chip prints what CPython prints (§4.7 E4)', async ({ source, input, cpython }) => {
    const t = pythonToArduino(source);
    expect(t.ok).toBe(true);
    const chip = simulate(await compile(t.sketch, 'order.ino'), { ms: 1500, serialIn: input || null }) as SimResult;
    expect(lines(utf8(chip.serial.text))).toEqual(cpython);
  });

  it('duty_u16() of 32768 or more switches a pin without PWM on, less switches it off, as W-pwm-pin says (§3.2, §5.7)', async () => {
    const source = 'from machine import Pin, PWM\nfrom zero1 import LED_RED\npwm = PWM(Pin(LED_RED))\nfor duty in [0, 32767, 32768, 65535, 100]:\n    pwm.duty_u16(duty)\n    print(duty, Pin(LED_RED).value())\n';
    const t = pythonToArduino(source);
    expect(t.diagnostics.map((d) => d.code)).toEqual(['W-pwm-pin']);
    const chip = simulate(await compile(t.sketch, 'pwm.ino'), { ms: 300 }) as SimResult;
    expect(lines(chip.serial.text)).toEqual(['0 0', '32767 0', '32768 1', '65535 1', '100 0']);
  });

  it('len() counts the bytes of a text on the chip: len("été") is 5 (W-text-bytes, §2.13)', async () => {
    const t = pythonToArduino('word = "été"\nprint(len(word), word[1] == "é")\n');
    expect(t.diagnostics.map((d) => d.code)).toEqual(['W-text-bytes', 'W-text-bytes']);
    const chip = simulate(await compile(t.sketch, 'bytes.ino'), { ms: 300 }) as SimResult;
    expect(lines(utf8(chip.serial.text))).toEqual(['5 False']);
  });

  it('every name a Python program can have after renaming can be declared in a sketch (§2.14)', async () => {
    const PYTHON_KEYWORDS = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
    // As the translator does: '_' appended while the name is reserved or already used.
    const used = new Set<string>();
    const renamed = [...RESERVED_NAMES]
      .filter((n) => /^[A-Za-z_]\w*$/.test(n) && !PYTHON_KEYWORDS.has(n))
      .map((n) => {
        let cpp = `${n}_`;
        while (RESERVED_NAMES.has(cpp) || used.has(cpp)) cpp += '_';
        used.add(cpp);
        return cpp;
      });
    const decls = renamed.map((n) => `long ${n} = 0;`);
    const source = `${decls.map((d) => `const ${d}`).join('\n')}\nvoid setup() {\n${decls.map((d) => `  ${d}`).join('\n')}\n}\nvoid loop() {\n}\n`;
    const r = await buildSketch(tc, bundle, { source, fileName: 'names.ino' });
    expect(r.ok ? [] : r.stderr.filter((l) => l.includes('error'))).toEqual([]);
  });
});
