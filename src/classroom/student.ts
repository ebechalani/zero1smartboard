/**
 * StudentApi (docs/CLASSROOM.md §4.7): what the Hand in dialog calls. Firestore Lite through the
 * lazily loaded student SDK (firebase.ts); this module imports no Firebase code itself, so the
 * dialog can `import('../classroom/student')` without pulling the SDK until a request is needed.
 */
import { encodeContent, type EncodedContent } from './codec';
import { ClassroomError, STUDENT_ERROR_TEXT, errorText, toClassroomError, withTimeout, type ClassroomErrorCode } from './errors';
import { loadStudentFirebase, type StudentFirebase } from './firebase';
import {
  LIMITS,
  cleanName,
  deviceLabel,
  draftProblem,
  formatClassCode,
  isHandinId,
  nameKeyOf,
  nameProblem,
  normalizeClassCode,
  readClassDoc,
  readHandinDoc,
  readMemberDoc,
  type ClassDoc,
  type HandinDraft,
  type HandinRecord,
  type MemberDoc,
} from './model';
import { clearSession, loadSavedSession, saveLastCode, saveSession, type SavedSession } from './session-store';

export interface StudentSession {
  code: string;
  className: string;
  firstName: string;
  lastName: string;
  uid: string;
}
export interface PublicClass {
  code: string;
  name: string;
  ownerUid: string;
  handinsOpen: boolean;
}
export interface StudentName {
  firstName: string;
  lastName: string;
}
export interface FoundClass {
  info: PublicClass;
  /** The name this device already gave in this class (its member doc), or null. */
  existing: StudentName | null;
}
export interface RestoreResult {
  session: StudentSession;
  info: PublicClass;
  /** ms of the last hand-in from this device, null when none. */
  lastHandinAt: number | null;
}

export interface StudentApi {
  /**
   * The saved session, checked: the same anonymous uid (else 'lost_identity': saved session cleared,
   * lastCode kept); the class exists, is not deleting and accepts hand-ins (1 read); the class name is
   * refreshed and saved. The member doc is NOT read here. Null when nothing is saved: no Firebase
   * download then.
   * Rejects: lost_identity | class_deleted | handins_closed | offline | timeout | quota | load_failed | app_updated.
   */
  restore(): Promise<RestoreResult | null>;
  /**
   * Normalise → sign in anonymously if needed → get the class + own member doc (2 reads).
   * Rejects: bad_code | class_not_found | handins_closed | offline | timeout | signup_limit | auth_disabled | storage_blocked | quota | load_failed | app_updated.
   */
  findClass(codeInput: string): Promise<FoundClass>;
  /**
   * Clean and check the names (else 'bad_name'), then create this device's member doc in the class,
   * or rename it when `found.existing` says it is there already (no write when the names are the
   * same). Saves the session.
   * Rejects: bad_name | handins_closed | class_not_found | offline | timeout | quota | permission.
   */
  join(found: FoundClass, name: StudentName): Promise<StudentSession>;
  /**
   * draftProblem → local cooldown → encodeContent → the 2-write batch with `handinId` (§2.9).
   * On timeout / offline / unknown / permission-denied: read own member doc; lastHandinId === handinId → success.
   * Otherwise diagnose (read class + member). If only the name differs (renamed from another tab):
   * save it and retry once with the SAME id.
   * Resolves with the new record (createdAt = local time) and updates lastHandinAt.
   * Rejects: empty_sketch | too_large | too_soon | limit_reached | device_removed | class_deleted | handins_closed | offline | timeout | quota | permission.
   */
  handIn(session: StudentSession, draft: HandinDraft, handinId: string): Promise<HandinRecord>;
  /** "Change": forget the saved session on this computer (the anonymous sign-in and the last code are kept, unless forgetCode). */
  forget(options?: { forgetCode?: boolean }): void;
}

export interface StudentApiDeps {
  /** Default loadStudentFirebase. */
  load?: () => Promise<StudentFirebase>;
  /** Default localStorage. */
  storage?: Storage;
  now?: () => number;
  userAgent?: string;
  timeoutMs?: number;
}

const RETRY_CODES: readonly ClassroomErrorCode[] = ['timeout', 'offline', 'unknown', 'permission'];

/**
 * Pure: why a hand-in was refused, from fresh reads of the class and the member doc.
 * 'arrived' = the batch went through after all; 'renamed' = only the name differs from the session.
 */
export function diagnoseHandinRefusal(
  cls: { deleting: boolean; handinsOpen: boolean } | null,
  member: { firstName: string; lastName: string; handinCount: number; lastHandinAt: Date | null; lastHandinId: string } | null,
  session: StudentName,
  handinId: string,
  now: number,
): ClassroomErrorCode | 'renamed' | 'arrived' {
  if (member && member.lastHandinId === handinId) return 'arrived';
  if (!cls || cls.deleting) return 'class_deleted';
  if (!cls.handinsOpen) return 'handins_closed';
  if (!member) return 'device_removed';
  if (member.handinCount >= LIMITS.handinsPerDevice) return 'limit_reached';
  if (member.lastHandinAt && now - member.lastHandinAt.getTime() < LIMITS.handinCooldownMs + 1_000) return 'too_soon';
  if (member.firstName !== session.firstName || member.lastName !== session.lastName) return 'renamed';
  return 'permission';
}

/** The cleaned names, or null when one of them is not acceptable. */
export function cleanStudentName(name: StudentName): StudentName | null {
  const firstName = cleanName(name.firstName);
  const lastName = cleanName(name.lastName);
  return nameProblem(firstName) === null && nameProblem(lastName) === null ? { firstName, lastName } : null;
}

