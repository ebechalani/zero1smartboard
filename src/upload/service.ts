/**
 * `UploadService`: the plain API the Upload dialog (and tests) call.
 *
 *   const support = await detectUploadSupport();      // Web Serial + wasm + module workers + toolchain manifest
 *   const service = new UploadService();
 *   await service.prepare(onProgress);                 // downloads/compiles the toolchain once (Cache API afterwards)
 *   const build = await service.build(source);        // { ok, hex, flashBytes, sizes, diagnostics, stderr }
 *   const port = await service.requestPort();          // inside the click handler (user gesture)
 *   await service.upload(build.hex, { port, onProgress, signal });
 *
 * The compiler runs in a module Web Worker (toolchain/worker.ts); the STK500
 * upload runs on the page over Web Serial (serial/webserial.ts). Everything
 * the dialog needs is behind the `UploadServiceLike` interface so the UI can
 * be tested with a fake.
 */
import type { BuildOutput, DownloadProgress, WorkerRequest, WorkerResponse } from './toolchain/protocol';
import type { ToolchainManifest } from './toolchain/types';
import { getWebSerial, requestBoardPort, uploadWithWebSerial, type WebSerialLike, type WebSerialPortLike } from './serial/webserial';
import type { UploadProgress, UploadResult } from './serial/uploader';
import type { TraceFn } from './serial/stk500';
import { UploadError } from './serial/errors';

export type { BuildOutput, DownloadProgress } from './toolchain/protocol';
export type { UploadProgress, UploadResult } from './serial/uploader';

/** Why the Upload feature is unavailable, when it is. */
export type UnsupportedReason = 'no-serial' | 'insecure-context' | 'no-wasm' | 'no-module-worker' | 'no-toolchain';

export interface UploadSupport {
  ok: boolean;
  reason?: UnsupportedReason;
  /** Plain-English explanation for the student ('' when ok). */
  message: string;
  manifest?: ToolchainManifest;
}

export const UNSUPPORTED_TEXT: Record<UnsupportedReason, string> = {
  'no-serial': 'This browser cannot send a program to the board over USB: uploading works in Chrome or Edge on a computer.',
  'insecure-context': 'Uploading needs a secure page (https:// or localhost).',
  'no-wasm': 'This browser cannot run the compiler (WebAssembly is disabled).',
  'no-module-worker': 'This browser is too old to run the compiler in the background. Update Chrome or Edge.',
  'no-toolchain': 'Upload to board is not available on this copy of the site: its compiler is not installed (no toolchain/manifest.json).',
};

/** Options for uploading a compiled sketch. */
export interface UploadOptions {
  /** A port from requestPort(); when absent, requestPort() is called first (needs a user gesture). */
  port?: WebSerialPortLike;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
  /** Protocol log lines ("sync @115200 reset 1 try 1: in sync", ...). */
  log?: (line: string) => void;
  trace?: TraceFn;
}

/** What the dialog needs from the service (UploadService implements it; tests use a fake). */
export interface UploadServiceLike {
  /** Download + compile the toolchain (once per page; later calls resolve immediately). */
  prepare(onProgress?: (p: DownloadProgress) => void): Promise<void>;
  /** Compile a sketch to Intel HEX. Never rejects for compile errors (ok: false); rejects when the worker itself fails. */
  build(source: string, fileName?: string): Promise<BuildOutput>;
  /** Show the browser's port chooser. Must be called from a click handler. */
  requestPort(): Promise<WebSerialPortLike>;
  /** Flash the HEX to the board (reset, sync, write, verify, run). */
  upload(hex: string, options?: UploadOptions): Promise<UploadResult>;
  /** Total download size of the toolchain, for the "about 6 MB" text (bytes on the wire are smaller: gzip). */
  readonly downloadBytes: number;
  /** Stop the worker. */
  dispose(): void;
}

/** True when this browser can run a module worker (`new Worker(url, { type: 'module' })`). */
export function supportsModuleWorkers(): boolean {
  if (typeof Worker === 'undefined') return false;
  let supported = false;
  const probe = {
    get type(): 'module' {
      supported = true;
      return 'module';
    },
  };
  try {
    const w = new Worker('data:,', probe);
    w.terminate();
  } catch {
    /* an old browser: options were ignored or the URL refused */
  }
  return supported;
}

/** The synchronous part of feature detection (everything but the manifest). */
export function browserSupportsUpload(serial: WebSerialLike | null = getWebSerial()): UploadSupport {
  const fail = (reason: UnsupportedReason): UploadSupport => ({ ok: false, reason, message: UNSUPPORTED_TEXT[reason] });
  // First: Chrome and Edge expose navigator.serial only on secure pages, so on a plain http:// copy
  // the missing serial would otherwise send a Chrome user off to "use Chrome or Edge".
  if ((globalThis as { isSecureContext?: boolean }).isSecureContext === false) return fail('insecure-context');
  if (!serial) return fail('no-serial');
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.instantiate !== 'function') return fail('no-wasm');
  if (!supportsModuleWorkers()) return fail('no-module-worker');
  return { ok: true, message: '' };
}

/** Absolute URL of the `toolchain/` folder next to the page (works from any sub-path: base './'). */
export function toolchainBaseUrl(base = import.meta.env?.BASE_URL ?? './'): string {
  const doc = typeof document !== 'undefined' ? document.baseURI : globalThis.location?.href ?? 'http://localhost/';
  return new URL(base.replace(/\/?$/, '/') + 'toolchain/', doc).href;
}

