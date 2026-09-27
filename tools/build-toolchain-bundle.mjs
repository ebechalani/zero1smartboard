#!/usr/bin/env node
/**
 * BUILD-TIME step (CI / `npm run build`, never in the browser): precompile the
 * Arduino AVR core 1.8.6 and the student libraries with the native avr-gcc
 * 7.3.0 (the same GCC version as cc1plus.wasm), using the official
 * platform.txt flags WITHOUT -flto (the WASM linker cannot do LTO), and pack
 * everything the in-browser compiler needs into public/toolchain/bundle/:
 *
 *   manifest.json      versions, SHA-256s, the exact cc1plus/as/ld arguments, library table, header index
 *   headers.bin        every header the compiler may include, concatenated (index in the manifest)
 *   core.a             ArduinoCore-avr cores/arduino (debug info stripped)
 *   libs/<Name>.a      one archive per library
 *   sys/               crtatmega328p.o, libc.a, libm.a, libatmega328p.a, libgcc.a, avr5.xn (avr-libc / gcc)
 *   NOTICES.md         licence notices (copied from public/THIRD_PARTY_NOTICES.md)
 *
 * Sources are pinned by git tag + commit (SOURCES below) and cloned from
 * GitHub into node_modules/.cache/zero1-arduino-sources/ (or taken from
 * $ZERO1_ARDUINO_SOURCES_DIR/<name>, e.g. a vendored checkout). Our own
 * MIT-licensed LiquidCrystal_I2C and NewPing live in tools/arduino-libs/.
 *
 *   node tools/build-toolchain-bundle.mjs [--out public/toolchain/bundle] [--strict] [--quiet]
 *
 * Without --strict a missing avr-gcc or an unreachable GitHub only prints a
 * warning and exits 0 (the site then builds without the Upload feature).
 * Needs: gcc-avr 7.3.x, avr-libc, binutils-avr, git.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = { out: join(ROOT, 'public/toolchain/bundle'), strict: false, quiet: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') opt.out = resolve(argv[++i]);
  else if (a === '--strict') opt.strict = true;
  else if (a === '--quiet') opt.quiet = true;
  else {
    console.error(`unknown option ${a}`);
    process.exit(2);
  }
}
const log = (...a) => {
  if (!opt.quiet) console.log('[bundle]', ...a);
};
const giveUp = (why) => {
  console.error(`[bundle] ${why}`);
  if (opt.strict) process.exit(1);
  console.error('[bundle] WARNING: no toolchain bundle built; the site will not offer "Upload to board".');
  process.exit(0);
};

// ---------------------------------------------------------------------------
// Pinned sources (versions = what the Arduino Library Manager serves, 2026-09)
// ---------------------------------------------------------------------------
export const SOURCES = {
  'ArduinoCore-avr': { url: 'https://github.com/arduino/ArduinoCore-avr', tag: '1.8.6', commit: '42fa4a1ea1b1b11d1cc0a60298e529d37f9d14bd', licence: 'LGPL-2.1-or-later' },
  Servo: { url: 'https://github.com/arduino-libraries/Servo', tag: '1.3.0', commit: '2862ad9864d0dda5669b264857deafbba624940d', licence: 'LGPL-2.1-or-later' },
  'DHT-sensor-library': { url: 'https://github.com/adafruit/DHT-sensor-library', tag: '1.4.7', commit: 'f7d625462e6033f373e51f8c67f88fc429535b47', licence: 'MIT' },
  Adafruit_Sensor: { url: 'https://github.com/adafruit/Adafruit_Sensor', tag: '1.1.15', commit: '0a9127a1e886ff1adb4c1b6f5958b24108d55aa6', licence: 'Apache-2.0' },
  Adafruit_NeoPixel: { url: 'https://github.com/adafruit/Adafruit_NeoPixel', tag: '1.15.5', commit: 'd514fc3beae85dd4c2b19781b93faa47bd6e996f', licence: 'LGPL-3.0-or-later' },
};

/** name -> { source, subdir?, deps, licence }; header-only libraries get no archive. */
export const LIBRARIES = {
  Wire: { source: 'ArduinoCore-avr', subdir: 'libraries/Wire', deps: [], licence: 'LGPL-2.1-or-later' },
  SPI: { source: 'ArduinoCore-avr', subdir: 'libraries/SPI', deps: [], licence: 'GPL-2.0-or-later OR LGPL-2.1-or-later' },
  EEPROM: { source: 'ArduinoCore-avr', subdir: 'libraries/EEPROM', deps: [], licence: 'LGPL-2.1-or-later' },
  SoftwareSerial: { source: 'ArduinoCore-avr', subdir: 'libraries/SoftwareSerial', deps: [], licence: 'LGPL-2.1-or-later' },
  Servo: { source: 'Servo', deps: [], licence: 'LGPL-2.1-or-later' },
  LiquidCrystal_I2C: { local: 'tools/arduino-libs/LiquidCrystal_I2C', deps: ['Wire'], licence: 'MIT' },
  Adafruit_Sensor: { source: 'Adafruit_Sensor', deps: [], licence: 'Apache-2.0' },
  DHT: { source: 'DHT-sensor-library', deps: ['Adafruit_Sensor'], licence: 'MIT' },
  Adafruit_NeoPixel: { source: 'Adafruit_NeoPixel', deps: [], licence: 'LGPL-3.0-or-later' },
  NewPing: { local: 'tools/arduino-libs/NewPing', deps: [], licence: 'MIT' },
};

