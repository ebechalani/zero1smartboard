/**
 * src/classroom/student.ts with a fake SDK (docs/CLASSROOM.md §7.2): no download without a
 * session, join (create / rename), the diagnosis table, local checks and the retry protocol.
 * The real SDK is exercised in tests-emulator/student-api.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { newHandinId, type HandinDraft } from '../src/classroom/model';
import { CLASSROOM_STORAGE_KEY, LAST_CODE_STORAGE_KEY, loadSavedSession, saveLastCode, saveSession, type SavedSession } from '../src/classroom/session-store';
import { cleanStudentName, createStudentApi, diagnoseHandinRefusal, type FoundClass, type StudentSession } from '../src/classroom/student';
import { fakeStudentFirebase, memoryStorage, type FakeStudentOptions } from './classroom-fakes';

const CODE = 'BKT4M9';
const UID = 'anon-1';
const NOW = 1_800_000_000_000;
const ts = (ms: number) => ({ toDate: () => new Date(ms) });

const CLASS_DOC = { ownerUid: 'tA', name: '8B Robotics', handinsOpen: true, keepWeeks: 10, deleting: false, createdAt: ts(NOW - 86_400_000), updatedAt: ts(NOW - 86_400_000) };
const MEMBER_DOC = { firstName: 'Ali', lastName: 'Khoury', nameKey: 'ali khoury', ownerUid: 'tA', joinedAt: ts(NOW - 3_600_000), device: 'Chrome · Linux', handinCount: 0, lastHandinAt: null, lastHandinId: '' };
const SAVED: SavedSession = { v: 2, code: CODE, className: '8B Robotics', firstName: 'Ali', lastName: 'Khoury', uid: UID, lastUsedAt: NOW - 60_000, lastHandinAt: 0 };
const SESSION: StudentSession = { code: CODE, className: '8B Robotics', firstName: 'Ali', lastName: 'Khoury', uid: UID };
const INFO = { code: CODE, name: '8B Robotics', ownerUid: 'tA', handinsOpen: true };
const DRAFT: HandinDraft = { kind: 'code', code: 'void setup() {}\nvoid loop() {}\n', workspaceJson: '' };
const denied = { code: 'permission-denied', name: 'FirebaseError', message: 'denied' };

function setup(options: FakeStudentOptions = {}, session: SavedSession | null = SAVED, opts: { now?: number; timeoutMs?: number } = {}) {
  const fake = fakeStudentFirebase({
    uid: UID,
    ...options,
    docs: { [`classes/${CODE}`]: CLASS_DOC, [`classes/${CODE}/members/${UID}`]: MEMBER_DOC, ...(options.docs ?? {}) },
  });
  const storage = memoryStorage();
  if (session) saveSession(session, storage);
  const load = vi.fn(async () => fake.fb);
  const now = opts.now ?? NOW;
  const api = createStudentApi({ load, storage, now: () => now, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/129.0.0.0 Safari/537.36', timeoutMs: opts.timeoutMs ?? 1000 });
  return { api, fake, storage, load };
}

describe('restore', () => {
  it('resolves null without loading Firebase when nothing is saved', async () => {
    const { api, load } = setup({}, null);
    expect(await api.restore()).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
  it('reads the class only, refreshes its name and reports the last hand-in', async () => {
    const { api, fake, storage } = setup({ docs: { [`classes/${CODE}`]: { ...CLASS_DOC, name: '8B' } } }, { ...SAVED, lastHandinAt: NOW - 5000 });
    const result = await api.restore();
    expect(result?.session).toEqual({ ...SESSION, className: '8B' });
    expect(result?.info).toEqual({ ...INFO, name: '8B' });
    expect(result?.lastHandinAt).toBe(NOW - 5000);
    expect(fake.reads).toEqual([`classes/${CODE}`]); // the member doc is not read here
    expect(loadSavedSession(storage)?.className).toBe('8B');
    expect((await setup().api.restore())?.lastHandinAt).toBeNull();
  });
  it('lost_identity when the anonymous user changed: the session is cleared, the last code kept', async () => {
    const { api, storage } = setup({ uid: 'someone-else' });
    saveLastCode(CODE, storage);
    await expect(api.restore()).rejects.toMatchObject({ code: 'lost_identity' });
    expect(storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(CODE);
  });
  it('class_deleted (cleared) and handins_closed (kept)', async () => {
    const gone = setup({ docs: { [`classes/${CODE}`]: null } });
    await expect(gone.api.restore()).rejects.toMatchObject({ code: 'class_deleted' });
    expect(gone.storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
    const deleting = setup({ docs: { [`classes/${CODE}`]: { ...CLASS_DOC, deleting: true } } });
    await expect(deleting.api.restore()).rejects.toMatchObject({ code: 'class_deleted' });
    const stopped = setup({ docs: { [`classes/${CODE}`]: { ...CLASS_DOC, handinsOpen: false } } });
    await expect(stopped.api.restore()).rejects.toMatchObject({ code: 'handins_closed', message: '8B Robotics no longer accepts hand-ins. If you have a new class code, choose Different class.' });
    expect(stopped.storage.getItem(CLASSROOM_STORAGE_KEY)).not.toBeNull();
  });
});

describe('findClass', () => {
  it('refuses a bad code without loading Firebase', async () => {
    const { api, load } = setup({}, null);
    await expect(api.findClass('BAT4M9')).rejects.toMatchObject({ code: 'bad_code' });
    expect(load).not.toHaveBeenCalled();
  });
  it('signs in anonymously when needed, then reads the class and the member doc', async () => {
    const { api, fake } = setup({ uid: null, anonymousUid: UID }, null);
    const found = await api.findClass('bkt-4m9');
    expect(fake.stats.signIns).toBe(1);
    expect(fake.reads).toEqual([`classes/${CODE}`, `classes/${CODE}/members/${UID}`]);
    expect(found).toEqual({ info: INFO, existing: { firstName: 'Ali', lastName: 'Khoury' } });
    const fresh = setup({ docs: { [`classes/${CODE}/members/${UID}`]: null } }, null);
    expect((await fresh.api.findClass(CODE)).existing).toBeNull();
  });
  it('class_not_found and handins_closed', async () => {
    const missing = setup({ docs: { [`classes/${CODE}`]: null } }, null);
    await expect(missing.api.findClass(CODE)).rejects.toMatchObject({ code: 'class_not_found', message: 'There is no class with the code BKT-4M9. Check the code with your teacher.' });
    const stopped = setup({ docs: { [`classes/${CODE}`]: { ...CLASS_DOC, handinsOpen: false } } }, null);
    await expect(stopped.api.findClass(CODE)).rejects.toMatchObject({ code: 'handins_closed' });
  });
});

describe('join', () => {
  const found = (existing: FoundClass['existing'] = null): FoundClass => ({ info: INFO, existing });

  it('cleans the names and refuses bad ones locally', () => {
    expect(cleanStudentName({ firstName: '  ali ', lastName: 'Ben  Salah\n' })).toEqual({ firstName: 'ali', lastName: 'Ben Salah' });
    expect(cleanStudentName({ firstName: 'Ali', lastName: '' })).toBeNull();
    expect(cleanStudentName({ firstName: 'Ali2', lastName: 'Khoury' })).toBeNull();
  });
  it('bad_name and handins_closed make no request', async () => {
    const { api, fake } = setup({}, null);
    await expect(api.join(found(), { firstName: '', lastName: 'Khoury' })).rejects.toMatchObject({ code: 'bad_name' });
    await expect(api.join({ info: { ...INFO, handinsOpen: false }, existing: null }, { firstName: 'Ali', lastName: 'Khoury' })).rejects.toMatchObject({ code: 'handins_closed' });
    expect(fake.sets).toEqual([]);
  });
  it('creates the member doc and saves the session (the last code too)', async () => {
    const { api, fake, storage } = setup({ docs: { [`classes/${CODE}/members/${UID}`]: null } }, null);
    const session = await api.join(found(), { firstName: ' Élise ', lastName: "O'Neil" });
    expect(session).toEqual({ code: CODE, className: '8B Robotics', firstName: 'Élise', lastName: "O'Neil", uid: UID });
    expect(fake.sets).toHaveLength(1);
    expect(fake.sets[0]).toMatchObject({ type: 'set', path: `classes/${CODE}/members/${UID}` });
    expect(fake.sets[0].data).toMatchObject({ firstName: 'Élise', lastName: "O'Neil", nameKey: "élise o'neil", ownerUid: 'tA', device: 'Chrome · Linux', handinCount: 0, lastHandinAt: null, lastHandinId: '' });
    expect(loadSavedSession(storage)).toMatchObject({ v: 2, code: CODE, uid: UID, firstName: 'Élise', lastName: "O'Neil", lastUsedAt: NOW, lastHandinAt: 0 });
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(CODE);
  });
  it('renames an existing member doc (the three name fields only); the same name writes nothing', async () => {
    const { api, fake } = setup({}, null);
    await api.join(found({ firstName: 'Ali', lastName: 'Khoury' }), { firstName: 'Ali', lastName: 'Khoury' });
    expect(fake.sets).toEqual([]);
    await api.join(found({ firstName: 'Ali', lastName: 'Khoury' }), { firstName: 'Sara', lastName: 'Mansour' });
    expect(fake.sets).toHaveLength(1);
    expect(fake.sets[0]).toEqual({ type: 'update', path: `classes/${CODE}/members/${UID}`, data: { firstName: 'Sara', lastName: 'Mansour', nameKey: 'sara mansour' } });
    expect(fake.docs[`classes/${CODE}/members/${UID}`]).toMatchObject({ firstName: 'Sara', handinCount: 0 });
  });
  it('a denied create falls back to a rename (the doc appeared meanwhile), and the other way round', async () => {
    const created = setup({ setDoc: async () => Promise.reject(denied) }, null);
    await created.api.join(found(), { firstName: 'Sara', lastName: 'Mansour' });
    expect(created.fake.sets.map((s) => s.type)).toEqual(['set', 'update']);
    const renamed = setup({ updateDoc: async () => Promise.reject(denied), docs: { [`classes/${CODE}/members/${UID}`]: null } }, null);
    await renamed.api.join(found({ firstName: 'Ali', lastName: 'Khoury' }), { firstName: 'Sara', lastName: 'Mansour' });
    expect(renamed.fake.sets.map((s) => s.type)).toEqual(['update', 'set']);
    expect(renamed.fake.docs[`classes/${CODE}/members/${UID}`]).toMatchObject({ firstName: 'Sara' });
  });
  it('both denied: a class stopped meanwhile → handins_closed; gone → class_not_found; else permission', async () => {
    const both = { setDoc: async () => Promise.reject(denied), updateDoc: async () => Promise.reject(denied) };
    const stopped = setup({ ...both, docs: { [`classes/${CODE}`]: { ...CLASS_DOC, handinsOpen: false } } }, null);
    await expect(stopped.api.join(found(), { firstName: 'Ali', lastName: 'Khoury' })).rejects.toMatchObject({ code: 'handins_closed' });
    const gone = setup({ ...both, docs: { [`classes/${CODE}`]: null } }, null);
    await expect(gone.api.join(found(), { firstName: 'Ali', lastName: 'Khoury' })).rejects.toMatchObject({ code: 'class_not_found' });
    const plain = setup(both, null);
    await expect(plain.api.join(found(), { firstName: 'Ali', lastName: 'Khoury' })).rejects.toMatchObject({ code: 'permission' });
  });
});

describe('diagnoseHandinRefusal', () => {
  const cls = { deleting: false, handinsOpen: true };
  const member = { firstName: 'Ali', lastName: 'Khoury', handinCount: 3, lastHandinAt: new Date(NOW - 60_000), lastHandinId: 'X'.repeat(20) };
  const id = 'Y'.repeat(20);
  it('follows the order of §4.7', () => {
    expect(diagnoseHandinRefusal(cls, { ...member, lastHandinId: id }, SESSION, id, NOW)).toBe('arrived');
    expect(diagnoseHandinRefusal(null, member, SESSION, id, NOW)).toBe('class_deleted');
    expect(diagnoseHandinRefusal({ ...cls, deleting: true }, member, SESSION, id, NOW)).toBe('class_deleted');
    expect(diagnoseHandinRefusal({ ...cls, handinsOpen: false }, member, SESSION, id, NOW)).toBe('handins_closed');
    expect(diagnoseHandinRefusal(cls, null, SESSION, id, NOW)).toBe('device_removed');
    expect(diagnoseHandinRefusal(cls, { ...member, handinCount: 300 }, SESSION, id, NOW)).toBe('limit_reached');
    expect(diagnoseHandinRefusal(cls, { ...member, lastHandinAt: new Date(NOW - 10_500) }, SESSION, id, NOW)).toBe('too_soon');
    expect(diagnoseHandinRefusal(cls, { ...member, lastHandinAt: new Date(NOW - 11_500) }, SESSION, id, NOW)).toBe('permission');
    expect(diagnoseHandinRefusal(cls, { ...member, lastName: 'Khouri' }, SESSION, id, NOW)).toBe('renamed');
  });
});

describe('handIn', () => {
  it('refuses empty, oversize and too-soon drafts without loading Firebase', async () => {
    const { api, load } = setup({}, { ...SAVED, lastHandinAt: NOW - 5000 });
    const id = newHandinId();
    await expect(api.handIn(SESSION, { ...DRAFT, code: ' ' }, id)).rejects.toMatchObject({ code: 'empty_sketch' });
    await expect(api.handIn(SESSION, { ...DRAFT, code: 'x'.repeat(50_001) }, id)).rejects.toMatchObject({ code: 'too_large' });
    await expect(api.handIn(SESSION, DRAFT, id)).rejects.toMatchObject({ code: 'too_soon' });
    expect(load).not.toHaveBeenCalled();
  });
  it('commits the 2-write batch with the denormalised name and records the hand-in', async () => {
    const { api, fake, storage } = setup();
    const id = newHandinId();
    const record = await api.handIn(SESSION, DRAFT, id);
    expect(record).toMatchObject({ id, classCode: CODE, uid: UID, firstName: 'Ali', lastName: 'Khoury', nameKey: 'ali khoury', kind: 'code', createdAt: new Date(NOW) });
    expect(record.content).toEqual({ enc: 'plain', code: DRAFT.code, workspace: '' });
    expect(fake.ops.map((o) => `${o.type} ${o.path}`)).toEqual([`set classes/${CODE}/handins/${id}`, `update classes/${CODE}/members/${UID}`]);
    expect(fake.ops[0].data).toEqual({
      uid: UID,
      firstName: 'Ali',
      lastName: 'Khoury',
      nameKey: 'ali khoury',
      ownerUid: 'tA',
      kind: 'code',
      createdAt: expect.anything(),
      enc: 'plain',
      code: DRAFT.code,
      workspace: '',
    });
    expect(fake.ops[1].data).toMatchObject({ handinCount: { increment: 1 }, lastHandinId: id });
    expect(fake.docs[`classes/${CODE}/members/${UID}`]).toMatchObject({ handinCount: 1, lastHandinId: id });
    expect(loadSavedSession(storage)).toMatchObject({ lastHandinAt: NOW, lastUsedAt: NOW });
    await expect(api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'too_soon' });
  });
  it('a timeout followed by a member read with the same id is a success', async () => {
    const id = newHandinId();
    const { api, fake } = setup({ commit: () => new Promise(() => undefined) }, SAVED, { timeoutMs: 20 });
    fake.docs[`classes/${CODE}/members/${UID}`] = { ...MEMBER_DOC, handinCount: 1, lastHandinId: id };
    const record = await api.handIn(SESSION, DRAFT, id);
    expect(record.id).toBe(id);
    expect(fake.reads).toContain(`classes/${CODE}/members/${UID}`);
  });
  it('a timeout that did not arrive stays a timeout', async () => {
    const { api } = setup({ commit: () => new Promise(() => undefined) }, SAVED, { timeoutMs: 20 });
    await expect(api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'timeout', message: 'The class did not answer in time. Try again.' });
  });
  it('a name changed from another tab is retried once with the member name and the same id', async () => {
    const id = newHandinId();
    const { api, fake, storage } = setup({
      commit: async (_ops, attempt) => {
        if (attempt === 1) {
          fake.docs[`classes/${CODE}/members/${UID}`] = { ...MEMBER_DOC, firstName: 'Sara', lastName: 'Mansour', nameKey: 'sara mansour' };
          throw denied;
        }
      },
    });
    const record = await api.handIn(SESSION, DRAFT, id);
    expect(record).toMatchObject({ firstName: 'Sara', lastName: 'Mansour', nameKey: 'sara mansour' });
    expect(fake.stats.commits).toBe(2);
    expect(fake.ops.filter((o) => o.type === 'set').map((o) => o.data.nameKey)).toEqual(['ali khoury', 'sara mansour']);
    expect(loadSavedSession(storage)).toMatchObject({ firstName: 'Sara', lastName: 'Mansour' });
  });
  it('permission-denied is diagnosed: device removed, class stopped, limit, plain', async () => {
    const fails = async () => {
      throw denied;
    };
    const removed = setup({ commit: fails });
    removed.fake.docs[`classes/${CODE}/members/${UID}`] = null;
    await expect(removed.api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'device_removed' });
    const stopped = setup({ commit: fails });
    stopped.fake.docs[`classes/${CODE}`] = { ...CLASS_DOC, handinsOpen: false };
    await expect(stopped.api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'handins_closed' });
    const limit = setup({ commit: fails });
    limit.fake.docs[`classes/${CODE}/members/${UID}`] = { ...MEMBER_DOC, handinCount: 300 };
    await expect(limit.api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'limit_reached' });
    const plain = setup({ commit: fails });
    await expect(plain.api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'permission' });
  });
  it('refuses when the anonymous user is gone', async () => {
    const { api } = setup({ uid: null });
    await expect(api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'lost_identity' });
  });
});

describe('forget', () => {
  it('clears the session, keeps the sign-in and the code unless asked to forget it', async () => {
    const { api, fake, storage } = setup();
    saveLastCode(CODE, storage);
    api.forget();
    expect(fake.stats.signOuts).toBe(0);
    expect(fake.deletedUsers).toEqual([]);
    expect(storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(CODE);
    saveSession(SAVED, storage);
    api.forget({ forgetCode: true });
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBeNull();
    expect(await api.restore()).toBeNull();
  });
});
