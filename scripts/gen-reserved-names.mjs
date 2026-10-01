#!/usr/bin/env node
/**
 * Writes src/python/reserved-names.ts: the names a Python program cannot keep in the generated
 * Arduino sketch (docs/PYTHON.md §2.14). The translator appends '_' to such a name (`B1` → `B1_`,
 * `square` → `square_`).
 *
 * Run it after changing the toolchain bundle or the libraries (the result is committed):
 *
 *   node scripts/gen-reserved-names.mjs           writes the file
 *   node scripts/gen-reserved-names.mjs --check   exits 1 when the committed file is out of date
 *
 * It needs the WebAssembly compiler of the Upload feature — public/toolchain/tools/cc1plus.{wasm,mjs}
 * (or $ZERO1_TOOLCHAIN_DIR) and public/toolchain/bundle/ (tools/build-toolchain-bundle.mjs) — and
 * compiles, with the bundle's Arduino core and libraries, a translation unit that includes
 * Arduino.h, Wire.h, LiquidCrystal_I2C.h, DHT.h, Adafruit_NeoPixel.h and Servo.h:
 *   1. `cc1plus -E -dM`: every macro (B0…B11111111, abs, min, round, HIGH, PI, …);
 *   2. `cc1plus -E`: every identifier of the preprocessed text; each is tried as `long NAME = 0;`
 *      at file scope and inside a function (-fsyntax-only); the ones that fail are reserved
 *      (square, rand, div, A0, setup, loop, …).
 * The generated file adds the C++11 keywords and alternative tokens, the names the translator
 * emits (listed below) and, at run time, the simulator's KNOWN_RUNTIME_NAMES.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = [process.env.ZERO1_TOOLCHAIN_DIR, join(ROOT, 'public/toolchain/tools')].find((d) => d && existsSync(join(d, 'cc1plus.wasm')) && existsSync(join(d, 'cc1plus.mjs')));
const BUNDLE = join(ROOT, 'public/toolchain/bundle');
const OUT = join(ROOT, 'src/python/reserved-names.ts');
const CHECK = process.argv.includes('--check');

/** The headers of every library a ZERO1 sketch may use (§2.14). */
const HEADERS = ['Arduino.h', 'Wire.h', 'LiquidCrystal_I2C.h', 'DHT.h', 'Adafruit_NeoPixel.h', 'Servo.h'];

/** C++11 keywords and alternative tokens. */
const CPP_KEYWORDS = `alignas alignof and and_eq asm auto bitand bitor bool break case catch char char16_t char32_t class
compl const constexpr const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern
false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private
protected public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch
template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while
xor xor_eq`.split(/\s+/);

/**
 * Names the translator emits (§2.14, §4.7, §4.8): the sketch's own functions and types, the py…
 * helpers (the list helpers in every element variant of helpers.ts: …L long, …F float, …S String,
 * …B bool, …C colour, …P Pin, …Y byte), the 7-segment helpers, the zero1 pin constants and the
 * library classes. Keep in step with src/python/helpers.ts and api.ts.
 */
const LIST_HELPERS = ['pyAppend', 'pyPop', 'pyListText', 'pySum', 'pyMinList', 'pyMaxList', 'pyInList'];
const EMITTED_NAMES = [
  'setup', 'loop', 'main', 'String', 'Serial', 'Wire', 'byte', 'word', 'boolean',
  'pyFail', 'pyFloorDiv', 'pyMod', 'pyFloatMod', 'pyNonZero', 'pyNonZeroF', 'pyPow', 'pyPow10', 'pyRound', 'pyRoundTo',
  'pyAbsL', 'pyAbsF', 'pyMinL', 'pyMaxL', 'pyMinF', 'pyMaxF', 'pyBool', 'pyFloat', 'pyDigits', 'pySignificant', 'pyPad',
  'pyHex', 'pyBin', 'pyInput', 'pyIsInt', 'pyInt', 'pyIsFloat', 'pyFloatOf', 'pyIsDigit', 'pyUpper', 'pyLower', 'pyStrip',
  'pyReplace', 'pyCharAt', 'pyIndex', 'pySleep', 'pySleepMs', 'pyDistanceCm', 'pyShift', 'pyMapRange', 'pySqrt', 'pyLog',
  'pyLog10', 'pyAsin', 'pyAcos',
  ...LIST_HELPERS.flatMap((h) => ['L', 'F', 'S', 'B', 'C', 'P', 'Y'].map((k) => h + k)),
  'showSegments', 'showDigit', 'DIGITS',
  'LED_RED', 'LED_GREEN', 'LED_BUILTIN', 'BUTTON_1', 'BUTTON_2', 'POT_LDR', 'MOTOR', 'SERVO_PIN', 'BUZZER', 'DHT_PIN',
  'TRIG_PIN', 'ECHO_PIN', 'RGB_PIN', 'SEG_DATA', 'SEG_LATCH', 'SEG_CLOCK', 'LCD_ADDRESS',
  'Servo', 'LiquidCrystal_I2C', 'DHT', 'Adafruit_NeoPixel', 'TwoWire', 'HardwareSerial', 'Print', 'Stream',
];

