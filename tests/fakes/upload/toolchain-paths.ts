/**
 * Where the WebAssembly tools and the prebuilt bundle are on this machine, for
 * the Node-side toolchain tests: $ZERO1_TOOLCHAIN_DIR (or public/toolchain/tools/
 * after tools/fetch-toolchain.mjs) and public/toolchain/bundle/ (after
 * tools/build-toolchain-bundle.mjs). Null when either is missing: the tests skip.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export interface ToolchainPaths {
  toolsDir: string;
  bundleDir: string;
}

export const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export function toolchainPaths(): ToolchainPaths | null {
  const candidates = [process.env.ZERO1_TOOLCHAIN_DIR, resolve(REPO_ROOT, 'public/toolchain/tools')].filter((p): p is string => !!p);
  const toolsDir = candidates.find((d) => ['cc1plus', 'avr-as', 'avr-ld', 'avr-objcopy'].every((t) => existsSync(resolve(d, `${t}.wasm`)) && existsSync(resolve(d, `${t}.mjs`))));
  const bundleDir = resolve(REPO_ROOT, 'public/toolchain/bundle');
  if (!toolsDir || !existsSync(resolve(bundleDir, 'manifest.json'))) return null;
  return { toolsDir, bundleDir };
}
