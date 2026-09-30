/**
 * Small pure helpers of the teacher dashboard (docs/CLASSROOM.md §1.3): time texts, file name
 * stamps, storage access that never throws, the per-class localStorage keys (§2.13) and the
 * Code / Blocks / Python label of a hand-in.
 */
import type { HandinKind } from '../classroom/model';

export const LAST_CLASS_KEY = 'z1.teacher.lastClass';
export const periodKey = (code: string): string => `z1.teacher.period.${code}`;
export const seenKey = (code: string): string => `z1.teacher.seen.${code}`;
export const prunedKey = (code: string): string => `z1.teacher.pruned.${code}`;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number): string => String(n).padStart(2, '0');

export function clockTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function shortDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "10:42" today, "Mon 10:42" within the last 7 days, else the date ("3 Sep 2026"). */
export function whenText(date: Date | null, now: Date): string {
  if (!date) return 'just now';
  if (sameDay(date, now)) return clockTime(date);
  if (now.getTime() - date.getTime() < 7 * 86_400_000 && date.getTime() <= now.getTime()) return `${DAYS[date.getDay()]} ${clockTime(date)}`;
  return shortDate(date);
}

/** The date and the time, for the detail panel ("Mon 10:42" in the last week, else "3 Sep 2026 10:42"). */
export function fullWhenText(date: Date | null, now: Date): string {
  if (!date) return 'just now';
  if (sameDay(date, now) || (now.getTime() - date.getTime() < 7 * 86_400_000 && date.getTime() <= now.getTime())) {
    return `${DAYS[date.getDay()]} ${clockTime(date)}`;
  }
  return `${shortDate(date)} ${clockTime(date)}`;
}

/** `yyyy-mm-dd-hhmm` of `date` in local time, for the file names of older versions. */
export function fileStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '') ?? '';
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Storage that never throws (private windows, blocked storage, sandboxes)
// ---------------------------------------------------------------------------

export function readItem(storage: Storage | null | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeItem(storage: Storage | null | undefined, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Storage blocked or full: the preference is simply not remembered.
  }
}

export function readJson<T>(storage: Storage | null | undefined, key: string, fallback: T): T {
  const text = readItem(storage, key);
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Every key of `storage` that starts with `prefix`. */
export function keysWithPrefix(storage: Storage | null | undefined, prefix: string): string[] {
  const keys: string[] = [];
  try {
    if (!storage) return keys;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // Blocked storage: nothing to list.
  }
  return keys;
}

// ---------------------------------------------------------------------------
// DOM helpers (static templates; every user string goes through textContent)
// ---------------------------------------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; title?: string; attrs?: Record<string, string> } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title !== undefined) node.title = props.title;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

/** The label of a hand-in kind (docs/PYTHON.md §8.5). */
export const KIND_LABEL: Readonly<Record<HandinKind, string>> = { code: 'Code', blocks: 'Blocks', python: 'Python' };

/** The kind label as a chip: `<span class="z1t-kind z1t-kind-python">Python</span>`. */
export function kindChip(kind: HandinKind): HTMLSpanElement {
  return el('span', { className: `z1t-kind z1t-kind-${kind}`, text: KIND_LABEL[kind] });
}

export function button(text: string, onClick: (ev: MouseEvent) => void, className = 'z1-btn'): HTMLButtonElement {
  const b = el('button', { className, text, attrs: { type: 'button' } });
  b.addEventListener('click', onClick);
  return b;
}
