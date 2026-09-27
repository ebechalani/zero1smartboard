/**
 * The real StudentApi (docs/CLASSROOM.md §4.7, §7.2) against the Auth and Firestore emulators,
 * with the real lazy loader in emulator mode, in-memory storages and a controllable clock.
 * Classes are created through the real TeacherApi; a "second computer" is a sign-out followed
 * by a new API instance (the student app is one memoised instance per process).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Timestamp, deleteField } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { decodeContent } from '../src/classroom/codec';
import { loadStudentFirebase, loadTeacherFirebase } from '../src/classroom/firebase';
import { newHandinId, type HandinDraft } from '../src/classroom/model';
import { CLASSROOM_STORAGE_KEY, LAST_CODE_STORAGE_KEY, isConfirmedInTab, loadSavedSession } from '../src/classroom/session-store';
import { createStudentApi, type StudentApi } from '../src/classroom/student';
import { createTeacherApi, type ClassDetail, type TeacherApi } from '../src/classroom/teacher';
import { CHROME_LINUX, CLASS_INPUT, memoryStorage, patchDoc, readDoc, rulesEnv, seedDocs, signInTeacher, storedHandin } from './helpers';

let env: RulesTestEnvironment;
let teacher: TeacherApi;
let teacherUid: string;
const clock = { offset: 0 };
const now = () => Date.now() + clock.offset;

const DRAFT: HandinDraft = { kind: 'code', code: 'void setup() {}\nvoid loop() {}\n', workspaceJson: '', taskId: '', title: 'Mine', note: '' };
const BIG_SKETCH = `// Traffic light\n${'void loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n}\n'.repeat(40)}`;

interface Device {
  api: StudentApi;
  storage: Storage;
  tab: Storage;
}
function device(storage = memoryStorage(), tab = memoryStorage()): Device {
  return { api: createStudentApi({ storage, tabStorage: tab, now, userAgent: CHROME_LINUX, timeoutMs: 15_000 }), storage, tab };
}
const createClass = (over: Partial<typeof CLASS_INPUT> = {}) => teacher.createClass({ ...CLASS_INPUT, ...over });

/** Sign the student app out so the next findClass gets a new anonymous uid (another computer). */
async function signOutStudent(): Promise<void> {
  const f = await loadStudentFirebase();
  if (f.auth.currentUser) await f.sdk.signOut(f.auth);
}

/** Make the last hand-in of `uid` look `ms` old on the server and on the local clock. */
async function ageLastHandin(code: string, uid: string, ms: number): Promise<void> {
  await patchDoc(env, `classes/${code}/members/${uid}`, { lastHandinAt: Timestamp.fromMillis(Date.now() - ms) });
  clock.offset += ms;
}

beforeAll(async () => {
  env = await rulesEnv();
  teacher = createTeacherApi();
  await teacher.ready;
  teacherUid = await signInTeacher(await loadTeacherFirebase());
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  clock.offset = 0;
  await signOutStudent();
});

describe('findClass', () => {
  it('refuses a bad code locally, a missing class, and a stopped class', async () => {
    const { api } = device();
    await expect(api.findClass('nope')).rejects.toMatchObject({ code: 'bad_code' });
    await expect(api.findClass('ZZZZZZ')).rejects.toMatchObject({ code: 'class_not_found' });
    const cls = await createClass();
    await teacher.updateClass(cls.code, { handinsOpen: false });
    await expect(api.findClass(cls.code)).rejects.toMatchObject({ code: 'handins_closed' });
  });
  it('finds an open class with a sorted roster and no binding yet', async () => {
    const cls = await createClass();
    const { api } = device();
    const found = await api.findClass(cls.code.toLowerCase());
    expect(found.existing).toBeNull();
    expect(found.info).toMatchObject({ code: cls.code, name: '8B Robotics', teacherName: 'Mr. B', ownerUid: teacherUid, handinsOpen: true, joinOpen: true });
    expect(found.info.students.map((s) => s.username)).toEqual(['ali.k', 'sara.m']);
    expect(found.info.tasks.map((t) => t.title)).toEqual(['Traffic light']);
  });
});