// Official flags, ArduinoCore-avr 1.8.6 platform.txt + boards.txt (uno), minus -flto:
//   compiler.c.flags   = -c -g -Os -w -std=gnu11 -ffunction-sections -fdata-sections -MMD -flto -fno-fat-lto-objects
//   compiler.cpp.flags = -c -g -Os -w -std=gnu++11 -fpermissive -fno-exceptions -ffunction-sections -fdata-sections -fno-threadsafe-statics -Wno-error=narrowing -MMD -flto
//   compiler.S.flags   = -c -g -x assembler-with-cpp -flto -MMD
//   -mmcu=atmega328p -DF_CPU=16000000L -DARDUINO=10819 -DARDUINO_AVR_UNO -DARDUINO_ARCH_AVR
const MCU = 'atmega328p';
const DEFINES = ['-DF_CPU=16000000L', '-DARDUINO=10819', '-DARDUINO_AVR_UNO', '-DARDUINO_ARCH_AVR'];
const C_FLAGS = ['-c', '-g', '-Os', '-w', '-std=gnu11', '-ffunction-sections', '-fdata-sections'];
const CPP_FLAGS = ['-c', '-g', '-Os', '-w', '-std=gnu++11', '-fpermissive', '-fno-exceptions', '-ffunction-sections', '-fdata-sections', '-fno-threadsafe-statics', '-Wno-error=narrowing'];
const S_FLAGS = ['-c', '-g', '-x', 'assembler-with-cpp'];
const EXPECTED_GCC = '7.3.0';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr || r.stdout}`);
  return r.stdout;
}
const have = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const isSource = (f) => ['.c', '.cpp', '.S'].includes(extname(f));
const isHeader = (f) => ['.h', '.hpp', '.hh', '.inc'].includes(extname(f)) || f.endsWith('/new');
const SKIP_DIRS = new Set(['.git', '.github', 'examples', 'extras', 'test', 'tests', 'docs']);

function walk(dir, recursive) {
  const out = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (recursive && !SKIP_DIRS.has(e)) out.push(...walk(p, true));
    } else out.push(p);
  }
  return out;
}

/** Library layout: 1.5 format (src/ recursive) or legacy flat (root + utility/). */
function libraryLayout(root) {
  const src = join(root, 'src');
  if (existsSync(src) && statSync(src).isDirectory()) return { srcRoot: src, includeDirs: [src], files: walk(src, true) };
  const files = walk(root, false);
  const util = join(root, 'utility');
  if (existsSync(util)) files.push(...walk(util, false));
  return { srcRoot: root, includeDirs: [root], files };
}

/** Where the checkout of a pinned source is (cloning it when needed); throws when unavailable. */
function sourceDir(name) {
  const s = SOURCES[name];
  const vendored = process.env.ZERO1_ARDUINO_SOURCES_DIR && join(process.env.ZERO1_ARDUINO_SOURCES_DIR, name);
  if (vendored && existsSync(vendored)) {
    const rev = safeRev(vendored);
    if (rev && rev !== s.commit) log(`WARNING: ${vendored} is at ${rev.slice(0, 12)}, pinned ${s.tag} is ${s.commit.slice(0, 12)}`);
    return vendored;
  }
  const cacheRoot = join(ROOT, 'node_modules/.cache/zero1-arduino-sources');
  const dir = join(cacheRoot, `${name}@${s.tag}`);
  if (existsSync(join(dir, '.git')) && safeRev(dir) === s.commit) return dir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(cacheRoot, { recursive: true });
  log(`cloning ${s.url} @ ${s.tag}`);
  sh('git', ['clone', '--quiet', '--depth', '1', '--branch', s.tag, s.url, dir], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 600_000 });
  const rev = safeRev(dir);
  if (rev !== s.commit) throw new Error(`${name} ${s.tag}: expected commit ${s.commit}, got ${rev} (tag moved?)`);
  return dir;
}
function safeRev(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------
for (const tool of ['avr-gcc', 'avr-g++', 'avr-ar', 'avr-strip', 'git']) if (!have(tool)) giveUp(`${tool} not found (apt-get install gcc-avr avr-libc binutils-avr git)`);
const gccVersion = sh('avr-gcc', ['-dumpversion']).trim();
if (gccVersion !== EXPECTED_GCC) log(`WARNING: avr-gcc ${gccVersion}, expected ${EXPECTED_GCC} (the browser compiler is GCC ${EXPECTED_GCC})`);
const gccInclude = sh('avr-gcc', ['-print-file-name=include']).trim();
const gccIncludeFixed = sh('avr-gcc', ['-print-file-name=include-fixed']).trim();
const libgcc = resolve(sh('avr-gcc', [`-mmcu=${MCU}`, '-print-libgcc-file-name']).trim());
const libc = resolve(sh('avr-gcc', [`-mmcu=${MCU}`, '-print-file-name=libc.a']).trim());
const avrLibDir = dirname(libc); // .../avr/lib/avr5
const avrInclude = resolve(avrLibDir, '../../include'); // .../avr/include
const ldscript = resolve(avrLibDir, '../ldscripts/avr5.xn');
for (const p of [gccInclude, gccIncludeFixed, libgcc, libc, avrInclude, ldscript]) if (!existsSync(p)) giveUp(`missing ${p} (is avr-libc installed?)`);

let checkouts;
try {
  checkouts = Object.fromEntries(Object.keys(SOURCES).map((n) => [n, sourceDir(n)]));
} catch (e) {
  giveUp(`could not fetch the Arduino sources: ${e.message.split('\n')[0]}`);
}
const CORE_ROOT = checkouts['ArduinoCore-avr'];

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------
const OUT = opt.out;
const TMP = join(ROOT, 'node_modules/.cache/zero1-bundle-obj');
rmSync(OUT, { recursive: true, force: true });
rmSync(TMP, { recursive: true, force: true });
for (const d of [OUT, join(OUT, 'libs'), join(OUT, 'sys'), TMP]) mkdirSync(d, { recursive: true });
const t0 = performance.now();

const coreInc = ['-I', join(CORE_ROOT, 'cores/arduino'), '-I', join(CORE_ROOT, 'variants/standard')];
function compile(src, obj, includes) {
  const common = [`-mmcu=${MCU}`, ...DEFINES, ...includes, src, '-o', obj];
  if (src.endsWith('.c')) sh('avr-gcc', [...C_FLAGS, ...common]);
  else if (src.endsWith('.S')) sh('avr-gcc', [...S_FLAGS, ...common]);
  else sh('avr-g++', [...CPP_FLAGS, ...common]);
}
function archive(out, objs) {
  sh('avr-ar', ['rcs', out, ...objs]);
  sh('avr-strip', ['--strip-debug', out]); // debug info is useless in the browser; symbols/relocs kept
}

// ---- core ----
const coreObjs = [];
mkdirSync(join(TMP, 'core'), { recursive: true });
const coreSources = walk(join(CORE_ROOT, 'cores/arduino'), true).filter(isSource);
for (const src of coreSources) {
  const obj = join(TMP, 'core', basename(src) + '.o');
  compile(src, obj, coreInc);
  coreObjs.push(obj);
}
archive(join(OUT, 'core.a'), coreObjs);
log(`core: ${coreSources.length} files`);

// ---- libraries ----
const libraries = {};
const libRoots = {};
for (const [name, lib] of Object.entries(LIBRARIES)) {
  const root = lib.local ? join(ROOT, lib.local) : join(checkouts[lib.source], lib.subdir ?? '');
  libRoots[name] = root;
}
for (const [name, lib] of Object.entries(LIBRARIES)) {
  const root = libRoots[name];
  const { srcRoot, includeDirs, files } = libraryLayout(root);
  const depInc = [];
  const seen = new Set();
  (function addDeps(n) {
    for (const d of LIBRARIES[n].deps) {
      if (seen.has(d)) continue;
      seen.add(d);
      depInc.push(...libraryLayout(libRoots[d]).includeDirs.flatMap((x) => ['-I', x]));
      addDeps(d);
    }
  })(name);
  const objs = [];
  mkdirSync(join(TMP, name), { recursive: true });
  for (const src of files.filter(isSource)) {
    const obj = join(TMP, name, relative(srcRoot, src).replace(/\//g, '_') + '.o');
    compile(src, obj, [...coreInc, ...includeDirs.flatMap((d) => ['-I', d]), ...depInc]);
    objs.push(obj);
  }
  const vroot = `/libraries/${name}`;
  let version = '';
  try {
    version = readFileSync(join(root, 'library.properties'), 'utf8').match(/^version=(.*)$/m)[1].trim();
  } catch {
    version = lib.source ? `${SOURCES[lib.source].tag} (${lib.source})` : '';
  }
  const srcHash = createHash('sha256');
  for (const f of files) srcHash.update(relative(root, f)).update('\0').update(readFileSync(f)).update('\0');
  libraries[name] = {
    version,
    archive: objs.length ? `libs/${name}.a` : null,
    includeDirs: includeDirs.map((d) => vroot + (relative(root, d) ? '/' + relative(root, d) : '')),
    headers: files.filter(isHeader).map((f) => relative(srcRoot, f)),
    deps: lib.deps,
    licence: lib.licence,
    source: lib.local ? `${lib.local} (this repository)` : `${SOURCES[lib.source].url}/tree/${SOURCES[lib.source].tag}${lib.subdir ? '/' + lib.subdir : ''} @ ${SOURCES[lib.source].commit}`,
    sourceSha256: srcHash.digest('hex'),
  };
  if (objs.length) archive(join(OUT, 'libs', `${name}.a`), objs);
  log(`library ${name} ${version}: ${objs.length} objects`);
}

// ---- headers pack ----
const headerFiles = []; // [virtualPath, hostPath]
function addTree(hostDir, vdir, keep = () => true) {
  for (const e of readdirSync(hostDir).sort()) {
    const p = join(hostDir, e);
    if (statSync(p).isDirectory()) {
      if (e !== '.git' && e !== 'examples') addTree(p, `${vdir}/${e}`, keep);
    } else if (keep(p)) headerFiles.push([`${vdir}/${e}`, p]);
  }
}
const ioKeep = (p) => !/\/avr\/io[^/]*\.h$/.test(p) || /\/avr\/(io|iom328p)\.h$/.test(p); // device headers: only the ATmega328P one
addTree(gccInclude, '/sys/gcc/include');
addTree(gccIncludeFixed, '/sys/gcc/include-fixed', (p) => !p.endsWith('README'));
addTree(avrInclude, '/sys/avr/include', ioKeep);
addTree(join(CORE_ROOT, 'cores/arduino'), '/arduino/core', isHeader);
addTree(join(CORE_ROOT, 'variants/standard'), '/arduino/variant', isHeader);
for (const name of Object.keys(libraries)) {
  const root = libRoots[name];
  const { srcRoot, files } = libraryLayout(root);
  for (const f of files.filter(isHeader)) headerFiles.push([`/libraries/${name}${srcRoot === root ? '' : '/src'}/${relative(srcRoot, f)}`, f]);
}
const chunks = [];
const index = [];
let off = 0;
for (const [v, p] of headerFiles) {
  const b = readFileSync(p);
  index.push([v, off, b.length]);
  chunks.push(b);
  off += b.length;
}
writeFileSync(join(OUT, 'headers.bin'), Buffer.concat(chunks));

// ---- system libs + linker script ----
const sys = {
  'crtatmega328p.o': join(avrLibDir, 'crtatmega328p.o'),
  'libc.a': libc,
  'libm.a': join(avrLibDir, 'libm.a'),
  'libatmega328p.a': join(avrLibDir, 'libatmega328p.a'),
  'libgcc.a': libgcc,
  'avr5.xn': ldscript,
};
for (const [k, v] of Object.entries(sys)) copyFileSync(v, join(OUT, 'sys', k));
const notices = join(ROOT, 'public/THIRD_PARTY_NOTICES.md');
if (existsSync(notices)) copyFileSync(notices, join(OUT, 'NOTICES.md'));

// ---- manifest ----
const files = {};
for (const rel of ['core.a', 'headers.bin', ...Object.keys(sys).map((k) => `sys/${k}`), ...Object.values(libraries).map((l) => l.archive).filter(Boolean)]) {
  files[rel] = sha256(readFileSync(join(OUT, rel)));
}
const manifest = {
  generatedBy: 'tools/build-toolchain-bundle.mjs',
  generatedAt: new Date().toISOString(),
  target: { board: 'arduino:avr:uno', mcu: MCU, fcpu: 16000000, maxFlash: 32256, maxRam: 2048 },
  precompiledWith: {
    gcc: gccVersion,
    binutils: sh('avr-ld', ['--version']).split('\n')[0],
    core: `ArduinoCore-avr ${SOURCES['ArduinoCore-avr'].tag} (${SOURCES['ArduinoCore-avr'].commit})`,
    cFlags: [...C_FLAGS, `-mmcu=${MCU}`, ...DEFINES],
    cppFlags: [...CPP_FLAGS, `-mmcu=${MCU}`, ...DEFINES],
    lto: false,
  },
  // what the browser passes to cc1plus.wasm = what `avr-g++ -c <cppFlags>` passes to cc1plus (from `avr-g++ -###`)
  cc1plusArgs: {
    device: ['-imultilib', 'avr5', '-D__AVR_ATmega328P__', '-D__AVR_DEVICE_NAME__=atmega328p'],
    defines: DEFINES,
    includes: ['-I', '/arduino/core', '-I', '/arduino/variant'],
    system: ['-isystem', '/sys/gcc/include', '-isystem', '/sys/gcc/include-fixed', '-isystem', '/sys/avr/include'],
    target: ['-mn-flash=1', '-mno-skip-bug', '-mmcu=avr5'],
    flags: ['-Os', '-Wno-error=narrowing', '-std=gnu++11', '-fpermissive', '-fno-exceptions', '-ffunction-sections', '-fdata-sections', '-fno-threadsafe-statics', '-fno-rtti', '-fno-enforce-eh-specs'],
  },
  asArgs: ['-mmcu=avr5', '-mno-skip-bug'],
  ldArgs: ['-mavr5', '-Tdata', '0x800100', '--gc-sections'],
  core: 'core.a',
  sys: Object.fromEntries(Object.keys(sys).map((k) => [k, `sys/${k}`])),
  headersPack: 'headers.bin',
  headers: index,
  libraries,
  sha256: files,
  sources: SOURCES,
  buildMs: Math.round(performance.now() - t0),
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));
rmSync(TMP, { recursive: true, force: true });
const size = (p) => statSync(join(OUT, p)).size;
log(
  JSON.stringify({
    out: relative(ROOT, OUT),
    buildMs: manifest.buildMs,
    headers: index.length,
    headersBytes: off,
    coreBytes: size('core.a'),
    libs: Object.fromEntries(Object.entries(libraries).map(([k, v]) => [k, v.archive ? size(v.archive) : 0])),
  }),
);
