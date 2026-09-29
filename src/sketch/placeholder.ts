/**
 * The stand-in sketch for a Python program with errors (docs/PYTHON.md §4.10 T9): what the
 * read-only Code tab shows and what a Python hand-in with errors stores as `code`. Shared by the
 * translator (src/python) and the class platform (the teacher's "Handed in with N Python
 * errors"), so it lives outside src/python and imports nothing.
 */

/** First line of the sketch generated for a Python program with errors. */
export const PYTHON_PLACEHOLDER_PREFIX = '// Your Python program has ';

const FIRST_LINE = /^\/\/ Your Python program has (\d+) errors?, so there is no Arduino sketch yet\.(?:\r?\n|$)/;

/** The placeholder sketch for `errorCount` errors (two comment lines). */
export function pythonPlaceholder(errorCount: number): string {
  const one = errorCount === 1;
  return [
    `${PYTHON_PLACEHOLDER_PREFIX}${errorCount} error${one ? '' : 's'}, so there is no Arduino sketch yet.`,
    `// Fix ${one ? 'it' : 'them'} in the Python tab (see the console), then this tab shows the sketch.`,
    '',
  ].join('\n');
}

/** "…has 2 errors, so there is no Arduino sketch yet." → 2; null for a real sketch. */
export function placeholderErrorCount(sketch: string): number | null {
  if (!sketch.startsWith(PYTHON_PLACEHOLDER_PREFIX)) return null;
  const match = FIRST_LINE.exec(sketch);
  return match ? Number(match[1]) : null;
}
