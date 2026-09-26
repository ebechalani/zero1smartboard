/**
 * "Open in Arduino IDE" dialog: gets the sketch from the simulator into the
 * desktop Arduino IDE, to upload it to the real ZERO1 board.
 *
 * A web page cannot start the Arduino IDE itself (the IDE has no link
 * protocol), so the dialog offers what does work:
 * - Download `<name>.ino`. The IDE installers open `.ino` files, and the IDE
 *   then offers to move the file into a sketch folder of the same name. Names
 *   are unique per download (see sketch-file.ts), so a second download never
 *   clashes with the folder made from the first one.
 * - Save `<name>/<name>.ino` straight into a folder the student picks, ideally
 *   the sketchbook (Documents › Arduino), with the File System Access API
 *   (Chrome and Edge only; the button is hidden elsewhere).
 * - Copy the code, to paste into File › New Sketch (works in every IDE).
 * Without an IDE (Chromebooks) the Arduino Cloud Editor can import the file.
 */
import type { AppMode } from './blocks-panel';
import { STUDENT_NAME_STORAGE_KEY } from './share-dialog';
import { downloadTextFile, sketchFileName, sketchName } from './sketch-file';

export interface ArduinoIdePayload {
  /** The Arduino sketch (in Blocks mode: the sketch generated from the blocks). */
  code: string;
  /** Where it comes from: the editor, or the blocks (the dialog then says so). */
  kind: AppMode;
}

