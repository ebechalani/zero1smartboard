// @vitest-environment happy-dom
/**
 * Teacher dashboard tests (docs/CLASSROOM.md §7.3, C) with the in-memory FakeTeacherApi:
 * not configured, sign-in (synchronous signIn, the error texts), the class list, Create class,
 * the class page header, the Overview (rows grouped by name, New / Seen, live inserts, periods,
 * Open links, .ino, zips), the detail panel, All hand-ins, retention, Settings and Delete class,
 * Delete my data, sign-out, the error banner and the parked listeners. Plus the textContent matrix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../src/classroom/model';
import { TEACHER_ERROR_TEXT } from '../src/classroom/errors';
import { REVIEW_HANDOFF_PREFIX, decodeReviewPayload } from '../src/share-link';
import { OVERLAY_HELP_TEXT } from '../src/teacher/class-page';
import { WAITING_TEXT } from '../src/teacher/context';
import { CREATE_HELP, EMPTY_CLASSES_TEXT, NOT_CONFIGURED_TEXT, mountDashboard, type Dashboard } from '../src/teacher/dashboard';
import { LAST_CLASS_KEY, keysWithPrefix, periodKey, prunedKey, seenKey } from '../src/teacher/format';
import { DECODE_PROBLEM_TEXT } from '../src/teacher/handins';
import { NO_HANDINS_TEXT } from '../src/teacher/overview';
import { PARK_MS } from '../src/teacher/session';
import { memoryStorage } from './classroom-fakes';
import { TEACHER, createFakeTeacherApi, fakeError, makeClass, makeHandin, makeMember, type FakeTeacherApi } from './fakes/fake-teacher-api';

/** Sat 26 Sep 2026, 14:00 local time. */
const NOW = new Date(2026, 8, 26, 14, 0, 0);
let clock = NOW.getTime();
const now = () => new Date(clock);
const at = (h: number, m: number, dayOffset = 0) => new Date(2026, 8, 26 + dayOffset, h, m);
const sara = { firstName: 'Sara', lastName: 'Mansour' };
const omar = { firstName: 'Omar', lastName: 'Haddad' };

let api: FakeTeacherApi;
let storage: Storage;
let tabStorage: Storage;
let root: HTMLElement;
let dashboard: Dashboard | null = null;
let downloads: { name: string; data: string | Blob }[];
let copied: string[];
let confirmAnswer = true;
let confirms: string[];

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
    else await new Promise((r) => setTimeout(r, 0));
  }
}

function mount(options: { configured?: boolean; classes?: ReturnType<typeof makeClass>[]; loadApi?: () => Promise<FakeTeacherApi> } = {}): void {
  api = createFakeTeacherApi({ now: () => clock, classes: options.classes });
  dashboard = mountDashboard(root, {
    configured: options.configured ?? true,
    loadApi: options.loadApi ?? (() => Promise.resolve(api)),
    download: (name, data) => void downloads.push({ name, data }),
    copyText: async (text) => void copied.push(text),
    confirm: (text) => {
      confirms.push(text);
      return confirmAnswer;
    },
    now,
    storage,
    tabStorage,
  });
}

/** Mount, load the API, resolve ready and sign in. */
async function signedIn(classes: ReturnType<typeof makeClass>[] = []): Promise<void> {
  mount({ classes });
  await flush();
  api.readyDeferred.resolve();
  await flush();
  api.emitUser(TEACHER);
  await flush();
}

async function openClass(code = 'BKT4M9'): Promise<void> {
  root.querySelector<HTMLButtonElement>(`.z1t-class-card[data-code="${code}"]`)!.click();
  await flush();
}

