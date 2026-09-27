/**
 * The Settings tab (docs/CLASSROOM.md §1.3 T9): the class name, the hand-ins switch, "Keep
 * hand-ins for" weeks, and the two-step Delete class with the "download everything first" zip
 * (every hand-in of the class, paged) and a resumable, budgeted deletion.
 */
import { LIMITS, cleanLine, formatClassCode, normalizeClassCode } from '../classroom/model';
import { SAVE_FAILED, type DashboardContext } from './context';
import { button, el, plural } from './format';
import { zipOf } from './handins';
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
}

export const DELETE_CLASS_TEXT = 'Deletes the class, all hand-ins and all joined computers. This cannot be undone.';
export const KEEP_WEEKS_HELP = 'Older hand-ins are deleted automatically when you open this class. You are warned a week before.';
export const HANDINS_OFF_TEXT = 'This class no longer accepts hand-ins (use it for last year\'s classes).';

export function createSettings(ctx: DashboardContext, session: ClassSession, callbacks: SettingsCallbacks): SettingsTab {
  const element = el('section', { className: 'z1t-settings', attrs: { 'aria-label': 'Settings' } });

  // Name.
  const nameInput = el('input', { attrs: { type: 'text', id: 'z1t-set-name', maxlength: String(LIMITS.classNameMax), required: '' } });
  const namesStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
  const namesError = el('p', { className: 'z1t-error', attrs: { role: 'alert' } });
  const saveNames = button('Save', () => {
    const name = cleanLine(nameInput.value, LIMITS.classNameMax);
    if (name === '') {
      namesError.textContent = 'The class needs a name.';
      return;
    }
    namesError.textContent = '';
    void ctx.save(ctx.api.updateClass(session.code, { name }), namesStatus).then((ok) => ok !== SAVE_FAILED && ctx.toast('Saved'));
  }, 'z1-btn z1-btn-primary');
  const names = el('form', { className: 'z1t-card' }, [
    el('h3', { text: 'Class' }),
    el('div', { className: 'z1-setting' }, [el('label', { text: 'Class name', attrs: { for: nameInput.id } }), nameInput]),
    namesError,
    el('div', { className: 'z1t-row' }, [saveNames, namesStatus]),
  ]);
  names.addEventListener('submit', (ev) => {
    ev.preventDefault();
    saveNames.click();
  });

  // Hand-ins: the switch and the retention.
  const handinsStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
  const handinsSwitch = el('input', { attrs: { type: 'checkbox', role: 'switch', id: 'z1t-set-open', 'aria-label': 'Accepting hand-ins' } });
  handinsSwitch.addEventListener('change', () => void ctx.save(ctx.api.updateClass(session.code, { handinsOpen: handinsSwitch.checked }), handinsStatus));
  const handinsOff = el('p', { className: 'z1t-warn-text', text: HANDINS_OFF_TEXT, attrs: { hidden: '' } });
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
  const handins = el('div', { className: 'z1t-card' }, [
    el('h3', { text: 'Hand-ins' }),
    el('div', { className: 'z1t-row' }, [el('label', { className: 'z1t-switch' }, [handinsSwitch, el('span', { text: 'Accepting hand-ins' })]), handinsStatus]),
    handinsOff,
    el('div', { className: 'z1-setting' }, [
      el('label', { text: 'Keep hand-ins for', attrs: { for: keepInput.id } }),
      el('div', { className: 'z1t-row' }, [keepInput, el('span', { text: 'weeks' }), keepStatus]),
      el('p', { className: 'z1-setting-help', text: KEEP_WEEKS_HELP }),
    ]),
  ]);

  // Delete class.
  const codeInput = el('input', { attrs: { type: 'text', id: 'z1t-del-code', autocomplete: 'off', spellcheck: 'false', placeholder: 'BKT-4M9' } });
  const progress = el('p', { className: 'z1t-progress', attrs: { role: 'status', 'aria-live': 'polite' } });
  const downloadStatus = el('span', { className: 'z1t-status', attrs: { role: 'status' } });
  let downloading = false;
  const downloadAll = button('Download everything first (.zip)', () => void downloadEverything(), 'z1t-linkish');
  async function downloadEverything(): Promise<void> {
    if (downloading) return;
    downloading = true;
    downloadAll.disabled = true;
    downloadStatus.textContent = 'Loading…';
    try {
      const items = await session.loadAll((n) => (downloadStatus.textContent = `Loading… ${n}`));
      if (items.length === 0) {
        downloadStatus.textContent = '';
        ctx.toast('This class has no hand-ins.');
        return;
      }
      ctx.download(`${session.detail?.name ?? 'class'}-everything.zip`.replace(/[^\w.-]+/g, '_'), zipOf(items, session.cache, ctx.now()));
      downloadStatus.textContent = `${plural(items.length, 'hand-in')} in the zip`;
    } catch (err) {
      downloadStatus.textContent = '';
      ctx.showError(err);
    } finally {
      downloading = false;
      downloadAll.disabled = false;
    }
  }
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
    el('p', {}, [downloadAll, ' ', downloadStatus]),
    el('div', { className: 'z1-setting' }, [el('label', { text: 'Type the class code to confirm', attrs: { for: codeInput.id } }), codeInput]),
    el('div', { className: 'z1t-row' }, [deleteButton, progress]),
  ]);

  element.append(names, handins, danger);

  let filled = false;
  function refresh(): void {
    const detail = session.detail;
    if (!detail) return;
    if (!filled || document.activeElement !== nameInput) nameInput.value = detail.name;
    if (document.activeElement !== keepInput) keepInput.value = String(detail.keepWeeks);
    handinsSwitch.checked = detail.handinsOpen;
    handinsOff.hidden = detail.handinsOpen;
    filled = true;
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
