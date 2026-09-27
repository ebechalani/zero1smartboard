/**
 * src/classroom/student.ts with a fake SDK (docs/CLASSROOM.md §7.2): no download without a
 * session, the confirm reasons, the diagnosis table, local checks, the retry protocol and the
 * missing-index case. The real SDK is exercised in tests-emulator/student-api.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { LIMITS, newHandinId, type HandinDraft } from '../src/classroom/model';
import { CLASSROOM_STORAGE_KEY, LAST_CODE_STORAGE_KEY, loadSavedSession, markConfirmedInTab, saveLastCode, saveSession, type SavedSession } from '../src/classroom/session-store';
import { createStudentApi, diagnoseHandinRefusal, type StudentSession } from '../src/classroom/student';
import { fakeStudentFirebase, memoryStorage, type FakeStudentOptions } from './classroom-fakes';

const CODE = 'BKT4M9';
const UID = 'anon-1';
const S1 = 'aaaaaaa1';
const NOW = 1_800_000_000_000;
const ts = (ms: number) => ({ toDate: () => new Date(ms) });

const CLASS_DOC = {
  ownerUid: 'tA',
  name: '8B Robotics',
  teacherName: 'Mr. B',
  roster: { [S1]: 'ali.k', bbbbbbb2: 'sara.m' },
  joinOpen: true,
  joinWindowAt: null,
  rejoin: {},
  handinsOpen: true,
  tasks: { tsk001: 'Traffic light' },
  currentTaskId: 'tsk001',
  keepWeeks: 10,
  deleting: false,
  createdAt: ts(NOW - 86_400_000),
  updatedAt: ts(NOW - 86_400_000),
};
const MEMBER_DOC = { studentId: S1, username: 'ali.k', ownerUid: 'tA', joinedAt: ts(NOW - 3_600_000), device: 'Chrome · Linux', handinCount: 0, lastHandinAt: null, lastHandinId: '' };
const SAVED: SavedSession = { v: 1, code: CODE, className: '8B Robotics', teacherName: 'Mr. B', studentId: S1, username: 'ali.k', uid: UID, lastUsedAt: NOW - 60_000, lastHandinAt: 0, lastHandinTitle: '' };
const SESSION: StudentSession = { code: CODE, className: '8B Robotics', teacherName: 'Mr. B', studentId: S1, username: 'ali.k', uid: UID };
const DRAFT: HandinDraft = { kind: 'code', code: 'void setup() {}\nvoid loop() {}\n', workspaceJson: '', taskId: 'tsk001', title: 'Mine', note: 'hi' };

function setup(options: FakeStudentOptions = {}, session: SavedSession | null = SAVED, opts: { now?: number; confirmed?: boolean; timeoutMs?: number } = {}) {
  const fake = fakeStudentFirebase({
    uid: UID,
    ...options,
    docs: { [`classes/${CODE}`]: CLASS_DOC, [`classes/${CODE}/members/${UID}`]: MEMBER_DOC, ...(options.docs ?? {}) },
  });
  const storage = memoryStorage();
  const tabStorage = memoryStorage();
  if (session) saveSession(session, storage);
  if (opts.confirmed !== false) markConfirmedInTab(UID, tabStorage);
  const load = vi.fn(async () => fake.fb);
  const now = opts.now ?? NOW;
  const api = createStudentApi({ load, storage, tabStorage, now: () => now, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/129.0.0.0 Safari/537.36', timeoutMs: opts.timeoutMs ?? 1000 });
  return { api, fake, storage, tabStorage, load };
}

describe('restore', () => {
  it('resolves null without loading Firebase when nothing is saved', async () => {
    const { api, load } = setup({}, null);
    expect(await api.restore()).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
  it('goes straight to Ready when confirmed in this tab and used recently', async () => {
    const { api, fake } = setup();
    const result = await api.restore();
    expect(result?.confirm).toBeNull();
    expect(result?.session).toEqual(SESSION);
    expect(result?.info.students.map((s) => s.username)).toEqual(['ali.k', 'sara.m']);
    expect(result?.lastHandin).toBeNull();
    expect(fake.reads).toEqual([`classes/${CODE}`]); // the member doc is not read here
  });
  it("asks to confirm in a new tab ('new_tab') and after 20 minutes ('stale')", async () => {
    expect((await setup({}, SAVED, { confirmed: false }).api.restore())?.confirm).toBe('new_tab');
    expect((await setup({}, { ...SAVED, lastUsedAt: NOW - LIMITS.confirmAfterMs - 1 }).api.restore())?.confirm).toBe('stale');
    expect((await setup({}, { ...SAVED, lastUsedAt: NOW - LIMITS.confirmAfterMs + 1000 }).api.restore())?.confirm).toBeNull();
  });
  it('refreshes the names, and reports the last hand-in', async () => {
    const { api, storage } = setup({ docs: { [`classes/${CODE}`]: { ...CLASS_DOC, name: '8B', roster: { [S1]: 'ali.kh' } } } }, { ...SAVED, lastHandinAt: NOW - 5000, lastHandinTitle: 'Traffic light' });
    const result = await api.restore();
    expect(result?.session.username).toBe('ali.kh');
    expect(result?.session.className).toBe('8B');
    expect(result?.lastHandin).toEqual({ at: NOW - 5000, title: 'Traffic light' });
    expect(loadSavedSession(storage)?.username).toBe('ali.kh');
  });
  it('lost_identity when the anonymous user changed: the session is cleared, the last code kept', async () => {
    const { api, storage } = setup({ uid: 'someone-else' });
    saveLastCode(CODE, storage);
    await expect(api.restore()).rejects.toMatchObject({ code: 'lost_identity' });
    expect(storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(CODE);
  });
  it('class_deleted (cleared), handins_closed and not_on_roster', async () => {
    const gone = setup({ docs: { [`classes/${CODE}`]: null } });
    await expect(gone.api.restore()).rejects.toMatchObject({ code: 'class_deleted' });
    expect(gone.storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
    const deleting = setup({ docs: { [`classes/${CODE}`]: { ...CLASS_DOC, deleting: true } } });
    await expect(deleting.api.restore()).rejects.toMatchObject({ code: 'class_deleted' });
    const stopped = setup({ docs: { [`classes/${CODE}`]: { ...CLASS_DOC, handinsOpen: false } } });
    await expect(stopped.api.restore()).rejects.toMatchObject({ code: 'handins_closed', message: '8B Robotics no longer accepts hand-ins. If you have a new class code, choose Different class.' });
    expect(stopped.storage.getItem(CLASSROOM_STORAGE_KEY)).not.toBeNull();
    const removed = setup({ docs: { [`classes/${CODE}`]: { ...CLASS_DOC, roster: { bbbbbbb2: 'sara.m' } } } });
    await expect(removed.api.restore()).rejects.toMatchObject({ code: 'not_on_roster' });
  });
});

describe('findClass, refreshClass, join, continueAs, confirm', () => {
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
    expect(found.existing).toEqual({ studentId: S1, username: 'ali.k' });
    expect(found.info.code).toBe(CODE);
    expect(found.info.currentTaskId).toBe('tsk001');
  });
  it('class_not_found and handins_closed', async () => {
    const missing = setup({ docs: { [`classes/${CODE}`]: null } }, null);
    await expect(missing.api.findClass(CODE)).rejects.toMatchObject({ code: 'class_not_found', message: 'There is no class with the code BKT-4M9. Check the code with your teacher.' });
    const stopped = setup({ docs: { [`classes/${CODE}`]: { ...CLASS_DOC, handinsOpen: false } } }, null);
    await expect(stopped.api.findClass(CODE)).rejects.toMatchObject({ code: 'handins_closed' });
    await expect(missing.api.refreshClass(CODE)).rejects.toMatchObject({ code: 'class_not_found' });
  });
  it('join: closed joining is detected locally, with no write', async () => {
    const { api, fake } = setup({ docs: { [`classes/${CODE}`]: { ...CLASS_DOC, joinOpen: false }, [`classes/${CODE}/members/${UID}`]: null } }, null);
    const found = await api.findClass(CODE);
    await expect(api.join(found.info, S1)).rejects.toMatchObject({ code: 'class_closed', message: 'Joining 8B Robotics is closed right now. Ask your teacher to open joining for a few minutes.' });
    await expect(api.join(found.info, 'zzzzzzz9')).rejects.toMatchObject({ code: 'not_on_roster' });
    expect(fake.sets).toEqual([]);
  });
  it('join: writes the member doc, saves the session, marks the tab and the last code', async () => {
    const { api, fake, storage, tabStorage } = setup({ docs: { [`classes/${CODE}/members/${UID}`]: null } }, null, { confirmed: false });
    const found = await api.findClass(CODE);
    const session = await api.join(found.info, S1);
    expect(session).toEqual(SESSION);
    expect(fake.sets).toHaveLength(1);
    expect(fake.sets[0].path).toBe(`classes/${CODE}/members/${UID}`);
    expect(fake.sets[0].data).toMatchObject({ studentId: S1, username: 'ali.k', ownerUid: 'tA', device: 'Chrome · Linux', handinCount: 0, lastHandinAt: null, lastHandinId: '' });
    expect(loadSavedSession(storage)).toMatchObject({ v: 1, code: CODE, uid: UID, username: 'ali.k', lastUsedAt: NOW, lastHandinAt: 0 });
    expect(tabStorage.getItem('z1.classroom.confirmed')).toBe(UID);
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(CODE);
  });
  it('join: a denied write is diagnosed with fresh reads, and a rename is retried once', async () => {
    const fresh = { ...CLASS_DOC, roster: { [S1]: 'ali.kh' } };
    let attempts = 0;
    const { api, fake } = setup(
      {
        docs: { [`classes/${CODE}/members/${UID}`]: null },
        setDoc: async () => {
          if (attempts++ === 0) {
            fake.docs[`classes/${CODE}`] = fresh;
            throw { code: 'permission-denied', name: 'FirebaseError', message: 'denied' };
          }
        },
      },
      null,
    );
    const found = await api.findClass(CODE);
    const session = await api.join(found.info, S1);
    expect(session.username).toBe('ali.kh');
    expect(fake.sets.map((s) => s.data.username)).toEqual(['ali.k', 'ali.kh']);
  });
  it('join: a class closed meanwhile → class_closed; stopped → handins_closed', async () => {
    const denied = async () => {
      throw { code: 'permission-denied', name: 'FirebaseError', message: 'denied' };
    };
    const closed = setup({ docs: { [`classes/${CODE}/members/${UID}`]: null }, setDoc: denied }, null);
    const found = await closed.api.findClass(CODE);
    closed.fake.docs[`classes/${CODE}`] = { ...CLASS_DOC, joinOpen: false };
    await expect(closed.api.join(found.info, S1)).rejects.toMatchObject({ code: 'class_closed' });
    closed.fake.docs[`classes/${CODE}`] = { ...CLASS_DOC, handinsOpen: false };
    await expect(closed.api.join(found.info, S1)).rejects.toMatchObject({ code: 'handins_closed' });
    closed.fake.docs[`classes/${CODE}`] = null;
    await expect(closed.api.join(found.info, S1)).rejects.toMatchObject({ code: 'class_not_found' });
  });
  it('continueAs saves the existing binding; confirm marks the tab and refreshes lastUsedAt', async () => {
    const { api, storage, tabStorage } = setup({}, null, { confirmed: false });
    const found = await api.findClass(CODE);
    const session = await api.continueAs(found);
    expect(session).toEqual(SESSION);
    expect(loadSavedSession(storage)?.studentId).toBe(S1);
    expect(tabStorage.getItem('z1.classroom.confirmed')).toBe(UID);
    tabStorage.clear();
    saveSession({ ...SAVED, lastUsedAt: 1 }, storage);
    api.confirm(session);
    expect(tabStorage.getItem('z1.classroom.confirmed')).toBe(UID);
    expect(loadSavedSession(storage)?.lastUsedAt).toBe(NOW);
  });
});

describe('diagnoseHandinRefusal', () => {
  const cls = { roster: { [S1]: 'ali.k' }, deleting: false, handinsOpen: true, tasks: { tsk001: 'Traffic light' } };
  const member = { studentId: S1, handinCount: 3, lastHandinAt: new Date(NOW - 60_000), lastHandinId: 'X'.repeat(20) };
  const id = 'Y'.repeat(20);
  it('follows the order of §4.7', () => {
    expect(diagnoseHandinRefusal(cls, { ...member, lastHandinId: id }, SESSION, DRAFT, id, NOW)).toBe('arrived');
    expect(diagnoseHandinRefusal(null, member, SESSION, DRAFT, id, NOW)).toBe('class_deleted');
    expect(diagnoseHandinRefusal({ ...cls, deleting: true }, member, SESSION, DRAFT, id, NOW)).toBe('class_deleted');
    expect(diagnoseHandinRefusal({ ...cls, handinsOpen: false }, member, SESSION, DRAFT, id, NOW)).toBe('handins_closed');
    expect(diagnoseHandinRefusal(cls, null, SESSION, DRAFT, id, NOW)).toBe('device_removed');
    expect(diagnoseHandinRefusal({ ...cls, roster: {} }, member, SESSION, DRAFT, id, NOW)).toBe('not_on_roster');
    expect(diagnoseHandinRefusal(cls, { ...member, handinCount: 300 }, SESSION, DRAFT, id, NOW)).toBe('limit_reached');
    expect(diagnoseHandinRefusal(cls, { ...member, lastHandinAt: new Date(NOW - 10_500) }, SESSION, DRAFT, id, NOW)).toBe('too_soon');
    expect(diagnoseHandinRefusal(cls, { ...member, lastHandinAt: new Date(NOW - 11_500) }, SESSION, DRAFT, id, NOW)).toBe('permission');
    expect(diagnoseHandinRefusal({ ...cls, roster: { [S1]: 'ali.kh' } }, member, SESSION, DRAFT, id, NOW)).toBe('renamed');
    expect(diagnoseHandinRefusal(cls, member, SESSION, { ...DRAFT, taskId: 'zzzzzz' }, id, NOW)).toBe('permission');
    expect(diagnoseHandinRefusal(cls, member, SESSION, { ...DRAFT, taskId: '' }, id, NOW)).toBe('permission');
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
  it('commits the 2-write batch and records the hand-in', async () => {
    const { api, fake, storage } = setup();
    const id = newHandinId();
    const record = await api.handIn(SESSION, { ...DRAFT, title: '  Mine  ', note: 'a\r\n\r\n\r\nb' }, id);
    expect(record).toMatchObject({ id, classCode: CODE, uid: UID, studentId: S1, username: 'ali.k', kind: 'code', taskId: 'tsk001', title: 'Mine', note: 'a\n\nb', createdAt: new Date(NOW) });
    expect(record.content).toEqual({ enc: 'plain', code: DRAFT.code, workspace: '' });
    expect(fake.ops.map((o) => `${o.type} ${o.path}`)).toEqual([`set classes/${CODE}/handins/${id}`, `update classes/${CODE}/members/${UID}`]);
    expect(fake.ops[0].data).toMatchObject({ uid: UID, ownerUid: 'tA', enc: 'plain', code: DRAFT.code, workspace: '' });
    expect(fake.ops[1].data).toMatchObject({ handinCount: { increment: 1 }, lastHandinId: id });
    expect(fake.docs[`classes/${CODE}/members/${UID}`]).toMatchObject({ handinCount: 1, lastHandinId: id });
    expect(loadSavedSession(storage)).toMatchObject({ lastHandinAt: NOW, lastHandinTitle: 'Traffic light' });
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
  it('a rename by the teacher is retried once with the same id', async () => {
    const id = newHandinId();
    const denied = { code: 'permission-denied', name: 'FirebaseError', message: 'denied' };
    const { api, fake, storage } = setup({
      commit: async (_ops, attempt) => {
        if (attempt === 1) {
          fake.docs[`classes/${CODE}`] = { ...CLASS_DOC, roster: { [S1]: 'ali.kh' } };
          throw denied;
        }
      },
    });
    const record = await api.handIn(SESSION, DRAFT, id);
    expect(record.username).toBe('ali.kh');
    expect(fake.stats.commits).toBe(2);
    expect(fake.ops.filter((o) => o.type === 'set').map((o) => o.data.username)).toEqual(['ali.k', 'ali.kh']);
    expect(loadSavedSession(storage)?.username).toBe('ali.kh');
  });
  it('permission-denied is diagnosed: device removed, class stopped, task gone, limit', async () => {
    const denied = async () => {
      throw { code: 'permission-denied', name: 'FirebaseError', message: 'denied' };
    };
    const removed = setup({ commit: denied });
    removed.fake.docs[`classes/${CODE}/members/${UID}`] = null;
    await expect(removed.api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'device_removed' });
    const stopped = setup({ commit: denied });
    stopped.fake.docs[`classes/${CODE}`] = { ...CLASS_DOC, handinsOpen: false };
    await expect(stopped.api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'handins_closed' });
    const task = setup({ commit: denied });
    await expect(task.api.handIn(SESSION, { ...DRAFT, taskId: 'zzzzzz' }, newHandinId())).rejects.toMatchObject({ code: 'permission', message: 'task' });
    const limit = setup({ commit: denied });
    limit.fake.docs[`classes/${CODE}/members/${UID}`] = { ...MEMBER_DOC, handinCount: 300 };
    await expect(limit.api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'limit_reached' });
    const plain = setup({ commit: denied });
    await expect(plain.api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'permission' });
  });
  it('refuses when the anonymous user is gone', async () => {
    const { api } = setup({ uid: null });
    await expect(api.handIn(SESSION, DRAFT, newHandinId())).rejects.toMatchObject({ code: 'lost_identity' });
  });
});

describe('myHandins', () => {
  it('maps failed-precondition to index_missing with no fallback query', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { api, fake } = setup({
      getDocs: async () => {
        throw { code: 'failed-precondition', name: 'FirebaseError', message: 'The query requires an index. https://console.firebase.google.com/...' };
      },
    });
    await expect(api.myHandins(SESSION)).rejects.toMatchObject({ code: 'index_missing' });
    expect(fake.stats.getDocs).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
  it('queries by uid, newest first, 20 per page', async () => {
    const docs = Array.from({ length: 21 }, (_, i) => ({ id: `H${i}`, data: () => ({ uid: UID, studentId: S1, username: 'ali.k', kind: 'code', taskId: '', title: `t${i}`, note: '', createdAt: ts(NOW - i * 1000), enc: 'plain', code: 'x', workspace: '' }) }));
    let seen: unknown;
    const { api } = setup({
      getDocs: async (q) => {
        seen = q;
        return { docs };
      },
    });
    const page = await api.myHandins(SESSION, { before: new Date(NOW) });
    expect(page.items).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.items[0]).toMatchObject({ id: 'H0', title: 't0', classCode: CODE });
    expect(seen).toMatchObject({ path: `classes/${CODE}/handins` });
    expect((seen as { constraints: { kind: string }[] }).constraints.map((c) => c.kind)).toEqual(['where', 'orderBy', 'startAfter', 'limit']);
    expect((seen as { constraints: { field?: string; value?: unknown; n?: number }[] }).constraints[0]).toMatchObject({ field: 'uid', value: UID });
    expect((seen as { constraints: { n?: number }[] }).constraints[3]).toMatchObject({ n: 21 });
  });
});

describe('leave', () => {
  it('deletes the anonymous user, signs out, clears the session; the code is kept unless forgotten', async () => {
    const { api, fake, storage, tabStorage } = setup();
    saveLastCode(CODE, storage);
    await api.leave();
    expect(fake.deletedUsers).toEqual([UID]);
    expect(fake.stats.signOuts).toBe(1);
    expect(storage.getItem(CLASSROOM_STORAGE_KEY)).toBeNull();
    expect(tabStorage.getItem('z1.classroom.confirmed')).toBeNull();
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBe(CODE);
    saveSession(SAVED, storage);
    await api.leave({ forgetCode: true });
    expect(storage.getItem(LAST_CODE_STORAGE_KEY)).toBeNull();
  });
  it('works without a session and without Firebase', async () => {
    const { api, load } = setup({}, null);
    await api.leave();
    expect(load).not.toHaveBeenCalled();
  });
});
