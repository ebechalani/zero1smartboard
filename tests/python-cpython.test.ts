/**
 * ZERO1 Python against CPython (docs/PYTHON.md §10.3): the print-only programs of
 * tests/fixtures/python/cpython/ are translated and run on the simulator, and their Serial
 * Monitor must equal CPython 3.12's output (`<name>.out`, recorded by scripts/record-cpython.mjs)
 * line by line, except the lines listed in `<name>.deviations`: each gives the line, the row of
 * §2.13 that explains the difference and what the board prints there, which the simulator must
 * print exactly.
 *
 * `.deviations` format, one line per differing output line (`#` starts a comment):
 *   <line number> | <row id of ROWS> | <the board's line>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pythonToArduino } from '../src/python';
import { runSketch } from './helpers';

/** The rows of §2.13 a deviation may name. */
const ROWS: Readonly<Record<string, string>> = {
  'int-32': 'whole numbers are 32-bit on the board and wrap like an odometer',
  'float-digits': 'decimal numbers are 32-bit floats, printed with 7 significant digits like MicroPython',
  'float-eq': '0.1 + 0.2 == 0.3 is True in float32',
  'fstring-round': 'f"{2.5:.0f}" is 3: Arduino rounds halves up',
  'round-float32': 'round(2.675, 2) is 2.68 in float32',
  'one-kind': 'one kind per expression, variable and parameter: min(2, 2.5) printed is 2.0 (§2.9)',
};

interface Deviation {
  line: number;
  row: string;
  board: string;
}

const DIR = new URL('./fixtures/python/cpython/', import.meta.url);
const PROGRAMS = readdirSync(DIR)
  .filter((f) => f.endsWith('.py'))
  .map((f) => f.slice(0, -3))
  .sort();

function deviationsOf(name: string): Deviation[] {
  const file = new URL(`${name}.deviations`, DIR);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith('#'))
    .map((l) => {
      const m = /^(\d+) \| ([\w-]+) \| (.*)$/.exec(l);
      if (!m) throw new Error(`${name}.deviations: cannot read "${l}"`);
      return { line: Number(m[1]), row: m[2], board: m[3] };
    });
}

describe('ZERO1 Python prints what CPython 3.12 prints (§10.3)', () => {
  it('has programs, each with its recorded CPython output', () => {
    expect(PROGRAMS.length).toBeGreaterThanOrEqual(7);
    for (const name of PROGRAMS) expect(existsSync(new URL(`${name}.out`, DIR)), `${name}.out (node scripts/record-cpython.mjs)`).toBe(true);
  });

  it.each(PROGRAMS)('%s', async (name) => {
    const source = readFileSync(new URL(`${name}.py`, DIR), 'utf8');
    const python = readFileSync(new URL(`${name}.out`, DIR), 'utf8').split('\n').slice(0, -1);
    const t = pythonToArduino(source);
    expect(t.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}:${d.column} ${d.message}`)).toEqual([]);
    expect(t.endsAfterSetup).toBe(true);
    const r = await runSketch(t.sketch, { stopAfterMs: 1000 });
    expect(r.console.filter((m) => m.level === 'error')).toEqual([]);
    const board = r.serial.replace(/\r\n/g, '\n').split('\n').slice(0, -1);
    const deviations = deviationsOf(name);
    for (const d of deviations) {
      expect(ROWS, `${name}.deviations line ${d.line}`).toHaveProperty([d.row]);
      expect(python[d.line - 1], `${name}.deviations line ${d.line}: the same as CPython, so not a deviation`).not.toBe(d.board);
    }
    // CPython's lines, with the listed ones replaced by the board's.
    const expected = python.map((line, i) => deviations.find((d) => d.line === i + 1)?.board ?? line);
    expect(board).toEqual(expected);
  });
});
