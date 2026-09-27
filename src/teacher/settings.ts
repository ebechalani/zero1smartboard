/**
 * The Settings tab (docs/CLASSROOM.md §1.3 T9): class name and teacher name, "Keep hand-ins
 * for" weeks, the task list (add, rename, delete, set current) and the two-step Delete class
 * with the "download everything first" zip and a resumable, budgeted deletion.
 */
import { LIMITS, cleanLine, formatClassCode, normalizeClassCode, type RandomBytes } from '../classroom/model';
import { SAVE_FAILED, type DashboardContext } from './context';
import { button, el, plural } from './format';
import { zipOf } from './handins';
import { createTasksForm } from './roster-form';
import type { ClassSession } from './session';

export interface SettingsTab {
  readonly element: HTMLElement;
  refresh(): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export interface SettingsCallbacks {
  /** The class is gone (deleted): go back to the list. */
  onDeleted(): void;
  /** Deletion stopped early: the class stays with deleting: true. */
  onDeletionUnfinished(): void;
  randomBytes?: RandomBytes;
}

export const DELETE_CLASS_TEXT = 'Deletes the class, its class list, all hand-ins and all joined computers. This cannot be undone.';
export const KEEP_WEEKS_HELP = 'Older hand-ins are deleted automatically when you open this class. You are warned a week before.';

export function createSettings(ctx: DashboardContext, session: ClassSession, callbacks: SettingsCallbacks): SettingsTab {
  const element = el('section', { className: 'z1t-settings', attrs: { 'aria-label': 'Settings' } });

  // Names.
  const nameInput = el('input', { attrs: { type: 'text', id: 'z1t-set-name', maxlength: String(LIMITS.classNameMax), required: '' } });
  const teacherInput = el('input', { attrs: { type: 'text', id: 'z1t-set-teacher', maxlength: String(LIMITS.teacherNameMax) } });
  const namesStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
  const namesError = el('p', { className: 'z1t-error', attrs: { role: 'alert' } });
  const saveNames = button('Save', () => {
    const name = cleanLine(nameInput.value, LIMITS.classNameMax);
    if (name === '') {
      namesError.textContent = 'The class needs a name.';
      return;
    }
    namesError.textContent = '';
    void ctx.save(ctx.api.updateClass(session.code, { name, teacherName: cleanLine(teacherInput.value, LIMITS.teacherNameMax) }), namesStatus).then(
      (ok) => ok !== SAVE_FAILED && ctx.toast('Saved'),
    );
  }, 'z1-btn z1-btn-primary');
  const names = el('form', { className: 'z1t-card' }, [
    el('h3', { text: 'Class' }),
    el('div', { className: 'z1-setting' }, [el('label', { text: 'Class name', attrs: { for: nameInput.id } }), nameInput]),
    el('div', { className: 'z1-setting' }, [el('label', { text: 'Your name as students see it', attrs: { for: teacherInput.id } }), teacherInput]),
    namesError,
    el('div', { className: 'z1t-row' }, [saveNames, namesStatus]),
  ]);
  names.addEventListener('submit', (ev) => {
    ev.preventDefault();
    saveNames.click();
  });

  // Retention.
  const keepInput = el('input', { attrs: { type: 'number', id: 'z1t-set-keep', min: String(LIMITS.keepWeeksMin), max: String(LIMITS.keepWeeksMax), step: '1' } });
  const keepStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
  keepInput.addEventListener('change', () => {
    const weeks = Math.round(Number(keepInput.value));
    if (!Number.isFinite(weeks) || weeks < LIMITS.keepWeeksMin || weeks > LIMITS.keepWeeksMax) {
      keepInput.value = String(session.detail?.keepWeeks ?? LIMITS.keepWeeksMin);
      return;
    }
    void ctx.save(ctx.api.updateClass(session.code, { keepWeeks: weeks }), keepStatus);
  });
  const retention = el('div', { className: 'z1t-card' }, [
    el('h3', { text: 'Hand-ins' }),
    el('div', { className: 'z1-setting' }, [
      el('label', { text: 'Keep hand-ins for', attrs: { for: keepInput.id } }),
      el('div', { className: 'z1t-row' }, [keepInput, el('span', { text: 'weeks' }), keepStatus]),
      el('p', { className: 'z1-setting-help', text: KEEP_WEEKS_HELP }),
    ]),
  ]);

  // Tasks.
  const taskList = el('ul', { className: 'z1t-tasks' });
  const tasksForm = createTasksForm({ existing: {}, idPrefix: 'z1t-set', randomBytes: callbacks.randomBytes, label: 'Add tasks (one per line)' });
  const tasksStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
  const addTasks = button('Add tasks', () => {
    const entries = tasksForm.entries();
    if (!entries || entries.length === 0) return;
    void ctx.save(ctx.api.addTasks(session.code, entries), tasksStatus).then((ok) => {
      if (ok === SAVE_FAILED) return;
      tasksForm.clear();
      ctx.toast(`Added ${plural(entries.length, 'task')}`);
    });
  }, 'z1-btn z1-btn-primary');
  addTasks.disabled = true;
  tasksForm.onChange(() => {
    const entries = tasksForm.entries();
    addTasks.disabled = !entries || entries.length === 0;
  });
  const tasks = el('div', { className: 'z1t-card' }, [el('h3', { text: 'Tasks' }), taskList, tasksForm.element, el('div', { className: 'z1t-row' }, [addTasks, tasksStatus])]);
  let renamingTask: string | null = null;

  function renderTasks(): void {
    const detail = session.detail;
    taskList.replaceChildren();
    tasksForm.setExisting(Object.fromEntries((detail?.tasks ?? []).map((t) => [t.taskId, t.title])));
    if (!detail) return;
    if (detail.tasks.length === 0) taskList.append(el('li', { className: 'z1-muted', text: 'No tasks yet. Tasks let you filter hand-ins, for example "Traffic light".' }));
    for (const t of detail.tasks) {
      const li = el('li', { className: 'z1t-task-item', attrs: { 'data-task': t.taskId } });
      if (renamingTask === t.taskId) {
        const input = el('input', { attrs: { type: 'text', value: t.title, maxlength: String(LIMITS.taskTitleMax), 'aria-label': 'Task title' } });
        const save = button('Save', () => {
          const title = cleanLine(input.value, LIMITS.taskTitleMax);
          if (title === '') return;
          if (detail.tasks.some((o) => o.taskId !== t.taskId && o.title === title)) {
            ctx.toast('A task with this title exists already.');
            return;
          }
          void ctx.save(ctx.api.renameTask(session.code, t.taskId, title), tasksStatus).then((ok) => {
            if (ok === SAVE_FAILED) return;
            renamingTask = null;
            renderTasks();
          });
        }, 'z1-btn z1-btn-primary z1-btn-small');
        const cancel = button('Cancel', () => {
          renamingTask = null;
          renderTasks();
        }, 'z1-btn z1-btn-small');
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            save.click();
          } else if (ev.key === 'Escape') cancel.click();
        });
        li.append(input, save, cancel);
        queueMicrotask(() => input.focus());
      } else {
        li.append(el('span', { className: 'z1t-task-title', text: t.title }));
        if (detail.currentTaskId === t.taskId) li.append(el('span', { className: 'z1t-badge', text: 'Current task' }));
        else {
          li.append(
            button('Set as current', () => void ctx.save(ctx.api.updateClass(session.code, { currentTaskId: t.taskId }), tasksStatus), 'z1-btn z1-btn-small'),
          );
        }
        li.append(
          button('Rename', () => {
            renamingTask = t.taskId;
            renderTasks();
          }, 'z1-btn z1-btn-small'),
          button('Delete', () => {
            if (!ctx.confirm(`Delete the task "${t.title}"? Hand-ins keep it as "(deleted task)".`)) return;
            void ctx.save(ctx.api.deleteTask(session.code, t.taskId), tasksStatus);
          }, 'z1-btn z1-btn-small z1t-danger'),
        );
      }
      taskList.append(li);
    }
  }

  // Delete class.
  const codeInput = el('input', { attrs: { type: 'text', id: 'z1t-del-code', autocomplete: 'off', spellcheck: 'false', placeholder: 'BKT-4M9' } });
  const progress = el('p', { className: 'z1t-progress', attrs: { role: 'status', 'aria-live': 'polite' } });
  const downloadAll = button('Download everything first (.zip)', () => {
    if (session.items.length === 0) {
      ctx.toast('Nothing loaded to download. Choose "Last 30 days" on the Overview first.');
      return;
    }
    ctx.download(`${session.detail?.name ?? 'class'}-everything.zip`.replace(/[^\w.-]+/g, '_'), zipOf(session.items, session.cache, ctx.now()));
  }, 'z1t-linkish');
  let deleting = false;
  const deleteButton = button('Delete class', () => void runDelete(), 'z1-btn z1t-danger');
  deleteButton.disabled = true;
  codeInput.addEventListener('input', () => updateDeleteButton());
  function updateDeleteButton(): void {
    const typed = normalizeClassCode(codeInput.value);
    deleteButton.disabled = deleting || !ctx.online() || (typed !== session.code && !session.detail?.deleting);
  }
  async function runDelete(): Promise<void> {
    if (deleting) return;
    deleting = true;
    updateDeleteButton();
    deleteButton.textContent = 'Deleting…';
    progress.textContent = 'Deleting…';
    try {
      const result = await ctx.api.deleteClass(session.code, (done, total) => {
        progress.textContent = `Deleting… ${done} of ${total === null ? '?' : `about ${total}`}`;
      });
      if (result === 'done') {
        ctx.toast('Class deleted');
        callbacks.onDeleted();
        return;
      }
      progress.textContent = 'Deletion not finished: the daily limit was reached. Come back later and press Finish deleting.';
      callbacks.onDeletionUnfinished();
    } catch (err) {
      ctx.showError(err);
      progress.textContent = 'Deletion not finished. Try again later with Finish deleting.';
    }
    deleting = false;
    deleteButton.textContent = session.detail?.deleting ? 'Finish deleting' : 'Delete class';
    updateDeleteButton();
  }
  const danger = el('div', { className: 'z1t-card z1t-card-danger' }, [
    el('h3', { text: 'Delete class' }),
    el('p', { text: DELETE_CLASS_TEXT }),
    el('p', {}, [downloadAll]),
    el('div', { className: 'z1-setting' }, [el('label', { text: 'Type the class code to confirm', attrs: { for: codeInput.id } }), codeInput]),
    el('div', { className: 'z1t-row' }, [deleteButton, progress]),
  ]);

  element.append(names, retention, tasks, danger);

  let filled = false;
  function refresh(): void {
    const detail = session.detail;
    if (!detail) return;
    if (!filled || document.activeElement !== nameInput) nameInput.value = detail.name;
    if (!filled || document.activeElement !== teacherInput) teacherInput.value = detail.teacherName;
    if (document.activeElement !== keepInput) keepInput.value = String(detail.keepWeeks);
    filled = true;
    renderTasks();
    if (detail.deleting) {
      deleteButton.textContent = deleting ? 'Deleting…' : 'Finish deleting';
      codeInput.parentElement!.hidden = true;
    } else {
      codeInput.parentElement!.hidden = false;
      if (!deleting) deleteButton.textContent = 'Delete class';
    }
    updateDeleteButton();
  }

  return { element, refresh, show: refresh, hide() {}, destroy() {} };
}

export { formatClassCode };