export function createStudentApi(deps: StudentApiDeps = {}): StudentApi {
  const load = deps.load ?? loadStudentFirebase;
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? LIMITS.requestTimeoutMs;
  const { storage } = deps;
  const userAgent = deps.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');

  let fb: StudentFirebase | null = null;
  /** ownerUid and name of every class read, for the hand-in batch. */
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

  const toPublic = (code: string, cls: ClassDoc): PublicClass => ({ code, name: cls.name, ownerUid: cls.ownerUid, handinsOpen: cls.handinsOpen });

  function publicSession(saved: SavedSession): StudentSession {
    const { code, className, firstName, lastName, uid } = saved;
    return { code, className, firstName, lastName, uid };
  }

  function startSession(cls: PublicClass, name: StudentName, uid: string): StudentSession {
    const previous = loadSavedSession(storage);
    const keepHistory = previous !== null && previous.uid === uid && previous.code === cls.code;
    const saved: SavedSession = {
      v: 2,
      code: cls.code,
      className: cls.name,
      firstName: name.firstName,
      lastName: name.lastName,
      uid,
      lastUsedAt: now(),
      lastHandinAt: keepHistory ? previous.lastHandinAt : 0,
    };
    saveSession(saved, storage);
    saveLastCode(cls.code, storage);
    return publicSession(saved);
  }

  /** Why a member write was denied, from a fresh read of the class. */
  async function explainDeniedJoin(f: StudentFirebase, code: string, fallback: ClassroomError): Promise<never> {
    const fresh = await readClass(f, code);
    if (!fresh) throw fail('class_not_found', { code: formatClassCode(code) });
    if (!fresh.handinsOpen) throw fail('handins_closed', { class: fresh.name });
    throw fallback;
  }

  async function join(found: FoundClass, input: StudentName): Promise<StudentSession> {
    const name = cleanStudentName(input);
    if (!name) throw fail('bad_name');
    const { info } = found;
    if (!info.handinsOpen) throw fail('handins_closed', { class: info.name });
    const f = await sdk();
    const user = await signedIn(f);
    const ref = memberRef(f, info.code, user.uid);
    const names = { firstName: name.firstName, lastName: name.lastName, nameKey: nameKeyOf(name.firstName, name.lastName) };
    const create = () =>
      net(
        f.sdk.setDoc(ref, {
          ...names,
          ownerUid: info.ownerUid,
          joinedAt: f.sdk.serverTimestamp(),
          device: deviceLabel(userAgent),
          handinCount: 0,
          lastHandinAt: null,
          lastHandinId: '',
        }),
      );
    const rename = () => net(f.sdk.updateDoc(ref, names));
    const existing = found.existing;
    const unchanged = existing !== null && existing.firstName === name.firstName && existing.lastName === name.lastName;
    if (!unchanged) {
      const [first, second] = existing ? [rename, create] : [create, rename];
      try {
        await first();
      } catch (err) {
        if (!(err instanceof ClassroomError) || err.code !== 'permission') throw err;
        // Denied: the member doc appeared or vanished meanwhile (another tab, the teacher), or the class changed.
        try {
          await second();
        } catch (err2) {
          if (!(err2 instanceof ClassroomError) || err2.code !== 'permission') throw err2;
          await explainDeniedJoin(f, info.code, err2);
        }
      }
    }
    return startSession(info, name, user.uid);
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
    // A Python hand-in keeps its program in the workspace field (docs/PYTHON.md §8.1).
    const content = await encodeContent(draft.code, draft.kind === 'python' ? draft.python : draft.workspaceJson);
    const stored = (value: string | Uint8Array) => (typeof value === 'string' ? value : f.sdk.Bytes.fromUint8Array(value));
    const nameKey = nameKeyOf(session.firstName, session.lastName);

    const batch = f.sdk.writeBatch(f.db);
    batch.set(handinRef(f, code, handinId), {
      uid: user.uid,
      firstName: session.firstName,
      lastName: session.lastName,
      nameKey,
      ownerUid: info.ownerUid,
      kind: draft.kind,
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
      if (current && current.uid === session.uid) saveSession({ ...current, lastUsedAt: at, lastHandinAt: at }, storage);
      return {
        id: handinId,
        classCode: code,
        uid: user.uid,
        firstName: session.firstName,
        lastName: session.lastName,
        nameKey,
        kind: draft.kind,
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
      const verdict = diagnoseHandinRefusal(cls, member, session, handinId, now());
      if (verdict === 'arrived') return success();
      if (verdict === 'renamed') {
        const renamed = { ...session, firstName: member!.firstName, lastName: member!.lastName };
        const current = loadSavedSession(storage);
        if (current && current.uid === session.uid) saveSession({ ...current, firstName: renamed.firstName, lastName: renamed.lastName }, storage);
        if (retry) return submit(renamed, draft, handinId, false);
        throw fail('permission');
      }
      if (verdict === 'permission') throw error;
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
        clearSession(storage);
        throw fail('lost_identity');
      }
      const cls = await readClass(f, saved.code);
      if (!cls) {
        clearSession(storage);
        throw fail('class_deleted');
      }
      if (!cls.handinsOpen) throw fail('handins_closed', { class: cls.name });
      const session: SavedSession = { ...saved, className: cls.name };
      saveSession(session, storage);
      return {
        session: publicSession(session),
        info: toPublic(saved.code, cls),
        lastHandinAt: saved.lastHandinAt > 0 ? saved.lastHandinAt : null,
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
      const existing = member ? { firstName: member.firstName, lastName: member.lastName } : null;
      return { info: toPublic(code, cls), existing };
    },

    join,

    handIn(session, draft, handinId) {
      return submit(session, draft, handinId, true);
    },

    forget(options = {}) {
      clearSession(storage);
      if (options.forgetCode) saveLastCode('', storage);
      memoryLastHandinAt = 0;
    },
  };
}

export type { EncodedContent };
