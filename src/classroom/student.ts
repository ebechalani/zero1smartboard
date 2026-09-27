/**
 * StudentApi (docs/CLASSROOM.md §4.7): what the Hand in dialog calls. Firestore Lite through the
 * lazily loaded student SDK (firebase.ts); this module imports no Firebase code itself, so the
 * dialog can `import('../classroom/student')` without pulling the SDK until a request is needed.
 */
import type { QueryConstraint } from 'firebase/firestore/lite';
import { encodeContent, type EncodedContent } from './codec';
import { ClassroomError, STUDENT_ERROR_TEXT, errorText, toClassroomError, withTimeout, type ClassroomErrorCode } from './errors';
import { loadStudentFirebase, type StudentFirebase } from './firebase';
import {
  LIMITS,
  cleanLine,
  cleanMultiline,
  deviceLabel,
  draftProblem,
  formatClassCode,
  isHandinId,
  joinStatus,
  normalizeClassCode,
  readClassDoc,
  readHandinDoc,
  readMemberDoc,
  sortedRoster,
  sortedTasks,
  type ClassDoc,
  type HandinDraft,
  type HandinRecord,
  type JoinState,
  type MemberDoc,
  type Roster,
  type RosterEntry,
  type TaskEntry,
} from './model';
import {
  clearSession,
  isConfirmedInTab,
  loadSavedSession,
  markConfirmedInTab,
  saveLastCode,
  saveSession,
  type SavedSession,
} from './session-store';

export interface StudentSession {
  code: string;
  className: string;
  teacherName: string;
  studentId: string;
  username: string;
  uid: string;
}
export interface PublicClass extends JoinState {
  code: string;
  name: string;
  teacherName: string;
  ownerUid: string;
  handinsOpen: boolean;
  /** Sorted by username. */
  students: RosterEntry[];
  /** Sorted by title. */
  tasks: TaskEntry[];
  currentTaskId: string;
}
export interface FoundClass {
  info: PublicClass;
  /** This device already has a member doc in the class. */
  existing: { studentId: string; username: string } | null;
}
export interface RestoreResult {
  session: StudentSession;
  info: PublicClass;
  /** 'new_tab': not confirmed in this tab; 'stale': last used > LIMITS.confirmAfterMs ago; null: go straight to Ready. */
  confirm: 'new_tab' | 'stale' | null;
  lastHandin: { at: number; title: string } | null;
}

export interface StudentApi {
  /**
   * The saved session, checked: the same anonymous uid (else 'lost_identity': saved session cleared,
   * lastCode kept); the class exists, is not deleting, accepts hand-ins and still lists the student
   * (1 read); the names are refreshed and saved. The member doc is NOT read here.
   * Null when nothing is saved: no Firebase download then.
   * Rejects: lost_identity | class_deleted | handins_closed | not_on_roster | offline | timeout | quota | load_failed | app_updated.
   */
  restore(): Promise<RestoreResult | null>;
  /**
   * Normalise → sign in anonymously if needed → get the class + own member doc (2 reads).
   * Rejects: bad_code | class_not_found | handins_closed | offline | timeout | signup_limit | auth_disabled | storage_blocked | quota | load_failed | app_updated.
   */
  findClass(codeInput: string): Promise<FoundClass>;
  /** Re-read the class ("Refresh the list"). */
  refreshClass(code: string): Promise<PublicClass>;
  /**
   * Create the member doc, save the session, mark it confirmed in this tab. A rename by the teacher
   * meanwhile is retried once with the new name.
   * Rejects: class_closed | handins_closed | not_on_roster | class_not_found | offline | timeout | quota | permission.
   */
  join(cls: PublicClass, studentId: string): Promise<StudentSession>;
  /** Use FoundClass.existing; save the session; mark it confirmed. */
  continueAs(found: FoundClass): Promise<StudentSession>;
  /** "Yes, I'm ali.k": mark confirmed in this tab, set lastUsedAt. */
  confirm(session: StudentSession): void;
  /**
   * draftProblem → local cooldown → encodeContent → the 2-write batch with `handinId` (§2.9).
   * On timeout / offline / unknown / permission-denied: read own member doc; lastHandinId === handinId → success.
   * Otherwise diagnose (read class + member). If only the username changed: save it and retry once with the SAME id.
   * Resolves with the new record (createdAt = local time) and updates lastHandinAt / lastHandinTitle.
   * Rejects: empty_sketch | too_large | too_soon | limit_reached | not_on_roster | device_removed | class_deleted | handins_closed | offline | timeout | quota | permission | index_missing.
   */
  handIn(session: StudentSession, draft: HandinDraft, handinId: string): Promise<HandinRecord>;
  /**
   * Newest first, 20 per page; `before` = createdAt of the last row.
   * Rejects index_missing when the composite index is absent (no fallback).
   */
  myHandins(session: StudentSession, page?: { before?: Date }): Promise<{ items: HandinRecord[]; hasMore: boolean }>;
  /** Delete the anonymous user if possible (errors ignored), sign out, clear the session and the tab flag (lastCode kept unless forgetCode). */
  leave(options?: { forgetCode?: boolean }): Promise<void>;
}

