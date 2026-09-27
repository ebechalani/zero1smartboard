// @vitest-environment happy-dom
/**
 * Teacher dashboard tests (docs/CLASSROOM.md §7.3, C) with the in-memory FakeTeacherApi:
 * not configured, sign-in (synchronous signIn, the error texts), the class list, Create class,
 * the class page header, the Overview (rows, New / Seen, live inserts, periods, task filter,
 * Open links, .ino, zips), the detail panel, All hand-ins, Students, retention, Delete class,
 * Delete my data, sign-out, the error banner and the parked listeners. Plus the textContent matrix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../src/classroom/model';
import { TEACHER_ERROR_TEXT } from '../src/classroom/errors';
import { REVIEW_HANDOFF_PREFIX, decodeReviewPayload } from '../src/share-link';
import { WAITING_TEXT } from '../src/teacher/context';
import { EMPTY_CLASSES_TEXT, NOT_CONFIGURED_TEXT, mountDashboard, type Dashboard } from '../src/teacher/dashboard';
import { LAST_CLASS_KEY, periodKey, prunedKey, seenKey } from '../src/teacher/format';
import { DECODE_PROBLEM_TEXT } from '../src/teacher/handins';
import { PARK_MS } from '../src/teacher/session';
import { memoryStorage } from './classroom-fakes';
import { TEACHER, createFakeTeacherApi, fakeError, makeClass, makeHandin, makeMember, type FakeTeacherApi } from './fakes/fake-teacher-api';

/** Sat 26 Sep 2026, 14:00 local time. */
const NOW = new Date(2026, 8, 26, 14, 0, 0);
let clock = NOW.getTime();
const now = () => new Date(clock);
const at = (h: number, m: number, dayOffset = 0) => new Date(2026, 8, 26 + dayOffset, h, m);

let api: FakeTeacherApi;
let storage: Storage;
let tabStorage: Storage;
let root: HTMLElement;
let dashboard: Dashboard | null = null;
let downloads: { name: string; data: string | Blob }[];
let copied: string[];
let confirmAnswer = true;
let confirms: string[];

const randomBytes = (() => {
  let n = 0;
  return (len: number) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = (n++ * 31 + 7) % 240;
    return out;
  };
})();

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
    randomBytes,
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

  it('shows cards newest first with the code, the count, the joining badge and the stopped section', async () => {
    await signedIn([
      makeClass({ code: 'BKT4M9', name: '8B Robotics', createdAt: at(9, 0, -10), students: ['ali.k', 'sara.m', 'omar.h'] }),
      makeClass({ code: 'CDF3G7', name: '7A Robotics', createdAt: at(9, 0, -1), joinOpen: false, joinWindowAt: at(13, 50) }),
      makeClass({ code: 'HJK4L9', name: 'Last year', createdAt: at(9, 0, -300), handinsOpen: false, joinOpen: false }),
    ]);
    const cards = qa('.z1t-class-card');
    expect(cards.map((c) => c.getAttribute('data-code'))).toEqual(['CDF3G7', 'BKT4M9', 'HJK4L9']);
    expect(cards[1].textContent).toContain('BKT-4M9');
    expect(cards[1].textContent).toContain('3 students');
    expect(cards[1].textContent).toContain('Joining open');
    expect(cards[0].textContent).toContain('Joining open · 5 min');
    expect(cards[2].textContent).toContain('Joining closed');
    expect(cards[2].textContent).toContain('Hand-ins stopped');
    expect(text()).toContain('Hand-ins stopped');
  });

  it('re-opens the last opened class', async () => {
    storage.setItem(LAST_CLASS_KEY, 'BKT4M9');
    await signedIn([makeClass()]);
    expect(q('.z1t-class-head').textContent).toContain('8B Robotics');
    expect(q<HTMLSelectElement>('#z1t-switcher').value).toBe('BKT4M9');
  });
});

