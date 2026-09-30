/**
 * "Upload to board" dialog: compile the sketch in the browser and flash it to
 * the ZERO1 board over USB, with one line per stage and plain-English errors.
 *
 * Stages: Downloading the compiler (once) → Compiling → Choose your board →
 * Uploading (page x of y) → Done. Compile errors are listed with the .ino
 * line, a hint when one is known (toolchain/diagnostics.ts) and pushed into
 * the app's console through `onConsole`; a "Details" disclosure shows the
 * raw compiler / protocol output. In Python mode the errors point at the
 * Python lines the sketch lines were made from and say that the sketch, not
 * the student's program, is at fault (docs/PYTHON.md §7.12). Upload errors carry the uploader's error
 * code (serial/errors.ts) and a help text per code.
 *
 * The browser's port chooser needs a user gesture, so "Choose your board" is a
 * button: the click calls service.requestPort() before any await.
 */
import type { ConsoleMessage } from '../../types';
import type { AppMode } from '../../ui/blocks-panel';
import type { BuildOutput, DownloadProgress, UploadProgress, UploadResult, UploadServiceLike } from '../service';
import { UploadError, type UploadErrorCode } from '../serial/errors';
import { formatDiagnostic, type Diagnostic } from '../toolchain/diagnostics';
import '../upload.css';

export interface UploadPayload {
  /** The Arduino sketch (in Blocks and Python mode: the sketch made from the program). */
  code: string;
  kind: AppMode;
  /** Shown above the stages (Blocks, Python: "This uploads the Arduino sketch made from your …"). */
  note?: string;
  /** Replaces "Done — the sketch is running on the board" (Python: where print() output goes, docs/PYTHON.md §7.12). */
  successNote?: string;
  /** The line of the student's program that a sketch line was made from (0 = none): compile errors point there. */
  mapLine?(sketchLine: number): number;
  /** Whose line `mapLine` gives: the console jumps to that editor (docs/PYTHON.md §7.10). */
  source?: ConsoleMessage['source'];
  /**
   * Python: a compile error in the generated sketch is not the student's fault. Its text replaces
   * the C++ hint (X-sketch-error), except for a sketch too big for the board, shown as is.
   */
  sketchError?(message: string): string;
}

export interface UploadDialogOptions {
  service: UploadServiceLike;
  /** Compile errors and upload results go to the app console too. */
  onConsole?: (message: ConsoleMessage) => void;
  /** File name shown in error messages (default sketch.ino). */
  fileName?: string;
  /** Link to the third-party notices page (default THIRD_PARTY_NOTICES.md next to the page). */
  noticesUrl?: string;
}

export type UploadStage = 'download' | 'compile' | 'choose' | 'upload' | 'done' | 'error';

export interface UploadDialog {
  open(payload: UploadPayload): void;
  close(): void;
  isOpen(): boolean;
  /** The current stage (tests). */
  stage(): UploadStage;
  readonly element: HTMLDialogElement;
}

/** Help texts per uploader error code, in plain English. */
export const HELP_TEXT: Record<UploadErrorCode, string> = {
  NO_ANSWER: 'Is the Arduino IDE Serial Monitor open? Close it (and any other program using the board), check the USB cable, then try again.',
  NOT_IN_SYNC: 'Press the RESET button on the board now, then click "Try again" right away. If that does not help, unplug and replug the USB cable.',
  PORT: 'Check that the USB cable is plugged in, close the Arduino IDE Serial Monitor and other programs using the board, then try again.',
  UNSUPPORTED: 'Uploading works in Chrome or Edge on a computer.',
  TOO_LARGE: 'Make the sketch smaller: remove code or libraries you do not use.',
  SIGNATURE_MISMATCH: 'Choose the port of the ZERO1 board (USB-SERIAL CH340) in the chooser.',
  VERIFY_FAILED: 'Try again. If it keeps failing, try another USB cable or port.',
  PROTOCOL: 'Unplug and replug the board, then try again.',
  ABORTED: 'The board may hold an incomplete program: upload again before using it.',
  HEX_PARSE: 'Compile the sketch again.',
  HEX_CHECKSUM: 'Compile the sketch again.',
};

