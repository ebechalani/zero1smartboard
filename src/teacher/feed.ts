/**
 * The All hand-ins tab (docs/CLASSROOM.md §1.3 T7): the loaded view as a feed, newest first,
 * with student and task filters and the same detail panel as the Overview.
 */
import type { HandinRecord } from '../classroom/model';
import type { DashboardContext } from './context';
import { createDetailPanel } from './detail';
import { el, firstLine, whenText } from './format';
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
  const taskSelect = el('select', { attrs: { 'aria-label': 'Task', id: 'z1t-feed-task' } });
  let studentFilter = '';
  let taskFilter = '';
  studentSelect.addEventListener('change', () => {
    studentFilter = studentSelect.value;
    renderList();
  });
  taskSelect.addEventListener('change', () => {
    taskFilter = taskSelect.value;
    renderList();
  });
  const toolbar = el('div', { className: 'z1t-toolbar' }, [
    el('label', { className: 'z1t-toolbar-item' }, [el('span', { text: 'Student' }), studentSelect]),
    el('label', { className: 'z1t-toolbar-item' }, [el('span', { text: 'Task' }), taskSelect]),
  ]);
  const list = el('ul', { className: 'z1t-feed-list' });
  const detail = createDetailPanel(ctx, session, { onClose: () => renderList() });
  const split = el('div', { className: 'z1t-split' }, [el('div', { className: 'z1t-split-main' }, [list]), detail.element]);
  element.append(toolbar, split);
  let selectedId: string | null = null;

  function displayName(record: HandinRecord): string {
    const current = session.detail?.roster[record.studentId];
    return current !== undefined ? current : `(removed) ${record.username}`;
  }

  function renderFilters(): void {
    const students = session.detail?.students ?? [];
    studentSelect.replaceChildren(el('option', { text: 'All students', attrs: { value: '' } }));
    for (const s of students) studentSelect.append(el('option', { text: s.username, attrs: { value: s.studentId } }));
    studentSelect.value = students.some((s) => s.studentId === studentFilter) ? studentFilter : '';
    studentFilter = studentSelect.value;
    const tasks = session.detail?.tasks ?? [];
    taskSelect.replaceChildren(el('option', { text: 'All tasks', attrs: { value: '' } }));
    for (const t of tasks) taskSelect.append(el('option', { text: t.title, attrs: { value: t.taskId } }));
    taskSelect.value = tasks.some((t) => t.taskId === taskFilter) ? taskFilter : '';
    taskFilter = taskSelect.value;
    taskSelect.parentElement!.hidden = tasks.length === 0;
  }

  function renderList(): void {
    list.replaceChildren();
    const items = session.items.filter((r) => (studentFilter === '' || r.studentId === studentFilter) && (taskFilter === '' || r.taskId === taskFilter));
    if (items.length === 0) {
      list.append(el('li', { className: 'z1-muted', text: session.loading ? 'Loading…' : 'No hand-ins in this period.' }));
    }
    for (const record of items) {
      const item = el('li', { className: 'z1t-feed-item', attrs: { 'data-handin': record.id } });
      if (record.id === selectedId) item.classList.add('is-selected');
      const row = el('button', { className: 'z1t-feed-row', attrs: { type: 'button' } });
      row.append(
        el('span', { className: 'z1t-feed-time', text: whenText(record.createdAt, ctx.now()) }),
        el('strong', { className: 'z1t-feed-name', text: displayName(record) }),
      );
      const task = session.taskTitle(record.taskId);
      if (task) row.append(el('span', { className: 'z1t-task', text: task }));
      row.append(el('span', { className: 'z1t-feed-title', text: record.title || '(no title)' }));
      row.append(el('span', { className: `z1t-kind z1t-kind-${record.kind}`, text: record.kind === 'blocks' ? 'Blocks' : 'Code' }));
      const note = firstLine(record.note);
      if (note) row.append(el('span', { className: 'z1t-feed-note z1-muted', text: note }));
      row.addEventListener('click', () => {
        selectedId = record.id;
        detail.show(record.studentId, record.id);
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
