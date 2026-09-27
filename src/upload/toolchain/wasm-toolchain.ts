/**
 * Runs the four WebAssembly tools of the ZERO1 AVR toolchain
 * (cc1plus = GCC 7.3.0, avr-as / avr-ld / avr-objcopy = binutils 2.42, built
 * by tools/avr-toolchain-wasm). Environment-agnostic: the same code runs in the
 * browser Web Worker (worker.ts) and in Node (tests, tools/). The host supplies:
 *   fetchBytes(url) -> Promise<Uint8Array>   (fs in Node, fetch() in browsers)
 *   toolsBase: URL/string of the folder holding <tool>.mjs + <tool>.wasm
 *   compileUrl(url) -> Promise<WebAssembly.Module>  (optional: streaming compile)
 *
 * Each tool run = a NEW WebAssembly instance (GCC and binutils are not
 * re-entrant after exit()), with its own MEMFS. The compiled
 * WebAssembly.Module is cached, so only the first run of a tool pays the
 * wasm compilation ("cold"); later runs only instantiate ("warm").
 *
 * Port of the feasibility spike's toolchain/lib/wasm-toolchain.mjs (logic unchanged).
 */

export const TOOLS = ['cc1plus', 'avr-as', 'avr-ld', 'avr-objcopy'] as const;
export type ToolName = (typeof TOOLS)[number];

/** The part of an Emscripten MEMFS the build uses. */
export interface EmscriptenFS {
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array | string): void;
  readFile(path: string): Uint8Array;
}

/** An instantiated Emscripten module (what the `.mjs` factory resolves to). */
export interface EmscriptenModule {
  FS: EmscriptenFS;
  HEAPU8?: Uint8Array;
  callMain(args: string[]): number | undefined;
}

export interface EmscriptenModuleOptions {
  noInitialRun: boolean;
  print(line: string): void;
  printErr(line: string): void;
  onMemoryGrowth?(bytes: number): void;
  instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void): object;
}

export type EmscriptenFactory = (options: EmscriptenModuleOptions) => Promise<EmscriptenModule>;

export interface ToolRunResult {
  status: number;
  stderr: string[];
  stdout: string[];
  files: Record<string, Uint8Array>;
  peakMemBytes: number;
  ms: { getModule: number; instantiate: number; fsSetup: number; run: number; total: number };
}

export interface WasmToolchainOptions {
  toolsBase: string | URL;
  fetchBytes: (url: string) => Promise<Uint8Array>;
  /** Optional: e.g. WebAssembly.compileStreaming(fetch(url)) in browsers. */
  compileUrl?: (url: string) => Promise<WebAssembly.Module>;
  /** Optional: how to load the `.mjs` glue (default: dynamic import of toolsBase + tool + '.mjs'). */
  importGlue?: (url: string) => Promise<EmscriptenFactory>;
  log?: (line: string) => void;
}

export interface ToolchainStats {
  compileModuleMs: Partial<Record<ToolName, number>>;
  fetchWasmMs: Partial<Record<ToolName, number>>;
  wasmBytes: Partial<Record<ToolName, number>>;
}

const now = (): number => (globalThis.performance ? performance.now() : Date.now());

async function defaultImportGlue(url: string): Promise<EmscriptenFactory> {
  const m = (await import(/* @vite-ignore */ url)) as { default: EmscriptenFactory };
  return m.default;
}

/** One toolchain: a `.mjs` factory + a compiled `WebAssembly.Module` per tool, run on demand. */
export class WasmToolchain {
  readonly toolsBase: string;
  private readonly fetchBytes: (url: string) => Promise<Uint8Array>;
  private readonly compileUrl: ((url: string) => Promise<WebAssembly.Module>) | undefined;
  private readonly importGlue: (url: string) => Promise<EmscriptenFactory>;
  private readonly log: (line: string) => void;
  private readonly factories = new Map<ToolName, Promise<EmscriptenFactory>>();
  private readonly modules = new Map<ToolName, Promise<WebAssembly.Module>>();
  readonly stats: ToolchainStats = { compileModuleMs: {}, fetchWasmMs: {}, wasmBytes: {} };

  constructor(options: WasmToolchainOptions) {
    this.toolsBase = String(options.toolsBase).replace(/\/?$/, '/');
    this.fetchBytes = options.fetchBytes;
    this.compileUrl = options.compileUrl;
    this.importGlue = options.importGlue ?? defaultImportGlue;
    this.log = options.log ?? (() => {});
  }

