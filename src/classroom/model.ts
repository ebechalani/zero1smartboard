/**
 * Classes: types, constants, validation and pure helpers of the class platform
 * (docs/CLASSROOM.md §2 and §4.4). No DOM, no Firebase.
 *
 * The limits here must match firestore.rules; tests/classroom-model.test.ts
 * reads the rules and checks that every number appears in them.
 */
import type { EncodedContent } from './codec';

export const CLASS_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ3479';
export const CLASS_CODE_LENGTH = 6;
/** Digits that look like letters of the alphabet on a projector, read as those letters. */
export const CODE_LOOKALIKES: Readonly<Record<string, string>> = { '2': 'Z', '5': 'S', '6': 'G', '8': 'B' };
export const STUDENT_ID_LENGTH = 8; // [a-z0-9]
export const TASK_ID_LENGTH = 6; // [a-z0-9]
export const HANDIN_ID_LENGTH = 20; // [A-Za-z0-9]

export const LIMITS = {
  classNameMax: 60,
  teacherNameMax: 60,
  rosterMax: 100,
  tasksMax: 30,
  taskTitleMax: 60,
  usernameMin: 2,
  usernameMax: 24,
  titleMax: 80,
  noteMax: 500,
  deviceMax: 40,
  codeMaxBytes: 50_000,
  workspaceMaxBytes: 100_000,
  /** Inflate caps for stored content (2× the raw limits): beyond them = 'too_large'. */
  codeDecodeCap: 100_000,
  workspaceDecodeCap: 200_000,
  handinsPerDevice: 300,
  handinCooldownMs: 10_000,
  joinWindowMs: 15 * 60_000,
  clockSkewMs: 60_000,
  /** Ask "Hand in as <name>?" when a saved session was last used longer ago (or in a new tab). */
  confirmAfterMs: 20 * 60_000,
  keepWeeksMin: 1,
  keepWeeksMax: 52,
  requestTimeoutMs: 20_000,
  batchMaxOps: 400,
  deletesPerRun: 5_000,
  prunePerOpen: 500,
  todayLimit: 300,
  periodPage: 100,
  studentPage: 10,
  myHandinsPage: 20,
  membersWatchLimit: 150,
  reviewHashMax: 60_000,
} as const;

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,23}$/;
const CLASS_CODE_PATTERN = /^[BCDFGHJKLMNPQRSTVWXZ3479]{6}$/;
const STUDENT_ID_PATTERN = /^[a-z0-9]{8}$/;
const TASK_ID_PATTERN = /^[a-z0-9]{6}$/;
const HANDIN_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

const LOWER_ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export type HandinKind = 'code' | 'blocks';
export type Roster = Readonly<Record<string, string>>;
export interface RosterEntry {
  studentId: string;
  username: string;
}
export interface TaskEntry {
  taskId: string;
  title: string;
}

/** A source of `n` random bytes; the default is `crypto.getRandomValues`. */
export type RandomBytes = (n: number) => Uint8Array;

function defaultRandomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

// ---------------------------------------------------------------------------
// Class codes
// ---------------------------------------------------------------------------

/** Steps 1-2 of normalizeClassCode: separators removed, upper case, look-alike digits mapped. */
function squeezeCode(input: string): string {
  return input
    .replace(/[\s\-._]/g, '')
    .toUpperCase()
    .replace(/[2568]/g, (d) => CODE_LOOKALIKES[d]);
}

/** 'bkt-4m9 ' → 'BKT4M9'; '8KT4M9' → 'BKT4M9'; anything else → null. */
export function normalizeClassCode(input: string): string | null {
  const code = squeezeCode(input);
  return CLASS_CODE_PATTERN.test(code) ? code : null;
}

