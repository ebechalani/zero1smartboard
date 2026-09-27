/**
 * Firebase wiring of the class platform (docs/CLASSROOM.md §4.3): config detection, the two lazily
 * loaded named apps ('z1-student' with Firestore Lite, 'z1-teacher' with the full SDK), App Check
 * and the emulator hook. This file imports Firebase **types only**; the SDKs come through
 * `import('./student-sdk')` / `import('./teacher-sdk')`, so the simulator's entry chunk never
 * contains Firebase (tests/bundle-boundary.test.ts, scripts/check-bundle.mjs).
 */
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Firestore as LiteFirestore } from 'firebase/firestore/lite';
import { APP_CHECK_SITE_KEY, FIREBASE_CONFIG, type FirebaseWebConfig } from '../firebase-config';
import { ClassroomError, STUDENT_ERROR_TEXT, TEACHER_ERROR_TEXT } from './errors';

export const STUDENT_APP_NAME = 'z1-student';
export const TEACHER_APP_NAME = 'z1-teacher';
export const EMULATOR_PROJECT_ID = 'demo-zero1';
export const EMULATOR_AUTH_URL = 'http://127.0.0.1:9099';
export const EMULATOR_FIRESTORE_HOST = '127.0.0.1';
export const EMULATOR_FIRESTORE_PORT = 8080;

const EMULATOR_CONFIG: FirebaseWebConfig = {
  apiKey: 'demo-key',
  authDomain: 'demo-zero1.firebaseapp.com',
  projectId: EMULATOR_PROJECT_ID,
  appId: 'demo-app',
};

/** True in `vite --mode emulator` (import.meta.env.VITE_CLASSROOM_EMULATOR === '1'). */
export function usesEmulator(): boolean {
  try {
    return import.meta.env?.VITE_CLASSROOM_EMULATOR === '1';
  } catch {
    return false;
  }
}

/** The emulator demo config; else FIREBASE_CONFIG when apiKey, authDomain, projectId and appId are all non-empty; else null. */
export function activeFirebaseConfig(): FirebaseWebConfig | null {
  if (usesEmulator()) return EMULATOR_CONFIG;
  const { apiKey, authDomain, projectId, appId } = FIREBASE_CONFIG;
  return apiKey && authDomain && projectId && appId ? FIREBASE_CONFIG : null;
}

/** activeFirebaseConfig() !== null. Synchronous, no Firebase import. */
export function isClassroomConfigured(): boolean {
  return activeFirebaseConfig() !== null;
}

export type StudentSdk = typeof import('./student-sdk');
export type TeacherSdk = typeof import('./teacher-sdk');
export interface StudentFirebase {
  app: FirebaseApp;
  auth: Auth;
  db: LiteFirestore;
  sdk: StudentSdk;
}
export interface TeacherFirebase {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  sdk: TeacherSdk;
}

