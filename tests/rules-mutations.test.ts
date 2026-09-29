/**
 * tests-emulator/mutations/ (docs/CLASSROOM.md §7.1, docs/PYTHON.md §10.8): each file is a copy of
 * firestore.rules with ONE protection removed, and tests-emulator/mutations.sh checks that the
 * emulator suite catches it. A copy made from an older version of the rules could be "caught" for
 * the wrong reason (the drift, not the mutation), so every copy must stay within a few lines of
 * the current rules: regenerate the mutations whenever firestore.rules changes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('../tests-emulator/mutations/', import.meta.url);
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
/** The most lines (removed + added) a mutation may differ from firestore.rules by. */
const MAX_CHANGED_LINES = 4;

/** The mutation set of docs/CLASSROOM.md §7.1. */
const MUTATIONS = [
  'delete-not-idempotent',
  'enc-types-unchecked',
  'handin-name-unchecked',
  'handin-owner-unchecked',
  'handins-open-ignored',
  'member-owner-unchecked',
  'name-pattern-unchecked',
  'python-workspace-unchecked',
  'rename-any-field',
  'student-reads-others',
  'tick-not-bound-to-new-handin',
];

/** Lines removed from `a` plus lines added in `b` (a longest-common-subsequence line diff). */
function changedLines(a: string, b: string): number {
  const x = a.split('\n');
  const y = b.split('\n');
  let prev = new Uint16Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    const row = new Uint16Array(y.length + 1);
    for (let j = 1; j <= y.length; j++) {
      row[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
    prev = row;
  }
  const common = prev[y.length];
  return x.length - common + (y.length - common);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.rules'));

describe('rules mutations', () => {
  it('the diff counts removed and added lines', () => {
    expect(changedLines('a\nb\nc', 'a\nb\nc')).toBe(0);
    expect(changedLines('a\nb\nc', 'a\nc')).toBe(1);
    expect(changedLines('a\nb\nc', 'a\nB\nc')).toBe(2);
    expect(changedLines('a\nb\nc\nd', 'a\nX\nY\nd')).toBe(4);
  });
  it('the set of mutations is the documented one', () => {
    expect(files.map((f) => f.replace(/\.rules$/, '')).sort()).toEqual(MUTATIONS);
  });
  it.each(MUTATIONS)('%s differs from firestore.rules by 1-4 lines (regenerate it when the rules change)', (name) => {
    const mutated = readFileSync(new URL(`${name}.rules`, DIR), 'utf8');
    const changed = changedLines(rules, mutated);
    expect(changed, `${name}: ${changed} lines differ from firestore.rules`).toBeGreaterThan(0);
    expect(changed, `${name}: ${changed} lines differ from firestore.rules`).toBeLessThanOrEqual(MAX_CHANGED_LINES);
  });
  it('no two mutations are the same', () => {
    const texts = files.map((f) => readFileSync(new URL(f, DIR), 'utf8'));
    expect(new Set(texts).size).toBe(texts.length);
  });
});