/** Why normalizeClassCode refused `input`, naming the first bad character; null when the code is valid. */
export function codeProblem(input: string): string | null {
  const code = squeezeCode(input);
  for (const ch of code) {
    if (CLASS_CODE_ALPHABET.includes(ch)) continue;
    if (/^[A-Z]$/.test(ch)) return `Class codes never contain the letter ${ch}.`;
    if (/^[0-9]$/.test(ch)) return `Class codes never contain the digit ${ch}.`;
    return `Class codes only have letters and digits, not "${ch}".`;
  }
  if (code.length === 0) return 'Type the class code your teacher gave you.';
  if (code.length !== CLASS_CODE_LENGTH) return `A class code has ${CLASS_CODE_LENGTH} characters, not ${code.length}.`;
  return null;
}

/** 'BKT4M9' → 'BKT-4M9'. */
export function formatClassCode(code: string): string {
  return code.length === CLASS_CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

/** The class link students open: `…/#class=BKT4M9`, next to the page at `base` (default: this page). */
export function classLink(code: string, base?: string): string {
  return new URL(`./#class=${code}`, base ?? location.href).href;
}

/**
 * `length` symbols of `alphabet` with rejection sampling: a byte is used only when it is below
 * the largest multiple of the alphabet size (240 for 24 symbols), so `% size` has no bias.
 */
function randomSymbols(alphabet: string, length: number, randomBytes: RandomBytes): string {
  const size = alphabet.length;
  const limit = Math.floor(256 / size) * size;
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length)) {
      if (b >= limit) continue;
      out += alphabet[b % size];
      if (out.length === length) break;
    }
  }
  return out;
}

export function generateClassCode(randomBytes: RandomBytes = defaultRandomBytes): string {
  return randomSymbols(CLASS_CODE_ALPHABET, CLASS_CODE_LENGTH, randomBytes);
}

/** A fresh 8-character studentId that is not a key of `existing`. */
export function newStudentId(existing: Roster, randomBytes: RandomBytes = defaultRandomBytes): string {
  for (;;) {
    const id = randomSymbols(LOWER_ALNUM, STUDENT_ID_LENGTH, randomBytes);
    if (!(id in existing)) return id;
  }
}

/** A fresh 6-character taskId that is not a key of `existing`. */
export function newTaskId(existing: Readonly<Record<string, string>>, randomBytes: RandomBytes = defaultRandomBytes): string {
  for (;;) {
    const id = randomSymbols(LOWER_ALNUM, TASK_ID_LENGTH, randomBytes);
    if (!(id in existing)) return id;
  }
}

/** A hand-in id, 20 × [A-Za-z0-9], made by the client before the batch (docs/CLASSROOM.md §2.9). */
export function newHandinId(randomBytes: RandomBytes = defaultRandomBytes): string {
  return randomSymbols(ALNUM, HANDIN_ID_LENGTH, randomBytes);
}

export function isStudentId(id: string): boolean {
  return STUDENT_ID_PATTERN.test(id);
}
export function isTaskId(id: string): boolean {
  return TASK_ID_PATTERN.test(id);
}
export function isHandinId(id: string): boolean {
  return HANDIN_ID_PATTERN.test(id);
}

// ---------------------------------------------------------------------------
// Usernames, rosters, tasks
// ---------------------------------------------------------------------------

/**
 * A typed name as a username (docs/CLASSROOM.md §2.4): accents stripped, lower case,
 * optionally "First L." style (`Ali Khalil` → `ali.k`), spaces → `.`, other characters dropped.
 */
export function normalizeUsername(input: string, options: { shortenLastName?: boolean } = {}): string {
  let name = input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
  if (options.shortenLastName) {
    const words = name.split(/\s+/).filter((w) => w !== '');
    if (words.length >= 2) name = `${words[0]}.${words[words.length - 1].charAt(0)}`;
  }
  name = name
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/([._-])[._-]+/g, '$1')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, LIMITS.usernameMax)
    .replace(/[._-]+$/g, '');
  return name;
}

export type UsernameProblem = 'empty' | 'too_short' | 'too_long' | 'invalid';

export function usernameProblem(name: string): UsernameProblem | null {
  if (name === '') return 'empty';
  if (name.length < LIMITS.usernameMin) return 'too_short';
  if (name.length > LIMITS.usernameMax) return 'too_long';
  return USERNAME_PATTERN.test(name) ? null : 'invalid';
}

