/**
 * Hand in dialog (docs/CLASSROOM.md §1.2, §4.10): the student side of the
 * class platform inside the simulator. Joining a class (code → pick your
 * name), the confirmation on shared computers, handing the current work in,
 * the history of this computer's hand-ins, and signing out.
 *
 * The data layer (`src/classroom/student.ts`) is loaded with `import()` the
 * first time the dialog opens, so the simulator never downloads Firebase for
 * students who do not use classes. Every string that comes from the class
 * (names, titles, notes) is rendered with `textContent`.
 *
 * Views (`data-view`): loading | code | pick | already | confirm | ready |
 * success | switch | joined | error. Buttons carry `data-action`.
 */
import { decodeContent } from '../classroom/codec';
import { ClassroomError, STUDENT_ERROR_TEXT, errorText, toClassroomError, type ClassroomErrorCode } from '../classroom/errors';
import {
  LIMITS,
  codeProblem,
  draftProblem,
  formatClassCode,
  joinStatus,
  newHandinId,
  normalizeClassCode,
  type HandinContent,
  type HandinDraft,
  type HandinRecord,
} from '../classroom/model';
import { loadLastCode, loadSavedSession } from '../classroom/session-store';
import type { FoundClass, PublicClass, RestoreResult, StudentApi, StudentSession } from '../classroom/student';

export interface HandinWork {
  kind: 'code' | 'blocks';
  code: string;
  workspaceJson: string;
  /** Set by the App: untouched starting sketch / untouched example (with its title). */
  unchanged: { kind: 'blank' } | { kind: 'example'; title: string } | null;
  /** Transpiler errors in `code` (the App runs the check synchronously), 0 when none. */
  errorCount: number;
}

export interface HandinDialogOptions {
  /** Default: () => import('../classroom/student').then((m) => m.createStudentApi()). */
  loadApi?: () => Promise<StudentApi>;
  /** "Open" in My hand-ins: the App sets location.hash to handinHash(content).hash. */
  openWork?(content: HandinContent): void;
  /** The App updates the header label ('' = not joined). */
  onSessionChange?(username: string): void;
  toast?(text: string): void;
  /** Default window.confirm. */
  confirm?(text: string): boolean;
  now?: () => Date;
  isOnline?: () => boolean;
}

export interface HandinDialog {
  /** Show the dialog for this work; `joinCode` opens it in join mode (a `#class=` link). */
  open(work: HandinWork, options?: { joinCode?: string }): void;
  close(): void;
  isOpen(): boolean;
  readonly element: HTMLDialogElement;
}

export type HandinView = 'loading' | 'code' | 'pick' | 'already' | 'confirm' | 'ready' | 'success' | 'switch' | 'joined' | 'error';

/** Above this many names the Pick view gets a filter box. */
export const FILTER_ABOVE = 12;

/** Texts of the dialog that are not in the §1.5 error table (tests reuse them). */
export const HANDIN_TEXT = {
  loading: 'Connecting to your class…',
  finePrint: 'Only pick your own name. Your teacher can see which computer joined as which name.',
  emptyRoster: 'Your teacher has not added any names yet. Ask them to add you.',
  noHistory: 'Nothing handed in from this computer yet.',
  again: 'Hand in again to send a newer version.',
  handingIn: 'Handing in…',
  checking: 'Checking whether it arrived…',
  notArrived: 'It did not arrive.',
  taskGone: 'That task no longer exists. Pick a task again and hand in.',
  cannotOpen: 'This hand-in could not be opened.',
  blank: 'Your sketch is still the empty starting sketch. Hand it in anyway?',
  example: (title: string) => `This is still the example '${title}'. Hand it in anyway?`,
  errors: (n: number) => `Your sketch has ${n} error${n === 1 ? '' : 's'}. Your teacher will see them.`,
  signOut: (className: string) => `Sign out of ${className} on this computer? Your hand-ins stay with your teacher.`,
} as const;

