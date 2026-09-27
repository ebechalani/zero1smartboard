#!/usr/bin/env node
/**
 * BUILD-TIME step: put the WebAssembly AVR toolchain (5 × .wasm + 5 × .mjs,
 * built by tools/avr-toolchain-wasm) into public/toolchain/tools/ and write
 * public/toolchain/manifest.json, which the site reads at run time to decide
 * whether "Upload to board" is available.
 *
 * Where the files come from, in order:
 *   1. $ZERO1_TOOLCHAIN_DIR             a local folder with the files + SHA256SUMS (dev machine, CI cache)
 *   2. $ZERO1_TOOLCHAIN_URL             base URL of the release assets (…/releases/download/<tag>/)
 *   3. $ZERO1_TOOLCHAIN_TAG             a release tag of $ZERO1_TOOLCHAIN_REPO (default ebechalani/zero1smartboard)
 *   4. the newest GitHub release of that repo whose tag starts with avr-toolchain-wasm-v
 * Downloads are verified against the release's SHA256SUMS and cached in
 * node_modules/.cache/zero1-toolchain/<tag>/.
 *
 *   node tools/fetch-toolchain.mjs [--strict] [--quiet]
 *
 * Without --strict, an unavailable toolchain (no release yet, no network, no
 * bundle) prints a warning, removes public/toolchain/manifest.json and exits
 * 0: the site still builds and deploys, without the Upload feature.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/toolchain');
const TOOLS_DIR = join(OUT, 'tools');
const MANIFEST = join(OUT, 'manifest.json');
const BUNDLE_MANIFEST = join(OUT, 'bundle/manifest.json');
const CACHE = join(ROOT, 'node_modules/.cache/zero1-toolchain');
export const TOOL_NAMES = ['cc1plus', 'cc1', 'avr-as', 'avr-ld', 'avr-objcopy'];
export const TOOL_FILES = TOOL_NAMES.flatMap((t) => [`${t}.wasm`, `${t}.mjs`]);
const REPO = process.env.ZERO1_TOOLCHAIN_REPO || 'ebechalani/zero1smartboard';
const TAG_PREFIX = 'avr-toolchain-wasm-v';

const argv = process.argv.slice(2);
const opt = { strict: argv.includes('--strict'), quiet: argv.includes('--quiet') };
const log = (...a) => {
  if (!opt.quiet) console.log('[toolchain]', ...a);
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function giveUp(why) {
  console.error(`[toolchain] ${why}`);
  if (opt.strict) process.exit(1);
  rmSync(MANIFEST, { force: true });
  console.error('[toolchain] WARNING: public/toolchain/manifest.json removed; the site builds without "Upload to board".');
  process.exit(0);
}

/** name -> sha256 from a SHA256SUMS text ("<hex>  <file>" lines). */
function parseSums(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+?)\s*$/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

