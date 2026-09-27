/**
 * The student's saved class session (docs/CLASSROOM.md §2.13, §4.6): `z1.classroom` in
 * localStorage, the last class code, and the per-tab "confirmed" flag in sessionStorage.
 * Every access is wrapped in try/catch: the sandboxed review frame has no storage at all.
 */

export const CLASSROOM_STORAGE_KEY = 'z1.classroom';
export const LAST_CODE_STORAGE_KEY = 'z1.classroom.lastCode';
/** sessionStorage: the uid confirmed in this tab (S5). */
export const CONFIRMED_SESSION_KEY = 'z1.classroom.confirmed';

export interface SavedSession {
  v: 1;
  code: string;
  className: string;
  teacherName: string;
  studentId: string;
  username: string;
  uid: string;
  /** ms since epoch. */
  lastUsedAt: number;
  /** 0 = never. */
  lastHandinAt: number;
  /** Task title or title of the last hand-in ('' = none). */
  lastHandinTitle: string;
}

function localStore(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function tabStore(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function read(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | null, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Private mode, quota exceeded or a sandboxed frame: the session simply is not remembered.
  }
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The saved session; null on bad JSON, a wrong shape or a storage that throws. */
export function loadSavedSession(storage?: Storage): SavedSession | null {
  const raw = read(localStore(storage), CLASSROOM_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const s: unknown = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    if (o.v !== 1) return null;
    if (![o.code, o.className, o.teacherName, o.studentId, o.username, o.uid, o.lastHandinTitle].every(isString)) return null;
    if (!isNumber(o.lastUsedAt) || !isNumber(o.lastHandinAt)) return null;
    return {
      v: 1,
      code: o.code as string,
      className: o.className as string,
      teacherName: o.teacherName as string,
      studentId: o.studentId as string,
      username: o.username as string,
      uid: o.uid as string,
      lastUsedAt: o.lastUsedAt,
      lastHandinAt: o.lastHandinAt,
      lastHandinTitle: o.lastHandinTitle as string,
    };
  } catch {
    return null;
  }
}

/** Save the session (storage errors are swallowed). */
export function saveSession(session: SavedSession, storage?: Storage): void {
  write(localStore(storage), CLASSROOM_STORAGE_KEY, JSON.stringify(session));
}

/** Forget the session and the tab's confirm flag; the last code is kept. */
export function clearSession(storage?: Storage, tabStorage?: Storage): void {
  write(localStore(storage), CLASSROOM_STORAGE_KEY, null);
  write(tabStore(tabStorage), CONFIRMED_SESSION_KEY, null);
}

export function loadLastCode(storage?: Storage): string {
  return read(localStore(storage), LAST_CODE_STORAGE_KEY) ?? '';
}

export function saveLastCode(code: string, storage?: Storage): void {
  write(localStore(storage), LAST_CODE_STORAGE_KEY, code === '' ? null : code);
}

export function isConfirmedInTab(uid: string, tabStorage?: Storage): boolean {
  return uid !== '' && read(tabStore(tabStorage), CONFIRMED_SESSION_KEY) === uid;
}

export function markConfirmedInTab(uid: string, tabStorage?: Storage): void {
  write(tabStore(tabStorage), CONFIRMED_SESSION_KEY, uid);
}

/** The joined username, '' when none: header label and .ino file names (Share, Arduino IDE dialog). */
export function currentUsername(storage?: Storage): string {
  return loadSavedSession(storage)?.username ?? '';
}
