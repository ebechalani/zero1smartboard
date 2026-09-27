/**
 * Errors of the class platform (docs/CLASSROOM.md §1.5, §4.6): one ClassroomError code for every
 * situation the UI has a text for, the mapping from Firebase errors, the two text tables and the
 * quota reset time. Pure: no Firebase.
 */
import { LIMITS } from './model';

export type ClassroomErrorCode =
  | 'not_configured'
  | 'load_failed'
  | 'app_updated'
  | 'offline'
  | 'timeout'
  | 'quota'
  | 'signup_limit'
  | 'auth_disabled'
  | 'storage_blocked'
  | 'popup_blocked'
  | 'popup_closed'
  | 'unauthorized_domain'
  | 'recent_login'
  | 'not_ready'
  | 'index_missing'
  | 'bad_code'
  | 'class_not_found'
  | 'handins_closed'
  | 'class_deleted'
  | 'lost_identity'
  | 'device_removed'
  | 'too_soon'
  | 'limit_reached'
  | 'empty_sketch'
  | 'too_large'
  | 'code_collision'
  | 'bad_name'
  | 'classes_left'
  | 'permission'
  | 'unknown';

export class ClassroomError extends Error {
  readonly code: ClassroomErrorCode;
  constructor(code: ClassroomErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = 'ClassroomError';
    this.code = code;
  }
}

/** Firebase (Auth and Firestore) error codes → ClassroomError codes (docs/CLASSROOM.md §1.5). */
const FIREBASE_CODES: Readonly<Record<string, ClassroomErrorCode>> = {
  unavailable: 'offline',
  'auth/network-request-failed': 'offline',
  'deadline-exceeded': 'timeout',
  'resource-exhausted': 'quota',
  'auth/too-many-requests': 'signup_limit',
  'auth/operation-not-allowed': 'auth_disabled',
  'auth/admin-restricted-operation': 'auth_disabled',
  'auth/web-storage-unsupported': 'storage_blocked',
  'auth/popup-blocked': 'popup_blocked',
  'auth/popup-closed-by-user': 'popup_closed',
  'auth/cancelled-popup-request': 'popup_closed',
  'auth/user-cancelled': 'popup_closed',
  'auth/unauthorized-domain': 'unauthorized_domain',
  'auth/requires-recent-login': 'recent_login',
  'failed-precondition': 'index_missing',
  'permission-denied': 'permission',
};

/** Browser messages for a dynamic import() that could not be fetched. */
const IMPORT_FAILURE = /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed|ChunkLoadError|NetworkError/i;

function firebaseCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  // Firestore codes come as 'permission-denied' or 'firestore/permission-denied'; Auth as 'auth/...'.
  return code.startsWith('firestore/') ? code.slice('firestore/'.length) : code;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Any thrown value as a ClassroomError, with the text of the table for `context` as its message. */
export function toClassroomError(err: unknown, context: 'student' | 'teacher'): ClassroomError {
  const table = context === 'student' ? STUDENT_ERROR_TEXT : TEACHER_ERROR_TEXT;
  if (err instanceof ClassroomError) {
    // Raised without a context (withTimeout): the message is still the bare code; fill in the text.
    return err.message === err.code ? new ClassroomError(err.code, errorText(table, err.code), { cause: err.cause }) : err;
  }
  const make = (code: ClassroomErrorCode, message?: string) =>
    new ClassroomError(code, errorText(table, code, { message: message ?? '' }), { cause: err });
  const original = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const code = firebaseCode(err);
  if (code !== null && code in FIREBASE_CODES) return make(FIREBASE_CODES[code]);
  if (err && typeof err === 'object') {
    if ((err as { type?: unknown }).type === 'vite:preloadError' || (err as { appUpdated?: unknown }).appUpdated === true) {
      return make('app_updated');
    }
  }
  if (err instanceof Error && IMPORT_FAILURE.test(original)) return make(isOffline() ? 'offline' : 'load_failed');
  if (isOffline()) return make('offline');
  return make('unknown', original || String(err));
}