const q = <T extends Element = HTMLElement>(sel: string): T => {
  const node = root.querySelector<T>(sel);
  if (!node) throw new Error(`missing ${sel}`);
  return node;
};
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...root.querySelectorAll<T>(sel)];
const buttonWithText = (text: string, within: ParentNode = root): HTMLButtonElement => {
  const b = [...within.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
};
const text = () => root.textContent ?? '';
const tab = (name: string) => buttonWithText(name, q('.z1t-tabs')).click();
const row = (name: string) => qa('.z1t-rows tbody tr').find((r) => r.querySelector('.z1t-name')!.textContent === name)!;
/** The distinct file names inside a store-only zip (each name appears in the local header and the central directory). */
const zipNames = async (blob: Blob) => [...new Set([...new TextDecoder().decode(await blob.arrayBuffer()).matchAll(/[A-Za-z0-9_.-]+\.(?:ino|json)/g)].map((m) => m[0]))];

beforeEach(() => {
  clock = NOW.getTime();
  storage = memoryStorage();
  tabStorage = memoryStorage();
  downloads = [];
  copied = [];
  confirms = [];
  confirmAnswer = true;
  root = document.createElement('div');
  document.body.appendChild(root);
  // happy-dom would navigate (fetch) on a link click: the Open links are checked by href.
  root.addEventListener('click', (ev) => (ev.target as Element).closest('a') && ev.preventDefault());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  dashboard?.destroy();
  dashboard = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe('not configured', () => {
  it('shows the card and never calls loadApi', async () => {
    const loadApi = vi.fn();
    api = createFakeTeacherApi();
    dashboard = mountDashboard(root, { configured: false, loadApi, storage, tabStorage, now });
    await flush();
    expect(loadApi).not.toHaveBeenCalled();
    expect(text()).toContain(NOT_CONFIGURED_TEXT);
    expect(text()).toContain('paste its web config into src/firebase-config.ts');
    expect(q<HTMLAnchorElement>('a.z1-btn').getAttribute('href')).toBe('./');
  });
});

describe('signed out (T1)', () => {
  it('loads the API at page load, keeps the button disabled until ready, then calls signIn synchronously in the click', async () => {
    mount();
    await flush();
    expect(api.callsTo('onUser')).toHaveLength(1);
    const button = q<HTMLButtonElement>('.z1t-signin');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Loading…');
    expect(text()).toContain('Create a class, give your students the class code, and see their work here.');
    expect(text()).toContain('On a shared computer, always sign out.');
    api.readyDeferred.resolve();
    await flush();
    const ready = q<HTMLButtonElement>('.z1t-signin');
    expect(ready.disabled).toBe(false);
    expect(ready.textContent).toBe('Sign in with Google');
    ready.click();
    // No microtask has run yet: signIn was called synchronously inside the click.
    expect(api.callsTo('signIn')).toHaveLength(1);
    expect(ready.disabled).toBe(true);
    expect(ready.textContent).toBe('Signing in…');
    await flush();
    expect(text()).toContain('Mr. B');
    expect(text()).toContain('b@school.edu');
    expect(api.callsTo('watchClasses')).toHaveLength(1);
  });

  it('shows the popup_blocked text and stays silent on popup_closed', async () => {
    mount();
    await flush();
    api.readyDeferred.resolve();
    await flush();
    api.signInResult = fakeError('popup_blocked');
    q<HTMLButtonElement>('.z1t-signin').click();
    await flush();
    expect(q('[data-role="signin-error"]').textContent).toBe(TEACHER_ERROR_TEXT.popup_blocked);
    expect(q<HTMLButtonElement>('.z1t-signin').disabled).toBe(false);
    api.signInResult = fakeError('popup_closed');
    q<HTMLButtonElement>('.z1t-signin').click();
    await flush();
    expect(q('[data-role="signin-error"]').textContent).toBe('');
    expect(q<HTMLButtonElement>('.z1t-signin').disabled).toBe(false);
    expect(q('.z1t-banner').hidden).toBe(true);
  });

  it('reports a failed API load in the banner', async () => {
    mount({ loadApi: () => Promise.reject(fakeError('load_failed')) });
    await flush();
    expect(q('.z1t-banner').textContent).toContain(TEACHER_ERROR_TEXT.load_failed);
  });
});

// ---------------------------------------------------------------------------
describe('class list (T2)', () => {
  it('shows the empty state', async () => {
    await signedIn();
    expect(text()).toContain(EMPTY_CLASSES_TEXT);
  });

  it('shows cards newest first with the code, the hand-ins badge and the stopped section', async () => {
    await signedIn([
      makeClass({ code: 'BKT4M9', name: '8B Robotics', createdAt: at(9, 0, -10) }),
      makeClass({ code: 'CDF3G7', name: '7A Robotics', createdAt: at(9, 0, -1) }),
      makeClass({ code: 'HJK4L9', name: 'Last year', createdAt: at(9, 0, -300), handinsOpen: false }),
    ]);
    const cards = qa('.z1t-class-card');
    expect(cards.map((c) => c.getAttribute('data-code'))).toEqual(['CDF3G7', 'BKT4M9', 'HJK4L9']);
    expect(cards[1].textContent).toContain('BKT-4M9');
    expect(cards[1].textContent).toContain('Hand-ins open');
    expect(cards[2].textContent).toContain('Hand-ins stopped');
    expect(text()).toContain('Hand-ins stopped');
  });

  it('re-opens the last opened class only when it is one of this teacher\'s classes', async () => {
    storage.setItem(LAST_CLASS_KEY, 'BKT4M9');
    await signedIn([makeClass()]);
    expect(q('.z1t-class-head').textContent).toContain('8B Robotics');
    expect(q<HTMLSelectElement>('#z1t-switcher').value).toBe('BKT4M9');
    // Another teacher's class code left in this browser's storage: the list shows, the key is dropped.
    dashboard!.destroy();
    root = document.createElement('div');
    document.body.appendChild(root);
    storage.setItem(LAST_CLASS_KEY, 'ZZZ7Z9');
    await signedIn([makeClass()]);
    expect(root.querySelector('.z1t-class-head')).toBeNull();
    expect(qa('.z1t-class-card')).toHaveLength(1);
    expect(storage.getItem(LAST_CLASS_KEY)).toBeNull();
    expect(api.callsTo('watchClass')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('create class (T3)', () => {
  async function openDialog(): Promise<HTMLDialogElement> {
    buttonWithText('+ New class').click();
    await flush();
    return q<HTMLDialogElement>('dialog.z1t-create');
  }
  const setValue = (el: HTMLInputElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('asks for the class name only, and opens the class with the formatted code banner', async () => {
    await signedIn();
    const dialog = await openDialog();
    const create = buttonWithText('Create', dialog);
    expect(create.disabled).toBe(true);
    expect(dialog.textContent).toContain(CREATE_HELP);
    expect(dialog.querySelectorAll('input, textarea, select')).toHaveLength(1);
    setValue(dialog.querySelector<HTMLInputElement>('#z1t-new-name')!, '  8B  Robotics ');
    expect(create.disabled).toBe(false);
    create.click();
    await flush();
    expect(api.callsTo('createClass')[0]).toEqual([{ name: '8B Robotics' }]);
    expect(root.querySelector('dialog.z1t-create')).toBeNull();
    const code = [...api.classes.keys()][0];
    expect(q('.z1t-created').textContent).toBe(`Class created. Give your students the code ${code.slice(0, 3)}-${code.slice(3)} or the class link.`);
    expect(q('.z1t-code').textContent).toBe(`${code.slice(0, 3)}-${code.slice(3)}`);
    expect(q('.z1t-overview').textContent).toContain(NO_HANDINS_TEXT);
  });

  it('shows the code_collision text inside the dialog', async () => {
    await signedIn();
    const dialog = await openDialog();
    setValue(dialog.querySelector<HTMLInputElement>('#z1t-new-name')!, 'X');
    api.failNext('createClass', fakeError('code_collision'));
    buttonWithText('Create', dialog).click();
    await flush();
    expect(dialog.querySelector('.z1t-error')!.textContent).toBe(TEACHER_ERROR_TEXT.code_collision);
  });
});

// ---------------------------------------------------------------------------
describe('class page header (T4, T10)', () => {
  it('copies the code and the class link, and shows the overlay with the count until Esc', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1' }), makeHandin({ id: 'h2', ...sara })]);
    await openClass();
    buttonWithText('Copy code').click();
    buttonWithText('Copy class link').click();
    await flush();
    expect(copied[0]).toBe('BKT-4M9');
    expect(copied[1]).toMatch(/#class=BKT4M9$/);
    buttonWithText('Show to the class').click();
    await flush();
    const overlay = q('.z1t-overlay');
    expect(overlay.hidden).toBe(false);
    expect(api.listenerCounts().members).toBe(0); // no roster: the overlay needs no members
    expect(overlay.querySelector('.z1t-overlay-code')!.textContent).toBe('BKT-4M9');
    expect(overlay.querySelector('.z1t-overlay-code')!.getAttribute('aria-label')).toBe('B K T 4 M 9');
    expect(overlay.querySelector('.z1t-overlay-link')!.textContent).toMatch(/^[^/]+\/.*#class=BKT4M9$/);
    expect(overlay.textContent).toContain(OVERLAY_HELP_TEXT.replace('Press', 'press'));
    expect(overlay.textContent).toContain('Hand-ins open · 2 students handed in today');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(overlay.hidden).toBe(true);
  });

  it('the hand-ins switch writes through updateClass and shows the stopped text', async () => {
    await signedIn([makeClass()]);
    await openClass();
    expect(q('.z1t-class-head').textContent).toContain('Anyone with the code can hand in under their name.');
    const sw = q<HTMLInputElement>('.z1t-class-head input[aria-label="Accepting hand-ins"]');
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    await flush();
    expect(api.callsTo('updateClass')[0]).toEqual(['BKT4M9', { handinsOpen: false }]);
    expect(q('.z1t-class-head').textContent).toContain('This class no longer accepts hand-ins');
    expect(q<HTMLInputElement>('.z1t-class-head input[aria-label="Accepting hand-ins"]').checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Overview (T5)', () => {
  it('has one row per student name, "Last name, First name", sorted, and counts the students', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [
      makeHandin({ id: 'h1', createdAt: at(10, 42) }),
      makeHandin({ id: 'h2', ...sara, createdAt: at(10, 50) }),
      makeHandin({ id: 'h3', ...sara, uid: 'device-bbbb', createdAt: at(8, 0) }),
      makeHandin({ id: 'h4', firstName: 'ali', lastName: 'khoury', uid: 'device-cccc', createdAt: at(10, 0) }), // the same student, typed in lower case
    ]);
    await openClass();
    const rows = qa('.z1t-rows tbody tr');
    expect(rows.map((r) => r.querySelector('.z1t-name')!.textContent)).toEqual(['Khoury, Ali', 'Mansour, Sara']);
    expect(rows[0].getAttribute('data-student')).toBe('ali khoury');
    expect(rows[0].textContent).toContain('New');
    expect(rows[0].textContent).toContain('10:42');
    expect(rows[0].textContent).toContain('Code');
    expect(rows[0].querySelector('.z1t-num')!.textContent).toBe('2');
    expect(rows[0].textContent).toContain('2 computers within an hour'); // 10:00 and 10:42 from two devices
    expect(rows[1].textContent).toContain('2 computers');
    expect(rows[1].querySelector('.z1t-badge-warn')).toBeNull();
    expect(q('.z1t-headline').textContent).toBe('2 students handed in today');
    const sort = q<HTMLSelectElement>('select[aria-label="Sort by"]');
    sort.value = 'last';
    sort.dispatchEvent(new Event('change'));
    expect(qa('.z1t-rows tbody tr').map((r) => r.querySelector('.z1t-name')!.textContent)).toEqual(['Mansour, Sara', 'Khoury, Ali']);
  });

  it('keeps New / Seen in localStorage by name and marks seen on Open, .ino and the detail', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [
      makeHandin({ id: 'h1', createdAt: at(10, 42) }),
      makeHandin({ id: 'h2', ...sara, createdAt: at(10, 50) }),
      makeHandin({ id: 'h3', ...omar, createdAt: at(10, 55) }),
    ]);
    storage.setItem(seenKey('BKT4M9'), JSON.stringify({ 'omar haddad': at(11, 0).getTime() }));
    await openClass();
    expect(row('Haddad, Omar').textContent).toContain('Seen');
    expect(row('Khoury, Ali').textContent).toContain('New');
    row('Khoury, Ali').querySelector<HTMLButtonElement>('.z1t-actions button')!.click(); // .ino
    await flush();
    expect(downloads).toEqual([{ name: 'zero1_Ali_Khoury_0926_104200.ino', data: 'void setup() {}\nvoid loop() {}\n' }]);
    expect(row('Khoury, Ali').textContent).toContain('Seen');
    expect(JSON.parse(storage.getItem(seenKey('BKT4M9'))!)).toMatchObject({ 'ali khoury': at(10, 42).getTime() });
    row('Mansour, Sara').querySelector<HTMLAnchorElement>('a.z1t-open')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(row('Mansour, Sara').textContent).toContain('Seen');
    // A newer hand-in makes it New again.
    api.handins.get('BKT4M9')!.push(makeHandin({ id: 'h4', ...sara, createdAt: at(11, 30) }));
    api.emitToday('BKT4M9', { added: ['h4'] });
    await flush();
    expect(row('Mansour, Sara').textContent).toContain('New');
    expect(row('Mansour, Sara').querySelector('.z1t-num')!.textContent).toBe('2');
    expect(q('.z1t-sr-only').textContent).toBe('1 new hand-in');
  });

  it('announces live inserts once, politely', async () => {
    await signedIn([makeClass()]);
    await openClass();
    expect(q('.z1t-sr-only').textContent).toBe('');
    expect(q('.z1t-headline').textContent).toBe('0 students handed in today');
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1' }), makeHandin({ id: 'h2', ...sara })]);
    api.emitToday('BKT4M9', { added: ['h1', 'h2'] });
    await flush();
    expect(q('.z1t-sr-only').textContent).toBe('2 new hand-ins');
    expect(qa('.z1t-rows tbody tr.is-fresh')).toHaveLength(2);
  });

  it('switches from the live Today view to a one-off 7-day view, remembered per class', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'old', createdAt: at(10, 0, -3) })]);
    await openClass();
    expect(api.listenerCounts().today).toBe(1);
    expect(root.querySelector('button.z1-btn[hidden]')).not.toBeNull();
    const period = q<HTMLSelectElement>('#z1t-period');
    period.value = '7';
    period.dispatchEvent(new Event('change'));
    await flush();
    expect(api.listenerCounts().today).toBe(0);
    expect(api.callsTo('loadHandins')).toHaveLength(1);
    expect((api.callsTo('loadHandins')[0][1] as Date).getTime()).toBe(clock - 7 * 86_400_000);
    expect(storage.getItem(periodKey('BKT4M9'))).toBe('7');
    expect(q('.z1t-headline').textContent).toBe('1 student handed in in the last 7 days');
    expect(qa('.z1t-rows tbody tr')[0].textContent).toContain('Wed 10:00');
    buttonWithText('Refresh').click();
    await flush();
    expect(api.callsTo('loadHandins')).toHaveLength(2);
    // Remembered: a fresh mount of the class starts in the 7-day view.
    dashboard!.destroy();
    root = document.createElement('div');
    document.body.appendChild(root);
    await signedIn([makeClass()]); // the last class is re-opened
    expect(q<HTMLSelectElement>('#z1t-period').value).toBe('7');
    expect(api.listenerCounts().today).toBe(0);
  });

  it('Open is a real link to review.html; a large payload uses ONE #rid= handoff, reused across renders', async () => {
    await signedIn([makeClass()]);
    const big = 'x'.repeat(LIMITS.reviewHashMax);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', createdAt: at(10, 42), code: 'void setup() {}\n' }), makeHandin({ id: 'h2', ...sara, code: big })]);
    await openClass();
    const links = qa<HTMLAnchorElement>('.z1t-rows a.z1t-open');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0].getAttribute('href')).toMatch(/^\.\/review\.html#review=/);
    expect(links[0].hasAttribute('aria-disabled')).toBe(false);
    const payload = decodeReviewPayload(links[0].getAttribute('href')!.replace('./review.html#review=', ''))!;
    expect(payload).toMatchObject({ v: 1, kind: 'code', who: 'Ali Khoury', className: '8B Robotics', task: '', title: '', code: 'void setup() {}\n', at: at(10, 42).getTime() });
    const rid = links[1].getAttribute('href')!;
    expect(rid).toMatch(/^\.\/review\.html#rid=[A-Za-z0-9]{16}$/);
    const key = REVIEW_HANDOFF_PREFIX + rid.slice('./review.html#rid='.length);
    const stored = storage.getItem(key)!;
    expect(stored).toMatch(new RegExp(`^${clock}:`));
    expect(decodeReviewPayload(stored.slice(stored.indexOf(':') + 1))!.code).toBe(big);
    // Re-renders (a live update, the detail panel, the feed) reuse the same rid: one 60 KB entry, not one per render.
    api.emitToday('BKT4M9', { modified: ['h1'] });
    await flush();
    row('Mansour, Sara').querySelector<HTMLButtonElement>('.z1t-name button')!.click();
    await flush();
    tab('All hand-ins');
    await flush();
    expect(qa<HTMLAnchorElement>('a.z1t-open').filter((a) => a.getAttribute('href')!.includes('#rid=')).every((a) => a.getAttribute('href') === rid)).toBe(true);
    expect(keysWithPrefix(storage, REVIEW_HANDOFF_PREFIX)).toEqual([key]);
    // Handoffs are cleared on sign-out.
    buttonWithText('Sign out').click();
    await flush();
    expect(storage.getItem(key)).toBeNull();
  });

  it('.ino is enabled after decode and downloads with no await between the click and the download', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', createdAt: at(10, 42), code: 'void loop() {}\n' })]);
    await openClass();
    const button = q<HTMLButtonElement>('.z1t-rows .z1t-actions button');
    expect(button.disabled).toBe(false);
    button.click();
    expect(downloads).toEqual([{ name: 'zero1_Ali_Khoury_0926_104200.ino', data: 'void loop() {}\n' }]);
  });

  it('downloads the latest of each student and all shown as zips named after the students', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [
      makeHandin({ id: 'h1', createdAt: at(10, 0) }),
      makeHandin({ id: 'h2', createdAt: at(11, 0), kind: 'blocks', workspaceJson: '{"blocks":{}}' }),
      makeHandin({ id: 'h3', ...sara, createdAt: at(10, 30) }),
    ]);
    await openClass();
    buttonWithText('Download latest of each student (.zip)').click();
    buttonWithText('Download all shown (.zip)').click();
    expect(downloads.map((d) => d.name)).toEqual(['8B_Robotics-latest-2026-09-26.zip', '8B_Robotics-all-2026-09-26.zip']);
    expect(downloads[0].data).toBeInstanceOf(Blob);
    expect(await zipNames(downloads[0].data as Blob)).toEqual(['Ali_Khoury.ino', 'Ali_Khoury.blocks.json', 'Sara_Mansour.ino']);
    expect(new Set(await zipNames(downloads[1].data as Blob))).toEqual(new Set(['Ali_Khoury.ino', 'Ali_Khoury.blocks.json', 'Ali_Khoury-2026-09-26-1000.ino', 'Sara_Mansour.ino']));
  });

  it('keyboard: arrows move between rows and Enter opens the detail', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1' }), makeHandin({ id: 'h2', ...sara })]);
    await openClass();
    const rows = qa('.z1t-rows tbody tr');
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(qa('.z1t-rows tbody tr')[1].tabIndex).toBe(0);
    qa('.z1t-rows tbody tr')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(q('.z1t-detail').hidden).toBe(false);
    expect(q('.z1t-detail h3').textContent).toBe('Ali Khoury');
  });
});

