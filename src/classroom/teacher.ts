/**
 * TeacherApi (docs/CLASSROOM.md §4.8): what the dashboard calls. The full Firestore SDK (live
 * listeners, transactions, aggregation) through the lazily loaded teacher SDK (firebase.ts); this
 * module imports no Firebase code itself. Every method rejects with a ClassroomError and every
 * network call goes through withTimeout; deletes are idempotent and budgeted (§2.11).
 */
import type { User } from 'firebase/auth';
import type { DocumentReference, QueryConstraint } from 'firebase/firestore';
import { ClassroomError, TEACHER_ERROR_TEXT, errorText, toClassroomError, withTimeout, type ClassroomErrorCode } from './errors';
import { loadTeacherFirebase, type TeacherFirebase } from './firebase';
import { CLASSROOM_DEFAULTS } from '../firebase-config';
import { CLASS_SCHEMA, LIMITS, cleanLine, generateClassCode, readClassDoc, readHandinDoc, readMemberDoc, type ClassDoc, type HandinRecord, type RandomBytes } from './model';

export type Unsubscribe = () => void;
export interface TeacherUser {
  uid: string;
  name: string;
  email: string;
  photoURL: string | null;
}
export interface ClassSummary {
  code: string;
  name: string;
  handinsOpen: boolean;
  deleting: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
export interface ClassDetail extends ClassSummary {
  ownerUid: string;
  keepWeeks: number;
}
export interface Member {
  uid: string;
  firstName: string;
  lastName: string;
  nameKey: string;
  device: string;
  joinedAt: Date | null;
  handinCount: number;
  lastHandinAt: Date | null;
}
export interface HandinsUpdate {
  items: HandinRecord[];
  added: string[];
  modified: string[];
  removed: string[];
}
export interface NewClassInput {
  name: string;
  keepWeeks?: number;
}
export type ClassPatch = Partial<Pick<ClassDetail, 'name' | 'handinsOpen' | 'keepWeeks'>>;

export interface TeacherApi {
  /** Resolves when the SDK is loaded and the tab's session restored. The Sign-in button stays disabled until then. */
  readonly ready: Promise<void>;
  /** A non-Google user is signed out and reported as null. */
  onUser(callback: (user: TeacherUser | null) => void): Unsubscribe;
  /**
   * MUST be called synchronously in the click handler, after `ready`: its first statement is
   * signInWithPopup (no await before it). Rejects not_ready if called earlier.
   */
  signIn(): Promise<TeacherUser>;
  signOut(): Promise<void>;

  watchClasses(onChange: (classes: ClassSummary[]) => void, onError: (e: ClassroomError) => void): Unsubscribe;
  /** Transaction with up to 5 code attempts. */
  createClass(input: NewClassInput): Promise<ClassDetail>;
  watchClass(code: string, onChange: (cls: ClassDetail | null) => void, onError: (e: ClassroomError) => void): Unsubscribe;
  updateClass(code: string, patch: ClassPatch): Promise<void>;

  /** The newest 150, live. */
  watchMembers(code: string, onChange: (members: Member[]) => void, onError: (e: ClassroomError) => void): Unsubscribe;
  removeDevice(code: string, uid: string): Promise<void>;
  /** Removes members whose last hand-in (or join) is older; resolves with the count. */
  removeUnusedDevices(code: string, olderThanDays: number): Promise<number>;

  /** Since local midnight (re-subscribes at the date change), newest first, limit 300, live. */
  watchTodayHandins(code: string, onChange: (u: HandinsUpdate) => void, onError: (e: ClassroomError) => void): Unsubscribe;
  /** One-off, 100 per page. */
  loadHandins(code: string, since: Date, page?: { before?: Date }): Promise<{ items: HandinRecord[]; hasMore: boolean }>;
  /** One student's hand-ins (by nameKey), 10 per page; composite index; rejects index_missing. */
  studentHandins(code: string, nameKey: string, page?: { before?: Date }): Promise<{ items: HandinRecord[]; hasMore: boolean }>;
  deleteHandin(code: string, id: string): Promise<void>;