/** A writable file in a picked folder (the part of FileSystemFileHandle the dialog uses). */
export interface SketchFileHandle {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/** A folder picked by the student (the part of FileSystemDirectoryHandle the dialog uses). */
export interface SketchFolder {
  readonly name: string;
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<SketchFolder>;
  getFileHandle(name: string, options: { create: boolean }): Promise<SketchFileHandle>;
}

export interface ArduinoIdeDialogOptions {
  /** The time stamped into the sketch name (default: the current time). */
  now?(): Date;
  /** Save a text file (default: downloadTextFile inside the dialog). */
  download?(fileName: string, text: string): void;
  /** Put text on the clipboard (default: navigator.clipboard.writeText). */
  copyText?(text: string): Promise<void>;
  /**
   * Ask the student for a folder (default: window.showDirectoryPicker where
   * the browser has it). Null, or no picker in this browser, hides the
   * "Save into my Arduino folder" button.
   */
  pickDirectory?: (() => Promise<SketchFolder>) | null;
  /** The student's name for the sketch name (default: the one remembered by the Share dialog). */
  studentName?(): string;
}

export interface ArduinoIdeDialog {
  /** Show the dialog for this sketch. */
  open(payload: ArduinoIdePayload): void;
  close(): void;
  isOpen(): boolean;
  readonly element: HTMLDialogElement;
}

/** Where the folder picker starts, and the key under which the browser remembers the last folder. */
const PICKER_OPTIONS = { id: 'zero1-sketchbook', mode: 'readwrite', startIn: 'documents' } as const;

export const ARDUINO_CLOUD_URL = 'https://app.arduino.cc/';

type PickerWindow = Window & { showDirectoryPicker?(options: typeof PICKER_OPTIONS): Promise<SketchFolder> };

/** window.showDirectoryPicker (Chrome, Edge), or null when the browser has none (Firefox, Safari). */
function defaultPickDirectory(): (() => Promise<SketchFolder>) | null {
  if (!('showDirectoryPicker' in window)) return null;
  return () => (window as PickerWindow).showDirectoryPicker!(PICKER_OPTIONS);
}

function defaultCopyText(text: string): Promise<void> {
  if (!navigator.clipboard) return Promise.reject(new Error('clipboard unavailable'));
  return navigator.clipboard.writeText(text);
}

function defaultStudentName(): string {
  try {
    return localStorage.getItem(STUDENT_NAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The error's DOMException name (`AbortError`, `NotAllowedError`, …), or ''. */
function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
}

/**
 * Create the Arduino IDE `<dialog>` and append it to `parent`.
 */
export function createArduinoIdeDialog(parent: HTMLElement, options: ArduinoIdeDialogOptions = {}): ArduinoIdeDialog {
  const now = options.now ?? (() => new Date());
  const copyText = options.copyText ?? defaultCopyText;
  const studentName = options.studentName ?? defaultStudentName;
  const pickDirectory = options.pickDirectory === undefined ? defaultPickDirectory() : options.pickDirectory;

  const dialog = document.createElement('dialog');
  dialog.className = 'z1-dialog z1-ide';
  dialog.setAttribute('aria-labelledby', 'z1-ide-title');
  dialog.innerHTML = `
    <form class="z1-dialog-form" novalidate>
      <h2 id="z1-ide-title">Open in Arduino IDE</h2>
      <p class="z1-muted">Put your sketch into the Arduino IDE on this computer, then upload it to the real ZERO1 board.</p>
      <p class="z1-ide-note" data-role="blocks-note" hidden>This is the Arduino sketch made from your blocks (the code shown in the Code tab).</p>

      <div class="z1-ide-main">
        <button type="button" class="z1-btn z1-btn-primary" data-action="download">Download sketch (.ino)</button>
        <ol class="z1-ide-steps" data-role="steps">
          <li>Open <span data-role="file">the downloaded .ino file</span> (click it in the browser's download list or in your Downloads folder). It opens in the Arduino IDE.</li>
          <li>When the IDE asks to create a sketch folder and move the file, click <b>OK</b>.</li>
          <li>Choose <b>Tools › Board › Arduino Uno</b> and your port, then click <b>Upload</b> (→).</li>
        </ol>
      </div>

      <div class="z1-ide-other">
        <h3 class="z1-ide-heading">Other ways</h3>
        <div class="z1-ide-option" data-role="folder-option">
          <button type="button" class="z1-btn" data-action="save-folder">Save into my Arduino folder…</button>
          <p class="z1-setting-help">Choose <b>Documents › Arduino</b>. The sketch gets its own folder there, ready for File › Open.</p>
        </div>
        <div class="z1-ide-option">
          <button type="button" class="z1-btn" data-action="copy">Copy code</button>
          <p class="z1-setting-help">Then paste it into a new sketch in the Arduino IDE.</p>
        </div>
      </div>

      <p class="z1-muted">No Arduino IDE on this computer (for example a Chromebook)? Download the .ino and import it in the Arduino Cloud Editor (<a href="${ARDUINO_CLOUD_URL}" target="_blank" rel="noopener noreferrer">app.arduino.cc</a> → Create → Import).</p>

      <div class="z1-dialog-actions">
        <p class="z1-ide-status z1-spacer" data-role="status" role="status" aria-live="polite"></p>
        <button type="button" class="z1-btn" data-action="close">Close</button>
      </div>
    </form>
  `;
  const form = dialog.querySelector('form')!;
  const role = <T extends HTMLElement = HTMLElement>(name: string): T => dialog.querySelector<T>(`[data-role="${name}"]`)!;
  const action = (name: string): HTMLButtonElement => dialog.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
  const status = role('status');
  const steps = role('steps');
  const fileLabel = role('file');
  const saveButton = action('save-folder');
  role('folder-option').hidden = pickDirectory === null;

  let payload: ArduinoIdePayload = { code: '', kind: 'code' };
  /** Incremented by every open(): an answer that arrives after a reopen is dropped. */
  let session = 0;

  const setStatus = (text: string, tone: 'ok' | 'error' = 'ok'): void => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  /** Steps as shown before any download (step 1 without a file name, nothing highlighted). */
  const resetSteps = (): void => {
    steps.classList.remove('is-active');
    fileLabel.textContent = 'the downloaded .ino file';
  };

  const download = (): void => {
    const fileName = sketchFileName(studentName(), now());
    (options.download ?? ((name, text) => downloadTextFile(name, text, dialog)))(fileName, payload.code);
    // Step 1 names the exact file, so the student picks the right one in the downloads list.
    const bold = document.createElement('b');
    bold.textContent = fileName;
    fileLabel.replaceChildren('the downloaded file ', bold);
    steps.classList.add('is-active');
    setStatus(`Downloaded ${fileName}. Now follow the steps above.`);
  };

  const saveToFolder = async (): Promise<void> => {
    if (!pickDirectory) return;
    const current = session;
    const { code } = payload;
    const name = sketchName(studentName(), now());
    saveButton.disabled = true;
    try {
      // The picker must open straight from the click (browsers require a user gesture).
      const folder = await pickDirectory();
      const sketchFolder = await folder.getDirectoryHandle(name, { create: true });
      const file = await sketchFolder.getFileHandle(`${name}.ino`, { create: true });
      const writable = await file.createWritable();
      await writable.write(code);
      await writable.close();
      if (current !== session) return;
      const where = folder.name ? `${folder.name}/${name}/${name}.ino` : `${name}/${name}.ino`;
      setStatus(`Saved ${where} — in the Arduino IDE use File › Open… (or File › Sketchbook).`);
    } catch (err) {
      if (current !== session || errorName(err) === 'AbortError') return; // the student closed the picker
      setStatus(
        errorName(err) === 'NotAllowedError'
          ? 'The browser did not allow saving in that folder. Use "Download sketch (.ino)" instead.'
          : 'The sketch could not be saved there. Use "Download sketch (.ino)" instead.',
        'error',
      );
    } finally {
      saveButton.disabled = false;
    }
  };

  const copy = (): void => {
    const current = session;
    copyText(payload.code).then(
      () => {
        if (current === session) {
          setStatus('Code copied. In the Arduino IDE choose File › New Sketch, select everything (Ctrl+A) and paste (Ctrl+V).');
        }
      },
      () => {
        if (current === session) setStatus('The code could not be copied. Use "Download sketch (.ino)" instead.', 'error');
      },
    );
  };

  // Nothing in this form is submitted: Enter must not close the dialog.
  form.addEventListener('submit', (e) => e.preventDefault());
  action('download').addEventListener('click', download);
  saveButton.addEventListener('click', () => void saveToFolder());
  action('copy').addEventListener('click', copy);
  action('close').addEventListener('click', () => dialog.close());

  parent.appendChild(dialog);

  return {
    open(next) {
      session++;
      payload = next;
      role('blocks-note').hidden = next.kind !== 'blocks';
      resetSteps();
      setStatus('');
      saveButton.disabled = false;
      if (!dialog.open) dialog.showModal();
    },
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    element: dialog,
  };
}
