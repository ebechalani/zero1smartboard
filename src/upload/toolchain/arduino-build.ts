/**
 * Arduino sketch build on top of the WASM tools. Environment-agnostic: the
 * browser worker (worker.ts) and the Node tests run exactly this code.
 * Pipeline (what the browser does on "Upload"):
 *   .ino --inoToCpp--> sketch.ino.cpp --cc1plus.wasm--> .s --avr-as.wasm--> .o
 *   [+ user libraries compiled from source the same way]
 *   avr-ld.wasm: crt + sketch.o + lib objs + prebuilt lib archives + core.a + libm/libgcc/libc/libatmega328p
 *   avr-objcopy.wasm -O ihex -R .eeprom  -> Intel HEX
 *
 * Port of the feasibility spike's toolchain/lib/arduino-build.mjs (logic unchanged).
 */
import { inoToCpp, includedHeaders } from './ino';
import { writeFiles, mkdirp, type EmscriptenFS, type VirtualFile, type WasmToolchain, type ToolRunResult } from './wasm-toolchain';
import { createArchive } from './ar';
import { parseDiagnostics, type Diagnostic } from './diagnostics';
import type { BundleManifest } from './types';

const now = (): number => (globalThis.performance ? performance.now() : Date.now());
const td = new TextDecoder();

export type FetchBytes = (url: string) => Promise<Uint8Array>;

/** The prebuilt bundle, loaded: manifest, headers and the archives every link needs. */
export interface Bundle {
  base: string;
  manifest: BundleManifest;
  /** [virtual path, bytes] of every header the compiler may include. */
  headers: VirtualFile[];
  /** core.a + the system libraries, by manifest.sys key (and "core"). */
  sys: Record<string, Uint8Array>;
  /** Fetch (once) any other bundle file by its relative path. */
  file(rel: string): Promise<Uint8Array>;
  loadMs: number;
}

/** Loads the prebuilt bundle (manifest + headers pack + archives) through fetchBytes. */
export async function loadBundle(baseUrl: string, fetchBytes: FetchBytes): Promise<Bundle> {
  const base = String(baseUrl).replace(/\/?$/, '/');
  const t0 = now();
  const manifest = JSON.parse(td.decode(await fetchBytes(base + 'manifest.json'))) as BundleManifest;
  const pack = await fetchBytes(base + manifest.headersPack);
  const headers: VirtualFile[] = manifest.headers.map(([p, off, len]) => [p, pack.subarray(off, off + len)]);
  const cache = new Map<string, Promise<Uint8Array>>();
  const file = (rel: string): Promise<Uint8Array> => {
    let p = cache.get(rel);
    if (!p) {
      p = fetchBytes(base + rel);
      cache.set(rel, p);
    }
    return p;
  };
  // system libs + core are needed by every link: fetch them up front
  const sys: Record<string, Uint8Array> = {};
  await Promise.all(
    [...Object.entries(manifest.sys), ['core', manifest.core] as [string, string]].map(async ([k, rel]) => {
      sys[k] = await file(rel);
    }),
  );
  return { base, manifest, headers, sys, file, loadMs: now() - t0 };
}

/** Number of data bytes in an Intel HEX text (= what the Arduino IDE reports as sketch size). */
export function hexDataBytes(hex: string): number {
  let n = 0;
  for (const l of hex.split(/\r?\n/)) if (l.startsWith(':') && l.slice(7, 9) === '00') n += parseInt(l.slice(1, 3), 16);
  return n;
}

/** A library the student ships with the sketch, compiled from source in WASM. */
export interface UserLibrary {
  name: string;
  /** Paths relative to the library root ("src/Foo.h" or "Foo.h"). */
  files: [string, Uint8Array | string][];
}

export interface BuildOptions {
  source: string;
  fileName?: string;
  userLibs?: UserLibrary[];
  /** Compile the core from source in WASM instead of using core.a (tests only). */
  wasmCore?: VirtualFile[];
  /** Pass -g to cc1plus (Arduino does; it does not change the HEX). */
  debug?: boolean;
  /** Keep the intermediate .s / .o files in the result. */
  keep?: boolean;
  /**
   * Tests only (docs/PYTHON.md §10.6): 'all' compiles the sketch itself with -Wall -Wextra instead
   * of -w, so `warnings` lists what GCC says about it. Libraries and the core stay at -w.
   */
  warnings?: 'none' | 'all';
}

export interface StepTiming {
  unit: string;
  cc1plus: ToolRunResult['ms'];
  as: ToolRunResult['ms'];
  totalMs: number;
}

