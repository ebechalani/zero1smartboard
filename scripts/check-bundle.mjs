#!/usr/bin/env node
/**
 * Post-build bundle checks (docs/CLASSROOM.md §4.2, §7.5), run after `vite build`:
 * - the simulator entry (index.html) and its static imports contain no Firebase code;
 * - the same for teacher.html and review.html when they exist (their Firebase is lazy);
 * - the chunks reachable from the student SDK barrel stay under 70 KB gzip, the teacher's under 200 KB;
 * - the Python chunk (docs/PYTHON.md §7.16) exists, adds at most 128 KB gzip to the simulator
 *   page (its static closure minus index.html's), the Python examples chunk at most 24 KB more,
 *   and no chunk of index.html's closure contains the translator's messages.
 * Rollup may share a chunk between pages, which a source scan (tests/bundle-boundary.test.ts)
 * cannot see; this script reads the emitted chunks and follows their static imports.
 * Usage: node scripts/check-bundle.mjs [dist]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = resolve(process.argv[2] ?? 'dist');
const ASSETS = resolve(DIST, 'assets');
/**
 * Strings only the SDK chunks contain. `initializeApp(` must not be a member call: the lazy
 * loader in src/classroom/firebase.ts legitimately says `sdk.initializeApp(` in the entry graph.
 */
