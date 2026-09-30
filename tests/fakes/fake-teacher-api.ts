/**
 * An in-memory TeacherApi for the dashboard tests (docs/CLASSROOM.md §7.3): every method records
 * its call, mutates a small store and pushes the change to the live listeners; `ready` is a
 * deferred the test resolves; any method can be made to fail once. Listeners are counted so a
 * test can check that sign-out leaves none active.
 */
import { ClassroomError, TEACHER_ERROR_TEXT, errorText, type ClassroomErrorCode } from '../../src/classroom/errors';
import { LIMITS, nameKeyOf, type HandinKind, type HandinRecord } from '../../src/classroom/model';
import type { ClassDetail, ClassSummary, HandinsUpdate, Member, NewClassInput, TeacherApi, TeacherUser, Unsubscribe } from '../../src/classroom/teacher';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(err: unknown): void;
}
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const TEACHER: TeacherUser = { uid: 'teacher-1', name: 'Mr. B', email: 'b@school.edu', photoURL: null };

export function fakeError(code: ClassroomErrorCode, vars?: Record<string, string>): ClassroomError {
  return new ClassroomError(code, errorText(TEACHER_ERROR_TEXT, code, vars));
}

export interface FakeClassOptions {
  code?: string;
  name?: string;
  handinsOpen?: boolean;
  keepWeeks?: number;
  deleting?: boolean;
  createdAt?: Date;
}

export function makeClass(options: FakeClassOptions = {}): ClassDetail {
  const createdAt = options.createdAt ?? new Date(2026, 8, 1, 9, 0);
  return {
    code: options.code ?? 'BKT4M9',
    name: options.name ?? '8B Robotics',
    handinsOpen: options.handinsOpen ?? true,
    deleting: options.deleting ?? false,
    createdAt,
    updatedAt: createdAt,
    ownerUid: TEACHER.uid,
    keepWeeks: options.keepWeeks ?? 10,
  };
}

export interface FakeHandinOptions {
  id?: string;
  classCode?: string;
  uid?: string;
  firstName?: string;
  lastName?: string;
  kind?: HandinKind;
  createdAt?: Date | null;
  code?: string;
  /** The stored workspace: the Blockly JSON of a Blocks hand-in, the program of a Python one. */
  workspaceJson?: string;
}

let handinCounter = 0;
/** A hand-in of Ali Khoury from device-aaaa at 10:42 unless told otherwise. */
export function makeHandin(options: FakeHandinOptions = {}): HandinRecord {
  handinCounter++;
  const firstName = options.firstName ?? 'Ali';
  const lastName = options.lastName ?? 'Khoury';
  return {
    id: options.id ?? `h${String(handinCounter).padStart(19, '0')}`,
    classCode: options.classCode ?? 'BKT4M9',
    uid: options.uid ?? 'device-aaaa',
    firstName,
    lastName,
    nameKey: nameKeyOf(firstName, lastName),
    kind: options.kind ?? 'code',
    createdAt: options.createdAt === undefined ? new Date(2026, 8, 26, 10, 42) : options.createdAt,
    content: { enc: 'plain', code: options.code ?? 'void setup() {}\nvoid loop() {}\n', workspace: options.workspaceJson ?? '' },
  };
}

export function makeMember(options: Partial<Member> = {}): Member {
  const firstName = options.firstName ?? 'Ali';
  const lastName = options.lastName ?? 'Khoury';
  return {
    uid: options.uid ?? 'device-aaaa',
    firstName,
    lastName,
    nameKey: options.nameKey ?? nameKeyOf(firstName, lastName),
    device: options.device ?? 'Chrome · Windows',
    joinedAt: options.joinedAt === undefined ? new Date(2026, 8, 26, 10, 0) : options.joinedAt,
    handinCount: options.handinCount ?? 0,
    lastHandinAt: options.lastHandinAt === undefined ? null : options.lastHandinAt,
  };
}

type Listener<T> = { onChange: (value: T) => void; onError: (e: ClassroomError) => void };

export interface FakeTeacherApi extends TeacherApi {
  readonly readyDeferred: Deferred<void>;
  /** Every call, by method name, with its arguments. */
  readonly calls: Record<string, unknown[][]>;
  callsTo(method: string): unknown[][];
  /** Store: mutated by the methods, readable by the tests. */
  readonly classes: Map<string, ClassDetail>;
  readonly handins: Map<string, HandinRecord[]>;
  readonly members: Map<string, Member[]>;
  /** Make the next call of `method` reject with `err`. */
  failNext(method: string, err: ClassroomError): void;
  /** What signIn resolves with (or rejects with, when a ClassroomError). */
  signInResult: TeacherUser | ClassroomError;
  /** Set to make deleteClass return 'more' (and keep the class deleting). */
  deleteClassResult: 'done' | 'more';
  deleteAllResult: 'done' | 'more';
  emitUser(user: TeacherUser | null): void;
  emitClasses(): void;
  emitClass(code: string): void;
  emitToday(code: string, update?: Partial<HandinsUpdate>): void;
  emitMembers(code: string): void;
  /** Fail the live listeners of a kind with `err`. */
  emitError(kind: 'classes' | 'class' | 'today' | 'members', err: ClassroomError): void;
  activeListeners(): number;
  listenerCounts(): Record<'user' | 'classes' | 'class' | 'today' | 'members', number>;
  /** Hand-ins the fake decides are "today" (default: all of the class's records). */
  today(code: string): HandinRecord[];
  /** Count of the hand-ins pruneHandins reports deleted (default 0). */
  pruneCount: number;
  countBefore: number;
  now: () => number;
}