const STAGE_TEXT: Record<UploadStage, string> = {
  download: 'Downloading the compiler (once, about 6 MB)',
  compile: 'Compiling',
  choose: 'Choose your board',
  upload: 'Uploading',
  done: 'Done — the sketch is running on the board',
  error: 'Something went wrong',
};

const PAGE_SIZE = 128;

/** Compiler / linker errors of a sketch too big for the board (flash or RAM): they keep their own words in Python mode. */
const TOO_BIG = /region [`']?(text|data)'? overflowed|will not fit in region|section .* is not within region/;

/** The Arduino IDE's size lines. */
export function sizeText(b: BuildOutput): string {
  const flash = b.sizes?.flash ?? b.flashBytes ?? 0;
  const ram = b.sizes?.ram ?? 0;
  const pct = (n: number, max: number) => Math.round((100 * n) / Math.max(1, max));
  return (
    `Sketch uses ${flash.toLocaleString('en-US')} bytes (${pct(flash, b.maxFlash)}%) of program storage space. Maximum is ${b.maxFlash.toLocaleString('en-US')} bytes.\n` +
    `Global variables use ${ram.toLocaleString('en-US')} bytes (${pct(ram, b.maxRam)}%) of dynamic memory. Maximum is ${b.maxRam.toLocaleString('en-US')} bytes.`
  );
}

/** What an error thrown by the service looks like to the student. */
export function describeError(err: unknown): { code: UploadErrorCode | 'INTERNAL'; message: string; help: string } {
  if (err instanceof UploadError) return { code: err.code, message: err.message, help: HELP_TEXT[err.code] };
  const name = (err as { name?: string } | null)?.name;
  if (name === 'AbortError') return { code: 'ABORTED', message: 'Upload cancelled.', help: HELP_TEXT.ABORTED };
  const text = (err as Error | null)?.message ?? String(err);
  return { code: 'INTERNAL', message: `The compiler did not work: ${text}`, help: 'Reload the page and try again. If it keeps failing, use the Arduino IDE.' };
}

/** Create the Upload `<dialog>` and append it to `parent`. */
export function createUploadDialog(parent: HTMLElement, options: UploadDialogOptions): UploadDialog {
  const { service } = options;
  const fileName = options.fileName ?? 'sketch.ino';
  const noticesUrl = options.noticesUrl ?? 'THIRD_PARTY_NOTICES.md';
  const mb = service.downloadBytes ? Math.max(1, Math.round(service.downloadBytes / 1_000_000)) : 6;

  const dialog = document.createElement('dialog');
  dialog.className = 'z1-dialog z1-upload';
  dialog.setAttribute('aria-labelledby', 'z1-upload-title');
  dialog.innerHTML = `
    <form class="z1-dialog-form" novalidate>
      <h2 id="z1-upload-title">Upload to board</h2>
      <p class="z1-muted">Compiles your sketch here in the browser and sends it to the ZERO1 board over the USB cable. No Arduino IDE needed.</p>
      <p class="z1-ide-note" data-role="note" hidden></p>

      <div class="z1-upload-stage" data-role="stage" data-tone="busy" role="status" aria-live="polite">
        <span class="z1-upload-icon" aria-hidden="true"></span>
        <span data-role="stage-text"></span>
      </div>
      <div class="z1-upload-progress" data-role="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div></div></div>
      <p class="z1-upload-size" data-role="size" hidden></p>

      <div class="z1-upload-choose" data-role="choose" hidden>
        <button type="button" class="z1-btn z1-btn-primary" data-action="choose">Choose the board…</button>
        <ol>
          <li>Plug the ZERO1 board into a USB port.</li>
          <li>In the list that opens, pick <b>USB-SERIAL CH340</b> (or "Arduino Uno") and click <b>Connect</b>.</li>
        </ol>
      </div>

      <div class="z1-upload-error" data-role="error" hidden>
        <p class="z1-upload-message" data-role="message"></p>
        <p class="z1-upload-help" data-role="help" hidden></p>
        <ul class="z1-upload-diagnostics" data-role="diagnostics"></ul>
      </div>

      <details class="z1-upload-details" data-role="details" hidden>
        <summary>Details</summary>
        <pre data-role="raw"></pre>
      </details>

      <p class="z1-upload-note">The compiler (GCC for AVR) and the Arduino libraries run under free-software licences: see <a data-role="notices" href="${noticesUrl}" target="_blank" rel="noopener noreferrer">third-party notices</a>.</p>

      <div class="z1-dialog-actions">
        <span class="z1-spacer"></span>
        <button type="button" class="z1-btn" data-action="retry" hidden>Try again</button>
        <button type="button" class="z1-btn" data-action="cancel">Cancel</button>
        <button type="button" class="z1-btn z1-btn-primary" data-action="close" hidden>Close</button>
      </div>
    </form>
  `;
  const form = dialog.querySelector('form')!;
  const role = <T extends HTMLElement = HTMLElement>(name: string): T => dialog.querySelector<T>(`[data-role="${name}"]`)!;
  const action = (name: string): HTMLButtonElement => dialog.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
  const stageEl = role('stage');
  const stageText = role('stage-text');
  const progressEl = role('progress');
  const progressBar = progressEl.firstElementChild as HTMLElement;
  const sizeEl = role('size');
  const chooseEl = role('choose');
  const errorEl = role('error');
  const messageEl = role('message');
  const helpEl = role('help');
  const diagnosticsEl = role('diagnostics');
  const detailsEl = role<HTMLDetailsElement>('details');
  const rawEl = role('raw');
  const chooseButton = action('choose');
  const retryButton = action('retry');
  const cancelButton = action('cancel');
  const closeButton = action('close');

  let payload: UploadPayload = { code: '', kind: 'code' };
  let stage: UploadStage = 'download';
  /** Incremented by every open() and cancel: a late answer is dropped. */
  let session = 0;
  let abort: AbortController | null = null;
  let build: BuildOutput | null = null;
  const log: string[] = [];

  const setStage = (next: UploadStage, text = STAGE_TEXT[next], tone: 'busy' | 'ok' | 'error' | 'idle' = 'busy'): void => {
    stage = next;
    stageEl.dataset.stage = next;
    stageEl.dataset.tone = tone;
    stageText.textContent = text;
    const icon = stageEl.querySelector('.z1-upload-icon')!;
    icon.textContent = tone === 'ok' ? '✓' : tone === 'error' ? '!' : tone === 'idle' ? '?' : '';
    dialog.dataset.stage = next;
    chooseEl.hidden = next !== 'choose';
    retryButton.hidden = next !== 'error';
    cancelButton.hidden = next === 'done' || next === 'error';
    closeButton.hidden = !(next === 'done' || next === 'error');
    progressEl.hidden = next === 'done' || next === 'error' || next === 'choose';
    if (next !== 'error') errorEl.hidden = true;
  };

  const setProgress = (fraction: number | null): void => {
    progressEl.classList.toggle('is-indeterminate', fraction === null);
    const pct = fraction === null ? 0 : Math.max(0, Math.min(100, Math.round(fraction * 100)));
    progressBar.style.width = fraction === null ? '' : `${pct}%`;
    progressEl.setAttribute('aria-valuenow', String(pct));
  };

  const showDetails = (lines: readonly string[]): void => {
    rawEl.textContent = lines.join('\n');
    detailsEl.hidden = lines.length === 0;
  };

  /** The line to show and to jump to: the sketch line, or the program line it was made from (Python). */
  const lineOf = (d: Diagnostic): number => (d.inSketch && d.line ? (payload.mapLine ? payload.mapLine(d.line) : d.line) : 0);

  /** Python: an error in the generated sketch in the student's words (a sketch too big for the board keeps its own words). */
  const sketchErrorText = (d: Diagnostic): string | null =>
    payload.sketchError && d.severity === 'error' && !TOO_BIG.test(d.message) ? payload.sketchError(d.message) : null;

  const showDiagnostics = (list: readonly Diagnostic[]): void => {
    diagnosticsEl.replaceChildren();
    for (const d of list) {
      if (d.severity === 'note') continue;
      const li = document.createElement('li');
      li.dataset.severity = d.severity;
      const where = document.createElement('span');
      where.className = 'z1-upload-where';
      const line = lineOf(d);
      where.textContent = line ? `line ${line}: ` : !payload.sketchError && d.file ? `${d.file.replace(/^.*\//, '')}:${d.line}: ` : '';
      const text = document.createElement('span');
      const replaced = sketchErrorText(d);
      text.textContent = replaced ?? d.message;
      li.append(where, text);
      if (d.hint && replaced === null) {
        const hint = document.createElement('span');
        hint.className = 'z1-upload-hint';
        hint.textContent = d.hint;
        li.appendChild(hint);
      }
      diagnosticsEl.appendChild(li);
    }
  };

  const fail = (message: string, help: string, diagnostics: readonly Diagnostic[] = [], stageLabel = STAGE_TEXT.error): void => {
    setStage('error', stageLabel, 'error');
    errorEl.hidden = false;
    messageEl.textContent = message;
    helpEl.textContent = help;
    helpEl.hidden = help === '';
    showDiagnostics(diagnostics);
    closeButton.focus();
  };

  const consoleMessage = (m: ConsoleMessage): void => options.onConsole?.(m);

  /** Stage 1 + 2: toolchain, then compile. Ends at "choose" or at an error. */
  const compile = async (): Promise<void> => {
    const current = session;
    build = null;
    log.length = 0;
    showDetails([]);
    sizeEl.hidden = true;
    setStage('download', `Downloading the compiler (once, about ${mb} MB)`);
    setProgress(null);
    try {
      await service.prepare((p: DownloadProgress) => {
        if (current !== session) return;
        if (p.fromCache && p.stage !== 'download') setStage('download', 'Starting the compiler');
        setProgress(p.total > 0 ? p.loaded / p.total : null);
      });
      if (current !== session) return;
      setStage('compile');
      setProgress(null);
      const result = await service.build(payload.code, fileName);
      if (current !== session) return;
      showDetails(result.stderr);
      if (!result.ok) {
        const errors = result.diagnostics.filter((d) => d.severity === 'error');
        for (const d of errors) {
          const line = lineOf(d) || undefined;
          const text = sketchErrorText(d) ?? `${formatDiagnostic(d)}${d.hint ? ` — ${d.hint}` : ''}`;
          consoleMessage({ level: 'error', text, line, source: payload.source });
        }
        const what = result.stage === 'link' ? 'The sketch could not be linked' : 'The sketch does not compile';
        // Python: the student cannot fix the generated sketch, and each error already says so.
        const explained = errors.some((d) => d.hint) || (errors.length > 0 && errors.every((d) => sketchErrorText(d) !== null));
        fail(
          errors.length ? `${what}: ${errors.length === 1 ? '1 error' : `${errors.length} errors`}.` : `${what}.`,
          explained ? '' : 'Fix the lines listed below (the Arduino IDE would show the same errors), then try again.',
          result.diagnostics,
          'Compile error',
        );
        return;
      }
      build = result;
      sizeEl.textContent = sizeText(result);
      sizeEl.hidden = false;
      const flash = result.sizes?.flash ?? result.flashBytes ?? 0;
      consoleMessage({ level: 'info', text: `Compiled for the ZERO1 board: ${sizeText(result).split('\n')[0]}` });
      if (flash > result.maxFlash) {
        fail(`The program is too big: ${flash} bytes, but the board only has room for ${result.maxFlash} bytes.`, HELP_TEXT.TOO_LARGE, result.diagnostics, 'Sketch too big');
        return;
      }
      setStage('choose', STAGE_TEXT.choose, 'idle');
      chooseButton.disabled = false;
      chooseButton.focus();
    } catch (err) {
      if (current !== session) return;
      const d = describeError(err);
      consoleMessage({ level: 'error', text: `Upload: ${d.message}` });
      fail(d.message, d.help, [], 'The compiler could not start');
    }
  };

  /** Stage 3 + 4: the chooser (from the click), then the upload. */
  const chooseAndUpload = async (): Promise<void> => {
    if (!build?.hex) return;
    const current = session;
    chooseButton.disabled = true;
    let port;
    try {
      port = await service.requestPort(); // the chooser: still inside the click's user activation
    } catch (err) {
      if (current !== session) return;
      chooseButton.disabled = false;
      const d = describeError(err);
      if (d.code === 'ABORTED') {
        setStage('choose', 'No board chosen — click the button to try again', 'idle');
        return;
      }
      fail(d.message, d.help, [], 'Could not open the board');
      return;
    }
    if (current !== session) return;
    abort = new AbortController();
    const signal = abort.signal;
    setStage('upload', 'Connecting to the board…');
    setProgress(0);
    try {
      const result: UploadResult = await service.upload(build.hex, {
        port,
        signal,
        log: (line) => log.push(line),
        onProgress: (p: UploadProgress) => {
          if (current !== session) return;
          if (p.phase === 'connect') setStage('upload', 'Connecting to the board…');
          else if (p.phase === 'write') {
            const pages = Math.ceil(p.total / PAGE_SIZE);
            setStage('upload', `Uploading (page ${Math.min(pages, Math.floor(p.done / PAGE_SIZE) + (p.done < p.total ? 1 : 0))} of ${pages})`);
          } else if (p.phase === 'verify') setStage('upload', 'Checking the upload');
          setProgress(p.percent / 100);
        },
      });
      if (current !== session) return;
      log.push(`done: ${result.pagesWritten} pages at ${result.baud} baud in ${Math.round(result.ms.total)} ms (bootloader ${result.bootloaderVersion?.major}.${result.bootloaderVersion?.minor})`);
      showDetails(log);
      setProgress(1);
      setStage('done', payload.successNote ?? STAGE_TEXT.done, 'ok');
      consoleMessage({ level: 'info', text: `Uploaded to the board: ${result.pagesWritten} pages in ${(result.ms.total / 1000).toFixed(1)} s. The sketch is running.` });
      closeButton.focus();
    } catch (err) {
      if (current !== session) return;
      const d = describeError(err);
      showDetails(log);
      consoleMessage({ level: 'error', text: `Upload failed (${d.code}): ${d.message}` });
      fail(d.message, d.help, [], d.code === 'ABORTED' ? 'Upload cancelled' : 'Upload failed');
    } finally {
      abort = null;
    }
  };

  const cancel = (): void => {
    if (abort) {
      abort.abort(); // the uploader reports ABORTED, the dialog stays open with the help text
      return;
    }
    session++;
    dialog.close();
  };

  // Nothing in this form is submitted: Enter must not close the dialog.
  form.addEventListener('submit', (e) => e.preventDefault());
  chooseButton.addEventListener('click', () => void chooseAndUpload());
  retryButton.addEventListener('click', () => {
    session++;
    if (build?.hex) {
      setStage('choose', STAGE_TEXT.choose, 'idle');
      chooseButton.disabled = false;
      chooseButton.focus();
    } else void compile();
  });
  cancelButton.addEventListener('click', cancel);
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (e) => {
    // Esc during an upload aborts it instead of closing.
    if (abort) {
      e.preventDefault();
      abort.abort();
    }
  });
  dialog.addEventListener('close', () => {
    session++;
    abort?.abort();
  });

  parent.appendChild(dialog);

  return {
    open(next) {
      session++;
      payload = next;
      const note = role('note');
      note.textContent = next.note ?? '';
      note.hidden = !next.note;
      if (!dialog.open) dialog.showModal();
      void compile();
    },
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    stage: () => stage,
    element: dialog,
  };
}
