/**
 * Hand in dialog (docs/CLASSROOM.md §1.2, §4.10): the student side of the
 * class platform inside the simulator. One short flow: class code → first
 * name and last name → Hand in. The device remembers the code and the name,
 * so the next time the dialog opens on "Hand in as Ali Khoury to class
 * BKT-4M9" with a Hand in button and a small Change link.
 *
 * The data layer (`src/classroom/student.ts`) is loaded with `import()` the
 * first time the dialog opens, so the simulator never downloads Firebase for
 * students who do not use classes. Every string that comes from the class
 * (names) is rendered with `textContent`.
 *
 * Views (`data-view`): loading | code | name | ready | success | error.
 * Buttons carry `data-action`.
 */
import { ClassroomError, STUDENT_ERROR_TEXT, errorText, toClassroomError, type ClassroomErrorCode } from '../classroom/errors';
import { LIMITS, codeProblem, draftProblem, formatClassCode, fullName, newHandinId, normalizeClassCode, type HandinDraft, type HandinKind, type HandinRecord } from '../classroom/model';
import { loadLastCode, loadSavedSession } from '../classroom/session-store';
import type { FoundClass, PublicClass, RestoreResult, StudentApi, StudentName, StudentSession } from '../classroom/student';

export interface HandinWork {
  kind: HandinKind;
  code: string;
  workspaceJson: string;
  /** The Python program when kind is 'python' (docs/PYTHON.md §8.3); ignored otherwise. */
  python?: string;
  /** Set by the App: untouched starting sketch / untouched example (with its title). */
  unchanged: { kind: 'blank' } | { kind: 'example'; title: string } | null;
  /** Transpiler errors in `code` (the App runs the check synchronously), 0 when none. */
  errorCount: number;
}

export interface HandinDialogOptions {
  /** Default: () => import('../classroom/student').then((m) => m.createStudentApi()). */
  loadApi?: () => Promise<StudentApi>;
  /** The App updates the header label ('' = no remembered name). */
  onSessionChange?(studentName: string): void;
  toast?(text: string): void;
  /** The site was redeployed under this tab (an 'app_updated' error): the App shows its reload prompt. */
  onAppUpdated?(): void;
  /** Default window.confirm (the untouched-example question). */
  confirm?(text: string): boolean;
  now?: () => Date;
  isOnline?: () => boolean;
}

export interface HandinDialog {
  /** Show the dialog for this work; `joinCode` (a `#class=` link) prefills the code. */
  open(work: HandinWork, options?: { joinCode?: string }): void;
  close(): void;
  isOpen(): boolean;
  readonly element: HTMLDialogElement;
}

export type HandinView = 'loading' | 'code' | 'name' | 'ready' | 'success' | 'error';

/** Texts of the dialog that are not in the §1.5 error table (tests reuse them). */
export const HANDIN_TEXT = {
  title: 'Hand in your work to your teacher',
  loading: 'Connecting to your class…',
  nameHelp: 'Type your name so your teacher knows whose work this is.',
  handingIn: 'Handing in…',
  checking: 'Checking whether it arrived…',
  notArrived: 'It did not arrive.',
  blank: 'Your sketch is still the empty starting sketch. Hand it in anyway?',
  example: (title: string) => `This is still the example '${title}'. Hand it in anyway?`,
  errors: (n: number) => `Your sketch has ${n} error${n === 1 ? '' : 's'}. Your teacher will see them.`,
  success: (time: string) => `✓ Handed in · ${time} · Your teacher can see it now.`,
} as const;

/** Errors after which the hand-in may have landed anyway: "Try again" reuses the same id. */
const RETRY_CODES: readonly ClassroomErrorCode[] = ['timeout', 'offline', 'unknown'];

function defaultLoadApi(): Promise<StudentApi> {
  return import('../classroom/student').then((m) => m.createStudentApi());
}

function defaultConfirm(text: string): boolean {
  return window.confirm(text);
}

/** `<tag>` with a class, text or children. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: (string | Node)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

function bold(text: string): HTMLElement {
  return el('b', '', text);
}

function button(action: string, label: string, primary = false): HTMLButtonElement {
  const b = el('button', primary ? 'z1-btn z1-btn-primary' : 'z1-btn', label);
  b.type = 'button';
  b.dataset.action = action;
  return b;
}

/**
 * Create the Hand in `<dialog>` and append it to `parent`.
 */
