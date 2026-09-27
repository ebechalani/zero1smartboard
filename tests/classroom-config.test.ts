/**
 * src/firebase-config.ts and src/classroom/firebase.ts (docs/CLASSROOM.md §5, §4.3): the committed
 * config is complete or empty (never half-filled), emulator mode counts as configured, and the
 * not-configured path (tested with a mocked empty config) downloads nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_CHECK_SITE_KEY, CLASSROOM_DEFAULTS, FIREBASE_CONFIG } from '../src/firebase-config';
import { EMULATOR_PROJECT_ID, STUDENT_APP_NAME, TEACHER_APP_NAME, activeFirebaseConfig, isClassroomConfigured, usesEmulator } from '../src/classroom/firebase';
import { LIMITS } from '../src/classroom/model';

const EMPTY = { apiKey: '', authDomain: '', projectId: '', appId: '' };
const FULL = { apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p', appId: 'a', storageBucket: 'ignored' };

/** src/classroom/firebase.ts loaded against a mocked src/firebase-config.ts. */
async function withConfig(config: Record<string, string>) {
  vi.resetModules();
  vi.doMock('../src/firebase-config', () => ({ FIREBASE_CONFIG: config, APP_CHECK_SITE_KEY: '', CLASSROOM_DEFAULTS: { keepWeeks: 10 } }));
  return import('../src/classroom/firebase');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('../src/firebase-config');
  vi.resetModules();
});

describe('firebase-config.ts', () => {
  it('is either completely empty or completely filled in (all four keys), so a half-filled paste is noticed', () => {
    const keys = [FIREBASE_CONFIG.apiKey, FIREBASE_CONFIG.authDomain, FIREBASE_CONFIG.projectId, FIREBASE_CONFIG.appId];
    const filled = keys.filter((k) => k !== '').length;
    expect([0, 4]).toContain(filled);
    expect(isClassroomConfigured()).toBe(filled === 4);
    expect(activeFirebaseConfig()).toBe(filled === 4 ? FIREBASE_CONFIG : null);
    if (filled === 4) expect(FIREBASE_CONFIG.authDomain).toBe(`${FIREBASE_CONFIG.projectId}.firebaseapp.com`);
  });
  it('App Check is off unless a site key is pasted; keepWeeks is in range', () => {
    expect(usesEmulator()).toBe(false);
    expect(typeof APP_CHECK_SITE_KEY).toBe('string');
    expect(CLASSROOM_DEFAULTS.keepWeeks).toBeGreaterThanOrEqual(LIMITS.keepWeeksMin);
    expect(CLASSROOM_DEFAULTS.keepWeeks).toBeLessThanOrEqual(LIMITS.keepWeeksMax);
  });
  it('emulator mode counts as configured with the demo project, whatever the file says', async () => {
    vi.stubEnv('VITE_CLASSROOM_EMULATOR', '1');
    const fb = await withConfig(EMPTY);
    expect(fb.usesEmulator()).toBe(true);
    expect(fb.isClassroomConfigured()).toBe(true);
    expect(fb.activeFirebaseConfig()).toEqual({ apiKey: 'demo-key', authDomain: 'demo-zero1.firebaseapp.com', projectId: EMULATOR_PROJECT_ID, appId: 'demo-app' });
  });
  it('a complete config counts as configured; an empty or half-filled one does not', async () => {
    expect((await withConfig(FULL)).isClassroomConfigured()).toBe(true);
    expect((await withConfig(FULL)).activeFirebaseConfig()?.projectId).toBe('p');
    expect((await withConfig(EMPTY)).isClassroomConfigured()).toBe(false);
    expect((await withConfig({ ...FULL, authDomain: '' })).isClassroomConfigured()).toBe(false);
    expect((await withConfig({ ...FULL, appId: '' })).activeFirebaseConfig()).toBeNull();
  });
});

describe('loaders while not configured', () => {
  it('reject with not_configured on both sides, before any download', async () => {
    const fb = await withConfig(EMPTY);
    await expect(fb.loadStudentFirebase()).rejects.toMatchObject({ code: 'not_configured', message: 'Classes are not set up on this site.' });
    await expect(fb.loadTeacherFirebase()).rejects.toMatchObject({ code: 'not_configured', message: 'The class platform is not set up on this site yet.' });
    expect(STUDENT_APP_NAME).toBe('z1-student');
    expect(TEACHER_APP_NAME).toBe('z1-teacher');
  });
});
