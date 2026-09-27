/**
 * Hand-ins on the dashboard (docs/CLASSROOM.md §1.3 T5-T7, §4.13): the decode cache (every
 * record is inflated once, right after it arrives, so Open / .ino / Copy never await), the
 * per-student Overview rows (grouped by nameKey), the review-page payload and the zip downloads.
 * Pure apart from decodeContent (CompressionStream) and Blob.
 */
import { decodeContent, type DecodeResult } from '../classroom/codec';
import { LIMITS, fullName, listName, type HandinRecord } from '../classroom/model';
import { reviewLink, type ReviewPayload } from '../share-link';
import { sketchFileName } from '../ui/sketch-file';
import { fileStamp } from './format';
import { makeZip, uniqueName, type ZipEntry } from './zip';

export type Decoded = DecodeResult;

/** Decoded content by hand-in id; a record is decoded once, the first time it is seen. */
export class DecodeCache {
  private readonly done = new Map<string, DecodeResult>();
  private readonly pending = new Map<string, Promise<DecodeResult>>();

  /** Start decoding `record` unless done; resolves with the result (memoised). */
  decode(record: HandinRecord): Promise<DecodeResult> {
    const known = this.done.get(record.id);
    if (known) return Promise.resolve(known);
    let promise = this.pending.get(record.id);
    if (!promise) {
      promise = decodeContent(record.content)
        .catch((): DecodeResult => ({ ok: false, problem: 'corrupt' }))
        .then((result) => {
          this.done.set(record.id, result);
          this.pending.delete(record.id);
          return result;
        });
      this.pending.set(record.id, promise);
    }
    return promise;
  }

  /** The result when decoded, else undefined. */
  get(id: string): DecodeResult | undefined {
    return this.done.get(id);
  }

  /** Decode every record of `items` that is not known yet; resolves when all are done. */
  decodeAll(items: readonly HandinRecord[]): Promise<void> {
    return Promise.all(items.map((r) => this.decode(r))).then(() => undefined);
  }
}

export const DECODE_PROBLEM_TEXT: Readonly<Record<'too_large' | 'unsupported' | 'corrupt', string>> = {
  too_large: 'This hand-in is larger than the simulator accepts. It was not made by the ZERO1 page.',
  unsupported: 'Your browser cannot unpack this hand-in. Update your browser.',
  corrupt: 'This hand-in is damaged.',
};

// ---------------------------------------------------------------------------
// Overview rows
// ---------------------------------------------------------------------------

export type RowStatus = 'new' | 'seen';
export interface OverviewRow {
  nameKey: string;
  /** "Khoury, Ali" (from the newest hand-in of the group). */
  name: string;
  status: RowStatus;
  /** The newest hand-in in the view. */
  latest: HandinRecord;
  versions: number;
  /** Distinct device uids in the view. */
  computers: number;
  /** Two different uids handed in within 60 minutes of each other. */
  closeDevices: boolean;
}

const ms = (r: HandinRecord): number => r.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;

/** Newest first; a record without a server time yet (pending write) comes first. */
export function newestFirst(a: HandinRecord, b: HandinRecord): number {
  return ms(b) - ms(a) || (a.id < b.id ? -1 : 1);
}

/** Plain code-unit order: the same on every device. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "Khoury, Ali" of a record. */
export function recordName(record: HandinRecord): string {
  return listName(record.firstName, record.lastName);
}

/**
 * One row per student (nameKey) of the loaded view, sorted by name. `seen` maps nameKey →
 * createdAt ms of the newest hand-in the teacher has looked at. A hand-in without createdAt
 * (just written) counts as new.
 */
