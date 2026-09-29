/**
 * Links that carry work (docs/CLASSROOM.md §4.9): `#code=` / `#blocks=` share links (moved here
 * from src/ui/editor.ts and src/ui/blocks-panel.ts, which re-export them), `#python=` share links
 * (docs/PYTHON.md §8.4), `#class=` join links and the review-page payload. Pure: no DOM beyond
 * `location` (optional), no Firebase.
 */
import { LIMITS, normalizeClassCode, type HandinKind } from './classroom/model';

// ---------------------------------------------------------------------------
// Share links (#code=<base64url>, #blocks=<base64url JSON>, #python=<base64url>)
// ---------------------------------------------------------------------------

/** Encode a sketch as URL-safe base64 (UTF-8, no padding) for a `#code=` link. */
export function encodeShareCode(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a `#code=` payload; returns null when it is not valid base64url. */
export function decodeShareCode(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Extract the sketch from a URL hash such as `#code=...`, or null. */
export function codeFromHash(hash: string): string | null {
  const match = /^#code=([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? decodeShareCode(match[1]) : null;
}

/** Parse serialized workspace JSON; null unless it is a JSON object. */
export function parseWorkspaceJson(text: string): object | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Encode a workspace for a `#blocks=` link (base64url of its JSON). */
export function encodeShareBlocks(workspace: object): string {
  return encodeShareCode(JSON.stringify(workspace));
}

/** Extract the workspace from a URL hash such as `#blocks=...`, or null. */
export function blocksFromHash(hash: string): object | null {
  const match = /^#blocks=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return null;
  const text = decodeShareCode(match[1]);
  return text === null ? null : parseWorkspaceJson(text);
}

/** Encode a Python program for a `#python=` link (the same base64url UTF-8 encoding as `#code=`). */
export function encodeSharePython(source: string): string {
  return encodeShareCode(source);
}

/** Extract the Python program from a URL hash such as `#python=...`, or null. */
export function pythonFromHash(hash: string): string | null {
  const match = /^#python=([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? decodeShareCode(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Class links (#class=BKT4M9)
// ---------------------------------------------------------------------------

/** '#class=BKT4M9' (or '#class=bkt-4m9') → 'BKT4M9' (normalised), or null. */
export function classFromHash(hash: string): string | null {
  const match = /^#class=(.+)$/.exec(hash);
  if (!match) return null;
  let raw = match[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Keep the raw text: the normaliser refuses anything that is not a code anyway.
  }
  return normalizeClassCode(raw);
}

// ---------------------------------------------------------------------------
// Review page payload (#review=<base64url JSON> / #rid=<handoff key>)
// ---------------------------------------------------------------------------

export interface ReviewPayload {
  v: 1;
  kind: HandinKind;
  code: string;
  workspaceJson: string;
  /** The Python program of a 'python' hand-in; absent in older links (decoded as ''). */
  python?: string;
  who: string;
  className: string;
  task: string;
  title: string;
  /** createdAt, ms since epoch. */
  at: number;
}

/** base64url(UTF-8 JSON) of the payload. */
export function encodeReviewPayload(p: ReviewPayload): string {
  const { v, kind, code, workspaceJson, python = '', who, className, task, title, at } = p;
  return encodeShareCode(JSON.stringify({ v, kind, code, workspaceJson, python, who, className, task, title, at }));
}

/** The payload back, with a strict shape check (extra keys dropped); null for anything else. */
export function decodeReviewPayload(s: string): ReviewPayload | null {
  const text = decodeShareCode(s);
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (o.kind !== 'code' && o.kind !== 'blocks' && o.kind !== 'python') return null;
  const strings = [o.code, o.workspaceJson, o.who, o.className, o.task, o.title];
  if (!strings.every((x) => typeof x === 'string')) return null;
  if (o.python !== undefined && typeof o.python !== 'string') return null;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
  return {
    v: 1,
    kind: o.kind,
    code: o.code as string,
    workspaceJson: o.workspaceJson as string,
    python: (o.python as string | undefined) ?? '',
    who: o.who as string,
    className: o.className as string,
    task: o.task as string,
    title: o.title as string,
    at: o.at,
  };
}

const RID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const REVIEW_HANDOFF_PREFIX = 'z1.review.';

function newReviewId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let id = '';
  for (const b of bytes) {
    if (b >= 248) continue; // rejection sampling: 248 = 4 × 62
    id += RID_ALPHABET[b % RID_ALPHABET.length];
    if (id.length === 16) break;
  }
  return id.length === 16 ? id : newReviewId();
}

/**
 * The review link: `./review.html#review=…` when the payload fits in LIMITS.reviewHashMax
 * characters, else `#rid=…` plus a localStorage handoff the dashboard stores when it renders the
 * link. Relative unless `base` is given.
 */
export function reviewLink(p: ReviewPayload, base?: string): { href: string; handoff: { key: string; value: string } | null } {
  const encoded = encodeReviewPayload(p);
  let hash: string;
  let handoff: { key: string; value: string } | null = null;
  if (encoded.length <= LIMITS.reviewHashMax) {
    hash = `#review=${encoded}`;
  } else {
    const rid = newReviewId();
    hash = `#rid=${rid}`;
    handoff = { key: REVIEW_HANDOFF_PREFIX + rid, value: encoded };
  }
  const href = base === undefined ? `./review.html${hash}` : new URL(`./review.html${hash}`, base).href;
  return { href, handoff };
}

/**
 * For the student's own history: '#code=…', '#blocks=…' or '#python=…' (the #code= link when a
 * Blocks hand-in's workspace is not a JSON object or a Python hand-in has no program; `fellBack`
 * says so).
 */
export function handinHash(content: { kind: HandinKind; code: string; workspaceJson: string; python?: string }): { hash: string; fellBack: boolean } {
  if (content.kind === 'blocks') {
    const workspace = parseWorkspaceJson(content.workspaceJson);
    if (workspace !== null) return { hash: `#blocks=${encodeShareBlocks(workspace)}`, fellBack: false };
    return { hash: `#code=${encodeShareCode(content.code)}`, fellBack: true };
  }
  if (content.kind === 'python') {
    if (content.python) return { hash: `#python=${encodeSharePython(content.python)}`, fellBack: false };
    return { hash: `#code=${encodeShareCode(content.code)}`, fellBack: true };
  }
  return { hash: `#code=${encodeShareCode(content.code)}`, fellBack: false };
}
