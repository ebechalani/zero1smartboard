/**
 * The class page (docs/CLASSROOM.md §1.3 T4-T10): the header with the code and the hand-ins
 * switch, the Show-to-the-class overlay, the three tabs and the background retention check
 * (§2.11). It renders from a ClassSession that may outlive it.
 */
import { classLink, formatClassCode } from '../classroom/model';
import type { DashboardContext } from './context';
import { createFeed } from './feed';
import { button, el, plural, prunedKey, readItem, writeItem } from './format';
import { overviewRows, zipOf } from './handins';
import { createOverview } from './overview';
import { PERIODS, type ClassSession } from './session';
import { HANDINS_OFF_TEXT, createSettings } from './settings';

export type TabName = 'overview' | 'handins' | 'settings';
const TABS: { name: TabName; label: string }[] = [
  { name: 'overview', label: 'Overview' },
  { name: 'handins', label: 'All hand-ins' },
  { name: 'settings', label: 'Settings' },
];

export { HANDINS_OFF_TEXT };
export const OVERLAY_HELP_TEXT = 'Press Hand in, type the code and your name.';

export interface ClassPage {
  readonly element: HTMLElement;
  setTab(tab: TabName): void;
  /** Show the banner "Class created. Give your students the code …". */
  showCreated(): void;
  destroy(): void;
}

export interface ClassPageCallbacks {
  onDeleted(): void;
}

