/**
 * The teacher dashboard (docs/CLASSROOM.md §1.3, §4.13): the not-configured, loading, signed-out
 * and main views, the top bar with the class switcher, the error banner, the class list (T2),
 * Create class (T3), Sign out (T11) and Delete my data (T12). Class pages come from
 * class-page.ts; their live state (ClassSession) is parked for 10 minutes when the teacher
 * switches class. Imports no Firebase: the API arrives through `loadApi` at page load.
 */
import { ClassroomError, TEACHER_ERROR_TEXT } from '../classroom/errors';
import { LIMITS, cleanLine, formatClassCode } from '../classroom/model';
import type { ClassSummary, TeacherApi, TeacherUser, Unsubscribe } from '../classroom/teacher';
import { REVIEW_HANDOFF_PREFIX } from '../share-link';
import { downloadTextFile } from '../ui/sketch-file';
import { createClassPage, type ClassPage } from './class-page';
import { asClassroomError, trackSave, type DashboardContext } from './context';
import { LAST_CLASS_KEY, button, el, keysWithPrefix, readItem, writeItem } from './format';
import { ClassSession, PARK_MS } from './session';

export interface DashboardOptions {
  configured: boolean;
  loadApi: () => Promise<TeacherApi>;
  download?(name: string, data: string | Blob): void;
  copyText?(text: string): Promise<void>;
  confirm?(text: string): boolean;
  now?: () => Date;
  storage?: Storage | null;
  tabStorage?: Storage | null;
  /** The GitHub page of src/firebase-config.ts, for the not-configured card. */
  configUrl?: string;
}

export interface Dashboard {
  destroy(): void;
}

export const NOT_CONFIGURED_TEXT = TEACHER_ERROR_TEXT.not_configured;
export const NOT_CONFIGURED_HELP = 'Follow docs/CLASSROOM.md to create the Firebase project and paste its web config into src/firebase-config.ts.';
export const SIGNED_OUT_INTRO = 'Create a class, give your students the class code, and see their work here.';
export const SIGNIN_HELP_1 = 'You stay signed in in this tab until you close it or sign out. On a shared computer, always sign out.';
export const SIGNIN_HELP_2 = 'If Google says your school blocks this app, ask your IT admin to allow it, or use another Google account.';
export const EMPTY_CLASSES_TEXT = 'No classes yet. Create your first class.';
export const CREATE_HELP = 'You get a class code to give your students. They press Hand in, type the code and their name: no class list to prepare.';
export const DELETE_ALL_HELP =
  'Deletes every class with its hand-ins and joined computers. A big account may need more than one day: the free daily limit stops the run, and you continue it the next day.';
const DEFAULT_CONFIG_URL = 'https://github.com/ebechalani/zero1smartboard/blob/main/src/firebase-config.ts';

function defaultCopyText(text: string): Promise<void> {
  if (!navigator.clipboard) return Promise.reject(new Error('clipboard unavailable'));
  return navigator.clipboard.writeText(text);
}

