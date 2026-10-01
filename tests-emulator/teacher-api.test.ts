/**
 * The real TeacherApi (docs/CLASSROOM.md §4.8, §7.2) against the Auth and Firestore emulators.
 * The teacher signs in with a Google credential through the Auth emulator; signIn() itself
 * (the popup) is covered by the dashboard's UI tests with a fake.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { Timestamp, type Firestore } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { loadStudentFirebase, loadTeacherFirebase } from '../src/classroom/firebase';
import { newHandinId, type HandinDraft } from '../src/classroom/model';
import { createStudentApi } from '../src/classroom/student';
import { createTeacherApi, type ClassDetail, type ClassSummary, type HandinsUpdate, type Member, type TeacherApi, type Unsubscribe } from '../src/classroom/teacher';
import { ALI, CHROME_LINUX, CLASS_INPUT, SARA, memoryStorage, readDoc, rulesEnv, seedDocs, signInTeacher, storedHandin, storedMember, waitFor } from './helpers';

let env: RulesTestEnvironment;
let teacher: TeacherApi;
let teacherUid: string;
const subscriptions: Unsubscribe[] = [];
const track = (u: Unsubscribe) => {
  subscriptions.push(u);
  return u;
};
const noError = (e: Error) => {
  throw e;
};
const createClass = (over: Partial<typeof CLASS_INPUT> = {}) => teacher.createClass({ ...CLASS_INPUT, ...over });
const day = 86_400_000;

function seedHandins(code: string, n: number, over: (i: number) => Record<string, unknown>) {
  return seedDocs(
    env,
    Array.from({ length: n }, (_, i) => ({
      path: `classes/${code}/handins/${'S'.repeat(16)}${String(i).padStart(4, '0')}`,
      data: storedHandin('stu1', ALI, { ownerUid: teacherUid, ...over(i) }),
    })),
  );
}

beforeAll(async () => {
  env = await rulesEnv();
  teacher = createTeacherApi();
  await teacher.ready;
  teacherUid = await signInTeacher(await loadTeacherFirebase());
});
afterAll(async () => env.cleanup());
beforeEach(() => env.clearFirestore());
afterEach(() => {
  subscriptions.splice(0).forEach((u) => u());
});

describe('sign-in state', () => {
  it('ready resolves and onUser reports the Google teacher', async () => {
    const seen: unknown[] = [];
    track(teacher.onUser((u) => seen.push(u)));
    await waitFor(() => seen.length > 0, 5000, 'onUser');
    expect(seen[0]).toMatchObject({ uid: teacherUid, email: 'mr.b@school.edu', name: 'Mr B' });
  });
});

describe('classes', () => {
  it('creates a class (cleaned name, defaults, schema 2) and retries after a code collision', async () => {
    const cls = await teacher.createClass({ name: '  8B   Robotics ' });
    expect(cls.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ3479]{6}$/);
    expect(cls).toMatchObject({ name: '8B Robotics', ownerUid: teacherUid, handinsOpen: true, deleting: false, keepWeeks: 10 });
    const stored = await readDoc(env, `classes/${cls.code}`);
    expect(stored).toMatchObject({ schema: 2, ownerUid: teacherUid, name: '8B Robotics', handinsOpen: true, keepWeeks: 10, deleting: false });
    expect(Object.keys(stored!).sort()).toEqual(['createdAt', 'deleting', 'handinsOpen', 'keepWeeks', 'name', 'ownerUid', 'schema', 'updatedAt']);
    expect(stored?.createdAt).toBeInstanceOf(Timestamp);
    await expect(teacher.createClass({ name: '   ' })).rejects.toMatchObject({ code: 'unknown' });

    // Collision: the first generated code is already taken (scripted bytes), the second one is free.
    let calls = 0;
    const scripted = createTeacherApi({ randomBytes: (n) => (calls++ === 0 ? Uint8Array.from([0, 1, 2, 3, 4, 5]) : crypto.getRandomValues(new Uint8Array(n))) });
    await scripted.ready;
    await seedDocs(env, [{ path: 'classes/BCDFGH', data: { ...(await readDoc(env, `classes/${cls.code}`))!, ownerUid: 'someone' } }]);
    const second = await scripted.createClass(CLASS_INPUT);
    expect(second.code).not.toBe('BCDFGH');
    const collide = createTeacherApi({ randomBytes: () => Uint8Array.from([0, 1, 2, 3, 4, 5]) });
    await collide.ready;
    await expect(collide.createClass(CLASS_INPUT)).rejects.toMatchObject({ code: 'code_collision' });
  });
  it('watchClasses lists own classes newest first and follows changes', async () => {
    const lists: ClassSummary[][] = [];
    track(teacher.watchClasses((l) => lists.push(l), noError));
    await waitFor(() => lists.length > 0);
    expect(lists.at(-1)).toEqual([]);
    const a = await createClass({ name: 'A' });
    const b = await createClass({ name: 'B' });
    await waitFor(() => (lists.at(-1)?.length ?? 0) === 2);
    expect(lists.at(-1)!.map((c) => c.name)).toEqual(['B', 'A']);
    expect(lists.at(-1)![1]).toMatchObject({ code: a.code, handinsOpen: true, deleting: false });
    await teacher.updateClass(b.code, { name: 'B2', handinsOpen: false });
    await waitFor(() => lists.at(-1)?.[0].name === 'B2');
    expect(lists.at(-1)![0].handinsOpen).toBe(false);
  });
  it('watchClass follows the name, the switch and the retention, then the deletion', async () => {
    const cls = await createClass();
    const seen: (ClassDetail | null)[] = [];
    track(teacher.watchClass(cls.code, (c) => seen.push(c), noError));
    await waitFor(() => seen.length > 0);
    expect(seen.at(-1)).toMatchObject({ code: cls.code, name: '8B Robotics', handinsOpen: true, keepWeeks: 10 });
    await teacher.updateClass(cls.code, { keepWeeks: 20, handinsOpen: false, name: '8B' });
    await waitFor(() => seen.at(-1)?.keepWeeks === 20);
    expect(seen.at(-1)).toMatchObject({ name: '8B', handinsOpen: false });
    await teacher.updateClass(cls.code, { keepWeeks: 99 }); // clamped
    await waitFor(() => seen.at(-1)?.keepWeeks === 52);
    await teacher.deleteClass(cls.code);
    await waitFor(() => seen.at(-1) === null);
  });
});

describe('members', () => {
  it('watchMembers (newest first, with the names), removeDevice, removeUnusedDevices', async () => {
    const cls = await createClass();
    const member = (name: { firstName: string; lastName: string }, joinedMs: number, lastHandinMs: number | null) =>
      storedMember(name, teacherUid, {
        joinedAt: Timestamp.fromMillis(joinedMs),
        handinCount: lastHandinMs ? 1 : 0,
        lastHandinAt: lastHandinMs ? Timestamp.fromMillis(lastHandinMs) : null,
      });
    await seedDocs(env, [
      { path: `classes/${cls.code}/members/old`, data: member(ALI, Date.now() - 40 * day, null) },
      { path: `classes/${cls.code}/members/active`, data: member(ALI, Date.now() - 40 * day, Date.now() - day) },
      { path: `classes/${cls.code}/members/fresh`, data: member(SARA, Date.now() - day, null) },
    ]);
    const seen: Member[][] = [];
    track(teacher.watchMembers(cls.code, (m) => seen.push(m), noError));
    await waitFor(() => (seen.at(-1)?.length ?? 0) === 3);
    expect(seen.at(-1)![0].uid).toBe('fresh'); // newest joined first
    expect(seen.at(-1)!.map((m) => m.uid).sort()).toEqual(['active', 'fresh', 'old']);
    expect(seen.at(-1)![0]).toMatchObject({ uid: 'fresh', ...SARA, nameKey: 'sara mansour', device: 'Chrome · Windows', handinCount: 0, lastHandinAt: null });
    expect(await teacher.removeUnusedDevices(cls.code, 30)).toBe(1);
    await waitFor(() => (seen.at(-1)?.length ?? 0) === 2);
    expect(seen.at(-1)!.map((m) => m.uid).sort()).toEqual(['active', 'fresh']);
    await teacher.removeDevice(cls.code, 'fresh');
    await waitFor(() => (seen.at(-1)?.length ?? 0) === 1);
    await teacher.removeDevice(cls.code, 'fresh'); // idempotent
  });
});

describe('hand-ins', () => {
  it('watchTodayHandins reports a student hand-in with its name, and removals', async () => {
    const cls = await createClass();
    const updates: HandinsUpdate[] = [];
    track(teacher.watchTodayHandins(cls.code, (u) => updates.push(u), noError));
    await waitFor(() => updates.length > 0);
    expect(updates[0].items).toEqual([]);

    const student = createStudentApi({ storage: memoryStorage(), userAgent: CHROME_LINUX, timeoutMs: 15_000 });
    const session = await student.join(await student.findClass(cls.code), ALI);
    const draft: HandinDraft = { kind: 'code', code: 'void setup() {}\n', workspaceJson: '', python: '' };
    const id = newHandinId();
    await student.handIn(session, draft, id);
    await waitFor(() => updates.some((u) => u.added.includes(id)), 10_000, 'added');
    expect(updates.at(-1)!.items[0]).toMatchObject({ id, ...ALI, nameKey: 'ali khoury', uid: session.uid, kind: 'code' });

    await teacher.deleteHandin(cls.code, id);
    await waitFor(() => updates.some((u) => u.removed.includes(id)), 10_000, 'removed');
    await teacher.deleteHandin(cls.code, id); // idempotent
    student.forget();
  });
  it('loadHandins and studentHandins (by nameKey) page; countHandinsBefore and pruneHandins respect the cap', async () => {
    const cls = await createClass();
    const base = Date.now() - 10 * day;
    await seedHandins(cls.code, 150, (i) => ({ createdAt: Timestamp.fromMillis(base + i * 1000), ...(i < 12 ? { ...SARA, nameKey: 'sara mansour' } : {}) }));
    const page1 = await teacher.loadHandins(cls.code, new Date(base - 1000));
    expect(page1.items).toHaveLength(100);
    expect(page1.hasMore).toBe(true);
    expect(page1.items[0].id.endsWith('0149')).toBe(true);
    const page2 = await teacher.loadHandins(cls.code, new Date(base - 1000), { before: page1.items[99].createdAt! });
    expect(page2.items).toHaveLength(50);
    expect(page2.items.at(-1)!.id.endsWith('0000')).toBe(true);
    expect(page2.hasMore).toBe(false);
    expect((await teacher.loadHandins(cls.code, new Date())).items).toEqual([]);

    const sara = await teacher.studentHandins(cls.code, 'sara mansour');
    expect(sara.items).toHaveLength(10);
    expect(sara.items.every((h) => h.firstName === 'Sara')).toBe(true);
    expect(sara.items[0].id.endsWith('0011')).toBe(true);
    expect(sara.hasMore).toBe(true);
    const saraMore = await teacher.studentHandins(cls.code, 'sara mansour', { before: sara.items[9].createdAt! });
    expect(saraMore).toMatchObject({ hasMore: false });
    expect(saraMore.items.map((h) => h.id.slice(-4))).toEqual(['0001', '0000']);

    expect(await teacher.countHandinsBefore(cls.code, new Date(base + 50 * 1000))).toBe(50);
    expect(await teacher.pruneHandins(cls.code, new Date(base + 130 * 1000), 100)).toBe(100);
    expect(await teacher.countHandinsBefore(cls.code, new Date())).toBe(50);
    expect(await teacher.pruneHandins(cls.code, new Date(base + 130 * 1000), 500)).toBe(30);
    expect(await teacher.countHandinsBefore(cls.code, new Date())).toBe(20);
  });
});

describe('deletion', () => {
  it('deleteClass over 900 documents: budget → more, then done; progress is reported', async () => {
    const cls = await createClass();
    await seedHandins(cls.code, 850, (i) => ({ createdAt: Timestamp.fromMillis(Date.now() - i * 1000) }));
    await seedDocs(env, Array.from({ length: 50 }, (_, i) => ({ path: `classes/${cls.code}/members/m${i}`, data: storedMember(ALI, teacherUid) })));
    const progress: [number, number | null][] = [];
    expect(await teacher.deleteClass(cls.code, (done, total) => progress.push([done, total]), 500)).toBe('more');
    expect(progress[0]).toEqual([0, 900]);
    expect(progress.at(-1)![0]).toBe(500);
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(await readDoc(env, `classes/${cls.code}`)).toMatchObject({ deleting: true, handinsOpen: false });
    expect(await teacher.countHandinsBefore(cls.code, new Date(Date.now() + day))).toBe(400); // 50 members + 450 hand-ins went
    expect(await teacher.deleteClass(cls.code)).toBe('done');
    expect(await readDoc(env, `classes/${cls.code}`)).toBeNull();
    // The class is gone, so the owner's own count() is now denied by the rules: count with them off.
    let left = -1;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { collection, getCountFromServer } = await import('firebase/firestore');
      left = (await getCountFromServer(collection(ctx.firestore() as unknown as Firestore, `classes/${cls.code}/handins`))).data().count;
    });
    expect(left).toBe(0);
  });
  it('deleteAllClasses, then deleteAccount (classes_left first; not_ready without the class list)', async () => {
    const a = await createClass({ name: 'A' });
    const b = await createClass({ name: 'B' });
    await seedHandins(a.code, 3, () => ({ createdAt: Timestamp.now() }));
    const lists: ClassSummary[][] = [];
    track(teacher.watchClasses((l) => lists.push(l), noError));
    await waitFor(() => (lists.at(-1)?.length ?? 0) === 2);
    await expect(teacher.deleteAccount()).rejects.toMatchObject({ code: 'classes_left' });
    const texts: string[] = [];
    expect(await teacher.deleteAllClasses((t) => texts.push(t))).toBe('done');
    expect(texts.some((t) => t.startsWith('Deleting A…'))).toBe(true);
    expect(await readDoc(env, `classes/${a.code}`)).toBeNull();
    expect(await readDoc(env, `classes/${b.code}`)).toBeNull();
    await waitFor(() => lists.at(-1)?.length === 0);

    const fresh = createTeacherApi({
      reauthenticate: (f, user) => signInWithCredential(f.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: 'teacher-sub-1', email: user.email, email_verified: true }))),
    });
    await fresh.ready;
    await expect(fresh.deleteAccount()).rejects.toMatchObject({ code: 'not_ready' });
    const freshLists: ClassSummary[][] = [];
    track(fresh.watchClasses((l) => freshLists.push(l), noError));
    await waitFor(() => freshLists.length > 0);
    // As the dashboard does (T11/T12): no listener stays open while the account goes away.
    subscriptions.splice(0).forEach((u) => u());
    await fresh.deleteAccount();
    const f = await loadTeacherFirebase();
    expect(f.auth.currentUser).toBeNull();
    teacherUid = await signInTeacher(f); // the account is gone: sign in again for the next tests
    void loadStudentFirebase;
  });
});