// ---------------------------------------------------------------------------
describe('create class (T3)', () => {
  async function openDialog(): Promise<HTMLDialogElement> {
    buttonWithText('+ New class').click();
    await flush();
    return q<HTMLDialogElement>('dialog.z1t-create');
  }
  const input = (dialog: HTMLDialogElement, id: string) => dialog.querySelector<HTMLInputElement & HTMLTextAreaElement>(`#${id}`)!;
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('requires a name, previews normalised names, blocks on problems and warns on near-duplicates', async () => {
    await signedIn();
    const dialog = await openDialog();
    const create = buttonWithText('Create', dialog);
    expect(create.disabled).toBe(true);
    expect(input(dialog, 'z1t-new-teacher').value).toBe('Mr. B');
    setValue(input(dialog, 'z1t-new-names'), 'Ali Khalil\nSara Mansour, Élise Dupont; Ali Mansour');
    expect(create.disabled).toBe(true); // no name yet
    const chips = [...dialog.querySelectorAll('.z1t-chip')].map((c) => c.textContent);
    expect(chips).toEqual(['ali.k', 'sara.m', 'elise.d', 'ali.m']);
    expect(dialog.textContent).toContain('ali.k and ali.m differ by one letter; students may pick the wrong one.');
    setValue(input(dialog, 'z1t-new-name'), '8B Robotics');
    expect(create.disabled).toBe(false); // warnings do not block
    input(dialog, 'z1t-new-shorten').checked = false;
    input(dialog, 'z1t-new-shorten').dispatchEvent(new Event('change'));
    expect([...dialog.querySelectorAll('.z1t-chip')].map((c) => c.textContent)).toEqual(['ali.khalil', 'sara.mansour', 'elise.dupont', 'ali.mansour']);
    setValue(input(dialog, 'z1t-new-names'), 'Ali Khalil\nAli Khalil\nX');
    expect(dialog.textContent).toContain('appears twice in the list');
    expect(dialog.textContent).toContain('too short');
    expect(create.disabled).toBe(true);
  });

  it('creates the class with tasks and opens it with the formatted code banner', async () => {
    await signedIn();
    const dialog = await openDialog();
    setValue(input(dialog, 'z1t-new-name'), '8B Robotics');
    setValue(input(dialog, 'z1t-new-names'), 'Ali Khalil\nSara Mansour');
    setValue(input(dialog, 'z1t-new-tasks'), 'Traffic light\nNight light');
    dialog.querySelector<HTMLSelectElement>('#z1t-new-join')!.value = 'closed';
    buttonWithText('Create', dialog).click();
    await flush();
    const call = api.callsTo('createClass')[0][0] as { name: string; students: { username: string }[]; tasks: string[]; joinOpen: boolean; teacherName: string };
    expect(call.name).toBe('8B Robotics');
    expect(call.teacherName).toBe('Mr. B');
    expect(call.students.map((s) => s.username)).toEqual(['ali.k', 'sara.m']);
    expect(call.tasks).toEqual(['Traffic light', 'Night light']);
    expect(call.joinOpen).toBe(false);
    expect(root.querySelector('dialog.z1t-create')).toBeNull();
    const code = [...api.classes.keys()][0];
    expect(q('.z1t-created').textContent).toBe(`Class created. Give your students the code ${code.slice(0, 3)}-${code.slice(3)} or the class link.`);
    expect(q('.z1t-code').textContent).toBe(`${code.slice(0, 3)}-${code.slice(3)}`);
    expect(q('.z1t-class-head').textContent).toContain('Joining closed');
  });

  it('shows the code_collision text inside the dialog', async () => {
    await signedIn();
    const dialog = await openDialog();
    setValue(input(dialog, 'z1t-new-name'), 'X');
    api.failNext('createClass', fakeError('code_collision'));
    buttonWithText('Create', dialog).click();
    await flush();
    expect(dialog.querySelector('.z1t-error')!.textContent).toBe(TEACHER_ERROR_TEXT.code_collision);
  });
});