/** Errors after which the hand-in may have landed anyway: "Try again" reuses the same id. */
const RETRY_CODES: readonly ClassroomErrorCode[] = ['timeout', 'offline', 'unknown'];
/** Errors of restore() in join mode that mean "no usable session": the old one is dropped. */
const CONNECTION_CODES: readonly ClassroomErrorCode[] = ['offline', 'timeout', 'quota', 'load_failed', 'app_updated', 'signup_limit'];

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
      <h2 id="z1-handin-title" data-role="title">Hand in your work to your teacher</h2>

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

      <section class="z1-handin-view" data-view="pick" hidden>
        <p class="z1-handin-heading" data-role="pick-heading"></p>
        <p>Pick your own name:</p>
        <div class="z1-setting" data-role="filter-setting" hidden>
          <label for="z1-handin-filter">Find your name</label>
          <input type="text" id="z1-handin-filter" autocomplete="off" spellcheck="false" />
        </div>
        <div class="z1-handin-list" role="radiogroup" aria-label="Your name" data-role="names"></div>
        <p class="z1-muted" data-role="pick-empty" hidden>${HANDIN_TEXT.emptyRoster}</p>
        <p class="z1-setting-help">${HANDIN_TEXT.finePrint}</p>
        <p class="z1-setting-help">Can't find your name? <button type="button" class="z1-linkbtn" data-action="refresh">Refresh the list</button>, or ask your teacher.</p>
        <p class="z1-handin-error" data-role="pick-error" aria-live="polite"></p>
        <div class="z1-handin-buttons">
          <button type="button" class="z1-btn z1-btn-primary" data-action="pick" disabled>This is me</button>
          <button type="button" class="z1-btn" data-action="back">Back</button>
        </div>
      </section>

      <section class="z1-handin-view" data-view="already" hidden>
        <p data-role="already-text"></p>
        <div class="z1-handin-buttons">
          <button type="button" class="z1-btn z1-btn-primary" data-action="continue"></button>
          <button type="button" class="z1-btn" data-action="signout"></button>
        </div>
      </section>

      <section class="z1-handin-view" data-view="confirm" hidden>
        <p class="z1-handin-heading" data-role="confirm-text"></p>
        <div class="z1-handin-buttons">
          <button type="button" class="z1-btn z1-btn-primary" data-action="yes"></button>
          <button type="button" class="z1-btn" data-action="other">No, I'm someone else</button>
          <button type="button" class="z1-btn" data-action="different">Different class</button>
        </div>
      </section>

      <section class="z1-handin-view" data-view="switch" hidden>
        <p data-role="switch-text"></p>
        <div class="z1-handin-buttons">
          <button type="button" class="z1-btn z1-btn-primary" data-action="switch">Switch</button>
          <button type="button" class="z1-btn" data-action="cancel">Cancel</button>
        </div>
      </section>

      <section class="z1-handin-view" data-view="joined" hidden>
        <p data-role="joined-text"></p>
        <div class="z1-handin-buttons">
          <button type="button" class="z1-btn z1-btn-primary" data-action="ok">OK</button>
        </div>
      </section>

      <section class="z1-handin-view" data-view="ready" hidden>
        <p class="z1-handin-heading" data-role="ready-heading"></p>
        <p class="z1-setting-help"><button type="button" class="z1-linkbtn" data-action="signout" data-role="ready-signout"></button></p>
        <p class="z1-muted" data-role="last" hidden></p>
        <div class="z1-setting" data-role="task-setting" hidden>
          <label for="z1-handin-task">Task</label>
          <select id="z1-handin-task"></select>
        </div>
        <p data-role="work"></p>
        <div class="z1-setting">
          <label for="z1-handin-work-title">Title (optional)</label>
          <input type="text" id="z1-handin-work-title" maxlength="${LIMITS.titleMax}" autocomplete="off" />
        </div>
        <div class="z1-setting">
          <label for="z1-handin-note">Note for your teacher (optional)</label>
          <textarea id="z1-handin-note" rows="2" maxlength="${LIMITS.noteMax}"></textarea>
        </div>
        <p class="z1-handin-warning" data-role="warning" hidden></p>
        <p class="z1-handin-note" data-role="errors-note" hidden></p>
        <div class="z1-handin-buttons">
          <button type="button" class="z1-btn z1-btn-primary z1-handin-submit" data-action="handin"></button>
          <button type="button" class="z1-btn" data-action="retry" hidden>Try again</button>
        </div>
      </section>

      <section class="z1-handin-view" data-view="success" hidden>
        <p class="z1-handin-success" data-role="success-text"></p>
        <div class="z1-handin-buttons">
          <button type="button" class="z1-btn" data-action="history">My hand-ins</button>
          <button type="button" class="z1-btn" data-action="signout">Leaving? Sign out of the class on this computer</button>
        </div>
      </section>

      <section class="z1-handin-view" data-view="error" hidden>
        <p data-role="error-text"></p>
        <div class="z1-handin-buttons" data-role="error-actions"></div>
      </section>

      <details class="z1-handin-history" data-role="history" hidden>
        <summary>My hand-ins from this computer</summary>
        <p class="z1-muted" data-role="history-status"></p>
        <ul class="z1-handin-rows" data-role="history-rows"></ul>
        <button type="button" class="z1-btn" data-action="more" hidden>Show more</button>
      </details>

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

  const title = role('title');
  const codeInput = dialog.querySelector<HTMLInputElement>('#z1-handin-code')!;
  const codeError = role('code-error');
  const filterInput = dialog.querySelector<HTMLInputElement>('#z1-handin-filter')!;
  const names = role('names');
  const pickError = role('pick-error');
  const taskSelect = dialog.querySelector<HTMLSelectElement>('#z1-handin-task')!;
  const titleInput = dialog.querySelector<HTMLInputElement>('#z1-handin-work-title')!;
  const noteInput = dialog.querySelector<HTMLTextAreaElement>('#z1-handin-note')!;
  const warning = role('warning');
  const errorsNote = role('errors-note');
  const submit = action('handin');
  const retry = action('retry');
  const history = role<HTMLDetailsElement>('history');
  const historyStatus = role('history-status');
  const historyRows = role<HTMLUListElement>('history-rows');
  const more = action('more');
  const status = role('status');

  // --- state ------------------------------------------------------------
  let work: HandinWork | null = null;
  let api: StudentApi | null = null;
  let apiPromise: Promise<StudentApi> | null = null;
  let session: StudentSession | null = null;
  let info: PublicClass | null = null;
  let found: FoundClass | null = null;
  /** The restore result kept aside while a #class= link asks about switching class. */
  let pending: RestoreResult | null = null;
  let joinMode = false;
  let confirmed = false;
  let lastHandin: { at: number; title: string } | null = null;
  /** The hand-in id of the current draft; a new one after every success (retries reuse it). */
  let handinId = newHandinId();
  /** Title and task of the last hand-in of this session: kept for the next one (the note is not). */
  let draftMemory: { title: string; taskId: string } | null = null;
  /** The example / blank warning was shown: the next click hands in. */
  let anyway = false;
  /** A request is running: one at a time. */
  let busy = false;
  /** Incremented by every open() and close(): an answer for an older opening is dropped. */
  let epoch = 0;
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  const historyState = { loaded: false, loading: false, items: [] as HandinRecord[], hasMore: false };
  /** The code the student last asked about, for {code} in error texts. */
  let lastCodeTried = '';

  // --- helpers ------------------------------------------------------------
  const setStatus = (text: string, tone: 'ok' | 'error' = 'ok'): void => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const notifySession = (): void => options.onSessionChange?.(session?.username ?? '');

  /** The §1.5 text of an error (the API fills the placeholders; fakes may pass the bare code). */
  const describe = (err: unknown): string => {
    const e = err instanceof ClassroomError ? err : toClassroomError(err, 'student');
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

  const savedLastHandin = (): { at: number; title: string } | null => {
    const saved = loadSavedSession();
    return saved && saved.uid === session?.uid && saved.lastHandinAt > 0 ? { at: saved.lastHandinAt, title: saved.lastHandinTitle } : null;
  };

  const showView = (view: HandinView): void => {
    for (const [name, section] of views) section.hidden = name !== view;
    // The history belongs to the Ready and Success views, once the student has confirmed who they are.
    history.hidden = !(confirmed && session && (view === 'ready' || view === 'success'));
    title.textContent = view === 'code' || view === 'loading' ? 'Hand in your work to your teacher' : 'Hand in';
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

  const clearHistory = (): void => {
    historyState.loaded = false;
    historyState.loading = false;
    historyState.items = [];
    historyState.hasMore = false;
    historyRows.replaceChildren();
    historyStatus.textContent = '';
    more.hidden = true;
    history.open = false;
  };

  const forgetSession = (): void => {
    session = null;
    info = null;
    found = null;
    pending = null;
    confirmed = false;
    lastHandin = null;
    draftMemory = null;
    clearHistory();
    notifySession();
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

  const classHeading = (cls: PublicClass): (string | Node)[] => {
    const parts: (string | Node)[] = ['Class ', bold(cls.name)];
    if (cls.teacherName) parts.push(` · ${cls.teacherName}`);
    return parts;
  };

  /** The Pick view for `cls`; the selected name stays selected when it is still there. */
  const showPick = (cls: PublicClass): void => {
    info = cls;
    const selected = names.querySelector<HTMLInputElement>('input:checked')?.value ?? '';
    role('pick-heading').replaceChildren(...classHeading(cls));
    names.replaceChildren(
      ...cls.students.map((student, i) => {
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'z1-handin-name';
        input.value = student.studentId;
        input.id = `z1-handin-name-${i}`;
        input.checked = student.studentId === selected;
        const label = el('label', 'z1-handin-pick', input, ' ', student.username);
        label.dataset.username = student.username;
        return label;
      }),
    );
    const empty = cls.students.length === 0;
    role('pick-empty').hidden = !empty;
    names.hidden = empty;
    const filtered = cls.students.length > FILTER_ABOVE;
    role('filter-setting').hidden = !filtered;
    if (!filtered) filterInput.value = '';
    applyFilter();
    action('pick').disabled = names.querySelector('input:checked') === null;
    pickError.textContent = '';
    showView('pick');
    focus(filtered ? filterInput : (names.querySelector<HTMLInputElement>('input:checked') ?? names.querySelector<HTMLInputElement>('input')));
  };

  const applyFilter = (): void => {
    const needle = filterInput.value.trim().toLowerCase();
    for (const label of names.querySelectorAll<HTMLElement>('label')) {
      label.hidden = needle !== '' && !(label.dataset.username ?? '').includes(needle);
    }
  };

  const showAlready = (f: FoundClass): void => {
    found = f;
    info = f.info;
    const username = f.existing?.username ?? '';
    role('already-text').replaceChildren('This computer already joined ', bold(f.info.name), ' as ', bold(username), '.');
    action('continue').textContent = `Continue as ${username}`;
    views.get('already')!.querySelector<HTMLButtonElement>('[data-action="signout"]')!.textContent = `Not ${username}? Sign out`;
    showView('already');
    focus(action('continue'));
  };

  const showFound = (f: FoundClass): void => {
    if (f.existing) showAlready(f);
    else showPick(f.info);
  };

  const showConfirm = (): void => {
    if (!session) return;
    const parts: (string | Node)[] = ['Hand in to ', bold(session.className)];
    if (session.teacherName) parts.push(` (${session.teacherName})`);
    parts.push(' as ', bold(session.username), '?');
    role('confirm-text').replaceChildren(...parts);
    action('yes').textContent = `Yes, I'm ${session.username}`;
    showView('confirm');
    focus(action('yes'));
  };

  const showSwitch = (current: StudentSession, target: PublicClass): void => {
    role('switch-text').replaceChildren(
      'This computer is in ',
      bold(current.className),
      ' as ',
      bold(current.username),
      '. Switch to ',
      bold(target.name),
      '?',
    );
    showView('switch');
    focus(action('switch'));
  };

  const showJoined = (): void => {
    if (!session) return;
    role('joined-text').replaceChildren(
      "You're in ",
      bold(session.className),
      ' as ',
      bold(session.username),
      '. Work as usual and press ',
      bold('Hand in'),
      " when you're done.",
    );
    showView('joined');
    focus(action('ok'));
  };

  const fillTasks = (cls: PublicClass, taskId: string): void => {
    const setting = role('task-setting');
    setting.hidden = cls.tasks.length === 0;
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(no task)';
    taskSelect.replaceChildren(
      none,
      ...cls.tasks.map((task) => {
        const option = document.createElement('option');
        option.value = task.taskId;
        option.textContent = task.title;
        return option;
      }),
    );
    taskSelect.value = cls.tasks.some((t) => t.taskId === taskId) ? taskId : '';
  };

  const submitLabel = (): void => {
    if (!session) return;
    const label = anyway ? 'Hand in anyway' : `Hand in as ${session.username}`;
    submit.textContent = label;
    submit.setAttribute('aria-label', label);
  };

  const showReady = (): void => {
    if (!session || !info || !work) return;
    role('ready-heading').replaceChildren('Hand in to ', bold(session.className), ' as ', bold(session.username));
    role('ready-signout').textContent = `Not ${session.username}? Sign out`;
    const last = role('last');
    last.hidden = lastHandin === null;
    if (lastHandin) last.textContent = `Last handed in: ${whenText(lastHandin.at)}${lastHandin.title ? ` · ${lastHandin.title}` : ''}`;
    fillTasks(info, draftMemory?.taskId ?? info.currentTaskId);
    const lines = work.code.split('\n').length;
    role('work').textContent =
      work.kind === 'blocks' ? 'Your blocks program and the Arduino sketch made from it' : `Your Arduino sketch, ${lines} line${lines === 1 ? '' : 's'}`;
    titleInput.value = draftMemory?.title ?? '';
    noteInput.value = '';
    anyway = false;
    warning.hidden = work.unchanged === null;
    warning.textContent = work.unchanged === null ? '' : work.unchanged.kind === 'blank' ? HANDIN_TEXT.blank : HANDIN_TEXT.example(work.unchanged.title);
    errorsNote.hidden = work.errorCount === 0;
    errorsNote.textContent = work.errorCount > 0 ? HANDIN_TEXT.errors(work.errorCount) : '';
    submitLabel();
    submit.disabled = false;
    retry.hidden = true;
    setStatus(draftMemory ? HANDIN_TEXT.again : '');
    showView('ready');
    focus(info.tasks.length > 0 ? taskSelect : titleInput);
  };

  const showSuccess = (record: HandinRecord): void => {
    const what = info?.tasks.find((t) => t.taskId === record.taskId)?.title || record.title;
    const parts = ['✓ Handed in', what, record.kind === 'blocks' ? 'Blocks' : 'Code', timeText(record.createdAt ?? now())].filter((p) => p !== '');
    role('success-text').textContent = `${parts.join(' · ')}. Your teacher can see it now.`;
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
    useRestored(result);
  };

  const useRestored = (result: RestoreResult): void => {
    session = result.session;
    info = result.info;
    lastHandin = result.lastHandin;
    notifySession();
    if (result.confirm) {
      confirmed = false;
      showConfirm();
    } else {
      confirmed = true;
      showReady();
    }
  };

  const restoreFailed = (err: unknown): void => {
    const text = describe(err);
    switch (codeOf(err)) {
      case 'device_removed':
        showError(text, [{ action: 'rejoin', label: 'Join again' }]);
        return;
      case 'not_on_roster':
        showError(text, [{ action: 'pick-again', label: 'Pick your name again' }]);
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

  const startJoin = async (a: StudentApi, code: string): Promise<void> => {
    const token = epoch;
    lastCodeTried = code;
    let result: RestoreResult | null = null;
    try {
      result = await a.restore();
    } catch (err) {
      if (stale(token)) return;
      const errorCode = codeOf(err);
      if (errorCode && CONNECTION_CODES.includes(errorCode)) {
        restoreFailed(err);
        return;
      }
      // The saved session is unusable (identity lost, class gone, removed): drop it and join afresh.
      await a.leave();
      if (stale(token)) return;
      forgetSession();
    }
    if (stale(token)) return;
    if (result && result.session.code === code) {
      session = result.session;
      info = result.info;
      lastHandin = result.lastHandin;
      confirmed = false;
      notifySession();
      showConfirm();
      return;
    }
    let f: FoundClass;
    try {
      f = await a.findClass(code);
    } catch (err) {
      if (stale(token)) return;
      joinMode = false;
      showCode(code, describe(err));
      return;
    }
    if (stale(token)) return;
    if (result) {
      pending = result;
      found = f;
      showSwitch(result.session, f.info);
    } else {
      showFound(f);
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
      showFound(f);
    } catch (err) {
      if (stale(token)) return;
      setStatus('');
      showCode(code, describe(err));
    } finally {
      busy = false;
      action('next').disabled = false;
    }
  };

  const pickName = async (): Promise<void> => {
    if (busy || !info) return;
    const id = names.querySelector<HTMLInputElement>('input:checked')?.value;
    if (!id) return;
    if (!joinStatus(info, id, now().getTime()).open) {
      pickError.textContent = errorText(STUDENT_ERROR_TEXT, 'class_closed', { class: info.name });
      return;
    }
    busy = true;
    action('pick').disabled = true;
    pickError.textContent = '';
    const token = epoch;
    try {
      const a = await getApi();
      session = await a.join(info, id);
      if (stale(token)) return;
      confirmed = true;
      lastHandin = null;
      draftMemory = null;
      clearHistory();
      notifySession();
      if (joinMode) showJoined();
      else showReady();
    } catch (err) {
      if (stale(token)) return;
      pickError.textContent = describe(err);
      if (codeOf(err) === 'not_on_roster') await refreshList(false);
      focus(action('pick'));
    } finally {
      busy = false;
      action('pick').disabled = names.querySelector('input:checked') === null;
    }
  };

  const refreshList = async (clearError: boolean): Promise<void> => {
    if (!info) return;
    const token = epoch;
    const error = pickError.textContent;
    try {
      const a = await getApi();
      const cls = await a.refreshClass(info.code);
      if (stale(token)) return;
      showPick(cls);
      if (!clearError) pickError.textContent = error;
    } catch (err) {
      if (stale(token)) return;
      pickError.textContent = describe(err);
    }
  };

  const continueAs = async (): Promise<void> => {
    if (busy || !found) return;
    busy = true;
    const token = epoch;
    try {
      const a = await getApi();
      session = await a.continueAs(found);
      if (stale(token)) return;
      confirmed = true;
      lastHandin = savedLastHandin();
      clearHistory();
      notifySession();
      if (joinMode) showJoined();
      else showReady();
    } catch (err) {
      if (stale(token)) return;
      showError(describe(err), [{ action: 'retry-open', label: 'Try again' }]);
    } finally {
      busy = false;
    }
  };

  const signOut = async (forgetCode: boolean, prefill?: string): Promise<void> => {
    if (busy) return;
    busy = true;
    joinMode = false;
    const code = prefill ?? (forgetCode ? '' : (session?.code ?? loadLastCode()));
    const token = epoch;
    try {
      const a = await getApi();
      await a.leave({ forgetCode });
    } catch {
      // Not configured or offline: the local session is still cleared by the API.
    } finally {
      busy = false;
    }
    if (stale(token)) return;
    forgetSession();
    showCode(code);
  };

  const handIn = async (): Promise<void> => {
    if (busy || !session || !work) return;
    if (work.unchanged && !anyway) {
      anyway = true;
      submitLabel();
      focus(submit);
      return;
    }
    const draft: HandinDraft = {
      kind: work.kind,
      code: work.code,
      workspaceJson: work.kind === 'blocks' ? work.workspaceJson : '',
      taskId: taskSelect.value,
      title: titleInput.value,
      note: noteInput.value,
    };
    const problem = draftProblem(draft);
    if (problem) {
      setStatus(errorText(STUDENT_ERROR_TEXT, problem), 'error');
      return;
    }
    if (lastHandin && now().getTime() - lastHandin.at < LIMITS.handinCooldownMs) {
      setStatus(errorText(STUDENT_ERROR_TEXT, 'too_soon'), 'error');
      return;
    }
    if (!isOnline()) {
      setStatus(errorText(STUDENT_ERROR_TEXT, 'offline'), 'error');
      return;
    }
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
      handedIn(record, draft);
    } catch (err) {
      if (stale(token)) return;
      handinFailed(err);
    } finally {
      if (checkTimer !== null) clearTimeout(checkTimer);
      checkTimer = null;
      busy = false;
      submit.disabled = false;
      submitLabel();
      if (dialog.open && !dialog.contains(document.activeElement)) focus(dialog.querySelector<HTMLElement>('.z1-handin-view:not([hidden]) button'));
    }
  };

  const handedIn = (record: HandinRecord, draft: HandinDraft): void => {
    if (!session) return;
    if (record.username !== session.username) {
      session = { ...session, username: record.username }; // renamed by the teacher meanwhile
      notifySession();
    }
    const taskTitle = info?.tasks.find((t) => t.taskId === record.taskId)?.title ?? '';
    lastHandin = { at: record.createdAt?.getTime() ?? now().getTime(), title: taskTitle || record.title };
    draftMemory = { title: draft.title, taskId: draft.taskId };
    handinId = newHandinId();
    clearHistory();
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
      case 'not_on_roster':
        showError(text, [{ action: 'pick-again', label: 'Pick your name again' }]);
        return;
      case 'device_removed':
        showError(text, [{ action: 'rejoin', label: 'Join again' }]);
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
      case 'permission':
        if (err instanceof ClassroomError && err.message === 'task') {
          setStatus(HANDIN_TEXT.taskGone, 'error');
          void refreshTasks();
          return;
        }
        break;
    }
    setStatus(text, 'error');
  };

  const refreshTasks = async (): Promise<void> => {
    if (!info) return;
    const token = epoch;
    try {
      const a = await getApi();
      const cls = await a.refreshClass(info.code);
      if (stale(token)) return;
      info = cls;
      fillTasks(cls, '');
      focus(taskSelect);
    } catch {
      // The status already says what to do; the list simply stays as it was.
    }
  };

  /** "Join again" after the teacher removed this computer: the same uid picks a name again. */
  const rejoin = async (): Promise<void> => {
    const code = session?.code ?? loadLastCode();
    if (!code) {
      showCode('');
      return;
    }
    showView('loading');
    const token = epoch;
    try {
      const a = await getApi();
      const f = await a.findClass(code);
      if (stale(token)) return;
      forgetSession();
      showFound(f);
    } catch (err) {
      if (stale(token)) return;
      forgetSession();
      showCode(code, describe(err));
    }
  };

  const switchClass = async (): Promise<void> => {
    if (busy || !found) return;
    busy = true;
    const target = found;
    const token = epoch;
    try {
      const a = await getApi();
      await a.leave();
    } catch {
      // The local session is cleared anyway.
    } finally {
      busy = false;
    }
    if (stale(token)) return;
    forgetSession();
    showPick(target.info);
  };

  const loadHistory = async (more: boolean): Promise<void> => {
    if (!session || historyState.loading) return;
    historyState.loading = true;
    const token = epoch;
    historyStatus.textContent = 'Loading…';
    action('more').disabled = true;
    try {
      const a = await getApi();
      const last = historyState.items[historyState.items.length - 1];
      const page = more && last?.createdAt ? { before: last.createdAt } : undefined;
      const result = await a.myHandins(session, page);
      if (stale(token)) return;
      historyState.loaded = true;
      historyState.items = more ? [...historyState.items, ...result.items] : result.items;
      historyState.hasMore = result.hasMore;
      renderHistory();
    } catch (err) {
      if (stale(token)) return;
      historyStatus.textContent = describe(err);
    } finally {
      historyState.loading = false;
      action('more').disabled = false;
    }
  };

  const renderHistory = (): void => {
    historyStatus.textContent = historyState.items.length === 0 ? HANDIN_TEXT.noHistory : '';
    historyRows.replaceChildren(
      ...historyState.items.map((record) => {
        const when = record.createdAt ? `${record.createdAt.toLocaleDateString()} ${timeText(record.createdAt)}` : '';
        const what = info?.tasks.find((t) => t.taskId === record.taskId)?.title || record.title || '(no title)';
        const open = button('open', 'Open');
        open.dataset.id = record.id;
        return el(
          'li',
          'z1-handin-row',
          el('span', 'z1-handin-when', when),
          el('span', 'z1-handin-what', what),
          el('span', 'z1-handin-kind', record.kind === 'blocks' ? 'Blocks' : 'Code'),
          open,
        );
      }),
    );
    more.hidden = !historyState.hasMore;
  };

  const openRecord = async (id: string): Promise<void> => {
    const record = historyState.items.find((r) => r.id === id);
    if (!record) return;
    const decoded = await decodeContent(record.content);
    if (!decoded.ok) {
      historyStatus.textContent = HANDIN_TEXT.cannotOpen;
      return;
    }
    dialog.close();
    options.openWork?.({ kind: record.kind, code: decoded.code, workspaceJson: decoded.workspaceJson });
  };

  // --- events -------------------------------------------------------------
  const actions: Record<string, () => void> = {
    next: () => void lookUp(codeInput.value),
    back: () => showCode(codeInput.value || loadLastCode()),
    refresh: () => void refreshList(true),
    pick: () => void pickName(),
    continue: () => void continueAs(),
    yes: () => {
      if (!session) return;
      api?.confirm(session);
      confirmed = true;
      showReady();
    },
    other: () => void signOut(false),
    different: () => void signOut(true),
    signout: () => {
      if (!session) return;
      if (confirmDialog(HANDIN_TEXT.signOut(session.className))) void signOut(false);
    },
    'pick-again': () => void signOut(false),
    switch: () => void switchClass(),
    cancel: () => {
      joinMode = false;
      if (pending) useRestored(pending);
      else showCode(loadLastCode());
      pending = null;
    },
    ok: () => {
      if (views.get('joined')!.hidden) showCode(loadLastCode()); // "OK" of the class_deleted error
      else dialog.close();
    },
    handin: () => void handIn(),
    anyway: () => void handIn(),
    retry: () => void handIn(),
    'retry-open': () => reopen(),
    rejoin: () => void rejoin(),
    history: () => {
      history.open = true;
      if (!historyState.loaded) void loadHistory(false);
    },
    more: () => void loadHistory(true),
    close: () => dialog.close(),
  };

  dialog.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || !dialog.contains(target) || (target as HTMLButtonElement).disabled) return;
    const name = target.dataset.action!;
    if (name === 'open') {
      void openRecord(target.dataset.id ?? '');
      return;
    }
    actions[name]?.();
  });
  // Enter in the code field = Next; on a name = This is me. Never a form submit (it would close the dialog).
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
  names.addEventListener('change', () => {
    action('pick').disabled = names.querySelector('input:checked') === null;
  });
  names.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    void pickName();
  });
  filterInput.addEventListener('input', applyFilter);
  filterInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const visible = [...names.querySelectorAll<HTMLInputElement>('label:not([hidden]) input')];
    if (visible.length === 1) {
      visible[0].checked = true;
      action('pick').disabled = false;
      void pickName();
    }
  });
  history.addEventListener('toggle', () => {
    if (history.open && !historyState.loaded) void loadHistory(false);
  });
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
    anyway = false;
    pending = null;
    joinMode = opts.joinCode !== undefined;
    setStatus('');
    showView('loading');
    if (!dialog.open) dialog.showModal();
    run(async () => {
      const a = await getApi();
      if (opts.joinCode !== undefined) await startJoin(a, opts.joinCode);
      else await startRestore(a);
    });
  };

  return {
    open,
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    element: dialog,
  };
}
