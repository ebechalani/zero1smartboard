/**
 * Module Web Worker: the in-browser compile service.
 *   new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
 *
 * `init` downloads the four WebAssembly tools (WebAssembly.compileStreaming,
 * compiled once and kept as Modules) and the prebuilt bundle (core.a,
 * libraries, headers), through the Cache API so a second visit needs no
 * network, reporting progress; `build` compiles a sketch (arduino-build.ts).
 * Nothing here touches the DOM; the page never freezes while cc1plus runs.
 */
import { WasmToolchain, TOOLS, type ToolName } from './wasm-toolchain';
import { loadBundle, buildSketch, elfSizes, type Bundle } from './arduino-build';
import type { BuildOutput, DownloadProgress, WorkerRequest, WorkerResponse } from './protocol';

const CACHE_PREFIX = 'zero1-toolchain-';

const post = (msg: WorkerResponse): void => self.postMessage(msg);

interface Session {
  tc: WasmToolchain;
  bundle: Promise<Bundle>;
  toolsBase: string;
}

let session: Session | null = null;

/** Bytes loaded per file, summed for the progress bar. */
class Progress {
  private readonly loaded = new Map<string, number>();
  private readonly total: number;
  fromCache = true;
  constructor(
    private readonly id: number,
    private readonly sizes: Record<string, number>,
  ) {
    this.total = Object.values(sizes).reduce((a, b) => a + b, 0);
  }
  private sum(): number {
    let n = 0;
    for (const v of this.loaded.values()) n += v;
    return n;
  }
  report(stage: DownloadProgress['stage'], file: string, loadedBytes?: number): void {
    if (loadedBytes !== undefined) this.loaded.set(file, Math.min(loadedBytes, this.sizes[file] ?? loadedBytes));
    post({ type: 'progress', id: this.id, progress: { stage, file, loaded: this.sum(), total: this.total, fromCache: this.fromCache } });
  }
  done(file: string): void {
    this.loaded.set(file, this.sizes[file] ?? this.loaded.get(file) ?? 0);
  }
}

/** The Cache API bucket for this toolchain version (older buckets are deleted). */
async function openCache(cacheKey: string): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const name = CACHE_PREFIX + cacheKey;
    for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX) && k !== name) await caches.delete(k);
    return await caches.open(name);
  } catch {
    return null; // private mode / storage blocked: plain fetch
  }
}

/**
 * fetch() through the cache: a hit is returned as-is; a miss goes to the network,
 * is stored, and its body is counted for the progress bar as it streams in.
 */
async function cachedFetch(cache: Cache | null, url: string, file: string, progress: Progress): Promise<Response> {
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        progress.done(file);
        return hit;
      }
    } catch {
      /* fall through to the network */
    }
  }
  progress.fromCache = false;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  if (cache) {
    try {
      await cache.put(url, r.clone());
    } catch {
      /* quota / opaque: keep going without caching */
    }
  }
  if (!r.body) return r;
  let loaded = 0;
  let lastReport = 0;
  const counted = r.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        controller.enqueue(chunk);
        const t = Date.now();
        if (t - lastReport > 80) {
          lastReport = t;
          progress.report('download', file, loaded);
        }
      },
      flush() {
        progress.done(file);
        progress.report('download', file);
      },
    }),
  );
  return new Response(counted, { headers: r.headers, status: r.status });
}

async function compileWasm(cache: Cache | null, url: string, file: string, progress: Progress): Promise<WebAssembly.Module> {
  const r = await cachedFetch(cache, url, file, progress);
  // Streaming compile needs `Content-Type: application/wasm`; the static host may say otherwise.
  if (typeof WebAssembly.compileStreaming === 'function' && r.body) {
    try {
      return await WebAssembly.compileStreaming(new Response(r.body, { headers: { 'Content-Type': 'application/wasm' } }));
    } catch (e) {
      if (!(e instanceof TypeError)) throw e; // a CompileError is final
      // e.g. the body was already consumed by a failed streaming attempt: fall back below
      const again = await cachedFetch(cache, url, file, progress);
      return WebAssembly.compile(await again.arrayBuffer());
    }
  }
  return WebAssembly.compile(await r.arrayBuffer());
}

async function init(msg: Extract<WorkerRequest, { type: 'init' }>): Promise<void> {
  const t0 = performance.now();
  const progress = new Progress(msg.id, msg.sizes);
  const cache = await openCache(msg.cacheKey);
  const rel = (url: string): string => url.replace(/^.*\/toolchain\//, '');
  const fetchBytes = async (url: string): Promise<Uint8Array> => {
    const r = await cachedFetch(cache, url, rel(url), progress);
    return new Uint8Array(await r.arrayBuffer());
  };
  const tc = new WasmToolchain({
    toolsBase: msg.toolsBase,
    fetchBytes,
    compileUrl: (url) => compileWasm(cache, url, rel(url), progress),
  });
  const bundle = loadBundle(msg.bundleBase, fetchBytes);
  session = { tc, bundle, toolsBase: msg.toolsBase };
  progress.report('download', 'tools/cc1plus.wasm');
  await Promise.all([
    ...TOOLS.map(async (t: ToolName) => {
      await tc.factory(t);
      await tc.module(t);
      progress.report('compile', `tools/${t}.wasm`);
    }),
    bundle.then(() => progress.report('bundle', 'bundle/core.a')),
  ]);
  post({
    type: 'ready',
    id: msg.id,
    ms: performance.now() - t0,
    env: {
      crossOriginIsolated: self.crossOriginIsolated,
      streaming: typeof WebAssembly.compileStreaming === 'function',
      cache: cache !== null,
      fromCache: progress.fromCache,
      compileModuleMs: tc.stats.compileModuleMs,
      bundleLoadMs: (await bundle).loadMs,
    },
  });
}

async function build(msg: Extract<WorkerRequest, { type: 'build' }>): Promise<void> {
  if (!session) throw new Error('the toolchain was not initialised (send init first)');
  const bundle = await session.bundle;
  const t0 = performance.now();
  const r = await buildSketch(session.tc, bundle, { source: msg.source, fileName: msg.fileName });
  const wallMs = performance.now() - t0;
  const { maxFlash, maxRam } = bundle.manifest.target;
  const result: BuildOutput = r.ok
    ? {
        ok: true,
        hex: r.hex,
        flashBytes: r.flashBytes,
        sizes: (({ flash, ram }) => ({ flash, ram }))(elfSizes(r.elf)),
        maxFlash,
        maxRam,
        diagnostics: r.warnings,
        stderr: [],
        libraries: r.libraries,
        wallMs,
        timings: r.timings,
      }
    : { ok: false, stage: r.stage, maxFlash, maxRam, diagnostics: r.diagnostics, stderr: r.stderr, libraries: r.libraries, wallMs, timings: r.timings };
  post({ type: 'result', id: msg.id, result });
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  const run = msg.type === 'init' ? init(msg) : build(msg);
  run.catch((err: unknown) => post({ type: 'error', id: msg.id, message: String((err as { stack?: string } | null)?.stack ?? err) }));
};