export function overviewRows(items: readonly HandinRecord[], seen: Readonly<Record<string, number>>): OverviewRow[] {
  const byStudent = new Map<string, HandinRecord[]>();
  for (const item of items) {
    const list = byStudent.get(item.nameKey);
    if (list) list.push(item);
    else byStudent.set(item.nameKey, [item]);
  }
  const rows: OverviewRow[] = [];
  for (const [nameKey, group] of byStudent) {
    const list = group.sort(newestFirst);
    const latest = list[0];
    const uids = new Set(list.map((r) => r.uid));
    let closeDevices = false;
    for (let i = 0; i < list.length && !closeDevices; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.uid !== b.uid && a.createdAt && b.createdAt && Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) <= 60 * 60_000) {
          closeDevices = true;
          break;
        }
      }
    }
    const status: RowStatus = latest.createdAt === null || latest.createdAt.getTime() > (seen[nameKey] ?? 0) ? 'new' : 'seen';
    rows.push({ nameKey, name: recordName(latest), status, latest, versions: list.length, computers: uids.size, closeDevices });
  }
  return rows.sort((a, b) => compareText(a.name.toLowerCase(), b.name.toLowerCase()) || compareText(a.nameKey, b.nameKey));
}

/** Sort rows by name (default) or by the last hand-in, newest first. */
export function sortRows(rows: OverviewRow[], by: 'name' | 'last'): OverviewRow[] {
  const sorted = [...rows];
  if (by === 'last') sorted.sort((a, b) => ms(b.latest) - ms(a.latest) || compareText(a.name, b.name));
  return sorted;
}

// ---------------------------------------------------------------------------
// Review page payload and file names
// ---------------------------------------------------------------------------

export function reviewPayloadFor(record: HandinRecord, decoded: { code: string; workspaceJson: string }, className: string): ReviewPayload {
  return {
    v: 1,
    kind: record.kind,
    code: decoded.code,
    workspaceJson: record.kind === 'blocks' ? decoded.workspaceJson : '',
    who: fullName(record.firstName, record.lastName),
    className,
    task: '',
    title: '',
    at: record.createdAt?.getTime() ?? Date.now(),
  };
}

export function reviewLinkFor(record: HandinRecord, decoded: { code: string; workspaceJson: string }, className: string): ReturnType<typeof reviewLink> {
  return reviewLink(reviewPayloadFor(record, decoded, className));
}

/** The .ino name of a hand-in: sketchFileName("First Last", createdAt). */
export function inoName(record: HandinRecord, now: Date): string {
  return sketchFileName(fullName(record.firstName, record.lastName), record.createdAt ?? now);
}

/** The file stem of a student: "Ali Khoury" → "Ali_Khoury"; 'student' when empty. */
export function fileStem(record: HandinRecord): string {
  const stem = fullName(record.firstName, record.lastName)
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return stem || 'student';
}

/**
 * The entries of a zip download: `<First_Last>.ino` (and `<First_Last>.blocks.json`) for the
 * newest hand-in of each student, `<First_Last>-<yyyy-mm-dd-hhmm>.ino` for older versions;
 * names made unique. Records that could not be decoded are left out.
 */
export function zipEntries(items: readonly HandinRecord[], cache: DecodeCache, now: Date): ZipEntry[] {
  const taken = new Set<string>();
  const seenStudent = new Set<string>();
  const entries: ZipEntry[] = [];
  for (const record of [...items].sort(newestFirst)) {
    const decoded = cache.get(record.id);
    if (!decoded?.ok) continue;
    const base = fileStem(record);
    const date = record.createdAt ?? now;
    const latest = !seenStudent.has(record.nameKey);
    seenStudent.add(record.nameKey);
    const stem = latest ? base : `${base}-${fileStamp(date)}`;
    entries.push({ name: uniqueName(`${stem}.ino`, taken), data: decoded.code, date });
    if (record.kind === 'blocks' && decoded.workspaceJson !== '') {
      entries.push({ name: uniqueName(`${stem}.blocks.json`, taken), data: decoded.workspaceJson, date });
    }
  }
  return entries;
}

export function zipOf(items: readonly HandinRecord[], cache: DecodeCache, now: Date): Blob {
  return makeZip(zipEntries(items, cache, now));
}

/** The newest hand-in of each student in `items`. */
export function latestOfEach(items: readonly HandinRecord[]): HandinRecord[] {
  const seen = new Set<string>();
  const out: HandinRecord[] = [];
  for (const record of [...items].sort(newestFirst)) {
    if (seen.has(record.nameKey)) continue;
    seen.add(record.nameKey);
    out.push(record);
  }
  return out;
}

/** The size limit of a #review= link, re-exported for the tests. */
export const REVIEW_HASH_MAX = LIMITS.reviewHashMax;
