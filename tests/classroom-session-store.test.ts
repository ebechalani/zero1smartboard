/**
 * src/classroom/session-store.ts (docs/CLASSROOM.md §2.13, §7.2): the saved session, the last
 * code, and storages that throw.
 */
import { describe, expect, it } from 'vitest';
import {
  CLASSROOM_STORAGE_KEY,
  LAST_CODE_STORAGE_KEY,
  clearSession,
  currentStudentName,
  loadLastCode,
  loadSavedSession,
  saveLastCode,
  saveSession,
  type SavedSession,
} from '../src/classroom/session-store';
import { memoryStorage, throwingStorage } from './classroom-fakes';

const SESSION: SavedSession = {
  v: 2,
  code: 'BKT4M9',
  className: '8B Robotics',
  firstName: 'Ali',
  lastName: 'Khoury',
  uid: 'anon-1',
  lastUsedAt: 1_700_000_000_000,
  lastHandinAt: 0,
};

describe('saved session', () => {
  it('round-trips', () => {
    const storage = memoryStorage();
    saveSession(SESSION, storage);
    expect(JSON.parse(storage.getItem(CLASSROOM_STORAGE_KEY)!)).toEqual(SESSION);
    expect(loadSavedSession(storage)).toEqual(SESSION);
    expect(currentStudentName(storage)).toBe('Ali Khoury');
  });
  it('is null when nothing is saved, on bad JSON, an older version or a wrong shape', () => {
    const storage = memoryStorage();
    expect(loadSavedSession(storage)).toBeNull();
    expect(currentStudentName(storage)).toBe('');
    storage.setItem(CLASSROOM_STORAGE_KEY, '{not json');
    expect(loadSavedSession(storage)).toBeNull();
    // A v1 session (roster usernames) from before the simplification is simply dropped.
    storage.setItem(CLASSROOM_STORAGE_KEY, JSON.stringify({ v: 1, code: 'BKT4M9', className: '8B', teacherName: '', studentId: 'x', username: 'ali.k', uid: 'u', lastUsedAt: 0, lastHandinAt: 0, lastHandinTitle: '' }));
    expect(loadSavedSession(storage)).toBeNull();
    storage.setItem(CLASSROOM_STORAGE_KEY, JSON.stringify({ ...SESSION, uid: 7 }));
    expect(loadSavedSession(storage)).toBeNull();
    storage.setItem(CLASSROOM_STORAGE_KEY, JSON.stringify({ ...SESSION, lastUsedAt: 'yesterday' }));
    expect(loadSavedSession(storage)).toBeNull();
    storage.setItem(CLASSROOM_STORAGE_KEY, '"text"');
    expect(loadSavedSession(storage)).toBeNull();
    storage.setItem(CLASSROOM_STORAGE_KEY, 'null');
    expect(loadSavedSession(storage)).toBeNull();
  });
  it('drops unknown keys', () => {
    const storage = memoryStorage();
    storage.setItem(CLASSROOM_STORAGE_KEY, JSON.stringify({ ...SESSION, extra: true }));
    expect(loadSavedSession(storage)).toEqual(SESSION);
  });
  it('clears the session, keeps the last code', () => {
    const storage = memoryStorage();
    saveSession(SESSION, storage);
    saveLastCode('BKT4M9', storage);
    clearSession(storage);
    expect(loadSavedSession(storage)).toBeNull();
    expect(loadLastCode(storage)).toBe('BKT4M9');
  });
  it('survives a storage that throws', () => {
    const storage = throwingStorage();
    expect(() => saveSession(SESSION, storage)).not.toThrow();
    expect(loadSavedSession(storage)).toBeNull();
    expect(loadLastCode(storage)).toBe('');
    expect(() => saveLastCode('BKT4M9', storage)).not.toThrow();
    expect(() => clearSession(storage)).not.toThrow();
    expect(currentStudentName(storage)).toBe('');
  });
});

describe('last code', () => {
  it('stores the last code; an empty code removes it', () => {
    const storage = memoryStorage();
    expect(loadLastCode(storage)).toBe('');
    saveLastCode('BKT4M9', storage);
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBe('BKT4M9');
    saveLastCode('', storage);
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBeNull();
  });
});
