/**
 * The hand-in detail panel (docs/CLASSROOM.md §1.3 T6) and the Open / .ino controls the Overview
 * shares with it (T5). Every user string is rendered with textContent (§3.4). Open is a real
 * link to review.html so middle-click works; .ino and Copy act with no await after the click.
 */
import { shortDeviceId, type HandinRecord } from '../classroom/model';
import { SAVE_FAILED, type DashboardContext } from './context';
import { button, el, fullWhenText, plural } from './format';
import { DECODE_PROBLEM_TEXT, inoName, newestFirst, reviewLinkFor } from './handins';
import { makeZip } from './zip';
import type { ClassSession } from './session';

/** A real link to the review page for `record`, disabled (aria) until the content is decoded. */
export function openLink(ctx: DashboardContext, session: ClassSession, record: HandinRecord, text = 'Open', onOpen?: () => void): HTMLAnchorElement {
  const a = el('a', { className: 'z1-btn z1t-open', text, attrs: { target: '_blank', rel: 'noopener noreferrer' } });
  const decoded = session.cache.get(record.id);
  if (decoded?.ok) {
    const link = reviewLinkFor(record, decoded, session.detail?.name ?? '', session.taskTitle(record.taskId));
    a.href = link.href;
    if (link.handoff) ctx.rememberHandoff(link.handoff.key, link.handoff.value);
    a.title = `Run ${record.username}'s hand-in in the simulator (new tab)`;
    a.addEventListener('click', () => onOpen?.());
  } else {
    a.setAttribute('aria-disabled', 'true');
    a.title = decoded ? DECODE_PROBLEM_TEXT[decoded.problem] : 'Unpacking…';
    a.addEventListener('click', (ev) => ev.preventDefault());
  }
  return a;
}

/** The .ino download button for `record`: enabled once decoded; the click downloads at once. */
export function inoButton(ctx: DashboardContext, session: ClassSession, record: HandinRecord, text = '.ino', onDownload?: () => void): HTMLButtonElement {
  const decoded = session.cache.get(record.id);
  const b = button(text, () => {
    const d = session.cache.get(record.id);
    if (!d?.ok) return;
    ctx.download(inoName(record, ctx.now()), d.code);
    onDownload?.();
  });
  b.disabled = !decoded?.ok;
  b.title = decoded?.ok ? 'Download the sketch as an .ino file' : decoded ? DECODE_PROBLEM_TEXT[decoded.problem] : 'Unpacking…';
  return b;
}

export interface DetailPanel {
  readonly element: HTMLElement;
  /** Show this student's versions; `focusId` scrolls that version into view. */
  show(studentId: string, focusId?: string): void;
  hide(): void;
  /** Re-render from the session (call on session change). */
  refresh(): void;
  readonly studentId: string | null;
}

