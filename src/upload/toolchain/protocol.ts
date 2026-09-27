/**
 * Messages between the page (service.ts) and the toolchain Web Worker (worker.ts).
 * Everything crossing the boundary is structured-cloneable JSON + Uint8Array.
 */
import type { Diagnostic } from './diagnostics';
import type { BuildTimings } from './arduino-build';

/** Page → worker. */
export type WorkerRequest =
  | {
      type: 'init';
      id: number;
      /** Absolute URL of the folder holding <tool>.mjs / <tool>.wasm. */
      toolsBase: string;
      /** Absolute URL of the folder holding bundle/manifest.json. */
      bundleBase: string;
      /** Cache API bucket name suffix (changes when the toolchain or bundle changes). */
      cacheKey: string;
      /** Expected size of every file, for the progress bar (URL path relative to toolchain/ → bytes). */
      sizes: Record<string, number>;
    }
  | { type: 'build'; id: number; source: string; fileName: string };

/** What the page shows while the compiler is fetched and compiled. */
export interface DownloadProgress {
  /** 'download' while bytes arrive, 'compile' while the wasm modules compile, 'bundle' while the core/libraries load. */
  stage: 'download' | 'compile' | 'bundle';
  /** File currently transferring (relative path). */
  file: string;
  /** Bytes received so far, all files together. */
  loaded: number;
  /** Bytes expected, all files together. */
  total: number;
  /** True when the files came from the browser cache (no network). */
  fromCache: boolean;
}

/** The outcome of one build, as the page receives it. */
export interface BuildOutput {
  ok: boolean;
  /** Intel HEX text (success only). */
  hex?: string;
  /** Bytes of flash the sketch uses (success only) = the Arduino IDE's "Sketch uses X bytes". */
  flashBytes?: number;
  /** ELF section sizes: `flash` (.text+.data) and `ram` (.data+.bss) as avr-size reports them. */
  sizes?: { flash: number; ram: number };
  maxFlash: number;
  maxRam: number;
  /** Where it failed: 'compile sketch', 'link', ... (failure only). */
  stage?: string;
  /** Parsed errors/warnings (failures: the errors; successes: the warnings). */
  diagnostics: Diagnostic[];
  /** Raw compiler/linker output. */
  stderr: string[];
  /** Libraries linked. */
  libraries: string[];
  /** Wall time of the build in the worker. */
  wallMs: number;
  timings?: BuildTimings;
}

/** Worker → page. */
export type WorkerResponse =
  | { type: 'progress'; id: number; progress: DownloadProgress }
  | { type: 'ready'; id: number; ms: number; env: Record<string, unknown> }
  | { type: 'result'; id: number; result: BuildOutput }
  | { type: 'error'; id: number; message: string };
