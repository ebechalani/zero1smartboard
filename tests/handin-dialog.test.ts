// @vitest-environment happy-dom
/**
 * Hand in dialog tests (happy-dom, docs/CLASSROOM.md §7.3): the student flows
 * S0-S7 against an in-memory fake StudentApi whose methods are spies. No
 * Firebase is loaded: `loadApi` resolves to the fake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassroomError, STUDENT_ERROR_TEXT, errorText, type ClassroomErrorCode } from '../src/classroom/errors';
import { LIMITS, formatClassCode, type HandinRecord } from '../src/classroom/model';
import { CLASSROOM_STORAGE_KEY, LAST_CODE_STORAGE_KEY, saveSession, type SavedSession } from '../src/classroom/session-store';
import type { FoundClass, PublicClass, RestoreResult, StudentApi, StudentSession } from '../src/classroom/student';
import { FILTER_ABOVE, HANDIN_TEXT, createHandinDialog, type HandinDialogOptions, type HandinView, type HandinWork } from '../src/ui/handin-dialog';
import { settle } from './helpers';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CODE = 'BKT4M9';
const OTHER_CODE = 'XPW7RT';
const NOW = new Date(2026, 8, 28, 10, 42, 0);

function publicClass(over: Partial<PublicClass> = {}): PublicClass {
  return {
    code: CODE,
    name: '8B Robotics',
    teacherName: 'Mr. B',
    ownerUid: 'teacher-1',
    handinsOpen: true,
    joinOpen: true,
    joinWindowAt: null,
    rejoin: {},
    students: [
      { studentId: 'ali00001', username: 'ali.k' },
      { studentId: 'sara0002', username: 'sara.m' },
      { studentId: 'zed00003', username: 'zed.z' },
    ],
    tasks: [
      { taskId: 'blink1', title: 'Blink' },
      { taskId: 'traff1', title: 'Traffic light' },
    ],
    currentTaskId: 'traff1',
    ...over,
  };
}

function session(over: Partial<StudentSession> = {}): StudentSession {
  return { code: CODE, className: '8B Robotics', teacherName: 'Mr. B', studentId: 'ali00001', username: 'ali.k', uid: 'uid-1', ...over };
}

function work(over: Partial<HandinWork> = {}): HandinWork {
  return { kind: 'code', code: 'void setup() {}\nvoid loop() {}\n', workspaceJson: '', unchanged: null, errorCount: 0, ...over };
}

function record(over: Partial<HandinRecord> = {}): HandinRecord {
  return {
    id: 'h1',
    classCode: CODE,
    uid: 'uid-1',
    studentId: 'ali00001',
    username: 'ali.k',
    kind: 'code',
    taskId: 'traff1',
    title: '',
    note: '',
    createdAt: NOW,
    content: { enc: 'plain', code: 'void setup() {}', workspace: '' },
    ...over,
  };
}

function saved(over: Partial<SavedSession> = {}): SavedSession {
  return {
    v: 1,
    code: CODE,
    className: '8B Robotics',
    teacherName: 'Mr. B',
    studentId: 'ali00001',
    username: 'ali.k',
    uid: 'uid-1',
    lastUsedAt: NOW.getTime(),
    lastHandinAt: 0,
    lastHandinTitle: '',
    ...over,
  };
}

const fail = (code: ClassroomErrorCode, message?: string) => new ClassroomError(code, message);

/** An in-memory StudentApi whose methods are spies with sensible defaults. */
function fakeApi(over: Partial<StudentApi> = {}) {
  const api: StudentApi = {
    restore: vi.fn(async (): Promise<RestoreResult | null> => null),
    findClass: vi.fn(async (): Promise<FoundClass> => ({ info: publicClass(), existing: null })),
    refreshClass: vi.fn(async () => publicClass()),
    join: vi.fn(async (cls: PublicClass, studentId: string) => {
      const entry = cls.students.find((s) => s.studentId === studentId)!;
      return session({ code: cls.code, className: cls.name, teacherName: cls.teacherName, studentId, username: entry.username });
    }),
    continueAs: vi.fn(async (found: FoundClass) => session({ studentId: found.existing!.studentId, username: found.existing!.username })),
    confirm: vi.fn(),
    handIn: vi.fn(async (_s: StudentSession, draft, id: string) => record({ id, kind: draft.kind, taskId: draft.taskId, title: draft.title, note: draft.note })),
    myHandins: vi.fn(async () => ({ items: [] as HandinRecord[], hasMore: false })),
    leave: vi.fn(async () => undefined),
    ...over,
  };
  return api;
}

interface Mounted {
  api: StudentApi;
  el: HTMLDialogElement;
  dialog: ReturnType<typeof createHandinDialog>;
  view(): HandinView | null;
  q<T extends HTMLElement>(selector: string): T;
  role<T extends HTMLElement>(name: string): T;
  button(action: string): HTMLButtonElement;
  click(action: string): void;
  text(): string;
  status(): string;
  open(w?: HandinWork, joinCode?: string): Promise<void>;
  spies: { openWork: ReturnType<typeof vi.fn>; onSessionChange: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn>; toast: ReturnType<typeof vi.fn> };
}

