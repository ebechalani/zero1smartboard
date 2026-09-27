/**
 * firestore.rules (docs/CLASSROOM.md §3.1) against the Firestore emulator: the happy path of every
 * client operation and the attacks from the security, classroom-UX and feasibility reviews (§7.1,
 * cases R1-R8). Ported unchanged from the verified suite of the specification (Appendix B).
 *
 * Run: npm run test:rules (or npm run test:emulator). RULES_FILE points at a mutated copy for
 * tests-emulator/mutations.sh; the default is the repository's firestore.rules.
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Bytes,
  Timestamp,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

let env: RulesTestEnvironment;

const CODE = 'BKT4M9';
const CODE2 = 'BKT4M7';
const S1 = 'aaaaaaa1';
const S2 = 'bbbbbbb2';
const S3 = 'ccccccc3';
const T1 = 'tsk001';

const teacher = (uid: string, extra: Record<string, unknown> = {}) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' }, email: `${uid}@school.edu`, email_verified: true, ...extra }).firestore() as unknown as Firestore;
const student = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore() as unknown as Firestore;
const nobody = () => env.unauthenticatedContext().firestore() as unknown as Firestore;

function newClass(ownerUid = 'tA', over: Record<string, unknown> = {}) {
  return {
    schema: 1,
    ownerUid,
    name: '8B Robotics',
    teacherName: 'Mr. B',
    roster: { [S1]: 'ali.k', [S2]: 'sara.m', [S3]: 'omar_7' },
    joinOpen: true,
    joinWindowAt: null,
    rejoin: {},
    handinsOpen: true,
    tasks: { [T1]: 'Traffic light' },
    currentTaskId: T1,
    keepWeeks: 10,
    deleting: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...over,
  };
}

function join(studentId = S1, username = 'ali.k', over: Record<string, unknown> = {}) {
  return {
    studentId,
    username,
    ownerUid: 'tA',
    joinedAt: serverTimestamp(),
    device: 'Chrome · Windows',
    handinCount: 0,
    lastHandinAt: null,
    lastHandinId: '',
    ...over,
  };
}

let idCounter = 0;
const newId = () => `H${String(++idCounter).padStart(19, '0')}`;
const gz = (s: string) => Bytes.fromUint8Array(new Uint8Array(gzipSync(Buffer.from(s, 'utf8'))));
const EMPTY_BYTES = Bytes.fromUint8Array(new Uint8Array(0));

interface HandinOpts {
  uid?: string;
  code?: string;
  hid?: string;
  data?: Record<string, unknown>;
  tick?: Record<string, unknown> | null;
  tickHid?: string;
}

/** The student's hand-in batch: the hand-in + the member counter tick. */
function handIn(db: Firestore, o: HandinOpts = {}) {
  const uid = o.uid ?? 'stu1';
  const code = o.code ?? CODE;
  const hid = o.hid ?? newId();
  const batch = writeBatch(db);
  batch.set(doc(db, `classes/${code}/handins/${hid}`), {
    uid,
    studentId: S1,
    username: 'ali.k',
    ownerUid: 'tA',
    kind: 'code',
    taskId: T1,
    title: 'Traffic light',
    note: '',
    createdAt: serverTimestamp(),
    enc: 'plain',
    code: 'void setup() {}\nvoid loop() {}\n',
    workspace: '',
    ...o.data,
  });
  if (o.tick !== null) {
    batch.update(doc(db, `classes/${code}/members/${uid}`), {
      handinCount: increment(1),
      lastHandinAt: serverTimestamp(),
      lastHandinId: o.tickHid ?? hid,
      ...o.tick,
    });
  }
  return { commit: () => batch.commit(), hid };
}

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, path), data);
  });
}
async function seedClass(over: Record<string, unknown> = {}, code = CODE, owner = 'tA') {
  await seed(`classes/${code}`, { ...newClass(owner), createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...over });
}
async function seedMember(uid = 'stu1', studentId = S1, username = 'ali.k', over: Record<string, unknown> = {}, code = CODE) {
  await seed(`classes/${code}/members/${uid}`, { ...join(studentId, username), joinedAt: Timestamp.now(), ...over });
}
function storedHandin(uid: string, studentId: string, username: string, over: Record<string, unknown> = {}) {
  return { uid, studentId, username, ownerUid: 'tA', kind: 'code', taskId: T1, title: 't', note: '', createdAt: Timestamp.now(), enc: 'plain', code: 'x', workspace: '', ...over };
}
const minutesAgo = (m: number) => Timestamp.fromMillis(Date.now() - m * 60_000);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-zero1',
    firestore: { rules: readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

// ======================================================================= classes

describe('R1 classes: create', () => {
  it('R1.1 a Google teacher creates a class (joining open, tasks, retention)', async () => {
    await assertSucceeds(setDoc(doc(teacher('tA'), `classes/${CODE}`), newClass('tA')));
  });
  it('R1.2 only verified Google sign-ins are teachers', async () => {
    await assertFails(setDoc(doc(student('tA'), `classes/${CODE}`), newClass('tA')));
    const unverified = env.authenticatedContext('tA', { firebase: { sign_in_provider: 'google.com' }, email_verified: false }).firestore() as unknown as Firestore;
    await assertFails(setDoc(doc(unverified, `classes/${CODE}`), newClass('tA')));
    const noClaim = env.authenticatedContext('tA', { firebase: { sign_in_provider: 'google.com' } }).firestore() as unknown as Firestore;
    await assertFails(setDoc(doc(noClaim, `classes/${CODE}`), newClass('tA')));
    for (const provider of ['password', 'custom', 'phone', 'facebook.com'] as const) {
      const db = env.authenticatedContext(`u_${provider}`, { firebase: { sign_in_provider: provider }, email: 'x@y.z', email_verified: true }).firestore() as unknown as Firestore;
      await assertFails(setDoc(doc(db, `classes/${CODE}`), newClass(`u_${provider}`)));
    }
    const smuggler = env.authenticatedContext('stuX', { firebase: { sign_in_provider: 'anonymous' }, email: 'x@y.z', email_verified: true, sign_in_provider: 'google.com' }).firestore() as unknown as Firestore;
    await assertFails(setDoc(doc(smuggler, `classes/${CODE}`), newClass('stuX')));
    await assertFails(setDoc(doc(nobody(), `classes/${CODE}`), newClass('tA')));
  });
  it('R1.3 ownerUid must be the teacher', async () => {
    await assertFails(setDoc(doc(teacher('tA'), `classes/${CODE}`), newClass('tB')));
  });
  it.each(['BKT4M', 'BKT4M9X', 'bkt4m9', 'BAT4M9', 'BKT0M9', 'BKT1M9', 'BKT2M9', 'BKT5M9', 'BKT6M9', 'BKT8M9', 'BKTYM9'])(
    'R1.4 refuses the code %s',
    async (code) => {
      await assertFails(setDoc(doc(teacher('tA'), `classes/${code}`), newClass('tA')));
    },
  );
  it('R1.5 refuses extra/missing fields, client times, deleting, schema 2, rejoin at creation, a client join window', async () => {
    const db = teacher('tA');
    const at = `classes/${CODE}`;
    await assertFails(setDoc(doc(db, at), newClass('tA', { admin: true })));
    const missing: Record<string, unknown> = newClass('tA');
    delete missing.keepWeeks;
    await assertFails(setDoc(doc(db, at), missing));
    await assertFails(setDoc(doc(db, at), newClass('tA', { createdAt: Timestamp.fromMillis(0) })));
    await assertFails(setDoc(doc(db, at), newClass('tA', { deleting: true })));
    await assertFails(setDoc(doc(db, at), newClass('tA', { schema: 2 })));
    await assertFails(setDoc(doc(db, at), newClass('tA', { rejoin: { [S1]: Timestamp.now() } })));
    await assertFails(setDoc(doc(db, at), newClass('tA', { joinWindowAt: Timestamp.fromMillis(Date.now() + 86_400_000) })));
    await assertSucceeds(setDoc(doc(db, at), newClass('tA', { joinOpen: false, joinWindowAt: serverTimestamp() })));
  });
  it('R1.6 checks name lengths', async () => {
    const db = teacher('tA');
    await assertFails(setDoc(doc(db, `classes/${CODE}`), newClass('tA', { name: '' })));
    await assertFails(setDoc(doc(db, `classes/${CODE}`), newClass('tA', { name: 'x'.repeat(61) })));
    await assertSucceeds(setDoc(doc(db, `classes/${CODE}`), newClass('tA', { name: 'x'.repeat(60) })));
    await assertFails(setDoc(doc(db, `classes/${CODE2}`), newClass('tA', { teacherName: 'x'.repeat(61) })));
  });
  it('R1.7 a teacher cannot overwrite an existing class (code collision) by creating it again', async () => {
    await seedClass();
    await assertFails(setDoc(doc(teacher('tB'), `classes/${CODE}`), newClass('tB')));
    await assertFails(setDoc(doc(teacher('tA'), `classes/${CODE}`), newClass('tA')));
  });
});

describe('R2 classes: roster, tasks, retention validation', () => {
  const put = (over: Record<string, unknown>, code = CODE) => setDoc(doc(teacher('tA'), `classes/${code}`), newClass('tA', over));
  it('R2.1 accepts an empty roster and 100 students; refuses 101', async () => {
    await assertSucceeds(put({ roster: {}, currentTaskId: '', tasks: {} }));
    const big: Record<string, string> = {};
    for (let i = 0; i < 101; i++) big[`s${String(i).padStart(7, '0')}`] = `student.${i}`;
    await assertFails(put({ roster: big }, CODE2));
    delete big.s0000100;
    await assertSucceeds(put({ roster: big }, CODE2));
  });
  it.each([['Ali.K'], ['ali k'], ['a'], ['.ali'], ['x'.repeat(25)], ['élise'], ['ali\nk']])('R2.2 refuses the username %j', async (name) => {
    await assertFails(put({ roster: { [S1]: name } }));
  });
  it('R2.3 accepts 2- and 24-character usernames; refuses duplicates, bad ids, non-strings, arrays', async () => {
    await assertSucceeds(put({ roster: { [S1]: 'ab', [S2]: 'x'.repeat(24) } }));
    await assertFails(put({ roster: { [S1]: 'ali.k', [S2]: 'ali.k' } }, CODE2));
    await assertFails(put({ roster: { ABCDEFGH: 'ali.k' } }, CODE2));
    await assertFails(put({ roster: { short: 'ali.k' } }, CODE2));
    await assertFails(put({ roster: { [S1]: 7 } }, CODE2));
    await assertFails(put({ roster: ['ali.k'] }, CODE2));
  });
  it('R2.4 tasks: up to 30, 6-char ids, titles 1-60 chars (any language); currentTaskId must exist', async () => {
    const t30: Record<string, string> = {};
    for (let i = 0; i < 30; i++) t30[`t${String(i).padStart(5, '0')}`] = `Tâche ${i} · مهمة`;
    await assertSucceeds(put({ tasks: t30, currentTaskId: 't00000' }));
    await assertFails(put({ tasks: { ...t30, t00030: 'one more' }, currentTaskId: '' }, CODE2));
    await assertFails(put({ tasks: { TSK001: 'Upper-case id' }, currentTaskId: '' }, CODE2));
    await assertFails(put({ tasks: { [T1]: '' } }, CODE2));
    await assertFails(put({ tasks: { [T1]: 'x'.repeat(61) } }, CODE2));
    await assertSucceeds(put({ tasks: { [T1]: 'x'.repeat(60) } }, CODE2));
    await assertFails(put({ tasks: { [T1]: 'Traffic light' }, currentTaskId: 'zzzzzz' }, 'BKT4M3'));
  });
  it('R2.6 join() turns non-strings into text: an int task title or username passes the class rules (owner-only data), but nobody can join as such a name', async () => {
    await assertSucceeds(put({ tasks: { [T1]: 7 } }, 'BKT4M3'));
    await assertSucceeds(put({ roster: { [S1]: 12 } }, 'BKT4M4'));
    await assertFails(setDoc(doc(student('stu1'), 'classes/BKT4M4/members/stu1'), join(S1, '12')));
    await assertFails(setDoc(doc(student('stu1'), 'classes/BKT4M4/members/stu1'), join(S1, 12 as unknown as string)));
  });
  it('R2.5 keepWeeks is an integer 1-52', async () => {
    await assertFails(put({ keepWeeks: 0 }));
    await assertFails(put({ keepWeeks: 53 }));
    await assertFails(put({ keepWeeks: 10.5 }));
    await assertFails(put({ keepWeeks: '10' }));
    await assertSucceeds(put({ keepWeeks: 52 }));
  });
});

describe('R3 classes: read, list, update, delete', () => {
  beforeEach(() => seedClass());
  it('R3.1 anyone signed in can get a class by its code (also a missing one); signed-out visitors cannot', async () => {
    await assertSucceeds(getDoc(doc(student('stu1'), `classes/${CODE}`)));
    await assertSucceeds(getDoc(doc(teacher('tB'), `classes/${CODE}`)));
    await assertFails(getDoc(doc(nobody(), `classes/${CODE}`)));
    const snap = await assertSucceeds(getDoc(doc(student('stu1'), 'classes/ZZZZZZ')));
    expect(snap.exists()).toBe(false);
  });
  it('R3.2 the class GET shows ownerUid and the roster to code-holders, never an email (documented exposure)', async () => {
    const data = (await getDoc(doc(student('anon1'), `classes/${CODE}`))).data()!;
    expect(data.ownerUid).toBe('tA');
    expect(Object.values(data.roster)).toContain('sara.m');
    expect(JSON.stringify(data)).not.toContain('@');
  });
  it('R3.3 a teacher lists only their own classes, with the ownerUid filter', async () => {
    await seedClass({}, CODE2, 'tB');
    const own = await assertSucceeds(getDocs(query(collection(teacher('tA'), 'classes'), where('ownerUid', '==', 'tA'))));
    expect(own.size).toBe(1);
    await assertFails(getDocs(collection(teacher('tA'), 'classes')));
    await assertFails(getDocs(query(collection(teacher('tB'), 'classes'), where('ownerUid', '==', 'tA'))));
    await assertFails(getDocs(query(collection(student('tA'), 'classes'), where('ownerUid', '==', 'tA'))));
    await assertFails(getDocs(query(collection(student('stu1'), 'classes'), where('joinOpen', '==', true))));
  });
  it('R3.4 the owner edits name, roster, joining, hand-ins switch, tasks, current task, retention', async () => {
    await assertSucceeds(
      updateDoc(doc(teacher('tA'), `classes/${CODE}`), {
        name: '8B',
        roster: { [S1]: 'ali.k2', [S2]: 'sara.m' },
        joinOpen: false,
        handinsOpen: false,
        tasks: { [T1]: 'Traffic light', tsk002: 'Servo sweep' },
        currentTaskId: 'tsk002',
        keepWeeks: 20,
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('R3.5 the owner cannot change ownerUid, createdAt, schema, add fields or skip updatedAt', async () => {
    const db = teacher('tA');
    const at = doc(db, `classes/${CODE}`);
    await assertFails(updateDoc(at, { ownerUid: 'tB', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { schema: 2, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { extra: 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { joinOpen: false }));
  });
  it('R3.6 a join window starts at the server time only', async () => {
    const at = doc(teacher('tA'), `classes/${CODE}`);
    await assertSucceeds(updateDoc(at, { joinOpen: false, joinWindowAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { joinWindowAt: Timestamp.fromMillis(Date.now() + 3_600_000), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(at, { joinWindowAt: null, updatedAt: serverTimestamp() }));
  });
  it('R3.7 "Let ali.k join again": rejoin keys must be roster ids; removing a student also removes the rejoin entry', async () => {
    const at = doc(teacher('tA'), `classes/${CODE}`);
    await assertSucceeds(updateDoc(at, { [`rejoin.${S1}`]: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { 'rejoin.zzzzzzz9': serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { [`roster.${S1}`]: deleteField(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(at, { [`roster.${S1}`]: deleteField(), [`rejoin.${S1}`]: deleteField(), updatedAt: serverTimestamp() }));
  });
  it('R3.8 deleting a task also needs currentTaskId cleared', async () => {
    const at = doc(teacher('tA'), `classes/${CODE}`);
    await assertFails(updateDoc(at, { [`tasks.${T1}`]: deleteField(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(at, { [`tasks.${T1}`]: deleteField(), currentTaskId: '', updatedAt: serverTimestamp() }));
  });
  it('R3.9 field-path roster edits work; a duplicate via field path is refused', async () => {
    const db = teacher('tA');
    await assertSucceeds(updateDoc(doc(db, `classes/${CODE}`), { 'roster.ddddddd4': 'nour.h', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db, `classes/${CODE}`), { [`roster.${S1}`]: 'ali.kh', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, `classes/${CODE}`), { 'roster.eeeeeee5': 'sara.m', updatedAt: serverTimestamp() }));
  });
  it('R3.10 other teachers and students cannot update or delete the class; the owner can', async () => {
    await assertFails(updateDoc(doc(teacher('tB'), `classes/${CODE}`), { joinOpen: false, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(student('stu1'), `classes/${CODE}`), { joinOpen: true, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(student('stu1'), `classes/${CODE}`), { [`rejoin.${S1}`]: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(student('stu1'), `classes/${CODE}`), { roster: { [S1]: 'hacker' }, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(teacher('tB'), `classes/${CODE}`)));
    await assertFails(deleteDoc(doc(student('stu1'), `classes/${CODE}`)));
    await assertSucceeds(deleteDoc(doc(teacher('tA'), `classes/${CODE}`)));
  });
  it('R3.11 deleting a class that is already gone succeeds for a teacher (idempotent), not for a student', async () => {
    await assertSucceeds(deleteDoc(doc(teacher('tA'), 'classes/ZZZZZZ')));
    await assertFails(deleteDoc(doc(student('stu1'), 'classes/ZZZZZZ')));
  });
});

// ======================================================================= members

describe('R4 members: join', () => {
  beforeEach(() => seedClass());
  const joinAs = (uid = 'stu1', studentId = S1, username = 'ali.k', over: Record<string, unknown> = {}) =>
    setDoc(doc(student(uid), `classes/${CODE}/members/${uid}`), join(studentId, username, over));
  it('R4.1 a student joins an open class as a roster username', async () => {
    await assertSucceeds(joinAs());
  });
  it('R4.2 closed joining refuses; a 15-minute class window allows; an expired window refuses', async () => {
    await seedClass({ joinOpen: false });
    await assertFails(joinAs());
    await seedClass({ joinOpen: false, joinWindowAt: minutesAgo(5) });
    await assertSucceeds(joinAs());
    await seedClass({ joinOpen: false, joinWindowAt: minutesAgo(16) });
    await assertFails(joinAs('stu2', S2, 'sara.m'));
  });
  it('R4.3 "Let ali.k join again" opens joining for that student only, for 15 minutes', async () => {
    await seedClass({ joinOpen: false, rejoin: { [S1]: minutesAgo(3) } });
    await assertFails(joinAs('stu2', S2, 'sara.m'));
    await assertSucceeds(joinAs('stu1', S1, 'ali.k'));
    await seedClass({ joinOpen: false, rejoin: { [S1]: minutesAgo(20) } });
    await assertFails(joinAs('stu3', S1, 'ali.k'));
  });
  it('R4.4 cannot join when hand-ins are closed, while deleting, or a missing class', async () => {
    await seedClass({ handinsOpen: false });
    await assertFails(joinAs());
    await seedClass({ deleting: true });
    await assertFails(joinAs());
    await assertFails(setDoc(doc(student('stu1'), 'classes/ZZZZZZ/members/stu1'), join()));
  });
  it('R4.5 the username must be the roster name of that studentId; own doc only', async () => {
    await assertFails(joinAs('stu1', S1, 'sara.m'));
    await assertFails(joinAs('stu1', 'zzzzzzz9', 'ali.k'));
    await assertFails(setDoc(doc(student('stu1'), `classes/${CODE}/members/stu2`), join()));
  });
  it('R4.6 refuses a forged counter, owner, time, long device or extra field', async () => {
    await assertFails(joinAs('stu1', S1, 'ali.k', { handinCount: 5 }));
    await assertFails(joinAs('stu1', S1, 'ali.k', { lastHandinAt: Timestamp.fromMillis(0) }));
    await assertFails(joinAs('stu1', S1, 'ali.k', { lastHandinId: newId() }));
    await assertFails(joinAs('stu1', S1, 'ali.k', { ownerUid: 'stu1' }));
    await assertFails(joinAs('stu1', S1, 'ali.k', { joinedAt: Timestamp.fromMillis(0) }));
    await assertFails(joinAs('stu1', S1, 'ali.k', { device: 'x'.repeat(41) }));
    await assertFails(joinAs('stu1', S1, 'ali.k', { pin: '1234' }));
  });
  it('R4.7 the device label is free text up to 40 chars (rendered with textContent only)', async () => {
    await assertSucceeds(joinAs('devC', S1, 'ali.k', { device: '</script><img src=x onerror=alert(1)>' }));
  });
  it('R4.8 a joined device cannot re-bind itself; the counter cannot move without a new hand-in', async () => {
    await seedMember('stu1');
    await assertFails(joinAs('stu1', S2, 'sara.m'));
    await assertFails(updateDoc(doc(student('stu1'), `classes/${CODE}/members/stu1`), { studentId: S2, username: 'sara.m' }));
    await assertFails(
      updateDoc(doc(student('stu1'), `classes/${CODE}/members/stu1`), { handinCount: 1, lastHandinAt: serverTimestamp(), lastHandinId: newId() }),
    );
  });
  it('R4.9 the counter cannot be ticked against an OLD hand-in of this device', async () => {
    await seedMember('stu1', S1, 'ali.k', { handinCount: 1, lastHandinAt: minutesAgo(5) });
    const old = newId();
    await seed(`classes/${CODE}/handins/${old}`, storedHandin('stu1', S1, 'ali.k', { createdAt: minutesAgo(5) }));
    await assertFails(
      updateDoc(doc(student('stu1'), `classes/${CODE}/members/stu1`), { handinCount: increment(1), lastHandinAt: serverTimestamp(), lastHandinId: old }),
    );
  });
});

describe('R5 members: read and remove', () => {
  beforeEach(async () => {
    await seedClass();
    await seedMember('stu1');
    await seedMember('stu2', S2, 'sara.m');
  });
  it('R5.1 a student reads only their own member doc (also before joining)', async () => {
    await assertSucceeds(getDoc(doc(student('stu1'), `classes/${CODE}/members/stu1`)));
    await assertSucceeds(getDoc(doc(student('stu3'), `classes/${CODE}/members/stu3`)));
    await assertFails(getDoc(doc(student('stu1'), `classes/${CODE}/members/stu2`)));
    await assertFails(getDocs(collection(student('stu1'), `classes/${CODE}/members`)));
  });
  it('R5.2 the owner lists (bounded, newest first) and removes computers; other teachers cannot', async () => {
    const list = await assertSucceeds(getDocs(query(collection(teacher('tA'), `classes/${CODE}/members`), orderBy('joinedAt', 'desc'), limit(150))));
    expect(list.size).toBe(2);
    await assertSucceeds(getDocs(query(collection(teacher('tA'), `classes/${CODE}/members`), where('studentId', '==', S1))));
    await assertFails(getDocs(collection(teacher('tB'), `classes/${CODE}/members`)));
    await assertFails(getDoc(doc(teacher('tB'), `classes/${CODE}/members/stu1`)));
    await assertFails(deleteDoc(doc(teacher('tB'), `classes/${CODE}/members/stu1`)));
    await assertFails(deleteDoc(doc(student('stu1'), `classes/${CODE}/members/stu1`)));
    await assertSucceeds(deleteDoc(doc(teacher('tA'), `classes/${CODE}/members/stu1`)));
  });
  it('R5.3 removing a computer twice (two tabs / retry) does not fail the batch', async () => {
    const db = teacher('tA');
    const b1 = writeBatch(db);
    b1.delete(doc(db, `classes/${CODE}/members/stu1`));
    b1.delete(doc(db, `classes/${CODE}/members/stu2`));
    await assertSucceeds(b1.commit());
    const b2 = writeBatch(db);
    b2.delete(doc(db, `classes/${CODE}/members/stu1`));
    b2.delete(doc(db, `classes/${CODE}/members/stu2`));
    await assertSucceeds(b2.commit());
  });
});

// ======================================================================= hand-ins

describe('R6 hand-ins: create', () => {
  beforeEach(async () => {
    await seedClass();
    await seedMember('stu1');
  });
  it('R6.1 a joined student hands in (hand-in + counter tick with increment(1), no read first)', async () => {
    await assertSucceeds(handIn(student('stu1')).commit());
    const m = await getDoc(doc(student('stu1'), `classes/${CODE}/members/stu1`));
    expect(m.data()?.handinCount).toBe(1);
  });
  it('R6.2 blocks hand-in (plain), and gzip-compressed Code and Blocks hand-ins', async () => {
    await assertSucceeds(handIn(student('stu1'), { data: { kind: 'blocks', workspace: '{"blocks":{}}' } }).commit());
    await seedMember('stu1');
    await assertSucceeds(handIn(student('stu1'), { data: { enc: 'gzip', code: gz('void setup(){}'), workspace: EMPTY_BYTES } }).commit());
    await seedMember('stu1');
    await assertSucceeds(
      handIn(student('stu1'), { data: { kind: 'blocks', enc: 'gzip', code: gz('void setup(){}'), workspace: gz('{"blocks":{}}') } }).commit(),
    );
  });
  it('R6.3 encoding must match the field types', async () => {
    const db = student('stu1');
    await assertFails(handIn(db, { data: { enc: 'gzip' } }).commit()); // strings under gzip
    await assertFails(handIn(db, { data: { code: gz('x'), workspace: EMPTY_BYTES } }).commit()); // bytes under plain
    await assertFails(handIn(db, { data: { enc: 'br' } }).commit());
    await assertFails(handIn(db, { data: { enc: 'gzip', code: gz('x'), workspace: '' } }).commit()); // mixed
  });
  it('R6.4 counter: increment(2) and increment(0) are refused; the tick is required and must match', async () => {
    const db = student('stu1');
    await assertFails(handIn(db, { tick: { handinCount: increment(2) } }).commit());
    await assertFails(handIn(db, { tick: { handinCount: increment(0) } }).commit());
    await assertFails(handIn(db, { tick: null }).commit());
    await assertFails(handIn(db, { tickHid: newId() }).commit());
  });
  it('R6.5 a student who has not joined cannot hand in; nor as another username; nor into another class', async () => {
    await assertFails(handIn(student('stu9'), { uid: 'stu9' }).commit());
    await assertFails(handIn(student('stu1'), { data: { studentId: S2, username: 'sara.m' } }).commit());
    await seedClass({}, CODE2, 'tB');
    await assertFails(handIn(student('stu1'), { code: CODE2, data: { ownerUid: 'tB' } }).commit());
    await assertFails(handIn(teacher('tB'), { uid: 'tB' }).commit());
  });
  it('R6.6 refuses forged username, uid, ownerUid, createdAt, kind, extra fields', async () => {
    const db = student('stu1');
    await assertFails(handIn(db, { data: { username: 'someone' } }).commit());
    await assertFails(handIn(db, { data: { uid: 'stu2' } }).commit());
    await assertFails(handIn(db, { data: { ownerUid: 'stu1' } }).commit());
    await assertFails(handIn(db, { data: { createdAt: Timestamp.fromMillis(0) } }).commit());
    await assertFails(handIn(db, { data: { kind: 'python' } }).commit());
    await assertFails(handIn(db, { data: { grade: 20 } }).commit());
  });
  it('R6.7 refuses an id that is not a 20-character auto id', async () => {
    await assertFails(handIn(student('stu1'), { hid: 'short' }).commit());
  });
  it('R6.8 sizes: code 50 000 B, workspace 100 000 B (UTF-8 or gzip bytes), title 80, note 500, no empty sketch', async () => {
    const db = student('stu1');
    await assertSucceeds(handIn(db, { data: { code: 'x'.repeat(50000) } }).commit());
    await seedMember('stu1');
    await assertFails(handIn(db, { data: { code: 'x'.repeat(50001) } }).commit());
    await assertFails(handIn(db, { data: { code: 'é'.repeat(25001) } }).commit());
    await assertFails(handIn(db, { data: { kind: 'blocks', workspace: 'x'.repeat(100001) } }).commit());
    await assertFails(handIn(db, { data: { enc: 'gzip', code: Bytes.fromUint8Array(new Uint8Array(50001)), workspace: EMPTY_BYTES } }).commit());
    await assertFails(handIn(db, { data: { title: 'x'.repeat(81) } }).commit());
    await assertFails(handIn(db, { data: { note: 'x'.repeat(501) } }).commit());
    await assertFails(handIn(db, { data: { code: '' } }).commit());
    await assertSucceeds(handIn(db, { data: { title: 'x'.repeat(80), note: 'y'.repeat(500) } }).commit());
  });
  it('R6.9 a Code hand-in has no workspace; a Blocks hand-in must have one', async () => {
    const db = student('stu1');
    await assertFails(handIn(db, { data: { workspace: '{}' } }).commit());
    await assertFails(handIn(db, { data: { kind: 'blocks', workspace: '' } }).commit());
  });
  it('R6.10 waits 10 s between hand-ins from one device', async () => {
    const db = student('stu1');
    await assertSucceeds(handIn(db).commit());
    await assertFails(handIn(db).commit());
    await seedMember('stu1', S1, 'ali.k', { handinCount: 1, lastHandinAt: Timestamp.fromMillis(Date.now() - 11000) });
    await assertSucceeds(handIn(db).commit());
  });
  it('R6.11 stops at 300 hand-ins per device', async () => {
    await seedMember('stu1', S1, 'ali.k', { handinCount: 300, lastHandinAt: Timestamp.fromMillis(0) });
    await assertFails(handIn(student('stu1')).commit());
    await seedMember('stu1', S1, 'ali.k', { handinCount: 299, lastHandinAt: Timestamp.fromMillis(0) });
    await assertSucceeds(handIn(student('stu1')).commit());
  });
  it('R6.12 removed from the roster: refused; renamed: old name refused, new name accepted', async () => {
    await seedClass({ roster: { [S2]: 'sara.m' } });
    await assertFails(handIn(student('stu1')).commit());
    await seedClass({ roster: { [S1]: 'ali.kh', [S2]: 'sara.m' } });
    await assertFails(handIn(student('stu1')).commit());
    await assertSucceeds(handIn(student('stu1'), { data: { username: 'ali.kh' } }).commit());
  });
  it('R6.13 task: none or an existing task only', async () => {
    const db = student('stu1');
    await assertFails(handIn(db, { data: { taskId: 'zzzzzz' } }).commit());
    await assertSucceeds(handIn(db, { data: { taskId: '' } }).commit());
  });
  it('R6.14 closed joining keeps hand-ins open; "Stop hand-ins" and deleting refuse them', async () => {
    await seedClass({ joinOpen: false });
    await assertSucceeds(handIn(student('stu1')).commit());
    await seedMember('stu1');
    await seedClass({ handinsOpen: false });
    await assertFails(handIn(student('stu1')).commit());
    await seedClass({ deleting: true });
    await assertFails(handIn(student('stu1')).commit());
  });
  it('R6.15 joining and handing in inside ONE batch is refused (a fresh member cannot carry the tick)', async () => {
    const db = student('stu5');
    const hid = newId();
    const b = writeBatch(db);
    b.set(doc(db, `classes/${CODE}/members/stu5`), join(S1, 'ali.k'));
    b.set(doc(db, `classes/${CODE}/handins/${hid}`), { ...storedHandin('stu5', S1, 'ali.k'), createdAt: serverTimestamp() });
    b.update(doc(db, `classes/${CODE}/members/stu5`), { handinCount: increment(1), lastHandinAt: serverTimestamp(), lastHandinId: hid });
    await assertFails(b.commit());
  });
  it('R6.16 a retried batch with the same id after a commit that went through is refused (client then reads its member doc)', async () => {
    const db = student('stu1');
    const hid = newId();
    await assertSucceeds(handIn(db, { hid }).commit());
    await assertFails(handIn(db, { hid }).commit());
    const m = await getDoc(doc(db, `classes/${CODE}/members/stu1`));
    expect(m.data()?.lastHandinId).toBe(hid);
  });
});

describe('R7 hand-ins: read, re-file, delete, prune', () => {
  let mine: string;
  let theirs: string;
  beforeEach(async () => {
    await seedClass();
    await seedMember('stu1');
    await seedMember('stu2', S2, 'sara.m');
    mine = newId();
    theirs = newId();
    await seed(`classes/${CODE}/handins/${mine}`, storedHandin('stu1', S1, 'ali.k'));
    await seed(`classes/${CODE}/handins/${theirs}`, storedHandin('stu2', S2, 'sara.m', { createdAt: minutesAgo(60 * 24 * 90) }));
  });
  it("R7.1 a student reads their own hand-ins (query by uid), never another student's", async () => {
    const db = student('stu1');
    const own = await assertSucceeds(getDocs(query(collection(db, `classes/${CODE}/handins`), where('uid', '==', 'stu1'), orderBy('createdAt', 'desc'), limit(20))));
    expect(own.size).toBe(1);
    await assertSucceeds(getDoc(doc(db, `classes/${CODE}/handins/${mine}`)));
    await assertFails(getDocs(collection(db, `classes/${CODE}/handins`)));
    await assertFails(getDocs(query(collection(db, `classes/${CODE}/handins`), where('studentId', '==', S2))));
    await assertFails(getDoc(doc(db, `classes/${CODE}/handins/${theirs}`)));
  });
  it('R7.2 a student cannot edit, re-file or delete a hand-in after submitting it', async () => {
    const db = student('stu1');
    await assertFails(updateDoc(doc(db, `classes/${CODE}/handins/${mine}`), { title: 'changed' }));
    await assertFails(updateDoc(doc(db, `classes/${CODE}/handins/${mine}`), { studentId: S2, username: 'sara.m' }));
    await assertFails(deleteDoc(doc(db, `classes/${CODE}/handins/${mine}`)));
  });
  it('R7.3 the owner lists (newest first, window, per student), counts and reads', async () => {
    const db = teacher('tA');
    const col = collection(db, `classes/${CODE}/handins`);
    const list = await assertSucceeds(getDocs(query(col, orderBy('createdAt', 'desc'), limit(200))));
    expect(list.size).toBe(2);
    await assertSucceeds(getDocs(query(col, where('createdAt', '>=', minutesAgo(60)), orderBy('createdAt', 'desc'))));
    await assertSucceeds(getDocs(query(col, where('studentId', '==', S2), orderBy('createdAt', 'desc'), limit(10))));
    const n = await assertSucceeds(getCountFromServer(query(col, where('createdAt', '<', minutesAgo(60 * 24 * 70)))));
    expect(n.data().count).toBe(1);
    await assertSucceeds(getDoc(doc(db, `classes/${CODE}/handins/${theirs}`)));
  });
  it("R7.4 another teacher sees nothing of the class's hand-ins", async () => {
    const db = teacher('tB');
    await assertFails(getDocs(collection(db, `classes/${CODE}/handins`)));
    await assertFails(getDoc(doc(db, `classes/${CODE}/handins/${mine}`)));
    await assertFails(deleteDoc(doc(db, `classes/${CODE}/handins/${mine}`)));
    await assertFails(updateDoc(doc(db, `classes/${CODE}/handins/${mine}`), { studentId: S2, username: 'sara.m' }));
  });
  it('R7.5 collection-group queries are closed, even to the owner', async () => {
    await assertFails(getDocs(query(collectionGroup(teacher('tA'), 'handins'), where('ownerUid', '==', 'tA'))));
    await assertFails(getDocs(query(collectionGroup(student('stu1'), 'handins'), where('uid', '==', 'stu1'))));
  });
  it('R7.6 the owner re-files a hand-in to another roster student / task; nothing else may change', async () => {
    const at = doc(teacher('tA'), `classes/${CODE}/handins/${mine}`);
    await assertSucceeds(updateDoc(at, { studentId: S2, username: 'sara.m' }));
    await assertFails(updateDoc(at, { studentId: S1, username: 'sara.m' }));
    await assertFails(updateDoc(at, { studentId: 'zzzzzzz9', username: 'ghost' }));
    await assertFails(updateDoc(at, { title: 'changed' }));
    await assertFails(updateDoc(at, { uid: 'stu2' }));
    await assertFails(updateDoc(at, { createdAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(at, { taskId: '' }));
    await assertFails(updateDoc(at, { taskId: 'zzzzzz' }));
  });
  it('R7.7 the owner deletes a hand-in; deleting it again (retry, second tab) still succeeds', async () => {
    const db = teacher('tA');
    await assertSucceeds(deleteDoc(doc(db, `classes/${CODE}/handins/${mine}`)));
    await assertSucceeds(deleteDoc(doc(db, `classes/${CODE}/handins/${mine}`)));
  });
  it('R7.8 retention prune: the owner queries hand-ins older than N weeks and deletes them in a batch', async () => {
    const db = teacher('tA');
    const old = await assertSucceeds(
      getDocs(query(collection(db, `classes/${CODE}/handins`), where('createdAt', '<', minutesAgo(60 * 24 * 70)), orderBy('createdAt'), limit(200))),
    );
    expect(old.size).toBe(1);
    const b = writeBatch(db);
    old.forEach((d) => b.delete(d.ref));
    await assertSucceeds(b.commit());
  });
});

describe('R8 deleting a whole class and everything else', () => {
  it('R8.1 the owner marks the class deleting, deletes members and hand-ins in batches, then the class', async () => {
    await seedClass();
    for (let i = 0; i < 60; i++) await seed(`classes/${CODE}/handins/${newId()}`, storedHandin('stu1', S1, 'ali.k'));
    await seedMember('stu1');
    const db = teacher('tA');
    await assertSucceeds(updateDoc(doc(db, `classes/${CODE}`), { deleting: true, joinOpen: false, updatedAt: serverTimestamp() }));
    await assertFails(handIn(student('stu1')).commit());
    const members = await getDocs(collection(db, `classes/${CODE}/members`));
    const handins = await getDocs(query(collection(db, `classes/${CODE}/handins`), limit(400)));
    const batch = writeBatch(db);
    members.forEach((m) => batch.delete(m.ref));
    handins.forEach((h) => batch.delete(h.ref));
    await assertSucceeds(batch.commit()); // 61 deletes, no document reads in the rules
    await assertSucceeds(deleteDoc(doc(db, `classes/${CODE}`)));
  });
  it('R8.2 unknown collections, sub-collections and the old handinCode collection are denied', async () => {
    await seedClass();
    await assertFails(setDoc(doc(teacher('tA'), `classes/${CODE}/notes/x`), { a: 1 }));
    await assertFails(setDoc(doc(teacher('tA'), 'teachers/tA'), { a: 1 }));
    await assertFails(getDoc(doc(teacher('tA'), 'teachers/tA')));
    await assertFails(setDoc(doc(student('stu1'), `classes/${CODE}/private/pins`), { a: 1 }));
    await assertFails(setDoc(doc(student('stu1'), `classes/${CODE}/handinCode/${newId()}`), { a: 1 }));
  });
});