/** Fetch the toolchain manifest; null when the site was built without the toolchain. */
export async function fetchToolchainManifest(baseUrl = toolchainBaseUrl(), fetchFn: typeof fetch = fetch): Promise<ToolchainManifest | null> {
  try {
    const r = await fetchFn(baseUrl + 'manifest.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const m = (await r.json()) as ToolchainManifest;
    return m && m.format === 1 && m.tools && m.bundle ? m : null;
  } catch {
    return null;
  }
}

/** Feature detection: `'serial' in navigator` && WebAssembly && module workers && the toolchain manifest is present. */
export async function detectUploadSupport(options: { baseUrl?: string; serial?: WebSerialLike | null; fetch?: typeof fetch } = {}): Promise<UploadSupport> {
  const browser = browserSupportsUpload(options.serial === undefined ? getWebSerial() : options.serial);
  if (!browser.ok) return browser;
  const manifest = await fetchToolchainManifest(options.baseUrl, options.fetch);
  if (!manifest) return { ok: false, reason: 'no-toolchain', message: UNSUPPORTED_TEXT['no-toolchain'] };
  return { ok: true, message: '', manifest };
}

export interface UploadServiceOptions {
  /** The toolchain folder URL (default: `<site>/toolchain/`). */
  baseUrl?: string;
  /** The manifest, when detectUploadSupport() already fetched it. */
  manifest?: ToolchainManifest;
  /** How to create the worker (tests). */
  createWorker?: () => Worker;
  serial?: WebSerialLike | null;
  fetch?: typeof fetch;
}

const CHOOSER_FILTERS = [
  { usbVendorId: 0x1a86, usbProductId: 0x7523 }, // WCH CH340: the ZERO1 board
  { usbVendorId: 0x1a86, usbProductId: 0x55d4 }, // WCH CH9102
  { usbVendorId: 0x2341, usbProductId: 0x0043 }, // Arduino UNO R3
  { usbVendorId: 0x2341, usbProductId: 0x0001 }, // Arduino UNO
];

function defaultCreateWorker(): Worker {
  return new Worker(new URL('./toolchain/worker.ts', import.meta.url), { type: 'module', name: 'zero1-toolchain' });
}

/** The real service: a toolchain worker + Web Serial. */
export class UploadService implements UploadServiceLike {
  private readonly baseUrl: string;
  private readonly createWorker: () => Worker;
  private readonly serial: WebSerialLike | null;
  private readonly fetchFn: typeof fetch;
  private manifest: ToolchainManifest | undefined;
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (msg: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (p: DownloadProgress) => void }>();

  constructor(options: UploadServiceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? toolchainBaseUrl()).replace(/\/?$/, '/');
    this.manifest = options.manifest;
    this.createWorker = options.createWorker ?? defaultCreateWorker;
    this.serial = options.serial === undefined ? getWebSerial() : options.serial;
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  get downloadBytes(): number {
    return this.manifest?.totalBytes ?? 0;
  }

  private send(msg: WorkerRequest, onProgress?: (p: DownloadProgress) => void): Promise<WorkerResponse> {
    if (!this.worker) {
      this.worker = this.createWorker();
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
      this.worker.onerror = (e) => {
        const err = new Error(`The compiler could not start: ${e.message || 'worker error'}`);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
        this.ready = null;
      };
    }
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve, reject, onProgress });
      this.worker!.postMessage(msg);
    });
  }

  private onMessage(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      p.onProgress?.(msg.progress);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  }

  prepare(onProgress?: (p: DownloadProgress) => void): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const manifest = this.manifest ?? (await fetchToolchainManifest(this.baseUrl, this.fetchFn));
        if (!manifest) throw new Error(UNSUPPORTED_TEXT['no-toolchain']);
        this.manifest = manifest;
        // Only the tools the worker loads count for the progress bar (cc1 is shipped but unused).
        const sizes: Record<string, number> = {};
        for (const name of ['cc1plus', 'avr-as', 'avr-ld', 'avr-objcopy']) {
          const t = manifest.tools[name];
          if (t) sizes[t.wasm] = t.bytes;
        }
        await this.send(
          {
            type: 'init',
            id: this.nextId++,
            toolsBase: this.baseUrl + 'tools/',
            bundleBase: new URL(manifest.bundle, this.baseUrl).href.replace(/manifest\.json$/, ''),
            cacheKey: manifest.cacheKey,
            sizes,
          },
          onProgress,
        );
      })();
      this.ready.catch(() => {
        this.ready = null; // let the dialog retry
      });
    }
    return this.ready;
  }

  async build(source: string, fileName = 'sketch.ino'): Promise<BuildOutput> {
    await this.prepare();
    const r = await this.send({ type: 'build', id: this.nextId++, source, fileName });
    if (r.type !== 'result') throw new Error('unexpected worker reply');
    return r.result;
  }

  requestPort(): Promise<WebSerialPortLike> {
    if (!this.serial) return Promise.reject(new UploadError('UNSUPPORTED', UNSUPPORTED_TEXT['no-serial']));
    return requestBoardPort(this.serial, CHOOSER_FILTERS);
  }

  async upload(hex: string, options: UploadOptions = {}): Promise<UploadResult> {
    const port = options.port ?? (await this.requestPort());
    return uploadWithWebSerial(hex, { port, onProgress: options.onProgress, signal: options.signal, log: options.log, trace: options.trace });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) p.reject(new Error('disposed'));
    this.pending.clear();
  }
}

/** The chooser filters (exported for tests and docs). */
export const BOARD_USB_FILTERS = CHOOSER_FILTERS;