describe('join and continueAs', () => {
  it('joins an open class: member doc, saved session, tab flag, last code', async () => {
    const cls = await createClass();
    const { api, storage, tab } = device();
    const found = await api.findClass(cls.code);
    const session = await api.join(found.info, 'aaaaaaa1');
    expect(session).toMatchObject({ code: cls.code, className: '8B Robotics', teacherName: 'Mr. B', studentId: 'aaaaaaa1', username: 'ali.k' });
    expect(session.uid).toBe((await loadStudentFirebase()).auth.currentUser?.uid);
    const member = await readDoc(env, `classes/${cls.code}/members/${session.uid}`);
    expect(member).toMatchObject({ studentId: 'aaaaaaa1', username: 'ali.k', ownerUid: teacherUid, device: 'Chrome · Linux', handinCount: 0, lastHandinAt: null, lastHandinId: '' });
    expect(loadSavedSession(storage)).toMatchObject({ uid: session.uid, code: cls.code, username: 'ali.k' });
    expect(isConfirmedInTab(session.uid, tab)).toBe(true);
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(cls.code);
  });
  it('closed → class_closed with no write; a 15-minute window and a per-student rejoin open it', async () => {
    const cls = await createClass({ joinOpen: false });
    const a = device();
    const found = await a.api.findClass(cls.code);
    await expect(a.api.join(found.info, 'aaaaaaa1')).rejects.toMatchObject({ code: 'class_closed' });
    await teacher.openJoinWindow(cls.code);
    const windowed = await a.api.refreshClass(cls.code);
    expect(windowed.joinWindowAt).toBeInstanceOf(Date);
    const session = await a.api.join(windowed, 'aaaaaaa1');
    expect(session.username).toBe('ali.k');

    await teacher.closeJoining(cls.code);
    await teacher.letRejoin(cls.code, 'bbbbbbb2');
    await signOutStudent();
    const b = device();
    const info = (await b.api.findClass(cls.code)).info;
    expect(Object.keys(info.rejoin)).toEqual(['bbbbbbb2']);
    await expect(b.api.join(info, 'aaaaaaa1')).rejects.toMatchObject({ code: 'class_closed' });
    expect((await b.api.join(info, 'bbbbbbb2')).username).toBe('sara.m');
  });
  it('a class stopped meanwhile is reported after the denied write', async () => {
    const cls = await createClass();
    const { api } = device();
    const found = await api.findClass(cls.code);
    await teacher.updateClass(cls.code, { joinOpen: false });
    await expect(api.join(found.info, 'aaaaaaa1')).rejects.toMatchObject({ code: 'class_closed' });
  });
  it('continueAs binds a fresh storage to the existing member doc', async () => {
    const cls = await createClass();
    const a = device();
    const session = await a.api.join((await a.api.findClass(cls.code)).info, 'aaaaaaa1');
    const again = device();
    const found = await again.api.findClass(cls.code);
    expect(found.existing).toEqual({ studentId: 'aaaaaaa1', username: 'ali.k' });
    const restored = await again.api.continueAs(found);
    expect(restored).toEqual(session);
    expect(loadSavedSession(again.storage)?.uid).toBe(session.uid);
  });
});