// ---------------------------------------------------------------------------
describe('detail (T6)', () => {
  async function openDetail(): Promise<HTMLElement> {
    await openClass();
    q<HTMLButtonElement>('.z1t-rows .z1t-name button').click();
    await flush();
    return q<HTMLElement>('.z1t-detail');
  }

  it('lists versions newest first with the code preview and the computer, and loads older ones by name', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [
      makeHandin({ id: 'h1', createdAt: at(10, 0), code: 'int a;' }),
      makeHandin({ id: 'h2', createdAt: at(11, 0), kind: 'blocks', workspaceJson: '{"blocks":{}}', code: 'int b;' }),
    ]);
    api.members.set('BKT4M9', [makeMember({ uid: 'device-aaaa', device: 'Chrome · Windows' })]);
    const detail = await openDetail();
    const versions = [...detail.querySelectorAll('.z1t-versions > .z1t-version')];
    expect(versions.map((v) => v.getAttribute('data-handin'))).toEqual(['h2', 'h1']);
    expect(versions[0].textContent).toContain('Sat 11:00');
    expect(versions[0].textContent).toContain('Blocks');
    expect(versions[0].textContent).toContain('The Arduino sketch made from the blocks:');
    expect(versions[0].querySelector('.z1t-code')!.textContent).toBe('int b;');
    expect(versions[0].textContent).toContain('Computer AAAA');
    // Older versions.
    api.today = () => api.handins.get('BKT4M9')!.filter((r) => r.id !== 'h0');
    api.handins.get('BKT4M9')!.push(makeHandin({ id: 'h0', createdAt: at(9, 0, -2), code: 'int z;' }));
    buttonWithText('Load older versions', detail).click();
    await flush();
    expect(api.callsTo('studentHandins')[0]).toEqual(['BKT4M9', 'ali khoury', { before: at(10, 0) }]);
    const older = q('.z1t-older');
    expect(older.querySelector('summary')!.textContent).toBe('1 earlier version');
    expect(older.querySelector('.z1t-version')!.getAttribute('data-handin')).toBe('h0');
  });

  it('Remove the computer and Delete confirm first; the blocks zip carries the name', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', kind: 'blocks', workspaceJson: '{"blocks":{}}', createdAt: at(10, 42) })]);
    const detail = await openDetail();
    expect(detail.querySelector('select')).toBeNull(); // no Move to…
    buttonWithText('Download .ino + blocks (.zip)', detail).click();
    expect(downloads[0].name).toBe('zero1_Ali_Khoury_0926_104200.zip');
    expect(new Set(await zipNames(downloads[0].data as Blob))).toEqual(new Set(['zero1_Ali_Khoury_0926_104200.ino', 'Ali_Khoury.blocks.json']));
    confirmAnswer = false;
    buttonWithText('Remove the computer that sent this', detail).click();
    expect(api.callsTo('removeDevice')).toHaveLength(0);
    confirmAnswer = true;
    buttonWithText('Remove the computer that sent this', detail).click();
    await flush();
    expect(api.callsTo('removeDevice')[0]).toEqual(['BKT4M9', 'device-aaaa']);
    buttonWithText('Delete', q('.z1t-detail')).click();
    await flush();
    expect(confirms.at(-1)).toBe('Delete this hand-in? This cannot be undone.');
    expect(api.callsTo('deleteHandin')[0]).toEqual(['BKT4M9', 'h1']);
    expect(api.handins.get('BKT4M9')).toEqual([]);
    expect(q('.z1t-overview').textContent).toContain(NO_HANDINS_TEXT);
  });

  it('copies the code, falling back to a selection hint', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', code: 'int c;' })]);
    const detail = await openDetail();
    buttonWithText('Copy code', detail).click();
    await flush();
    expect(copied).toEqual(['int c;']);
    expect(detail.textContent).toContain('Copied');
  });

  it('shows the decode problem texts and disables Open, .ino and Copy', async () => {
    await signedIn([makeClass()]);
    const gzipButNotBytes = makeHandin({ id: 'bad' });
    gzipButNotBytes.content = { enc: 'gzip', code: 'not bytes', workspace: '' };
    const tooLarge = makeHandin({ id: 'big', ...sara, code: 'x'.repeat(LIMITS.codeDecodeCap + 1) });
    api.handins.set('BKT4M9', [gzipButNotBytes, tooLarge]);
    await openClass();
    const rows = qa('.z1t-rows tbody tr');
    expect(rows[0].querySelector('a.z1t-open')!.getAttribute('aria-disabled')).toBe('true');
    expect(rows[0].querySelector<HTMLButtonElement>('.z1t-actions button')!.disabled).toBe(true);
    rows[0].querySelector<HTMLButtonElement>('.z1t-name button')!.click();
    expect(q('.z1t-detail').textContent).toContain(DECODE_PROBLEM_TEXT.corrupt);
    expect(buttonWithText('Copy code', q('.z1t-detail')).disabled).toBe(true);
    rows[1].querySelector<HTMLButtonElement>('.z1t-name button')!.click();
    expect(q('.z1t-detail').textContent).toContain(DECODE_PROBLEM_TEXT.too_large);
  });
});