interface Tab {
  element: HTMLElement;
  refresh(): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export function createClassPage(ctx: DashboardContext, session: ClassSession, callbacks: ClassPageCallbacks): ClassPage {
  const element = el('div', { className: 'z1t-class' });
  const created = el('div', { className: 'z1t-created', attrs: { role: 'status', hidden: '' } });
  const header = el('header', { className: 'z1t-class-head' });
  const tabBar = el('div', { className: 'z1t-tabs', attrs: { role: 'tablist' } });
  const panels = el('div', { className: 'z1t-panels' });
  const overlay = el('div', { className: 'z1t-overlay', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Class code', hidden: '' } });
  element.append(created, header, tabBar, panels, overlay);

  const tabs: Record<TabName, Tab> = {
    overview: createOverview(ctx, session),
    handins: createFeed(ctx, session),
    settings: createSettings(ctx, session, {
      onDeleted: () => callbacks.onDeleted(),
      onDeletionUnfinished: () => render(),
    }),
  };
  let current: TabName = 'overview';
  const tabButtons = new Map<TabName, HTMLButtonElement>();
  for (const { name, label } of TABS) {
    const b = button(label, () => setTab(name), 'z1t-tab');
    b.setAttribute('role', 'tab');
    b.id = `z1t-tab-${name}`;
    tabButtons.set(name, b);
    tabBar.append(b);
    tabs[name].element.setAttribute('role', 'tabpanel');
    tabs[name].element.setAttribute('aria-labelledby', b.id);
    tabs[name].element.hidden = name !== current;
    panels.append(tabs[name].element);
  }

  function setTab(tab: TabName): void {
    if (tab !== current) {
      tabs[current].hide();
      tabs[current].element.hidden = true;
      current = tab;
    }
    for (const [name, b] of tabButtons) b.setAttribute('aria-selected', String(name === current));
    tabs[current].element.hidden = false;
    tabs[current].show();
  }

  // ------------------------------------------------------------- header
  let overlayOpen = false;

  function renderHeader(): void {
    header.replaceChildren();
    const detail = session.detail;
    if (detail === undefined) {
      header.append(el('p', { className: 'z1-muted', text: 'Loading the class…' }));
      return;
    }
    if (detail === null) {
      header.append(el('p', { className: 'z1t-error', text: 'This class no longer exists.' }));
      return;
    }
    const code = formatClassCode(detail.code);
    const title = el('div', { className: 'z1t-class-title' }, [el('h2', { text: detail.name })]);
    const codeRow = el('div', { className: 'z1t-code-row' });
    codeRow.append(el('span', { className: 'z1t-code', text: code, attrs: { 'aria-label': `Class code ${detail.code.split('').join(' ')}` } }));
    const copyStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
    codeRow.append(
      button('Copy code', () => void ctx.copyText(code).then(() => (copyStatus.textContent = 'Code copied'), () => (copyStatus.textContent = 'Could not copy'))),
      button('Copy class link', () =>
        void ctx.copyText(classLink(detail.code)).then(() => (copyStatus.textContent = 'Link copied'), () => (copyStatus.textContent = 'Could not copy')),
      ),
      button('Show to the class', () => openOverlay()),
      copyStatus,
    );
    if (detail.deleting) {
      header.append(title, el('p', { className: 'z1t-error', text: 'Deletion not finished. Open Settings and press Finish deleting.' }));
      return;
    }

    // Hand-ins switch.
    const controls = el('div', { className: 'z1t-class-controls' });
    const handinsStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
    const handinsSwitch = el('input', { attrs: { type: 'checkbox', role: 'switch', 'aria-label': 'Accepting hand-ins' } });
    handinsSwitch.checked = detail.handinsOpen;
    handinsSwitch.addEventListener('change', () => void ctx.save(ctx.api.updateClass(detail.code, { handinsOpen: handinsSwitch.checked }), handinsStatus));
    controls.append(el('label', { className: 'z1t-switch' }, [handinsSwitch, el('span', { text: 'Accepting hand-ins' })]), handinsStatus);
    if (detail.handinsOpen) controls.append(el('p', { className: 'z1t-join-text', text: 'Anyone with the code can hand in under their name.' }));
    else controls.append(el('p', { className: 'z1t-warn-text', text: HANDINS_OFF_TEXT }));
    header.append(title, codeRow, el('div', { className: 'z1t-class-bars' }, [controls]));
  }

  // ------------------------------------------------------------ overlay
  function onOverlayKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') closeOverlay();
  }
  function openOverlay(): void {
    overlayOpen = true;
    overlay.hidden = false;
    document.addEventListener('keydown', onOverlayKey);
    renderOverlay();
    overlay.querySelector<HTMLElement>('button')?.focus();
  }
  function closeOverlay(): void {
    overlayOpen = false;
    overlay.hidden = true;
    document.removeEventListener('keydown', onOverlayKey);
  }
  function renderOverlay(): void {
    if (!overlayOpen) return;
    const detail = session.detail;
    overlay.replaceChildren();
    if (!detail) return;
    const code = formatClassCode(detail.code);
    const link = classLink(detail.code).replace(/^https?:\/\//, '');
    const students = overviewRows(session.items, session.seen).length;
    const periodText = PERIODS.find((p) => p.value === session.period)?.header ?? 'today';
    overlay.append(
      button('Close', () => closeOverlay(), 'z1-btn z1t-overlay-close'),
      el('p', { className: 'z1t-overlay-name', text: detail.name }),
      el('p', { className: 'z1t-overlay-code', text: code, attrs: { 'aria-label': detail.code.split('').join(' ') } }),
      el('p', { className: 'z1t-overlay-link', text: link }),
      el('p', { className: 'z1t-overlay-help' }, ['Open the link, or press ', el('strong', { text: 'Hand in' }), ', type the code and your name.']),
      el('p', { className: 'z1t-overlay-status', text: `${detail.handinsOpen ? 'Hand-ins open' : 'Hand-ins stopped'} · ${plural(students, 'student')} handed in ${periodText}` }),
    );
  }

  // ---------------------------------------------------------- retention
  let retentionRan = false;
  function retentionNotice(): HTMLElement {
    return tabs.overview.element.querySelector<HTMLElement>('.z1t-notices')!;
  }
  async function runRetention(): Promise<void> {
    const detail = session.detail;
    if (retentionRan || !detail || detail.deleting) return;
    retentionRan = true;
    if (readItem(ctx.tabStorage, prunedKey(detail.code)) === '1') return;
    writeItem(ctx.tabStorage, prunedKey(detail.code), '1');
    const week = 7 * 86_400_000;
    const cutoff = new Date(ctx.now().getTime() - detail.keepWeeks * week);
    try {
      const count = await ctx.api.countHandinsBefore(detail.code, new Date(cutoff.getTime() + week));
      if (count > 0) {
        const notice = el('div', { className: 'z1t-notice', attrs: { role: 'status' } });
        const downloadStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
        notice.append(
          el('span', { text: `${plural(count, 'hand-in')} ${count === 1 ? 'is' : 'are'} older than ${detail.keepWeeks - 1} weeks and will be deleted within a week. ` }),
          button('Download them (.zip)', () => void downloadOld(new Date(cutoff.getTime() + week), downloadStatus), 'z1t-linkish'),
          ' · ',
          button('Change in Settings', () => setTab('settings'), 'z1t-linkish'),
          ' ',
          downloadStatus,
        );
        retentionNotice().append(notice);
      }
      const deleted = await ctx.api.pruneHandins(detail.code, cutoff);
      if (deleted > 0) ctx.toast(`Deleted ${plural(deleted, 'hand-in')} older than ${detail.keepWeeks} weeks.`);
    } catch (err) {
      ctx.showError(err);
    }
  }
  /** Every hand-in older than `before`, page by page (no cap: the zip is complete or fails). */
  async function downloadOld(before: Date, status: HTMLElement): Promise<void> {
    try {
      status.textContent = 'Loading…';
      const items = await session.loadAll((n) => (status.textContent = `Loading… ${n}`));
      const old = items.filter((r) => r.createdAt && r.createdAt < before);
      ctx.download(`${session.detail?.name ?? 'class'}-old-handins.zip`.replace(/[^\w.-]+/g, '_'), zipOf(old, session.cache, ctx.now()));
      status.textContent = `${plural(old.length, 'hand-in')} in the zip`;
    } catch (err) {
      status.textContent = '';
      ctx.showError(err);
    }
  }

  // -------------------------------------------------------------- wiring
  let shownError: unknown = null;
  function render(): void {
    if (session.error && session.error !== shownError) {
      shownError = session.error;
      ctx.showError(session.error.error, () => session.retry());
    } else if (!session.error && shownError) {
      shownError = null;
      ctx.clearError();
    }
    renderHeader();
    renderOverlay();
    tabs[current].refresh();
    if (session.detail && !retentionRan) void runRetention();
  }
  const unsubscribe = session.onChange(render);
  session.start();
  setTab('overview');
  render();

  return {
    element,
    setTab,
    showCreated() {
      const detail = session.detail;
      if (!detail) return;
      created.hidden = false;
      created.replaceChildren('Class created. Give your students the code ', el('strong', { text: formatClassCode(detail.code) }), ' or the class link.');
    },
    destroy() {
      unsubscribe();
      closeOverlay();
      for (const tab of Object.values(tabs)) tab.destroy();
      element.remove();
    },
  };
}
