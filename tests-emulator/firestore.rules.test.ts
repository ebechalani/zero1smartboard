/**
 * firestore.rules (docs/CLASSROOM.md §3.1) against the Firestore emulator: the happy path of every
 * client operation and the attacks from the security review (§7.1, cases R1-R8), for the
 * simplified platform (code → first name + last name → Hand in), and Python hand-ins
 * (docs/PYTHON.md §8.2: R6.17, R6.18).
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
const ALI = { firstName: 'Ali', lastName: 'Khoury', nameKey: 'ali khoury' };
const SARA = { firstName: 'Sara', lastName: 'Mansour', nameKey: 'sara mansour' };

const teacher = (uid: string, extra: Record<string, unknown> = {}) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' }, email: `${uid}@school.edu`, email_verified: true, ...extra }).firestore() as unknown as Firestore;
const student = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore() as unknown as Firestore;
const nobody = () => env.unauthenticatedContext().firestore() as unknown as Firestore;

function newClass(ownerUid = 'tA', over: Record<string, unknown> = {}) {
  return {
    schema: 2,
    ownerUid,
    name: '8B Robotics',
    handinsOpen: true,
    keepWeeks: 10,
    deleting: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...over,
  };
}

function member(name = ALI, over: Record<string, unknown> = {}) {
  return {
    ...name,
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
    ...ALI,
    ownerUid: 'tA',
    kind: 'code',
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
async function seedMember(uid = 'stu1', name = ALI, over: Record<string, unknown> = {}, code = CODE) {
  await seed(`classes/${code}/members/${uid}`, { ...member(name), joinedAt: Timestamp.now(), ...over });
}
function storedHandin(uid: string, name = ALI, over: Record<string, unknown> = {}) {
  return { uid, ...name, ownerUid: 'tA', kind: 'code', createdAt: Timestamp.now(), enc: 'plain', code: 'x', workspace: '', ...over };
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
  it('R1.1 a Google teacher creates a class', async () => {
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
  it('R1.5 refuses extra/missing fields, client times, deleting, the old schema and the old roster fields', async () => {
    const db = teacher('tA');
    const at = `classes/${CODE}`;
    await assertFails(setDoc(doc(db, at), newClass('tA', { admin: true })));
    const missing: Record<string, unknown> = newClass('tA');
    delete missing.keepWeeks;
    await assertFails(setDoc(doc(db, at), missing));
    await assertFails(setDoc(doc(db, at), newClass('tA', { createdAt: Timestamp.fromMillis(0) })));
    await assertFails(setDoc(doc(db, at), newClass('tA', { deleting: true })));
    await assertFails(setDoc(doc(db, at), newClass('tA', { schema: 1 })));
    await assertFails(setDoc(doc(db, at), newClass('tA', { roster: {}, joinOpen: true, joinWindowAt: null, rejoin: {}, tasks: {}, currentTaskId: '', teacherName: 'Mr. B' })));
  });
  it('R1.6 checks the name length, the switch and the retention', async () => {
    const db = teacher('tA');
    await assertFails(setDoc(doc(db, `classes/${CODE}`), newClass('tA', { name: '' })));
    await assertFails(setDoc(doc(db, `classes/${CODE}`), newClass('tA', { name: 'x'.repeat(61) })));
    await assertSucceeds(setDoc(doc(db, `classes/${CODE}`), newClass('tA', { name: 'x'.repeat(60) })));
    await assertFails(setDoc(doc(db, `classes/${CODE2}`), newClass('tA', { handinsOpen: 'yes' })));
    await assertFails(setDoc(doc(db, `classes/${CODE2}`), newClass('tA', { keepWeeks: 0 })));
    await assertFails(setDoc(doc(db, `classes/${CODE2}`), newClass('tA', { keepWeeks: 53 })));
    await assertFails(setDoc(doc(db, `classes/${CODE2}`), newClass('tA', { keepWeeks: 10.5 })));
    await assertFails(setDoc(doc(db, `classes/${CODE2}`), newClass('tA', { keepWeeks: '10' })));
    await assertSucceeds(setDoc(doc(db, `classes/${CODE2}`), newClass('tA', { keepWeeks: 52, handinsOpen: false })));
  });
  it('R1.7 a teacher cannot overwrite an existing class (code collision) by creating it again', async () => {
    await seedClass();
    await assertFails(setDoc(doc(teacher('tB'), `classes/${CODE}`), newClass('tB')));
    await assertFails(setDoc(doc(teacher('tA'), `classes/${CODE}`), newClass('tA')));
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
  it('R3.2 the class GET shows the name and ownerUid to code-holders, never an email (documented exposure)', async () => {
    const data = (await getDoc(doc(student('anon1'), `classes/${CODE}`))).data()!;
    expect(data.ownerUid).toBe('tA');
    expect(data.name).toBe('8B Robotics');
    expect(JSON.stringify(data)).not.toContain('@');
  });
  it('R3.3 a teacher lists only their own classes, with the ownerUid filter', async () => {
    await seedClass({}, CODE2, 'tB');
    const own = await assertSucceeds(getDocs(query(collection(teacher('tA'), 'classes'), where('ownerUid', '==', 'tA'))));
    expect(own.size).toBe(1);
    await assertFails(getDocs(collection(teacher('tA'), 'classes')));
    await assertFails(getDocs(query(collection(teacher('tB'), 'classes'), where('ownerUid', '==', 'tA'))));
    await assertFails(getDocs(query(collection(student('tA'), 'classes'), where('ownerUid', '==', 'tA'))));
    await assertFails(getDocs(query(collection(student('stu1'), 'classes'), where('handinsOpen', '==', true))));
  });
  it('R3.4 the owner edits the name, the hand-ins switch and the retention', async () => {
    await assertSucceeds(updateDoc(doc(teacher('tA'), `classes/${CODE}`), { name: '8B', handinsOpen: false, keepWeeks: 20, updatedAt: serverTimestamp() }));
  });
  it('R3.5 the owner cannot change ownerUid, createdAt, schema, add fields (old roster fields included) or skip updatedAt', async () => {
    const db = teacher('tA');
    const at = doc(db, `classes/${CODE}`);
    await assertFails(updateDoc(at, { ownerUid: 'tB', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { schema: 3, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { extra: 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { roster: { aaaaaaa1: 'ali.k' }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at, { handinsOpen: false }));
    await assertFails(updateDoc(at, { name: '', updatedAt: serverTimestamp() }));
  });
  it('R3.10 other teachers and students cannot update or delete the class; the owner can', async () => {
    await assertFails(updateDoc(doc(teacher('tB'), `classes/${CODE}`), { handinsOpen: false, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(student('stu1'), `classes/${CODE}`), { handinsOpen: true, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(student('stu1'), `classes/${CODE}`), { name: 'hacked', updatedAt: serverTimestamp() }));
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

describe('R4 members: enter a name', () => {
  beforeEach(() => seedClass());
  const joinAs = (uid = 'stu1', name = ALI, over: Record<string, unknown> = {}) => setDoc(doc(student(uid), `classes/${CODE}/members/${uid}`), member(name, over));
  it('R4.1 anyone signed in who knows the code creates their member doc with a name', async () => {
    await assertSucceeds(joinAs());
    await assertSucceeds(joinAs('stu2', SARA));
    await assertSucceeds(joinAs('stu3', ALI)); // the same name from another computer is allowed (documented)
  });
  it('R4.2 names: letters of any alphabet with spaces, apostrophes, dots and hyphens; 1-30 characters', async () => {
    await assertSucceeds(joinAs('a1', { firstName: 'Élise', lastName: "O'Neil-Dupont", nameKey: "élise o'neil-dupont" }));
    await assertSucceeds(joinAs('a2', { firstName: 'محمد', lastName: 'حسن', nameKey: 'محمد حسن' }));
    await assertSucceeds(joinAs('a3', { firstName: 'Jean Luc', lastName: 'Jr.', nameKey: 'jean luc jr.' }));
    await assertSucceeds(joinAs('a4', { firstName: 'x'.repeat(30), lastName: 'y'.repeat(30), nameKey: `${'x'.repeat(30)} ${'y'.repeat(30)}` }));
    await assertFails(joinAs('b1', { firstName: '', lastName: 'Khoury', nameKey: ' khoury' }));
    await assertFails(joinAs('b2', { firstName: 'Ali', lastName: '', nameKey: 'ali ' }));
    await assertFails(joinAs('b3', { firstName: 'x'.repeat(31), lastName: 'Khoury', nameKey: `${'x'.repeat(31)} khoury` }));
    await assertFails(joinAs('b4', { firstName: 'Ali2', lastName: 'Khoury', nameKey: 'ali2 khoury' }));
    await assertFails(joinAs('b5', { firstName: '-Ali', lastName: 'Khoury', nameKey: '-ali khoury' }));
    await assertFails(joinAs('b6', { firstName: '<b>Ali</b>', lastName: 'Khoury', nameKey: '<b>ali</b> khoury' }));
    await assertFails(joinAs('b7', { firstName: 'Ali', lastName: 'Kh\nury', nameKey: 'ali kh\nury' }));
    await assertFails(joinAs('b8', { firstName: 7 as unknown as string, lastName: 'Khoury', nameKey: '7 khoury' }));
  });
  it('R4.3 nameKey: a non-empty lower-case string of at most 61 characters', async () => {
    await assertFails(joinAs('c1', { ...ALI, nameKey: 'Ali Khoury' }));
    await assertFails(joinAs('c2', { ...ALI, nameKey: '' }));
    await assertFails(joinAs('c3', { ...ALI, nameKey: 'x'.repeat(62) }));
    await assertFails(joinAs('c4', { ...ALI, nameKey: 12 as unknown as string }));
  });
  it('R4.4 cannot enter a class whose hand-ins are closed, that is deleting, or that is missing', async () => {
    await seedClass({ handinsOpen: false });
    await assertFails(joinAs());
    await seedClass({ deleting: true });
    await assertFails(joinAs());
    await assertFails(setDoc(doc(student('stu1'), 'classes/ZZZZZZ/members/stu1'), member()));
  });
  it('R4.5 own doc only; the ownerUid must be the class owner', async () => {
    await assertFails(setDoc(doc(student('stu1'), `classes/${CODE}/members/stu2`), member()));
    await assertFails(joinAs('stu1', ALI, { ownerUid: 'stu1' }));
    await assertFails(joinAs('stu1', ALI, { ownerUid: 'tB' }));
  });
  it('R4.6 refuses a forged counter, time, long device, missing or extra field', async () => {
    await assertFails(joinAs('stu1', ALI, { handinCount: 5 }));
    await assertFails(joinAs('stu1', ALI, { lastHandinAt: Timestamp.fromMillis(0) }));
    await assertFails(joinAs('stu1', ALI, { lastHandinId: newId() }));
    await assertFails(joinAs('stu1', ALI, { joinedAt: Timestamp.fromMillis(0) }));
    await assertFails(joinAs('stu1', ALI, { device: 'x'.repeat(41) }));
    await assertFails(joinAs('stu1', ALI, { pin: '1234' }));
    await assertFails(joinAs('stu1', ALI, { studentId: 'aaaaaaa1', username: 'ali.k' }));
    const missing: Record<string, unknown> = member();
    delete missing.device;
    await assertFails(setDoc(doc(student('stu1'), `classes/${CODE}/members/stu1`), missing));
  });
  it('R4.7 the device label is free text up to 40 chars (rendered with textContent only)', async () => {
    await assertSucceeds(joinAs('devC', ALI, { device: '</script><img src=x onerror=alert(1)>' }));
  });
  it('R4.8 "Change": the owner uid renames its member doc (the three name fields only, same validation); the counter stays', async () => {
    await seedMember('stu1', ALI, { handinCount: 3, lastHandinAt: minutesAgo(5), lastHandinId: newId() });
    const at = doc(student('stu1'), `classes/${CODE}/members/stu1`);
    await assertSucceeds(updateDoc(at, { ...SARA }));
    const after = (await getDoc(at)).data()!;
    expect(after).toMatchObject({ ...SARA, handinCount: 3 });
    await assertSucceeds(updateDoc(at, { firstName: 'Omar' })); // the rules cannot tie nameKey to the names (ASCII-only lower()): grouping only, no security value
    await assertFails(updateDoc(at, { ...ALI, nameKey: 'Ali Khoury' }));
    await assertFails(updateDoc(at, { firstName: 'Omar2', lastName: 'Haddad', nameKey: 'omar2 haddad' }));
    await assertFails(updateDoc(at, { ...SARA, device: 'other' }));
    await assertFails(updateDoc(at, { ...SARA, handinCount: 0 }));
    await assertFails(updateDoc(at, { ...SARA, ownerUid: 'stu1' }));
    await assertFails(updateDoc(doc(student('stu2'), `classes/${CODE}/members/stu1`), { ...SARA }));
    await assertFails(updateDoc(doc(teacher('tA'), `classes/${CODE}/members/stu1`), { ...SARA }));
  });
  it('R4.9 a member doc cannot be re-created over itself; the counter cannot move without a new hand-in', async () => {
    await seedMember('stu1');
    await assertFails(joinAs('stu1', SARA));
    await assertFails(
      updateDoc(doc(student('stu1'), `classes/${CODE}/members/stu1`), { handinCount: 1, lastHandinAt: serverTimestamp(), lastHandinId: newId() }),
    );
  });
  it('R4.10 the counter cannot be ticked against an OLD hand-in of this device', async () => {
    await seedMember('stu1', ALI, { handinCount: 1, lastHandinAt: minutesAgo(5) });
    const old = newId();
    await seed(`classes/${CODE}/handins/${old}`, storedHandin('stu1', ALI, { createdAt: minutesAgo(5) }));
    await assertFails(
      updateDoc(doc(student('stu1'), `classes/${CODE}/members/stu1`), { handinCount: increment(1), lastHandinAt: serverTimestamp(), lastHandinId: old }),
    );
  });
});

describe('R5 members: read and remove', () => {
  beforeEach(async () => {
    await seedClass();
    await seedMember('stu1');
    await seedMember('stu2', SARA);
  });
  it('R5.1 a student reads only their own member doc (also before entering a name)', async () => {
    await assertSucceeds(getDoc(doc(student('stu1'), `classes/${CODE}/members/stu1`)));
    await assertSucceeds(getDoc(doc(student('stu3'), `classes/${CODE}/members/stu3`)));
    await assertFails(getDoc(doc(student('stu1'), `classes/${CODE}/members/stu2`)));
    await assertFails(getDocs(collection(student('stu1'), `classes/${CODE}/members`)));
  });
  it('R5.2 the owner lists (bounded, newest first) and removes computers; other teachers cannot', async () => {
    const list = await assertSucceeds(getDocs(query(collection(teacher('tA'), `classes/${CODE}/members`), orderBy('joinedAt', 'desc'), limit(150))));
    expect(list.size).toBe(2);
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
  it('R6.1 a member hands in (hand-in + counter tick with increment(1), no read first)', async () => {
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
  it('R6.5 a hand-in requires a member doc with the SAME name; no member doc, another name, another class: refused', async () => {
    await assertFails(handIn(student('stu9'), { uid: 'stu9' }).commit()); // no member doc
    await assertFails(handIn(student('stu1'), { data: { ...SARA } }).commit()); // the member doc says Ali Khoury
    await assertFails(handIn(student('stu1'), { data: { firstName: 'Ali', lastName: 'Khouri', nameKey: 'ali khouri' } }).commit());
    await assertFails(handIn(student('stu1'), { data: { nameKey: 'someone else' } }).commit());
    await seedClass({}, CODE2, 'tB');
    await assertFails(handIn(student('stu1'), { code: CODE2, data: { ownerUid: 'tB' } }).commit()); // no member doc in the other class
    await assertFails(handIn(teacher('tB'), { uid: 'tB' }).commit());
  });
  it('R6.6 refuses a forged uid, ownerUid, createdAt, kind, extra or missing fields', async () => {
    const db = student('stu1');
    await assertFails(handIn(db, { data: { uid: 'stu2' } }).commit());
    await assertFails(handIn(db, { data: { ownerUid: 'stu1' } }).commit());
    await assertFails(handIn(db, { data: { createdAt: Timestamp.fromMillis(0) } }).commit());
    await assertFails(handIn(db, { data: { kind: 'pyth0n' } }).commit());
    await assertFails(handIn(db, { data: { kind: 'pyth0n', workspace: 'print(1)\n' } }).commit()); // any kind but 'code' needs a workspace, but only the three kinds exist
    await assertFails(handIn(db, { data: { grade: 20 } }).commit());
    await assertFails(handIn(db, { data: { title: 'Mine', note: '' } }).commit()); // the old optional fields are gone
    await assertFails(handIn(db, { data: { taskId: '' } }).commit());
  });
  it('R6.7 refuses an id that is not a 20-character auto id', async () => {
    await assertFails(handIn(student('stu1'), { hid: 'short' }).commit());
  });
  it('R6.8 sizes: code 50 000 B, workspace 100 000 B (UTF-8 or gzip bytes), no empty sketch', async () => {
    const db = student('stu1');
    await assertSucceeds(handIn(db, { data: { code: 'x'.repeat(50000) } }).commit());
    await seedMember('stu1');
    await assertFails(handIn(db, { data: { code: 'x'.repeat(50001) } }).commit());
    await assertFails(handIn(db, { data: { code: 'é'.repeat(25001) } }).commit());
    await assertFails(handIn(db, { data: { kind: 'blocks', workspace: 'x'.repeat(100001) } }).commit());
    await assertFails(handIn(db, { data: { enc: 'gzip', code: Bytes.fromUint8Array(new Uint8Array(50001)), workspace: EMPTY_BYTES } }).commit());
    await assertFails(handIn(db, { data: { code: '' } }).commit());
  });
  it('R6.9 a Code hand-in has no workspace; a Blocks hand-in must have one', async () => {
    const db = student('stu1');
    await assertFails(handIn(db, { data: { workspace: '{}' } }).commit());
    await assertFails(handIn(db, { data: { kind: 'blocks', workspace: '' } }).commit());
    await assertFails(handIn(db, { data: { enc: 'gzip', code: gz('void setup(){}'), workspace: gz('print(1)\n') } }).commit());
    await assertFails(handIn(db, { data: { kind: 'blocks', enc: 'gzip', code: gz('void setup(){}'), workspace: EMPTY_BYTES } }).commit());
  });
  it('R6.10 waits 10 s between hand-ins from one device', async () => {
    const db = student('stu1');
    await assertSucceeds(handIn(db).commit());
    await assertFails(handIn(db).commit());
    await seedMember('stu1', ALI, { handinCount: 1, lastHandinAt: Timestamp.fromMillis(Date.now() - 11000) });
    await assertSucceeds(handIn(db).commit());
  });
  it('R6.11 stops at 300 hand-ins per device', async () => {
    await seedMember('stu1', ALI, { handinCount: 300, lastHandinAt: Timestamp.fromMillis(0) });
    await assertFails(handIn(student('stu1')).commit());
    await seedMember('stu1', ALI, { handinCount: 299, lastHandinAt: Timestamp.fromMillis(0) });
    await assertSucceeds(handIn(student('stu1')).commit());
  });
  it('R6.12 after a "Change" of name, the old name is refused and the new one accepted (the counter carries on)', async () => {
    const db = student('stu1');
    await assertSucceeds(updateDoc(doc(db, `classes/${CODE}/members/stu1`), { ...SARA }));
    await assertFails(handIn(db).commit()); // still Ali Khoury
    await assertSucceeds(handIn(db, { data: { ...SARA } }).commit());
    expect((await getDoc(doc(db, `classes/${CODE}/members/stu1`))).data()?.handinCount).toBe(1);
  });
  it('R6.13 a rename and a hand-in in ONE batch are refused', async () => {
    const db = student('stu1');
    const hid = newId();
    const b = writeBatch(db);
    b.set(doc(db, `classes/${CODE}/handins/${hid}`), { ...storedHandin('stu1', SARA), createdAt: serverTimestamp() });
    b.update(doc(db, `classes/${CODE}/members/stu1`), { ...SARA, handinCount: increment(1), lastHandinAt: serverTimestamp(), lastHandinId: hid });
    await assertFails(b.commit());
  });
  it('R6.14 "Stop hand-ins" and deleting refuse hand-ins', async () => {
    await seedClass({ handinsOpen: false });
    await assertFails(handIn(student('stu1')).commit());
    await seedClass({ deleting: true });
    await assertFails(handIn(student('stu1')).commit());
  });
  it('R6.15 entering a name and handing in inside ONE batch is refused (a fresh member cannot carry the tick)', async () => {
    const db = student('stu5');
    const hid = newId();
    const b = writeBatch(db);
    b.set(doc(db, `classes/${CODE}/members/stu5`), member());
    b.set(doc(db, `classes/${CODE}/handins/${hid}`), { ...storedHandin('stu5'), createdAt: serverTimestamp() });
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
  it('R6.17 Python hand-ins keep the program in workspace, plain and gzip, up to 100 000 B; Code and Blocks pass as before', async () => {
    const db = student('stu1');
    const program = 'from machine import Pin\nled = Pin(13, Pin.OUT)\nwhile True:\n    led.toggle()  # Lumière\n';
    await assertSucceeds(handIn(db, { data: { kind: 'python', workspace: program } }).commit());
    await seedMember('stu1');
    await assertSucceeds(handIn(db, { data: { kind: 'python', enc: 'gzip', code: gz('void setup(){}'), workspace: gz(program) } }).commit());
    await seedMember('stu1');
    await assertSucceeds(handIn(db, { data: { kind: 'python', workspace: 'x'.repeat(100000) } }).commit()); // the rules' limit; the client stops at 50 000
    await seedMember('stu1');
    await assertSucceeds(handIn(db).commit());
    await seedMember('stu1');
    await assertSucceeds(handIn(db, { data: { kind: 'blocks', workspace: '{"blocks":{}}' } }).commit());
  });
  it('R6.18 a Python hand-in without its program (plain or gzip), over 100 000 B, without a sketch, with mixed types or an extra field is refused', async () => {
    const db = student('stu1');
    await assertFails(handIn(db, { data: { kind: 'python' } }).commit()); // workspace ''
    await assertFails(handIn(db, { data: { kind: 'python', enc: 'gzip', code: gz('void setup(){}'), workspace: EMPTY_BYTES } }).commit());
    await assertFails(handIn(db, { data: { kind: 'python', workspace: 'x'.repeat(100001) } }).commit());
    await assertFails(handIn(db, { data: { kind: 'python', workspace: 'é'.repeat(50001) } }).commit());
    await assertFails(handIn(db, { data: { kind: 'python', enc: 'gzip', code: gz('void setup(){}'), workspace: Bytes.fromUint8Array(new Uint8Array(100001)) } }).commit());
    await assertFails(handIn(db, { data: { kind: 'python', code: '', workspace: 'print(1)\n' } }).commit());
    await assertFails(handIn(db, { data: { kind: 'python', enc: 'gzip', code: gz('void setup(){}'), workspace: 'print(1)\n' } }).commit());
    await assertFails(handIn(db, { data: { kind: 'python', workspace: 12 } }).commit());
    await assertFails(handIn(db, { data: { kind: 'python', workspace: 'print(1)\n', python: 'print(1)\n' } }).commit()); // no separate python field
    await assertSucceeds(handIn(db, { data: { kind: 'python', workspace: 'print(1)\n' } }).commit()); // the same member, with its program
  });
});

describe('R7 hand-ins: read, delete, prune', () => {
  let mine: string;
  let theirs: string;
  beforeEach(async () => {
    await seedClass();
    await seedMember('stu1');
    await seedMember('stu2', SARA);
    mine = newId();
    theirs = newId();
    await seed(`classes/${CODE}/handins/${mine}`, storedHandin('stu1'));
    await seed(`classes/${CODE}/handins/${theirs}`, storedHandin('stu2', SARA, { createdAt: minutesAgo(60 * 24 * 90) }));
  });
  it("R7.1 a student reads their own hand-ins (query by uid), never another student's", async () => {
    const db = student('stu1');
    const own = await assertSucceeds(getDocs(query(collection(db, `classes/${CODE}/handins`), where('uid', '==', 'stu1'), orderBy('createdAt', 'desc'), limit(20))));
    expect(own.size).toBe(1);
    await assertSucceeds(getDoc(doc(db, `classes/${CODE}/handins/${mine}`)));
    await assertFails(getDocs(collection(db, `classes/${CODE}/handins`)));
    await assertFails(getDocs(query(collection(db, `classes/${CODE}/handins`), where('nameKey', '==', SARA.nameKey))));
    await assertFails(getDoc(doc(db, `classes/${CODE}/handins/${theirs}`)));
  });
  it('R7.2 nobody edits a hand-in: not the student, not the owner (immutable)', async () => {
    const db = student('stu1');
    await assertFails(updateDoc(doc(db, `classes/${CODE}/handins/${mine}`), { code: 'changed' }));
    await assertFails(updateDoc(doc(db, `classes/${CODE}/handins/${mine}`), { ...SARA }));
    await assertFails(deleteDoc(doc(db, `classes/${CODE}/handins/${mine}`)));
    await assertFails(updateDoc(doc(teacher('tA'), `classes/${CODE}/handins/${mine}`), { ...SARA }));
    await assertFails(updateDoc(doc(teacher('tA'), `classes/${CODE}/handins/${mine}`), { code: 'changed' }));
  });
  it('R7.3 the owner lists (newest first, window, per student by nameKey), counts and reads', async () => {
    const db = teacher('tA');
    const col = collection(db, `classes/${CODE}/handins`);
    const list = await assertSucceeds(getDocs(query(col, orderBy('createdAt', 'desc'), limit(200))));
    expect(list.size).toBe(2);
    await assertSucceeds(getDocs(query(col, where('createdAt', '>=', minutesAgo(60)), orderBy('createdAt', 'desc'))));
    const sara = await assertSucceeds(getDocs(query(col, where('nameKey', '==', SARA.nameKey), orderBy('createdAt', 'desc'), limit(10))));
    expect(sara.size).toBe(1);
    const n = await assertSucceeds(getCountFromServer(query(col, where('createdAt', '<', minutesAgo(60 * 24 * 70)))));
    expect(n.data().count).toBe(1);
    await assertSucceeds(getDoc(doc(db, `classes/${CODE}/handins/${theirs}`)));
  });
  it("R7.4 another teacher sees nothing of the class's hand-ins", async () => {
    const db = teacher('tB');
    await assertFails(getDocs(collection(db, `classes/${CODE}/handins`)));
    await assertFails(getDoc(doc(db, `classes/${CODE}/handins/${mine}`)));
    await assertFails(deleteDoc(doc(db, `classes/${CODE}/handins/${mine}`)));
  });
  it('R7.5 collection-group queries are closed, even to the owner', async () => {
    await assertFails(getDocs(query(collectionGroup(teacher('tA'), 'handins'), where('ownerUid', '==', 'tA'))));
    await assertFails(getDocs(query(collectionGroup(student('stu1'), 'handins'), where('uid', '==', 'stu1'))));
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
    for (let i = 0; i < 60; i++) await seed(`classes/${CODE}/handins/${newId()}`, storedHandin('stu1'));
    await seedMember('stu1');
    const db = teacher('tA');
    await assertSucceeds(updateDoc(doc(db, `classes/${CODE}`), { deleting: true, handinsOpen: false, updatedAt: serverTimestamp() }));
    await assertFails(handIn(student('stu1')).commit());
    const members = await getDocs(collection(db, `classes/${CODE}/members`));
    const handins = await getDocs(query(collection(db, `classes/${CODE}/handins`), limit(400)));
    const batch = writeBatch(db);
    members.forEach((m) => batch.delete(m.ref));
    handins.forEach((h) => batch.delete(h.ref));
    await assertSucceeds(batch.commit()); // 61 deletes, no document reads in the rules
    await assertSucceeds(deleteDoc(doc(db, `classes/${CODE}`)));
  });
  it('R8.2 unknown collections and sub-collections are denied', async () => {
    await seedClass();
    await assertFails(setDoc(doc(teacher('tA'), `classes/${CODE}/notes/x`), { a: 1 }));
    await assertFails(setDoc(doc(teacher('tA'), 'teachers/tA'), { a: 1 }));
    await assertFails(getDoc(doc(teacher('tA'), 'teachers/tA')));
    await assertFails(setDoc(doc(student('stu1'), `classes/${CODE}/private/pins`), { a: 1 }));
    await assertFails(setDoc(doc(student('stu1'), `classes/${CODE}/handinCode/${newId()}`), { a: 1 }));
  });
});
