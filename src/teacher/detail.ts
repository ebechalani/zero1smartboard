/**
 * The hand-in detail panel (docs/CLASSROOM.md §1.3 T6) and the Open / .ino controls the Overview
 * shares with it (T5). Every user string is rendered with textContent (§3.4). Open is a real
 * link to review.html so middle-click works; .ino and Copy act with no await after the click.
 */
import { fullName, shortDeviceId, type HandinRecord } from '../classroom/model';
import { SAVE_FAILED, type DashboardContext } from './context';
import { button, el, fullWhenText, plural } from './format';
import { DECODE_PROBLEM_TEXT, fileStem, inoName, newestFirst } from './handins';
import { makeZip } from './zip';
import type { ClassSession } from './session';

/** A real link to the review page for `record`, disabled (aria) until the content is decoded. */
export function openLink(ctx: DashboardContext, session: ClassSession, record: HandinRecord, text = 'Open', onOpen?: () => void): HTMLAnchorElement {
  const a = el('a', { className: 'z1-btn z1t-open', text, attrs: { target: '_blank', rel: 'noopener noreferrer' } });
  const decoded = session.cache.get(record.id);
  if (decoded?.ok) {
    a.href = session.reviewLink(record, decoded).href;
    a.title = `Run ${fullName(record.firstName, record.lastName)}'s hand-in in the simulator (new tab)`;
    a.addEventListener('click', () => onOpen?.());
  } else {
    a.setAttribute('aria-disabled', 'true');
    a.title = decoded ? DECODE_PROBLEM_TEXT[decoded.problem] : 'Unpacking…';
    a.addEventListener('click', (ev) => ev.preventDefault());
  }
  void ctx;
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
  /** Show this student's versions (by nameKey); `focusId` highlights that version. */
  show(nameKey: string, focusId?: string): void;
  hide(): void;
  /** Re-render from the session (call on session change). */
  refresh(): void;
  readonly nameKey: string | null;
}

export function createDetailPanel(ctx: DashboardContext, session: ClassSession, options: { onClose?: () => void } = {}): DetailPanel {
  const element = el('section', { className: 'z1t-detail', attrs: { 'aria-label': 'Hand-in detail', hidden: '' } });
  let nameKey: string | null = null;
  let focusId: string | undefined;
  /** Older versions loaded on demand, newest first. */
  let older: HandinRecord[] = [];
  let olderHasMore = true;
  let olderLoading = false;
  let olderOpen = false;

  function versions(): HandinRecord[] {
    if (nameKey === null) return [];
    return session.items.filter((r) => r.nameKey === nameKey).sort(newestFirst);
  }

  function studentName(): string {
    const any = versions()[0] ?? older[0];
    return any ? fullName(any.firstName, any.lastName) : '';
  }

  async function loadOlder(): Promise<void> {
    if (nameKey === null || olderLoading) return;
    olderLoading = true;
    olderOpen = true;
    render();
    const inView = versions();
    const known = new Set([...inView, ...older].map((r) => r.id));
    const last = older[older.length - 1] ?? inView[inView.length - 1];
    try {
      const page = await session.ctx.api.studentHandins(session.code, nameKey, last?.createdAt ? { before: last.createdAt } : undefined);
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
    card.append(head);
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
    const open = openLink(ctx, session, record, 'Open in the simulator', () => session.markSeen(record.nameKey, record.createdAt));
    const ino = inoButton(ctx, session, record, 'Download .ino', () => session.markSeen(record.nameKey, record.createdAt));
    if (record.kind === 'blocks' && decoded?.ok && decoded.workspaceJson !== '') {
      ino.textContent = 'Download .ino + blocks (.zip)';
      ino.title = 'Download the sketch and the blocks program as a .zip';
      ino.onclick = () => {
        const d = session.cache.get(record.id);
        if (!d?.ok) return;
        const base = inoName(record, ctx.now()).replace(/\.ino$/, '');
        const date = record.createdAt ?? ctx.now();
        ctx.download(`${base}.zip`, makeZip([{ name: `${base}.ino`, data: d.code, date }, { name: `${fileStem(record)}.blocks.json`, data: d.workspaceJson, date }]));
        session.markSeen(record.nameKey, record.createdAt);
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

    // Remove the computer, delete.
    const tools = el('div', { className: 'z1t-version-tools' });
    const toolStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
    const removeDevice = button('Remove the computer that sent this', () => {
      if (!ctx.confirm(`Remove computer ${shortDeviceId(record.uid)} from the class? Its student can enter their name again to hand in.`)) return;
      void ctx.save(ctx.api.removeDevice(session.code, record.uid), toolStatus).then((ok) => ok !== SAVE_FAILED && ctx.toast('Computer removed'));
    });
    const del = button('Delete', () => {
      if (!ctx.confirm('Delete this hand-in? This cannot be undone.')) return;
      void ctx.save(ctx.api.deleteHandin(session.code, record.id), toolStatus).then((ok) => {
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
    tools.append(removeDevice, del, toolStatus);
    card.append(tools);
    return card;
  }

  function render(): void {
    element.replaceChildren();
    if (nameKey === null) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    const head = el('header', { className: 'z1t-detail-head' });
    head.append(el('h3', { text: studentName() }));
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
    nameKey = null;
    older = [];
    render();
  }

  return {
    element,
    show(key, focus) {
      if (key !== nameKey) {
        older = [];
        olderHasMore = true;
        olderOpen = false;
      }
      nameKey = key;
      focusId = focus;
      render();
      const first = versions()[0];
      if (first) session.markSeen(key, first.createdAt);
      element.querySelector<HTMLElement>('h3')?.focus?.();
    },
    hide,
    refresh: () => {
      if (nameKey !== null) render();
    },
    get nameKey() {
      return nameKey;
    },
  };
}