  /** count() aggregation. */
  countHandinsBefore(code: string, before: Date): Promise<number>;
  /** §2.11; resolves with the number deleted. */
  pruneHandins(code: string, before: Date, maxDeletes?: number): Promise<number>;
  /** §2.11. 'more' when the budget ran out (the class stays deleting: true). */
  deleteClass(code: string, onProgress?: (done: number, total: number | null) => void, budget?: number): Promise<'done' | 'more'>;
  deleteAllClasses(onProgress?: (text: string) => void): Promise<'done' | 'more'>;
  /**
   * Step 2 of T12. MUST be called synchronously in a click handler.
   * Rejects classes_left if any class remains (from the live class list); otherwise reauthenticateWithPopup, then deleteUser.
   */
  deleteAccount(): Promise<void>;
}

export interface TeacherApiDeps {
  /** Default loadTeacherFirebase. */
  load?: () => Promise<TeacherFirebase>;
  randomBytes?: RandomBytes;
  now?: () => number;
  /** Tests only: replaces reauthenticateWithPopup in deleteAccount (no popup in Node). */
  reauthenticate?: (f: TeacherFirebase, user: User) => Promise<unknown>;
}

const COLLISION = Symbol('code collision');
let indexWarned = false;

function warnIndexOnce(err: ClassroomError): void {
  if (indexWarned) return;
  indexWarned = true;
  const cause = err.cause instanceof Error ? err.cause.message : String(err.cause ?? '');
  console.error('[classes] A Firestore composite index is missing. Deploy firestore.indexes.json (docs/CLASSROOM.md §6.1 step 7).', cause);
}

function isGoogleUser(user: User): boolean {
  return !user.isAnonymous && user.providerData.some((p) => p.providerId === 'google.com');
}

function toTeacherUser(user: User): TeacherUser {
  return { uid: user.uid, name: user.displayName ?? '', email: user.email ?? '', photoURL: user.photoURL ?? null };
}

function toSummary(code: string, cls: ClassDoc): ClassSummary {
  return { code, name: cls.name, handinsOpen: cls.handinsOpen, deleting: cls.deleting, createdAt: cls.createdAt, updatedAt: cls.updatedAt };
}

function toDetail(code: string, cls: ClassDoc): ClassDetail {
  return { ...toSummary(code, cls), ownerUid: cls.ownerUid, keepWeeks: cls.keepWeeks };
}

/** Newest first; classes without a server time yet (pending writes) come first. */
function newestFirst(a: ClassSummary, b: ClassSummary): number {
  return (b.createdAt?.getTime() ?? Infinity) - (a.createdAt?.getTime() ?? Infinity) || (a.code < b.code ? -1 : 1);
}

function startOfDay(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

function validKeepWeeks(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value)) return CLASSROOM_DEFAULTS.keepWeeks;
  return Math.min(LIMITS.keepWeeksMax, Math.max(LIMITS.keepWeeksMin, value));
}

