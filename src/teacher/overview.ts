/**
 * The Overview tab (docs/CLASSROOM.md §1.3 T5): the period filter, the "12 students handed in
 * today" line, one row per student (hand-ins grouped by name) with New / Seen, the last hand-in,
 * the number of versions and computers, one-click Open and .ino, the zip downloads and the
 * retention notices. The detail panel (T6) sits beside the table at 1200 px and above.
 */
import type { HandinRecord } from '../classroom/model';
import type { DashboardContext } from './context';
import { createDetailPanel, inoButton, openLink } from './detail';
import { button, el, plural, whenText } from './format';
import { latestOfEach, overviewRows, sortRows, zipOf, type OverviewRow } from './handins';
import { PERIODS, type ClassSession, type Period } from './session';

export interface OverviewTab {
  readonly element: HTMLElement;
  /** Re-render from the session. */
  refresh(): void;
  /** Where the retention notice goes. */
  readonly notices: HTMLElement;
  show(): void;
  hide(): void;
  destroy(): void;
}

export const NO_HANDINS_TEXT = 'Nothing handed in yet. Students press Hand in, type the class code and their name.';

export function createOverview(ctx: DashboardContext, session: ClassSession): OverviewTab {
  const element = el('section', { className: 'z1t-overview', attrs: { 'aria-label': 'Overview' } });
  const notices = el('div', { className: 'z1t-notices' });
  const toolbar = el('div', { className: 'z1t-toolbar' });
  const periodSelect = el('select', { attrs: { 'aria-label': 'Period', id: 'z1t-period' } });
  for (const p of PERIODS) periodSelect.append(el('option', { text: p.label, attrs: { value: p.value } }));
  periodSelect.value = session.period;
  periodSelect.addEventListener('change', () => session.setPeriod(periodSelect.value as Period));
  const refreshButton = button('Refresh', () => session.refresh());
  const sortSelect = el('select', { attrs: { 'aria-label': 'Sort by' } });
  sortSelect.append(el('option', { text: 'Sort by name', attrs: { value: 'name' } }), el('option', { text: 'Sort by last hand-in', attrs: { value: 'last' } }));
  let sortBy: 'name' | 'last' = 'name';
  sortSelect.addEventListener('change', () => {
    sortBy = sortSelect.value as 'name' | 'last';
    renderTable();
  });
  const zipLatest = button('Download latest of each student (.zip)', () => downloadZip(latestOfEach(session.items), 'latest'));
  const zipAll = button('Download all shown (.zip)', () => downloadZip(session.items, 'all'));
  toolbar.append(el('label', { className: 'z1t-toolbar-item' }, [el('span', { text: 'Period' }), periodSelect]), refreshButton, sortSelect, el('span', { className: 'z1-spacer' }), zipLatest, zipAll);
  const headline = el('p', { className: 'z1t-headline', attrs: { role: 'status', 'aria-live': 'polite' } });
  const announce = el('p', { className: 'z1t-sr-only', attrs: { role: 'status', 'aria-live': 'polite' } });
  const tableWrap = el('div', { className: 'z1t-table-wrap' });
  const detail = createDetailPanel(ctx, session, { onClose: () => renderTable() });
  const split = el('div', { className: 'z1t-split' }, [el('div', { className: 'z1t-split-main' }, [headline, tableWrap]), detail.element]);
  element.append(notices, toolbar, announce, split);

  let lastAnnounced: string[] = [];
  let focusIndex = 0;

  function downloadZip(items: HandinRecord[], which: 'latest' | 'all'): void {
    if (items.length === 0) {
      ctx.toast('Nothing to download in this view.');
      return;
    }
    const name = `${session.detail?.name ?? 'class'}-${which}-${ctx.now().toISOString().slice(0, 10)}.zip`.replace(/[^\w.-]+/g, '_');
    ctx.download(name, zipOf(items, session.cache, ctx.now()));
  }

  function rowElement(row: OverviewRow, index: number): HTMLTableRowElement {
    const tr = el('tr', { attrs: { tabindex: index === focusIndex ? '0' : '-1', 'data-student': row.nameKey } });
    if (row.status === 'new') tr.classList.add('is-new');
    if (detail.nameKey === row.nameKey) tr.classList.add('is-selected');
    if (session.lastAdded.length > 0 && session.lastAdded.includes(row.latest.id)) tr.classList.add('is-fresh');
    const name = el('td', { className: 'z1t-name' }, [el('button', { className: 'z1t-linkish', text: row.name, attrs: { type: 'button' } })]);
    name.querySelector('button')!.addEventListener('click', () => open(row));
    const status = el('td', { className: `z1t-status-cell z1t-status-${row.status}` });
    status.append(
      el('span', { className: 'z1t-status-icon', attrs: { 'aria-hidden': 'true' }, text: row.status === 'new' ? '●' : '✓' }),
      ' ',
      el('span', { text: row.status === 'new' ? 'New' : 'Seen' }),
    );
    const last = el('td', { className: 'z1t-last' });
    last.append(el('span', { text: whenText(row.latest.createdAt, ctx.now()) }), el('span', { className: 'z1-muted', text: ` · ${row.latest.kind === 'blocks' ? 'Blocks' : 'Code'}` }));
    const versions = el('td', { className: 'z1t-num', text: String(row.versions) });
    const computers = el('td', { className: 'z1t-computers' });
    if (row.closeDevices) computers.append(el('span', { className: 'z1t-badge z1t-badge-warn', text: `${row.computers} computers within an hour` }));
    else computers.append(el('span', { text: plural(row.computers, 'computer') }));
    const actions = el('td', { className: 'z1t-actions' });
    const record = row.latest;
    actions.append(
      openLink(ctx, session, record, 'Open', () => session.markSeen(row.nameKey, record.createdAt)),
      inoButton(ctx, session, record, '.ino', () => session.markSeen(row.nameKey, record.createdAt)),
    );
    tr.append(status, name, last, versions, computers, actions);
    tr.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        open(row);
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const rows = [...tableWrap.querySelectorAll<HTMLTableRowElement>('tbody tr')];
        const next = rows[index + (ev.key === 'ArrowDown' ? 1 : -1)];
        if (next) {
          focusIndex = index + (ev.key === 'ArrowDown' ? 1 : -1);
          for (const r of rows) r.tabIndex = -1;
          next.tabIndex = 0;
          next.focus();
        }
      }
    });
    tr.addEventListener('focus', () => (focusIndex = index));
    return tr;
  }

  function open(row: OverviewRow): void {
    detail.show(row.nameKey);
    renderTable();
  }

  function renderTable(): void {
    const items = session.items;
    const rows = sortRows(overviewRows(items, session.seen), sortBy);
    const periodText = PERIODS.find((p) => p.value === session.period)?.header ?? 'today';
    headline.textContent = session.loading && items.length === 0 ? 'Loading…' : `${plural(rows.length, 'student')} handed in ${periodText}`;
    refreshButton.hidden = session.period === 'today';

    tableWrap.replaceChildren();
    if (rows.length === 0) {
      if (!session.loading) tableWrap.append(el('p', { className: 'z1-muted', text: NO_HANDINS_TEXT }));
    } else {
      const table = el('table', { className: 'z1-table z1t-rows' });
      const thead = el('thead');
      const hr = el('tr');
      for (const h of ['Status', 'Student', 'Last hand-in', 'Versions', 'Computers', '']) hr.append(el('th', { text: h, attrs: { scope: 'col' } }));
      thead.append(hr);
      const tbody = el('tbody');
      if (focusIndex >= rows.length) focusIndex = 0;
      rows.forEach((row, i) => tbody.append(rowElement(row, i)));
      table.append(thead, tbody);
      tableWrap.append(table);
    }
    if (session.hasMore) {
      const more = button(session.loading ? 'Loading…' : 'Load 100 more', () => void session.loadMore());
      more.disabled = session.loading;
      tableWrap.append(more);
    }
    detail.refresh();
  }

  function refresh(): void {
    if (periodSelect.value !== session.period) periodSelect.value = session.period;
    renderTable();
    if (session.lastAdded.length > 0 && session.lastAdded !== lastAnnounced) {
      lastAnnounced = session.lastAdded;
      announce.textContent = plural(session.lastAdded.length, 'new hand-in');
    }
  }

  return {
    element,
    notices,
    refresh,
    show: refresh,
    hide() {},
    destroy() {},
  };
}
