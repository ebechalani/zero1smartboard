#!/usr/bin/env node
/**
 * Records what CPython prints for the print-only programs of tests/fixtures/python/cpython/
 * (docs/PYTHON.md §10.3): each `<name>.py` gets `<name>.out`, CPython's standard output. The
 * .out files are committed; tests/python-cpython.test.ts compares them line by line with the
 * Serial Monitor of the same program translated and run on the simulator (except the lines
 * listed in `<name>.deviations`, each with the §2.13 row that explains it).
 *
 *   node scripts/record-cpython.mjs           writes every .out
 *   node scripts/record-cpython.mjs --check   exits 1 when a committed .out differs
 *
 * The reference is CPython 3.12 (§2): `python3.12` when it is on the PATH, else `python3`
 * (or $PYTHON), which must be 3.12 or later. Needs nothing else: the programs import nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'tests/fixtures/python/cpython');
const CHECK = process.argv.includes('--check');

/** The first interpreter that runs, 3.12 or later. */
function findPython() {
  for (const cmd of [process.env.PYTHON, 'python3.12', 'python3'].filter(Boolean)) {
    try {
      const version = execFileSync(cmd, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], { encoding: 'utf8' }).trim();
      const [major, minor] = version.split('.').map(Number);
      if (major === 3 && minor >= 12) return { cmd, version };
      console.warn(`${cmd} is Python ${version}: 3.12 or later is needed`);
    } catch {
      // not installed: try the next one
    }
  }
  return null;
}

const python = findPython();
if (!python) {
  console.error('record-cpython: no Python 3.12 found (set $PYTHON)');
  process.exit(2);
}

let stale = 0;
const programs = readdirSync(DIR).filter((f) => f.endsWith('.py')).sort();
for (const file of programs) {
  const out = join(DIR, file.replace(/\.py$/, '.out'));
  const text = execFileSync(python.cmd, [join(DIR, file)], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (CHECK) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) {
      console.error(`${out} is out of date`);
      stale++;
    }
  } else {
    writeFileSync(out, text);
  }
}
console.log(`${CHECK ? 'checked' : 'recorded'} ${programs.length} programs with Python ${python.version} (${python.cmd})`);
if (stale > 0) process.exit(1);