describe('restore', () => {
  async function joined(): Promise<{ cls: ClassDetail; dev: Device; uid: string }> {
    const cls = await createClass();
    const dev = device();
    const session = await dev.api.join((await dev.api.findClass(cls.code)).info, 'aaaaaaa1');
    return { cls, dev, uid: session.uid };
  }
  it('same uid: Ready; a new tab and a stale session ask to confirm', async () => {
    const { cls, dev, uid } = await joined();
    const result = await dev.api.restore();
    expect(result?.confirm).toBeNull();
    expect(result?.session).toMatchObject({ uid, code: cls.code, username: 'ali.k' });
    expect(result?.info.name).toBe('8B Robotics');
    const newTab = device(dev.storage, memoryStorage());
    expect((await newTab.api.restore())?.confirm).toBe('new_tab');
    clock.offset = 21 * 60_000;
    expect((await dev.api.restore())?.confirm).toBe('stale');
  });
  it('refreshes a renamed username', async () => {
    const { cls, dev } = await joined();
    await teacher.renameStudent(cls.code, 'aaaaaaa1', 'ali.kh');
    expect((await dev.api.restore())?.session.username).toBe('ali.kh');
    expect(loadSavedSession(dev.storage)?.username).toBe('ali.kh');
  });
  it('a changed uid is lost_identity: the session is cleared, the code kept', async () => {
    const { cls, dev } = await joined();
    await signOutStudent();
    await expect(dev.api.restore()).rejects.toMatchObject({ code: 'lost_identity' });
    expect(dev.storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
    expect(dev.storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(cls.code);
  });
  it('class deleted, not on the roster, stopped', async () => {
    const { cls, dev } = await joined();
    await teacher.updateClass(cls.code, { handinsOpen: false });
    await expect(dev.api.restore()).rejects.toMatchObject({ code: 'handins_closed' });
    await teacher.updateClass(cls.code, { handinsOpen: true });
    await teacher.removeStudent(cls.code, 'aaaaaaa1');
    await expect(dev.api.restore()).rejects.toMatchObject({ code: 'not_on_roster' });
    expect(await teacher.deleteClass(cls.code)).toBe('done');
    await expect(dev.api.restore()).rejects.toMatchObject({ code: 'class_deleted' });
    expect(dev.storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
  });
});

describe('handIn', () => {
  async function joined(): Promise<{ cls: ClassDetail; dev: Device; uid: string }> {
    const cls = await createClass();
    const dev = device();
    const session = await dev.api.join((await dev.api.findClass(cls.code)).info, 'aaaaaaa1');
    return { cls, dev, uid: session.uid };
  }
  const session = (dev: Device) => {
    const s = loadSavedSession(dev.storage)!;
    return { code: s.code, className: s.className, teacherName: s.teacherName, studentId: s.studentId, username: s.username, uid: s.uid };
  };

  it('hands in plain and gzip content; the member counter ticks; the teacher reads it', async () => {
    const { cls, dev, uid } = await joined();
    const task = cls.tasks[0].taskId;
    const id = newHandinId();
    const record = await dev.api.handIn(session(dev), { ...DRAFT, taskId: task }, id);
    expect(record).toMatchObject({ id, classCode: cls.code, uid, username: 'ali.k', taskId: task, title: 'Mine' });
    expect(record.content.enc).toBe('plain');
    expect(await readDoc(env, `classes/${cls.code}/members/${uid}`)).toMatchObject({ handinCount: 1, lastHandinId: id });
    expect(loadSavedSession(dev.storage)).toMatchObject({ lastHandinTitle: 'Traffic light' });

    await ageLastHandin(cls.code, uid, 11_000);
    const blocks = await dev.api.handIn(session(dev), { kind: 'blocks', code: BIG_SKETCH, workspaceJson: JSON.stringify({ blocks: { blocks: [{ type: 'z1_setup' }] } }), taskId: '', title: '', note: 'see blocks' }, newHandinId());
    expect(blocks.content.enc).toBe('gzip');

    const page = await teacher.loadHandins(cls.code, new Date(Date.now() - 60_000));
    expect(page.items.map((h) => h.id).sort()).toEqual([id, blocks.id].sort());
    const stored = page.items.find((h) => h.id === blocks.id)!;
    expect(stored.content.enc).toBe('gzip');
    expect(stored.content.code).toBeInstanceOf(Uint8Array);
    expect(await decodeContent(stored.content)).toMatchObject({ ok: true, code: BIG_SKETCH });
    expect(stored.createdAt).toBeInstanceOf(Date);
  });
  it('waits 10 s between hand-ins (locally, without a request)', async () => {
    const { dev } = await joined();
    await dev.api.handIn(session(dev), DRAFT, newHandinId());
    await expect(dev.api.handIn(session(dev), DRAFT, newHandinId())).rejects.toMatchObject({ code: 'too_soon' });
  });
  it('removed from the roster → not_on_roster; computer removed → device_removed', async () => {
    const { cls, dev, uid } = await joined();
    await patchDoc(env, `classes/${cls.code}`, { 'roster.aaaaaaa1': deleteField() });
    await expect(dev.api.handIn(session(dev), DRAFT, newHandinId())).rejects.toMatchObject({ code: 'not_on_roster' });
    await patchDoc(env, `classes/${cls.code}`, { 'roster.aaaaaaa1': 'ali.k' });
    await teacher.removeDevice(cls.code, uid);
    await expect(dev.api.handIn(session(dev), DRAFT, newHandinId())).rejects.toMatchObject({ code: 'device_removed' });
  });
  it('renamed by the teacher → one automatic retry with the new name and the same id', async () => {
    const { cls, dev } = await joined();
    await teacher.renameStudent(cls.code, 'aaaaaaa1', 'ali.kh');
    const id = newHandinId();
    const record = await dev.api.handIn(session(dev), DRAFT, id);
    expect(record.username).toBe('ali.kh');
    expect(loadSavedSession(dev.storage)?.username).toBe('ali.kh');
    expect((await readDoc(env, `classes/${cls.code}/handins/${id}`))?.username).toBe('ali.kh');
  });
  it('the 300 limit → limit_reached; stopped → handins_closed; deleting → class_deleted; unknown task → permission "task"', async () => {
    const { cls, dev, uid } = await joined();
    await patchDoc(env, `classes/${cls.code}/members/${uid}`, { handinCount: 300 });
    await expect(dev.api.handIn(session(dev), DRAFT, newHandinId())).rejects.toMatchObject({ code: 'limit_reached' });
    await patchDoc(env, `classes/${cls.code}/members/${uid}`, { handinCount: 0 });
    await expect(dev.api.handIn(session(dev), { ...DRAFT, taskId: 'zzzzzz' }, newHandinId())).rejects.toMatchObject({ code: 'permission', message: 'task' });
    await teacher.updateClass(cls.code, { handinsOpen: false });
    await expect(dev.api.handIn(session(dev), DRAFT, newHandinId())).rejects.toMatchObject({ code: 'handins_closed' });
    await patchDoc(env, `classes/${cls.code}`, { handinsOpen: true, deleting: true });
    await expect(dev.api.handIn(session(dev), DRAFT, newHandinId())).rejects.toMatchObject({ code: 'class_deleted' });
  });
  it('a committed batch followed by handIn with the same id is a success with no duplicate', async () => {
    const { cls, dev, uid } = await joined();
    const id = newHandinId();
    await dev.api.handIn(session(dev), DRAFT, id);
    await ageLastHandin(cls.code, uid, 11_000);
    const again = await dev.api.handIn(session(dev), DRAFT, id);
    expect(again.id).toBe(id);
    const page = await teacher.loadHandins(cls.code, new Date(Date.now() - 60_000));
    expect(page.items).toHaveLength(1);
    expect(await readDoc(env, `classes/${cls.code}/members/${uid}`)).toMatchObject({ handinCount: 1, lastHandinId: id });
  });
});

describe('myHandins and leave', () => {
  it('pages the newest 20 of this device, then the rest', async () => {
    const cls = await createClass();
    const dev = device();
    const s = await dev.api.join((await dev.api.findClass(cls.code)).info, 'aaaaaaa1');
    const base = Date.now() - 100_000;
    await seedDocs(
      env,
      Array.from({ length: 25 }, (_, i) => {
        const h = storedHandin(s.uid, 'aaaaaaa1', 'ali.k', { ownerUid: teacherUid, createdAt: Timestamp.fromMillis(base + i * 1000), title: `t${i}` });
        return { path: `classes/${cls.code}/handins/${'H'.repeat(18)}${String(i).padStart(2, '0')}`, data: h.data };
      }),
    );
    const first = await dev.api.myHandins(s);
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(first.items[0].title).toBe('t24');
    expect(first.items[0].content).toEqual({ enc: 'plain', code: 'void setup() {}', workspace: '' });
    const second = await dev.api.myHandins(s, { before: first.items[19].createdAt! });
    expect(second.items.map((h) => h.title)).toEqual(['t4', 't3', 't2', 't1', 't0']);
    expect(second.hasMore).toBe(false);
  });
  it('leave: a new uid that sees nothing of the previous history', async () => {
    const cls = await createClass();
    const a = device();
    const s = await a.api.join((await a.api.findClass(cls.code)).info, 'aaaaaaa1');
    await a.api.handIn(s, DRAFT, newHandinId());
    await a.api.leave();
    expect(a.storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
    expect(a.storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(cls.code);
    expect((await loadStudentFirebase()).auth.currentUser).toBeNull();

    const b = device();
    const found = await b.api.findClass(cls.code);
    expect(found.existing).toBeNull();
    const s2 = await b.api.join(found.info, 'aaaaaaa1');
    expect(s2.uid).not.toBe(s.uid);
    expect((await b.api.myHandins(s2)).items).toEqual([]);
    await expect(b.api.myHandins(s)).rejects.toMatchObject({ code: 'permission' });
  });
});
