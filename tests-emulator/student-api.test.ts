/**
 * The real StudentApi (docs/CLASSROOM.md §4.7, §7.2) against the Auth and Firestore emulators,
 * with the real lazy loader in emulator mode, in-memory storages and a controllable clock.
 * Classes are created through the real TeacherApi; a "second computer" is a sign-out of the
 * student app followed by a new API instance (the student app is one memoised instance per process).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { decodeContent } from '../src/classroom/codec';
import { loadStudentFirebase, loadTeacherFirebase } from '../src/classroom/firebase';
import { contentOf, newHandinId, type HandinDraft } from '../src/classroom/model';
import { CLASSROOM_STORAGE_KEY, LAST_CODE_STORAGE_KEY, loadSavedSession } from '../src/classroom/session-store';
import { createStudentApi, type StudentApi, type StudentSession } from '../src/classroom/student';
import { createTeacherApi, type ClassDetail, type TeacherApi } from '../src/classroom/teacher';
import { ALI, CHROME_LINUX, CLASS_INPUT, SARA, memoryStorage, patchDoc, readDoc, rulesEnv, signInTeacher } from './helpers';

let env: RulesTestEnvironment;
let teacher: TeacherApi;
let teacherUid: string;
const clock = { offset: 0 };
const now = () => Date.now() + clock.offset;

const DRAFT: HandinDraft = { kind: 'code', code: 'void setup() {}\nvoid loop() {}\n', workspaceJson: '', python: '' };
const BIG_SKETCH = `// Traffic light\n${'void loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n}\n'.repeat(40)}`;

interface Device {
  api: StudentApi;
  storage: Storage;
}
function device(storage = memoryStorage()): Device {
  return { api: createStudentApi({ storage, now, userAgent: CHROME_LINUX, timeoutMs: 15_000 }), storage };
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

async function joined(name = ALI): Promise<{ cls: ClassDetail; dev: Device; session: StudentSession }> {
  const cls = await createClass();
  const dev = device();
  const session = await dev.api.join(await dev.api.findClass(cls.code), name);
  return { cls, dev, session };
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
  it('finds an open class with no name given yet', async () => {
    const cls = await createClass();
    const { api } = device();
    const found = await api.findClass(cls.code.toLowerCase());
    expect(found).toEqual({ info: { code: cls.code, name: '8B Robotics', ownerUid: teacherUid, handinsOpen: true }, existing: null });
  });
});

describe('join (enter a name) and Change', () => {
  it('creates the member doc, saves the session and the last code', async () => {
    const cls = await createClass();
    const { api, storage } = device();
    const session = await api.join(await api.findClass(cls.code), { firstName: ' Élise ', lastName: "O'Neil" });
    expect(session).toMatchObject({ code: cls.code, className: '8B Robotics', firstName: 'Élise', lastName: "O'Neil" });
    expect(session.uid).toBe((await loadStudentFirebase()).auth.currentUser?.uid);
    const member = await readDoc(env, `classes/${cls.code}/members/${session.uid}`);
    expect(member).toMatchObject({ firstName: 'Élise', lastName: "O'Neil", nameKey: "élise o'neil", ownerUid: teacherUid, device: 'Chrome · Linux', handinCount: 0, lastHandinAt: null, lastHandinId: '' });
    expect(loadSavedSession(storage)).toMatchObject({ v: 2, uid: session.uid, code: cls.code, firstName: 'Élise', lastName: "O'Neil" });
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(cls.code);
  });
  it('refuses a bad name locally; a class stopped meanwhile is reported after the denied write', async () => {
    const cls = await createClass();
    const { api } = device();
    const found = await api.findClass(cls.code);
    await expect(api.join(found, { firstName: 'Ali2', lastName: 'Khoury' })).rejects.toMatchObject({ code: 'bad_name' });
    await teacher.updateClass(cls.code, { handinsOpen: false });
    await expect(api.join(found, ALI)).rejects.toMatchObject({ code: 'handins_closed' });
    expect(await readDoc(env, `classes/${cls.code}/members/${(await loadStudentFirebase()).auth.currentUser!.uid}`)).toBeNull();
  });
  it('the same computer finds its name again and renames it in place (the counter stays)', async () => {
    const { cls, dev, session } = await joined();
    await dev.api.handIn(session, DRAFT, newHandinId());
    const found = await dev.api.findClass(cls.code);
    expect(found.existing).toEqual(ALI);
    const renamed = await dev.api.join(found, SARA);
    expect(renamed.uid).toBe(session.uid);
    expect(await readDoc(env, `classes/${cls.code}/members/${session.uid}`)).toMatchObject({ ...SARA, nameKey: 'sara mansour', handinCount: 1 });
    expect(loadSavedSession(dev.storage)).toMatchObject({ firstName: 'Sara', lastHandinAt: expect.any(Number) });
    expect(loadSavedSession(dev.storage)!.lastHandinAt).toBeGreaterThan(0); // the history of this uid is kept
  });
  it('forget keeps the anonymous sign-in: the next name goes to the same member doc', async () => {
    const { cls, dev, session } = await joined();
    dev.api.forget();
    expect(dev.storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
    expect(dev.storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(cls.code);
    expect(await dev.api.restore()).toBeNull();
    const again = await dev.api.join(await dev.api.findClass(cls.code), SARA);
    expect(again.uid).toBe(session.uid);
    expect(await readDoc(env, `classes/${cls.code}/members/${session.uid}`)).toMatchObject(SARA);
  });
  it('a computer removed by the teacher enters its name again (a new member doc, counter 0)', async () => {
    const { cls, dev, session } = await joined();
    await dev.api.handIn(session, DRAFT, newHandinId());
    await teacher.removeDevice(cls.code, session.uid);
    clock.offset += 11_000; // past the local cooldown
    await expect(dev.api.handIn(session, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'device_removed' });
    const found = await dev.api.findClass(cls.code);
    expect(found.existing).toBeNull();
    await dev.api.join(found, ALI);
    expect(await readDoc(env, `classes/${cls.code}/members/${session.uid}`)).toMatchObject({ ...ALI, handinCount: 0 });
  });
});

describe('restore', () => {
  it('same uid: the session with the class name refreshed and the last hand-in', async () => {
    const { cls, dev, session } = await joined();
    expect(await dev.api.restore()).toEqual({ session, info: { code: cls.code, name: '8B Robotics', ownerUid: teacherUid, handinsOpen: true }, lastHandinAt: null });
    await teacher.updateClass(cls.code, { name: '8B' });
    const record = await dev.api.handIn(session, DRAFT, newHandinId());
    const result = await dev.api.restore();
    expect(result?.session.className).toBe('8B');
    expect(result?.lastHandinAt).toBe(record.createdAt!.getTime());
  });
  it('a changed uid is lost_identity: the session is cleared, the code kept', async () => {
    const { cls, dev } = await joined();
    await signOutStudent();
    await expect(dev.api.restore()).rejects.toMatchObject({ code: 'lost_identity' });
    expect(dev.storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
    expect(dev.storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(cls.code);
  });
  it('stopped, then deleted', async () => {
    const { cls, dev } = await joined();
    await teacher.updateClass(cls.code, { handinsOpen: false });
    await expect(dev.api.restore()).rejects.toMatchObject({ code: 'handins_closed' });
    expect(await teacher.deleteClass(cls.code)).toBe('done');
    await expect(dev.api.restore()).rejects.toMatchObject({ code: 'class_deleted' });
    expect(dev.storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
  });
});

describe('handIn', () => {
  it('hands in plain and gzip content with the name; the member counter ticks; the teacher reads it', async () => {
    const { cls, dev, session } = await joined();
    const id = newHandinId();
    const record = await dev.api.handIn(session, DRAFT, id);
    expect(record).toMatchObject({ id, classCode: cls.code, uid: session.uid, ...ALI, nameKey: 'ali khoury', kind: 'code' });
    expect(record.content.enc).toBe('plain');
    expect(await readDoc(env, `classes/${cls.code}/members/${session.uid}`)).toMatchObject({ handinCount: 1, lastHandinId: id });
    expect(await readDoc(env, `classes/${cls.code}/handins/${id}`)).toMatchObject({ ...ALI, nameKey: 'ali khoury', ownerUid: teacherUid });
    expect(loadSavedSession(dev.storage)!.lastHandinAt).toBeGreaterThan(0);

    await ageLastHandin(cls.code, session.uid, 11_000);
    const blocks = await dev.api.handIn(session, { kind: 'blocks', code: BIG_SKETCH, workspaceJson: JSON.stringify({ blocks: { blocks: [{ type: 'z1_setup' }] } }), python: '' }, newHandinId());
    expect(blocks.content.enc).toBe('gzip');

    const page = await teacher.loadHandins(cls.code, new Date(Date.now() - 60_000));
    expect(page.items.map((h) => h.id).sort()).toEqual([id, blocks.id].sort());
    const stored = page.items.find((h) => h.id === blocks.id)!;
    expect(stored.content.enc).toBe('gzip');
    expect(stored.content.code).toBeInstanceOf(Uint8Array);
    expect(await decodeContent(stored.content)).toMatchObject({ ok: true, code: BIG_SKETCH });
    expect(stored.createdAt).toBeInstanceOf(Date);
    expect(stored).toMatchObject({ ...ALI, nameKey: 'ali khoury' });
  });
  it('Python hand-ins keep the program in workspace (plain and gzip); the teacher reads kind python (docs/PYTHON.md §8.1)', async () => {
    const { cls, dev, session } = await joined();
    const small = 'print("Bonjour")\n';
    const id = newHandinId();
    const plain = await dev.api.handIn(session, { kind: 'python', code: DRAFT.code, workspaceJson: '', python: small }, id);
    expect(plain).toMatchObject({ id, kind: 'python', content: { enc: 'plain', code: DRAFT.code, workspace: small } });
    expect(await readDoc(env, `classes/${cls.code}/handins/${id}`)).toMatchObject({ kind: 'python', enc: 'plain', code: DRAFT.code, workspace: small });

    await ageLastHandin(cls.code, session.uid, 11_000);
    const program = `from machine import Pin\nimport time\n\nled = Pin(13, Pin.OUT)\n${'while True:\n    led.toggle()\n    print("Lumière")\n    time.sleep(0.5)\n'.repeat(20)}`;
    const big = await dev.api.handIn(session, { kind: 'python', code: BIG_SKETCH, workspaceJson: '', python: program }, newHandinId());
    expect(big.content.enc).toBe('gzip');

    const page = await teacher.loadHandins(cls.code, new Date(Date.now() - 60_000));
    expect(page.items.map((h) => h.kind)).toEqual(['python', 'python']);
    const stored = page.items.find((h) => h.id === big.id)!;
    expect(stored.content.workspace).toBeInstanceOf(Uint8Array);
    const decoded = await decodeContent(stored.content);
    expect(decoded.ok).toBe(true);
    expect(contentOf(stored.kind, decoded as { code: string; workspaceJson: string })).toEqual({ kind: 'python', code: BIG_SKETCH, workspaceJson: '', python: program });
  });
  it('waits 10 s between hand-ins (locally, without a request)', async () => {
    const { dev, session } = await joined();
    await dev.api.handIn(session, DRAFT, newHandinId());
    await expect(dev.api.handIn(session, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'too_soon' });
  });
  it('a name changed in another tab → one automatic retry with the member name and the same id', async () => {
    const { cls, dev, session } = await joined();
    await patchDoc(env, `classes/${cls.code}/members/${session.uid}`, { ...SARA, nameKey: 'sara mansour' });
    const id = newHandinId();
    const record = await dev.api.handIn(session, DRAFT, id);
    expect(record).toMatchObject(SARA);
    expect(loadSavedSession(dev.storage)).toMatchObject(SARA);
    expect(await readDoc(env, `classes/${cls.code}/handins/${id}`)).toMatchObject(SARA);
  });
  it('the 300 limit → limit_reached; stopped → handins_closed; deleting → class_deleted', async () => {
    const { cls, dev, session } = await joined();
    await patchDoc(env, `classes/${cls.code}/members/${session.uid}`, { handinCount: 300 });
    await expect(dev.api.handIn(session, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'limit_reached' });
    await patchDoc(env, `classes/${cls.code}/members/${session.uid}`, { handinCount: 0 });
    await teacher.updateClass(cls.code, { handinsOpen: false });
    await expect(dev.api.handIn(session, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'handins_closed' });
    await patchDoc(env, `classes/${cls.code}`, { handinsOpen: true, deleting: true });
    await expect(dev.api.handIn(session, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'class_deleted' });
  });
  it('a committed batch followed by handIn with the same id is a success with no duplicate', async () => {
    const { cls, dev, session } = await joined();
    const id = newHandinId();
    await dev.api.handIn(session, DRAFT, id);
    await ageLastHandin(cls.code, session.uid, 11_000);
    const again = await dev.api.handIn(session, DRAFT, id);
    expect(again.id).toBe(id);
    const page = await teacher.loadHandins(cls.code, new Date(Date.now() - 60_000));
    expect(page.items).toHaveLength(1);
    expect(await readDoc(env, `classes/${cls.code}/members/${session.uid}`)).toMatchObject({ handinCount: 1, lastHandinId: id });
  });
  it('two computers may hand in under the same name; the teacher groups them by nameKey', async () => {
    const { cls, dev, session } = await joined();
    await dev.api.handIn(session, DRAFT, newHandinId());
    await signOutStudent();
    const other = device();
    const s2 = await other.api.join(await other.api.findClass(cls.code), { firstName: 'ali', lastName: 'KHOURY' });
    expect(s2.uid).not.toBe(session.uid);
    await other.api.handIn(s2, DRAFT, newHandinId());
    const mine = await teacher.studentHandins(cls.code, 'ali khoury');
    expect(mine.items).toHaveLength(2);
    expect(new Set(mine.items.map((h) => h.uid))).toEqual(new Set([session.uid, s2.uid]));
  });
});
