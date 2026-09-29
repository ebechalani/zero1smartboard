/**
 * The mode registry (docs/PYTHON.md §7.1): every mode-dependent behaviour lives in src/ui/modes/,
 * so the app shell never compares anything with a mode literal. A third mode would silently take
 * the wrong branch of a two-way `mode === 'blocks'` check; this source scan keeps them out.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_MODES } from '../src/ui/blocks-panel';

const APP = fileURLToPath(new URL('../src/ui/app.ts', import.meta.url));

/** The source without comments (a comment may name a mode). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Every comparison with a mode literal: `=== 'code'`, `!= "blocks"`, `'python' ===`, `case 'code':`. */
function modeComparisons(text: string): string[] {
  const modes = APP_MODES.join('|');
  const patterns = [
    new RegExp(`[!=]==?\\s*(['"\`])(${modes})\\1`, 'g'),
    new RegExp(`(['"\`])(${modes})\\1\\s*[!=]==?`, 'g'),
    new RegExp(`\\bcase\\s+(['"\`])(${modes})\\1`, 'g'),
  ];
  return patterns.flatMap((re) => Array.from(code(text).matchAll(re), (m) => m[0]));
}

describe('mode registry', () => {
  it('app.ts compares nothing with a mode literal', () => {
    expect(modeComparisons(readFileSync(APP, 'utf8'))).toEqual([]);
  });

  it('the scan finds every form of comparison', () => {
    const sample = [
      "if (this.mode === 'code') a();",
      'if (kind !== "blocks") b();',
      "if ('python' === mode) c();",
      "if (id == 'blocks') d();",
      'switch (mode) { case \'python\': e(); }',
      "// a comment: mode === 'code'",
      "/* mode !== 'python' */",
      "const tab = 'code'; f(tab === 'serial');",
    ].join('\n');
    expect(modeComparisons(sample)).toEqual(["=== 'code'", '!== "blocks"', "== 'blocks'", "'python' ===", "case 'python'"]);
  });
});