/** Whether two strings are at Levenshtein distance exactly 1. */
function differByOne(a: string, b: string): boolean {
  if (a === b) return false;
  if (a.length === b.length) {
    let diffs = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diffs > 1) return false;
    return diffs === 1;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long.length - short.length !== 1) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

/** Pairs of names that differ by one character, for the "students may pick the wrong one" warning. */
export function nearDuplicates(names: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (differByOne(names[i], names[j])) pairs.push([names[i], names[j]]);
    }
  }
  return pairs;
}

/** Plain code-unit order: the same on every device and in the rules-checked ASCII alphabet. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The roster as a list sorted by username (locale-independent). Values are read with String(). */
export function sortedRoster(roster: Roster): RosterEntry[] {
  return Object.entries(roster)
    .map(([studentId, username]) => ({ studentId, username: String(username) }))
    .sort((a, b) => compareText(a.username, b.username) || compareText(a.studentId, b.studentId));
}

/** The tasks as a list sorted by title. */
export function sortedTasks(tasks: Readonly<Record<string, string>>): TaskEntry[] {
  return Object.entries(tasks)
    .map(([taskId, title]) => ({ taskId, title: String(title) }))
    .sort((a, b) => compareText(a.title, b.title) || compareText(a.taskId, b.taskId));
}

export type RosterProblemReason = UsernameProblem | 'duplicate' | 'already_in_class' | 'too_many';
export interface RosterPlan {
  /** New entries with fresh studentIds, in input order. */
  add: RosterEntry[];
  problems: { line: number; input: string; normalized: string; reason: RosterProblemReason }[];
  warnings: { names: [string, string]; reason: 'near_duplicate' }[];
}

/**
 * What "Add students" would do with the typed list: one name per line (commas and semicolons
 * also split), normalised, checked against the current roster and the limits.
 */
export function planRosterAdd(
  existing: Roster,
  text: string,
  options: { shortenLastName?: boolean; randomBytes?: RandomBytes } = {},
): RosterPlan {
  const plan: RosterPlan = { add: [], problems: [], warnings: [] };
  const taken = new Set(Object.values(existing).map(String));
  const roster: Record<string, string> = { ...existing };
  text.split(/[\n,;]/).forEach((raw, index) => {
    const input = raw.trim();
    if (input === '') return;
    const line = index + 1;
    const normalized = normalizeUsername(input, { shortenLastName: options.shortenLastName });
    const problem = usernameProblem(normalized);
    let reason: RosterProblemReason | null = problem;
    if (reason === null && taken.has(normalized)) reason = 'already_in_class';
    if (reason === null && plan.add.some((e) => e.username === normalized)) reason = 'duplicate';
    if (reason === null && Object.keys(roster).length >= LIMITS.rosterMax) reason = 'too_many';
    if (reason !== null) {
      plan.problems.push({ line, input, normalized, reason });
      return;
    }
    const studentId = newStudentId(roster, options.randomBytes);
    roster[studentId] = normalized;
    plan.add.push({ studentId, username: normalized });
  });
  const added = new Set(plan.add.map((e) => e.username));
  for (const pair of nearDuplicates([...taken, ...added])) {
    if (added.has(pair[0]) || added.has(pair[1])) plan.warnings.push({ names: pair, reason: 'near_duplicate' });
  }
  return plan;
}