  /** The Emscripten factory of a tool (its `.mjs` glue), imported once. */
  factory(tool: ToolName): Promise<EmscriptenFactory> {
    let f = this.factories.get(tool);
    if (!f) {
      f = this.importGlue(this.toolsBase + tool + '.mjs');
      this.factories.set(tool, f);
    }
    return f;
  }

  /** Fetch + compile the tool's .wasm once (cold path). */
  module(tool: ToolName): Promise<WebAssembly.Module> {
    let m = this.modules.get(tool);
    if (!m) {
      m = (async () => {
        let t0 = now();
        if (this.compileUrl) {
          const mod = await this.compileUrl(this.toolsBase + tool + '.wasm');
          this.stats.compileModuleMs[tool] = now() - t0; // fetch + streaming compile, overlapped
          return mod;
        }
        const bytes = await this.fetchBytes(this.toolsBase + tool + '.wasm');
        this.stats.fetchWasmMs[tool] = now() - t0;
        this.stats.wasmBytes[tool] = bytes.byteLength;
        t0 = now();
        const mod = await WebAssembly.compile(bytes as BufferSource);
        this.stats.compileModuleMs[tool] = now() - t0;
        return mod;
      })();
      this.modules.set(tool, m);
    }
    return m;
  }

  /** Import the glue and compile the wasm of every tool (or the given ones). */
  async preload(tools: readonly ToolName[] = TOOLS): Promise<void> {
    await Promise.all(
      tools.map(async (t) => {
        await this.factory(t);
        await this.module(t);
      }),
    );
  }

  /**
   * Run one tool in a fresh instance.
   * @param setup   writes the inputs into the instance's MEMFS
   * @param outputs paths to read back after the run (missing ones are left out)
   */
  async run(tool: ToolName, args: string[], setup?: (fs: EmscriptenFS) => void, outputs: string[] = []): Promise<ToolRunResult> {
    const t0 = now();
    const factory = await this.factory(tool);
    const wasmModule = await this.module(tool);
    const t1 = now();
    const stderr: string[] = [];
    const stdout: string[] = [];
    let peak = 0;
    const mod = await factory({
      noInitialRun: true,
      print: (l) => stdout.push(l),
      printErr: (l) => stderr.push(l),
      onMemoryGrowth: (b) => {
        peak = Math.max(peak, b);
      },
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(wasmModule, imports).then((inst) => done(inst, wasmModule), (e) => stderr.push(String(e)));
        return {};
      },
    });
    const t2 = now();
    setup?.(mod.FS);
    const t3 = now();
    let status = 0;
    try {
      const r = mod.callMain(args);
      if (typeof r === 'number') status = r;
    } catch (e) {
      const st = (e as { status?: unknown } | null)?.status;
      if (typeof st === 'number') status = st;
      else {
        status = -1;
        stderr.push(String((e as { stack?: string } | null)?.stack ?? e));
      }
    }
    const t4 = now();
    const files: Record<string, Uint8Array> = {};
    for (const p of outputs) {
      try {
        files[p] = mod.FS.readFile(p);
      } catch {
        /* missing output */
      }
    }
    peak = Math.max(peak, mod.HEAPU8?.length ?? 0, 4 << 20);
    this.log(`${tool}: status ${status} in ${(now() - t0).toFixed(0)} ms`);
    return {
      status,
      stderr,
      stdout,
      files,
      peakMemBytes: peak,
      ms: { getModule: t1 - t0, instantiate: t2 - t1, fsSetup: t3 - t2, run: t4 - t3, total: now() - t0 },
    };
  }
}

/** `mkdir -p` in an Emscripten FS. */
export function mkdirp(fs: EmscriptenFS, dir: string): void {
  let cur = '';
  for (const part of dir.split('/').filter(Boolean)) {
    cur += '/' + part;
    try {
      fs.mkdir(cur);
    } catch {
      /* exists */
    }
  }
}

/** A file to place in the virtual FS: [absolute path, content]. */
export type VirtualFile = [string, Uint8Array | string];

/** Write files (creating their folders) into an Emscripten FS. */
export function writeFiles(fs: EmscriptenFS, files: Iterable<VirtualFile>): void {
  const made = new Set<string>();
  for (const [path, data] of files) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir && !made.has(dir)) {
      mkdirp(fs, dir);
      made.add(dir);
    }
    fs.writeFile(path, data);
  }
}
