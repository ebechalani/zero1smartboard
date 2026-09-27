// @vitest-environment happy-dom
/**
 * Hand in dialog tests (happy-dom, docs/CLASSROOM.md §7.3): the student flow (code → name →
 * Hand in), the remembered "Hand in as … / Change" view, the success view and the errors,
 * against an in-memory fake StudentApi whose methods are spies. No Firebase is loaded:
 * `loadApi` resolves to the fake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassroomError, STUDENT_ERROR_TEXT, errorText, type ClassroomErrorCode } from '../src/classroom/errors';
import { LIMITS, formatClassCode, type HandinRecord } from '../src/classroom/model';
import { CLASSROOM_STORAGE_KEY, LAST_CODE_STORAGE_KEY, saveSession, type SavedSession } from '../src/classroom/session-store';
import type { FoundClass, PublicClass, RestoreResult, StudentApi, StudentName, StudentSession } from '../src/classroom/student';
import { HANDIN_TEXT, createHandinDialog, type HandinDialogOptions, type HandinView, type HandinWork } from '../src/ui/handin-dialog';
import { settle } from './helpers';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CODE = 'BKT4M9';
const NOW = new Date(2026, 8, 28, 14, 32, 0);
const TIME = NOW.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function publicClass(over: Partial<PublicClass> = {}): PublicClass {
  return { code: CODE, name: '8B Robotics', ownerUid: 'teacher-1', handinsOpen: true, ...over };
}

function session(over: Partial<StudentSession> = {}): StudentSession {
  return { code: CODE, className: '8B Robotics', firstName: 'Ali', lastName: 'Khoury', uid: 'uid-1', ...over };
}

function work(over: Partial<HandinWork> = {}): HandinWork {
  return { kind: 'code', code: 'void setup() {}\nvoid loop() {}\n', workspaceJson: '', unchanged: null, errorCount: 0, ...over };
}

function record(over: Partial<HandinRecord> = {}): HandinRecord {
  return {
    id: 'h1',
    classCode: CODE,
    uid: 'uid-1',
    firstName: 'Ali',
    lastName: 'Khoury',
    nameKey: 'ali khoury',
    kind: 'code',
    createdAt: NOW,
    content: { enc: 'plain', code: 'void setup() {}', workspace: '' },
    ...over,
  };
}

function saved(over: Partial<SavedSession> = {}): SavedSession {
  return { v: 2, code: CODE, className: '8B Robotics', firstName: 'Ali', lastName: 'Khoury', uid: 'uid-1', lastUsedAt: NOW.getTime(), lastHandinAt: 0, ...over };
}

const restored = (over: Partial<RestoreResult> = {}): RestoreResult => ({ session: session(), info: publicClass(), lastHandinAt: null, ...over });
const fail = (code: ClassroomErrorCode, message?: string) => new ClassroomError(code, message);

/** An in-memory StudentApi whose methods are spies with sensible defaults. */
function fakeApi(over: Partial<StudentApi> = {}) {
  const api: StudentApi = {
    restore: vi.fn(async (): Promise<RestoreResult | null> => null),
    findClass: vi.fn(async (): Promise<FoundClass> => ({ info: publicClass(), existing: null })),
    join: vi.fn(async (found: FoundClass, name: StudentName) => session({ code: found.info.code, className: found.info.name, firstName: name.firstName.trim(), lastName: name.lastName.trim() })),
    handIn: vi.fn(async (s: StudentSession, draft, id: string) => record({ id, kind: draft.kind, firstName: s.firstName, lastName: s.lastName })),
    forget: vi.fn(),
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
  /** Type the code and press Next (the name view follows). */
  toName(code?: string): Promise<void>;
  typeName(first: string, last: string): void;
  spies: { onSessionChange: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn>; toast: ReturnType<typeof vi.fn> };
}

function mount(apiOver: Partial<StudentApi> = {}, options: Partial<HandinDialogOptions> = {}): Mounted {
  const api = fakeApi(apiOver);
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const spies = { onSessionChange: vi.fn(), confirm: vi.fn(() => true), toast: vi.fn() };
  const dialog = createHandinDialog(parent, { loadApi: async () => api, now: () => NOW, isOnline: () => true, ...spies, ...options });
  const el = dialog.element;
  const q = <T extends HTMLElement>(selector: string) => el.querySelector<T>(selector)!;
  const visible = () => [...el.querySelectorAll<HTMLElement>('[data-view]')].filter((v) => !v.hidden);
  const m: Mounted = {
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
    async toName(code = CODE) {
      q<HTMLInputElement>('#z1-handin-code').value = code;
      m.click('next');
      await settle();
    },
    typeName(first, last) {
      q<HTMLInputElement>('#z1-handin-first').value = first;
      q<HTMLInputElement>('#z1-handin-last').value = last;
    },
  };
  return m;
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Code view
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
    expect(m.q('h2').textContent).toBe(HANDIN_TEXT.title);
    const input = m.q<HTMLInputElement>('#z1-handin-code');
    expect(input.value).toBe('BKT-4M9');
    expect(input.getAttribute('autocapitalize')).toBe('characters');
    expect(input.placeholder).toBe('BKT-4M9');
    expect(document.activeElement).toBe(input);
    // The footer has Close only; the work block is hidden here.
    expect([...m.q('.z1-dialog-actions').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Close']);
    expect(m.role('work-block').hidden).toBe(true);
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
    expect(m.view()).toBe('name');
  });

  it('shows class_not_found with the code', async () => {
    const m = mount({
      findClass: vi.fn(async () => {
        throw fail('class_not_found');
      }),
    });
    await m.open();
    await m.toName('XPW7RT');
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
      await m.toName();
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

  it('a #class= link prefills the code without a restore; the remembered class of that link opens Ready', async () => {
    const m = mount();
    await m.open(work(), CODE);
    expect(m.api.restore).not.toHaveBeenCalled();
    expect(m.view()).toBe('code');
    expect(m.q<HTMLInputElement>('#z1-handin-code').value).toBe('BKT-4M9');

    saveSession(saved());
    const n = mount({ restore: vi.fn(async () => restored()) });
    await n.open(work(), CODE);
    expect(n.api.restore).toHaveBeenCalledTimes(1);
    expect(n.view()).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// Name view
// ---------------------------------------------------------------------------

describe('Name view', () => {
  it('shows the class, the work and two name fields; Back returns to the code', async () => {
    const m = mount();
    await m.open(work({ kind: 'blocks', workspaceJson: '{"blocks":{}}' }));
    await m.toName();
    expect(m.role('name-heading').textContent).toBe('Class 8B Robotics');
    expect(m.text()).toContain(HANDIN_TEXT.nameHelp);
    expect(m.role('work-block').hidden).toBe(false);
    expect(m.role('work').textContent).toBe('Your blocks program and the Arduino sketch made from it');
    expect(document.activeElement).toBe(m.q('#z1-handin-first'));
    expect(m.q<HTMLInputElement>('#z1-handin-first').getAttribute('maxlength')).toBe(String(LIMITS.nameMax));
    expect(m.button('handin-name').textContent).toBe('Hand in');
    m.click('back');
    expect(m.view()).toBe('code');
    expect(m.q<HTMLInputElement>('#z1-handin-code').value).toBe('BKT-4M9');
  });

  it('prefills the name this computer gave before (member doc first, then the saved session)', async () => {
    const m = mount({ findClass: vi.fn(async () => ({ info: publicClass(), existing: { firstName: 'Sara', lastName: 'Mansour' } })) });
    await m.open();
    await m.toName();
    expect(m.q<HTMLInputElement>('#z1-handin-first').value).toBe('Sara');
    expect(m.q<HTMLInputElement>('#z1-handin-last').value).toBe('Mansour');
    saveSession(saved({ code: 'XPW7RT' }));
    const n = mount();
    await n.open(work(), CODE);
    await n.toName();
    expect(n.q<HTMLInputElement>('#z1-handin-first').value).toBe('Ali');
    expect(n.q<HTMLInputElement>('#z1-handin-last').value).toBe('Khoury');
  });

  it('Hand in joins with the typed name, then sends, and shows the success view', async () => {
    const m = mount();
    await m.open();
    await m.toName();
    m.typeName(' Élise ', "O'Neil");
    m.click('handin-name');
    await settle();
    expect(m.api.join).toHaveBeenCalledTimes(1);
    const [found, name] = (m.api.join as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(found).toEqual({ info: publicClass(), existing: null });
    expect(name).toEqual({ firstName: ' Élise ', lastName: "O'Neil" });
    expect(m.api.handIn).toHaveBeenCalledTimes(1);
    const [s, draft, id] = (m.api.handIn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(s).toEqual(session({ firstName: 'Élise', lastName: "O'Neil" }));
    expect(draft).toEqual({ kind: 'code', code: work().code, workspaceJson: '' });
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(m.spies.onSessionChange).toHaveBeenLastCalledWith("Élise O'Neil");
    expect(m.view()).toBe('success');
    expect(m.role('success-text').textContent).toBe(`✓ Handed in · ${TIME} · Your teacher can see it now.`);
    expect([...m.el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.closest('[hidden]')).map((b) => b.textContent)).toEqual(['Close']);
    expect(document.activeElement).toBe(m.button('close'));
  });

  it('Enter in a name field hands in', async () => {
    const m = mount();
    await m.open();
    await m.toName();
    m.typeName('Ali', 'Khoury');
    m.q('#z1-handin-last').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(m.api.join).toHaveBeenCalledTimes(1);
    expect(m.view()).toBe('success');
  });

  it('shows bad_name and the other join errors inline, and stays on the name view', async () => {
    const m = mount({
      join: vi.fn(async () => {
        throw fail('bad_name');
      }),
    });
    await m.open();
    await m.toName();
    m.click('handin-name');
    await settle();
    expect(m.view()).toBe('name');
    expect(m.role('name-error').textContent).toBe(STUDENT_ERROR_TEXT.bad_name);
    expect(document.activeElement).toBe(m.q('#z1-handin-first'));
    expect(m.api.handIn).not.toHaveBeenCalled();
    for (const code of ['handins_closed', 'class_not_found', 'offline', 'timeout', 'quota', 'permission', 'unknown'] as const) {
      (m.api.join as ReturnType<typeof vi.fn>).mockRejectedValueOnce(fail(code));
      m.click('handin-name');
      await settle();
      expect(m.role('name-error').textContent, code).toBe(errorText(STUDENT_ERROR_TEXT, code, { class: '8B Robotics', code: 'BKT-4M9' }));
    }
    // Typing clears the message.
    m.q('#z1-handin-first').dispatchEvent(new Event('input'));
    expect(m.role('name-error').textContent).toBe('');
  });

  it('runs the local checks before joining: empty sketch, too large, offline, and the untouched-example confirm', async () => {
    const m = mount();
    await m.open(work({ code: '   ' }));
    await m.toName();
    m.click('handin-name');
    await settle();
    expect(m.status()).toBe(STUDENT_ERROR_TEXT.empty_sketch);
    expect(m.api.join).not.toHaveBeenCalled();

    const example = mount();
    await example.open(work({ unchanged: { kind: 'example', title: 'Blink' } }));
    await example.toName();
    expect(example.role('warning').textContent).toBe("This is still the example 'Blink'. Hand it in anyway?");
    example.spies.confirm.mockReturnValueOnce(false);
    example.click('handin-name');
    await settle();
    expect(example.spies.confirm).toHaveBeenCalledWith("This is still the example 'Blink'. Hand it in anyway?");
    expect(example.api.join).not.toHaveBeenCalled();
    example.click('handin-name');
    await settle();
    expect(example.api.join).toHaveBeenCalledTimes(1);
    expect(example.view()).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Ready view (remembered), Change, Success
// ---------------------------------------------------------------------------

describe('Ready view', () => {
  const ready = (over: Partial<StudentApi> = {}, w: HandinWork = work(), restore: Partial<RestoreResult> = {}) => {
    const m = mount({ restore: vi.fn(async () => restored(restore)), ...over });
    return m.open(w).then(() => m);
  };

  it('shows "Hand in as … to class …" with Hand in, Change and the work, and reports the header name', async () => {
    const m = await ready({}, work(), { lastHandinAt: NOW.getTime() - 60_000 });
    expect(m.view()).toBe('ready');
    expect(m.role('ready-heading').textContent).toBe('Hand in as Ali Khoury to class BKT-4M9 · 8B Robotics');
    expect(m.button('handin').textContent).toBe('Hand in');
    expect(m.button('change').textContent).toBe('Change');
    expect(m.role('work').textContent).toBe('Your Arduino sketch, 3 lines');
    expect(m.role('last').textContent).toBe(`Last handed in: today ${new Date(NOW.getTime() - 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    expect(m.spies.onSessionChange).toHaveBeenLastCalledWith('Ali Khoury');
    expect(document.activeElement).toBe(m.button('handin'));
    const plain = await ready();
    expect(plain.role('last').hidden).toBe(true);
    expect(plain.role('warning').hidden).toBe(true);
    expect(plain.role('errors-note').hidden).toBe(true);
  });

  it('refuses an empty sketch, too large work, too soon and an offline browser without a request', async () => {
    const m = await ready({}, work({ code: '   ' }));
    m.click('handin');
    await settle();
    expect(m.status()).toBe(STUDENT_ERROR_TEXT.empty_sketch);

    const big = await ready({}, work({ code: 'x'.repeat(LIMITS.codeMaxBytes + 1) }));
    big.click('handin');
    await settle();
    expect(big.status()).toBe(STUDENT_ERROR_TEXT.too_large);

    const off = mount({ restore: vi.fn(async () => restored()) }, { isOnline: () => false });
    await off.open();
    off.click('handin');
    await settle();
    expect(off.status()).toBe(STUDENT_ERROR_TEXT.offline);

    const soon = await ready({}, work(), { lastHandinAt: NOW.getTime() - 3_000 });
    soon.click('handin');
    await settle();
    expect(soon.status()).toBe(STUDENT_ERROR_TEXT.too_soon);

    for (const x of [m, big, off, soon]) expect(x.api.handIn, 'no request').not.toHaveBeenCalled();
  });

  it('asks once (confirm) for an untouched example or the blank sketch, and notes the errors', async () => {
    const m = await ready({}, work({ unchanged: { kind: 'example', title: 'Blink' }, errorCount: 2 }));
    expect(m.role('warning').textContent).toBe("This is still the example 'Blink'. Hand it in anyway?");
    expect(m.role('errors-note').textContent).toBe('Your sketch has 2 errors. Your teacher will see them.');
    m.spies.confirm.mockReturnValueOnce(false);
    m.click('handin');
    await settle();
    expect(m.api.handIn).not.toHaveBeenCalled();
    m.click('handin');
    await settle();
    expect(m.spies.confirm).toHaveBeenCalledTimes(2);
    expect(m.api.handIn).toHaveBeenCalledTimes(1);
    expect(m.view()).toBe('success');

    const blank = await ready({}, work({ unchanged: { kind: 'blank' }, errorCount: 1 }));
    expect(blank.role('warning').textContent).toBe(HANDIN_TEXT.blank);
    expect(blank.role('errors-note').textContent).toBe('Your sketch has 1 error. Your teacher will see them.');
    blank.click('handin');
    await settle();
    expect(blank.spies.confirm).toHaveBeenLastCalledWith(HANDIN_TEXT.blank);
  });

  it('hands in, shows the success view, sends once on a double click, and uses a new id next time', async () => {
    const m = await ready({}, work({ kind: 'blocks', workspaceJson: '{"blocks":{}}' }));
    m.click('handin');
    m.click('handin');
    expect(m.button('handin').disabled).toBe(true);
    expect(m.button('handin').textContent).toBe(HANDIN_TEXT.handingIn);
    await settle();
    expect(m.api.handIn).toHaveBeenCalledTimes(1);
    const [s, draft, id] = (m.api.handIn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(s).toEqual(session());
    expect(draft).toEqual({ kind: 'blocks', code: work().code, workspaceJson: '{"blocks":{}}' });
    expect(m.view()).toBe('success');
    expect(m.role('success-text').textContent).toBe(HANDIN_TEXT.success(TIME));
    m.dialog.close();
    (m.api.restore as ReturnType<typeof vi.fn>).mockResolvedValueOnce(restored({ lastHandinAt: NOW.getTime() - 60_000 }));
    await m.open(work());
    expect(m.view()).toBe('ready');
    m.click('handin');
    await settle();
    expect((m.api.handIn as ReturnType<typeof vi.fn>).mock.calls[1][2]).not.toBe(id);
  });

  it('Change forgets the remembered name and goes to the code view with the code prefilled', async () => {
    const m = await ready();
    m.click('change');
    expect(m.api.forget).toHaveBeenCalledWith({ forgetCode: false });
    expect(m.view()).toBe('code');
    expect(m.q<HTMLInputElement>('#z1-handin-code').value).toBe('BKT-4M9');
    expect(m.spies.onSessionChange).toHaveBeenLastCalledWith('');
    await m.toName();
    expect(m.view()).toBe('name');
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
    const inline: ClassroomErrorCode[] = ['too_soon', 'limit_reached', 'offline', 'timeout', 'quota', 'permission', 'unknown'];
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
      ['device_removed', 'change', 'Enter your name again'],
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

  it('"Enter your name again" keeps the code; "Different class" forgets it', async () => {
    const m = await ready({
      handIn: vi.fn(async () => {
        throw fail('device_removed');
      }),
    });
    m.click('handin');
    await settle();
    m.click('change');
    expect(m.api.forget).toHaveBeenCalledWith({ forgetCode: false });
    expect(m.view()).toBe('code');
    expect(m.q<HTMLInputElement>('#z1-handin-code').value).toBe('BKT-4M9');

    const n = await ready({
      handIn: vi.fn(async () => {
        throw fail('handins_closed');
      }),
    });
    n.click('handin');
    await settle();
    n.click('different');
    expect(n.api.forget).toHaveBeenCalledWith({ forgetCode: true });
    expect(n.view()).toBe('code');
    expect(n.q<HTMLInputElement>('#z1-handin-code').value).toBe('');
  });

  it('takes a name changed from another tab from the returned record', async () => {
    const m = await ready({ handIn: vi.fn(async (_s, _d, id: string) => record({ id, firstName: 'Sara', lastName: 'Mansour' })) });
    m.click('handin');
    await settle();
    expect(m.spies.onSessionChange).toHaveBeenLastCalledWith('Sara Mansour');
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
// restore() errors
// ---------------------------------------------------------------------------

describe('restore errors', () => {
  it('shows the restore errors with their buttons', async () => {
    const cases: [ClassroomErrorCode, string, string][] = [
      ['device_removed', 'change', 'Enter your name again'],
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

  it('OK after class_deleted returns to an empty code view; Try again retries the opening', async () => {
    const gone = mount({
      restore: vi.fn(async () => {
        throw fail('class_deleted');
      }),
    });
    await gone.open();
    gone.click('ok');
    expect(gone.view()).toBe('code');
    expect(gone.spies.onSessionChange).toHaveBeenLastCalledWith('');

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
// Rendering safety and session storage
// ---------------------------------------------------------------------------

describe('rendering', () => {
  const payloads = ['<img src=x onerror=alert(1)>', '</script><b>x</b>'];

  it('renders class names and student names as text', async () => {
    for (const p of payloads) {
      const m = mount({
        findClass: vi.fn(async () => ({ info: publicClass({ name: p }), existing: null })),
        join: vi.fn(async () => session({ className: p, firstName: p, lastName: p })),
        handIn: vi.fn(async () => {
          throw fail('too_soon');
        }),
      });
      await m.open();
      await m.toName();
      expect(m.role('name-heading').textContent).toBe(`Class ${p}`);
      m.typeName(p, p);
      m.click('handin-name');
      await settle();
      expect(m.view()).toBe('ready');
      expect(m.role('ready-heading').textContent).toBe(`Hand in as ${p} ${p} to class BKT-4M9 · ${p}`);
      expect(m.el.querySelector('img')).toBeNull();
      // The only <b>s are the dialog's own emphasis; the payload's <b>x</b> never becomes an element.
      for (const b of m.el.querySelectorAll('b')) expect([p, `${p} ${p}`, 'BKT-4M9']).toContain(b.textContent);
      document.body.innerHTML = '';
    }
  });

  it('reads nothing from the class session store itself while restore() says who is remembered', async () => {
    saveSession(saved({ firstName: 'Someone', lastName: 'Else', lastHandinAt: NOW.getTime() - 120_000 }));
    const m = mount({ restore: vi.fn(async () => restored({ lastHandinAt: NOW.getTime() - 120_000 })) });
    await m.open();
    expect(m.role('ready-heading').textContent).toContain('Ali Khoury');
    expect(m.role('last').textContent).toContain('Last handed in');
    expect(localStorage.getItem(CLASSROOM_STORAGE_KEY)).not.toBeNull();
  });
});
