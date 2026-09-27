/**
 * Share dialog: the share link (`#code=` / `#blocks=`) with Copy link, and
 * the sketch as an `.ino` file for the Arduino IDE. Handing work in to a
 * teacher is the job of the Hand in dialog (handin-dialog.ts, docs/CLASSROOM.md);
 * when the class platform is configured this dialog points there.
 *
 * File names carry the name the student gave their class, when there is one
 * (session-store.ts `currentStudentName()`).
 */
import { isClassroomConfigured } from '../classroom/firebase';
import { currentStudentName } from '../classroom/session-store';
import { downloadTextFile, sketchFileName } from './sketch-file';

/** What is being shared: a hand-written sketch or a blocks program. */
export type ShareKind = 'code' | 'blocks';

export interface SharePayload {
  /** The `#code=` / `#blocks=` share link. */
  url: string;
  /** The Arduino sketch (in Blocks mode: the sketch generated from the blocks). */
  code: string;
  kind: ShareKind;
}

/** Shown when the class platform is configured: where hand-ins go. */
export const HANDIN_HINT = 'To send your work to your teacher, use Hand in.';
/** Always shown: where teachers look. */
export const TEACHERS_LINE = "Teachers: see your students' work on the class dashboard (teacher.html).";

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface ShareDialogOptions {
  /** Put text on the clipboard (default: navigator.clipboard.writeText). */
  copyText?(text: string): Promise<void>;
  /**
   * Also called with every feedback message. The dialog always shows them
   * itself: a page toast would sit under the modal backdrop.
   */
  toast?(text: string): void;
  /** Save a text file (default: downloadTextFile inside the dialog). */
  download?(fileName: string, text: string): void;
  /** Whether the class platform is set up (default: isClassroomConfigured()); shows the Hand in hint. */
  configured?: boolean;
  /** The name in the file name (default: currentStudentName()). */
  studentName?(): string;
}

export interface ShareDialog {
  /** Show the dialog for this link and sketch. */
  open(payload: SharePayload): void;
  close(): void;
  isOpen(): boolean;
  readonly element: HTMLDialogElement;
}

function defaultCopyText(text: string): Promise<void> {
  if (!navigator.clipboard) return Promise.reject(new Error('clipboard unavailable'));
  return navigator.clipboard.writeText(text);
}

/**
 * Create the share `<dialog>` and append it to `parent`.
 */
export function createShareDialog(parent: HTMLElement, options: ShareDialogOptions = {}): ShareDialog {
  const copyText = options.copyText ?? defaultCopyText;
  const configured = options.configured ?? isClassroomConfigured();
  const studentName = options.studentName ?? (() => currentStudentName());

  const dialog = document.createElement('dialog');
  dialog.className = 'z1-dialog z1-share';
  dialog.setAttribute('aria-labelledby', 'z1-share-title');
  dialog.innerHTML = `
    <form class="z1-dialog-form" novalidate>
      <h2 id="z1-share-title">Share your work</h2>
      <p class="z1-muted" data-role="intro">Share the link, or keep a copy for the Arduino IDE.</p>

      <div class="z1-setting">
        <label for="z1-share-url">Link</label>
        <div class="z1-share-row">
          <input type="text" id="z1-share-url" readonly spellcheck="false" aria-describedby="z1-share-url-help" />
          <button type="button" class="z1-btn" data-action="copy-link">Copy link</button>
        </div>
        <p class="z1-setting-help" id="z1-share-url-help">Anyone who opens this link sees your work in the simulator.</p>
      </div>

      <fieldset class="z1-share-section">
        <legend>Save as a file</legend>
        <div class="z1-share-row">
          <button type="button" class="z1-btn" data-action="download">Download .ino</button>
          <p class="z1-setting-help">Open it in the Arduino IDE, or attach it to an email.</p>
        </div>
      </fieldset>

      <p class="z1-share-handin" data-role="handin-hint" hidden></p>
      <p class="z1-setting-help" data-role="teachers"></p>

      <div class="z1-dialog-actions">
        <p class="z1-share-status z1-spacer" data-role="status" role="status" aria-live="polite"></p>
        <button type="button" class="z1-btn" data-action="close">Close</button>
      </div>
    </form>
  `;
  const form = dialog.querySelector('form')!;
  const urlInput = dialog.querySelector<HTMLInputElement>('#z1-share-url')!;
  const role = (name: string): HTMLElement => dialog.querySelector<HTMLElement>(`[data-role="${name}"]`)!;
  const status = role('status');
  const action = (name: string): HTMLButtonElement => dialog.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;

  const hint = role('handin-hint');
  hint.hidden = !configured;
  if (configured) {
    const bold = document.createElement('b');
    bold.textContent = 'Hand in';
    hint.replaceChildren('To send your work to your teacher, use ', bold, '.');
  }
  role('teachers').textContent = TEACHERS_LINE;

  let payload: SharePayload = { url: '', code: '', kind: 'code' };
  /** The last file downloaded. A second click in the same second gives the same name: it is not downloaded again (the browser would save "name (1).ino"). */
  let lastFileName = '';

  const notify = (text: string): void => {
    status.textContent = text;
    options.toast?.(text);
  };

  const copyLink = (): void => {
    copyText(payload.url).then(
      () => notify('Link copied'),
      () => {
        urlInput.focus();
        urlInput.select();
        notify('Press Ctrl+C to copy the link');
      },
    );
  };

  const download = (): void => {
    const fileName = sketchFileName(studentName(), new Date());
    if (fileName !== lastFileName) {
      lastFileName = fileName;
      if (options.download) options.download(fileName, payload.code);
      else downloadTextFile(fileName, payload.code, dialog); // inside the modal: it makes the rest of the page inert
    }
    notify(`Downloading ${fileName}`);
  };

  // A read-only link: one click (or Tab) selects all of it, ready for Ctrl+C.
  urlInput.addEventListener('focus', () => urlInput.select());
  urlInput.addEventListener('click', () => urlInput.select());
  // The form must never submit: that would close the dialog (or reload the page).
  form.addEventListener('submit', (e) => e.preventDefault());

  action('copy-link').addEventListener('click', copyLink);
  action('download').addEventListener('click', download);
  action('close').addEventListener('click', () => dialog.close());

  parent.appendChild(dialog);

  return {
    open(next) {
      payload = next;
      urlInput.value = next.url;
      status.textContent = '';
      if (!dialog.open) dialog.showModal();
    },
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    element: dialog,
  };
}