export function createFakeTeacherApi(options: { now?: () => number; classes?: ClassDetail[] } = {}): FakeTeacherApi {
  const readyDeferred = deferred<void>();
  readyDeferred.promise.catch(() => undefined);
  const calls: Record<string, unknown[][]> = {};
  const failures = new Map<string, ClassroomError>();
  const classes = new Map<string, ClassDetail>();
  for (const cls of options.classes ?? []) classes.set(cls.code, cls);
  const handins = new Map<string, HandinRecord[]>();
  const members = new Map<string, Member[]>();
  const now = options.now ?? (() => Date.now());

  const userListeners = new Set<(user: TeacherUser | null) => void>();
  const classesListeners = new Set<Listener<ClassSummary[]>>();
  const classListeners = new Map<string, Set<Listener<ClassDetail | null>>>();
  const todayListeners = new Map<string, Set<Listener<HandinsUpdate>>>();
  const membersListeners = new Map<string, Set<Listener<Member[]>>>();
  let currentUser: TeacherUser | null = null;

  function record(method: string, args: unknown[]): void {
    (calls[method] ??= []).push(args);
  }
  async function call<T>(method: string, args: unknown[], run: () => T | Promise<T>): Promise<T> {
    record(method, args);
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw failure;
    }
    await Promise.resolve();
    return run();
  }
  function subscribe<T>(map: Map<string, Set<Listener<T>>>, code: string, listener: Listener<T>): Unsubscribe {
    let set = map.get(code);
    if (!set) map.set(code, (set = new Set()));
    set.add(listener);
    return () => void set!.delete(listener);
  }
  const summaries = (): ClassSummary[] => [...classes.values()].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  const cls = (code: string): ClassDetail => {
    const c = classes.get(code);
    if (!c) throw fakeError('class_not_found');
    return c;
  };
  const update = (code: string, patch: Partial<ClassDetail>): void => {
    classes.set(code, { ...cls(code), ...patch, updatedAt: new Date(now()) });
    api.emitClass(code);
    api.emitClasses();
  };
  const page = (list: HandinRecord[], size: number, before?: Date) => {
    const sorted = [...list].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    const from = before ? sorted.filter((r) => (r.createdAt?.getTime() ?? 0) < before.getTime()) : sorted;
    return { items: from.slice(0, size), hasMore: from.length > size };
  };

  const api: FakeTeacherApi = {
    ready: readyDeferred.promise,
    readyDeferred,
    calls,
    callsTo: (method) => calls[method] ?? [],
    classes,
    handins,
    members,
    failNext: (method, err) => void failures.set(method, err),
    signInResult: TEACHER,
    deleteClassResult: 'done',
    deleteAllResult: 'done',
    pruneCount: 0,
    countBefore: 0,
    now,

    onUser(callback) {
      record('onUser', []);
      userListeners.add(callback);
      readyDeferred.promise.then(() => callback(currentUser)).catch(() => undefined);
      return () => void userListeners.delete(callback);
    },
    signIn() {
      record('signIn', []);
      const result = api.signInResult;
      if (result instanceof ClassroomError) return Promise.reject(result);
      currentUser = result;
      return Promise.resolve().then(() => {
        api.emitUser(result);
        return result;
      });
    },
    signOut: () =>
      call('signOut', [], () => {
        currentUser = null;
        api.emitUser(null);
      }),

    watchClasses(onChange, onError) {
      record('watchClasses', []);
      const listener = { onChange, onError };
      classesListeners.add(listener);
      queueMicrotask(() => classesListeners.has(listener) && onChange(summaries()));
      return () => void classesListeners.delete(listener);
    },
    createClass: (input: NewClassInput) =>
      call('createClass', [input], () => {
        const code = `NEW${String(classes.size + 1).padStart(3, '0')}`.replace(/[^BCDFGHJKLMNPQRSTVWXZ3479]/g, 'B');
        const detail = makeClass({ code, name: input.name, createdAt: new Date(now()), keepWeeks: input.keepWeeks });
        classes.set(code, detail);
        api.emitClasses();
        return detail;
      }),
    watchClass(code, onChange, onError) {
      record('watchClass', [code]);
      const unsub = subscribe(classListeners, code, { onChange, onError });
      queueMicrotask(() => onChange(classes.get(code) ?? null));
      return unsub;
    },
    updateClass: (code, patch) => call('updateClass', [code, patch], () => update(code, { ...patch })),

    watchMembers(code, onChange, onError) {
      record('watchMembers', [code]);
      const unsub = subscribe(membersListeners, code, { onChange, onError });
      queueMicrotask(() => onChange(members.get(code) ?? []));
      return unsub;
    },
    removeDevice: (code, uid) =>
      call('removeDevice', [code, uid], () => {
        members.set(code, (members.get(code) ?? []).filter((m) => m.uid !== uid));
        api.emitMembers(code);
      }),
    removeUnusedDevices: (code, olderThanDays) =>
      call('removeUnusedDevices', [code, olderThanDays], () => {
        const cutoff = now() - olderThanDays * 86_400_000;
        const list = members.get(code) ?? [];
        const keep = list.filter((m) => ((m.lastHandinAt ?? m.joinedAt)?.getTime() ?? now()) >= cutoff);
        members.set(code, keep);
        api.emitMembers(code);
        return list.length - keep.length;
      }),

    watchTodayHandins(code, onChange, onError) {
      record('watchTodayHandins', [code]);
      const unsub = subscribe(todayListeners, code, { onChange, onError });
      queueMicrotask(() => {
        const items = api.today(code);
        onChange({ items, added: items.map((r) => r.id), modified: [], removed: [] });
      });
      return unsub;
    },
    loadHandins: (code, since, pageArg) =>
      call('loadHandins', [code, since, pageArg], () =>
        page(
          (handins.get(code) ?? []).filter((r) => (r.createdAt?.getTime() ?? now()) >= since.getTime()),
          LIMITS.periodPage,
          pageArg?.before,
        ),
      ),
    studentHandins: (code, nameKey, pageArg) =>
      call('studentHandins', [code, nameKey, pageArg], () =>
        page(
          (handins.get(code) ?? []).filter((r) => r.nameKey === nameKey),
          LIMITS.studentPage,
          pageArg?.before,
        ),
      ),
    deleteHandin: (code, id) =>
      call('deleteHandin', [code, id], () => {
        handins.set(code, (handins.get(code) ?? []).filter((r) => r.id !== id));
        api.emitToday(code, { removed: [id] });
      }),

    countHandinsBefore: (code, before) => call('countHandinsBefore', [code, before], () => api.countBefore),
    pruneHandins: (code, before, max) => call('pruneHandins', [code, before, max], () => api.pruneCount),
    deleteClass: (code, onProgress) =>
      call('deleteClass', [code], () => {
        onProgress?.(0, 340);
        onProgress?.(120, 340);
        if (api.deleteClassResult === 'more') {
          update(code, { deleting: true, handinsOpen: false });
          return 'more' as const;
        }
        classes.delete(code);
        for (const l of classListeners.get(code) ?? []) l.onChange(null);
        api.emitClasses();
        return 'done' as const;
      }),
    deleteAllClasses: (onProgress) =>
      call('deleteAllClasses', [], () => {
        for (const code of [...classes.keys()]) {
          onProgress?.(`Deleting ${classes.get(code)!.name}… 1 of about 1`);
          if (api.deleteAllResult === 'more') {
            update(code, { deleting: true });
            return 'more' as const;
          }
          classes.delete(code);
        }
        api.emitClasses();
        return 'done' as const;
      }),
    deleteAccount() {
      record('deleteAccount', []);
      const failure = failures.get('deleteAccount');
      if (failure) {
        failures.delete('deleteAccount');
        return Promise.reject(failure);
      }
      if (classes.size > 0) return Promise.reject(fakeError('classes_left'));
      currentUser = null;
      return Promise.resolve().then(() => api.emitUser(null));
    },

    emitUser(user) {
      currentUser = user;
      for (const cb of userListeners) cb(user);
    },
    emitClasses() {
      const list = summaries();
      for (const l of classesListeners) l.onChange(list);
    },
    emitClass(code) {
      const detail = classes.get(code) ?? null;
      for (const l of classListeners.get(code) ?? []) l.onChange(detail);
    },
    emitToday(code, partial = {}) {
      const items = api.today(code);
      const u: HandinsUpdate = { items, added: [], modified: [], removed: [], ...partial };
      for (const l of todayListeners.get(code) ?? []) l.onChange(u);
    },
    emitMembers(code) {
      for (const l of membersListeners.get(code) ?? []) l.onChange(members.get(code) ?? []);
    },
    emitError(kind, err) {
      const all =
        kind === 'classes'
          ? [...classesListeners]
          : kind === 'class'
            ? [...classListeners.values()].flatMap((s) => [...s])
            : kind === 'today'
              ? [...todayListeners.values()].flatMap((s) => [...s])
              : [...membersListeners.values()].flatMap((s) => [...s]);
      for (const l of all) l.onError(err);
    },
    listenerCounts() {
      const count = (m: Map<string, Set<unknown>>) => [...m.values()].reduce((n, s) => n + s.size, 0);
      return { user: userListeners.size, classes: classesListeners.size, class: count(classListeners), today: count(todayListeners), members: count(membersListeners) };
    },
    activeListeners() {
      const c = api.listenerCounts();
      return c.classes + c.class + c.today + c.members;
    },
    today: (code) => handins.get(code) ?? [],
  };
  return api;
}