/** Starts loading the SDK at once (docs/CLASSROOM.md §4.13: at page load, not on click). */
export function createTeacherApi(deps: TeacherApiDeps = {}): TeacherApi {
  const load = deps.load ?? loadTeacherFirebase;
  const now = deps.now ?? (() => Date.now());
  const { randomBytes } = deps;

  let fb: TeacherFirebase | null = null;
  /** The live class list, for deleteAccount's synchronous classes_left check. */
  let knownClasses: ClassSummary[] | null = null;

  const ready: Promise<void> = (async () => {
    try {
      fb = await load();
    } catch (err) {
      throw toClassroomError(err, 'teacher');
    }
    await fb.auth.authStateReady();
  })();
  ready.catch(() => undefined); // reported through `ready` itself and onError; never unhandled here

  const fail = (code: ClassroomErrorCode, vars?: Record<string, string>) =>
    new ClassroomError(code, errorText(TEACHER_ERROR_TEXT, code, vars));

  async function loaded(): Promise<TeacherFirebase> {
    await ready;
    return fb!;
  }

  function signedInUid(f: TeacherFirebase): string {
    const user = f.auth.currentUser;
    if (!user) throw fail('permission');
    return user.uid;
  }

  /** A network call with the request timeout, errors mapped to ClassroomError. */
  function net<T>(promise: Promise<T>): Promise<T> {
    return withTimeout(promise).catch((err) => {
      throw toClassroomError(err, 'teacher');
    });
  }

  const classRef = (f: TeacherFirebase, code: string) => f.sdk.doc(f.db, 'classes', code);
  const membersCol = (f: TeacherFirebase, code: string) => f.sdk.collection(f.db, 'classes', code, 'members');
  const handinsCol = (f: TeacherFirebase, code: string) => f.sdk.collection(f.db, 'classes', code, 'handins');
  const stamp = (f: TeacherFirebase) => f.sdk.serverTimestamp();

  /** Subscribe once the SDK is ready; the returned function works before and after that. */
  function watch(onError: (e: ClassroomError) => void, subscribe: (f: TeacherFirebase) => Unsubscribe): Unsubscribe {
    let stopped = false;
    let unsub: Unsubscribe | null = null;
    ready.then(
      () => {
        if (stopped) return;
        try {
          unsub = subscribe(fb!);
        } catch (err) {
          onError(toClassroomError(err, 'teacher'));
        }
      },
      (err) => {
        if (!stopped) onError(toClassroomError(err, 'teacher'));
      },
    );
    return () => {
      stopped = true;
      unsub?.();
      unsub = null;
    };
  }

  async function updateClassDoc(code: string, fields: Record<string, unknown>): Promise<void> {
    const f = await loaded();
    await net(f.sdk.updateDoc(classRef(f, code), { ...fields, updatedAt: stamp(f) }));
  }

  /** Delete `refs` in batches of at most LIMITS.batchMaxOps (a missing doc is fine: the rules allow it). */
  async function deleteRefs(f: TeacherFirebase, refs: DocumentReference[]): Promise<void> {
    for (let i = 0; i < refs.length; i += LIMITS.batchMaxOps) {
      const batch = f.sdk.writeBatch(f.db);
      for (const ref of refs.slice(i, i + LIMITS.batchMaxOps)) batch.delete(ref);
      await net(batch.commit());
    }
  }

  async function pageOfHandins(
    f: TeacherFirebase,
    code: string,
    constraints: QueryConstraint[],
    pageSize: number,
    before: Date | undefined,
  ): Promise<{ items: HandinRecord[]; hasMore: boolean }> {
    const { query, orderBy, startAfter, limit, getDocs, Timestamp } = f.sdk;
    const all = [...constraints, orderBy('createdAt', 'desc')];
    if (before) all.push(startAfter(Timestamp.fromDate(before)));
    all.push(limit(pageSize + 1));
    const snap = await net(getDocs(query(handinsCol(f, code), ...all)));
    const items = snap.docs.slice(0, pageSize).map((d) => readHandinDoc(d.id, code, d.data()));
    return { items, hasMore: snap.docs.length > pageSize };
  }

  async function deleteClassRun(
    code: string,
    onProgress: ((done: number, total: number | null) => void) | undefined,
    budget: number,
  ): Promise<{ status: 'done' | 'more'; deleted: number }> {
    const f = await loaded();
    const { query, limit, getDocs, getCountFromServer, deleteDoc } = f.sdk;
    await updateClassDoc(code, { deleting: true, handinsOpen: false });
    let total: number | null = null;
    try {
      const [members, handins] = await Promise.all([
        net(getCountFromServer(membersCol(f, code))),
        net(getCountFromServer(handinsCol(f, code))),
      ]);
      total = members.data().count + handins.data().count;
    } catch {
      total = null;
    }
    let deleted = 0;
    onProgress?.(deleted, total);
    for (const col of [membersCol(f, code), handinsCol(f, code)]) {
      for (;;) {
        if (deleted >= budget) return { status: 'more', deleted };
        const snap = await net(getDocs(query(col, limit(Math.min(LIMITS.batchMaxOps, budget - deleted)))));
        if (snap.empty) break;
        await deleteRefs(f, snap.docs.map((d) => d.ref));
        deleted += snap.size;
        onProgress?.(deleted, total);
      }
    }
    await net(deleteDoc(classRef(f, code)));
    deleted += 1;
    onProgress?.(deleted, total === null ? null : total + 1);
    return { status: 'done', deleted };
  }

  return {
    ready,

    onUser(callback) {
      let stopped = false;
      let unsub: Unsubscribe | null = null;
      ready.then(
        () => {
          if (stopped) return;
          unsub = fb!.sdk.onAuthStateChanged(fb!.auth, (user) => {
            if (user && !isGoogleUser(user)) {
              void fb!.sdk.signOut(fb!.auth).catch(() => undefined);
              callback(null);
              return;
            }
            callback(user ? toTeacherUser(user) : null);
          });
        },
        () => {
          if (!stopped) callback(null);
        },
      );
      return () => {
        stopped = true;
        unsub?.();
        unsub = null;
      };
    },

    signIn() {
      if (!fb) return Promise.reject(fail('not_ready'));
      const f = fb;
      const provider = new f.sdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      return f.sdk.signInWithPopup(f.auth, provider).then(
        (credential) => {
          if (!isGoogleUser(credential.user)) {
            void f.sdk.signOut(f.auth).catch(() => undefined);
            throw fail('permission');
          }
          return toTeacherUser(credential.user);
        },
        (err) => {
          throw toClassroomError(err, 'teacher');
        },
      );
    },

    async signOut() {
      const f = await loaded();
      knownClasses = null;
      await net(f.sdk.signOut(f.auth));
    },

    watchClasses(onChange, onError) {
      return watch(onError, (f) => {
        const uid = signedInUid(f);
        const { collection, query, where, onSnapshot } = f.sdk;
        // Rules are not filters: the query must say ownerUid == uid (docs/CLASSROOM.md §2.12).
        return onSnapshot(
          query(collection(f.db, 'classes'), where('ownerUid', '==', uid)),
          (snap) => {
            const list = snap.docs.map((d) => toSummary(d.id, readClassDoc(d.data()))).sort(newestFirst);
            knownClasses = list;
            onChange(list);
          },
          (err) => onError(toClassroomError(err, 'teacher')),
        );
      });
    },

    async createClass(input) {
      const f = await loaded();
      const uid = signedInUid(f);
      const name = cleanLine(input.name, LIMITS.classNameMax);
      if (name === '') throw new ClassroomError('unknown', 'The class needs a name.');
      const { runTransaction } = f.sdk;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateClassCode(randomBytes);
        const ref = classRef(f, code);
        const data = { schema: CLASS_SCHEMA, ownerUid: uid, name, handinsOpen: true, keepWeeks: validKeepWeeks(input.keepWeeks), deleting: false };
        try {
          await withTimeout(
            runTransaction(f.db, async (tx) => {
              const snap = await tx.get(ref);
              if (snap.exists()) throw COLLISION;
              tx.set(ref, { ...data, createdAt: stamp(f), updatedAt: stamp(f) });
            }),
          );
        } catch (err) {
          if (err === COLLISION) continue;
          throw toClassroomError(err, 'teacher');
        }
        const at = new Date(now());
        return toDetail(code, readClassDoc({ ...data, createdAt: at, updatedAt: at }));
      }
      throw fail('code_collision');
    },

    watchClass(code, onChange, onError) {
      return watch(onError, (f) =>
        f.sdk.onSnapshot(
          classRef(f, code),
          (snap) => onChange(snap.exists() ? toDetail(code, readClassDoc(snap.data())) : null),
          (err) => onError(toClassroomError(err, 'teacher')),
        ),
      );
    },

    async updateClass(code, patch) {
      const fields: Record<string, unknown> = {};
      if (patch.name !== undefined) {
        const name = cleanLine(patch.name, LIMITS.classNameMax);
        if (name === '') throw new ClassroomError('unknown', 'The class needs a name.');
        fields.name = name;
      }
      if (patch.handinsOpen !== undefined) fields.handinsOpen = patch.handinsOpen;
      if (patch.keepWeeks !== undefined) fields.keepWeeks = validKeepWeeks(patch.keepWeeks);
      if (Object.keys(fields).length === 0) return;
      await updateClassDoc(code, fields);
    },

    watchMembers(code, onChange, onError) {
      return watch(onError, (f) => {
        const { query, orderBy, limit, onSnapshot } = f.sdk;
        return onSnapshot(
          query(membersCol(f, code), orderBy('joinedAt', 'desc'), limit(LIMITS.membersWatchLimit)),
          (snap) => onChange(snap.docs.map((d) => ({ uid: d.id, ...readMemberDoc(d.data()) }))),
          (err) => onError(toClassroomError(err, 'teacher')),
        );
      });
    },

    async removeDevice(code, uid) {
      const f = await loaded();
      await net(f.sdk.deleteDoc(f.sdk.doc(f.db, 'classes', code, 'members', uid)));
    },

    async removeUnusedDevices(code, olderThanDays) {
      const f = await loaded();
      const cutoff = now() - olderThanDays * 86_400_000;
      const snap = await net(f.sdk.getDocs(membersCol(f, code)));
      const stale = snap.docs.filter((d) => {
        const m = readMemberDoc(d.data());
        const lastUsed = m.lastHandinAt ?? m.joinedAt;
        return lastUsed !== null && lastUsed.getTime() < cutoff;
      });
      await deleteRefs(f, stale.map((d) => d.ref));
      return stale.length;
    },

    watchTodayHandins(code, onChange, onError) {
      return watch(onError, (f) => {
        const { query, where, orderBy, limit, onSnapshot, Timestamp } = f.sdk;
        let inner: Unsubscribe | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const subscribe = () => {
          const start = startOfDay(now());
          inner = onSnapshot(
            query(handinsCol(f, code), where('createdAt', '>=', Timestamp.fromDate(start)), orderBy('createdAt', 'desc'), limit(LIMITS.todayLimit)),
            (snap) => {
              const changes = snap.docChanges();
              onChange({
                items: snap.docs.map((d) => readHandinDoc(d.id, code, d.data())),
                added: changes.filter((c) => c.type === 'added').map((c) => c.doc.id),
                modified: changes.filter((c) => c.type === 'modified').map((c) => c.doc.id),
                removed: changes.filter((c) => c.type === 'removed').map((c) => c.doc.id),
              });
            },
            (err) => onError(toClassroomError(err, 'teacher')),
          );
          // At the date change the window moves: subscribe again from the new midnight.
          const nextMidnight = new Date(start);
          nextMidnight.setDate(nextMidnight.getDate() + 1);
          timer = setTimeout(
            () => {
              inner?.();
              subscribe();
            },
            Math.max(1_000, nextMidnight.getTime() - now() + 1_000),
          );
        };
        subscribe();
        return () => {
          inner?.();
          if (timer) clearTimeout(timer);
        };
      });
    },

    async loadHandins(code, since, page = {}) {
      const f = await loaded();
      const { where, Timestamp } = f.sdk;
      return pageOfHandins(f, code, [where('createdAt', '>=', Timestamp.fromDate(since))], LIMITS.periodPage, page.before);
    },

    async studentHandins(code, nameKey, page = {}) {
      const f = await loaded();
      try {
        return await pageOfHandins(f, code, [f.sdk.where('nameKey', '==', nameKey)], LIMITS.studentPage, page.before);
      } catch (err) {
        if (err instanceof ClassroomError && err.code === 'index_missing') warnIndexOnce(err);
        throw err;
      }
    },

    async deleteHandin(code, id) {
      const f = await loaded();
      await net(f.sdk.deleteDoc(f.sdk.doc(f.db, 'classes', code, 'handins', id)));
    },

    async countHandinsBefore(code, before) {
      const f = await loaded();
      const { query, where, getCountFromServer, Timestamp } = f.sdk;
      const snap = await net(getCountFromServer(query(handinsCol(f, code), where('createdAt', '<', Timestamp.fromDate(before)))));
      return snap.data().count;
    },

    async pruneHandins(code, before, maxDeletes = LIMITS.prunePerOpen) {
      const f = await loaded();
      const { query, where, orderBy, limit, getDocs, Timestamp } = f.sdk;
      let deleted = 0;
      while (deleted < maxDeletes) {
        const pageSize = Math.min(200, maxDeletes - deleted);
        const snap = await net(getDocs(query(handinsCol(f, code), where('createdAt', '<', Timestamp.fromDate(before)), orderBy('createdAt'), limit(pageSize))));
        if (snap.empty) break;
        await deleteRefs(f, snap.docs.map((d) => d.ref));
        deleted += snap.size;
        if (snap.size < pageSize) break;
      }
      return deleted;
    },

    async deleteClass(code, onProgress, budget = LIMITS.deletesPerRun) {
      return (await deleteClassRun(code, onProgress, budget)).status;
    },

    async deleteAllClasses(onProgress) {
      const f = await loaded();
      const uid = signedInUid(f);
      const { collection, query, where, getDocs } = f.sdk;
      const snap = await net(getDocs(query(collection(f.db, 'classes'), where('ownerUid', '==', uid))));
      let budget = LIMITS.deletesPerRun;
      for (const d of snap.docs) {
        const name = String(d.data().name ?? d.id);
        const result = await deleteClassRun(
          d.id,
          (done, total) => onProgress?.(`Deleting ${name}… ${done} of ${total === null ? '?' : `about ${total}`}`),
          budget,
        );
        budget -= result.deleted;
        if (result.status === 'more' || budget <= 0) return 'more';
      }
      return 'done';
    },

    deleteAccount() {
      if (!fb) return Promise.reject(fail('not_ready'));
      const f = fb;
      const user = f.auth.currentUser;
      if (!user) return Promise.reject(fail('permission'));
      if (knownClasses === null) return Promise.reject(fail('not_ready'));
      if (knownClasses.length > 0) return Promise.reject(fail('classes_left'));
      const reauthenticate = deps.reauthenticate ?? ((ff: TeacherFirebase, u: User) => ff.sdk.reauthenticateWithPopup(u, new ff.sdk.GoogleAuthProvider()));
      return reauthenticate(f, user)
        .then(() => f.sdk.deleteUser(user))
        .catch((err) => {
          throw toClassroomError(err, 'teacher');
        });
    },
  };
}
