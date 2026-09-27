/**
 * Shapes of the two manifests the Upload feature reads at run time:
 *   public/toolchain/manifest.json         (tools/fetch-toolchain.mjs)
 *   public/toolchain/bundle/manifest.json  (tools/build-toolchain-bundle.mjs)
 */

/** One library precompiled into the bundle. */
export interface BundleLibrary {
  version: string;
  /** Path of the `.a` archive relative to the bundle folder, or null for header-only libraries. */
  archive: string | null;
  /** `-I` directories in the virtual FS the compiler sees. */
  includeDirs: string[];
  /** Header file names relative to the include root (what `#include <X.h>` resolves to). */
  headers: string[];
  /** Libraries this one needs (arduino-cli's `depends`). */
  deps: string[];
  licence?: string;
  source?: string;
  sha256?: string;
}

/** public/toolchain/bundle/manifest.json */
export interface BundleManifest {
  generatedBy: string;
  generatedAt: string;
  target: { board: string; mcu: string; fcpu: number; maxFlash: number; maxRam: number };
  precompiledWith: Record<string, unknown>;
  /** The exact arguments `avr-g++ -c <flags>` passes to cc1plus (from `avr-g++ -###`), grouped. */
  cc1plusArgs: { device: string[]; defines: string[]; includes: string[]; system: string[]; target: string[]; flags: string[] };
  asArgs: string[];
  ldArgs: string[];
  /** Path of core.a relative to the bundle folder. */
  core: string;
  /** System libraries and the linker script, name → relative path. */
  sys: Record<string, string>;
  headersPack: string;
  /** [virtual path, offset, length] into the headers pack. */
  headers: [string, number, number][];
  libraries: Record<string, BundleLibrary>;
  sha256?: Record<string, string>;
}

/** public/toolchain/manifest.json */
export interface ToolchainManifest {
  /** Format version of this manifest. */
  format: 1;
  /** Release tag the tools came from (`avr-toolchain-wasm-vX.Y.Z`) or 'local'. */
  release: string;
  source: string;
  tools: Record<string, { wasm: string; mjs: string; bytes: number; sha256: string }>;
  /** Relative path of the bundle manifest. */
  bundle: string;
  /** SHA-256 over every tool + bundle file: the Cache API key. */
  cacheKey: string;
  totalBytes: number;
}