export interface StudentApiDeps {
  /** Default loadStudentFirebase. */
  load?: () => Promise<StudentFirebase>;
  /** Default localStorage. */
  storage?: Storage;
  /** Default sessionStorage. */
  tabStorage?: Storage;
  now?: () => number;
  userAgent?: string;
  timeoutMs?: number;
}

const RETRY_CODES: readonly ClassroomErrorCode[] = ['timeout', 'offline', 'unknown', 'permission'];

/**
 * Pure: why a hand-in was refused, from fresh reads of the class and the member doc.
 * 'arrived' = the batch went through after all; 'renamed' = only the username differs.
 */
export function diagnoseHandinRefusal(
  cls: { roster: Roster; deleting: boolean; handinsOpen: boolean; tasks: Record<string, string> } | null,
  member: { studentId: string; handinCount: number; lastHandinAt: Date | null; lastHandinId: string } | null,
  session: StudentSession,
  draft: HandinDraft,
  handinId: string,
  now: number,
): ClassroomErrorCode | 'renamed' | 'arrived' {
  if (member && member.lastHandinId === handinId) return 'arrived';
  if (!cls || cls.deleting) return 'class_deleted';
  if (!cls.handinsOpen) return 'handins_closed';
  if (!member) return 'device_removed';
  const rosterName = cls.roster[member.studentId];
  if (rosterName === undefined) return 'not_on_roster';
  if (member.handinCount >= LIMITS.handinsPerDevice) return 'limit_reached';
  if (member.lastHandinAt && now - member.lastHandinAt.getTime() < LIMITS.handinCooldownMs + 1_000) return 'too_soon';
  if (rosterName !== session.username) return 'renamed';
  if (draft.taskId !== '' && !(draft.taskId in cls.tasks)) return 'permission';
  return 'permission';
}

let indexWarned = false;
function warnIndexOnce(err: ClassroomError): void {
  if (indexWarned) return;
  indexWarned = true;
  const cause = err.cause instanceof Error ? err.cause.message : String(err.cause ?? '');
  console.error('[classes] A Firestore composite index is missing. Deploy firestore.indexes.json (docs/CLASSROOM.md §6.1 step 7).', cause);
}