/** A HEAD of ./index.html succeeds: the site is reachable, so a missing chunk means a deploy happened. */
async function siteReachable(): Promise<boolean> {
  if (typeof fetch === 'undefined' || typeof location === 'undefined') return false;
  try {
    const response = await fetch(new URL('./index.html', location.href), { method: 'HEAD', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

/** A failed `import()` of an SDK chunk as 'app_updated' (a deploy replaced the hashed chunks) or 'load_failed'. */
async function importFailure(err: unknown, context: 'student' | 'teacher'): Promise<ClassroomError> {
  const texts = context === 'student' ? STUDENT_ERROR_TEXT : TEACHER_ERROR_TEXT;
  const preloadError = !!err && typeof err === 'object' && (err as { type?: unknown }).type === 'vite:preloadError';
  const code = preloadError || (await siteReachable()) ? 'app_updated' : 'load_failed';
  return new ClassroomError(code, texts[code], { cause: err });
}

function notConfigured(context: 'student' | 'teacher'): ClassroomError {
  const texts = context === 'student' ? STUDENT_ERROR_TEXT : TEACHER_ERROR_TEXT;
  return new ClassroomError('not_configured', texts.not_configured);
}

async function initStudent(): Promise<StudentFirebase> {
  const config = activeFirebaseConfig();
  if (!config) throw notConfigured('student');
  let sdk: StudentSdk;
  try {
    sdk = await import('./student-sdk');
  } catch (err) {
    throw await importFailure(err, 'student');
  }
  const emulator = usesEmulator();
  const app = sdk.getApps().find((a) => a.name === STUDENT_APP_NAME) ?? sdk.initializeApp(config, STUDENT_APP_NAME);
  if (APP_CHECK_SITE_KEY && !emulator) {
    sdk.initializeAppCheck(app, { provider: new sdk.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }
  let auth: Auth;
  try {
    // No popup resolver: students never open a sign-in window.
    auth = sdk.initializeAuth(app, { persistence: [sdk.indexedDBLocalPersistence, sdk.browserLocalPersistence] });
  } catch (err) {
    if ((err as { code?: unknown })?.code !== 'auth/already-initialized') throw err;
    auth = sdk.getAuth(app); // an earlier, partly failed attempt initialised Auth for this app
  }
  if (emulator) {
    try {
      sdk.connectAuthEmulator(auth, EMULATOR_AUTH_URL, { disableWarnings: true });
    } catch {
      // Already connected (same Auth instance).
    }
  }
  const db = sdk.getFirestore(app);
  if (emulator) {
    try {
      sdk.connectFirestoreEmulator(db, EMULATOR_FIRESTORE_HOST, EMULATOR_FIRESTORE_PORT);
    } catch {
      // Already connected (same app instance).
    }
  }
  return { app, auth, db, sdk };
}

async function initTeacher(): Promise<TeacherFirebase> {
  const config = activeFirebaseConfig();
  if (!config) throw notConfigured('teacher');
  let sdk: TeacherSdk;
  try {
    sdk = await import('./teacher-sdk');
  } catch (err) {
    throw await importFailure(err, 'teacher');
  }
  const emulator = usesEmulator();
  const app = sdk.getApps().find((a) => a.name === TEACHER_APP_NAME) ?? sdk.initializeApp(config, TEACHER_APP_NAME);
  if (APP_CHECK_SITE_KEY && !emulator) {
    sdk.initializeAppCheck(app, { provider: new sdk.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }
  let auth: Auth;
  try {
    // Session persistence only (D13): no teacher token in the shared storage of the github.io origin.
    // The popup resolver is a class in browsers; the Node build (emulator tests) exports a stub object.
    auth = sdk.initializeAuth(app, {
      persistence: [sdk.browserSessionPersistence],
      ...(typeof sdk.browserPopupRedirectResolver === 'function' ? { popupRedirectResolver: sdk.browserPopupRedirectResolver } : {}),
    });
  } catch (err) {
    if ((err as { code?: unknown })?.code !== 'auth/already-initialized') throw err;
    auth = sdk.getAuth(app); // an earlier, partly failed attempt initialised Auth for this app
  }
  if (emulator) {
    try {
      sdk.connectAuthEmulator(auth, EMULATOR_AUTH_URL, { disableWarnings: true });
    } catch {
      // Already connected (same Auth instance).
    }
  }
  // Memory cache only (D12): no student data is left on a shared teacher PC.
  const db = sdk.initializeFirestore(app, { localCache: sdk.memoryLocalCache() });
  if (emulator) {
    try {
      sdk.connectFirestoreEmulator(db, EMULATOR_FIRESTORE_HOST, EMULATOR_FIRESTORE_PORT);
    } catch {
      // Already connected.
    }
  }
  return { app, auth, db, sdk };
}

let studentPromise: Promise<StudentFirebase> | null = null;
let teacherPromise: Promise<TeacherFirebase> | null = null;

/**
 * Download (once, memoised) and initialise the student side: the named app 'z1-student', App Check
 * when APP_CHECK_SITE_KEY is set (not in emulator mode), Auth with IndexedDB/local persistence and no
 * popup resolver, Firestore Lite, the emulators in emulator mode.
 * Rejects with 'not_configured', 'load_failed' or 'app_updated'. A failed attempt is not memoised.
 */
export function loadStudentFirebase(): Promise<StudentFirebase> {
  if (!studentPromise) {
    studentPromise = initStudent().catch((err) => {
      studentPromise = null;
      throw err;
    });
  }
  return studentPromise;
}

/**
 * The same for the teacher: the app 'z1-teacher', Auth with session persistence and the popup
 * resolver, Firestore with the memory cache. Called at page load by the dashboard (not on click).
 */
export function loadTeacherFirebase(): Promise<TeacherFirebase> {
  if (!teacherPromise) {
    teacherPromise = initTeacher().catch((err) => {
      teacherPromise = null;
      throw err;
    });
  }
  return teacherPromise;
}
