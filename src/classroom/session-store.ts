/**
 * The student's saved class session (docs/CLASSROOM.md §2.13, §4.6): `z1.classroom` in
 * localStorage and the last class code. Every access is wrapped in try/catch: the sandboxed
 * review frame has no storage at all.
 */

export const CLASSROOM_STORAGE_KEY = 'z1.classroom';
export const LAST_CODE_STORAGE_KEY = 'z1.classroom.lastCode';

export interface SavedSession {
  v: 2;
  code: string;
  className: string;
  firstName: string;
  lastName: string;
  uid: string;
  /** ms since epoch. */
  lastUsedAt: number;
  /** 0 = never. */
  lastHandinAt: number;
}

function localStore(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
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

/** The saved session; null on bad JSON, an older version, a wrong shape or a storage that throws. */
export function loadSavedSession(storage?: Storage): SavedSession | null {
  const raw = read(localStore(storage), CLASSROOM_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const s: unknown = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    if (o.v !== 2) return null;
    if (![o.code, o.className, o.firstName, o.lastName, o.uid].every(isString)) return null;
    if (!isNumber(o.lastUsedAt) || !isNumber(o.lastHandinAt)) return null;
    return {
      v: 2,
      code: o.code as string,
      className: o.className as string,
      firstName: o.firstName as string,
      lastName: o.lastName as string,
      uid: o.uid as string,
      lastUsedAt: o.lastUsedAt,
      lastHandinAt: o.lastHandinAt,
    };
  } catch {
    return null;
  }
}

/** Save the session (storage errors are swallowed). */
export function saveSession(session: SavedSession, storage?: Storage): void {
  write(localStore(storage), CLASSROOM_STORAGE_KEY, JSON.stringify(session));
}

/** Forget the session; the last code is kept. */
export function clearSession(storage?: Storage): void {
  write(localStore(storage), CLASSROOM_STORAGE_KEY, null);
}

export function loadLastCode(storage?: Storage): string {
  return read(localStore(storage), LAST_CODE_STORAGE_KEY) ?? '';
}

export function saveLastCode(code: string, storage?: Storage): void {
  write(localStore(storage), LAST_CODE_STORAGE_KEY, code === '' ? null : code);
}

/** The remembered student's name ("Ali Khoury"), '' when none: header label and .ino file names. */
export function currentStudentName(storage?: Storage): string {
  const saved = loadSavedSession(storage);
  return saved ? `${saved.firstName} ${saved.lastName}`.trim() : '';
}