/** What "Add tasks" would do with the typed list: one title per line, cleaned, at most 30 in all. */
export function planTasksAdd(
  existing: Readonly<Record<string, string>>,
  text: string,
  randomBytes?: RandomBytes,
): { add: TaskEntry[]; problems: { line: number; reason: 'too_long' | 'too_many' | 'duplicate' }[] } {
  const add: TaskEntry[] = [];
  const problems: { line: number; reason: 'too_long' | 'too_many' | 'duplicate' }[] = [];
  const taken = new Set(Object.values(existing).map(String));
  const tasks: Record<string, string> = { ...existing };
  text.split('\n').forEach((raw, index) => {
    const title = cleanLine(raw, Number.MAX_SAFE_INTEGER);
    if (title === '') return;
    const line = index + 1;
    if (title.length > LIMITS.taskTitleMax) return void problems.push({ line, reason: 'too_long' });
    if (taken.has(title) || add.some((t) => t.title === title)) return void problems.push({ line, reason: 'duplicate' });
    if (Object.keys(tasks).length >= LIMITS.tasksMax) return void problems.push({ line, reason: 'too_many' });
    const taskId = newTaskId(tasks, randomBytes);
    tasks[taskId] = title;
    add.push({ taskId, title });
  });
  return { add, problems };
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

export interface JoinState {
  joinOpen: boolean;
  joinWindowAt: Date | null;
  rejoin: Readonly<Record<string, Date>>;
}

/**
 * The rules' joinAllowed() on the client, with LIMITS.clockSkewMs of tolerance ('open' when
 * unsure, so a student is never refused locally for a window the server still accepts).
 */
export function joinStatus(cls: JoinState, studentId: string | null, nowMs: number): { open: boolean; until: Date | null } {
  if (cls.joinOpen) return { open: true, until: null };
  const windows: Date[] = [];
  if (cls.joinWindowAt) windows.push(cls.joinWindowAt);
  if (studentId !== null && cls.rejoin[studentId]) windows.push(cls.rejoin[studentId]);
  let best: Date | null = null;
  for (const start of windows) {
    const until = new Date(start.getTime() + LIMITS.joinWindowMs);
    if (nowMs < until.getTime() + LIMITS.clockSkewMs && (best === null || until > best)) best = until;
  }
  return best ? { open: true, until: best } : { open: false, until: null };
}

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

/** Invisible characters: controls, format characters (zero-width, bidi overrides) and lone surrogates. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}]/gu;
const INVISIBLE_EXCEPT_NEWLINE = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}]/gu;

/** The first `max` UTF-16 units of `text`, without half an emoji at the end. */
function cutAt(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');
}

/** One line: whitespace → single spaces, invisible characters removed, trimmed, at most `max` characters. */
export function cleanLine(text: string, max: number): string {
  const line = text.replace(/\s/g, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
  return cutAt(line, max).trim();
}

/** Several lines: CRLF → LF, at most one empty line in a row, trimmed, at most `max` characters. */
export function cleanMultiline(text: string, max: number): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]/g, ' ')
    .replace(INVISIBLE_EXCEPT_NEWLINE, '')
    .split('\n')
    .map((line) => line.trimEnd()) // not / +\n/: that regex takes quadratic time on a long run of spaces
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cutAt(lines, max).trim();
}

/** The size of `text` in UTF-8 bytes (the unit of the content limits, as in the rules). */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bAndroid\b/, 'Android'],
  [/\biPhone\b|\biPad\b|\biPod\b/, 'iOS'],
  [/\bMacintosh\b|\bMac OS X\b/, 'macOS'],
  [/\bLinux\b|\bX11\b/, 'Linux'],
];

/** A coarse device label for the teacher ('Chrome · Windows'), at most LIMITS.deviceMax characters. */
export function deviceLabel(userAgent: string): string {
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  const label = browser && system ? `${browser} · ${system}` : (browser ?? system ?? 'Unknown browser');
  return cleanLine(label, LIMITS.deviceMax);
}

/** The last 4 characters of a device uid, upper case: enough to tell two computers apart. */
export function shortDeviceId(uid: string): string {
  return uid.slice(-4).toUpperCase();
}

// ---------------------------------------------------------------------------
// Hand-ins
// ---------------------------------------------------------------------------

export interface HandinDraft {
  kind: HandinKind;
  /** The Arduino sketch (Blocks: generated from the blocks). */
  code: string;
  /** '' in Code mode. */
  workspaceJson: string;
  /** '' = no task. */
  taskId: string;
  title: string;
  note: string;
}
export interface HandinContent {
  kind: HandinKind;
  code: string;
  workspaceJson: string;
}
export interface HandinRecord {
  id: string;
  classCode: string;
  uid: string;
  studentId: string;
  username: string;
  kind: HandinKind;
  taskId: string;
  title: string;
  note: string;
  /** Server time; for a hand-in this device just made: local time. */
  createdAt: Date | null;
  /** Still encoded (codec.ts). */
  content: EncodedContent;
}

