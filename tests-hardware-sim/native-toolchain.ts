/**
 * The contingency of docs/PYTHON.md §10.6: the avr-g++ 7.3 installed on the machine (on CI the
 * `gcc-avr` / `binutils-avr` packages the workflows install for the toolchain bundle) behind the
 * one method of WasmToolchain that buildSketch() calls, `run(tool, args, setup, outputs)`. The
 * virtual files `setup` writes go into a temporary folder, the virtual paths of the arguments
 * (`/build/…`, `/sys/…`, `-L/sys`) point into it, and `outputs` are read back from it.
 *
 * Used by the Python-on-the-chip tests when the WebAssembly tools are not there (no toolchain
 * release yet, §0.1) but the bundle is (`npm run build` makes it from the same apt compiler), so
 * CI compiles the Python sketches at -Wall -Wextra and runs them on avr8js either way.
 * `ZERO1_TOOLCHAIN=native` prefers it even when the WebAssembly tools exist (to compare the two).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { EmscriptenFS, ToolName, ToolRunResult, WasmToolchain } from '../src/upload/toolchain/wasm-toolchain';
import { REPO_ROOT } from '../tests/fakes/upload/toolchain-paths';

/** What buildSketch() needs of a toolchain. */
export type SketchToolchain = Pick<WasmToolchain, 'run'>;

export class NativeToolchain implements SketchToolchain {
  constructor(private readonly programs: Readonly<Record<ToolName, string>>) {}

  /** The installed tools, or null when avr-g++ (and binutils-avr) are not on the PATH. */
  static find(): NativeToolchain | null {
    try {
      const cc1plus = execFileSync('avr-g++', ['-print-prog-name=cc1plus'], { encoding: 'utf8' }).trim();
      if (!existsSync(cc1plus)) return null;
      for (const tool of ['avr-as', 'avr-ld', 'avr-objcopy']) if (spawnSync(tool, ['--version']).status !== 0) return null;
      return new NativeToolchain({ cc1plus, 'avr-as': 'avr-as', 'avr-ld': 'avr-ld', 'avr-objcopy': 'avr-objcopy' });
    } catch {
      return null;
    }
  }

  async run(tool: ToolName, args: string[], setup?: (fs: EmscriptenFS) => void, outputs: string[] = []): Promise<ToolRunResult> {
    const t0 = performance.now();
    const root = mkdtempSync(join(tmpdir(), 'zero1-avr-'));
    const real = (path: string) => join(root, path);
    const fs: EmscriptenFS = {
      mkdir: (path) => mkdirSync(real(path), { recursive: true }),
      writeFile: (path, data) => {
        mkdirSync(dirname(real(path)), { recursive: true });
        writeFileSync(real(path), data);
      },
      readFile: (path) => new Uint8Array(readFileSync(real(path))),
    };
    try {
      setup?.(fs);
      const mapped = args.map((a) => (a.startsWith('/') ? real(a) : a.startsWith('-L/') ? `-L${real(a.slice(2))}` : a));
      const r = spawnSync(this.programs[tool], mapped, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, LC_ALL: 'C' } });
      const files: Record<string, Uint8Array> = {};
      for (const path of outputs) {
        try {
          files[path] = fs.readFile(path);
        } catch {
          /* missing output */
        }
      }
      // The messages name the virtual paths, as the WebAssembly tools do.
      const lines = (text: string | null) => (text ?? '').split('\n').filter((l) => l !== '').map((l) => l.split(root).join(''));
      const ms = performance.now() - t0;
      return {
        status: r.status ?? -1,
        stderr: [...lines(r.stderr), ...(r.error ? [String(r.error)] : [])],
        stdout: lines(r.stdout),
        files,
        peakMemBytes: 0,
        ms: { getModule: 0, instantiate: 0, fsSetup: 0, run: ms, total: ms },
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/** The native toolchain and the bundle's folder, when the bundle is built and avr-g++ is installed. */
export function nativeToolchain(): { tc: NativeToolchain; bundleDir: string } | null {
  const bundleDir = resolve(REPO_ROOT, 'public/toolchain/bundle');
  if (!existsSync(resolve(bundleDir, 'manifest.json'))) return null;
  const tc = NativeToolchain.find();
  return tc ? { tc, bundleDir } : null;
}
