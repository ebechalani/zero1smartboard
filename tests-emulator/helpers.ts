/**
 * Shared setup of the emulator suites (docs/CLASSROOM.md §7.2): the rules test environment (for
 * seeding with the rules off and clearing), a Google teacher sign-in through the Auth emulator,
 * in-memory storages and a small wait helper.
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, writeBatch, type Firestore } from 'firebase/firestore';
import type { TeacherFirebase } from '../src/classroom/firebase';
import type { NewClassInput } from '../src/classroom/teacher';

export { memoryStorage } from '../tests/classroom-fakes';

export const PROJECT_ID = 'demo-zero1';
export const AUTH_EMULATOR = 'http://127.0.0.1:9099';

export const CLASS_INPUT: NewClassInput = { name: '8B Robotics' };

export const ALI = { firstName: 'Ali', lastName: 'Khoury' };
export const SARA = { firstName: 'Sara', lastName: 'Mansour' };

export const CHROME_LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export function rulesEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
}

/** Remove every account of the Auth emulator. */
export async function clearAuth(): Promise<void> {
  await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
}

/** Write documents with the rules off, in batches of 400. */
export async function seedDocs(env: RulesTestEnvironment, entries: { path: string; data: Record<string, unknown> }[]): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (let i = 0; i < entries.length; i += 400) {
      const batch = writeBatch(db);
      for (const { path, data } of entries.slice(i, i + 400)) batch.set(doc(db, path), data);
      await batch.commit();
    }
  });
}

/** Read one document with the rules off (null when missing). */
export async function readDoc(env: RulesTestEnvironment, path: string): Promise<Record<string, unknown> | null> {
  let result: Record<string, unknown> | null = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(ctx.firestore() as unknown as Firestore, path));
    result = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  });
  return result;
}

/** Update one document with the rules off. */
export async function patchDoc(env: RulesTestEnvironment, path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { updateDoc } = await import('firebase/firestore');
    await updateDoc(doc(ctx.firestore() as unknown as Firestore, path), data);
  });
}

/** Sign the teacher app in as a verified Google account through the Auth emulator. */
export async function signInTeacher(f: TeacherFirebase, sub = 'teacher-sub-1', email = 'mr.b@school.edu'): Promise<string> {
  const credential = GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name: 'Mr B' }));
  const { user } = await signInWithCredential(f.auth, credential);
  return user.uid;
}

/** Poll `condition` until it holds (or fail after `timeoutMs`). */
export async function waitFor(condition: () => boolean, timeoutMs = 10_000, what = 'condition'): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor: ${what} not met within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A stored member document, for seeding. */
export function storedMember(name: { firstName: string; lastName: string }, ownerUid: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...name,
    nameKey: `${name.firstName} ${name.lastName}`.toLowerCase(),
    ownerUid,
    joinedAt: new Date(),
    device: 'Chrome · Windows',
    handinCount: 0,
    lastHandinAt: null,
    lastHandinId: '',
    ...over,
  };
}

/** A stored hand-in document, for seeding. */
export function storedHandin(uid: string, name: { firstName: string; lastName: string }, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid,
    ...name,
    nameKey: `${name.firstName} ${name.lastName}`.toLowerCase(),
    ownerUid: '',
    kind: 'code',
    enc: 'plain',
    code: 'void setup() {}',
    workspace: '',
    ...over,
  };
}
