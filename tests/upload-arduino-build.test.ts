/**
 * The build pipeline (src/upload/toolchain/arduino-build.ts) against a fake
 * toolchain that records the tool invocations: library resolution from the
 * #includes (with declared dependencies), the cc1plus / as / ld / objcopy
 * argument lists and virtual files, failure reporting per stage, plus
 * elfSizes() on a real ELF and the ar archive writer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSketch, elfSizes, hexDataBytes, loadBundle, type Bundle } from '../src/upload/toolchain/arduino-build';
import { createArchive, definedSymbols } from '../src/upload/toolchain/ar';
import type { EmscriptenFS, ToolName, ToolRunResult, WasmToolchain } from '../src/upload/toolchain/wasm-toolchain';
import type { BundleManifest } from '../src/upload/toolchain/types';
import { fixture } from './fakes/upload/scenario';

const enc = new TextEncoder();

const MANIFEST: BundleManifest = {
  generatedBy: 'test',
  generatedAt: '',
  target: { board: 'arduino:avr:uno', mcu: 'atmega328p', fcpu: 16000000, maxFlash: 32256, maxRam: 2048 },
  precompiledWith: {},
  cc1plusArgs: { device: ['-imultilib', 'avr5'], defines: ['-DARDUINO=10819'], includes: ['-I', '/arduino/core'], system: ['-isystem', '/sys/avr/include'], target: ['-mmcu=avr5'], flags: ['-Os'] },
  asArgs: ['-mmcu=avr5'],
  ldArgs: ['-mavr5', '--gc-sections'],
  core: 'core.a',
  sys: { 'crtatmega328p.o': 'sys/crt.o', 'libc.a': 'sys/libc.a', 'libm.a': 'sys/libm.a', 'libatmega328p.a': 'sys/libdev.a', 'libgcc.a': 'sys/libgcc.a', 'avr5.xn': 'sys/avr5.xn' },
  headersPack: 'headers.bin',
  headers: [
    ['/arduino/core/Arduino.h', 0, 5],
    ['/libraries/Wire/src/Wire.h', 5, 4],
  ],
  libraries: {
    Wire: { version: '1.0', archive: 'libs/Wire.a', includeDirs: ['/libraries/Wire/src'], headers: ['Wire.h'], deps: [] },
    LiquidCrystal_I2C: { version: '1', archive: 'libs/LiquidCrystal_I2C.a', includeDirs: ['/libraries/LiquidCrystal_I2C'], headers: ['LiquidCrystal_I2C.h'], deps: ['Wire'] },
    EEPROM: { version: '2', archive: null, includeDirs: ['/libraries/EEPROM/src'], headers: ['EEPROM.h'], deps: [] },
  },
};

/** A bundle served from memory. */
async function fakeBundle(): Promise<{ bundle: Bundle; fetched: string[] }> {
  const files: Record<string, Uint8Array> = {
    'manifest.json': enc.encode(JSON.stringify(MANIFEST)),
    'headers.bin': enc.encode('ARDU;WIRE'),
    'core.a': enc.encode('CORE'),
    'sys/crt.o': enc.encode('crt'),
    'sys/libc.a': enc.encode('libc'),
    'sys/libm.a': enc.encode('libm'),
    'sys/libdev.a': enc.encode('libdev'),
    'sys/libgcc.a': enc.encode('libgcc'),
    'sys/avr5.xn': enc.encode('SECTIONS{}'),
    'libs/Wire.a': enc.encode('WIREA'),
    'libs/LiquidCrystal_I2C.a': enc.encode('LCDA'),
  };
  const fetched: string[] = [];
  const bundle = await loadBundle('mem://bundle/', async (url) => {
    const rel = url.replace('mem://bundle/', '');
    fetched.push(rel);
    if (!(rel in files)) throw new Error(`no such file ${rel}`);
    return files[rel];
  });
  return { bundle, fetched };
}

interface Call {
  tool: ToolName;
  args: string[];
  files: Record<string, string>;
}