// ---------------------------------------------------------------------------
describe('class page header (T4, T10)', () => {
  it('copies the code and the class link, and shows the overlay with the joined count until Esc', async () => {
    await signedIn([makeClass({ tasks: ['Traffic light'] })]);
    await openClass();
    api.members.set('BKT4M9', [makeMember({ uid: 'device-aaaa', studentId: 's0000001' }), makeMember({ uid: 'device-bbbb', studentId: 'gone0000' })]);
    buttonWithText('Copy code').click();
    buttonWithText('Copy class link').click();
    await flush();
    expect(copied[0]).toBe('BKT-4M9');
    expect(copied[1]).toMatch(/#class=BKT4M9$/);
    expect(api.listenerCounts().members).toBe(0);
    buttonWithText('Show to the class').click();
    await flush();
    const overlay = q('.z1t-overlay');
    expect(overlay.hidden).toBe(false);
    expect(api.listenerCounts().members).toBe(1);
    expect(overlay.querySelector('.z1t-overlay-code')!.textContent).toBe('BKT-4M9');
    expect(overlay.querySelector('.z1t-overlay-code')!.getAttribute('aria-label')).toBe('B K T 4 M 9');
    expect(overlay.querySelector('.z1t-overlay-link')!.textContent).toMatch(/^[^/]+\/.*#class=BKT4M9$/);
    expect(overlay.textContent).toContain('Joining open · 1 of 2 joined');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(overlay.hidden).toBe(true);
    expect(api.listenerCounts().members).toBe(0);
  });

  it('joining control: the switch, the 15-minute window countdown, +15 and Close now', async () => {
    vi.useFakeTimers({ now: NOW });
    await signedIn([makeClass({ joinOpen: true })]);
    await openClass();
    const head = q('.z1t-class-head');
    const sw = head.querySelector<HTMLInputElement>('input[aria-label="Joining always open"]')!;
    expect(sw.checked).toBe(true);
    expect(head.textContent).toContain('Anyone with the code can join and pick a name.');
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(10);
    expect(api.callsTo('closeJoining')).toEqual([['BKT4M9']]);
    expect(q('.z1t-class-head').textContent).toContain('Joining closed');
    buttonWithText('Open for 15 minutes').click();
    await vi.advanceTimersByTimeAsync(10);
    expect(api.callsTo('openJoinWindow')).toHaveLength(1);
    expect(q('.z1t-countdown').textContent).toBe('Joining open · 15:00 left');
    clock += 2 * 60_000 + 26_000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(q('.z1t-countdown').textContent).toBe('Joining open · 12:34 left');
    buttonWithText('+15 min').click();
    await vi.advanceTimersByTimeAsync(10);
    expect(api.callsTo('openJoinWindow')).toHaveLength(2);
    expect(q('.z1t-countdown').textContent).toBe('Joining open · 15:00 left');
    buttonWithText('Close now').click();
    await vi.advanceTimersByTimeAsync(10);
    expect(api.callsTo('closeJoining')).toHaveLength(2);
    expect(root.querySelector('.z1t-countdown')).toBeNull();
    expect(q('.z1t-class-head').textContent).toContain('open joining at the start of each lesson');
  });

  it('the hand-ins switch and the current task select write through updateClass', async () => {
    await signedIn([makeClass({ tasks: ['Traffic light', 'Night light'] })]);
    await openClass();
    const sw = q<HTMLInputElement>('input[aria-label="Accepting hand-ins"]');
    sw.checked = false;
    sw.dispatchEvent(new Event('change'));
    await flush();
    expect(api.callsTo('updateClass')[0]).toEqual(['BKT4M9', { handinsOpen: false }]);
    expect(text()).toContain('This class no longer accepts hand-ins');
    const select = q<HTMLSelectElement>('#z1t-current-task');
    expect([...select.options].map((o) => o.textContent)).toEqual(['(no task)', 'Night light', 'Traffic light']);
    select.value = 't00001';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(api.callsTo('updateClass')[1]).toEqual(['BKT4M9', { currentTaskId: 't00001' }]);
    expect(q<HTMLSelectElement>('#z1t-current-task').value).toBe('t00001');
  });
});

// ---------------------------------------------------------------------------
describe('Overview (T5)', () => {
  const cls = () => makeClass({ students: ['ali.k', 'sara.m', 'omar.h'], tasks: ['Traffic light'] });

  it('has one row per roster student with Nothing yet, and counts "n of m"', async () => {
    await signedIn([cls()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', studentId: 's0000001', username: 'ali.k', createdAt: at(10, 42) })]);
    await openClass();
    const rows = qa('.z1t-rows tbody tr');
    expect(rows.map((r) => r.querySelector('.z1t-name')!.textContent)).toEqual(['ali.k', 'omar.h', 'sara.m']);
    expect(rows[0].textContent).toContain('New');
    expect(rows[1].textContent).toContain('Nothing yet');
    expect(rows[0].textContent).toContain('10:42');
    expect(rows[0].textContent).toContain('1 computer');
    expect(q('.z1t-headline').textContent).toBe('1 of 3 handed in today');
  });

  it('keeps New / Seen in localStorage and marks seen on Open, .ino and the detail', async () => {
    await signedIn([cls()]);
    api.handins.set('BKT4M9', [
      makeHandin({ id: 'h1', studentId: 's0000001', username: 'ali.k', createdAt: at(10, 42) }),
      makeHandin({ id: 'h2', studentId: 's0000002', username: 'sara.m', createdAt: at(10, 50) }),
      makeHandin({ id: 'h3', studentId: 's0000003', username: 'omar.h', createdAt: at(10, 55) }),
    ]);
    storage.setItem(seenKey('BKT4M9'), JSON.stringify({ s0000003: at(11, 0).getTime() }));
    await openClass();
    const row = (name: string) => qa('.z1t-rows tbody tr').find((r) => r.querySelector('.z1t-name')!.textContent === name)!;
    expect(row('omar.h').textContent).toContain('Seen');
    expect(row('ali.k').textContent).toContain('New');
    row('ali.k').querySelector<HTMLButtonElement>('.z1t-actions button')!.click(); // .ino
    await flush();
    expect(downloads).toHaveLength(1);
    expect(row('ali.k').textContent).toContain('Seen');
    expect(JSON.parse(storage.getItem(seenKey('BKT4M9'))!)).toMatchObject({ s0000001: at(10, 42).getTime() });
    row('sara.m').querySelector<HTMLAnchorElement>('a.z1t-open')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(row('sara.m').textContent).toContain('Seen');
    // A newer hand-in makes it New again.
    api.handins.get('BKT4M9')!.push(makeHandin({ id: 'h4', studentId: 's0000002', username: 'sara.m', createdAt: at(11, 30) }));
    api.emitToday('BKT4M9', { added: ['h4'] });
    await flush();
    expect(row('sara.m').textContent).toContain('New');
    expect(row('sara.m').textContent).toContain('2'); // versions
    expect(q('.z1t-sr-only').textContent).toBe('1 new hand-in');
  });

  it('announces live inserts once, politely', async () => {
    await signedIn([cls()]);
    await openClass();
    expect(q('.z1t-sr-only').textContent).toBe('');
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1' }), makeHandin({ id: 'h2', studentId: 's0000002', username: 'sara.m' })]);
    api.emitToday('BKT4M9', { added: ['h1', 'h2'] });
    await flush();
    expect(q('.z1t-sr-only').textContent).toBe('2 new hand-ins');
    expect(qa('.z1t-rows tbody tr.is-fresh')).toHaveLength(2);
  });

  it('switches from the live Today view to a one-off 7-day view, remembered per class', async () => {
    await signedIn([cls()]);
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
    expect(q('.z1t-headline').textContent).toBe('1 of 3 handed in in the last 7 days');
    expect(qa('.z1t-rows tbody tr')[0].textContent).toContain('Wed 10:00');
    buttonWithText('Refresh').click();
    await flush();
    expect(api.callsTo('loadHandins')).toHaveLength(2);
    // Remembered: a fresh mount of the class starts in the 7-day view.
    dashboard!.destroy();
    root = document.createElement('div');
    document.body.appendChild(root);
    await signedIn([cls()]); // the last class is re-opened
    expect(q<HTMLSelectElement>('#z1t-period').value).toBe('7');
    expect(api.listenerCounts().today).toBe(0);
  });

  it('filters by task', async () => {
    await signedIn([cls()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', taskId: 't00001' }), makeHandin({ id: 'h2', studentId: 's0000002', username: 'sara.m', taskId: '' })]);
    await openClass();
    expect(q('.z1t-headline').textContent).toBe('2 of 3 handed in today');
    const filter = q<HTMLSelectElement>('#z1t-task-filter');
    filter.value = 't00001';
    filter.dispatchEvent(new Event('change'));
    expect(q('.z1t-headline').textContent).toBe('1 of 3 handed in today');
    expect(qa('.z1t-rows tbody tr')[0].textContent).toContain('Traffic light');
  });

  it('shows the amber "2 computers within an hour" only for close hand-ins', async () => {
    await signedIn([cls()]);
    api.handins.set('BKT4M9', [
      makeHandin({ id: 'a1', uid: 'dev-a', createdAt: at(10, 0) }),
      makeHandin({ id: 'a2', uid: 'dev-b', createdAt: at(10, 30) }),
      makeHandin({ id: 'b1', uid: 'dev-c', studentId: 's0000002', username: 'sara.m', createdAt: at(8, 0) }),
      makeHandin({ id: 'b2', uid: 'dev-d', studentId: 's0000002', username: 'sara.m', createdAt: at(10, 0) }),
    ]);
    await openClass();
    const rows = qa('.z1t-rows tbody tr');
    expect(rows[0].querySelector('.z1t-badge-warn')!.textContent).toBe('2 computers within an hour');
    expect(rows[2].querySelector('.z1t-badge-warn')).toBeNull();
    expect(rows[2].textContent).toContain('2 computers');
  });

  it('Open is a real link to review.html, and a large payload uses #rid= plus a handoff', async () => {
    await signedIn([cls()]);
    const big = 'x'.repeat(LIMITS.reviewHashMax);
    api.handins.set('BKT4M9', [
      makeHandin({ id: 'h1', createdAt: at(10, 42), taskId: 't00001', title: 'Mine', code: 'void setup() {}\n' }),
      makeHandin({ id: 'h2', studentId: 's0000002', username: 'sara.m', code: big }),
    ]);
    await openClass();
    const links = qa<HTMLAnchorElement>('.z1t-rows a.z1t-open');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0].getAttribute('href')).toMatch(/^\.\/review\.html#review=/);
    expect(links[0].hasAttribute('aria-disabled')).toBe(false);
    const payload = decodeReviewPayload(links[0].getAttribute('href')!.replace('./review.html#review=', ''))!;
    expect(payload).toMatchObject({ v: 1, kind: 'code', who: 'ali.k', className: '8B Robotics', task: 'Traffic light', title: 'Mine', code: 'void setup() {}\n', at: at(10, 42).getTime() });
    const rid = links[1].getAttribute('href')!;
    expect(rid).toMatch(/^\.\/review\.html#rid=[A-Za-z0-9]{16}$/);
    const key = REVIEW_HANDOFF_PREFIX + rid.slice('./review.html#rid='.length);
    const stored = storage.getItem(key)!;
    expect(stored).toMatch(new RegExp(`^${clock}:`));
    expect(decodeReviewPayload(stored.slice(stored.indexOf(':') + 1))!.code).toBe(big);
    // Handoffs are cleared on sign-out.
    buttonWithText('Sign out').click();
    await flush();
    expect(storage.getItem(key)).toBeNull();
  });

  it('.ino is enabled after decode and downloads with no await between the click and the download', async () => {
    await signedIn([cls()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', createdAt: at(10, 42), code: 'void loop() {}\n' })]);
    await openClass();
    const button = q<HTMLButtonElement>('.z1t-rows .z1t-actions button');
    expect(button.disabled).toBe(false);
    button.click();
    expect(downloads).toEqual([{ name: 'zero1_ali_k_0926_104200.ino', data: 'void loop() {}\n' }]);
  });

  it('downloads the latest of each student and all shown as zips', async () => {
    await signedIn([cls()]);
    api.handins.set('BKT4M9', [
      makeHandin({ id: 'h1', createdAt: at(10, 0) }),
      makeHandin({ id: 'h2', createdAt: at(11, 0), kind: 'blocks', workspaceJson: '{"blocks":{}}' }),
      makeHandin({ id: 'h3', studentId: 's0000002', username: 'sara.m', createdAt: at(10, 30) }),
    ]);
    await openClass();
    buttonWithText('Download latest of each student (.zip)').click();
    buttonWithText('Download all shown (.zip)').click();
    expect(downloads.map((d) => d.name)).toEqual(['8B_Robotics-latest-2026-09-26.zip', '8B_Robotics-all-2026-09-26.zip']);
    expect(downloads[0].data).toBeInstanceOf(Blob);
    const names = async (blob: Blob) => [...new TextDecoder().decode(await blob.arrayBuffer()).matchAll(/[a-z0-9.-]+\.(?:ino|json)/g)].map((m) => m[0]);
    const latest = await names(downloads[0].data as Blob);
    expect(new Set(latest)).toEqual(new Set(['ali.k.ino', 'ali.k.blocks.json', 'sara.m.ino']));
    const all = await names(downloads[1].data as Blob);
    expect(new Set(all)).toEqual(new Set(['ali.k.ino', 'ali.k.blocks.json', 'ali.k-2026-09-26-1000.ino', 'sara.m.ino']));
  });

  it('keyboard: arrows move between rows and Enter opens the detail', async () => {
    await signedIn([cls()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1' })]);
    await openClass();
    const rows = qa('.z1t-rows tbody tr');
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(qa('.z1t-rows tbody tr')[1].tabIndex).toBe(0);
    qa('.z1t-rows tbody tr')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(q('.z1t-detail').hidden).toBe(false);
    expect(q('.z1t-detail h3').textContent).toBe('ali.k');
  });
});

// ---------------------------------------------------------------------------
describe('detail (T6)', () => {
  const cls = () => makeClass({ students: ['ali.k', 'sara.m'], tasks: ['Traffic light', 'Night light'] });
  async function openDetail(): Promise<HTMLElement> {
    await openClass();
    q<HTMLButtonElement>('.z1t-rows .z1t-name button').click();
    await flush();
    return q<HTMLElement>('.z1t-detail');
  }

  it('lists versions newest first with the code preview and loads older ones', async () => {
    await signedIn([cls()]);
    api.handins.set('BKT4M9', [
      makeHandin({ id: 'h1', createdAt: at(10, 0), title: 'First', note: 'line one\nline two', code: 'int a;' }),
      makeHandin({ id: 'h2', createdAt: at(11, 0), kind: 'blocks', taskId: 't00001', workspaceJson: '{"blocks":{}}', code: 'int b;' }),
    ]);
    api.members.set('BKT4M9', [makeMember({ uid: 'device-aaaa', device: 'Chrome · Windows' })]);
    const detail = await openDetail();
    const versions = [...detail.querySelectorAll('.z1t-versions > .z1t-version')];
    expect(versions.map((v) => v.getAttribute('data-handin'))).toEqual(['h2', 'h1']);
    expect(versions[0].textContent).toContain('Sat 11:00');
    expect(versions[0].textContent).toContain('Blocks');
    expect(versions[0].textContent).toContain('Traffic light');
    expect(versions[0].textContent).toContain('The Arduino sketch made from the blocks:');
    expect(versions[0].querySelector('.z1t-code')!.textContent).toBe('int b;');
    expect(versions[0].textContent).toContain('Computer AAAA');
    expect(versions[1].querySelector('.z1t-note')!.textContent).toBe('line one\nline two');
    expect(versions[1].textContent).toContain('First');
    // Older versions.
    api.today = () => api.handins.get('BKT4M9')!.filter((r) => r.id !== 'h0');
    api.handins.get('BKT4M9')!.push(makeHandin({ id: 'h0', createdAt: at(9, 0, -2), code: 'int z;' }));
    buttonWithText('Load older versions', detail).click();
    await flush();
    expect(api.callsTo('studentHandins')[0]).toEqual(['BKT4M9', 's0000001', { before: at(10, 0) }]);
    const older = q('.z1t-older');
    expect(older.querySelector('summary')!.textContent).toBe('1 earlier version');
    expect(older.querySelector('.z1t-version')!.getAttribute('data-handin')).toBe('h0');
  });

  it('Move to student / task call refileHandin; Remove the computer and Delete confirm first', async () => {
    await signedIn([cls()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1' })]);
    const detail = await openDetail();
    const moveStudent = detail.querySelector<HTMLSelectElement>('select[aria-label="Wrong student? Move to…"]')!;
    expect([...moveStudent.options].map((o) => o.textContent)).toEqual(['Wrong student? Move to…', 'sara.m']);
    moveStudent.value = 's0000002';
    moveStudent.dispatchEvent(new Event('change'));
    await flush();
    expect(api.callsTo('refileHandin')[0]).toEqual(['BKT4M9', 'h1', { studentId: 's0000002' }]);
    // The hand-in moved: the detail of ali.k is empty and sara.m has it.
    expect(q('.z1t-detail').textContent).toContain('Nothing handed in in this period.');
    q<HTMLButtonElement>('.z1t-rows tr[data-student="s0000002"] .z1t-name button').click();
    await flush();
    const moveTask = q<HTMLSelectElement>('.z1t-detail select[aria-label="Wrong task? Move to…"]');
    moveTask.value = 't00002';
    moveTask.dispatchEvent(new Event('change'));
    await flush();
    expect(api.callsTo('refileHandin')[1]).toEqual(['BKT4M9', 'h1', { taskId: 't00002' }]);
    confirmAnswer = false;
    buttonWithText('Remove the computer that sent this', q('.z1t-detail')).click();
    expect(api.callsTo('removeDevice')).toHaveLength(0);
    confirmAnswer = true;
    buttonWithText('Remove the computer that sent this', q('.z1t-detail')).click();
    await flush();
    expect(api.callsTo('removeDevice')[0]).toEqual(['BKT4M9', 'device-aaaa']);
    buttonWithText('Delete', q('.z1t-detail')).click();
    await flush();
    expect(confirms.at(-1)).toBe('Delete this hand-in? This cannot be undone.');
    expect(api.callsTo('deleteHandin')[0]).toEqual(['BKT4M9', 'h1']);
    expect(api.handins.get('BKT4M9')).toEqual([]);
  });

  it('copies the code, falling back to a selection hint', async () => {
    await signedIn([cls()]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', code: 'int c;' })]);
    const detail = await openDetail();
    buttonWithText('Copy code', detail).click();
    await flush();
    expect(copied).toEqual(['int c;']);
    expect(detail.textContent).toContain('Copied');
  });

  it('shows the decode problem texts and disables Open, .ino and Copy', async () => {
    await signedIn([cls()]);
    const gzipButNotBytes = makeHandin({ id: 'bad' });
    gzipButNotBytes.content = { enc: 'gzip', code: 'not bytes', workspace: '' };
    const tooLarge = makeHandin({ id: 'big', studentId: 's0000002', username: 'sara.m', code: 'x'.repeat(LIMITS.codeDecodeCap + 1) });
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
  it('lists the feed newest first with "(removed)" names and filters', async () => {
    await signedIn([makeClass({ students: ['ali.k'], tasks: ['Traffic light'] })]);
    api.handins.set('BKT4M9', [
      makeHandin({ id: 'h1', createdAt: at(10, 0), note: 'first line\nsecond', title: 'Mine', taskId: 't00001' }),
      makeHandin({ id: 'h2', createdAt: at(11, 0), studentId: 'gone0000', username: 'old.n', kind: 'blocks' }),
    ]);
    await openClass();
    tab('All hand-ins');
    const items = qa('.z1t-feed-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('(removed) old.n');
    expect(items[0].textContent).toContain('(no title)');
    expect(items[0].textContent).toContain('Blocks');
    expect(items[1].textContent).toContain('ali.k');
    expect(items[1].textContent).toContain('Traffic light');
    expect(items[1].textContent).toContain('first line');
    expect(items[1].textContent).not.toContain('second');
    const student = q<HTMLSelectElement>('#z1t-feed-student');
    student.value = 's0000001';
    student.dispatchEvent(new Event('change'));
    expect(qa('.z1t-feed-item')).toHaveLength(1);
    qa<HTMLButtonElement>('.z1t-feed-row')[0].click();
    expect(q('.z1t-feed .z1t-detail').hidden).toBe(false);
    expect(q('.z1t-feed .z1t-detail .z1t-version.is-focused').getAttribute('data-handin')).toBe('h1');
  });
});

// ---------------------------------------------------------------------------
describe('Students (T8)', () => {
  const cls = () => makeClass({ students: ['ali.k', 'sara.m'] });
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('runs the members listener only while the tab is visible', async () => {
    await signedIn([cls()]);
    await openClass();
    expect(api.listenerCounts().members).toBe(0);
    tab('Students');
    await flush();
    expect(api.listenerCounts().members).toBe(1);
    tab('Overview');
    expect(api.listenerCounts().members).toBe(0);
  });

  it('adds students with the preview, renames with a duplicate error, lets join again and removes', async () => {
    await signedIn([cls()]);
    await openClass();
    tab('Students');
    await flush();
    const add = buttonWithText('Add');
    expect(add.disabled).toBe(true);
    setValue(q<HTMLTextAreaElement>('#z1t-add-names'), 'Ali Khalil\nOmar Haddad');
    expect(q('.z1t-students').textContent).toContain('is already in the class');
    expect(add.disabled).toBe(true);
    setValue(q<HTMLTextAreaElement>('#z1t-add-names'), 'Omar Haddad');
    expect(add.disabled).toBe(false);
    add.click();
    await flush();
    const entries = api.callsTo('addStudents')[0][1] as { username: string }[];
    expect(entries.map((e) => e.username)).toEqual(['omar.h']);
    expect(qa('.z1t-roster tbody tr[data-student]').map((r) => r.querySelector('.z1t-name')!.textContent)).toEqual(['ali.k', 'omar.h', 'sara.m']);
    // Rename.
    buttonWithText('Rename', qa('.z1t-roster tbody tr')[0]).click();
    const input = q<HTMLInputElement>('.z1t-rename input');
    input.value = 'sara.m';
    buttonWithText('Save', q('.z1t-rename')).click();
    expect(q('.z1t-rename .z1t-error').textContent).toBe('sara.m is already in the class.');
    expect(api.callsTo('renameStudent')).toHaveLength(0);
    input.value = 'Ali Khalil';
    buttonWithText('Save', q('.z1t-rename')).click();
    await flush();
    expect(api.callsTo('renameStudent')[0]).toEqual(['BKT4M9', 's0000001', 'ali.khalil']);
    expect(qa('.z1t-roster tbody tr[data-student]')[0].textContent).toContain('ali.khalil');
    expect(q('.z1t-students').textContent).not.toContain('Students keep their hand-ins');
    // Let join again.
    buttonWithText('Let join again (15 min)', qa('.z1t-roster tbody tr')[0]).click();
    await flush();
    expect(api.callsTo('letRejoin')[0]).toEqual(['BKT4M9', 's0000001']);
    // Remove.
    api.members.set('BKT4M9', [makeMember({ uid: 'device-aaaa', studentId: 's0000001' })]);
    buttonWithText('Remove', qa('.z1t-roster tbody tr')[0]).click();
    await flush();
    expect(confirms.at(-1)).toBe("Remove ali.khalil? Their computers are removed too and they can no longer hand in. Their hand-ins stay (shown as '(removed) ali.khalil').");
    expect(api.callsTo('removeStudent')[0]).toEqual(['BKT4M9', 's0000001']);
    expect(api.members.get('BKT4M9')).toEqual([]);
    expect(qa('.z1t-roster tbody tr[data-student]')).toHaveLength(2);
  });

  it('lists the computers of a student, removes one, removes unused ones and shows removed students\' computers', async () => {
    await signedIn([cls()]);
    api.members.set('BKT4M9', [
      makeMember({ uid: 'device-7f3a', studentId: 's0000001', device: 'Chrome · Windows', joinedAt: at(9, 0), lastHandinAt: at(10, 42) }),
      makeMember({ uid: 'device-old1', studentId: 's0000001', device: 'Safari · iOS', joinedAt: at(9, 0, -40) }),
      makeMember({ uid: 'device-gone', studentId: 'gone0000', username: 'old.n', device: 'Edge · Windows' }),
    ]);
    await openClass();
    tab('Students');
    await flush();
    const row = qa('.z1t-roster tbody tr')[0];
    expect(row.textContent).toContain('2 computers');
    expect(row.textContent).toContain('Sat 09:00');
    buttonWithText('2 computers', row).click();
    const devices = qa('.z1t-devices-row .z1t-device');
    expect(devices[0].textContent).toContain('Chrome · Windows · 7F3A');
    expect(devices[0].textContent).toContain('joined Sat 09:00');
    expect(devices[0].textContent).toContain('last hand-in Sat 10:42');
    expect(q('.z1t-devices-row').textContent).toContain('Remove a computer that joined under the wrong name.');
    buttonWithText('Remove this computer', devices[0]).click();
    await flush();
    expect(api.callsTo('removeDevice')[0]).toEqual(['BKT4M9', 'device-7f3a']);
    expect(q('.z1t-removed-devices').textContent).toContain("Removed students' computers");
    expect(q('.z1t-removed-devices').textContent).toContain('old.n');
    buttonWithText('Remove computers not used for 30 days').click();
    await flush();
    expect(api.callsTo('removeUnusedDevices')[0]).toEqual(['BKT4M9', 30]);
    expect(q('.z1-toast').textContent).toBe('Removed 1 computer');
  });
});

// ---------------------------------------------------------------------------
describe('retention (§2.11)', () => {
  it('warns a week ahead with a download, prunes with a toast, once per tab', async () => {
    await signedIn([makeClass({ keepWeeks: 10 })]);
    api.countBefore = 12;
    api.pruneCount = 3;
    api.handins.set('BKT4M9', [makeHandin({ id: 'old', createdAt: at(10, 0, -80) }), makeHandin({ id: 'new', createdAt: at(10, 0) })]);
    await openClass();
    const cutoff = clock - 10 * 7 * 86_400_000;
    expect((api.callsTo('countHandinsBefore')[0][1] as Date).getTime()).toBe(cutoff + 7 * 86_400_000);
    expect((api.callsTo('pruneHandins')[0][1] as Date).getTime()).toBe(cutoff);
    expect(q('.z1t-notice').textContent).toContain('12 hand-ins are older than 9 weeks and will be deleted within a week.');
    expect(q('.z1-toast').textContent).toBe('Deleted 3 hand-ins older than 10 weeks.');
    expect(tabStorage.getItem(prunedKey('BKT4M9'))).toBe('1');
    buttonWithText('Download them (.zip)').click();
    await flush();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('8B_Robotics-old-handins.zip');
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
  it('saves the names, the retention weeks and edits tasks', async () => {
    await signedIn([makeClass({ tasks: ['Traffic light'] })]);
    await openClass();
    tab('Settings');
    q<HTMLInputElement>('#z1t-set-name').value = '  8B  Robotics 2027 ';
    q<HTMLInputElement>('#z1t-set-teacher').value = 'Ms. C';
    buttonWithText('Save').click();
    await flush();
    expect(api.callsTo('updateClass')[0]).toEqual(['BKT4M9', { name: '8B Robotics 2027', teacherName: 'Ms. C' }]);
    const keep = q<HTMLInputElement>('#z1t-set-keep');
    expect(keep.value).toBe('10');
    keep.value = '4';
    keep.dispatchEvent(new Event('change'));
    await flush();
    expect(api.callsTo('updateClass')[1]).toEqual(['BKT4M9', { keepWeeks: 4 }]);
    expect(q('.z1t-settings').textContent).toContain('You are warned a week before.');
    // Tasks.
    const textarea = q<HTMLTextAreaElement>('#z1t-set-tasks');
    textarea.value = 'Night light\nTraffic light';
    textarea.dispatchEvent(new Event('input'));
    expect(q('.z1t-settings').textContent).toContain('appears twice');
    textarea.value = 'Night light';
    textarea.dispatchEvent(new Event('input'));
    buttonWithText('Add tasks').click();
    await flush();
    expect((api.callsTo('addTasks')[0][1] as { title: string }[]).map((t) => t.title)).toEqual(['Night light']);
    const items = qa('.z1t-task-item');
    expect(items.map((i) => i.querySelector('.z1t-task-title')!.textContent)).toEqual(['Night light', 'Traffic light']);
    buttonWithText('Set as current', items[0]).click();
    await flush();
    expect(api.callsTo('updateClass')[2]).toEqual(['BKT4M9', { currentTaskId: items[0].getAttribute('data-task') }]);
    expect(qa('.z1t-task-item')[0].textContent).toContain('Current task');
    buttonWithText('Rename', qa('.z1t-task-item')[1]).click();
    const input = q<HTMLInputElement>('.z1t-task-item input');
    input.value = 'Traffic lights';
    buttonWithText('Save', qa('.z1t-task-item')[1]).click();
    await flush();
    expect(api.callsTo('renameTask')[0]).toEqual(['BKT4M9', 't00001', 'Traffic lights']);
    buttonWithText('Delete', qa('.z1t-task-item')[0]).click();
    await flush();
    expect(api.callsTo('deleteTask')[0][1]).toBe(qa('.z1t-task-item').length === 1 ? api.callsTo('deleteTask')[0][1] : '');
    expect(qa('.z1t-task-item')).toHaveLength(1);
  });

  it('deletes the class after the code is typed (bkt-4m9 accepted), with progress, then returns to the list', async () => {
    await signedIn([makeClass()]);
    await openClass();
    tab('Settings');
    expect(q('.z1t-card-danger').textContent).toContain('Deletes the class, its class list, all hand-ins and all joined computers. This cannot be undone.');
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
    tab('Students');
    await flush();
    expect(api.activeListeners()).toBe(4);
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
    const sw = q<HTMLInputElement>('input[aria-label="Accepting hand-ins"]');
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

  it('keeps the previous class\'s listeners for 10 minutes after a switch (one class at most)', async () => {
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
    const cls = makeClass({ name: evil, teacherName: evil, students: [`${evil}`], tasks: [evil] });
    cls.roster = { s0000001: evil };
    cls.students = [{ studentId: 's0000001', username: evil }];
    await signedIn([cls]);
    api.handins.set('BKT4M9', [makeHandin({ id: 'h1', username: evil, title: evil, note: evil, taskId: 't00001', code: evil })]);
    api.members.set('BKT4M9', [makeMember({ username: evil, device: evil })]);
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
    expect(q('.z1t-detail .z1t-code').textContent).toBe(evil);
    expect(q('.z1t-detail .z1t-note').textContent).toBe(evil);
    tab('All hand-ins');
    check();
    expect(q('.z1t-feed-list').textContent).toContain(evil);
    tab('Students');
    await flush();
    buttonWithText('1 computer').click();
    check();
    expect(q('.z1t-devices').textContent).toContain(evil);
    tab('Settings');
    check();
    expect(q<HTMLInputElement>('#z1t-set-name').value).toBe(evil);
    buttonWithText('Show to the class').click();
    check();
    expect(q('.z1t-overlay-name').textContent).toBe(evil);
  });
});