if (!TOOLS || !existsSync(join(BUNDLE, 'manifest.json'))) {
  console.error('[reserved-names] needs the WebAssembly toolchain: public/toolchain/tools/cc1plus.{wasm,mjs} (or $ZERO1_TOOLCHAIN_DIR)');
  console.error('[reserved-names] and public/toolchain/bundle/ (node tools/build-toolchain-bundle.mjs && node tools/fetch-toolchain.mjs).');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(BUNDLE, 'manifest.json'), 'utf8'));
const pack = readFileSync(join(BUNDLE, manifest.headersPack));
const headerFiles = manifest.headers.map(([path, offset, length]) => [path, pack.subarray(offset, offset + length)]);
const A = manifest.cc1plusArgs;
const libIncludes = Object.values(manifest.libraries).flatMap((lib) => lib.includeDirs.flatMap((d) => ['-I', d]));
const baseArgs = ['-quiet', ...A.device, ...A.defines, ...A.includes, ...libIncludes, ...A.system];
const factory = (await import(pathToFileURL(join(TOOLS, 'cc1plus.mjs')).href)).default;
const wasmModule = await WebAssembly.compile(readFileSync(join(TOOLS, 'cc1plus.wasm')));

/** Runs cc1plus on `source` (at /probe/tu.cpp): its status, stderr lines and the output file. */
async function cc1plus(args, source) {
  const stderr = [];
  const mod = await factory({
    noInitialRun: true,
    print: () => {},
    printErr: (line) => stderr.push(line),
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(wasmModule, imports).then((instance) => done(instance, wasmModule));
      return {};
    },
  });
  const made = new Set();
  const mkdirp = (dir) => {
    let cur = '';
    for (const part of dir.split('/').filter(Boolean)) {
      cur += '/' + part;
      if (made.has(cur)) continue;
      made.add(cur);
      try {
        mod.FS.mkdir(cur);
      } catch {
        /* exists */
      }
    }
  };
  for (const [path, data] of [...headerFiles, ['/probe/tu.cpp', source]]) {
    mkdirp(path.slice(0, path.lastIndexOf('/')));
    mod.FS.writeFile(path, data);
  }
  let status = 0;
  try {
    const r = mod.callMain([...args, '/probe/tu.cpp', ...A.target, '-o', '/probe/out']);
    if (typeof r === 'number') status = r;
  } catch (e) {
    status = typeof e?.status === 'number' ? e.status : -1;
  }
  let output = '';
  try {
    output = new TextDecoder().decode(mod.FS.readFile('/probe/out'));
  } catch {
    /* no output */
  }
  return { status, stderr, output };
}

const includes = HEADERS.map((h) => `#include <${h}>`).join('\n') + '\n';