/** A WasmToolchain stand-in: every tool succeeds and produces canned outputs unless told to fail. */
function fakeToolchain(failing: Partial<Record<ToolName, string[]>> = {}): { tc: WasmToolchain; calls: Call[] } {
  const calls: Call[] = [];
  const tc = {
    async run(tool: ToolName, args: string[], setup?: (fs: EmscriptenFS) => void, outputs: string[] = []): Promise<ToolRunResult> {
      const written: Record<string, string> = {};
      const fs: EmscriptenFS = {
        mkdir() {},
        writeFile(p, d) {
          written[p] = typeof d === 'string' ? d : new TextDecoder().decode(d);
        },
        readFile() {
          return new Uint8Array();
        },
      };
      setup?.(fs);
      calls.push({ tool, args, files: written });
      const stderr = failing[tool];
      if (stderr) return { status: 1, stderr, stdout: [], files: {}, peakMemBytes: 0, ms: { getModule: 0, instantiate: 0, fsSetup: 0, run: 0, total: 0 } };
      const out: Record<string, Uint8Array> = {};
      for (const o of outputs) out[o] = enc.encode(o.endsWith('.hex') ? ':0400000012345678E4\n:00000001FF\n' : `<${tool}>`);
      return { status: 0, stderr: [], stdout: [], files: out, peakMemBytes: 0, ms: { getModule: 0, instantiate: 0, fsSetup: 0, run: 0, total: 0 } };
    },
  } as unknown as WasmToolchain;
  return { tc, calls };
}

describe('loadBundle', () => {
  it('reads the manifest, slices the headers pack and prefetches core + system libraries', async () => {
    const { bundle, fetched } = await fakeBundle();
    expect(bundle.headers).toEqual([
      ['/arduino/core/Arduino.h', enc.encode('ARDU;')],
      ['/libraries/Wire/src/Wire.h', enc.encode('WIRE')],
    ]);
    expect(Object.keys(bundle.sys).sort()).toEqual(['avr5.xn', 'core', 'crtatmega328p.o', 'libatmega328p.a', 'libc.a', 'libgcc.a', 'libm.a']);
    expect(fetched).not.toContain('libs/Wire.a'); // library archives are fetched on demand
  });
});