export function createStudentApi(deps: StudentApiDeps = {}): StudentApi {
  const load = deps.load ?? loadStudentFirebase;
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? LIMITS.requestTimeoutMs;
  const { storage, tabStorage } = deps;
  const userAgent = deps.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');

  let fb: StudentFirebase | null = null;
  /** ownerUid, name and tasks of every class read, for the hand-in batch and the "Last handed in" label. */
  const classInfo = new Map<string, ClassDoc>();
  /** Last successful hand-in from this API instance, for the local cooldown. */
  let memoryLastHandinAt = 0;

  const fail = (code: ClassroomErrorCode, vars?: Record<string, string>) =>
    new ClassroomError(code, errorText(STUDENT_ERROR_TEXT, code, vars));

  async function sdk(): Promise<StudentFirebase> {
    if (!fb) {
      try {
        fb = await load();
      } catch (err) {
        throw toClassroomError(err, 'student');
      }
    }
    return fb;
  }

  /** A network call with the request timeout, errors mapped to ClassroomError. */
  function net<T>(promise: Promise<T>): Promise<T> {
    return withTimeout(promise, timeoutMs).catch((err) => {
      throw toClassroomError(err, 'student');
    });
  }

  async function currentUser(f: StudentFirebase) {
    await f.auth.authStateReady();
    return f.auth.currentUser;
  }

  async function signedIn(f: StudentFirebase) {
    const user = await currentUser(f);
    if (user) return user;
    const credential = await net(f.sdk.signInAnonymously(f.auth));
    return credential.user;
  }

  const classRef = (f: StudentFirebase, code: string) => f.sdk.doc(f.db, 'classes', code);
  const memberRef = (f: StudentFirebase, code: string, uid: string) => f.sdk.doc(f.db, 'classes', code, 'members', uid);
  const handinRef = (f: StudentFirebase, code: string, id: string) => f.sdk.doc(f.db, 'classes', code, 'handins', id);

  /** The class, or null when it is missing or being deleted. */
  async function readClass(f: StudentFirebase, code: string): Promise<ClassDoc | null> {
    const snap = await net(f.sdk.getDoc(classRef(f, code)));
    if (!snap.exists()) return null;
    const cls = readClassDoc(snap.data() as Record<string, unknown>);
    if (cls.deleting) return null;
    classInfo.set(code, cls);
    return cls;
  }

  async function readMember(f: StudentFirebase, code: string, uid: string): Promise<MemberDoc | null> {
    const snap = await net(f.sdk.getDoc(memberRef(f, code, uid)));
    return snap.exists() ? readMemberDoc(snap.data() as Record<string, unknown>) : null;
  }

  function toPublic(code: string, cls: ClassDoc): PublicClass {
    return {
      code,
      name: cls.name,
      teacherName: cls.teacherName,
      ownerUid: cls.ownerUid,
      handinsOpen: cls.handinsOpen,
      joinOpen: cls.joinOpen,
      joinWindowAt: cls.joinWindowAt,
      rejoin: cls.rejoin,
      students: sortedRoster(cls.roster),
      tasks: sortedTasks(cls.tasks),
      currentTaskId: cls.currentTaskId,
    };
  }

  function publicSession(saved: SavedSession): StudentSession {
    const { code, className, teacherName, studentId, username, uid } = saved;
    return { code, className, teacherName, studentId, username, uid };
  }

  function startSession(cls: { code: string; name: string; teacherName: string }, studentId: string, username: string, uid: string): StudentSession {
    const previous = loadSavedSession(storage);
    const keepHistory = previous !== null && previous.uid === uid && previous.code === cls.code;
    const saved: SavedSession = {
      v: 1,
      code: cls.code,
      className: cls.name,
      teacherName: cls.teacherName,
      studentId,
      username,
      uid,
      lastUsedAt: now(),
      lastHandinAt: keepHistory ? previous.lastHandinAt : 0,
      lastHandinTitle: keepHistory ? previous.lastHandinTitle : '',
    };
    saveSession(saved, storage);
    saveLastCode(cls.code, storage);
    markConfirmedInTab(uid, tabStorage);
    return publicSession(saved);
  }

  async function join(cls: PublicClass, studentId: string, retry: boolean): Promise<StudentSession> {
    const entry = cls.students.find((s) => s.studentId === studentId);
    if (!cls.handinsOpen) throw fail('handins_closed', { class: cls.name });
    if (!entry) throw fail('not_on_roster');
    if (!joinStatus(cls, studentId, now()).open) throw fail('class_closed', { class: cls.name });
    const f = await sdk();
    const user = await signedIn(f);
    const data = {
      studentId,
      username: entry.username,
      ownerUid: cls.ownerUid,
      joinedAt: f.sdk.serverTimestamp(),
      device: deviceLabel(userAgent),
      handinCount: 0,
      lastHandinAt: null,
      lastHandinId: '',
    };
    try {
      await net(f.sdk.setDoc(memberRef(f, cls.code, user.uid), data));
    } catch (err) {
      if (!(err instanceof ClassroomError) || err.code !== 'permission') throw err;
      // Denied: the class changed meanwhile. Fresh reads say why (2 reads).
      const fresh = await readClass(f, cls.code);
      if (!fresh) throw fail('class_not_found', { code: formatClassCode(cls.code) });
      if (!fresh.handinsOpen) throw fail('handins_closed', { class: fresh.name });
      const rosterName = fresh.roster[studentId];
      if (rosterName === undefined) throw fail('not_on_roster');
      if (!joinStatus(fresh, studentId, now()).open) throw fail('class_closed', { class: fresh.name });
      if (rosterName !== entry.username && retry) return join(toPublic(cls.code, fresh), studentId, false);
      throw err;
    }
    return startSession({ code: cls.code, name: cls.name, teacherName: cls.teacherName }, studentId, entry.username, user.uid);
  }

  async function submit(session: StudentSession, draft: HandinDraft, handinId: string, retry: boolean): Promise<HandinRecord> {
    const problem = draftProblem(draft);
    if (problem) throw fail(problem);
    if (!isHandinId(handinId)) throw new ClassroomError('unknown', `not a hand-in id: ${handinId}`);
    const saved = loadSavedSession(storage);
    const lastHandinAt = Math.max(memoryLastHandinAt, saved && saved.uid === session.uid ? saved.lastHandinAt : 0);
    if (lastHandinAt > 0 && now() - lastHandinAt < LIMITS.handinCooldownMs) throw fail('too_soon');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw fail('offline');

    const f = await sdk();
    const user = await currentUser(f);
    if (!user || user.uid !== session.uid) throw fail('lost_identity');
    const { code } = session;
    const info = classInfo.get(code) ?? (await readClass(f, code));
    if (!info) throw fail('class_deleted');
    const title = cleanLine(draft.title, LIMITS.titleMax);
    const note = cleanMultiline(draft.note, LIMITS.noteMax);
    const content = await encodeContent(draft.code, draft.workspaceJson);
    const stored = (value: string | Uint8Array) => (typeof value === 'string' ? value : f.sdk.Bytes.fromUint8Array(value));

    const batch = f.sdk.writeBatch(f.db);
    batch.set(handinRef(f, code, handinId), {
      uid: user.uid,
      studentId: session.studentId,
      username: session.username,
      ownerUid: info.ownerUid,
      kind: draft.kind,
      taskId: draft.taskId,
      title,
      note,
      createdAt: f.sdk.serverTimestamp(),
      enc: content.enc,
      code: stored(content.code),
      workspace: stored(content.workspace),
    });
    batch.update(memberRef(f, code, user.uid), {
      handinCount: f.sdk.increment(1),
      lastHandinAt: f.sdk.serverTimestamp(),
      lastHandinId: handinId,
    });

    const success = (): HandinRecord => {
      const at = now();
      memoryLastHandinAt = at;
      const current = loadSavedSession(storage);
      if (current && current.uid === session.uid) {
        saveSession({ ...current, lastUsedAt: at, lastHandinAt: at, lastHandinTitle: info.tasks[draft.taskId] ?? title }, storage);
      }
      return {
        id: handinId,
        classCode: code,
        uid: user.uid,
        studentId: session.studentId,
        username: session.username,
        kind: draft.kind,
        taskId: draft.taskId,
        title,
        note,
        createdAt: new Date(at),
        content,
      };
    };

    try {
      await net(batch.commit());
      return success();
    } catch (err) {
      const error = toClassroomError(err, 'student');
      if (!RETRY_CODES.includes(error.code)) throw error;
      // The commit may have landed anyway (school Wi-Fi): the member doc says (1 read).
      let member: MemberDoc | null;
      try {
        member = await readMember(f, code, user.uid);
      } catch {
        throw error;
      }
      if (member && member.lastHandinId === handinId) return success();
      let cls: ClassDoc | null;
      try {
        cls = await readClass(f, code);
      } catch {
        throw error;
      }
      const verdict = diagnoseHandinRefusal(
        cls ? { roster: cls.roster, deleting: cls.deleting, handinsOpen: cls.handinsOpen, tasks: { ...cls.tasks } } : null,
        member,
        session,
        draft,
        handinId,
        now(),
      );
      if (verdict === 'arrived') return success();
      if (verdict === 'renamed') {
        const username = cls!.roster[member!.studentId];
        const current = loadSavedSession(storage);
        if (current && current.uid === session.uid) saveSession({ ...current, username }, storage);
        if (retry) return submit({ ...session, username }, draft, handinId, false);
        throw fail('permission');
      }
      if (verdict === 'permission') {
        if (error.code !== 'permission') throw error;
        if (cls && draft.taskId !== '' && !(draft.taskId in cls.tasks)) throw new ClassroomError('permission', 'task');
        throw error;
      }
      throw fail(verdict, { class: cls?.name ?? session.className });
    }
  }

  return {
    async restore() {
      const saved = loadSavedSession(storage);
      if (!saved) return null;
      const f = await sdk();
      const user = await currentUser(f);
      if (!user || user.uid !== saved.uid) {
        clearSession(storage, tabStorage);
        throw fail('lost_identity');
      }
      const cls = await readClass(f, saved.code);
      if (!cls) {
        clearSession(storage, tabStorage);
        throw fail('class_deleted');
      }
      if (!cls.handinsOpen) throw fail('handins_closed', { class: cls.name });
      const username = cls.roster[saved.studentId];
      if (username === undefined) throw fail('not_on_roster');
      const session: SavedSession = { ...saved, className: cls.name, teacherName: cls.teacherName, username };
      saveSession(session, storage);
      const confirm = !isConfirmedInTab(saved.uid, tabStorage) ? 'new_tab' : now() - saved.lastUsedAt > LIMITS.confirmAfterMs ? 'stale' : null;
      return {
        session: publicSession(session),
        info: toPublic(saved.code, cls),
        confirm,
        lastHandin: saved.lastHandinAt > 0 ? { at: saved.lastHandinAt, title: saved.lastHandinTitle } : null,
      };
    },

    async findClass(codeInput) {
      const code = normalizeClassCode(codeInput);
      if (code === null) throw fail('bad_code');
      const f = await sdk();
      const user = await signedIn(f);
      const cls = await readClass(f, code);
      if (!cls) throw fail('class_not_found', { code: formatClassCode(code) });
      if (!cls.handinsOpen) throw fail('handins_closed', { class: cls.name });
      const member = await readMember(f, code, user.uid);
      const existing = member ? { studentId: member.studentId, username: cls.roster[member.studentId] ?? member.username } : null;
      return { info: toPublic(code, cls), existing };
    },

    async refreshClass(code) {
      const f = await sdk();
      const cls = await readClass(f, code);
      if (!cls) throw fail('class_not_found', { code: formatClassCode(code) });
      return toPublic(code, cls);
    },

    join(cls, studentId) {
      return join(cls, studentId, true);
    },

    async continueAs(found) {
      if (!found.existing) throw fail('device_removed');
      const f = await sdk();
      const user = await currentUser(f);
      if (!user) throw fail('lost_identity');
      const { info } = found;
      return startSession({ code: info.code, name: info.name, teacherName: info.teacherName }, found.existing.studentId, found.existing.username, user.uid);
    },

    confirm(session) {
      markConfirmedInTab(session.uid, tabStorage);
      const saved = loadSavedSession(storage);
      if (saved && saved.uid === session.uid) saveSession({ ...saved, lastUsedAt: now() }, storage);
    },

    handIn(session, draft, handinId) {
      return submit(session, draft, handinId, true);
    },

    async myHandins(session, page = {}) {
      const f = await sdk();
      const { collection, query, where, orderBy, limit, startAfter, getDocs, Timestamp } = f.sdk;
      const constraints: QueryConstraint[] = [where('uid', '==', session.uid), orderBy('createdAt', 'desc')];
      if (page.before) constraints.push(startAfter(Timestamp.fromDate(page.before)));
      constraints.push(limit(LIMITS.myHandinsPage + 1));
      let snap;
      try {
        snap = await net(getDocs(query(collection(f.db, 'classes', session.code, 'handins'), ...constraints)));
      } catch (err) {
        if (err instanceof ClassroomError && err.code === 'index_missing') warnIndexOnce(err);
        throw err;
      }
      const docs = snap.docs;
      const items = docs.slice(0, LIMITS.myHandinsPage).map((d) => readHandinDoc(d.id, session.code, d.data() as Record<string, unknown>));
      return { items, hasMore: docs.length > LIMITS.myHandinsPage };
    },

    async leave(options = {}) {
      if (fb || loadSavedSession(storage)) {
        try {
          const f = await sdk();
          const user = await currentUser(f);
          if (user) {
            await f.sdk.deleteUser(user).catch(() => undefined);
            await f.sdk.signOut(f.auth).catch(() => undefined);
          }
        } catch {
          // Not configured or offline: the local session is cleared anyway.
        }
      }
      clearSession(storage, tabStorage);
      if (options.forgetCode) saveLastCode('', storage);
      classInfo.clear();
      memoryLastHandinAt = 0;
    },
  };
}

export type { EncodedContent };
