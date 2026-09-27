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
import { CHROME_LINUX, CLASS_INPUT, memoryStorage, readDoc, rulesEnv, seedDocs, signInTeacher, storedHandin, waitFor } from './helpers';

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

function seedHandins(code: string, n: number, over: (i: number) => Record<string, unknown>) {
  return seedDocs(
    env,
    Array.from({ length: n }, (_, i) => ({
      path: `classes/${code}/handins/${'S'.repeat(16)}${String(i).padStart(4, '0')}`,
      data: storedHandin('stu1', 'aaaaaaa1', 'ali.k', { ownerUid: teacherUid, ...over(i) }).data,
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
  it('creates a class (validated input, defaults) and retries after a code collision', async () => {
    const cls = await createClass();
    expect(cls.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ3479]{6}$/);
    expect(cls).toMatchObject({ name: '8B Robotics', teacherName: 'Mr. B', ownerUid: teacherUid, joinOpen: true, handinsOpen: true, deleting: false, keepWeeks: 10, currentTaskId: '', studentCount: 2 });
    expect(cls.students.map((s) => s.username)).toEqual(['ali.k', 'sara.m']);
    expect(cls.tasks).toHaveLength(1);
    expect(cls.tasks[0].taskId).toMatch(/^[a-z0-9]{6}$/);
    const stored = await readDoc(env, `classes/${cls.code}`);
    expect(stored).toMatchObject({ schema: 1, ownerUid: teacherUid, rejoin: {}, deleting: false, handinsOpen: true });
    expect(stored?.createdAt).toBeInstanceOf(Timestamp);

    await expect(createClass({ students: [{ studentId: 'aaaaaaa1', username: 'Ali K' }] })).rejects.toMatchObject({ code: 'bad_roster' });
    await expect(createClass({ students: [{ studentId: 'bad', username: 'ali.k' }] })).rejects.toMatchObject({ code: 'bad_roster' });
    await expect(createClass({ tasks: ['x'.repeat(61)] })).rejects.toMatchObject({ code: 'bad_roster' });

    // Collision: the first generated code is already taken (scripted bytes), the second one is free.
    let calls = 0;
    const scripted = createTeacherApi({ randomBytes: (n) => (calls++ === 0 ? Uint8Array.from([0, 1, 2, 3, 4, 5]) : crypto.getRandomValues(new Uint8Array(n))) });
    await scripted.ready;
    await seedDocs(env, [{ path: 'classes/BCDFGH', data: { ...(await readDoc(env, `classes/${cls.code}`))!, ownerUid: 'someone' } }]);
    const second = await scripted.createClass({ ...CLASS_INPUT, tasks: [] });
    expect(second.code).not.toBe('BCDFGH');
    const collide = createTeacherApi({ randomBytes: () => Uint8Array.from([0, 1, 2, 3, 4, 5]) });
    await collide.ready;
    await expect(collide.createClass({ ...CLASS_INPUT, tasks: [] })).rejects.toMatchObject({ code: 'code_collision' });
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
    expect(lists.at(-1)![1]).toMatchObject({ code: a.code, studentCount: 2, joinOpen: true, joinWindowAt: null });
    await teacher.updateClass(b.code, { name: 'B2', handinsOpen: false });
    await waitFor(() => lists.at(-1)?.[0].name === 'B2');
    expect(lists.at(-1)![0].handinsOpen).toBe(false);
  });
  it('watchClass + joining controls: window, close, rejoin, and the switch resets the window', async () => {
    const cls = await createClass({ joinOpen: false });
    const seen: (ClassDetail | null)[] = [];
    track(teacher.watchClass(cls.code, (c) => seen.push(c), noError));
    await waitFor(() => seen.length > 0);
    expect(seen.at(-1)).toMatchObject({ joinOpen: false, joinWindowAt: null });
    await teacher.openJoinWindow(cls.code);
    await waitFor(() => seen.at(-1)?.joinWindowAt instanceof Date);
    expect(Math.abs(seen.at(-1)!.joinWindowAt!.getTime() - Date.now())).toBeLessThan(60_000);
    await teacher.letRejoin(cls.code, 'aaaaaaa1');
    await waitFor(() => 'aaaaaaa1' in (seen.at(-1)?.rejoin ?? {}));
    await teacher.closeJoining(cls.code);
    await waitFor(() => seen.at(-1)?.joinWindowAt === null);
    await teacher.updateClass(cls.code, { joinOpen: true, keepWeeks: 20, currentTaskId: cls.tasks[0].taskId, teacherName: 'Ms. C' });
    await waitFor(() => seen.at(-1)?.joinOpen === true);
    expect(seen.at(-1)).toMatchObject({ keepWeeks: 20, currentTaskId: cls.tasks[0].taskId, teacherName: 'Ms. C' });
    await teacher.deleteClass(cls.code);
    await waitFor(() => seen.at(-1) === null);
  });
});

describe('students and tasks', () => {
  it('adds, renames and removes students (members too)', async () => {
    const cls = await createClass();
    await teacher.addStudents(cls.code, [{ studentId: 'ccccccc3', username: 'omar.h' }]);
    await teacher.renameStudent(cls.code, 'aaaaaaa1', 'ali.kh');
    await expect(teacher.renameStudent(cls.code, 'aaaaaaa1', 'Ali')).rejects.toMatchObject({ code: 'bad_roster' });
    await expect(teacher.renameStudent(cls.code, 'ccccccc3', 'sara.m')).rejects.toMatchObject({ code: 'permission' }); // duplicate: refused by the rules
    await seedDocs(env, [
      { path: `classes/${cls.code}/members/dev1`, data: { studentId: 'aaaaaaa1', username: 'ali.k', ownerUid: teacherUid, joinedAt: Timestamp.now(), device: 'x', handinCount: 0, lastHandinAt: null, lastHandinId: '' } },
      { path: `classes/${cls.code}/members/dev2`, data: { studentId: 'bbbbbbb2', username: 'sara.m', ownerUid: teacherUid, joinedAt: Timestamp.now(), device: 'x', handinCount: 0, lastHandinAt: null, lastHandinId: '' } },
    ]);
    await teacher.letRejoin(cls.code, 'aaaaaaa1');
    await teacher.removeStudent(cls.code, 'aaaaaaa1');
    const stored = await readDoc(env, `classes/${cls.code}`);
    expect(stored?.roster).toEqual({ bbbbbbb2: 'sara.m', ccccccc3: 'omar.h' });
    expect(stored?.rejoin).toEqual({});
    expect(await readDoc(env, `classes/${cls.code}/members/dev1`)).toBeNull();
    expect(await readDoc(env, `classes/${cls.code}/members/dev2`)).not.toBeNull();
  });
  it('adds, renames and deletes tasks; deleting the current task clears it', async () => {
    const cls = await createClass();
    const t1 = cls.tasks[0].taskId;
    await teacher.addTasks(cls.code, [{ taskId: 'tsk002', title: 'Servo sweep' }]);
    await teacher.renameTask(cls.code, 'tsk002', '  Servo   sweep 2 ');
    await teacher.updateClass(cls.code, { currentTaskId: t1 });
    await teacher.deleteTask(cls.code, 'tsk002');
    expect((await readDoc(env, `classes/${cls.code}`))?.tasks).toEqual({ [t1]: 'Traffic light' });
    await teacher.deleteTask(cls.code, t1);
    expect(await readDoc(env, `classes/${cls.code}`)).toMatchObject({ tasks: {}, currentTaskId: '' });
    await expect(teacher.addTasks(cls.code, [{ taskId: 'BAD', title: 'x' }])).rejects.toMatchObject({ code: 'bad_roster' });
  });
});

describe('members', () => {
  it('watchMembers (newest first), removeDevice, removeUnusedDevices', async () => {
    const cls = await createClass();
    const member = (studentId: string, username: string, joinedMs: number, lastHandinMs: number | null) => ({
      studentId,
      username,
      ownerUid: teacherUid,
      joinedAt: Timestamp.fromMillis(joinedMs),
      device: 'Chrome · Windows',
      handinCount: lastHandinMs ? 1 : 0,
      lastHandinAt: lastHandinMs ? Timestamp.fromMillis(lastHandinMs) : null,
      lastHandinId: '',
    });
    const day = 86_400_000;
    await seedDocs(env, [
      { path: `classes/${cls.code}/members/old`, data: member('aaaaaaa1', 'ali.k', Date.now() - 40 * day, null) },
      { path: `classes/${cls.code}/members/active`, data: member('aaaaaaa1', 'ali.k', Date.now() - 40 * day, Date.now() - day) },
      { path: `classes/${cls.code}/members/fresh`, data: member('bbbbbbb2', 'sara.m', Date.now() - day, null) },
    ]);
    const seen: Member[][] = [];
    track(teacher.watchMembers(cls.code, (m) => seen.push(m), noError));
    await waitFor(() => (seen.at(-1)?.length ?? 0) === 3);
    expect(seen.at(-1)![0].uid).toBe('fresh'); // newest joined first
    expect(seen.at(-1)!.map((m) => m.uid).sort()).toEqual(['active', 'fresh', 'old']);
    expect(seen.at(-1)![0]).toMatchObject({ uid: 'fresh', username: 'sara.m', device: 'Chrome · Windows', handinCount: 0, lastHandinAt: null });
    expect(await teacher.removeUnusedDevices(cls.code, 30)).toBe(1);
    await waitFor(() => (seen.at(-1)?.length ?? 0) === 2);
    expect(seen.at(-1)!.map((m) => m.uid).sort()).toEqual(['active', 'fresh']);
    await teacher.removeDevice(cls.code, 'fresh');
    await waitFor(() => (seen.at(-1)?.length ?? 0) === 1);
    await teacher.removeDevice(cls.code, 'fresh'); // idempotent
  });
});

describe('hand-ins', () => {
  it('watchTodayHandins reports added and modified; refile changes student/task; delete removes', async () => {
    const cls = await createClass();
    const updates: HandinsUpdate[] = [];
    track(teacher.watchTodayHandins(cls.code, (u) => updates.push(u), noError));
    await waitFor(() => updates.length > 0);
    expect(updates[0].items).toEqual([]);

    const student = createStudentApi({ storage: memoryStorage(), tabStorage: memoryStorage(), userAgent: CHROME_LINUX, timeoutMs: 15_000 });
    const session = await student.join((await student.findClass(cls.code)).info, 'aaaaaaa1');
    const draft: HandinDraft = { kind: 'code', code: 'void setup() {}\n', workspaceJson: '', taskId: cls.tasks[0].taskId, title: 'Mine', note: '' };
    const id = newHandinId();
    await student.handIn(session, draft, id);
    await waitFor(() => updates.some((u) => u.added.includes(id)), 10_000, 'added');
    expect(updates.at(-1)!.items[0]).toMatchObject({ id, username: 'ali.k', studentId: 'aaaaaaa1', taskId: cls.tasks[0].taskId });

    await teacher.refileHandin(cls.code, id, { studentId: 'bbbbbbb2', taskId: '' });
    await waitFor(() => updates.some((u) => u.modified.includes(id)), 10_000, 'modified');
    expect(updates.at(-1)!.items[0]).toMatchObject({ username: 'sara.m', studentId: 'bbbbbbb2', taskId: '' });
    await expect(teacher.refileHandin(cls.code, id, { studentId: 'zzzzzzz9' })).rejects.toMatchObject({ code: 'not_on_roster' });

    await teacher.deleteHandin(cls.code, id);
    await waitFor(() => updates.some((u) => u.removed.includes(id)), 10_000, 'removed');
    await teacher.deleteHandin(cls.code, id); // idempotent
    await student.leave();
    const f = await loadStudentFirebase();
    expect(f.auth.currentUser).toBeNull();
  });
  it('loadHandins and studentHandins page; countHandinsBefore and pruneHandins respect the cap', async () => {
    const cls = await createClass();
    const day = 86_400_000;
    const base = Date.now() - 10 * day;
    await seedHandins(cls.code, 150, (i) => ({ createdAt: Timestamp.fromMillis(base + i * 1000), studentId: i < 12 ? 'bbbbbbb2' : 'aaaaaaa1', title: `t${i}` }));
    const page1 = await teacher.loadHandins(cls.code, new Date(base - 1000));
    expect(page1.items).toHaveLength(100);
    expect(page1.hasMore).toBe(true);
    expect(page1.items[0].title).toBe('t149');
    const page2 = await teacher.loadHandins(cls.code, new Date(base - 1000), { before: page1.items[99].createdAt! });
    expect(page2.items).toHaveLength(50);
    expect(page2.items.at(-1)!.title).toBe('t0');
    expect(page2.hasMore).toBe(false);
    expect((await teacher.loadHandins(cls.code, new Date())).items).toEqual([]);

    const sara = await teacher.studentHandins(cls.code, 'bbbbbbb2');
    expect(sara.items.map((h) => h.title)).toEqual(['t11', 't10', 't9', 't8', 't7', 't6', 't5', 't4', 't3', 't2']);
    expect(sara.hasMore).toBe(true);
    const saraMore = await teacher.studentHandins(cls.code, 'bbbbbbb2', { before: sara.items[9].createdAt! });
    expect(saraMore).toMatchObject({ hasMore: false });
    expect(saraMore.items.map((h) => h.title)).toEqual(['t1', 't0']);

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
    await seedDocs(
      env,
      Array.from({ length: 50 }, (_, i) => ({
        path: `classes/${cls.code}/members/m${i}`,
        data: { studentId: 'aaaaaaa1', username: 'ali.k', ownerUid: teacherUid, joinedAt: Timestamp.now(), device: 'x', handinCount: 0, lastHandinAt: null, lastHandinId: '' },
      })),
    );
    const progress: [number, number | null][] = [];
    expect(await teacher.deleteClass(cls.code, (done, total) => progress.push([done, total]), 500)).toBe('more');
    expect(progress[0]).toEqual([0, 900]);
    expect(progress.at(-1)![0]).toBe(500);
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(await readDoc(env, `classes/${cls.code}`)).toMatchObject({ deleting: true, joinOpen: false });
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
  const day = 86_400_000;
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
  });
});
