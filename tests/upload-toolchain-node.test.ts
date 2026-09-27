/**
 * The in-browser compiler, run in Node: the WebAssembly tools + the prebuilt
 * bundle (exactly the worker's code path, with fs instead of fetch) compile the
 * blink example to the same HEX the feasibility spike produced (SHA-256 pinned).
 * Skips cleanly when the toolchain or the bundle is not built on this machine
 * (`npm run build` with ZERO1_TOOLCHAIN_DIR, or CI).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WasmToolchain } from '../src/upload/toolchain/wasm-toolchain';
import { buildSketch, elfSizes, hexDataBytes, loadBundle } from '../src/upload/toolchain/arduino-build';
import { toolchainPaths } from './fakes/upload/toolchain-paths';

const paths = toolchainPaths();
const BLINK_HEX_SHA256 = '196df0f8aa4a35ee6b61c164ad89981ca81da618d156adcae0d418303f416822'; // validation/hex-wasm/01_blink_red.hex of the spike

describe.skipIf(!paths)('wasm toolchain in Node', () => {
  it('compiles 01_blink_red.ino to the spike\'s HEX (SHA-256 pinned) and reports the sizes', async () => {
    const { toolsDir, bundleDir } = paths!;
    const fetchBytes = async (u: string) => new Uint8Array(readFileSync(u.startsWith('file:') ? new URL(u) : u));
    const tc = new WasmToolchain({
      toolsBase: pathToFileURL(toolsDir + '/').href,
      fetchBytes,
      importGlue: async (url) => (await import(url)).default,
    });
    const bundle = await loadBundle(bundleDir + '/', fetchBytes);
    const source = readFileSync(new URL('../src/examples/01_blink_red.ino', import.meta.url), 'utf8');
    const r = await buildSketch(tc, bundle, { source, fileName: '01_blink_red.ino' });
    if (!r.ok) throw new Error(`build failed at ${r.stage}:\n${r.stderr.join('\n')}`);
    expect(createHash('sha256').update(r.hex).digest('hex')).toBe(BLINK_HEX_SHA256);
    expect(r.flashBytes).toBe(hexDataBytes(r.hex));
    expect(r.flashBytes).toBeGreaterThan(1000);
    expect(r.fits).toBe(true);
    const sizes = elfSizes(r.elf);
    expect(sizes.flash).toBe(r.flashBytes);
    expect(sizes.ram).toBeGreaterThan(0);
    expect(sizes.ram).toBeLessThan(2048);
    expect(r.libraries).toEqual([]);
    expect(r.warnings).toEqual([]);
  }, 60_000);

  it('reports a compile error on the .ino line with a hint, and a link error for a missing loop()', async () => {
    const { toolsDir, bundleDir } = paths!;
    const fetchBytes = async (u: string) => new Uint8Array(readFileSync(u.startsWith('file:') ? new URL(u) : u));
    const tc = new WasmToolchain({ toolsBase: pathToFileURL(toolsDir + '/').href, fetchBytes, importGlue: async (url) => (await import(url)).default });
    const bundle = await loadBundle(bundleDir + '/', fetchBytes);
    const bad = await buildSketch(tc, bundle, { source: 'void setup() {\n  Servo s;\n}\nvoid loop() {}\n', fileName: 'sketch.ino' });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.stage).toBe('compile sketch');
    const err = bad.diagnostics.find((d) => d.severity === 'error')!;
    expect(err.line).toBe(2);
    expect(err.inSketch).toBe(true);
    expect(err.message).toMatch(/'Servo' was not declared|'Servo' does not name a type/);
    expect(err.hint).toContain('#include <Servo.h>');
    const noLoop = await buildSketch(tc, bundle, { source: 'void setup() {}\n', fileName: 'sketch.ino' });
    expect(noLoop.ok).toBe(false);
    if (noLoop.ok) return;
    expect(noLoop.stage).toBe('link');
    expect(noLoop.diagnostics.some((d) => d.message.includes("undefined reference to 'loop'") && d.hint?.includes('void loop()'))).toBe(true);
  }, 60_000);
});

/** Files exist check exported for other suites. */
export const hasToolchain = (): boolean => !!paths && existsSync(paths.bundleDir);