export function createDetailPanel(ctx: DashboardContext, session: ClassSession, options: { onClose?: () => void } = {}): DetailPanel {
  const element = el('section', { className: 'z1t-detail', attrs: { 'aria-label': 'Hand-in detail', hidden: '' } });
  let studentId: string | null = null;
  let focusId: string | undefined;
  /** Older versions loaded on demand, newest first. */
  let older: HandinRecord[] = [];
  let olderHasMore = true;
  let olderLoading = false;
  let olderOpen = false;

  function versions(): HandinRecord[] {
    if (studentId === null) return [];
    return session.items.filter((r) => r.studentId === studentId).sort(newestFirst);
  }

  function username(): string {
    const fromRoster = session.detail?.roster[studentId ?? ''];
    if (fromRoster !== undefined) return fromRoster;
    const any = versions()[0] ?? older[0];
    return any ? `(removed) ${any.username}` : '';
  }

  async function loadOlder(): Promise<void> {
    if (studentId === null || olderLoading) return;
    olderLoading = true;
    olderOpen = true;
    render();
    const inView = versions();
    const known = new Set([...inView, ...older].map((r) => r.id));
    const last = older[older.length - 1] ?? inView[inView.length - 1];
    try {
      const page = await session.ctx.api.studentHandins(session.code, studentId, last?.createdAt ? { before: last.createdAt } : undefined);
      const fresh = page.items.filter((r) => !known.has(r.id));
      older = [...older, ...fresh].sort(newestFirst);
      olderHasMore = page.hasMore;
      session.addRecords(fresh);
    } catch (err) {
      ctx.showError(err);
    }
    olderLoading = false;
    render();
  }

  function versionCard(record: HandinRecord): HTMLElement {
    const decoded = session.cache.get(record.id);
    const card = el('article', { className: 'z1t-version', attrs: { 'data-handin': record.id } });
    const when = fullWhenText(record.createdAt, ctx.now());
    const head = el('header', { className: 'z1t-version-head' });
    head.append(el('strong', { text: when }), el('span', { className: `z1t-kind z1t-kind-${record.kind}`, text: record.kind === 'blocks' ? 'Blocks' : 'Code' }));
    const task = session.taskTitle(record.taskId);
    if (task) head.append(el('span', { className: 'z1t-task', text: task }));
    card.append(head);
    if (record.title) card.append(el('p', { className: 'z1t-version-title', text: record.title }));
    if (record.note) card.append(el('pre', { className: 'z1t-note', text: record.note }));
    const member = session.members?.find((m) => m.uid === record.uid);
    const computer = `Computer ${shortDeviceId(record.uid)}${member ? ` · ${member.device}` : ''}`;
    card.append(el('p', { className: 'z1-muted z1t-computer', text: computer }));

    if (decoded?.ok) {
      const pre = el('pre', { className: 'z1t-code', text: decoded.code, attrs: { tabindex: '0' } });
      if (record.kind === 'blocks') card.append(el('p', { className: 'z1-muted', text: 'The Arduino sketch made from the blocks:' }));
      card.append(pre);
    } else if (decoded) {
      card.append(el('p', { className: 'z1t-error', text: DECODE_PROBLEM_TEXT[decoded.problem] }));
    } else {
      card.append(el('p', { className: 'z1-muted', text: 'Unpacking…' }));
    }

    const actions = el('div', { className: 'z1t-version-actions' });
    const open = openLink(ctx, session, record, 'Open in the simulator', () => session.markSeen(record.studentId, record.createdAt));
    const ino = inoButton(ctx, session, record, 'Download .ino', () => session.markSeen(record.studentId, record.createdAt));
    if (record.kind === 'blocks' && decoded?.ok && decoded.workspaceJson !== '') {
      ino.textContent = 'Download .ino + blocks (.zip)';
      ino.title = 'Download the sketch and the blocks program as a .zip';
      ino.onclick = () => {
        const d = session.cache.get(record.id);
        if (!d?.ok) return;
        const base = inoName(record, ctx.now()).replace(/\.ino$/, '');
        const date = record.createdAt ?? ctx.now();
        ctx.download(`${base}.zip`, makeZip([{ name: `${base}.ino`, data: d.code, date }, { name: `${record.username}.blocks.json`, data: d.workspaceJson, date }]));
        session.markSeen(record.studentId, record.createdAt);
      };
    }
    const copyStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
    const copy = button('Copy code', () => {
      const d = session.cache.get(record.id);
      if (!d?.ok) return;
      ctx.copyText(d.code).then(
        () => (copyStatus.textContent = 'Copied'),
        () => {
          const pre = card.querySelector<HTMLElement>('.z1t-code');
          if (pre) {
            const range = document.createRange();
            range.selectNodeContents(pre);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
          copyStatus.textContent = 'Press Ctrl+C';
        },
      );
    });
    copy.disabled = !decoded?.ok;
    actions.append(open, ino, copy, copyStatus);
    card.append(actions);

    // Move to… (student / task), remove the computer, delete.
    const tools = el('div', { className: 'z1t-version-tools' });
    const students = session.detail?.students ?? [];
    const moveStudent = el('select', { attrs: { 'aria-label': 'Wrong student? Move to…' } });
    moveStudent.append(el('option', { text: 'Wrong student? Move to…', attrs: { value: '' } }));
    for (const s of students) if (s.studentId !== record.studentId) moveStudent.append(el('option', { text: s.username, attrs: { value: s.studentId } }));
    const moveStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
    moveStudent.addEventListener('change', () => {
      const target = moveStudent.value;
      if (!target) return;
      moveStudent.value = '';
      void ctx.save(ctx.api.refileHandin(session.code, record.id, { studentId: target }), moveStatus).then((ok) => {
        if (ok !== SAVE_FAILED) ctx.toast(`Moved to ${session.detail?.roster[target] ?? 'the student'}`);
      });
    });
    tools.append(moveStudent);
    const tasks = session.detail?.tasks ?? [];
    if (tasks.length > 0) {
      const moveTask = el('select', { attrs: { 'aria-label': 'Wrong task? Move to…' } });
      moveTask.append(el('option', { text: 'Wrong task? Move to…', attrs: { value: '' } }));
      moveTask.append(el('option', { text: '(no task)', attrs: { value: 'none' } }));
      for (const t of tasks) if (t.taskId !== record.taskId) moveTask.append(el('option', { text: t.title, attrs: { value: t.taskId } }));
      moveTask.addEventListener('change', () => {
        const target = moveTask.value;
        if (!target) return;
        moveTask.value = '';
        void ctx.save(ctx.api.refileHandin(session.code, record.id, { taskId: target === 'none' ? '' : target }), moveStatus);
      });
      tools.append(moveTask);
    }
    tools.append(moveStatus);
    const removeDevice = button('Remove the computer that sent this', () => {
      if (!ctx.confirm(`Remove computer ${shortDeviceId(record.uid)} from the class? The student can join again while joining is open.`)) return;
      void ctx.save(ctx.api.removeDevice(session.code, record.uid), moveStatus).then((ok) => ok !== SAVE_FAILED && ctx.toast('Computer removed'));
    });
    const del = button('Delete', () => {
      if (!ctx.confirm('Delete this hand-in? This cannot be undone.')) return;
      void ctx.save(ctx.api.deleteHandin(session.code, record.id), moveStatus).then((ok) => {
        if (ok === SAVE_FAILED) return;
        older = older.filter((r) => r.id !== record.id);
        ctx.toast('Hand-in deleted');
        render();
      });
    });
    del.classList.add('z1t-danger');
    if (!ctx.online()) {
      removeDevice.disabled = true;
      del.disabled = true;
    }
    tools.append(removeDevice, del);
    card.append(tools);
    return card;
  }

  function render(): void {
    element.replaceChildren();
    if (studentId === null) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    const head = el('header', { className: 'z1t-detail-head' });
    head.append(el('h3', { text: username() }));
    head.append(
      button('Close', () => {
        hide();
        options.onClose?.();
      }, 'z1-btn z1-btn-small'),
    );
    element.append(head);
    const inView = versions();
    if (inView.length === 0 && older.length === 0) element.append(el('p', { className: 'z1-muted', text: 'Nothing handed in in this period.' }));
    const list = el('div', { className: 'z1t-versions' });
    for (const record of inView) list.append(versionCard(record));
    element.append(list);

    const details = el('details', { className: 'z1t-older' });
    details.open = olderOpen;
    details.addEventListener('toggle', () => (olderOpen = details.open));
    const olderInView = older.filter((r) => !inView.some((v) => v.id === r.id));
    const summary = el('summary', { text: olderInView.length > 0 ? plural(olderInView.length, 'earlier version') : 'Earlier versions' });
    details.append(summary);
    const olderList = el('div', { className: 'z1t-versions' });
    for (const record of olderInView) olderList.append(versionCard(record));
    details.append(olderList);
    if (olderHasMore) {
      const load = button(olderLoading ? 'Loading…' : 'Load older versions', () => void loadOlder());
      load.disabled = olderLoading;
      details.append(load);
    } else if (olderInView.length === 0) {
      details.append(el('p', { className: 'z1-muted', text: 'No earlier versions.' }));
    }
    element.append(details);

    if (focusId) element.querySelector<HTMLElement>(`[data-handin="${focusId}"]`)?.classList.add('is-focused');
  }

  function hide(): void {
    studentId = null;
    older = [];
    render();
  }

  return {
    element,
    show(id, focus) {
      if (id !== studentId) {
        older = [];
        olderHasMore = true;
        olderOpen = false;
      }
      studentId = id;
      focusId = focus;
      render();
      const first = versions()[0];
      if (first) session.markSeen(id, first.createdAt);
      element.querySelector<HTMLElement>('h3')?.focus?.();
    },
    hide,
    refresh: () => {
      if (studentId !== null) render();
    },
    get studentId() {
      return studentId;
    },
  };
}
