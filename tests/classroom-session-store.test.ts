/**
 * src/classroom/session-store.ts (docs/CLASSROOM.md §2.13, §7.2): the saved session, the last
 * code, the tab flag, and storages that throw.
 */
import { describe, expect, it } from 'vitest';
import {
  CLASSROOM_STORAGE_KEY,
  CONFIRMED_SESSION_KEY,
  LAST_CODE_STORAGE_KEY,
  clearSession,
  currentUsername,
  isConfirmedInTab,
  loadLastCode,
  loadSavedSession,
  markConfirmedInTab,
  saveLastCode,
  saveSession,
  type SavedSession,
} from '../src/classroom/session-store';
import { memoryStorage, throwingStorage } from './classroom-fakes';

const SESSION: SavedSession = {
  v: 1,
  code: 'BKT4M9',
  className: '8B Robotics',
  teacherName: 'Mr. B',
  studentId: 'aaaaaaa1',
  username: 'ali.k',
  uid: 'anon-1',
  lastUsedAt: 1_700_000_000_000,
  lastHandinAt: 0,
  lastHandinTitle: '',
};

describe('saved session', () => {
  it('round-trips', () => {
    const storage = memoryStorage();
    saveSession(SESSION, storage);
    expect(JSON.parse(storage.getItem(CLASSROOM_STORAGE_KEY)!)).toEqual(SESSION);
    expect(loadSavedSession(storage)).toEqual(SESSION);
    expect(currentUsername(storage)).toBe('ali.k');
  });
  it('is null when nothing is saved, on bad JSON, a wrong version or a wrong shape', () => {
    const storage = memoryStorage();
    expect(loadSavedSession(storage)).toBeNull();
    expect(currentUsername(storage)).toBe('');
    storage.setItem(CLASSROOM_STORAGE_KEY, '{not json');
    expect(loadSavedSession(storage)).toBeNull();
    storage.setItem(CLASSROOM_STORAGE_KEY, JSON.stringify({ ...SESSION, v: 2 }));
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
  it('clears the session and the tab flag, keeps the last code', () => {
    const storage = memoryStorage();
    const tab = memoryStorage();
    saveSession(SESSION, storage);
    saveLastCode('BKT4M9', storage);
    markConfirmedInTab('anon-1', tab);
    clearSession(storage, tab);
    expect(loadSavedSession(storage)).toBeNull();
    expect(isConfirmedInTab('anon-1', tab)).toBe(false);
    expect(loadLastCode(storage)).toBe('BKT4M9');
  });
  it('survives a storage that throws', () => {
    const storage = throwingStorage();
    expect(() => saveSession(SESSION, storage)).not.toThrow();
    expect(loadSavedSession(storage)).toBeNull();
    expect(loadLastCode(storage)).toBe('');
    expect(() => saveLastCode('BKT4M9', storage)).not.toThrow();
    expect(() => clearSession(storage, storage)).not.toThrow();
    expect(isConfirmedInTab('anon-1', storage)).toBe(false);
    expect(() => markConfirmedInTab('anon-1', storage)).not.toThrow();
    expect(currentUsername(storage)).toBe('');
  });
});

describe('last code and tab flag', () => {
  it('stores the last code; an empty code removes it', () => {
    const storage = memoryStorage();
    expect(loadLastCode(storage)).toBe('');
    saveLastCode('BKT4M9', storage);
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBe('BKT4M9');
    saveLastCode('', storage);
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBeNull();
  });
  it('the tab flag is per uid', () => {
    const tab = memoryStorage();
    expect(isConfirmedInTab('anon-1', tab)).toBe(false);
    markConfirmedInTab('anon-1', tab);
    expect(tab.getItem(CONFIRMED_SESSION_KEY)).toBe('anon-1');
    expect(isConfirmedInTab('anon-1', tab)).toBe(true);
    expect(isConfirmedInTab('anon-2', tab)).toBe(false);
    expect(isConfirmedInTab('', tab)).toBe(false);
  });
});
