/**
 * The student list editor shared by Create class (T3) and Add students (T8): a textarea (one
 * name per line; commas and semicolons also split), the "Shorten last names to an initial"
 * checkbox and the live preview from planRosterAdd(): normalised names, problems per line and
 * the near-duplicate warnings that do not block. Also the task list preview (planTasksAdd).
 */
import { LIMITS, planRosterAdd, planTasksAdd, type RandomBytes, type Roster, type RosterEntry, type RosterPlan, type RosterProblemReason, type TaskEntry } from '../classroom/model';
import { el } from './format';

const PROBLEM_TEXT: Readonly<Record<RosterProblemReason, string>> = {
  empty: 'nothing left after cleaning',
  too_short: `too short (at least ${LIMITS.usernameMin} characters)`,
  too_long: `too long (at most ${LIMITS.usernameMax} characters)`,
  invalid: 'only letters, digits, ".", "_" and "-" are allowed',
  duplicate: 'appears twice in the list',
  already_in_class: 'is already in the class',
  too_many: `more than ${LIMITS.rosterMax} students`,
};

export interface RosterForm {
  readonly element: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly shorten: HTMLInputElement;
  /** The current plan (recomputed on every input). */
  plan(): RosterPlan;
  /** Entries to add when there are no problems; null otherwise. */
  entries(): RosterEntry[] | null;
  /** Called after every change. */
  onChange(listener: () => void): void;
  /** Change the roster the list is checked against. */
  setExisting(roster: Roster): void;
  clear(): void;
}

export function createRosterForm(options: { existing?: Roster; idPrefix: string; randomBytes?: RandomBytes; label?: string }): RosterForm {
  let existing: Roster = options.existing ?? {};
  const listeners: (() => void)[] = [];
  const id = options.idPrefix;

  const textarea = el('textarea', { attrs: { id: `${id}-names`, rows: '6', placeholder: 'Ali Khalil\nSara Mansour\n…', spellcheck: 'false' } });
  const shorten = el('input', { attrs: { type: 'checkbox', id: `${id}-shorten` } });
  shorten.checked = true;
  const preview = el('div', { className: 'z1t-roster-preview', attrs: { 'aria-live': 'polite' } });
  const element = el('div', { className: 'z1t-roster-form' }, [
    el('div', { className: 'z1-setting' }, [
      el('label', { text: options.label ?? 'Student usernames (one per line)', attrs: { for: `${id}-names` } }),
      textarea,
      el('p', { className: 'z1-setting-help', text: 'Type the names as on your class list. Each becomes a username students pick from, like ali.k.' }),
    ]),
    el('label', { className: 'z1-check' }, [shorten, el('span', { text: 'Shorten last names to an initial' })]),
    preview,
  ]);

  let current: RosterPlan = planRosterAdd(existing, '', { shortenLastName: true, randomBytes: options.randomBytes });

  function render(): void {
    current = planRosterAdd(existing, textarea.value, { shortenLastName: shorten.checked, randomBytes: options.randomBytes });
    preview.replaceChildren();
    if (current.add.length > 0) {
      const names = el('div', { className: 'z1t-roster-names' });
      for (const entry of current.add) names.append(el('span', { className: 'z1t-chip', text: entry.username }));
      preview.append(el('p', { className: 'z1-muted', text: `${current.add.length} ${current.add.length === 1 ? 'student' : 'students'} to add:` }), names);
    }
    if (current.problems.length > 0) {
      const list = el('ul', { className: 'z1t-roster-problems' });
      for (const p of current.problems) {
        const item = el('li');
        item.append(el('span', { className: 'z1t-mono', text: `Line ${p.line}: ` }), el('strong', { text: p.input }), ` – ${PROBLEM_TEXT[p.reason]}`);
        if (p.normalized && p.normalized !== p.input) item.append(el('span', { className: 'z1-muted', text: ` (as ${p.normalized})` }));
        list.append(item);
      }
      preview.append(el('p', { className: 'z1t-error', text: 'Fix these lines before adding:' }), list);
    }
    if (current.warnings.length > 0) {
      const list = el('ul', { className: 'z1t-roster-warnings' });
      for (const w of current.warnings) {
        list.append(el('li', { text: `${w.names[0]} and ${w.names[1]} differ by one letter; students may pick the wrong one.` }));
      }
      preview.append(list);
    }
    for (const l of listeners) l();
  }
  textarea.addEventListener('input', render);
  shorten.addEventListener('change', render);

  return {
    element,
    textarea,
    shorten,
    plan: () => current,
    entries: () => (current.problems.length === 0 ? current.add : null),
    onChange: (listener) => void listeners.push(listener),
    setExisting(roster) {
      existing = roster;
      render();
    },
    clear() {
      textarea.value = '';
      render();
    },
  };
}

export interface TasksForm {
  readonly element: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  entries(): TaskEntry[] | null;
  problems(): boolean;
  onChange(listener: () => void): void;
  setExisting(tasks: Readonly<Record<string, string>>): void;
  clear(): void;
}

const TASK_PROBLEM_TEXT = {
  too_long: `too long (at most ${LIMITS.taskTitleMax} characters)`,
  too_many: `more than ${LIMITS.tasksMax} tasks`,
  duplicate: 'appears twice',
} as const;

export function createTasksForm(options: { existing?: Readonly<Record<string, string>>; idPrefix: string; randomBytes?: RandomBytes; label?: string }): TasksForm {
  let existing = options.existing ?? {};
  const listeners: (() => void)[] = [];
  const textarea = el('textarea', { attrs: { id: `${options.idPrefix}-tasks`, rows: '3', placeholder: 'Traffic light\nNight light\n…' } });
  const preview = el('div', { className: 'z1t-roster-preview', attrs: { 'aria-live': 'polite' } });
  const element = el('div', { className: 'z1-setting' }, [el('label', { text: options.label ?? 'Tasks (optional, one per line)', attrs: { for: textarea.id } }), textarea, preview]);
  let current = planTasksAdd(existing, '', options.randomBytes);
  function render(): void {
    current = planTasksAdd(existing, textarea.value, options.randomBytes);
    preview.replaceChildren();
    if (current.problems.length > 0) {
      const list = el('ul', { className: 'z1t-roster-problems' });
      for (const p of current.problems) list.append(el('li', { text: `Line ${p.line}: ${TASK_PROBLEM_TEXT[p.reason]}` }));
      preview.append(list);
    }
    for (const l of listeners) l();
  }
  textarea.addEventListener('input', render);
  return {
    element,
    textarea,
    entries: () => (current.problems.length === 0 ? current.add : null),
    problems: () => current.problems.length > 0,
    onChange: (listener) => void listeners.push(listener),
    setExisting(tasks) {
      existing = tasks;
      render();
    },
    clear() {
      textarea.value = '';
      render();
    },
  };
}