export interface BuildTimings {
  steps: StepTiming[];
  preprocessMs?: number;
  sketchMs?: number;
  userLibsMs?: number;
  wasmCoreMs?: number;
  coreFailures?: { file: string; stderr: string[] }[];
  fetchLibArchivesMs?: number;
  link?: ToolRunResult['ms'];
  linkMs?: number;
  objcopy?: ToolRunResult['ms'];
  objcopyMs?: number;
  totalMs?: number;
}

interface BuildCommon {
  /** Prototypes inserted by the .ino preprocessing. */
  prototypes: string[];
  /** The C++ translation unit that was compiled. */
  cpp: string;
  /** Libraries linked (prebuilt names and "user:<name>"). */
  libraries: string[];
  timings: BuildTimings;
  memory: Record<string, number>;
  keep: Record<string, Uint8Array>;
}

export interface BuildSuccess extends BuildCommon {
  ok: true;
  hex: string;
  elf: Uint8Array;
  flashBytes: number;
  fits: boolean;
  warnings: Diagnostic[];
}

export interface BuildFailure extends BuildCommon {
  ok: false;
  stage: string;
  diagnostics: Diagnostic[];
  stderr: string[];
}

export type BuildResult = BuildSuccess | BuildFailure;

/** Compile + link one sketch with the WASM tools against the prebuilt bundle. */
export async function buildSketch(tc: Pick<WasmToolchain, 'run'>, bundle: Bundle, opts: BuildOptions): Promise<BuildResult> {
  const { manifest } = bundle;
  const A = manifest.cc1plusArgs;
  const fileName = opts.fileName || 'sketch.ino';
  const T: BuildTimings = { steps: [] };
  const mem: Record<string, number> = {};
  const stderrAll: string[] = [];
  const keep: Record<string, Uint8Array> = {};
  const tStart = now();

  // 1. .ino -> .cpp
  let t = now();
  const { cpp, prototypes } = inoToCpp(opts.source, fileName);
  T.preprocessMs = now() - t;

  // 2. library resolution (like arduino-cli: #include <X.h> -> library containing X.h, + declared deps)
  const userLibs = opts.userLibs ?? [];
  const byHeader = new Map<string, string>();
  for (const ul of userLibs) for (const [p] of ul.files) if (/\.(h|hpp)$/.test(p)) byHeader.set(p.replace(/^src\//, ''), 'user:' + ul.name);
  for (const [name, lib] of Object.entries(manifest.libraries)) for (const h of lib.headers) if (!byHeader.has(h)) byHeader.set(h, name);
  const used: string[] = [];
  const add = (n: string) => {
    if (used.includes(n)) return;
    used.push(n);
    if (!n.startsWith('user:')) for (const d of manifest.libraries[n].deps) add(d);
  };
  const scanSources = [
    cpp,
    ...userLibs.flatMap((ul) =>
      ul.files.filter(([p]) => /\.(c|cpp|h|hpp)$/.test(p)).map(([, d]) => (typeof d === 'string' ? d : td.decode(d))),
    ),
  ];
  for (const s of scanSources) for (const h of includedHeaders(s)) if (byHeader.has(h)) add(byHeader.get(h)!);
  // prebuilt libs that user libs include (e.g. a user lib using Wire)
  const prebuiltLibs = used.filter((n) => !n.startsWith('user:'));

  // virtual FS layout for cc1plus
  const libIncludes = prebuiltLibs.flatMap((n) => manifest.libraries[n].includeDirs.flatMap((d) => ['-I', d]));
  const userLibFiles: VirtualFile[] = [];
  const userIncludes: string[] = [];
  for (const ul of userLibs) {
    const root = `/userlib/${ul.name}`;
    const hasSrc = ul.files.some(([p]) => p.startsWith('src/'));
    userIncludes.push('-I', hasSrc ? root + '/src' : root);
    for (const [p, d] of ul.files) userLibFiles.push([`${root}/${p}`, d]);
  }
  const headerFiles: VirtualFile[] = [...bundle.headers, ...userLibFiles.filter(([p]) => !/\.(c|cpp|S)$/.test(p))];
  const baseArgs = [...A.device, ...A.defines, ...A.includes, ...userIncludes, ...libIncludes, ...A.system];

  type UnitResult = { ok: true; obj: Uint8Array } | { ok: false; stderr: string[] };

  async function compileUnit(label: string, vpath: string, data: Uint8Array | string, kind: 'S' | 'c' | 'cpp', warn = ['-w']): Promise<UnitResult> {
    const s0 = now();
    const out = '/build/out.s';
    let args: string[];
    const dbg = opts.debug ? ['-g'] : [];
    if (kind === 'S') args = ['-E', '-lang-asm', '-D__ASSEMBLER__', '-quiet', ...baseArgs, vpath, ...A.target, ...dbg, '-o', out];
    else if (kind === 'c') {
      // HACK: there is no C front end in the browser. Compile C as C++ with __cplusplus undefined (headers take
      // their C paths) and the whole file wrapped in extern "C" (unmangled symbols); -fpermissive (in A.flags)
      // turns C-only implicit conversions into warnings. Not a faithful C compiler (sizeof('a'), inline, ...).
      data = `extern "C" {\n#line 1 "${vpath}"\n` + (typeof data === 'string' ? data : td.decode(data)) + '\n}\n';
      args = ['-quiet', '-U__cplusplus', '-D_Bool=bool', ...baseArgs, vpath, ...A.target, '-quiet', '-dumpbase', vpath.split('/').pop()!, '-auxbase-strip', '/build/out.o', ...dbg, ...A.flags, '-w', '-o', out];
    } else {
      args = ['-quiet', ...baseArgs, vpath, ...A.target, '-quiet', '-dumpbase', vpath.split('/').pop()!, '-auxbase-strip', '/build/out.o', ...dbg, ...A.flags, ...warn, '-o', out];
    }
    const c = await tc.run(
      'cc1plus',
      args,
      (fs: EmscriptenFS) => {
        mkdirp(fs, '/build');
        writeFiles(fs, [...headerFiles, [vpath, data]]);
      },
      [out],
    );
    mem.cc1plus = Math.max(mem.cc1plus ?? 0, c.peakMemBytes);
    stderrAll.push(...c.stderr);
    if (c.status !== 0 || !c.files[out]) return { ok: false, stderr: c.stderr };
    const a = await tc.run('avr-as', [...manifest.asArgs, '-o', '/build/out.o', '/build/in.s'], (fs) => writeFiles(fs, [['/build/in.s', c.files[out]]]), ['/build/out.o']);
    mem['avr-as'] = Math.max(mem['avr-as'] ?? 0, a.peakMemBytes);
    stderrAll.push(...a.stderr);
    T.steps.push({ unit: label, cc1plus: c.ms, as: a.ms, totalMs: now() - s0 });
    if (opts.keep) {
      keep[label + '.s'] = c.files[out];
      if (a.files['/build/out.o']) keep[label + '.o'] = a.files['/build/out.o'];
    }
    if (a.status !== 0 || !a.files['/build/out.o']) return { ok: false, stderr: a.stderr };
    return { ok: true, obj: a.files['/build/out.o'] };
  }

  const fail = (stage: string, stderr: string[]): BuildFailure => ({
    ok: false,
    stage,
    diagnostics: parseDiagnostics(stderr, fileName),
    stderr,
    prototypes,
    cpp,
    libraries: used,
    timings: { ...T, totalMs: now() - tStart },
    memory: mem,
    keep,
  });

  // 3. compile the sketch
  t = now();
  const sk = await compileUnit('sketch.ino.cpp', '/build/sketch.ino.cpp', cpp, 'cpp', opts.warnings === 'all' ? ['-Wall', '-Wextra'] : ['-w']);
  T.sketchMs = now() - t;
  if (!sk.ok) return fail('compile sketch', sk.stderr);

  // 4. compile user libraries (and optionally the core) from source in WASM
  const extraObjs: [string, Uint8Array][] = [];
  t = now();
  for (const [vpath, data] of userLibFiles) {
    const kind = vpath.endsWith('.S') ? 'S' : vpath.endsWith('.c') ? 'c' : vpath.endsWith('.cpp') ? 'cpp' : null; // .c goes through cc1plus too
    if (!kind) continue;
    const r = await compileUnit(vpath.slice(1).replace(/\//g, '_'), vpath, data, kind);
    if (!r.ok) return fail(`compile ${vpath}`, r.stderr);
    extraObjs.push([`/build/obj/${extraObjs.length}.o`, r.obj]);
  }
  T.userLibsMs = now() - t;
  let coreObjs: [string, Uint8Array][] | null = null;
  if (opts.wasmCore) {
    t = now();
    coreObjs = [];
    T.coreFailures = [];
    for (const [vpath, data] of opts.wasmCore) {
      const kind = vpath.endsWith('.S') ? 'S' : vpath.endsWith('.c') ? 'c' : 'cpp';
      const r = await compileUnit('core_' + vpath.split('/').pop()!, vpath, data, kind);
      if (!r.ok) {
        T.coreFailures.push({ file: vpath, stderr: r.stderr.slice(0, 6) });
        continue;
      }
      coreObjs.push([`/build/core/${coreObjs.length}.o`, r.obj]);
    }
    T.wasmCoreMs = now() - t;
    if (T.coreFailures.length) return fail('compile core in WASM', T.coreFailures.flatMap((f) => [`[${f.file}]`, ...f.stderr]));
  }

  // 5. link
  t = now();
  const libArchives: [string, Uint8Array][] = [];
  for (const n of prebuiltLibs) {
    const a = manifest.libraries[n].archive;
    if (a) libArchives.push([`/build/libs/${n}.a`, await bundle.file(a)]);
  }
  T.fetchLibArchivesMs = now() - t;
  // core compiled in WASM: pack the objects into core.a (JS ar, no avr-ar.wasm) so the link is the same as with the prebuilt core.a
  const coreInputs: [string, Uint8Array][] = coreObjs
    ? [['/build/core.a', createArchive(coreObjs.map(([, d], i) => [`c${i}.o`, d]))]]
    : [['/sys/core.a', bundle.sys.core]];
  if (coreObjs && opts.keep) keep['core.a'] = coreInputs[0][1];
  const ldArgs = [
    ...manifest.ldArgs,
    '-o',
    '/build/sketch.elf',
    '/sys/crtatmega328p.o',
    '-L/sys',
    '/build/sketch.o',
    ...extraObjs.map(([p]) => p),
    '--start-group',
    ...libArchives.map(([p]) => p),
    ...coreInputs.map(([p]) => p),
    '--end-group',
    '-lm',
    '--start-group',
    '-lgcc',
    '-lm',
    '-lc',
    '-latmega328p',
    '--end-group',
  ];
  const l = await tc.run(
    'avr-ld',
    ldArgs,
    (fs) =>
      writeFiles(fs, [
        ['/ldscripts/avr5.xn', bundle.sys['avr5.xn']],
        ['/sys/crtatmega328p.o', bundle.sys['crtatmega328p.o']],
        ['/sys/libc.a', bundle.sys['libc.a']],
        ['/sys/libm.a', bundle.sys['libm.a']],
        ['/sys/libgcc.a', bundle.sys['libgcc.a']],
        ['/sys/libatmega328p.a', bundle.sys['libatmega328p.a']],
        ['/build/sketch.o', sk.obj],
        ...extraObjs,
        ...libArchives,
        ...coreInputs,
      ]),
    ['/build/sketch.elf'],
  );
  mem['avr-ld'] = l.peakMemBytes;
  stderrAll.push(...l.stderr);
  T.link = l.ms;
  T.linkMs = now() - t;
  if (l.status !== 0 || !l.files['/build/sketch.elf']) return fail('link', l.stderr);
  const elf = l.files['/build/sketch.elf'];

  // 6. objcopy -> Intel HEX
  t = now();
  const o = await tc.run('avr-objcopy', ['-O', 'ihex', '-R', '.eeprom', '/build/sketch.elf', '/build/sketch.hex'], (fs) => writeFiles(fs, [['/build/sketch.elf', elf]]), ['/build/sketch.hex']);
  mem['avr-objcopy'] = o.peakMemBytes;
  T.objcopy = o.ms;
  T.objcopyMs = now() - t;
  if (o.status !== 0 || !o.files['/build/sketch.hex']) return fail('objcopy', o.stderr);
  const hex = td.decode(o.files['/build/sketch.hex']);
  T.totalMs = now() - tStart;
  const flash = hexDataBytes(hex);
  return {
    ok: true,
    hex,
    elf,
    flashBytes: flash,
    fits: flash <= manifest.target.maxFlash,
    libraries: used,
    prototypes,
    cpp,
    warnings: parseDiagnostics(stderrAll, fileName),
    timings: T,
    memory: mem,
    keep,
  };
}

/** Section sizes from an ELF32 image (what `avr-size -A` + Arduino's size regex report). */
export function elfSizes(elf: Uint8Array): { flash: number; ram: number; sections: Record<string, number> } {
  const dv = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  const shoff = dv.getUint32(0x20, true);
  const shentsize = dv.getUint16(0x2e, true);
  const shnum = dv.getUint16(0x30, true);
  const shstrndx = dv.getUint16(0x32, true);
  const sh = (i: number) => {
    const b = shoff + i * shentsize;
    return { name: dv.getUint32(b, true), offset: dv.getUint32(b + 16, true), size: dv.getUint32(b + 20, true) };
  };
  const strtab = sh(shstrndx);
  const nameAt = (o: number) => {
    let s = '';
    for (let i = strtab.offset + o; elf[i]; i++) s += String.fromCharCode(elf[i]);
    return s;
  };
  const sec: Record<string, number> = {};
  for (let i = 0; i < shnum; i++) {
    const s = sh(i);
    sec[nameAt(s.name)] = s.size;
  }
  const g = (k: string) => sec[k] || 0;
  return { flash: g('.text') + g('.data') + g('.bootloader'), ram: g('.data') + g('.bss') + g('.noinit'), sections: sec };
}