export function createHandinDialog(parent: HTMLElement, options: HandinDialogOptions = {}): HandinDialog {
  const loadApi = options.loadApi ?? defaultLoadApi;
  const confirmDialog = options.confirm ?? defaultConfirm;
  const now = options.now ?? (() => new Date());
  const isOnline = options.isOnline ?? (() => navigator.onLine !== false);

  const dialog = document.createElement('dialog');
  dialog.className = 'z1-dialog z1-handin';
  dialog.setAttribute('aria-labelledby', 'z1-handin-title');
  dialog.innerHTML = `
    <form class="z1-dialog-form" novalidate>
      <h2 id="z1-handin-title" data-role="title">${HANDIN_TEXT.title}</h2>

      <section class="z1-handin-view" data-view="loading" hidden>
        <p class="z1-muted" data-role="loading-text">${HANDIN_TEXT.loading}</p>
      </section>

      <section class="z1-handin-view" data-view="code" hidden>
        <div class="z1-setting">
          <label for="z1-handin-code">Class code</label>
          <input type="text" id="z1-handin-code" class="z1-handin-code" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="BKT-4M9" maxlength="12" aria-describedby="z1-handin-code-error" />
          <p class="z1-handin-error" id="z1-handin-code-error" data-role="code-error" aria-live="polite"></p>
        </div>
        <div class="z1-handin-buttons">
          <button type="button" class="z1-btn z1-btn-primary" data-action="next">Next</button>
        </div>
      </section>

      <section class="z1-handin-view" data-view="name" hidden>
        <p class="z1-handin-heading" data-role="name-heading"></p>
        <p class="z1-setting-help">${HANDIN_TEXT.nameHelp}</p>
        <div class="z1-handin-names">
          <div class="z1-setting">
            <label for="z1-handin-first">First name</label>
            <input type="text" id="z1-handin-first" autocomplete="given-name" autocapitalize="words" maxlength="${LIMITS.nameMax}" />
          </div>
          <div class="z1-setting">
            <label for="z1-handin-last">Last name</label>
            <input type="text" id="z1-handin-last" autocomplete="family-name" autocapitalize="words" maxlength="${LIMITS.nameMax}" />
          </div>
        </div>
        <p class="z1-handin-error" data-role="name-error" aria-live="polite"></p>
        <div class="z1-handin-buttons">
          <button type="button" class="z1-btn z1-btn-primary" data-action="handin-name">Hand in</button>
          <button type="button" class="z1-btn" data-action="back">Back</button>
        </div>
      </section>

      <section class="z1-handin-view" data-view="ready" hidden>
        <p class="z1-handin-heading" data-role="ready-heading"></p>
        <p class="z1-muted" data-role="last" hidden></p>
        <div class="z1-handin-buttons">
          <button type="button" class="z1-btn z1-btn-primary z1-handin-submit" data-action="handin">Hand in</button>
          <button type="button" class="z1-btn" data-action="retry" hidden>Try again</button>
          <button type="button" class="z1-linkbtn" data-action="change">Change</button>
        </div>
      </section>

      <section class="z1-handin-view" data-view="success" hidden>
        <p class="z1-handin-success" data-role="success-text"></p>
      </section>

      <section class="z1-handin-view" data-view="error" hidden>
        <p data-role="error-text"></p>
        <div class="z1-handin-buttons" data-role="error-actions"></div>
      </section>

      <div class="z1-handin-work" data-role="work-block" hidden>
        <p data-role="work"></p>
        <p class="z1-handin-warning" data-role="warning" hidden></p>
        <p class="z1-handin-note" data-role="errors-note" hidden></p>
      </div>

      <div class="z1-dialog-actions">
        <p class="z1-handin-status z1-spacer" data-role="status" role="status" aria-live="polite"></p>
        <button type="button" class="z1-btn" data-action="close">Close</button>
      </div>
    </form>
  `;
  const form = dialog.querySelector('form')!;
  const role = <T extends HTMLElement = HTMLElement>(name: string): T => dialog.querySelector<T>(`[data-role="${name}"]`)!;
  const action = (name: string): HTMLButtonElement => dialog.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
  const views = new Map<HandinView, HTMLElement>();
  for (const section of dialog.querySelectorAll<HTMLElement>('[data-view]')) views.set(section.dataset.view as HandinView, section);

  const codeInput = dialog.querySelector<HTMLInputElement>('#z1-handin-code')!;
  const codeError = role('code-error');
  const firstInput = dialog.querySelector<HTMLInputElement>('#z1-handin-first')!;
  const lastInput = dialog.querySelector<HTMLInputElement>('#z1-handin-last')!;
  const nameError = role('name-error');
  const workBlock = role('work-block');
  const warning = role('warning');
  const errorsNote = role('errors-note');
  const submit = action('handin');
  const retry = action('retry');
  const status = role('status');

  // --- state ------------------------------------------------------------
  let work: HandinWork | null = null;
  let api: StudentApi | null = null;
  let apiPromise: Promise<StudentApi> | null = null;
  let session: StudentSession | null = null;
  let info: PublicClass | null = null;
  /** The class the code view found, while the name view is shown. */
  let found: FoundClass | null = null;
  /** ms of the last hand-in from this device, null when none. */
  let lastHandin: number | null = null;
  /** The hand-in id of the current draft; a new one after every success (retries reuse it). */
  let handinId = newHandinId();
  /** A request is running: one at a time. */
  let busy = false;
  /** Incremented by every open() and close(): an answer for an older opening is dropped. */
  let epoch = 0;
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  /** The code the student last asked about, for {code} in error texts. */
  let lastCodeTried = '';

  // --- helpers ------------------------------------------------------------
  const setStatus = (text: string, tone: 'ok' | 'error' = 'ok'): void => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const notifySession = (): void => options.onSessionChange?.(session ? fullName(session.firstName, session.lastName) : '');

  /** The §1.5 text of an error (the API fills the placeholders; fakes may pass the bare code). */
  const describe = (err: unknown): string => {
    const e = err instanceof ClassroomError ? err : toClassroomError(err, 'student');
    if (e.code === 'app_updated') options.onAppUpdated?.(); // every shown error passes through here
    if (e.message !== e.code && e.message !== '') return e.message;
    return errorText(STUDENT_ERROR_TEXT, e.code, {
      class: info?.name ?? session?.className ?? 'This class',
      code: formatClassCode(lastCodeTried),
    });
  };
  const codeOf = (err: unknown): ClassroomErrorCode | null => (err instanceof ClassroomError ? err.code : null);

  const timeText = (date: Date): string => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const whenText = (ms: number): string => {
    const date = new Date(ms);
    const today = now();
    const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    return sameDay ? `today ${timeText(date)}` : `${date.toLocaleDateString()} ${timeText(date)}`;
  };

  const showView = (view: HandinView): void => {
    for (const [name, section] of views) section.hidden = name !== view;
    // The work description and its warnings belong to the two views with a Hand in button.
    const host = view === 'name' || view === 'ready' ? views.get(view)! : null;
    workBlock.hidden = host === null;
    if (host) host.insertBefore(workBlock, host.querySelector('.z1-handin-buttons'));
  };

  const focus = (element: HTMLElement | null): void => {
    if (element && dialog.open) element.focus();
  };

  const getApi = async (): Promise<StudentApi> => {
    if (api) return api;
    apiPromise ??= loadApi().catch((err) => {
      apiPromise = null; // the next open() tries again
      throw err;
    });
    api = await apiPromise;
    return api;
  };

  /** Run an async step for the current opening; anything thrown lands in the error view. */
  const run = (step: () => Promise<void>): void => {
    const current = epoch;
    step().catch((err) => {
      if (current !== epoch) return;
      showError(describe(err), [{ action: 'retry-open', label: 'Try again' }]);
    });
  };
  const stale = (token: number): boolean => token !== epoch;

  const forgetSession = (): void => {
    session = null;
    info = null;
    found = null;
    lastHandin = null;
    notifySession();
  };

  const fillWork = (): void => {
    if (!work) return;
    const lines = work.code.split('\n').length;
    role('work').textContent =
      work.kind === 'blocks' ? 'Your blocks program and the Arduino sketch made from it' : `Your Arduino sketch, ${lines} line${lines === 1 ? '' : 's'}`;
    warning.hidden = work.unchanged === null;
    warning.textContent = work.unchanged === null ? '' : work.unchanged.kind === 'blank' ? HANDIN_TEXT.blank : HANDIN_TEXT.example(work.unchanged.title);
    errorsNote.hidden = work.errorCount === 0;
    errorsNote.textContent = work.errorCount > 0 ? HANDIN_TEXT.errors(work.errorCount) : '';
  };

  // --- views --------------------------------------------------------------
  const showCode = (prefill: string, error = ''): void => {
    codeInput.value = prefill === '' ? '' : formatClassCode(prefill);
    codeError.textContent = error;
    codeInput.toggleAttribute('aria-invalid', error !== '');
    showView('code');
    focus(codeInput);
  };

  const showError = (text: string, actions: { action: string; label: string; primary?: boolean }[]): void => {
    role('error-text').textContent = text;
    role('error-actions').replaceChildren(...actions.map((a, i) => button(a.action, a.label, a.primary ?? i === 0)));
    showView('error');
    focus(role('error-actions').querySelector('button'));
  };

  /** The name view for `f`, prefilled with the name this device gave before (member doc, then saved session). */
  const showName = (f: FoundClass): void => {
    found = f;
    info = f.info;
    const saved = loadSavedSession();
    const prefill: StudentName | null = f.existing ?? (saved ? { firstName: saved.firstName, lastName: saved.lastName } : null);
    role('name-heading').replaceChildren('Class ', bold(f.info.name));
    if (prefill) {
      firstInput.value = prefill.firstName;
      lastInput.value = prefill.lastName;
    }
    nameError.textContent = '';
    fillWork();
    showView('name');
    focus(firstInput);
  };

  const showReady = (): void => {
    if (!session) return;
    role('ready-heading').replaceChildren('Hand in as ', bold(fullName(session.firstName, session.lastName)), ' to class ', bold(formatClassCode(session.code)), ` · ${session.className}`);
    const last = role('last');
    last.hidden = lastHandin === null;
    if (lastHandin !== null) last.textContent = `Last handed in: ${whenText(lastHandin)}`;
    fillWork();
    submit.disabled = false;
    submit.textContent = 'Hand in';
    retry.hidden = true;
    showView('ready');
    focus(submit);
  };

  const showSuccess = (record: HandinRecord): void => {
    role('success-text').textContent = HANDIN_TEXT.success(timeText(record.createdAt ?? now()));
    setStatus('');
    showView('success');
    focus(action('close'));
  };

  // --- flows --------------------------------------------------------------
  const startRestore = async (a: StudentApi): Promise<void> => {
    const token = epoch;
    let result: RestoreResult | null;
    try {
      result = await a.restore();
    } catch (err) {
      if (stale(token)) return;
      restoreFailed(err);
      return;
    }
    if (stale(token)) return;
    if (!result) {
      showCode(loadLastCode());
      return;
    }
    session = result.session;
    info = result.info;
    lastHandin = result.lastHandinAt;
    notifySession();
    showReady();
  };

  const restoreFailed = (err: unknown): void => {
    const text = describe(err);
    switch (codeOf(err)) {
      case 'device_removed':
        showError(text, [{ action: 'change', label: 'Enter your name again' }]);
        return;
      case 'class_deleted':
        forgetSession();
        showError(text, [{ action: 'ok', label: 'OK' }]);
        return;
      case 'handins_closed':
        showError(text, [{ action: 'different', label: 'Different class' }]);
        return;
      case 'lost_identity':
        forgetSession();
        showCode(loadLastCode(), text);
        return;
      default:
        showError(text, [{ action: 'retry-open', label: 'Try again' }]);
    }
  };

  const lookUp = async (raw: string): Promise<void> => {
    const code = normalizeClassCode(raw);
    if (code === null) {
      const detail = codeProblem(raw);
      const [rule, ...rest] = STUDENT_ERROR_TEXT.bad_code.split(' Check it');
      codeError.textContent = detail ? `${rule} ${detail} Check it${rest.join('')}` : STUDENT_ERROR_TEXT.bad_code;
      codeInput.setAttribute('aria-invalid', 'true');
      focus(codeInput);
      return;
    }
    if (busy) return;
    busy = true;
    lastCodeTried = code;
    codeError.textContent = '';
    codeInput.removeAttribute('aria-invalid');
    codeInput.value = formatClassCode(code);
    action('next').disabled = true;
    setStatus(HANDIN_TEXT.loading);
    const token = epoch;
    try {
      const a = await getApi();
      const f = await a.findClass(code);
      if (stale(token)) return;
      setStatus('');
      showName(f);
    } catch (err) {
      if (stale(token)) return;
      setStatus('');
      showCode(code, describe(err));
    } finally {
      busy = false;
      action('next').disabled = false;
    }
  };

  /** The checks that need no request; false = stop (the status line says why). */
  const readyToSend = (draft: HandinDraft): boolean => {
    if (!work) return false;
    const problem = draftProblem(draft);
    if (problem) {
      setStatus(errorText(STUDENT_ERROR_TEXT, problem), 'error');
      return false;
    }
    if (lastHandin !== null && now().getTime() - lastHandin < LIMITS.handinCooldownMs) {
      setStatus(errorText(STUDENT_ERROR_TEXT, 'too_soon'), 'error');
      return false;
    }
    if (!isOnline()) {
      setStatus(errorText(STUDENT_ERROR_TEXT, 'offline'), 'error');
      return false;
    }
    if (work.unchanged && !confirmDialog(work.unchanged.kind === 'blank' ? HANDIN_TEXT.blank : HANDIN_TEXT.example(work.unchanged.title))) return false;
    return true;
  };

  const currentDraft = (): HandinDraft | null =>
    work
      ? {
          kind: work.kind,
          code: work.code,
          workspaceJson: work.kind === 'blocks' ? work.workspaceJson : '',
          python: work.kind === 'python' ? (work.python ?? '') : '',
        }
      : null;

  /** Hand in from the name view: join (create or rename this device's member doc), then send. */
  const handInAs = async (): Promise<void> => {
    if (busy || !found || !work) return;
    const draft = currentDraft()!;
    nameError.textContent = '';
    if (!readyToSend(draft)) return;
    busy = true;
    action('handin-name').disabled = true;
    setStatus(HANDIN_TEXT.handingIn);
    const token = epoch;
    try {
      const a = await getApi();
      session = await a.join(found, { firstName: firstInput.value, lastName: lastInput.value });
      if (stale(token)) return;
      lastHandin = null;
      notifySession();
    } catch (err) {
      if (stale(token)) return;
      setStatus('');
      nameError.textContent = describe(err);
      focus(codeOf(err) === 'bad_name' ? firstInput : action('handin-name'));
      return;
    } finally {
      busy = false;
      action('handin-name').disabled = false;
    }
    showReady();
    await send(draft);
  };

  /** Hand in from the Ready view (also Try again). */
  const handIn = async (): Promise<void> => {
    if (busy || !session || !work) return;
    const draft = currentDraft()!;
    if (!readyToSend(draft)) return;
    await send(draft);
  };

  const send = async (draft: HandinDraft): Promise<void> => {
    if (busy || !session) return;
    busy = true;
    submit.disabled = true;
    submit.textContent = HANDIN_TEXT.handingIn;
    retry.hidden = true;
    setStatus(HANDIN_TEXT.handingIn);
    // The API checks the member doc after the request timeout: say so meanwhile.
    checkTimer = setTimeout(() => setStatus(HANDIN_TEXT.checking), LIMITS.requestTimeoutMs);
    const token = epoch;
    const current = session;
    try {
      const a = await getApi();
      const record = await a.handIn(current, draft, handinId);
      if (stale(token)) return;
      handedIn(record);
    } catch (err) {
      if (stale(token)) return;
      handinFailed(err);
    } finally {
      if (checkTimer !== null) clearTimeout(checkTimer);
      checkTimer = null;
      busy = false;
      submit.disabled = false;
      submit.textContent = 'Hand in';
      if (dialog.open && !dialog.contains(document.activeElement)) focus(dialog.querySelector<HTMLElement>('.z1-handin-view:not([hidden]) button'));
    }
  };

  const handedIn = (record: HandinRecord): void => {
    if (!session) return;
    if (record.firstName !== session.firstName || record.lastName !== session.lastName) {
      session = { ...session, firstName: record.firstName, lastName: record.lastName }; // renamed from another tab meanwhile
      notifySession();
    }
    lastHandin = record.createdAt?.getTime() ?? now().getTime();
    handinId = newHandinId();
    showSuccess(record);
  };

  const handinFailed = (err: unknown): void => {
    const text = describe(err);
    const code = codeOf(err);
    if (code && RETRY_CODES.includes(code)) {
      setStatus(`${HANDIN_TEXT.notArrived} ${text}`, 'error');
      retry.hidden = false;
      focus(retry);
      return;
    }
    switch (code) {
      case 'device_removed':
        showError(text, [{ action: 'change', label: 'Enter your name again' }]);
        return;
      case 'class_deleted':
        forgetSession();
        showError(text, [{ action: 'different', label: 'Different class' }]);
        return;
      case 'handins_closed':
        showError(text, [{ action: 'different', label: 'Different class' }]);
        return;
      case 'lost_identity':
        forgetSession();
        showCode(loadLastCode(), text);
        return;
    }
    setStatus(text, 'error');
  };

  /** "Change" / "Different class": forget the remembered name on this computer, back to the code view. */
  const change = (forgetCode: boolean): void => {
    const code = forgetCode ? '' : (session?.code ?? loadLastCode());
    api?.forget({ forgetCode });
    forgetSession();
    setStatus('');
    showCode(code);
  };

  // --- events -------------------------------------------------------------
  const actions: Record<string, () => void> = {
    next: () => void lookUp(codeInput.value),
    back: () => showCode(codeInput.value || loadLastCode()),
    'handin-name': () => void handInAs(),
    handin: () => void handIn(),
    retry: () => void handIn(),
    change: () => change(false),
    different: () => change(true),
    ok: () => showCode(loadLastCode()),
    'retry-open': () => reopen(),
    close: () => dialog.close(),
  };

  dialog.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || !dialog.contains(target) || (target as HTMLButtonElement).disabled) return;
    actions[target.dataset.action!]?.();
  });
  // Enter in the code field = Next; in a name field = Hand in. Never a form submit (it would close the dialog).
  form.addEventListener('submit', (e) => e.preventDefault());
  codeInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    void lookUp(codeInput.value);
  });
  codeInput.addEventListener('input', () => {
    if (codeError.textContent) {
      codeError.textContent = '';
      codeInput.removeAttribute('aria-invalid');
    }
  });
  for (const input of [firstInput, lastInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      void handInAs();
    });
    input.addEventListener('input', () => {
      nameError.textContent = '';
    });
  }
  dialog.addEventListener('close', () => {
    epoch++;
    busy = false;
    if (checkTimer !== null) clearTimeout(checkTimer);
    checkTimer = null;
    work = null; // the dialog never keeps the student's work after closing
  });

  parent.appendChild(dialog);

  /** "Try again" after a failed opening: the same work, the same mode. */
  let lastOpen: { work: HandinWork; joinCode?: string } | null = null;
  const reopen = (): void => {
    if (lastOpen) open(lastOpen.work, { joinCode: lastOpen.joinCode });
  };

  const open = (next: HandinWork, opts: { joinCode?: string } = {}): void => {
    epoch++;
    work = next;
    lastOpen = { work: next, joinCode: opts.joinCode };
    busy = false;
    setStatus('');
    showView('loading');
    if (!dialog.open) dialog.showModal();
    const joinCode = opts.joinCode;
    // A class link prefills the code, unless this computer already remembers that very class.
    if (joinCode !== undefined && loadSavedSession()?.code !== joinCode) {
      lastCodeTried = joinCode;
      showCode(joinCode);
      return;
    }
    run(async () => startRestore(await getApi()));
  };

  return {
    open,
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    element: dialog,
  };
}
