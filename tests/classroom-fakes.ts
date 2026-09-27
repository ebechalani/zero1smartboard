/**
 * Fakes for the classroom data-layer tests (docs/CLASSROOM.md §7.2): in-memory Storage objects and
 * a fake StudentFirebase whose SDK records reads and writes and can be scripted to fail.
 */
import type { StudentFirebase } from '../src/classroom/firebase';

/** A Storage backed by a Map. */
export function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

/** A Storage whose every access throws (private mode, a sandboxed frame). */
export function throwingStorage(): Storage {
  const boom = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { length: 0, key: boom, getItem: boom, setItem: boom, removeItem: boom, clear: boom };
}

type Data = Record<string, unknown>;
export interface FakeOp {
  type: 'set' | 'update';
  path: string;
  data: Data;
}
export interface FakeStudentOptions {
  /** The signed-in uid at start (null = signed out). */
  uid?: string | null;
  /** The uid a new anonymous sign-in gets. */
  anonymousUid?: string;
  /** path → document data (null = missing). */
  docs?: Record<string, Data | null>;
  /** Runs before a batch is applied; throw to fail the commit. Receives the ops and the commit number (1-based). */
  commit?: (ops: FakeOp[], attempt: number) => Promise<void>;
  /** Runs before a setDoc is applied; throw to fail it. */
  setDoc?: (path: string, data: Data) => Promise<void>;
  /** Runs before an updateDoc is applied; throw to fail it. */
  updateDoc?: (path: string, data: Data) => Promise<void>;
  /** The result of getDocs (or throw). */
  getDocs?: (query: FakeQuery) => Promise<{ docs: { id: string; data(): Data }[] }>;
}
export interface FakeQuery {
  path: string;
  constraints: Data[];
}

const SERVER_TIMESTAMP = { __serverTimestamp: true };
const fakeTimestamp = (date: Date) => ({ toDate: () => date, toMillis: () => date.getTime() });

function materialize(data: Data): Data {
  const out: Data = {};
  for (const [k, v] of Object.entries(data)) out[k] = v === SERVER_TIMESTAMP ? fakeTimestamp(new Date()) : v;
  return out;
}

/** A fake StudentFirebase: Firestore Lite's functions over an in-memory document map. */
export function fakeStudentFirebase(options: FakeStudentOptions = {}) {
  const docs: Record<string, Data | null> = { ...(options.docs ?? {}) };
  const reads: string[] = [];
  const ops: FakeOp[] = [];
  const sets: FakeOp[] = [];
  const deletedUsers: string[] = [];
  const stats = { commits: 0, getDocs: 0, signIns: 0, signOuts: 0 };
  const auth = {
    currentUser: options.uid ? { uid: options.uid } : (null as { uid: string } | null),
    authStateReady: async () => undefined,
  };
  const ref = (segments: string[]) => ({ path: segments.join('/') });
  const applyUpdate = (path: string, data: Data) => {
    const current = docs[path] ?? {};
    const next: Data = { ...current };
    for (const [k, v] of Object.entries(materialize(data))) {
      next[k] = v && typeof v === 'object' && 'increment' in v ? Number(current[k] ?? 0) + Number((v as { increment: number }).increment) : v;
    }
    docs[path] = next;
  };
  const sdk = {
    doc: (_db: unknown, ...segments: string[]) => ref(segments),
    collection: (_db: unknown, ...segments: string[]) => ref(segments),
    getDoc: async (r: { path: string }) => {
      reads.push(r.path);
      const data = docs[r.path];
      return { id: r.path.split('/').pop(), exists: () => data != null, data: () => data ?? undefined };
    },
    setDoc: async (r: { path: string }, data: Data) => {
      sets.push({ type: 'set', path: r.path, data }); // every attempt, also a denied one
      if (options.setDoc) await options.setDoc(r.path, data);
      docs[r.path] = materialize(data);
    },
    updateDoc: async (r: { path: string }, data: Data) => {
      sets.push({ type: 'update', path: r.path, data });
      if (options.updateDoc) await options.updateDoc(r.path, data);
      if (docs[r.path] == null) throw { code: 'not-found', name: 'FirebaseError', message: 'missing' };
      applyUpdate(r.path, data);
    },
    writeBatch: () => {
      const batchOps: FakeOp[] = [];
      return {
        set: (r: { path: string }, data: Data) => void batchOps.push({ type: 'set', path: r.path, data }),
        update: (r: { path: string }, data: Data) => void batchOps.push({ type: 'update', path: r.path, data }),
        commit: async () => {
          stats.commits++;
          ops.push(...batchOps);
          if (options.commit) await options.commit(batchOps, stats.commits);
          for (const op of batchOps) {
            if (op.type === 'set') docs[op.path] = materialize(op.data);
            else applyUpdate(op.path, op.data);
          }
        },
      };
    },
    query: (col: { path: string }, ...constraints: Data[]): FakeQuery => ({ path: col.path, constraints }),
    where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
    orderBy: (field: string, dir?: string) => ({ kind: 'orderBy', field, dir }),
    limit: (n: number) => ({ kind: 'limit', n }),
    startAfter: (value: unknown) => ({ kind: 'startAfter', value }),
    getDocs: async (q: FakeQuery) => {
      stats.getDocs++;
      return options.getDocs ? options.getDocs(q) : { docs: [] };
    },
    serverTimestamp: () => SERVER_TIMESTAMP,
    increment: (n: number) => ({ increment: n }),
    Timestamp: { fromDate: fakeTimestamp, fromMillis: (ms: number) => fakeTimestamp(new Date(ms)) },
    Bytes: { fromUint8Array: (bytes: Uint8Array) => ({ toUint8Array: () => bytes }) },
    signInAnonymously: async () => {
      stats.signIns++;
      auth.currentUser = { uid: options.anonymousUid ?? 'anon-new' };
      return { user: auth.currentUser };
    },
    signOut: async () => {
      stats.signOuts++;
      auth.currentUser = null;
    },
    deleteUser: async (user: { uid: string }) => void deletedUsers.push(user.uid),
  };
  const fb = { app: {}, auth, db: {}, sdk } as unknown as StudentFirebase;
  return { fb, auth, docs, reads, ops, sets, deletedUsers, stats };
}
