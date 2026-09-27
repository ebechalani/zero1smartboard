/**
 * src/classroom/errors.ts (docs/CLASSROOM.md §1.5, §4.6, §7.2): Firebase error mapping, the
 * request timeout, the text tables, placeholders and the quota reset time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClassroomError,
  STUDENT_ERROR_TEXT,
  TEACHER_ERROR_TEXT,
  errorText,
  nextMidnightIn,
  quotaResetText,
  toClassroomError,
  withTimeout,
  type ClassroomErrorCode,
} from '../src/classroom/errors';

const ALL_CODES: ClassroomErrorCode[] = [
  'not_configured', 'load_failed', 'app_updated', 'offline', 'timeout', 'quota', 'signup_limit',
  'auth_disabled', 'storage_blocked', 'popup_blocked', 'popup_closed', 'unauthorized_domain',
  'recent_login', 'not_ready', 'index_missing', 'bad_code', 'class_not_found', 'class_closed',
  'handins_closed', 'class_deleted', 'lost_identity', 'not_on_roster', 'device_removed', 'too_soon',
  'limit_reached', 'empty_sketch', 'too_large', 'code_collision', 'bad_roster', 'classes_left',
  'permission', 'unknown',
];

const firebaseError = (code: string) => ({ code, name: 'FirebaseError', message: `Firebase: ${code}` });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('toClassroomError', () => {
  it.each([
    ['unavailable', 'offline'],
    ['auth/network-request-failed', 'offline'],
    ['deadline-exceeded', 'timeout'],
    ['resource-exhausted', 'quota'],
    ['auth/too-many-requests', 'signup_limit'],
    ['auth/operation-not-allowed', 'auth_disabled'],
    ['auth/admin-restricted-operation', 'auth_disabled'],
    ['auth/web-storage-unsupported', 'storage_blocked'],
    ['auth/popup-blocked', 'popup_blocked'],
    ['auth/popup-closed-by-user', 'popup_closed'],
    ['auth/cancelled-popup-request', 'popup_closed'],
    ['auth/user-cancelled', 'popup_closed'],
    ['auth/unauthorized-domain', 'unauthorized_domain'],
    ['auth/requires-recent-login', 'recent_login'],
    ['failed-precondition', 'index_missing'],
    ['firestore/failed-precondition', 'index_missing'],
    ['permission-denied', 'permission'],
  ])('maps %s → %s', (firebase, code) => {
    const err = toClassroomError(firebaseError(firebase), 'student');
    expect(err).toBeInstanceOf(ClassroomError);
    expect(err.code).toBe(code);
    expect(err.message).toBe(STUDENT_ERROR_TEXT[code as ClassroomErrorCode].replace('{reset}', quotaResetText(new Date())));
    expect(toClassroomError(firebaseError(firebase), 'teacher').message).toBe(TEACHER_ERROR_TEXT[code as ClassroomErrorCode].replace(/\{reset\}|\{host\}|\{message\}/g, (m) => (m === '{reset}' ? quotaResetText(new Date()) : '')));
  });
  it('maps a failed import() to load_failed, or app_updated when flagged', () => {
    expect(toClassroomError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/student-sdk-abc.js'), 'student').code).toBe('load_failed');
    expect(toClassroomError(new TypeError('error loading dynamically imported module'), 'teacher').code).toBe('load_failed');
    expect(toClassroomError({ type: 'vite:preloadError', payload: new Error('x') }, 'student').code).toBe('app_updated');
    expect(toClassroomError(Object.assign(new Error('gone'), { appUpdated: true }), 'student').code).toBe('app_updated');
  });
  it('maps anything else to unknown with the message, and keeps a ClassroomError as it is', () => {
    const unknown = toClassroomError(new Error('boom'), 'teacher');
    expect(unknown.code).toBe('unknown');
    expect(unknown.message).toBe('Something went wrong: boom. Try again.');
    expect(toClassroomError('text', 'student').code).toBe('unknown');
    expect(toClassroomError(firebaseError('auth/some-new-code'), 'student').code).toBe('unknown');
    const mine = new ClassroomError('too_soon', 'custom message');
    expect(toClassroomError(mine, 'student')).toBe(mine);
    // Raised without a context (withTimeout): the bare code becomes the context's text.
    const bare = toClassroomError(new ClassroomError('timeout'), 'teacher');
    expect(bare.code).toBe('timeout');
    expect(bare.message).toBe(TEACHER_ERROR_TEXT.timeout);
  });
  it('reports offline for an unknown error while navigator.onLine is false', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(toClassroomError(new Error('x'), 'student').code).toBe('offline');
    expect(toClassroomError(firebaseError('permission-denied'), 'student').code).toBe('permission');
  });
});

describe('withTimeout', () => {
  it('rejects with timeout after the delay', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<void>(() => undefined), 1000);
    const outcome = pending.then(
      () => 'resolved',
      (e: ClassroomError) => e.code,
    );
    vi.advanceTimersByTime(999);
    await Promise.resolve();
    vi.advanceTimersByTime(1);
    expect(await outcome).toBe('timeout');
  });
  it('passes a value or an error through in time', async () => {
    vi.useFakeTimers();
    expect(await withTimeout(Promise.resolve(42), 1000)).toBe(42);
    await expect(withTimeout(Promise.reject(new Error('no')), 1000)).rejects.toThrow('no');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('texts', () => {
  it('both tables cover every code', () => {
    for (const code of ALL_CODES) {
      expect(typeof STUDENT_ERROR_TEXT[code], code).toBe('string');
      expect(typeof TEACHER_ERROR_TEXT[code], code).toBe('string');
    }
    expect(Object.keys(STUDENT_ERROR_TEXT).sort()).toEqual([...ALL_CODES].sort());
    expect(Object.keys(TEACHER_ERROR_TEXT).sort()).toEqual([...ALL_CODES].sort());
    expect(TEACHER_ERROR_TEXT.popup_closed).toBe('');
  });
  it('fills placeholders', () => {
    expect(errorText(STUDENT_ERROR_TEXT, 'class_not_found', { code: 'BKT-4M9' })).toBe('There is no class with the code BKT-4M9. Check the code with your teacher.');
    expect(errorText(STUDENT_ERROR_TEXT, 'class_closed', { class: '8B Robotics' })).toContain('Joining 8B Robotics is closed');
    expect(errorText(STUDENT_ERROR_TEXT, 'quota', { reset: '10:00' })).toContain('after 10:00.');
    expect(errorText(TEACHER_ERROR_TEXT, 'unknown', { message: 'boom' })).toBe('Something went wrong: boom. Try again.');
    expect(errorText(TEACHER_ERROR_TEXT, 'unauthorized_domain', { host: 'x.github.io' })).toContain('add x.github.io in Firebase');
    expect(errorText(TEACHER_ERROR_TEXT, 'quota')).toMatch(/after \d\d:\d\d \(your time\)/);
  });
});

describe('quotaResetText', () => {
  it('finds the next midnight in Los Angeles across the US DST change', () => {
    expect(nextMidnightIn(new Date('2026-03-07T20:00:00Z'), 'America/Los_Angeles').toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(nextMidnightIn(new Date('2026-03-08T20:00:00Z'), 'America/Los_Angeles').toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(nextMidnightIn(new Date('2026-03-08T07:30:00Z'), 'America/Los_Angeles').toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(nextMidnightIn(new Date('2026-11-01T20:00:00Z'), 'America/Los_Angeles').toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });
  it.each([
    ['2026-03-07T20:00:00Z', 'Europe/Paris', '09:00'], // both on standard time
    ['2026-03-08T20:00:00Z', 'Europe/Paris', '08:00'], // US on DST, Europe not yet
    ['2026-04-01T20:00:00Z', 'Europe/Paris', '09:00'], // both on DST
    ['2026-10-26T20:00:00Z', 'Europe/Paris', '08:00'], // Europe back on standard time, US still on DST
    ['2026-11-02T20:00:00Z', 'Europe/Paris', '09:00'],
    ['2026-03-07T20:00:00Z', 'Asia/Beirut', '10:00'],
    ['2026-03-08T20:00:00Z', 'Asia/Beirut', '09:00'],
    ['2026-04-01T20:00:00Z', 'Asia/Beirut', '10:00'],
    ['2026-11-02T20:00:00Z', 'Asia/Beirut', '10:00'],
  ])('%s viewed from %s → %s', (now, zone, text) => {
    expect(quotaResetText(new Date(now), 'en-GB', zone)).toBe(text);
    expect(quotaResetText(new Date(now), 'fr-FR', zone)).toBe(text);
  });
});
