/**
 * The review page (docs/CLASSROOM.md §1.4, §3.4, §4.14): a trusted banner (textContent only)
 * with Download .ino and Copy code, and the simulator in `<iframe sandbox="allow-scripts">`,
 * an opaque origin that cannot reach this site's storage or the dashboard. The payload comes from
 * `#review=` or from a `#rid=` localStorage handoff the dashboard wrote; the frame asks for it
 * with `z1-review-ready` and gets it with `z1-review`. Nothing runs until the teacher presses Run
 * inside the frame. Imports no Firebase and no classroom module.
 */
import { REVIEW_HANDOFF_PREFIX, decodeReviewPayload, type ReviewPayload } from '../share-link';
import { sketchFileName } from '../ui/sketch-file';

export const BROKEN_LINK_TEXT = 'This review link is broken. Open the hand-in again from the dashboard.';
export const EXPIRED_LINK_TEXT = 'This review link has expired. Open the hand-in again from the dashboard.';
export const SANDBOX_TEXT = 'The sketch runs in a safe sandbox. Changes here are not saved.';
export const FRAME_SRC = './index.html#review';
export const HANDOFF_MAX_AGE_MS = 86_400_000;
/** The handoff value is `<created ms>:<encoded payload>`; a bare payload (older dashboards) is accepted too. */
export const HANDOFF_SEPARATOR = ':';

export interface ReviewPageOptions {
  hash: string;
  storage?: Storage | null;
  download?(name: string, text: string): void;
  copyText?(text: string): Promise<void>;
  now?: () => number;
  /** The window the frame posts to (default: window). */
  target?: Window;
}

export interface ReviewPage {
  readonly payload: ReviewPayload | null;
  readonly iframe: HTMLIFrameElement | null;
  destroy(): void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "Mon 10:42" within a week, else "3 Sep 2026 10:42". */
export function whenText(at: number, nowMs: number): string {
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (nowMs - at < 7 * 86_400_000 && at <= nowMs + 60_000) return `${DAYS[d.getDay()]} ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${time}`;
}

function readStorage(storage: Storage | null | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Remove `z1.review.*` entries older than a day (their value starts with the creation time). */
export function dropOldHandoffs(storage: Storage | null | undefined, nowMs: number): void {
  try {
    if (!storage) return;
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(REVIEW_HANDOFF_PREFIX)) continue;
      const value = storage.getItem(key) ?? '';
      const m = /^(\d+):/.exec(value);
      if (m && nowMs - Number(m[1]) > HANDOFF_MAX_AGE_MS) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    // Blocked storage: nothing to clean.
  }
}

/** The payload named by the hash: `{ payload }`, or the error text to show. */
export function readPayload(hash: string, storage: Storage | null | undefined, nowMs: number): { payload: ReviewPayload } | { error: string } {
  const direct = /^#review=([A-Za-z0-9_-]+)$/.exec(hash);
  if (direct) {
    const payload = decodeReviewPayload(direct[1]);
    return payload ? { payload } : { error: BROKEN_LINK_TEXT };
  }
  const rid = /^#rid=([A-Za-z0-9]{16})$/.exec(hash);
  if (rid) {
    const raw = readStorage(storage, REVIEW_HANDOFF_PREFIX + rid[1]);
    if (raw === null) return { error: EXPIRED_LINK_TEXT };
    const m = /^(\d+):(.*)$/s.exec(raw);
    const encoded = m ? m[2] : raw;
    if (m && nowMs - Number(m[1]) > HANDOFF_MAX_AGE_MS) return { error: EXPIRED_LINK_TEXT };
    const payload = decodeReviewPayload(encoded);
    return payload ? { payload } : { error: BROKEN_LINK_TEXT };
  }
  return { error: BROKEN_LINK_TEXT };
}

function defaultDownload(name: string, text: string): void {
  const href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function text(tag: keyof HTMLElementTagNameMap, className: string, content = ''): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}

/** Build the review page into `root`. */
export function mountReview(root: HTMLElement, options: ReviewPageOptions): ReviewPage {
  const now = options.now ?? (() => Date.now());
  const target = options.target ?? window;
  const storage = options.storage === undefined ? safeLocalStorage() : options.storage;
  dropOldHandoffs(storage, now());
  const result = readPayload(options.hash, storage, now());

  root.replaceChildren();
  root.className = 'z1r-root';
  const banner = text('header', 'z1r-banner');
  root.append(banner);

  if ('error' in result) {
    banner.append(text('p', 'z1r-error', result.error));
    const back = document.createElement('a');
    back.href = './teacher.html';
    back.className = 'z1-btn';
    back.textContent = 'Open the dashboard';
    banner.append(back);
    document.title = 'ZERO1 review';
    return { payload: null, iframe: null, destroy: () => root.replaceChildren() };
  }

  const { payload } = result;
  document.title = `${payload.who} – ZERO1 review`;
  const who = text('p', 'z1r-who');
  const strong = document.createElement('strong');
  strong.textContent = payload.who;
  who.append(strong, "'s hand-in");
  for (const part of [payload.className, payload.task, payload.title].filter((p) => p !== '')) {
    who.append(` · ${part}`);
  }
  who.append(` · ${whenText(payload.at, now())} · ${payload.kind === 'blocks' ? 'Blocks' : 'Code'}`);
  const line = text('p', 'z1r-note', SANDBOX_TEXT);
  const actions = text('div', 'z1r-actions');
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'z1-btn';
  download.textContent = 'Download .ino';
  download.addEventListener('click', () => (options.download ?? defaultDownload)(sketchFileName(payload.who, new Date(payload.at)), payload.code));
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'z1-btn';
  copy.textContent = 'Copy code';
  const status = text('span', 'z1r-status');
  status.setAttribute('role', 'status');
  copy.addEventListener('click', () => {
    const copyText = options.copyText ?? ((t: string) => (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject(new Error('clipboard unavailable'))));
    copyText(payload.code).then(
      () => (status.textContent = 'Copied'),
      () => (status.textContent = 'Could not copy'),
    );
  });
  const dashboard = document.createElement('a');
  dashboard.href = './teacher.html';
  dashboard.className = 'z1-btn';
  dashboard.textContent = 'Dashboard';
  actions.append(download, copy, dashboard, status);
  banner.append(text('div', 'z1r-banner-text'), actions);
  banner.querySelector('.z1r-banner-text')!.append(who, line);

  // The sandbox: exactly allow-scripts (never allow-same-origin, §3.4).
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.src = FRAME_SRC;
  iframe.title = `Simulator running ${payload.who}'s hand-in`;
  iframe.className = 'z1r-frame';
  root.append(iframe);

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== 'null') return;
    const data = event.data as { type?: unknown } | null;
    if (!data || data.type !== 'z1-review-ready') return;
    // The payload is the student's own code, not a secret: targetOrigin '*' (an opaque origin has no other name).
    iframe.contentWindow?.postMessage({ type: 'z1-review', payload }, '*');
  };
  target.addEventListener('message', onMessage);

  return {
    payload,
    iframe,
    destroy() {
      target.removeEventListener('message', onMessage);
      root.replaceChildren();
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