function defaultDownload(name: string, data: string | Blob): void {
  if (typeof data === 'string') {
    downloadTextFile(name, data);
    return;
  }
  const href = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function safeStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

/** Mount the dashboard into `root`. */
export function mountDashboard(root: HTMLElement, options: DashboardOptions): Dashboard {
  const now = options.now ?? (() => new Date());
  const storage = options.storage === undefined ? safeStorage('localStorage') : options.storage;
  const tabStorage = options.tabStorage === undefined ? safeStorage('sessionStorage') : options.tabStorage;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const handoffKeys = new Set<string>();
  let destroyed = false;

  root.replaceChildren();
  root.classList.add('z1t-root');
  const banner = el('div', { className: 'z1t-banner', attrs: { role: 'alert', hidden: '' } });
  const toastHost = el('div', { className: 'z1t-toast-host' });
  const view = el('div', { className: 'z1t-view' });
  root.append(banner, view, toastHost);

  // ------------------------------------------------------------ context
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function toast(text: string): void {
    toastHost.replaceChildren(el('div', { className: 'z1-toast', text, attrs: { role: 'status' } }));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastHost.replaceChildren(), 4000);
  }
  function showError(err: unknown, retry?: () => void): void {
    const error = asClassroomError(err);
    if (error.code === 'popup_closed') return;
    banner.replaceChildren(el('span', { className: 'z1t-banner-text', text: error.message }));
    if (retry) banner.append(button('Retry', () => retry(), 'z1-btn z1-btn-small'));
    banner.append(button('Dismiss', () => clearError(), 'z1-btn z1-btn-small'));
    banner.hidden = false;
  }
  function clearError(): void {
    banner.hidden = true;
    banner.replaceChildren();
  }
  const ctx: DashboardContext = {
    get api() {
      if (!api) throw new ClassroomError('not_ready', TEACHER_ERROR_TEXT.not_ready);
      return api;
    },
    now,
    storage,
    tabStorage,
    download: options.download ?? defaultDownload,
    copyText: options.copyText ?? defaultCopyText,
    confirm: options.confirm ?? ((text) => window.confirm(text)),
    toast,
    showError,
    clearError,
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    rememberHandoff(key, value) {
      // `<created ms>:<payload>`: the review page drops entries older than a day (§2.13).
      handoffKeys.add(key);
      writeItem(storage, key, `${now().getTime()}:${value}`);
    },
    save: (promise, status) => trackSave(ctx, promise, status),
    setTimeout(fn, ms) {
      const id = setTimeout(() => {
        timers.delete(id);
        if (!destroyed) fn();
      }, ms);
      timers.add(id);
      return id;
    },
    clearTimeout(id) {
      clearTimeout(id);
      timers.delete(id);
    },
    setInterval(fn, ms) {
      const id = setInterval(() => !destroyed && fn(), ms);
      intervals.add(id);
      return id;
    },
    clearInterval(id) {
      clearInterval(id);
      intervals.delete(id);
    },
  };

  function clearHandoffs(): void {
    for (const key of [...handoffKeys, ...keysWithPrefix(storage, REVIEW_HANDOFF_PREFIX)]) writeItem(storage, key, null);
    handoffKeys.clear();
  }
  const onPageHide = () => clearHandoffs();
  window.addEventListener('pagehide', onPageHide);
  const onOnlineChange = () => renderMain();
  window.addEventListener('online', onOnlineChange);
  window.addEventListener('offline', onOnlineChange);

  // -------------------------------------------------------------- state
  let api: TeacherApi | null = null;
  let user: TeacherUser | null = null;
  let classes: ClassSummary[] | null = null;
  let classesError: ClassroomError | null = null;
  let userUnsub: Unsubscribe | null = null;
  let classesUnsub: Unsubscribe | null = null;
  const sessions = new Map<string, ClassSession>();
  let parked: { code: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let openCode: string | null = null;
  let page: ClassPage | null = null;
  let pendingCreated = false;
  /** The last opened class (z1.teacher.lastClass), re-opened once the class list confirms it is this teacher's. */
  let pendingLastClass: string | null = null;

  // ------------------------------------------------------------- render
  function renderNotConfigured(): void {
    view.replaceChildren(
      el('div', { className: 'z1t-card z1t-center-card' }, [
        el('h1', { text: 'ZERO1 Classes' }),
        el('p', { text: NOT_CONFIGURED_TEXT }),
        el('p', { className: 'z1-muted' }, [
          'For the maintainer: ',
          el('a', { text: NOT_CONFIGURED_HELP, attrs: { href: options.configUrl ?? DEFAULT_CONFIG_URL, rel: 'noopener noreferrer', target: '_blank' } }),
        ]),
        el('p', {}, [el('a', { className: 'z1-btn', text: 'Open the simulator', attrs: { href: './' } })]),
      ]),
    );
  }

  let signInButton: HTMLButtonElement | null = null;
  let ready = false;
  function renderSignedOut(): void {
    const b = button('Sign in with Google', onSignInClick, 'z1-btn z1-btn-primary z1t-signin');
    b.disabled = !ready;
    if (!ready) b.textContent = 'Loading…';
    signInButton = b;
    const error = el('p', { className: 'z1t-error', attrs: { role: 'alert', 'data-role': 'signin-error' } });
    view.replaceChildren(
      el('div', { className: 'z1t-card z1t-center-card' }, [
        el('h1', { text: 'ZERO1 Classes' }),
        el('p', { text: SIGNED_OUT_INTRO }),
        b,
        error,
        el('p', { className: 'z1-setting-help', text: SIGNIN_HELP_1 }),
        el('p', { className: 'z1-setting-help', text: SIGNIN_HELP_2 }),
        el('p', {}, [el('a', { text: 'Open the simulator', attrs: { href: './' } })]),
      ]),
    );
  }

  function onSignInClick(): void {
    // The first statement calls signIn(): signInWithPopup runs synchronously in the click (D13).
    const promise = api!.signIn();
    const b = signInButton!;
    const error = view.querySelector<HTMLElement>('[data-role="signin-error"]');
    b.disabled = true;
    b.textContent = 'Signing in…';
    if (error) error.textContent = '';
    promise.then(
      () => undefined, // onUser renders the main view
      (err) => {
        const e = asClassroomError(err);
        b.disabled = false;
        b.textContent = 'Sign in with Google';
        if (e.code !== 'popup_closed' && error) error.textContent = e.message;
      },
    );
  }

  function renderMain(): void {
    if (destroyed) return;
    if (!options.configured) return renderNotConfigured();
    if (!user) return renderSignedOut();
    const top = el('header', { className: 'z1t-topbar' });
    const brand = el('a', { className: 'z1t-brand', text: 'ZERO1 Classes', attrs: { href: '#' } });
    brand.addEventListener('click', (ev) => {
      ev.preventDefault();
      openClass(null);
    });
    top.append(brand);
    if (openCode !== null && classes) {
      const switcher = el('select', { attrs: { 'aria-label': 'Class', id: 'z1t-switcher' } });
      switcher.append(el('option', { text: 'All classes', attrs: { value: '' } }));
      for (const c of classes) switcher.append(el('option', { text: `${c.name} · ${formatClassCode(c.code)}`, attrs: { value: c.code } }));
      switcher.value = classes.some((c) => c.code === openCode) ? openCode : '';
      switcher.addEventListener('change', () => openClass(switcher.value || null));
      top.append(switcher);
    }
    top.append(
      el('a', { className: 'z1-btn z1-btn-small', text: 'Open the simulator', attrs: { href: './', target: '_blank', rel: 'noopener noreferrer' } }),
      el('span', { className: 'z1-spacer' }),
      el('span', { className: 'z1t-user' }, [el('strong', { text: user.name }), ' ', el('span', { className: 'z1-muted', text: user.email })]),
      button('Sign out', () => void signOut(), 'z1-btn z1-btn-small'),
    );
    const main = el('main', { className: 'z1t-main' });
    view.replaceChildren(top, main);
    if (openCode !== null) {
      if (page) main.append(page.element);
    } else {
      main.append(renderClassList());
    }
  }

  function classCard(c: ClassSummary): HTMLElement {
    const card = el('button', { className: 'z1t-class-card', attrs: { type: 'button', 'data-code': c.code } });
    card.append(el('span', { className: 'z1t-class-card-name', text: c.name }), el('span', { className: 'z1t-class-card-code', text: formatClassCode(c.code) }));
    if (c.deleting) card.append(el('span', { className: 'z1t-badge z1t-badge-warn', text: 'Deletion not finished' }));
    else if (!c.handinsOpen) card.append(el('span', { className: 'z1t-badge', text: 'Hand-ins stopped' }));
    else card.append(el('span', { className: 'z1t-badge z1t-badge-ok', text: 'Hand-ins open' }));
    card.addEventListener('click', () => openClass(c.code));
    return card;
  }

  function renderClassList(): HTMLElement {
    const wrap = el('div', { className: 'z1t-classes' });
    const head = el('div', { className: 'z1t-toolbar' }, [el('h2', { text: 'Your classes' }), el('span', { className: 'z1-spacer' }), button('+ New class', () => openCreateDialog(), 'z1-btn z1-btn-primary')]);
    wrap.append(head);
    if (classesError) {
      wrap.append(el('p', { className: 'z1t-error', text: classesError.message }));
    } else if (classes === null) {
      wrap.append(el('p', { className: 'z1-muted', text: 'Loading your classes…' }));
    } else if (classes.length === 0) {
      wrap.append(el('p', { className: 'z1t-empty', text: EMPTY_CLASSES_TEXT }));
    } else {
      const active = classes.filter((c) => c.handinsOpen || c.deleting);
      const stopped = classes.filter((c) => !c.handinsOpen && !c.deleting);
      const grid = el('div', { className: 'z1t-class-grid' });
      for (const c of active) grid.append(classCard(c));
      wrap.append(grid);
      if (stopped.length > 0) {
        const grid2 = el('div', { className: 'z1t-class-grid' });
        for (const c of stopped) grid2.append(classCard(c));
        wrap.append(el('h3', { className: 'z1t-section-title', text: 'Hand-ins stopped' }), grid2);
      }
    }
    wrap.append(renderDeleteData());
    return wrap;
  }

  // ---------------------------------------------------- T12 delete data
  let deletingAll = false;
  function renderDeleteData(): HTMLElement {
    const section = el('details', { className: 'z1t-delete-data' });
    section.append(el('summary', { text: 'Delete my data' }));
    const step1 = el('div', { className: 'z1t-card z1t-card-danger' });
    const confirmInput = el('input', { attrs: { type: 'text', 'aria-label': 'Type DELETE to confirm', placeholder: 'DELETE', autocomplete: 'off' } });
    const progress = el('p', { className: 'z1t-progress', attrs: { role: 'status', 'aria-live': 'polite' } });
    const deleteAll = button(deletingAll ? 'Deleting…' : 'Delete all my classes', () => {
      if (confirmInput.value.trim() !== 'DELETE' || deletingAll) return;
      deletingAll = true;
      deleteAll.disabled = true;
      deleteAll.textContent = 'Deleting…';
      api!
        .deleteAllClasses((text) => (progress.textContent = text))
        .then(
          (result) => {
            progress.textContent = result === 'done' ? 'All classes deleted.' : 'The daily limit was reached. Come back tomorrow and press Delete all my classes again to continue.';
          },
          (err) => showError(err),
        )
        .finally(() => {
          deletingAll = false;
          deleteAll.textContent = 'Delete all my classes';
          updateDeleteAll();
        });
    }, 'z1-btn z1t-danger');
    const updateDeleteAll = () => (deleteAll.disabled = deletingAll || !ctx.online() || confirmInput.value.trim() !== 'DELETE' || (classes?.length ?? 0) === 0);
    updateDeleteAll();
    confirmInput.addEventListener('input', updateDeleteAll);
    step1.append(
      el('h3', { text: 'Step 1: Delete all my classes' }),
      el('p', { className: 'z1-muted', text: DELETE_ALL_HELP }),
      el('div', { className: 'z1t-row' }, [confirmInput, deleteAll]),
      progress,
    );
    const step2 = el('div', { className: 'z1t-card z1t-card-danger' });
    const step2Status = el('p', { className: 'z1t-progress', attrs: { role: 'status' } });
    const deleteAccount = button('Delete my sign-in record', () => {
      // Synchronous: reauthenticateWithPopup runs in the click (T12).
      const promise = api!.deleteAccount();
      deleteAccount.disabled = true;
      step2Status.textContent = 'Confirming with Google…';
      promise.then(
        () => {
          clearHandoffs();
          toast('Your sign-in record was deleted');
        },
        (err) => {
          deleteAccount.disabled = false;
          step2Status.textContent = '';
          showError(err);
        },
      );
    }, 'z1-btn z1t-danger');
    const noClasses = (classes?.length ?? 0) === 0 && classes !== null;
    deleteAccount.disabled = !noClasses || !ctx.online();
    step2.append(
      el('h3', { text: 'Step 2: Delete my sign-in record' }),
      el('p', { className: 'z1-muted', text: noClasses ? 'Removes your Google sign-in from the class platform. Google asks you to confirm.' : TEACHER_ERROR_TEXT.classes_left }),
      deleteAccount,
      step2Status,
    );
    section.append(step1, step2);
    return section;
  }

  // ------------------------------------------------------ T3 create class
  function openCreateDialog(): void {
    const dialog = el('dialog', { className: 'z1-dialog z1t-create', attrs: { 'aria-labelledby': 'z1t-create-title' } });
    const form = el('form', { className: 'z1-dialog-form', attrs: { novalidate: '' } });
    const nameInput = el('input', { attrs: { type: 'text', id: 'z1t-new-name', maxlength: String(LIMITS.classNameMax), required: '', placeholder: '8B Robotics' } });
    const error = el('p', { className: 'z1t-error', attrs: { role: 'alert' } });
    const status = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
    const create = button('Create', () => void submit(), 'z1-btn z1-btn-primary');
    create.setAttribute('type', 'submit');
    const cancel = button('Cancel', () => dialog.close(), 'z1-btn');
    form.append(
      el('h2', { text: 'New class', attrs: { id: 'z1t-create-title' } }),
      el('div', { className: 'z1-setting' }, [el('label', { text: 'Class name', attrs: { for: nameInput.id } }), nameInput]),
      el('p', { className: 'z1-setting-help', text: CREATE_HELP }),
      error,
      el('div', { className: 'z1-dialog-actions' }, [status, el('span', { className: 'z1-spacer' }), cancel, create]),
    );
    dialog.append(form);
    let submitting = false;
    const update = () => {
      create.disabled = submitting || cleanLine(nameInput.value, LIMITS.classNameMax) === '';
    };
    nameInput.addEventListener('input', update);
    update();
    async function submit(): Promise<void> {
      const name = cleanLine(nameInput.value, LIMITS.classNameMax);
      if (name === '' || submitting) return;
      submitting = true;
      update();
      status.textContent = 'Creating…';
      try {
        const detail = await api!.createClass({ name });
        dialog.close();
        pendingCreated = true;
        openClass(detail.code);
      } catch (err) {
        error.textContent = asClassroomError(err).message;
        status.textContent = '';
      }
      submitting = false;
      update();
    }
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void submit();
    });
    dialog.addEventListener('close', () => dialog.remove());
    root.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    nameInput.focus();
  }

  // ----------------------------------------------------- class sessions
  function sessionFor(code: string): ClassSession {
    let session = sessions.get(code);
    if (!session || !session.active) {
      session = new ClassSession(ctx, code);
      sessions.set(code, session);
    }
    return session;
  }

  function park(code: string): void {
    if (parked) {
      if (parked.code === code) return;
      ctx.clearTimeout(parked.timer);
      sessions.get(parked.code)?.stop();
      sessions.delete(parked.code);
    }
    const timer = ctx.setTimeout(() => {
      sessions.get(code)?.stop();
      sessions.delete(code);
      if (parked?.code === code) parked = null;
    }, PARK_MS);
    parked = { code, timer };
  }

  function openClass(code: string | null): void {
    if (page) {
      page.destroy();
      page = null;
    }
    const previous = openCode;
    openCode = code;
    if (code !== null && parked?.code === code) {
      ctx.clearTimeout(parked.timer);
      parked = null;
    }
    if (previous !== null && previous !== code && sessions.has(previous)) park(previous);
    if (code !== null) {
      const session = sessionFor(code);
      page = createClassPage(ctx, session, {
        onDeleted: () => {
          sessions.get(code)?.stop();
          sessions.delete(code);
          openClass(null);
        },
      });
      if (pendingCreated) {
        pendingCreated = false;
        const unsub = session.onChange(() => {
          if (session.detail) {
            page?.showCreated();
            unsub();
          }
        });
        if (session.detail) {
          page.showCreated();
          unsub();
        }
      }
      writeItem(storage, LAST_CLASS_KEY, code);
    } else {
      writeItem(storage, LAST_CLASS_KEY, null);
    }
    renderMain();
  }

  function stopAllSessions(): void {
    for (const s of sessions.values()) s.stop();
    sessions.clear();
    if (parked) {
      ctx.clearTimeout(parked.timer);
      parked = null;
    }
  }

  // --------------------------------------------------------------- auth
  function onUserChange(next: TeacherUser | null): void {
    const wasSignedIn = user !== null;
    user = next;
    if (next) {
      // z1.teacher.lastClass is per browser: on a shared PC it may name another teacher's class.
      if (!wasSignedIn && openCode === null) pendingLastClass = readItem(storage, LAST_CLASS_KEY);
      if (!classesUnsub) subscribeClasses();
    } else {
      classesUnsub?.();
      classesUnsub = null;
      classes = null;
      classesError = null;
      pendingLastClass = null;
      if (page) {
        page.destroy();
        page = null;
      }
      openCode = null;
      stopAllSessions();
    }
    renderMain();
  }

  function subscribeClasses(): void {
    classesUnsub?.();
    classesUnsub = api!.watchClasses(
      (list) => {
        classes = list;
        classesError = null;
        if (pendingLastClass !== null) {
          const last = pendingLastClass;
          pendingLastClass = null;
          if (openCode === null && list.some((c) => c.code === last)) {
            openClass(last);
            return;
          }
          writeItem(storage, LAST_CLASS_KEY, null);
        }
        if (openCode !== null && !list.some((c) => c.code === openCode) && page) {
          // The open class is gone (deleted elsewhere): back to the list once its session says so.
          const session = sessions.get(openCode);
          if (session?.detail === null) openClass(null);
        }
        clearError();
        renderMain();
      },
      (err) => {
        classesError = err;
        showError(err, () => subscribeClasses());
        renderMain();
      },
    );
  }

  async function signOut(): Promise<void> {
    stopAllSessions();
    classesUnsub?.();
    classesUnsub = null;
    clearHandoffs();
    try {
      await api!.signOut();
    } catch (err) {
      showError(err);
    }
    onUserChange(null);
  }

  // --------------------------------------------------------------- boot
  renderMain();
  if (options.configured) {
    options.loadApi().then(
      (loaded) => {
        if (destroyed) return;
        api = loaded;
        userUnsub = api.onUser(onUserChange);
        api.ready.then(
          () => {
            ready = true;
            if (!user) renderMain();
          },
          (err) => showError(err),
        );
      },
      (err) => showError(err),
    );
  }

  return {
    destroy() {
      destroyed = true;
      stopAllSessions();
      classesUnsub?.();
      userUnsub?.();
      page?.destroy();
      for (const id of timers) clearTimeout(id);
      for (const id of intervals) clearInterval(id);
      if (toastTimer) clearTimeout(toastTimer);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnlineChange);
      window.removeEventListener('offline', onOnlineChange);
      root.replaceChildren();
    },
  };
}
