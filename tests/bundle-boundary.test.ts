/**
 * The bundle boundary (docs/CLASSROOM.md §4.2): a source scan of static imports. No module
 * reachable from src/main.ts, src/teacher/main.ts or src/review/main.ts (and none of the classroom
 * API modules themselves) may import `firebase/*` except with `import type`; the two SDK barrels
 * are reached only through `import()` inside src/classroom/firebase.ts. scripts/check-bundle.mjs
 * repeats the check on the built chunks, where Rollup may share code between pages.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = (p: string) => resolve(ROOT, 'src', p);

/** Static import / export-from specifiers of a TypeScript module (type-only imports left out). */
export function staticImports(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const specs: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?([\s\S]*?)\sfrom\s*['"]([^'"]+)['"]/gm;
  for (const m of text.matchAll(re)) {
    if (m[2] && /^(\{|\*|[\w$]+\s*(,|$))/.test(m[3].trim())) continue; // import type ... from
    specs.push(m[4]);
  }
  for (const m of text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) specs.push(m[1]);
  return specs;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every module reachable through static imports, with the bare specifiers each one imports. */
function reachable(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = entries.filter((e) => existsSync(e));
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const specs = staticImports(file);
    seen.set(
      file,
      specs.filter((s) => !s.startsWith('.')),
    );
    for (const spec of specs) {
      const local = resolveLocal(file, spec);
      if (local && !seen.has(local)) queue.push(local);
    }
  }
  return seen;
}

const ENTRIES = [src('main.ts'), src('teacher/main.ts'), src('review/main.ts'), src('classroom/student.ts'), src('classroom/teacher.ts')];

describe('bundle boundary', () => {
  it('nothing reachable from the page entries or the classroom APIs imports firebase statically', () => {
    const graph = reachable(ENTRIES);
    expect(graph.size).toBeGreaterThan(2);
    const offenders = [...graph].filter(([, bare]) => bare.some((s) => s === 'firebase' || s.startsWith('firebase/') || s.startsWith('@firebase/')));
    expect(offenders.map(([f]) => f.replace(ROOT, ''))).toEqual([]);
  });
  it('the SDK barrels are never imported statically', () => {
    const graph = reachable(ENTRIES);
    for (const file of graph.keys()) {
      expect(file.endsWith('student-sdk.ts') || file.endsWith('teacher-sdk.ts'), file).toBe(false);
    }
  });
  it('firebase.ts loads the barrels with import() only and imports Firebase types only', () => {
    const text = readFileSync(src('classroom/firebase.ts'), 'utf8');
    expect(text).toMatch(/import\('\.\/student-sdk'\)/);
    expect(text).toMatch(/import\('\.\/teacher-sdk'\)/);
    for (const m of text.matchAll(/^\s*import\s+([\s\S]*?)\sfrom\s*'firebase\/[^']+'/gm)) {
      expect(m[1].trim().startsWith('type '), m[0]).toBe(true);
    }
    expect(staticImports(src('classroom/firebase.ts')).filter((s) => s.startsWith('firebase'))).toEqual([]);
  });
  it('the pure modules import no Firebase at all, not even types', () => {
    for (const file of ['classroom/model.ts', 'classroom/codec.ts', 'classroom/errors.ts', 'classroom/session-store.ts', 'share-link.ts', 'firebase-config.ts']) {
      expect(readFileSync(src(file), 'utf8'), file).not.toMatch(/from\s*['"]firebase/);
    }
  });
  it('nothing reachable from the simulator entry imports the Python translator or its editor language statically (docs/PYTHON.md §7.16)', () => {
    const graph = reachable([src('main.ts')]);
    expect(graph.has(src('ui/modes/python-mode.ts'))).toBe(true); // the mode itself is in the entry graph…
    expect(graph.has(src('ui/python-chunk.ts'))).toBe(false); // …its chunk is not
    // The chunk's own UI files (language support and completions, paste clean-up, What works) come with it.
    const chunkOnly = ['ui/python-language.ts', 'ui/python-paste.ts', 'ui/python-help-dialog.ts'].map(src);
    const local = [...graph.keys()].filter((f) => f.startsWith(src('python/')) || f.startsWith(src('examples/python/')) || chunkOnly.includes(f));
    expect(local.map((f) => f.replace(ROOT, ''))).toEqual([]);
    const bare = [...graph].filter(([, specs]) => specs.some((s) => s === '@codemirror/lang-python' || s === '@lezer/python'));
    expect(bare.map(([f]) => f.replace(ROOT, ''))).toEqual([]);
  });
  it('python-mode.ts reaches the Python chunk with import() only', () => {
    const text = readFileSync(src('ui/modes/python-mode.ts'), 'utf8');
    expect(text).toMatch(/import\('\.\.\/python-chunk'\)/);
    expect(staticImports(src('ui/modes/python-mode.ts')).filter((s) => s.includes('python-chunk') || s.includes('/python'))).toEqual([]);
  });
  it('only the two barrels import the SDK packages', () => {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = resolve(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(resolve(ROOT, 'src'));
    const importers = files.filter((f) => staticImports(f).some((s) => s.startsWith('firebase')));
    expect(importers.map((f) => f.replace(ROOT, '')).sort()).toEqual(['src/classroom/student-sdk.ts', 'src/classroom/teacher-sdk.ts']);
  });
});
