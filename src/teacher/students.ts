/**
 * The Students tab (docs/CLASSROOM.md §1.3 T8): the roster table (username, computers, last
 * joined, Rename / Let join again / Remove), the expandable computer list per student, Add
 * students with the shared preview, "Remove computers not used for 30 days" and the computers of
 * removed students. The members listener runs only while this tab is visible.
 */
import { normalizeUsername, shortDeviceId, usernameProblem, type RandomBytes } from '../classroom/model';
import type { Member, Unsubscribe } from '../classroom/teacher';
import { SAVE_FAILED, type DashboardContext } from './context';
import { button, el, fullWhenText, plural } from './format';
import { createRosterForm } from './roster-form';
import type { ClassSession } from './session';

export interface StudentsTab {
  readonly element: HTMLElement;
  refresh(): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

const RENAME_HELP = 'Students keep their hand-ins. On their computer the new name shows the next time they open Hand in.';
const DEVICE_HELP = 'Remove a computer that joined under the wrong name. The student can join again while joining is open, or when you let them join again.';

export function createStudents(ctx: DashboardContext, session: ClassSession, options: { randomBytes?: RandomBytes } = {}): StudentsTab {
  const element = el('section', { className: 'z1t-students', attrs: { 'aria-label': 'Students' } });
  const tableWrap = el('div', { className: 'z1t-table-wrap' });
  const status = el('span', { className: 'z1t-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const removedWrap = el('div', { className: 'z1t-removed-devices' });

  // Add students.
  const form = createRosterForm({ existing: session.detail?.roster ?? {}, idPrefix: 'z1t-add', randomBytes: options.randomBytes, label: 'Add students (one per line)' });
  const addButton = button('Add', () => {
    const entries = form.entries();
    if (!entries || entries.length === 0) return;
    void ctx.save(ctx.api.addStudents(session.code, entries), addStatus).then((ok) => {
      if (ok === SAVE_FAILED) return;
      form.clear();
      ctx.toast(`Added ${plural(entries.length, 'student')}`);
    });
  }, 'z1-btn z1-btn-primary');
  addButton.disabled = true;
  const addStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
  form.onChange(() => {
    const entries = form.entries();
    addButton.disabled = !entries || entries.length === 0;
  });
  const addSection = el('details', { className: 'z1t-add-students' }, [
    el('summary', { text: 'Add students' }),
    form.element,
    el('div', { className: 'z1t-row' }, [addButton, addStatus]),
  ]);

  const removeUnused = button('Remove computers not used for 30 days', () => {
    if (!ctx.confirm('Remove every computer that has not joined or handed in for 30 days? Students can join again while joining is open.')) return;
    void ctx.save(ctx.api.removeUnusedDevices(session.code, 30), status).then((count) => {
      if (count !== SAVE_FAILED) ctx.toast(`Removed ${plural(count, 'computer')}`);
    });
  });

  element.append(
    el('div', { className: 'z1t-toolbar' }, [el('h3', { text: 'Students' }), el('span', { className: 'z1-spacer' }), removeUnused, status]),
    tableWrap,
    removedWrap,
    addSection,
  );

  let expanded = new Set<string>();
  let renaming: string | null = null;
  let releaseMembers: Unsubscribe | null = null;

  function membersOf(studentId: string): Member[] {
    return (session.members ?? []).filter((m) => m.studentId === studentId);
  }

  function deviceRow(member: Member): HTMLElement {
    const li = el('li', { className: 'z1t-device' });
    const last = member.lastHandinAt ? `last hand-in ${fullWhenText(member.lastHandinAt, ctx.now())}` : 'no hand-in yet';
    li.append(
      el('span', { text: `${member.device || 'Unknown browser'} · ${shortDeviceId(member.uid)}` }),
      el('span', { className: 'z1-muted', text: ` · joined ${fullWhenText(member.joinedAt, ctx.now())} · ${last}` }),
    );
    const remove = button('Remove this computer', () => {
      if (!ctx.confirm(`Remove computer ${shortDeviceId(member.uid)} (${member.device}) from the class?`)) return;
      void ctx.save(ctx.api.removeDevice(session.code, member.uid), status).then((ok) => ok !== SAVE_FAILED && ctx.toast('Computer removed'));
    }, 'z1-btn z1-btn-small');
    remove.disabled = !ctx.online();
    li.append(' ', remove);
    return li;
  }

  function renameEditor(studentId: string, current: string): HTMLElement {
    const wrap = el('div', { className: 'z1t-rename' });
    const input = el('input', { attrs: { type: 'text', value: current, 'aria-label': 'New username', maxlength: '40' } });
    const error = el('p', { className: 'z1t-error', attrs: { role: 'alert' } });
    const renameStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
    const save = button('Save', () => {
      const name = normalizeUsername(input.value);
      const problem = usernameProblem(name);
      if (problem) {
        error.textContent = problem === 'too_short' ? 'At least 2 characters.' : problem === 'too_long' ? 'At most 24 characters.' : 'Use letters, digits, ".", "_" and "-".';
        return;
      }
      const taken = Object.entries(session.detail?.roster ?? {}).some(([id, n]) => id !== studentId && n === name);
      if (taken) {
        error.textContent = `${name} is already in the class.`;
        return;
      }
      if (name === current) {
        renaming = null;
        render();
        return;
      }
      void ctx.save(ctx.api.renameStudent(session.code, studentId, name), renameStatus).then((ok) => {
        if (ok === SAVE_FAILED) return;
        renaming = null;
        ctx.toast(`Renamed to ${name}`);
        render();
      });
    }, 'z1-btn z1-btn-primary z1-btn-small');
    const cancel = button('Cancel', () => {
      renaming = null;
      render();
    }, 'z1-btn z1-btn-small');
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        save.click();
      } else if (ev.key === 'Escape') cancel.click();
    });
    wrap.append(el('div', { className: 'z1t-row' }, [input, save, cancel, renameStatus]), error, el('p', { className: 'z1-setting-help', text: RENAME_HELP }));
    queueMicrotask(() => input.focus());
    return wrap;
  }