/** The client-side checks that need no request. */
export function draftProblem(draft: HandinDraft): 'empty_sketch' | 'too_large' | null {
  if (draft.code.trim() === '') return 'empty_sketch';
  if (utf8Length(draft.code) > LIMITS.codeMaxBytes) return 'too_large';
  if (utf8Length(draft.workspaceJson) > LIMITS.workspaceMaxBytes) return 'too_large';
  return null;
}

// ---------------------------------------------------------------------------
// Reading Firestore documents (duck-typed: works with the Lite and the full SDK)
// ---------------------------------------------------------------------------

export interface ClassDoc extends JoinState {
  ownerUid: string;
  name: string;
  teacherName: string;
  roster: Roster;
  handinsOpen: boolean;
  tasks: Readonly<Record<string, string>>;
  currentTaskId: string;
  keepWeeks: number;
  deleting: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
export interface MemberDoc {
  studentId: string;
  username: string;
  device: string;
  joinedAt: Date | null;
  handinCount: number;
  lastHandinAt: Date | null;
  lastHandinId: string;
}

type Data = Record<string, unknown>;

/** A Firestore Timestamp (any SDK) or Date as a Date; null for anything else. */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate(): Date }).toDate();
  return null;
}

function stringMap(value: unknown): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Data)) out[k] = String(v);
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** The fields of a class document, with tolerant types (docs/CLASSROOM.md §2.3-2.4). */
export function readClassDoc(data: Data): ClassDoc {
  const rejoin: Record<string, Date> = {};
  if (data.rejoin && typeof data.rejoin === 'object') {
    for (const [k, v] of Object.entries(data.rejoin as Data)) {
      const at = toDate(v);
      if (at) rejoin[k] = at;
    }
  }
  return {
    ownerUid: text(data.ownerUid),
    name: text(data.name),
    teacherName: text(data.teacherName),
    roster: stringMap(data.roster),
    joinOpen: data.joinOpen === true,
    joinWindowAt: toDate(data.joinWindowAt),
    rejoin,
    handinsOpen: data.handinsOpen === true,
    tasks: stringMap(data.tasks),
    currentTaskId: text(data.currentTaskId),
    keepWeeks: typeof data.keepWeeks === 'number' ? data.keepWeeks : LIMITS.keepWeeksMin,
    deleting: data.deleting === true,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function readMemberDoc(data: Data): MemberDoc {
  return {
    studentId: text(data.studentId),
    username: text(data.username),
    device: text(data.device),
    joinedAt: toDate(data.joinedAt),
    handinCount: typeof data.handinCount === 'number' ? data.handinCount : 0,
    lastHandinAt: toDate(data.lastHandinAt),
    lastHandinId: text(data.lastHandinId),
  };
}

/** A stored code / workspace field: a string, or Firestore Bytes (any SDK) as a Uint8Array. */
function contentField(value: unknown): string | Uint8Array {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return value;
  if (value && typeof (value as { toUint8Array?: unknown }).toUint8Array === 'function') {
    return (value as { toUint8Array(): Uint8Array }).toUint8Array();
  }
  return '';
}

export function readHandinDoc(id: string, classCode: string, data: Data): HandinRecord {
  const enc = data.enc === 'gzip' ? 'gzip' : 'plain';
  return {
    id,
    classCode,
    uid: text(data.uid),
    studentId: text(data.studentId),
    username: text(data.username),
    kind: data.kind === 'blocks' ? 'blocks' : 'code',
    taskId: text(data.taskId),
    title: text(data.title),
    note: text(data.note),
    createdAt: toDate(data.createdAt),
    content: { enc, code: contentField(data.code), workspace: contentField(data.workspace) },
  };
}