/** `promise`, or a ClassroomError('timeout') after `ms` (the promise keeps running: a batch may still land). */
export function withTimeout<T>(promise: Promise<T>, ms: number = LIMITS.requestTimeoutMs): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ClassroomError('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Texts shown to students (plain English for a 12- to 16-year-old, docs/CLASSROOM.md §1.5). */
export const STUDENT_ERROR_TEXT: Readonly<Record<ClassroomErrorCode, string>> = {
  not_configured: 'Classes are not set up on this site.',
  load_failed: 'Could not load the class features. Check your internet connection and try again.',
  app_updated: 'The simulator was updated. Reload the page to continue (your work is saved).',
  offline: 'You seem to be offline. Check your internet connection and try again.',
  timeout: 'The class did not answer in time. Try again.',
  quota: 'The class platform has reached today\'s free limit. It works again after {reset}. Meanwhile use Share → Download .ino.',
  signup_limit: 'Too many new sign-ins on your school network right now. Try again in a few minutes, or use Share → Download .ino.',
  auth_disabled: 'Joining classes is switched off on this simulator. Tell your teacher.',
  storage_blocked: 'Your browser blocks the storage this page needs (private window?). Use a normal window.',
  popup_blocked: 'Your browser blocked a pop-up window. Allow pop-ups for this site and try again.',
  popup_closed: '',
  unauthorized_domain: 'Joining classes is not set up for this web address. Tell your teacher.',
  recent_login: 'Please sign in again to confirm.',
  not_ready: 'Still loading. Try again in a moment.',
  index_missing: 'The class platform is not fully set up yet. Tell your teacher.',
  bad_code: 'A class code has 6 letters and digits, like BKT-4M9. Check it with your teacher.',
  class_not_found: 'There is no class with the code {code}. Check the code with your teacher.',
  handins_closed: '{class} no longer accepts hand-ins. If you have a new class code, choose Different class.',
  class_deleted: 'This class no longer exists.',
  lost_identity: 'This computer lost its class sign-in. Enter the class code and your name again.',
  device_removed: 'Your teacher removed this computer from the class. Enter your name again.',
  too_soon: 'Wait a few seconds before handing in again.',
  limit_reached: 'This computer has handed in 300 times in this class. Tell your teacher.',
  empty_sketch: 'Your sketch is empty. There is nothing to hand in yet.',
  too_large: 'Your work is too big to hand in (more than 50,000 characters of code). Use Share → Download .ino instead.',
  code_collision: 'Could not find a free class code. Try again.',
  bad_name: 'Type your first name and your last name (letters only, up to 30 characters each).',
  classes_left: 'Delete all your classes first (step 1).',
  permission: 'The class did not accept this. Try again; if it keeps failing, tell your teacher.',
  unknown: 'Something went wrong. Try again.',
};

/** Texts shown on the teacher dashboard (docs/CLASSROOM.md §1.5). */
export const TEACHER_ERROR_TEXT: Readonly<Record<ClassroomErrorCode, string>> = {
  not_configured: 'The class platform is not set up on this site yet.',
  load_failed: 'Could not load the dashboard. Check your internet connection and reload the page.',
  app_updated: 'The dashboard was updated. Reload the page.',
  offline: 'You are offline. Check the connection; changes are saved when you are back online.',
  timeout: 'The server did not answer in time. Try again.',
  quota: 'The class platform reached its free daily limit. It works again after {reset} (your time).',
  signup_limit: 'Too many sign-ins from this network right now. Try again in a few minutes.',
  auth_disabled: 'Google sign-in is not switched on in the Firebase project (see docs/CLASSROOM.md step 3).',
  storage_blocked: 'Your browser blocks the storage sign-in needs (private window?). Use a normal window.',
  popup_blocked: 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and click Sign in again.',
  popup_closed: '',
  unauthorized_domain:
    'This web address is not allowed to sign in yet: add {host} in Firebase → Authentication → Settings → Authorized domains.',
  recent_login: 'Please sign in again to confirm.',
  not_ready: 'Still loading. Try again in a moment.',
  index_missing:
    'The database is missing an index. The site maintainer must deploy firestore.indexes.json (docs/CLASSROOM.md, step 7).',
  bad_code: 'That is not a valid class code.',
  class_not_found: 'This class no longer exists.',
  handins_closed: 'This class no longer accepts hand-ins.',
  class_deleted: 'This class no longer exists.',
  lost_identity: 'The sign-in was lost. Sign in again.',
  device_removed: 'This computer was removed from the class.',
  too_soon: 'Wait a few seconds and try again.',
  limit_reached: 'This computer has reached its hand-in limit.',
  empty_sketch: 'The sketch is empty.',
  too_large: 'This hand-in is larger than the simulator accepts.',
  code_collision: 'Could not find a free class code. Try again.',
  bad_name: 'That name is not valid.',
  classes_left: 'Delete all your classes first (step 1).',
  permission: 'You do not have access to this class. Sign in with the account that created it.',
  unknown: 'Something went wrong: {message}. Try again.',
};

/**
 * The text of `code` with its placeholders filled: {code}, {class}, {host}, {message} from `vars`;
 * {reset} from quotaResetText(now) and {host} from location.host unless given.
 */
export function errorText(
  table: Readonly<Record<ClassroomErrorCode, string>>,
  code: ClassroomErrorCode,
  vars: Record<string, string> = {},
): string {
  return table[code].replace(/\{(\w+)\}/g, (_, name: string) => {
    if (name in vars) return vars[name];
    if (name === 'reset') return quotaResetText(new Date());
    if (name === 'host') return typeof location !== 'undefined' ? location.host : '';
    return '';
  });
}

const QUOTA_TIME_ZONE = 'America/Los_Angeles';

/** The wall clock of `date` in `timeZone`, as if it were UTC (ms), for offset arithmetic. */
function wallClockUtc(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
}

/** The instant of the next midnight in `timeZone` after `now` (DST-correct: two passes over the offset). */
export function nextMidnightIn(now: Date, timeZone: string): Date {
  const wall = wallClockUtc(now, timeZone);
  const nextWall = Date.UTC(new Date(wall).getUTCFullYear(), new Date(wall).getUTCMonth(), new Date(wall).getUTCDate() + 1);
  let guess = nextWall - (wall - now.getTime());
  const offsetAtGuess = wallClockUtc(new Date(guess), timeZone) - guess;
  guess = nextWall - offsetAtGuess;
  return new Date(guess);
}

/**
 * Next Firestore quota reset (midnight America/Los_Angeles) as local time text ('10:00'); via
 * Intl, DST-correct. `timeZone` overrides the viewer's zone (tests).
 */
export function quotaResetText(now: Date, locale?: string, timeZone?: string): string {
  const reset = nextMidnightIn(now, QUOTA_TIME_ZONE);
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(reset);
}