  function render(): void {
    const detail = session.detail;
    form.setExisting(detail?.roster ?? {});
    tableWrap.replaceChildren();
    if (!detail) return;
    if (detail.students.length === 0) {
      tableWrap.append(el('p', { className: 'z1-muted', text: 'No students yet. Add them below.' }));
    } else {
      const table = el('table', { className: 'z1-table z1t-roster' });
      const hr = el('tr');
      for (const h of ['Username', 'Computers', 'Last joined', 'Actions']) hr.append(el('th', { text: h, attrs: { scope: 'col' } }));
      table.append(el('thead', {}, [hr]));
      const tbody = el('tbody');
      for (const s of detail.students) {
        const members = membersOf(s.studentId);
        const tr = el('tr', { attrs: { 'data-student': s.studentId } });
        const nameCell = el('td', { className: 'z1t-name' });
        if (renaming === s.studentId) nameCell.append(renameEditor(s.studentId, s.username));
        else nameCell.append(el('span', { text: s.username }));
        const computersCell = el('td');
        const toggle = button(session.members === null ? '…' : plural(members.length, 'computer'), () => {
          if (expanded.has(s.studentId)) expanded.delete(s.studentId);
          else expanded.add(s.studentId);
          render();
        }, 'z1-btn z1-btn-small z1t-linkish');
        toggle.setAttribute('aria-expanded', String(expanded.has(s.studentId)));
        computersCell.append(toggle);
        const lastJoined = members.map((m) => m.joinedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
        const joinedCell = el('td', { className: 'z1-muted', text: lastJoined ? fullWhenText(new Date(lastJoined), ctx.now()) : '–' });
        const actions = el('td', { className: 'z1t-actions' });
        const rename = button('Rename', () => {
          renaming = s.studentId;
          render();
        }, 'z1-btn z1-btn-small');
        const rejoin = button('Let join again (15 min)', () => {
          void ctx.save(ctx.api.letRejoin(session.code, s.studentId), status).then((ok) => ok !== SAVE_FAILED && ctx.toast(`${s.username} can join again for 15 minutes`));
        }, 'z1-btn z1-btn-small');
        const remove = button('Remove', () => {
          if (!ctx.confirm(`Remove ${s.username}? Their computers are removed too and they can no longer hand in. Their hand-ins stay (shown as '(removed) ${s.username}').`)) return;
          void ctx.save(ctx.api.removeStudent(session.code, s.studentId), status).then((ok) => ok !== SAVE_FAILED && ctx.toast(`${s.username} removed`));
        }, 'z1-btn z1-btn-small z1t-danger');
        remove.disabled = !ctx.online();
        actions.append(rename, rejoin, remove);
        tr.append(nameCell, computersCell, joinedCell, actions);
        tbody.append(tr);
        if (expanded.has(s.studentId)) {
          const detailRow = el('tr', { className: 'z1t-devices-row' });
          const cell = el('td', { attrs: { colspan: '4' } });
          if (members.length === 0) cell.append(el('p', { className: 'z1-muted', text: 'No computer has joined as this student yet.' }));
          else {
            const ul = el('ul', { className: 'z1t-devices' });
            for (const m of members) ul.append(deviceRow(m));
            cell.append(ul);
          }
          cell.append(el('p', { className: 'z1-setting-help', text: DEVICE_HELP }));
          detailRow.append(cell);
          tbody.append(detailRow);
        }
      }
      table.append(tbody);
      tableWrap.append(table);
    }
    // Members whose studentId is no longer on the roster.
    removedWrap.replaceChildren();
    const orphans = (session.members ?? []).filter((m) => !(m.studentId in detail.roster));
    if (orphans.length > 0) {
      const ul = el('ul', { className: 'z1t-devices' });
      for (const m of orphans) {
        const li = deviceRow(m);
        li.prepend(el('strong', { text: `${m.username} ` }));
        ul.append(li);
      }
      removedWrap.append(el('h4', { text: "Removed students' computers" }), ul);
    }
  }

  return {
    element,
    refresh: render,
    show() {
      releaseMembers ??= session.useMembers();
      render();
    },
    hide() {
      releaseMembers?.();
      releaseMembers = null;
    },
    destroy() {
      releaseMembers?.();
      releaseMembers = null;
    },
  };
}
