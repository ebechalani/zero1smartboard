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
export const HANDIN_ID_LENGTH = 20; // [A-Za-z0-9]
/** The current shape of a class document (docs/CLASSROOM.md §2.3). */
export const CLASS_SCHEMA = 2;

export const LIMITS = {
  classNameMax: 60,
  /** First name and last name: 1-30 characters each after cleanName(). */
  nameMax: 30,
  deviceMax: 40,
  codeMaxBytes: 50_000,
  workspaceMaxBytes: 100_000,
  /** A Python hand-in's source (stored in `workspace`). Client-only: the rules check workspace ≤ 100,000. */
  pythonMaxBytes: 50_000,
  /** Inflate caps for stored content (2× the raw limits): beyond them = 'too_large'. */
  codeDecodeCap: 100_000,
  workspaceDecodeCap: 200_000,
  handinsPerDevice: 300,
  handinCooldownMs: 10_000,
  clockSkewMs: 60_000,
  keepWeeksMin: 1,
  keepWeeksMax: 52,
  requestTimeoutMs: 20_000,
  batchMaxOps: 400,
  deletesPerRun: 5_000,
  prunePerOpen: 500,
  todayLimit: 300,
  periodPage: 100,
  studentPage: 10,
  membersWatchLimit: 150,
  reviewHashMax: 60_000,
} as const;

/**
 * A first or last name: letters of any alphabet (accents kept), then letters, spaces,
 * apostrophes, dots and hyphens; 1-30 characters. The same regex is in firestore.rules
 * (RE2 syntax, `\p{L}` = any letter).
 */
export const NAME_PATTERN = /^\p{L}[\p{L} '.-]{0,29}$/u;
const CLASS_CODE_PATTERN = /^[BCDFGHJKLMNPQRSTVWXZ3479]{6}$/;
const HANDIN_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export type HandinKind = 'code' | 'blocks' | 'python';
/** Every kind the rules accept (firestore.rules `validHandinShape`). */
const HANDIN_KINDS: readonly HandinKind[] = ['code', 'blocks', 'python'];

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

/** A hand-in id, 20 × [A-Za-z0-9], made by the client before the batch (docs/CLASSROOM.md §2.9). */
export function newHandinId(randomBytes: RandomBytes = defaultRandomBytes): string {
  return randomSymbols(ALNUM, HANDIN_ID_LENGTH, randomBytes);
}

export function isHandinId(id: string): boolean {
  return HANDIN_ID_PATTERN.test(id);
}

// ---------------------------------------------------------------------------
// Student names
// ---------------------------------------------------------------------------

/** A typed first or last name as stored: NFC, one line, single spaces, at most 30 characters. */
export function cleanName(input: string): string {
  return cleanLine(input.normalize('NFC'), LIMITS.nameMax);
}

export type NameProblem = 'empty' | 'too_long' | 'invalid';

/** Why a cleaned name is not acceptable; null when it is. */
export function nameProblem(name: string): NameProblem | null {
  if (name === '') return 'empty';
  if (name.length > LIMITS.nameMax) return 'too_long';
  return NAME_PATTERN.test(name) ? null : 'invalid';
}

/**
 * The grouping key of a student: lower-case "first last". The dashboard groups hand-ins by it; the
 * rules only check that it is short and lower-case (their lower() is ASCII-only), and that a
 * hand-in carries the member doc's key.
 */
export function nameKeyOf(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.toLowerCase();
}

/** "Ali Khoury". */
export function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

/** "Khoury, Ali" (lists on the dashboard). */
export function listName(firstName: string, lastName: string): string {
  return lastName ? `${lastName}, ${firstName}` : firstName;
}

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

/** Invisible characters: controls, format characters (zero-width, bidi overrides) and lone surrogates. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}]/gu;

/** The first `max` UTF-16 units of `text`, without half an emoji at the end. */
function cutAt(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');
}

/** One line: whitespace → single spaces, invisible characters removed, trimmed, at most `max` characters. */
export function cleanLine(text: string, max: number): string {
  const line = text.replace(/\s/g, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
  return cutAt(line, max).trim();
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
  /** The Arduino sketch (Blocks: generated from the blocks; Python: made from the program, or the placeholder). */
  code: string;
  /** The Blockly workspace; '' unless kind is 'blocks'. */
  workspaceJson: string;
  /** The Python program (docs/PYTHON.md §8.1, stored in `workspace`); '' unless kind is 'python'. */
  python: string;
}
/** A decoded hand-in (contentOf): the same fields as a draft. */
export interface HandinContent {
  kind: HandinKind;
  code: string;
  workspaceJson: string;
  python: string;
}
export interface HandinRecord {
  id: string;
  classCode: string;
  uid: string;
  firstName: string;
  lastName: string;
  nameKey: string;
  kind: HandinKind;
  /** Server time; for a hand-in this device just made: local time. */
  createdAt: Date | null;
  /** Still encoded (codec.ts); `workspace` holds the Blockly JSON or the Python program (contentOf). */
  content: EncodedContent;
}

/**
 * The decoded content of a hand-in of `kind`. The stored `workspace` field is the Blockly JSON of a
 * Blocks hand-in, the program of a Python one and empty for Code (docs/PYTHON.md §8.1).
 */
export function contentOf(kind: HandinKind, decoded: { code: string; workspaceJson: string }): HandinContent {
  return {
    kind,
    code: decoded.code,
    workspaceJson: kind === 'blocks' ? decoded.workspaceJson : '',
    python: kind === 'python' ? decoded.workspaceJson : '',
  };
}

/** The client-side checks that need no request. */
export function draftProblem(draft: HandinDraft): 'empty_sketch' | 'too_large' | null {
  if (draft.code.trim() === '') return 'empty_sketch';
  if (draft.kind === 'python' && draft.python.trim() === '') return 'empty_sketch';
  if (utf8Length(draft.code) > LIMITS.codeMaxBytes) return 'too_large';
  if (utf8Length(draft.workspaceJson) > LIMITS.workspaceMaxBytes) return 'too_large';
  if (utf8Length(draft.python) > LIMITS.pythonMaxBytes) return 'too_large';
  return null;
}

// ---------------------------------------------------------------------------
// Reading Firestore documents (duck-typed: works with the Lite and the full SDK)
// ---------------------------------------------------------------------------

export interface ClassDoc {
  ownerUid: string;
  name: string;
  handinsOpen: boolean;
  keepWeeks: number;
  deleting: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
export interface MemberDoc {
  firstName: string;
  lastName: string;
  nameKey: string;
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

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** The fields of a class document, with tolerant types (docs/CLASSROOM.md §2.3). */
export function readClassDoc(data: Data): ClassDoc {
  return {
    ownerUid: text(data.ownerUid),
    name: text(data.name),
    handinsOpen: data.handinsOpen === true,
    keepWeeks: typeof data.keepWeeks === 'number' ? data.keepWeeks : LIMITS.keepWeeksMin,
    deleting: data.deleting === true,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function readMemberDoc(data: Data): MemberDoc {
  return {
    firstName: text(data.firstName),
    lastName: text(data.lastName),
    nameKey: text(data.nameKey),
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
    firstName: text(data.firstName),
    lastName: text(data.lastName),
    nameKey: text(data.nameKey),
    // Unknown kinds read as Code: their sketch is always there.
    kind: HANDIN_KINDS.includes(data.kind as HandinKind) ? (data.kind as HandinKind) : 'code',
    createdAt: toDate(data.createdAt),
    content: { enc, code: contentField(data.code), workspace: contentField(data.workspace) },
  };
}