const FIREBASE_MARKS = [
  { name: 'firestore.googleapis.com', re: /firestore\.googleapis\.com/ },
  { name: 'identitytoolkit', re: /identitytoolkit/ },
  { name: 'initializeApp(', re: /(?<![.\w$])initializeApp\(/ },
];
const STUDENT_LIMIT = 70 * 1024;
const TEACHER_LIMIT = 200 * 1024;
/**
 * What Python mode may add on top of the simulator page, gzip. docs/PYTHON.md §7.16 planned 80 KB
 * (translator ≈ 20-25 KB); the finished translator is ≈ 4 times that. Measured 2026-09-30 with
 * the emitter in: 112.6 KB = src/python ≈ 90 KB (emitter ≈ 17, checks ≈ 14, reserved names ≈ 10,
 * kinds ≈ 9, api ≈ 7.5, parser ≈ 7.5, messages ≈ 6.5, tokenizer ≈ 5, helpers ≈ 4.5, scopes ≈ 4,
 * data flow ≈ 3) + @codemirror/lang-python and @lezer/python ≈ 16 KB + the editor's Python UI
 * ≈ 5 KB; 116.9 KB after the review fixes (evaluation order, the new helpers). Splitting the
 * translator into a chunk of its own would not make Python mode download less (the editor needs
 * it at once for the live lint and the Code tab), so the budget counts all of it. The examples
 * are not in it: with all 33 the chunk measured 131.2 KB, so examples 02–59 are a lazy chunk of
 * their own (python-examples-chunk, PYTHON_EXAMPLES_LIMIT) and this one carries example 01 only.
 */
const PYTHON_LIMIT = 128 * 1024;
/** The Python examples other than 01 (src/ui/python-examples-chunk.ts): measured 18.7 KB gzip for 32 examples. */
const PYTHON_EXAMPLES_LIMIT = 24 * 1024;
/** A text only the translator's messages contain (src/python/messages.ts). */
const PYTHON_MARKER = 'ZERO1 Python does not have';

const failures = [];
const fail = (text) => failures.push(text);
const rel = (file) => relative(DIST, file);

/** The module scripts of a page (entry + modulepreload links), as absolute paths. */
function pageScripts(html) {
  const file = resolve(DIST, html);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const urls = [];
  for (const m of text.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) urls.push(m[1]);
  for (const m of text.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) urls.push(m[1]);
  return urls.map((u) => resolve(DIST, u.replace(/^\.\//, '')));
}

/** Static import / re-export specifiers of an emitted chunk (dynamic `import(...)` left out). */
function staticImports(code) {
  const specs = new Set();
  for (const m of code.matchAll(/\bimport\s*(?:[\w$*{][^;'"]*?\bfrom\s*)?["']([^"']+)["']/g)) specs.add(m[1]);
  for (const m of code.matchAll(/\bexport\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g)) specs.add(m[1]);
  return [...specs];
}

/** Every chunk reachable through static imports from `files`. */
function closure(files) {
  const seen = new Set();
  const queue = [...files];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file) || !existsSync(file) || !file.endsWith('.js')) continue;
    seen.add(file);
    const code = readFileSync(file, 'utf8');
    for (const spec of staticImports(code)) {
      if (spec.startsWith('.') || spec.startsWith('/')) queue.push(resolve(dirname(file), spec));
    }
  }
  return [...seen];
}

const marksIn = (file) => {
  const code = readFileSync(file, 'utf8');
  return FIREBASE_MARKS.filter((mark) => mark.re.test(code)).map((mark) => mark.name);
};
const gzipSize = (file) => gzipSync(readFileSync(file)).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function checkPage(html) {
  const scripts = pageScripts(html);
  if (scripts === null) {
    console.log(`${html}: not built (skipped)`);
    return;
  }
  const chunks = closure(scripts);
  const tainted = chunks.filter((c) => marksIn(c).length > 0);
  if (tainted.length) fail(`${html}: Firebase code in the static import graph: ${tainted.map((c) => `${rel(c)} (${marksIn(c).join(', ')})`).join('; ')}`);
  console.log(`${html}: ${chunks.length} static chunk(s), ${kb(chunks.reduce((n, c) => n + gzipSize(c), 0))} gzip, ${tainted.length ? 'FIREBASE FOUND' : 'no Firebase'}`);
}

function checkSdk(prefix, limit) {
  if (!existsSync(ASSETS)) return;
  const barrels = readdirSync(ASSETS).filter((n) => n.startsWith(`${prefix}-`) && n.endsWith('.js'));
  if (barrels.length === 0) {
    console.log(`${prefix}: no chunk emitted (nothing imports it yet)`);
    return;
  }
  const chunks = closure(barrels.map((n) => resolve(ASSETS, n)));
  const total = chunks.reduce((n, c) => n + gzipSize(c), 0);
  console.log(`${prefix}: ${chunks.length} chunk(s), ${kb(total)} gzip (limit ${kb(limit)})`);
  if (total > limit) fail(`${prefix}: ${kb(total)} gzip exceeds the limit of ${kb(limit)}`);
}

function checkPython() {
  const scripts = pageScripts('index.html');
  if (scripts === null || !existsSync(ASSETS)) return;
  const page = new Set(closure(scripts));
  const leaked = [...page].filter((c) => readFileSync(c, 'utf8').includes(PYTHON_MARKER));
  if (leaked.length) fail(`index.html: the Python translator is in the static import graph: ${leaked.map(rel).join(', ')}`);
  const entries = readdirSync(ASSETS).filter((n) => /^python-chunk-[\w-]+\.js$/.test(n));
  if (entries.length === 0) {
    fail('python-chunk: no chunk emitted (src/ui/modes/python-mode.ts must load it with import())');
    return;
  }
  const own = closure(entries.map((n) => resolve(ASSETS, n))).filter((c) => !page.has(c));
  const total = own.reduce((n, c) => n + gzipSize(c), 0);
  console.log(`python-chunk: ${own.length} chunk(s) beyond index.html, ${kb(total)} gzip (limit ${kb(PYTHON_LIMIT)})`);
  if (total > PYTHON_LIMIT) fail(`python-chunk: ${kb(total)} gzip exceeds the limit of ${kb(PYTHON_LIMIT)}`);
  // The examples: what their chunk adds beyond the page and the Python chunk.
  const exampleEntries = readdirSync(ASSETS).filter((n) => /^python-examples-chunk-[\w-]+\.js$/.test(n));
  if (exampleEntries.length === 0) {
    fail('python-examples-chunk: no chunk emitted (src/ui/modes/python-mode.ts must load it with import())');
    return;
  }
  const loaded = new Set(own);
  const examples = closure(exampleEntries.map((n) => resolve(ASSETS, n))).filter((c) => !page.has(c) && !loaded.has(c));
  const examplesTotal = examples.reduce((n, c) => n + gzipSize(c), 0);
  console.log(`python-examples-chunk: ${examples.length} chunk(s) beyond them, ${kb(examplesTotal)} gzip (limit ${kb(PYTHON_EXAMPLES_LIMIT)})`);
  if (examplesTotal > PYTHON_EXAMPLES_LIMIT) fail(`python-examples-chunk: ${kb(examplesTotal)} gzip exceeds the limit of ${kb(PYTHON_EXAMPLES_LIMIT)}`);
}

if (!existsSync(DIST)) {
  console.error(`check-bundle: ${DIST} does not exist; run vite build first`);
  process.exit(1);
}
checkPage('index.html');
checkPage('teacher.html');
checkPage('review.html');
checkSdk('student-sdk', STUDENT_LIMIT);
checkSdk('teacher-sdk', TEACHER_LIMIT);
checkPython();

if (failures.length) {
  console.error(`\ncheck-bundle: ${failures.length} problem(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('check-bundle: OK');