function verifyDir(dir, sums) {
  for (const f of TOOL_FILES) {
    const p = join(dir, f);
    if (!existsSync(p)) return `${f} missing in ${dir}`;
    if (sums[f] && sha256(readFileSync(p)) !== sums[f]) return `${f}: SHA-256 mismatch against SHA256SUMS`;
    if (!sums[f]) return `${f} not listed in SHA256SUMS`;
  }
  return null;
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'zero1smartboard-build' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function download(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': 'zero1smartboard-build' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

/** Newest release tagged avr-toolchain-wasm-v* (GitHub API), or null. */
async function latestReleaseTag() {
  const releases = JSON.parse(await fetchText(`https://api.github.com/repos/${REPO}/releases?per_page=30`));
  const tagged = releases.filter((r) => typeof r.tag_name === 'string' && r.tag_name.startsWith(TAG_PREFIX) && !r.draft);
  if (!tagged.length) return null;
  tagged.sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
  return tagged[0].tag_name;
}

/** Resolve the source folder holding the 10 files + SHA256SUMS. Returns { dir, release, source }. */
async function locate() {
  const local = process.env.ZERO1_TOOLCHAIN_DIR;
  if (local) {
    const dir = resolve(local);
    const sumsFile = join(dir, 'SHA256SUMS');
    if (!existsSync(sumsFile)) throw new Error(`${sumsFile} not found`);
    const err = verifyDir(dir, parseSums(readFileSync(sumsFile, 'utf8')));
    if (err) throw new Error(err);
    return { dir, release: process.env.ZERO1_TOOLCHAIN_TAG || 'local', source: `ZERO1_TOOLCHAIN_DIR=${dir}` };
  }
  let base = process.env.ZERO1_TOOLCHAIN_URL;
  let tag = process.env.ZERO1_TOOLCHAIN_TAG || '';
  if (!base) {
    tag ||= await latestReleaseTag();
    if (!tag) throw new Error(`no release tagged ${TAG_PREFIX}* in ${REPO} yet`);
    base = `https://github.com/${REPO}/releases/download/${tag}/`;
  }
  base = base.replace(/\/?$/, '/');
  const key = tag || sha256(base).slice(0, 16);
  const dir = join(CACHE, key);
  mkdirSync(dir, { recursive: true });
  const sumsFile = join(dir, 'SHA256SUMS');
  const sumsText = await fetchText(base + 'SHA256SUMS');
  writeFileSync(sumsFile, sumsText);
  const sums = parseSums(sumsText);
  if (verifyDir(dir, sums) === null) {
    log(`using cached ${dir}`);
  } else {
    for (const f of TOOL_FILES) {
      const dest = join(dir, f);
      if (existsSync(dest) && sums[f] && sha256(readFileSync(dest)) === sums[f]) continue;
      log(`downloading ${base}${f}`);
      await download(base + f, dest);
    }
    const err = verifyDir(dir, sums);
    if (err) throw new Error(err);
  }
  try {
    writeFileSync(join(dir, 'SOURCES.txt'), await fetchText(base + 'SOURCES.txt'));
  } catch {
    /* optional */
  }
  return { dir, release: tag || base, source: base };
}

async function main() {
  let src;
  try {
    src = await locate();
  } catch (e) {
    giveUp(`toolchain unavailable: ${e.message}`);
  }
  mkdirSync(TOOLS_DIR, { recursive: true });
  const sums = parseSums(readFileSync(join(src.dir, 'SHA256SUMS'), 'utf8'));
  const tools = {};
  let totalBytes = 0;
  for (const t of TOOL_NAMES) {
    for (const f of [`${t}.wasm`, `${t}.mjs`]) {
      const dest = join(TOOLS_DIR, f);
      if (!existsSync(dest) || sha256(readFileSync(dest)) !== sums[f]) copyFileSync(join(src.dir, f), dest);
    }
    const wasmBytes = statSync(join(TOOLS_DIR, `${t}.wasm`)).size;
    const mjsBytes = statSync(join(TOOLS_DIR, `${t}.mjs`)).size;
    tools[t] = { wasm: `tools/${t}.wasm`, mjs: `tools/${t}.mjs`, bytes: wasmBytes, sha256: sums[`${t}.wasm`], mjsSha256: sums[`${t}.mjs`] };
    if (t !== 'cc1') totalBytes += wasmBytes + mjsBytes; // cc1 is shipped for completeness but never loaded by the worker
  }
  for (const f of ['SHA256SUMS', 'SOURCES.txt']) if (existsSync(join(src.dir, f))) copyFileSync(join(src.dir, f), join(TOOLS_DIR, f));

  if (!existsSync(BUNDLE_MANIFEST)) giveUp('public/toolchain/bundle/manifest.json missing: run tools/build-toolchain-bundle.mjs first (needs gcc-avr)');
  const bundle = JSON.parse(readFileSync(BUNDLE_MANIFEST, 'utf8'));
  const bundleFiles = Object.keys(bundle.sha256 ?? {}).sort();
  const bundleBytes = bundleFiles.reduce((n, f) => n + statSync(join(OUT, 'bundle', f)).size, 0) + statSync(BUNDLE_MANIFEST).size;
  const cacheKey = sha256(
    [...TOOL_NAMES.map((t) => `${t}:${sums[`${t}.wasm`]}:${sums[`${t}.mjs`]}`), ...bundleFiles.map((f) => `${f}:${bundle.sha256[f]}`), `manifest:${sha256(readFileSync(BUNDLE_MANIFEST))}`].join('\n'),
  ).slice(0, 32);
  const manifest = {
    format: 1,
    release: src.release,
    source: src.source,
    repo: REPO,
    tools,
    bundle: 'bundle/manifest.json',
    bundleBytes,
    cacheKey,
    totalBytes: totalBytes + bundleBytes,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  log(`ready: ${src.release} from ${src.source}; ${(manifest.totalBytes / 1e6).toFixed(1)} MB raw (tools + bundle), cache key ${cacheKey}`);
}

await main();