describe('buildSketch', () => {
  it('runs cc1plus → as → ld → objcopy with the manifest arguments and only the core', async () => {
    const { bundle } = await fakeBundle();
    const { tc, calls } = fakeToolchain();
    const r = await buildSketch(tc, bundle, { source: 'void setup() {}\nvoid loop() {}\n', fileName: 'blink.ino' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(calls.map((c) => c.tool)).toEqual(['cc1plus', 'avr-as', 'avr-ld', 'avr-objcopy']);
    const cc = calls[0];
    expect(cc.args).toEqual(['-quiet', '-imultilib', 'avr5', '-DARDUINO=10819', '-I', '/arduino/core', '-isystem', '/sys/avr/include', '/build/sketch.ino.cpp', '-mmcu=avr5', '-quiet', '-dumpbase', 'sketch.ino.cpp', '-auxbase-strip', '/build/out.o', '-Os', '-w', '-o', '/build/out.s']);
    expect(cc.files['/build/sketch.ino.cpp']).toContain('#line 1 "blink.ino"');
    expect(cc.files['/arduino/core/Arduino.h']).toBe('ARDU;');
    expect(calls[1].args).toEqual(['-mmcu=avr5', '-o', '/build/out.o', '/build/in.s']);
    const ld = calls[2];
    expect(ld.args).toEqual(['-mavr5', '--gc-sections', '-o', '/build/sketch.elf', '/sys/crtatmega328p.o', '-L/sys', '/build/sketch.o', '--start-group', '/sys/core.a', '--end-group', '-lm', '--start-group', '-lgcc', '-lm', '-lc', '-latmega328p', '--end-group']);
    expect(ld.files['/ldscripts/avr5.xn']).toBe('SECTIONS{}');
    expect(calls[3].args).toEqual(['-O', 'ihex', '-R', '.eeprom', '/build/sketch.elf', '/build/sketch.hex']);
    expect(r.libraries).toEqual([]);
    expect(r.flashBytes).toBe(4);
    expect(r.hex).toContain(':0400000012345678E4');
  });

  it('resolves libraries from #include (plus declared dependencies) into -I flags and link inputs', async () => {
    const { bundle, fetched } = await fakeBundle();
    const { tc, calls } = fakeToolchain();
    const r = await buildSketch(tc, bundle, { source: '#include <LiquidCrystal_I2C.h>\n#include <EEPROM.h>\nvoid setup() {}\nvoid loop() {}\n' });
    expect(r.ok).toBe(true);
    expect(r.libraries).toEqual(['LiquidCrystal_I2C', 'Wire', 'EEPROM']);
    const cc = calls[0].args.join(' ');
    expect(cc).toContain('-I /libraries/LiquidCrystal_I2C -I /libraries/Wire/src -I /libraries/EEPROM/src');
    const ld = calls[2];
    expect(ld.args.slice(ld.args.indexOf('--start-group'), ld.args.indexOf('--end-group') + 1)).toEqual(['--start-group', '/build/libs/LiquidCrystal_I2C.a', '/build/libs/Wire.a', '/sys/core.a', '--end-group']);
    expect(fetched).toContain('libs/LiquidCrystal_I2C.a');
    expect(fetched).toContain('libs/Wire.a'); // EEPROM is header-only: no archive
  });

  it('reports the failing stage with parsed diagnostics and the raw output', async () => {
    const { bundle } = await fakeBundle();
    const { tc } = fakeToolchain({ cc1plus: ["sketch.ino:2:3: error: 'x' was not declared in this scope", '   x = 1;'] });
    const r = await buildSketch(tc, bundle, { source: 'void setup() {\n  x = 1;\n}\nvoid loop() {}\n', fileName: 'sketch.ino' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe('compile sketch');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ line: 2, column: 3, severity: 'error', inSketch: true });
    expect(r.stderr).toHaveLength(2);
    const { tc: tc2 } = fakeToolchain({ 'avr-ld': ["main.cpp:(.text.main+0x1a): undefined reference to `loop'"] });
    const r2 = await buildSketch(tc2, bundle, { source: 'void setup() {}\n' });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.stage).toBe('link');
    expect(r2.diagnostics[0].hint).toContain('void loop()');
  });
});

describe('elfSizes / hexDataBytes', () => {
  it('reads .text/.data/.bss of a real avr-gcc ELF like avr-size', () => {
    const elf = new Uint8Array(readFileSync(fixture('blink.elf')));
    const s = elfSizes(elf);
    expect(s.sections['.text']).toBeGreaterThan(0);
    expect(s.flash).toBe(s.sections['.text'] + (s.sections['.data'] ?? 0));
    expect(s.flash).toBe(hexDataBytes(readFileSync(fixture('blink.hex'), 'utf8')));
    expect(s.ram).toBe((s.sections['.data'] ?? 0) + (s.sections['.bss'] ?? 0) + (s.sections['.noinit'] ?? 0));
  });
});

describe('ar', () => {
  it('lists the defined global symbols of an ELF object and writes a GNU archive with a symbol index', () => {
    // A relocatable object is needed; the ELF executable fixture has a symbol table too and serves the parser.
    const elf = new Uint8Array(readFileSync(fixture('blink.elf')));
    const syms = definedSymbols(elf);
    expect(syms).toContain('main');
    const ar = createArchive([['blink.o', elf]]);
    const text = new TextDecoder('latin1').decode(ar.subarray(0, 8));
    expect(text).toBe('!<arch>\n');
    expect(new TextDecoder('latin1').decode(ar.subarray(8, 24)).trimEnd()).toBe('/');
    expect(new TextDecoder('latin1').decode(ar)).toContain('blink.o/');
    expect(ar.length % 2).toBe(0);
  });
});