function mount(apiOver: Partial<StudentApi> = {}, options: Partial<HandinDialogOptions> = {}): Mounted {
  const api = fakeApi(apiOver);
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const spies = {
    openWork: vi.fn(),
    onSessionChange: vi.fn(),
    confirm: vi.fn(() => true),
    toast: vi.fn(),
  };
  const dialog = createHandinDialog(parent, { loadApi: async () => api, now: () => NOW, isOnline: () => true, ...spies, ...options });
  const el = dialog.element;
  const q = <T extends HTMLElement>(selector: string) => el.querySelector<T>(selector)!;
  const visible = () => [...el.querySelectorAll<HTMLElement>('[data-view]')].filter((v) => !v.hidden);
  return {
    api,
    el,
    dialog,
    spies,
    q,
    view: () => (visible()[0]?.dataset.view as HandinView | undefined) ?? null,
    role: <T extends HTMLElement>(name: string) => q<T>(`[data-role="${name}"]`),
    button: (action) => {
      const buttons = [...el.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`)];
      return buttons.find((b) => !b.closest('[data-view]') || !b.closest<HTMLElement>('[data-view]')!.hidden) ?? buttons[0];
    },
    click(action) {
      this.button(action).click();
    },
    text: () => visible().map((v) => v.textContent ?? '').join(' '),
    status: () => q('[data-role="status"]').textContent ?? '',
    async open(w = work(), joinCode?: string) {
      dialog.open(w, joinCode === undefined ? undefined : { joinCode });
      await settle();
    },
  };
}

function pickName(m: Mounted, username: string): void {
  const label = [...m.el.querySelectorAll<HTMLElement>('[data-role="names"] label')].find((l) => l.dataset.username === username)!;
  const input = label.querySelector('input')!;
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const listedNames = (m: Mounted) => [...m.el.querySelectorAll<HTMLElement>('[data-role="names"] label')].filter((l) => !l.hidden).map((l) => l.dataset.username);

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// S1 Code view
// ---------------------------------------------------------------------------

describe('Code view', () => {
  it('opens on the code view with the last code prefilled when nothing is saved', async () => {
    localStorage.setItem(LAST_CODE_STORAGE_KEY, CODE);
    const m = mount();
    expect(m.dialog.isOpen()).toBe(false);
    await m.open();
    expect(m.dialog.isOpen()).toBe(true);
    expect(m.api.restore).toHaveBeenCalledTimes(1);
    expect(m.view()).toBe('code');
    expect(m.q('h2').textContent).toBe('Hand in your work to your teacher');
    const input = m.q<HTMLInputElement>('#z1-handin-code');
    expect(input.value).toBe('BKT-4M9');
    expect(input.getAttribute('autocapitalize')).toBe('characters');
    expect(input.placeholder).toBe('BKT-4M9');
    expect(document.activeElement).toBe(input);
    // The footer has Close only.
    expect([...m.q('.z1-dialog-actions').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Close']);
  });

  it('refuses an invalid code inline, with the detail, and makes no request', async () => {
    const m = mount();
    await m.open();
    const input = m.q<HTMLInputElement>('#z1-handin-code');
    input.value = 'BAT-4M9';
    m.click('next');
    await settle();
    expect(m.role('code-error').textContent).toBe(
      'A class code has 6 letters and digits, like BKT-4M9. Class codes never contain the letter A. Check it with your teacher.',
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(m.api.findClass).not.toHaveBeenCalled();
    // Enter in the field is Next.
    input.value = 'bkt-4m9';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(m.api.findClass).toHaveBeenCalledWith(CODE);
    expect(m.view()).toBe('pick');
  });

  it('shows class_not_found with the code', async () => {
    const m = mount({
      findClass: vi.fn(async () => {
        throw fail('class_not_found');
      }),
    });
    await m.open();
    m.q<HTMLInputElement>('#z1-handin-code').value = 'XPW7RT';
    m.click('next');
    await settle();
    expect(m.view()).toBe('code');
    expect(m.role('code-error').textContent).toBe(errorText(STUDENT_ERROR_TEXT, 'class_not_found', { code: 'XPW-7RT' }));
    expect(m.q<HTMLInputElement>('#z1-handin-code').value).toBe('XPW-7RT');
  });

  it('shows the text of every findClass error', async () => {
    for (const code of ['handins_closed', 'offline', 'timeout', 'signup_limit', 'auth_disabled', 'storage_blocked', 'quota', 'load_failed', 'app_updated', 'unknown'] as const) {
      const m = mount({
        findClass: vi.fn(async () => {
          throw fail(code);
        }),
      });
      await m.open();
      m.q<HTMLInputElement>('#z1-handin-code').value = CODE;
      m.click('next');
      await settle();
      expect(m.role('code-error').textContent, code).toBe(errorText(STUDENT_ERROR_TEXT, code, { class: 'This class', code: formatClassCode(CODE) }));
      document.body.innerHTML = '';
    }
  });

  it('says so when the class features cannot be loaded', async () => {
    const m = mount({}, { loadApi: async () => Promise.reject(fail('load_failed')) });
    await m.open();
    expect(m.view()).toBe('error');
    expect(m.role('error-text').textContent).toBe(STUDENT_ERROR_TEXT.load_failed);
    expect(m.button('retry-open').textContent).toBe('Try again');
  });
});

// ---------------------------------------------------------------------------
// S2 Pick your name
// ---------------------------------------------------------------------------

describe('Pick view', () => {
  async function toPick(m: Mounted): Promise<void> {
    await m.open();
    m.q<HTMLInputElement>('#z1-handin-code').value = CODE;
    m.click('next');
    await settle();
    expect(m.view()).toBe('pick');
  }

  it('lists the names in order with the class heading, and enables This is me once a name is picked', async () => {
    const m = mount();
    await toPick(m);
    expect(m.role('pick-heading').textContent).toBe('Class 8B Robotics · Mr. B');
    expect(listedNames(m)).toEqual(['ali.k', 'sara.m', 'zed.z']);
    expect(m.role('filter-setting').hidden).toBe(true);
    expect(m.text()).toContain(HANDIN_TEXT.finePrint);
    expect(m.button('pick').disabled).toBe(true);
    expect(document.activeElement).toBe(m.el.querySelector('[data-role="names"] input'));
    pickName(m, 'sara.m');
    expect(m.button('pick').disabled).toBe(false);
  });

  it('adds a filter above 12 names', async () => {
    const students = Array.from({ length: FILTER_ABOVE + 1 }, (_, i) => ({ studentId: `stud000${i}`.slice(0, 8), username: `student.${String.fromCharCode(97 + i)}` }));
    const m = mount({ findClass: vi.fn(async () => ({ info: publicClass({ students }), existing: null })) });
    await toPick(m);
    const filter = m.q<HTMLInputElement>('#z1-handin-filter');
    expect(m.role('filter-setting').hidden).toBe(false);
    expect(document.activeElement).toBe(filter);
    filter.value = 'student.c';
    filter.dispatchEvent(new Event('input'));
    expect(listedNames(m)).toEqual(['student.c']);
  });

  it('Refresh the list re-reads the class and keeps the picked name', async () => {
    const m = mount();
    await toPick(m);
    pickName(m, 'sara.m');
    (m.api.refreshClass as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      publicClass({ students: [...publicClass().students, { studentId: 'new00004', username: 'new.n' }] }),
    );
    m.click('refresh');
    await settle();
    expect(m.api.refreshClass).toHaveBeenCalledWith(CODE);
    expect(listedNames(m)).toEqual(['ali.k', 'sara.m', 'zed.z', 'new.n']);
    expect(m.el.querySelector<HTMLInputElement>('[data-role="names"] input:checked')!.value).toBe('sara0002');
  });

  it('explains an empty roster', async () => {
    const m = mount({ findClass: vi.fn(async () => ({ info: publicClass({ students: [] }), existing: null })) });
    await toPick(m);
    expect(m.role('pick-empty').hidden).toBe(false);
    expect(m.role('pick-empty').textContent).toBe(HANDIN_TEXT.emptyRoster);
  });

  it('sees closed joining locally and makes no join request', async () => {
    const m = mount({ findClass: vi.fn(async () => ({ info: publicClass({ joinOpen: false }), existing: null })) });
    await toPick(m);
    pickName(m, 'ali.k');
    m.click('pick');
    await settle();
    expect(m.api.join).not.toHaveBeenCalled();
    expect(m.role('pick-error').textContent).toBe(errorText(STUDENT_ERROR_TEXT, 'class_closed', { class: '8B Robotics' }));
    expect(m.view()).toBe('pick');
  });

  it('This is me joins and lands on Ready', async () => {
    const m = mount();
    await toPick(m);
    pickName(m, 'ali.k');
    m.click('pick');
    await settle();
    expect(m.api.join).toHaveBeenCalledTimes(1);
    expect((m.api.join as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('ali00001');
    expect(m.view()).toBe('ready');
    expect(m.role('ready-heading').textContent).toBe('Hand in to 8B Robotics as ali.k');
    expect(m.button('handin').textContent).toBe('Hand in as ali.k');
    expect(m.button('handin').getAttribute('aria-label')).toBe('Hand in as ali.k');
    expect(m.spies.onSessionChange).toHaveBeenLastCalledWith('ali.k');
    expect(m.role('history').hidden).toBe(false);
  });

  it('Enter on a name is This is me; Back returns to the code', async () => {
    const m = mount();
    await toPick(m);
    pickName(m, 'zed.z');
    m.el.querySelector<HTMLInputElement>('[data-role="names"] input:checked')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(m.api.join).toHaveBeenCalledTimes(1);
    const again = mount();
    await toPick(again);
    again.click('back');
    expect(again.view()).toBe('code');
    expect(again.q<HTMLInputElement>('#z1-handin-code').value).toBe('BKT-4M9');
  });

  it('reloads the list when the name was removed meanwhile, and shows the other join errors', async () => {
    const m = mount({
      join: vi.fn(async () => {
        throw fail('not_on_roster');
      }),
    });
    await toPick(m);
    pickName(m, 'ali.k');
    m.click('pick');
    await settle();
    expect(m.api.refreshClass).toHaveBeenCalledTimes(1);
    expect(m.role('pick-error').textContent).toBe(STUDENT_ERROR_TEXT.not_on_roster);
    for (const code of ['class_closed', 'handins_closed', 'offline', 'timeout', 'quota', 'permission', 'unknown'] as const) {
      (m.api.join as ReturnType<typeof vi.fn>).mockRejectedValueOnce(fail(code));
      m.click('pick');
      await settle();
      expect(m.role('pick-error').textContent, code).toBe(errorText(STUDENT_ERROR_TEXT, code, { class: '8B Robotics' }));
    }
  });

  it('S2b: a computer that already joined can continue or sign out', async () => {
    const m = mount({ findClass: vi.fn(async () => ({ info: publicClass(), existing: { studentId: 'sara0002', username: 'sara.m' } })) });
    await m.open();
    m.q<HTMLInputElement>('#z1-handin-code').value = CODE;
    m.click('next');
    await settle();
    expect(m.view()).toBe('already');
    expect(m.role('already-text').textContent).toBe('This computer already joined 8B Robotics as sara.m.');
    expect(m.button('continue').textContent).toBe('Continue as sara.m');
    expect(m.button('signout').textContent).toBe('Not sara.m? Sign out');
    m.click('continue');
    await settle();
    expect(m.api.continueAs).toHaveBeenCalledTimes(1);
    expect(m.view()).toBe('ready');
    expect(m.role('ready-heading').textContent).toBe('Hand in to 8B Robotics as sara.m');
  });
});

// ---------------------------------------------------------------------------
// S0 Class link (join mode)
// ---------------------------------------------------------------------------

describe('#class= join mode', () => {
  it('looks the class up straight away and ends with the joined text', async () => {
    const m = mount();
    await m.open(work(), CODE);
    expect(m.api.findClass).toHaveBeenCalledWith(CODE);
    expect(m.view()).toBe('pick');
    pickName(m, 'ali.k');
    m.click('pick');
    await settle();
    expect(m.view()).toBe('joined');
    expect(m.role('joined-text').textContent).toBe("You're in 8B Robotics as ali.k. Work as usual and press Hand in when you're done.");
    m.click('ok');
    expect(m.dialog.isOpen()).toBe(false);
  });

  it('goes to Confirm when this computer is already in that class', async () => {
    const m = mount({ restore: vi.fn(async () => ({ session: session(), info: publicClass(), confirm: null, lastHandin: null })) });
    await m.open(work(), CODE);
    expect(m.api.findClass).not.toHaveBeenCalled();
    expect(m.view()).toBe('confirm');
    expect(m.role('confirm-text').textContent).toBe('Hand in to 8B Robotics (Mr. B) as ali.k?');
  });

  it('asks before switching from another class', async () => {
    const m = mount({
      restore: vi.fn(async () => ({ session: session({ code: OTHER_CODE, className: '7B Robotics' }), info: publicClass({ code: OTHER_CODE, name: '7B Robotics' }), confirm: null, lastHandin: null })),
    });
    await m.open(work(), CODE);
    expect(m.view()).toBe('switch');
    expect(m.role('switch-text').textContent).toBe('This computer is in 7B Robotics as ali.k. Switch to 8B Robotics?');
    m.click('switch');
    await settle();
    expect(m.api.leave).toHaveBeenCalledTimes(1);
    expect(m.spies.onSessionChange).toHaveBeenLastCalledWith('');
    expect(m.view()).toBe('pick');
    expect(m.role('pick-heading').textContent).toBe('Class 8B Robotics · Mr. B');
  });

  it('Cancel keeps the current class', async () => {
    const m = mount({
      restore: vi.fn(async () => ({ session: session({ code: OTHER_CODE, className: '7B Robotics' }), info: publicClass({ code: OTHER_CODE, name: '7B Robotics' }), confirm: null, lastHandin: null })),
    });
    await m.open(work(), CODE);
    m.click('cancel');
    expect(m.api.leave).not.toHaveBeenCalled();
    expect(m.view()).toBe('ready');
    expect(m.role('ready-heading').textContent).toBe('Hand in to 7B Robotics as ali.k');
  });

  it('shows a bad link code on the code view', async () => {
    const m = mount({
      findClass: vi.fn(async () => {
        throw fail('class_not_found');
      }),
    });
    await m.open(work(), 'XPW7RT');
    expect(m.view()).toBe('code');
    expect(m.q<HTMLInputElement>('#z1-handin-code').value).toBe('XPW-7RT');
    expect(m.role('code-error').textContent).toContain('XPW-7RT');
  });
});

// ---------------------------------------------------------------------------
// S5 Confirm, S6 Sign out
// ---------------------------------------------------------------------------

describe('Confirm view', () => {
  const restoring = (confirm: RestoreResult['confirm']) => ({
    restore: vi.fn(async () => ({ session: session(), info: publicClass(), confirm, lastHandin: null })),
  });

  it('is shown for a new tab and a stale session, with My hand-ins hidden until confirmed', async () => {
    for (const reason of ['new_tab', 'stale'] as const) {
      const m = mount(restoring(reason));
      await m.open();
      expect(m.view(), reason).toBe('confirm');
      expect(m.role('history').hidden, reason).toBe(true);
      expect(m.button('yes').textContent).toBe("Yes, I'm ali.k");
      expect(m.spies.onSessionChange).toHaveBeenLastCalledWith('ali.k');
      document.body.innerHTML = '';
    }
    const m = mount(restoring(null));
    await m.open();
    expect(m.view()).toBe('ready');
    expect(m.role('history').hidden).toBe(false);
  });

  it('Yes confirms and opens Ready', async () => {
    const m = mount(restoring('new_tab'));
    await m.open();
    m.click('yes');
    expect(m.api.confirm).toHaveBeenCalledWith(session());
    expect(m.view()).toBe('ready');
    expect(m.role('history').hidden).toBe(false);
  });

  it('someone else keeps the code, Different class forgets it', async () => {
    const m = mount(restoring('new_tab'));
    await m.open();
    m.click('other');
    await settle();
    expect(m.api.leave).toHaveBeenLastCalledWith({ forgetCode: false });
    expect(m.view()).toBe('code');
    expect(m.q<HTMLInputElement>('#z1-handin-code').value).toBe('BKT-4M9');
    expect(m.spies.onSessionChange).toHaveBeenLastCalledWith('');

    const n = mount(restoring('stale'));
    await n.open();
    n.click('different');
    await settle();
    expect(n.api.leave).toHaveBeenLastCalledWith({ forgetCode: true });
    expect(n.view()).toBe('code');
    expect(n.q<HTMLInputElement>('#z1-handin-code').value).toBe('');
  });

  it('Sign out asks first, then returns to the code view', async () => {
    const m = mount(restoring(null));
    await m.open();
    m.spies.confirm.mockReturnValueOnce(false);
    m.click('signout');
    await settle();
    expect(m.spies.confirm).toHaveBeenCalledWith(HANDIN_TEXT.signOut('8B Robotics'));
    expect(m.api.leave).not.toHaveBeenCalled();
    expect(m.view()).toBe('ready');
    m.click('signout');
    await settle();
    expect(m.api.leave).toHaveBeenCalledWith({ forgetCode: false });
    expect(m.view()).toBe('code');
  });

  it('shows the restore errors with their buttons', async () => {
    const cases: [ClassroomErrorCode, string, string][] = [
      ['device_removed', 'rejoin', 'Join again'],
      ['not_on_roster', 'pick-again', 'Pick your name again'],
      ['class_deleted', 'ok', 'OK'],
      ['handins_closed', 'different', 'Different class'],
      ['offline', 'retry-open', 'Try again'],
    ];
    for (const [code, action, label] of cases) {
      const m = mount({
        restore: vi.fn(async () => {
          throw fail(code);
        }),
      });
      await m.open();
      expect(m.view(), code).toBe('error');
      expect(m.role('error-text').textContent, code).toBe(errorText(STUDENT_ERROR_TEXT, code, { class: 'This class' }));
      expect(m.button(action).textContent, code).toBe(label);
      document.body.innerHTML = '';
    }
  });

  it('lost_identity goes to the code view with the code prefilled', async () => {
    localStorage.setItem(LAST_CODE_STORAGE_KEY, CODE);
    const m = mount({
      restore: vi.fn(async () => {
        throw fail('lost_identity');
      }),
    });
    await m.open();
    expect(m.view()).toBe('code');
    expect(m.q<HTMLInputElement>('#z1-handin-code').value).toBe('BKT-4M9');
    expect(m.role('code-error').textContent).toBe(STUDENT_ERROR_TEXT.lost_identity);
  });

  it('Join again after the computer was removed picks a name with the same sign-in', async () => {
    localStorage.setItem(LAST_CODE_STORAGE_KEY, CODE);
    const m = mount({
      restore: vi.fn(async () => {
        throw fail('device_removed');
      }),
    });
    await m.open();
    m.click('rejoin');
    await settle();
    expect(m.api.leave).not.toHaveBeenCalled();
    expect(m.api.findClass).toHaveBeenCalledWith(CODE);
    expect(m.view()).toBe('pick');
  });

  it('Try again retries the opening', async () => {
    const restore = vi.fn(async (): Promise<RestoreResult | null> => {
      throw fail('offline');
    });
    const m = mount({ restore });
    await m.open();
    restore.mockResolvedValueOnce(null);
    m.click('retry-open');
    await settle();
    expect(restore).toHaveBeenCalledTimes(2);
    expect(m.view()).toBe('code');
  });
});

// ---------------------------------------------------------------------------
// S3 Ready, S4 Success
// ---------------------------------------------------------------------------

describe('Ready view', () => {
  const ready = (over: Partial<StudentApi> = {}, w: HandinWork = work(), restore: Partial<RestoreResult> = {}) => {
    const m = mount({
      restore: vi.fn(async () => ({ session: session(), info: publicClass(), confirm: null, lastHandin: null, ...restore })),
      ...over,
    });
    return m.open(w).then(() => m);
  };

  it('describes the work, preselects the current task and focuses it', async () => {
    const m = await ready();
    expect(m.view()).toBe('ready');
    expect(m.role('work').textContent).toBe('Your Arduino sketch, 3 lines');
    const task = m.q<HTMLSelectElement>('#z1-handin-task');
    expect(m.role('task-setting').hidden).toBe(false);
    expect([...task.options].map((o) => o.textContent)).toEqual(['(no task)', 'Blink', 'Traffic light']);
    expect(task.value).toBe('traff1');
    expect(document.activeElement).toBe(task);
    expect(m.role('last').hidden).toBe(true);
    expect(m.q<HTMLInputElement>('#z1-handin-work-title').getAttribute('maxlength')).toBe(String(LIMITS.titleMax));
    expect(m.q<HTMLTextAreaElement>('#z1-handin-note').getAttribute('maxlength')).toBe(String(LIMITS.noteMax));
    expect(m.q('[data-role="ready-signout"]').textContent).toBe('Not ali.k? Sign out');
  });

  it('describes a blocks program, hides the task select without tasks and shows the last hand-in', async () => {
    const m = await ready({}, work({ kind: 'blocks', workspaceJson: '{"blocks":{}}' }), {
      info: publicClass({ tasks: [], currentTaskId: '' }),
      lastHandin: { at: NOW.getTime() - 60_000, title: 'Traffic light' },
    });
    expect(m.role('work').textContent).toBe('Your blocks program and the Arduino sketch made from it');
    expect(m.role('task-setting').hidden).toBe(true);
    expect(document.activeElement).toBe(m.q('#z1-handin-work-title'));
    expect(m.role('last').textContent).toBe(`Last handed in: today ${new Date(NOW.getTime() - 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Traffic light`);
  });

  it('refuses an empty sketch, too large work and an offline browser without a request', async () => {
    const m = await ready({}, work({ code: '   ' }));
    m.click('handin');
    await settle();
    expect(m.status()).toBe(STUDENT_ERROR_TEXT.empty_sketch);

    const big = await ready({}, work({ code: 'x'.repeat(LIMITS.codeMaxBytes + 1) }));
    big.click('handin');
    await settle();
    expect(big.status()).toBe(STUDENT_ERROR_TEXT.too_large);

    const off = mount({ restore: vi.fn(async () => ({ session: session(), info: publicClass(), confirm: null, lastHandin: null })) }, { isOnline: () => false });
    await off.open();
    off.click('handin');
    await settle();
    expect(off.status()).toBe(STUDENT_ERROR_TEXT.offline);

    const soon = await ready({}, work(), { lastHandin: { at: NOW.getTime() - 3_000, title: '' } });
    soon.click('handin');
    await settle();
    expect(soon.status()).toBe(STUDENT_ERROR_TEXT.too_soon);

    for (const x of [m, big, off, soon]) expect(x.api.handIn, 'no request').not.toHaveBeenCalled();
  });

  it('needs a second click for an untouched example or the blank sketch, and notes the errors', async () => {
    const m = await ready({}, work({ unchanged: { kind: 'example', title: 'Blink' }, errorCount: 2 }));
    expect(m.role('warning').textContent).toBe("This is still the example 'Blink'. Hand it in anyway?");
    expect(m.role('errors-note').textContent).toBe('Your sketch has 2 errors. Your teacher will see them.');
    m.click('handin');
    await settle();
    expect(m.api.handIn).not.toHaveBeenCalled();
    expect(m.button('handin').textContent).toBe('Hand in anyway');
    m.click('handin');
    await settle();
    expect(m.api.handIn).toHaveBeenCalledTimes(1);
    expect(m.view()).toBe('success');

    const blank = await ready({}, work({ unchanged: { kind: 'blank' }, errorCount: 1 }));
    expect(blank.role('warning').textContent).toBe(HANDIN_TEXT.blank);
    expect(blank.role('errors-note').textContent).toBe('Your sketch has 1 error. Your teacher will see them.');
    const plain = await ready();
    expect(plain.role('warning').hidden).toBe(true);
    expect(plain.role('errors-note').hidden).toBe(true);
  });

  it('hands in with the fields, shows the success view and sends once on a double click', async () => {
    const m = await ready({}, work({ kind: 'blocks', workspaceJson: '{"blocks":{}}' }));
    m.q<HTMLInputElement>('#z1-handin-work-title').value = 'My lights';
    m.q<HTMLTextAreaElement>('#z1-handin-note').value = 'Please check';
    m.click('handin');
    m.click('handin');
    expect(m.button('handin').disabled).toBe(true);
    expect(m.button('handin').textContent).toBe(HANDIN_TEXT.handingIn);
    await settle();
    expect(m.api.handIn).toHaveBeenCalledTimes(1);
    const [s, draft, id] = (m.api.handIn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(s).toEqual(session());
    expect(draft).toEqual({ kind: 'blocks', code: work().code, workspaceJson: '{"blocks":{}}', taskId: 'traff1', title: 'My lights', note: 'Please check' });
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(m.view()).toBe('success');
    const time = NOW.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(m.role('success-text').textContent).toBe(`✓ Handed in · Traffic light · Blocks · ${time}. Your teacher can see it now.`);
    expect([...m.el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.closest('[hidden]')).map((b) => b.textContent)).toEqual([
      'My hand-ins',
      'Leaving? Sign out of the class on this computer',
      'My hand-ins from this computer',
      'Close',
    ].filter((t) => t !== 'My hand-ins from this computer'));
    expect(document.activeElement).toBe(m.button('close'));

    // The next Hand in keeps the title and task, clears the note, and uses a new id.
    m.dialog.close();
    await m.open(work({ kind: 'blocks', workspaceJson: '{"blocks":{}}' }));
    expect(m.view()).toBe('ready');
    expect(m.q<HTMLInputElement>('#z1-handin-work-title').value).toBe('My lights');
    expect(m.q<HTMLTextAreaElement>('#z1-handin-note').value).toBe('');
    expect(m.q<HTMLSelectElement>('#z1-handin-task').value).toBe('traff1');
    expect(m.status()).toBe(HANDIN_TEXT.again);
    m.click('handin');
    await settle();
    expect((m.api.handIn as ReturnType<typeof vi.fn>).mock.calls[1][2]).not.toBe(id);
  });

  it('uses the title when there is no task', async () => {
    const m = await ready({}, work(), { info: publicClass({ tasks: [], currentTaskId: '' }) });
    m.q<HTMLInputElement>('#z1-handin-work-title').value = 'Disco';
    m.click('handin');
    await settle();
    expect(m.role('success-text').textContent).toMatch(/^✓ Handed in · Disco · Code · /);
  });

  it('says "Checking whether it arrived…" after the request timeout, then success when it did arrive', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let resolve!: (r: HandinRecord) => void;
    const m = await ready({ handIn: vi.fn(() => new Promise<HandinRecord>((r) => (resolve = r))) });
    m.click('handin');
    await Promise.resolve();
    expect(m.status()).toBe(HANDIN_TEXT.handingIn);
    vi.advanceTimersByTime(LIMITS.requestTimeoutMs);
    expect(m.status()).toBe(HANDIN_TEXT.checking);
    resolve(record());
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(m.view()).toBe('success');
  });

  it('Try again after a timeout reuses the same hand-in id', async () => {
    const handIn = vi.fn(async (_s: StudentSession, _d: unknown, id: string) => record({ id }));
    handIn.mockRejectedValueOnce(fail('timeout'));
    const m = await ready({ handIn: handIn as unknown as StudentApi['handIn'] });
    m.click('handin');
    await settle();
    expect(m.view()).toBe('ready');
    expect(m.status()).toBe(`${HANDIN_TEXT.notArrived} ${STUDENT_ERROR_TEXT.timeout}`);
    expect(m.button('retry').hidden).toBe(false);
    expect(document.activeElement).toBe(m.button('retry'));
    m.click('retry');
    await settle();
    expect(handIn).toHaveBeenCalledTimes(2);
    expect(handIn.mock.calls[0][2]).toBe(handIn.mock.calls[1][2]);
    expect(m.view()).toBe('success');
  });

  it('shows every hand-in error with its §1.5 text', async () => {
    const inline: ClassroomErrorCode[] = ['too_soon', 'limit_reached', 'offline', 'timeout', 'quota', 'permission', 'index_missing', 'unknown'];
    for (const code of inline) {
      const m = await ready({
        handIn: vi.fn(async () => {
          throw fail(code);
        }),
      });
      m.click('handin');
      await settle();
      expect(m.view(), code).toBe('ready');
      expect(m.status(), code).toContain(errorText(STUDENT_ERROR_TEXT, code, { class: '8B Robotics' }));
      expect(m.button('handin').disabled, code).toBe(false);
      document.body.innerHTML = '';
    }
    const withButton: [ClassroomErrorCode, string, string][] = [
      ['not_on_roster', 'pick-again', 'Pick your name again'],
      ['device_removed', 'rejoin', 'Join again'],
      ['class_deleted', 'different', 'Different class'],
      ['handins_closed', 'different', 'Different class'],
    ];
    for (const [code, action, label] of withButton) {
      const m = await ready({
        handIn: vi.fn(async () => {
          throw fail(code);
        }),
      });
      m.click('handin');
      await settle();
      expect(m.view(), code).toBe('error');
      expect(m.role('error-text').textContent, code).toBe(errorText(STUDENT_ERROR_TEXT, code, { class: '8B Robotics' }));
      expect(m.button(action).textContent, code).toBe(label);
      document.body.innerHTML = '';
    }
  });

  it('Pick your name again signs out with the code kept; Different class forgets it', async () => {
    const m = await ready({
      handIn: vi.fn(async () => {
        throw fail('not_on_roster');
      }),
    });
    m.click('handin');
    await settle();
    m.click('pick-again');
    await settle();
    expect(m.api.leave).toHaveBeenCalledWith({ forgetCode: false });
    expect(m.view()).toBe('code');
    expect(m.q<HTMLInputElement>('#z1-handin-code').value).toBe('BKT-4M9');
  });

  it('asks to pick the task again when it was deleted meanwhile', async () => {
    const m = await ready({
      handIn: vi.fn(async () => {
        throw fail('permission', 'task');
      }),
      refreshClass: vi.fn(async () => publicClass({ tasks: [{ taskId: 'blink1', title: 'Blink' }], currentTaskId: '' })),
    });
    m.click('handin');
    await settle();
    expect(m.status()).toBe(HANDIN_TEXT.taskGone);
    expect([...m.q<HTMLSelectElement>('#z1-handin-task').options].map((o) => o.textContent)).toEqual(['(no task)', 'Blink']);
  });

  it('takes a rename by the teacher from the returned record', async () => {
    const m = await ready({ handIn: vi.fn(async (_s, _d, id: string) => record({ id, username: 'ali.kh' })) });
    m.click('handin');
    await settle();
    expect(m.spies.onSessionChange).toHaveBeenLastCalledWith('ali.kh');
    // The next opening (restore() refreshes the name from the class) shows it in the heading.
    (m.api.restore as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ session: session({ username: 'ali.kh' }), info: publicClass(), confirm: null, lastHandin: null });
    m.dialog.close();
    await m.open();
    expect(m.role('ready-heading').textContent).toBe('Hand in to 8B Robotics as ali.kh');
  });

  it('ignores an answer that arrives after the dialog was closed', async () => {
    let resolve!: (r: HandinRecord) => void;
    const m = await ready({ handIn: vi.fn(() => new Promise<HandinRecord>((r) => (resolve = r))) });
    m.click('handin');
    await settle();
    m.click('close');
    expect(m.dialog.isOpen()).toBe(false);
    resolve(record());
    await settle();
    expect(m.view()).toBe('ready');
    expect(m.spies.toast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// S7 My hand-ins
// ---------------------------------------------------------------------------

describe('My hand-ins', () => {
  const restored = { restore: vi.fn(async () => ({ session: session(), info: publicClass(), confirm: null, lastHandin: null })) };

  it('loads lazily when opened, pages with Show more, and Open hands the work to the app', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => record({ id: `h${i}`, title: `v${i}`, taskId: '', createdAt: new Date(NOW.getTime() - i * 60_000) }));
    const page2 = [record({ id: 'old', kind: 'blocks', taskId: 'blink1', content: { enc: 'plain', code: 'void setup() {}', workspace: '{"blocks":{}}' } })];
    const myHandins = vi.fn(async (_s: StudentSession, page?: { before?: Date }) => (page ? { items: page2, hasMore: false } : { items: page1, hasMore: true }));
    const m = mount({ ...restored, myHandins });
    await m.open();
    expect(myHandins).not.toHaveBeenCalled();
    const history = m.role<HTMLDetailsElement>('history');
    expect(history.open).toBe(false);
    expect(history.querySelector('summary')!.textContent).toBe('My hand-ins from this computer');
    history.open = true;
    history.dispatchEvent(new Event('toggle'));
    await settle();
    expect(myHandins).toHaveBeenCalledTimes(1);
    const rows = () => [...m.el.querySelectorAll('[data-role="history-rows"] li')];
    expect(rows()).toHaveLength(20);
    expect(rows()[0].textContent).toContain('v0');
    expect(rows()[0].querySelector('.z1-handin-kind')!.textContent).toBe('Code');
    expect(m.button('more').hidden).toBe(false);
    m.click('more');
    await settle();
    expect(myHandins.mock.calls[1][1]).toEqual({ before: page1[19].createdAt });
    expect(rows()).toHaveLength(21);
    expect(rows()[20].textContent).toContain('Blink');
    expect(rows()[20].querySelector('.z1-handin-kind')!.textContent).toBe('Blocks');
    expect(m.button('more').hidden).toBe(true);

    rows()[20].querySelector<HTMLButtonElement>('[data-action="open"]')!.click();
    await settle();
    expect(m.spies.openWork).toHaveBeenCalledWith({ kind: 'blocks', code: 'void setup() {}', workspaceJson: '{"blocks":{}}' });
    expect(m.dialog.isOpen()).toBe(false);
  });

  it('says when nothing was handed in yet, and the success button opens it', async () => {
    const m = mount(restored);
    await m.open();
    m.click('handin');
    await settle();
    expect(m.view()).toBe('success');
    m.click('history');
    await settle();
    expect(m.role<HTMLDetailsElement>('history').open).toBe(true);
    expect(m.api.myHandins).toHaveBeenCalledTimes(1);
    expect(m.role('history-status').textContent).toBe(HANDIN_TEXT.noHistory);
  });

  it('shows "(no title)" and the history error text', async () => {
    const m = mount({
      ...restored,
      myHandins: vi.fn(async () => ({ items: [record({ taskId: '', title: '' })], hasMore: false })),
    });
    await m.open();
    m.click('history');
    await settle();
    expect(m.el.querySelector('.z1-handin-what')!.textContent).toBe('(no title)');
    const n = mount({
      ...restored,
      myHandins: vi.fn(async () => {
        throw fail('index_missing');
      }),
    });
    await n.open();
    n.click('history');
    await settle();
    expect(n.role('history-status').textContent).toBe(STUDENT_ERROR_TEXT.index_missing);
  });
});

// ---------------------------------------------------------------------------
// Rendering safety and session storage
// ---------------------------------------------------------------------------

describe('rendering', () => {
  const payloads = ['<img src=x onerror=alert(1)>', '</script><b>x</b>'];

  it('renders class, teacher, task, user names and titles as text', async () => {
    for (const p of payloads) {
      const cls = publicClass({ name: p, teacherName: p, students: [{ studentId: 'ali00001', username: p }], tasks: [{ taskId: 'task01', title: p }], currentTaskId: 'task01' });
      const m = mount({
        findClass: vi.fn(async () => ({ info: cls, existing: null })),
        join: vi.fn(async () => session({ className: p, teacherName: p, username: p })),
        myHandins: vi.fn(async () => ({ items: [record({ title: p, taskId: '' })], hasMore: false })),
      });
      await m.open();
      m.q<HTMLInputElement>('#z1-handin-code').value = CODE;
      m.click('next');
      await settle();
      expect(m.role('pick-heading').textContent).toBe(`Class ${p} · ${p}`);
      pickName(m, p);
      m.click('pick');
      await settle();
      expect(m.role('ready-heading').textContent).toBe(`Hand in to ${p} as ${p}`);
      expect(m.q<HTMLSelectElement>('#z1-handin-task').options[1].textContent).toBe(p);
      m.click('history');
      await settle();
      expect(m.el.querySelector('.z1-handin-what')!.textContent).toBe(p);
      expect(m.el.querySelector('img')).toBeNull();
      // The only <b>s are the dialog's own emphasis; the payload's <b>x</b> never becomes an element.
      for (const b of m.el.querySelectorAll('b')) expect([p, 'Hand in']).toContain(b.textContent);
      document.body.innerHTML = '';
    }
  });

  it('reads nothing from the class session store itself while restore() says who is signed in', async () => {
    saveSession(saved({ lastHandinAt: NOW.getTime() - 120_000, lastHandinTitle: 'Blink' }));
    const m = mount({
      restore: vi.fn(async () => ({ session: session(), info: publicClass(), confirm: null, lastHandin: { at: NOW.getTime() - 120_000, title: 'Blink' } })),
    });
    await m.open();
    expect(m.role('last').textContent).toContain('Blink');
    expect(localStorage.getItem(CLASSROOM_STORAGE_KEY)).not.toBeNull();
  });
});