// 1. Macros.
const defines = await cc1plus([...baseArgs, '-E', '-dM'], includes);
if (defines.status !== 0) throw new Error(`cc1plus -E -dM failed:\n${defines.stderr.join('\n')}`);
const macros = new Set([...defines.output.matchAll(/^#define ([A-Za-z_]\w*)/gm)].map((m) => m[1]));

// 2. Identifiers of the preprocessed text.
const pre = await cc1plus([...baseArgs, '-E'], includes);
if (pre.status !== 0) throw new Error(`cc1plus -E failed:\n${pre.stderr.join('\n')}`);
const code = pre.output
  .split('\n')
  .filter((line) => !line.startsWith('#'))
  .join('\n')
  .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, ' ');
const keywords = new Set(CPP_KEYWORDS);
const identifiers = [...new Set(code.match(/\b[A-Za-z_]\w*\b/g))].filter((n) => !keywords.has(n) && !macros.has(n)).sort();

/** The names whose `long NAME = 0;` fails, at file scope or in a function body. */
async function failing(names, inFunction) {
  const head = includes + (inFunction ? 'void zero1ReservedNameProbe() {\n' : '');
  const firstLine = head.split('\n').length;
  const source = head + names.map((n) => `long ${n} = 0;\n`).join('') + (inFunction ? '}\n' : '');
  const result = await cc1plus([...baseArgs, '-fsyntax-only', '-std=gnu++11'], source);
  const bad = new Set();
  for (const line of result.stderr) {
    const m = /^\/probe\/tu\.cpp:(\d+):\d+: error:/.exec(line);
    if (!m) continue;
    const index = Number(m[1]) - firstLine;
    if (index >= 0 && index < names.length) bad.add(names[index]);
  }
  return bad;
}

/** Tries the names until the ones left all compile together (an error can hide another). */
async function probe(names, inFunction) {
  const bad = new Set();
  let left = names;
  for (let round = 0; round < 10; round++) {
    const found = await failing(left, inFunction);
    if (found.size === 0) break;
    for (const n of found) bad.add(n);
    left = left.filter((n) => !found.has(n));
  }
  return bad;
}

const failAtFileScope = await probe(identifiers, false);
const failInFunction = await probe(identifiers, true);
const declarationFailures = [...new Set([...failAtFileScope, ...failInFunction])].sort();

const block = (names) => {
  const lines = [];
  let line = '';
  for (const n of names) {
    if (line && line.length + 1 + n.length > 96) {
      lines.push(line);
      line = n;
    } else {
      line = line ? `${line} ${n}` : n;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => `  '${l}',`).join('\n');
};

const text = `/**
 * GENERATED by scripts/gen-reserved-names.mjs — do not edit (run the script again instead).
 *
 * The names a Python program cannot keep in the generated Arduino sketch (docs/PYTHON.md §2.14):
 * the translator appends '_' to them. Made with the WebAssembly avr-g++ 7.3 of the Upload feature
 * from a translation unit that includes ${HEADERS.join(', ')}.
 */
import { KNOWN_RUNTIME_NAMES } from '../transpiler/signatures';

const words = (lines: readonly string[]): string[] => lines.join(' ').split(' ');

/** C++11 keywords and alternative tokens. */
const CPP_KEYWORDS = words([
${block([...CPP_KEYWORDS].sort())}
]);

/** Every macro of \`cc1plus -E -dM\` over the translation unit (${macros.size}). */
const MACROS = words([
${block([...macros].sort())}
]);

/** Identifiers of the preprocessed translation unit whose \`long NAME = 0;\` fails at file scope or in a function (${declarationFailures.length}). */
const DECLARATION_FAILURES = words([
${block(declarationFailures)}
]);

/** Names the translator emits: the sketch's functions and types, py… helpers, 7-segment helpers, pin constants, library classes. */
const EMITTED_NAMES = words([
${block([...new Set(EMITTED_NAMES)])}
]);

/** Every reserved name (with the simulator's KNOWN_RUNTIME_NAMES). */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([...CPP_KEYWORDS, ...MACROS, ...DECLARATION_FAILURES, ...EMITTED_NAMES, ...KNOWN_RUNTIME_NAMES]);
`;
if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error(`[reserved-names] ${OUT} is out of date: run node scripts/gen-reserved-names.mjs`);
    process.exit(1);
  }
  console.log('[reserved-names] up to date');
  process.exit(0);
}
writeFileSync(OUT, text);
console.log(
  `[reserved-names] ${macros.size} macros, ${identifiers.length} identifiers tried: ${failAtFileScope.size} fail at file scope, ${failInFunction.size} in a function → ${OUT}`,
);
