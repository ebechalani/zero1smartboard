/**
 * Python mode on the real chip (docs/PYTHON.md §10.6): the sketches made from Python compile
 * with the project's avr-g++ 7.3 (WebAssembly) at -Wall -Wextra without warnings and fit the
 * UNO; the helpers of §4.8 and the deterministic goldens print the same Serial output on an
 * emulated ATmega328P (avr8js, tools/emulator/run-hex.mjs, wired like the ZERO1: A3 = 512,
 * DHT22 24.0 °C / 55 %, an object at 50 cm) as in the simulator; and every name a Python
 * program can have after renaming (§2.14) can be declared in a sketch.
 * Skips when the toolchain or the bundle is not built; CI sets ZERO1_REQUIRE_TOOLCHAIN=1 once
 * the toolchain release exists, so a missing toolchain fails instead.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { pythonToArduino } from '../src/python';
import { RESERVED_NAMES } from '../src/python/reserved-names';
import { buildSketch, loadBundle, type Bundle } from '../src/upload/toolchain/arduino-build';
import { WasmToolchain } from '../src/upload/toolchain/wasm-toolchain';
import { HELPER_BOARD_VALUES, HELPER_GLOBALS, HELPER_STOPS, HELPER_VALUES, helperSketch } from '../tests/fixtures/python/helper-cases';
import { toolchainPaths } from '../tests/fakes/upload/toolchain-paths';
import { runSketch } from '../tests/helpers';
// @ts-expect-error plain JavaScript harness (avr8js), no types
import { simulate } from '../tools/emulator/run-hex.mjs';

interface SimResult {
  serial: { text: string };
  timing: { halted: unknown };
  warnings: string[];
}

const paths = toolchainPaths();
if (!paths && process.env.ZERO1_REQUIRE_TOOLCHAIN) throw new Error('ZERO1_REQUIRE_TOOLCHAIN is set but the WebAssembly toolchain or its bundle is missing');

const FIXTURES = new URL('../tests/fixtures/python/', import.meta.url);
const CASES = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.py') && !f.startsWith('t9'))
  .map((f) => f.slice(0, -3))
  .sort();
const golden = (name: string) => readFileSync(new URL(`${name}.ino`, FIXTURES), 'utf8');

let tc: WasmToolchain;
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

describe.skipIf(!paths)('Python mode on the chip (§10.6)', () => {
  beforeAll(async () => {
    const fetchBytes = async (u: string) => new Uint8Array(readFileSync(u.startsWith('file:') ? new URL(u) : u));
    tc = new WasmToolchain({ toolsBase: pathToFileURL(paths!.toolsDir + '/').href, fetchBytes, importGlue: async (url) => (await import(url)).default });
    bundle = await loadBundle(paths!.bundleDir + '/', fetchBytes);
  });

  it('every golden sketch compiles without warnings and fits the UNO', async () => {
    for (const name of CASES) await compile(golden(name), `${name}.ino`);
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