// ---------------------------------------------------------------------------
describe('All hand-ins (T7)', () => {
  it('lists the feed newest first with the names and filters by student', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', createdAt: at(10, 0) }), makeHandin({ id: 'h2', createdAt: at(11, 0), ...sara, kind: 'blocks' })]);
    await openClass();
    tab('All hand-ins');
    const items = qa('.z1t-feed-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Mansour, Sara');
    expect(items[0].textContent).toContain('Blocks');
    expect(items[1].textContent).toContain('Khoury, Ali');
    const student = q<HTMLSelectElement>('#z1t-feed-student');
    expect([...student.options].map((o) => o.textContent)).toEqual(['All students', 'Khoury, Ali', 'Mansour, Sara']);
    student.value = 'ali khoury';
    student.dispatchEvent(new Event('change'));
    expect(qa('.z1t-feed-item')).toHaveLength(1);
    qa<HTMLButtonElement>('.z1t-feed-row')[0].click();
    expect(q('.z1t-feed .z1t-detail').hidden).toBe(false);
    expect(q('.z1t-feed .z1t-detail .z1t-version.is-focused').getAttribute('data-handin')).toBe('h1');
  });
});

// ---------------------------------------------------------------------------
describe('retention (§2.11)', () => {
  it('warns a week ahead with a complete (paged, uncapped) download, prunes with a toast, once per tab', async () => {
    await signedIn([makeClass({ keepWeeks: 10 })]);
    api.countBefore = 12;
    api.pruneCount = 3;
    // 130 old hand-ins (more than one page of 100) and one new one.
    api.handins.set('BKT4M9', [
      ...Array.from({ length: 130 }, (_, i) => makeHandin({ id: `old${i}`, createdAt: new Date(at(10, 0, -80).getTime() + i * 1000) })),
      makeHandin({ id: 'new', createdAt: at(10, 0) }),
    ]);
    api.today = () => api.handins.get('BKT4M9')!.filter((r) => r.id === 'new');
    await openClass();
    const cutoff = clock - 10 * 7 * 86_400_000;
    expect((api.callsTo('countHandinsBefore')[0][1] as Date).getTime()).toBe(cutoff + 7 * 86_400_000);
    expect((api.callsTo('pruneHandins')[0][1] as Date).getTime()).toBe(cutoff);
    expect(q('.z1t-notice').textContent).toContain('12 hand-ins are older than 9 weeks and will be deleted within a week.');
    expect(q('.z1-toast').textContent).toBe('Deleted 3 hand-ins older than 10 weeks.');
    expect(tabStorage.getItem(prunedKey('BKT4M9'))).toBe('1');
    buttonWithText('Download them (.zip)').click();
    await flush(8);
    expect(api.callsTo('loadHandins').map((c) => (c[1] as Date).getTime())).toEqual([0, 0]); // two pages, from the beginning of time
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('8B_Robotics-old-handins.zip');
    expect((await zipNames(downloads[0].data as Blob)).length).toBe(130);
    expect(q('.z1t-notice').textContent).toContain('130 hand-ins in the zip');
    // Once per tab: reopening does not count or prune again.
    q<HTMLAnchorElement>('.z1t-brand').click();
    await flush();
    await openClass();
    expect(api.callsTo('countHandinsBefore')).toHaveLength(1);
    expect(api.callsTo('pruneHandins')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('Settings and Delete class (T9)', () => {
  it('saves the name, the hand-ins switch and the retention weeks', async () => {
    await signedIn([makeClass()]);
    await openClass();
    tab('Settings');
    expect(q('.z1t-settings').textContent).not.toContain('Tasks');
    q<HTMLInputElement>('#z1t-set-name').value = '  8B  Robotics 2027 ';
    buttonWithText('Save').click();
    await flush();
    expect(api.callsTo('updateClass')[0]).toEqual(['BKT4M9', { name: '8B Robotics 2027' }]);
    const sw = q<HTMLInputElement>('#z1t-set-open');
    expect(sw.checked).toBe(true);
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    await flush();
    expect(api.callsTo('updateClass')[1]).toEqual(['BKT4M9', { handinsOpen: false }]);
    expect(q('.z1t-settings').textContent).toContain('This class no longer accepts hand-ins');
    const keep = q<HTMLInputElement>('#z1t-set-keep');
    expect(keep.value).toBe('10');
    keep.value = '4';
    keep.dispatchEvent(new Event('change'));
    await flush();
    expect(api.callsTo('updateClass')[2]).toEqual(['BKT4M9', { keepWeeks: 4 }]);
    expect(q('.z1t-settings').textContent).toContain('You are warned a week before.');
  });

  it('"Download everything first" pages through every hand-in of the class, not only the Today view', async () => {
    await signedIn([makeClass()]);
    api.handins.set('BKT4M9', [
      ...Array.from({ length: 120 }, (_, i) => makeHandin({ id: `o${i}`, createdAt: new Date(at(10, 0, -45).getTime() + i * 1000) })),
      makeHandin({ id: 'today', ...sara, createdAt: at(10, 0) }),
    ]);
    api.today = () => api.handins.get('BKT4M9')!.filter((r) => r.id === 'today');
    await openClass();
    tab('Settings');
    buttonWithText('Download everything first (.zip)').click();
    await flush(8);
    expect(api.callsTo('loadHandins')).toHaveLength(2);
    expect((api.callsTo('loadHandins')[0][1] as Date).getTime()).toBe(0);
    expect(downloads[0].name).toBe('8B_Robotics-everything.zip');
    expect((await zipNames(downloads[0].data as Blob)).length).toBe(121);
    expect(q('.z1t-card-danger').textContent).toContain('121 hand-ins in the zip');
  });

  it('deletes the class after the code is typed (bkt-4m9 accepted), with progress, then returns to the list', async () => {
    await signedIn([makeClass()]);
    await openClass();
    tab('Settings');
    expect(q('.z1t-card-danger').textContent).toContain('Deletes the class, all hand-ins and all joined computers. This cannot be undone.');
    const del = buttonWithText('Delete class');
    expect(del.disabled).toBe(true);
    const input = q<HTMLInputElement>('#z1t-del-code');
    input.value = 'bkt-4m9';
    input.dispatchEvent(new Event('input'));
    expect(del.disabled).toBe(false);
    del.click();
    await flush();
    expect(api.callsTo('deleteClass')[0]).toEqual(['BKT4M9']);
    expect(q('.z1-toast').textContent).toBe('Class deleted');
    expect(text()).toContain(EMPTY_CLASSES_TEXT);
    expect(api.activeListeners()).toBe(1); // watchClasses only
  });

  it("'more' leaves the class deleting with Finish deleting", async () => {
    await signedIn([makeClass()]);
    api.deleteClassResult = 'more';
    await openClass();
    tab('Settings');
    const input = q<HTMLInputElement>('#z1t-del-code');
    input.value = 'BKT4M9';
    input.dispatchEvent(new Event('input'));
    buttonWithText('Delete class').click();
    await flush();
    expect(q('.z1t-progress').textContent).toContain('Deletion not finished');
    expect(root.querySelector('button.z1t-danger')!.textContent).toBe('Finish deleting');
    expect(q('.z1t-class-head').textContent).toContain('Deletion not finished');
    q<HTMLAnchorElement>('.z1t-brand').click();
    await flush();
    expect(q('.z1t-class-card').textContent).toContain('Deletion not finished');
  });
});

// ---------------------------------------------------------------------------
describe('Delete my data (T12), sign out (T11), errors, parked listeners', () => {
  it('runs the two steps: DELETE + deleteAllClasses, then deleteAccount synchronously in the click', async () => {
    await signedIn([makeClass()]);
    const details = q<HTMLDetailsElement>('.z1t-delete-data');
    details.open = true;
    const step2 = buttonWithText('Delete my sign-in record');
    expect(step2.disabled).toBe(true);
    expect(text()).toContain(TEACHER_ERROR_TEXT.classes_left);
    const step1 = buttonWithText('Delete all my classes');
    expect(step1.disabled).toBe(true);
    const confirmInput = q<HTMLInputElement>('input[aria-label="Type DELETE to confirm"]');
    confirmInput.value = 'DELETE';
    confirmInput.dispatchEvent(new Event('input'));
    expect(step1.disabled).toBe(false);
    step1.click();
    await flush();
    expect(api.callsTo('deleteAllClasses')).toHaveLength(1);
    expect(api.classes.size).toBe(0);
    q<HTMLDetailsElement>('.z1t-delete-data').open = true;
    const step2b = buttonWithText('Delete my sign-in record');
    expect(step2b.disabled).toBe(false);
    step2b.click();
    expect(api.callsTo('deleteAccount')).toHaveLength(1); // synchronous
    await flush();
    expect(root.querySelector('.z1t-signin')).not.toBeNull();
  });

  it('sign out leaves no active listener and clears the handoffs', async () => {
    await signedIn([makeClass()]);
    await openClass();
    expect(api.activeListeners()).toBe(3); // classes, class, today
    storage.setItem(`${REVIEW_HANDOFF_PREFIX}abcdefghijklmnop`, '1:x');
    buttonWithText('Sign out').click();
    await flush();
    expect(api.callsTo('signOut')).toHaveLength(1);
    expect(api.activeListeners()).toBe(0);
    expect(storage.getItem(`${REVIEW_HANDOFF_PREFIX}abcdefghijklmnop`)).toBeNull();
    expect(root.querySelector('.z1t-signin')).not.toBeNull();
  });

  it('shows a failed listener in the banner with Retry, which re-subscribes', async () => {
    await signedIn([makeClass()]);
    await openClass();
    api.emitError('today', fakeError('index_missing'));
    await flush();
    expect(q('.z1t-banner').hidden).toBe(false);
    expect(q('.z1t-banner').textContent).toContain(TEACHER_ERROR_TEXT.index_missing);
    buttonWithText('Retry', q('.z1t-banner')).click();
    await flush();
    expect(api.callsTo('watchTodayHandins')).toHaveLength(2);
    expect(q('.z1t-banner').hidden).toBe(true);
    api.emitError('classes', fakeError('permission'));
    await flush();
    expect(q('.z1t-banner').textContent).toContain(TEACHER_ERROR_TEXT.permission);
    buttonWithText('Retry', q('.z1t-banner')).click();
    await flush();
    expect(api.callsTo('watchClasses')).toHaveLength(2);
  });

  it('a write shows Saving… then the waiting text after 10 s, and a failure in the banner', async () => {
    vi.useFakeTimers({ now: NOW });
    await signedIn([makeClass()]);
    await openClass();
    const original = api.updateClass;
    let resolveWrite!: () => void;
    api.updateClass = (code, patch) => {
      api.calls.updateClass = [[code, patch]];
      return new Promise<void>((r) => (resolveWrite = r));
    };
    const sw = q<HTMLInputElement>('.z1t-class-head input[aria-label="Accepting hand-ins"]');
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    const status = sw.closest('.z1t-class-controls')!.querySelector('.z1t-status')!;
    expect(status.textContent).toBe('Saving…');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(status.textContent).toBe(WAITING_TEXT);
    resolveWrite();
    await vi.advanceTimersByTimeAsync(1);
    expect(status.textContent).toBe('');
    api.updateClass = original;
    api.failNext('updateClass', fakeError('quota', { reset: '10:00' }));
    sw.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(1);
    expect(q('.z1t-banner').textContent).toContain('It works again after 10:00');
  });

  it("keeps the previous class's listeners for 10 minutes after a switch (one class at most)", async () => {
    vi.useFakeTimers({ now: NOW });
    await signedIn([makeClass({ code: 'BKT4M9', createdAt: at(9, 0, -3) }), makeClass({ code: 'CDF3G7', name: '7A', createdAt: at(9, 0, -2) }), makeClass({ code: 'HJK4L9', name: '6C', createdAt: at(9, 0, -1) })]);
    await openClass('BKT4M9');
    expect(api.callsTo('watchClass').map((c) => c[0])).toEqual(['BKT4M9']);
    const switcher = q<HTMLSelectElement>('#z1t-switcher');
    switcher.value = 'CDF3G7';
    switcher.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(10);
    expect(api.listenerCounts().class).toBe(2); // BKT4M9 parked, CDF3G7 live
    q<HTMLSelectElement>('#z1t-switcher').value = 'BKT4M9';
    q<HTMLSelectElement>('#z1t-switcher').dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(10);
    expect(api.callsTo('watchClass').map((c) => c[0])).toEqual(['BKT4M9', 'CDF3G7']); // no re-subscribe
    q<HTMLSelectElement>('#z1t-switcher').value = 'HJK4L9';
    q<HTMLSelectElement>('#z1t-switcher').dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(10);
    expect(api.listenerCounts().class).toBe(2); // CDF3G7 dropped: only one parked class
    clock += PARK_MS;
    await vi.advanceTimersByTimeAsync(PARK_MS + 10);
    expect(api.listenerCounts().class).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('textContent matrix (§3.4)', () => {
  it.each(['<img src=x onerror=alert(1)>', '</script><b>x</b>'])('renders %s literally everywhere', async (evil) => {
    await signedIn([makeClass({ name: evil })]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', firstName: evil, lastName: evil, code: evil })]);
    api.members.set('BKT4M9', [makeMember({ firstName: evil, lastName: evil, device: evil })]);
    expect(q('.z1t-class-card').textContent).toContain(evil);
    await openClass();
    const check = () => {
      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelector('b')).toBeNull();
    };
    check();
    expect(q('.z1t-rows').textContent).toContain(evil);
    q<HTMLButtonElement>('.z1t-rows .z1t-name button').click();
    check();
    expect(q('.z1t-detail h3').textContent).toBe(`${evil} ${evil}`);
    expect(q('.z1t-detail .z1t-code').textContent).toBe(evil);
    tab('All hand-ins');
    check();
    expect(q('.z1t-feed-list').textContent).toContain(evil);
    tab('Settings');
    check();
    expect(q<HTMLInputElement>('#z1t-set-name').value).toBe(evil);
    buttonWithText('Show to the class').click();
    check();
    expect(q('.z1t-overlay-name').textContent).toBe(evil);
  });
});
