#!/usr/bin/env node
/**
 * Post-build bundle checks (docs/CLASSROOM.md §4.2, §7.5), run after `vite build`:
 * - the simulator entry (index.html) and its static imports contain no Firebase code;
 * - the same for teacher.html and review.html when they exist (their Firebase is lazy);
 * - the chunks reachable from the student SDK barrel stay under 70 KB gzip, the teacher's under 200 KB.
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

if (!existsSync(DIST)) {
  console.error(`check-bundle: ${DIST} does not exist; run vite build first`);
  process.exit(1);
}
checkPage('index.html');
checkPage('teacher.html');
checkPage('review.html');
checkSdk('student-sdk', STUDENT_LIMIT);
checkSdk('teacher-sdk', TEACHER_LIMIT);

if (failures.length) {
  console.error(`\ncheck-bundle: ${failures.length} problem(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('check-bundle: OK');
