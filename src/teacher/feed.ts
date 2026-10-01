/**
 * The All hand-ins tab (docs/CLASSROOM.md §1.3 T7): the loaded view as a feed, newest first,
 * with a student filter (the names in the view) and the same detail panel as the Overview.
 */
import type { HandinRecord } from '../classroom/model';
import type { DashboardContext } from './context';
import { createDetailPanel } from './detail';
import { el, kindChip, whenText } from './format';
import { overviewRows, recordName } from './handins';
import type { ClassSession } from './session';

export interface FeedTab {
  readonly element: HTMLElement;
  refresh(): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export function createFeed(ctx: DashboardContext, session: ClassSession): FeedTab {
  const element = el('section', { className: 'z1t-feed', attrs: { 'aria-label': 'All hand-ins' } });
  const studentSelect = el('select', { attrs: { 'aria-label': 'Student', id: 'z1t-feed-student' } });
  let studentFilter = '';
  studentSelect.addEventListener('change', () => {
    studentFilter = studentSelect.value;
    renderList();
  });
  const toolbar = el('div', { className: 'z1t-toolbar' }, [el('label', { className: 'z1t-toolbar-item' }, [el('span', { text: 'Student' }), studentSelect])]);
  const list = el('ul', { className: 'z1t-feed-list' });
  const detail = createDetailPanel(ctx, session, { onClose: () => renderList() });
  const split = el('div', { className: 'z1t-split' }, [el('div', { className: 'z1t-split-main' }, [list]), detail.element]);
  element.append(toolbar, split);
  let selectedId: string | null = null;

  function renderFilters(): void {
    const students = overviewRows(session.items, session.seen);
    studentSelect.replaceChildren(el('option', { text: 'All students', attrs: { value: '' } }));
    for (const s of students) studentSelect.append(el('option', { text: s.name, attrs: { value: s.nameKey } }));
    studentSelect.value = students.some((s) => s.nameKey === studentFilter) ? studentFilter : '';
    studentFilter = studentSelect.value;
  }

  function renderList(): void {
    list.replaceChildren();
    const items = session.items.filter((r: HandinRecord) => studentFilter === '' || r.nameKey === studentFilter);
    if (items.length === 0) {
      list.append(el('li', { className: 'z1-muted', text: session.loading ? 'Loading…' : 'No hand-ins in this period.' }));
    }
    for (const record of items) {
      const item = el('li', { className: 'z1t-feed-item', attrs: { 'data-handin': record.id } });
      if (record.id === selectedId) item.classList.add('is-selected');
      const row = el('button', { className: 'z1t-feed-row', attrs: { type: 'button' } });
      row.append(
        el('span', { className: 'z1t-feed-time', text: whenText(record.createdAt, ctx.now()) }),
        el('strong', { className: 'z1t-feed-name', text: recordName(record) }),
        kindChip(record.kind),
      );
      row.addEventListener('click', () => {
        selectedId = record.id;
        detail.show(record.nameKey, record.id);
        renderList();
      });
      item.append(row);
      list.append(item);
    }
    detail.refresh();
  }

  function refresh(): void {
    renderFilters();
    renderList();
  }

  return { element, refresh, show: refresh, hide() {}, destroy() {} };
}
