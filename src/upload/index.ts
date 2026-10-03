/**
 * "Upload to board": compile the student's sketch in the browser (GCC for AVR
 * as WebAssembly, in a Web Worker) and flash it to the ZERO1 board (Arduino
 * UNO / ATmega328P with Optiboot, CH340 USB-serial) over Web Serial.
 * See docs/UPLOAD.md.
 *
 * App integration (src/ui/app.ts): a header button with data-slot="upload"
 * after the "Arduino IDE" one, then, in the constructor after the other
 * dialogs are created:
 *
 *   installUploadButton({
 *     button: this.slot('upload'), parent: root,
 *     getSketch: () => this.exportSketch(), onConsole: (m) => this.console.push(m), toast: (t) => this.toast(t),
 *   });
 *
 * The button is always shown (except where the app disposes it, the teacher's review frame).
 * Where feature detection fails (not Chrome/Edge on a computer, no WebAssembly or module
 * workers, no toolchain published with the site), a click explains why and what to do
 * instead: a hidden button could not be found, and said nothing about the reason.
 */
import { createUploadDialog, type UploadDialog, type UploadPayload } from './ui/upload-dialog';
import { UploadService, detectUploadSupport, type UploadServiceLike, type UploadSupport } from './service';
import { createUnsupportedDialog, type UnsupportedDialog } from './ui/unsupported-dialog';
import type { ConsoleMessage } from '../types';

export { UploadService, detectUploadSupport, browserSupportsUpload, isAndroid, supportsModuleWorkers, UNSUPPORTED_TEXT, BOARD_USB_FILTERS } from './service';
export type { UploadServiceLike, UploadSupport, UnsupportedReason, UploadOptions, BuildOutput, DownloadProgress, UploadProgress, UploadResult } from './service';
export { createUploadDialog, HELP_TEXT, sizeText, describeError } from './ui/upload-dialog';
export { createUnsupportedDialog, UNSUPPORTED_ADVICE, UNSUPPORTED_FALLBACK } from './ui/unsupported-dialog';
export type { UnsupportedDialog } from './ui/unsupported-dialog';
export type { UploadDialog, UploadDialogOptions, UploadPayload, UploadStage } from './ui/upload-dialog';
export { UploadError } from './serial/errors';
export type { UploadErrorCode } from './serial/errors';

export interface InstallUploadButtonOptions {
  /** The header button (`<button data-slot="upload" hidden>`); shown at once, hidden again by dispose(). */
  button: HTMLButtonElement;
  /** Where the dialog is appended (the app root). */
  parent: HTMLElement;
  /**
   * The current sketch; `{ error }` when there is none to upload yet (the blocks or Python are
   * still loading, a Python program has errors): the text is toasted as is. Null: nothing to do.
   */
  getSketch(): UploadPayload | { error: string } | null;
  /** Compile errors and upload results, for the app console. */
  onConsole?(message: ConsoleMessage): void;
  toast?(text: string): void;
  /** A ready service (tests); default: a real UploadService once support is detected. */
  service?: UploadServiceLike;
  /** Feature detection override (tests); default: detectUploadSupport(). */
  detect?(): Promise<UploadSupport>;
}

export interface InstalledUploadButton {
  /** Resolves once feature detection ran (a click then opens the Upload dialog, or says why it cannot). */
  readonly ready: Promise<UploadSupport>;
  /** The dialog, once installed (null while unsupported). */
  dialog(): UploadDialog | null;
  /** True while the Upload dialog or the "cannot upload here" dialog is open (the app's global keys leave a sketch alone then). */
  isOpen(): boolean;
  dispose(): void;
}

/**
 * Wire the header button: always shown; it opens the Upload dialog with the current sketch where
 * uploading works, and the "cannot upload here" dialog (why, and what to do instead) elsewhere.
 */
export function installUploadButton(options: InstallUploadButtonOptions): InstalledUploadButton {
  const { button } = options;
  let dialog: UploadDialog | null = null;
  let unsupported: UnsupportedDialog | null = null;
  let service: UploadServiceLike | null = options.service ?? null;
  /** The detection result, once known. */
  let support: UploadSupport | null = null;
  /** A click came before the detection ended: answered when it ends. */
  let clickPending = false;
  /** dispose() came first (the review frame disposes at once): detection shows nothing then. */
  let disposed = false;
  button.hidden = false;

  const onClick = (): void => {
    if (disposed) return;
    if (!support) {
      clickPending = true;
      return;
    }
    if (!support.ok) {
      unsupported ??= createUnsupportedDialog(options.parent);
      unsupported.open(support);
      return;
    }
    const sketch = options.getSketch();
    if (!sketch) return;
    if ('error' in sketch) {
      options.toast?.(sketch.error);
      return;
    }
    dialog?.open(sketch);
  };
  button.addEventListener('click', onClick);

  const ready = (options.detect ?? (() => detectUploadSupport()))()
    .catch((err: unknown): UploadSupport => ({ ok: false, reason: 'no-toolchain', message: String((err as Error)?.message ?? err) }))
    .then((result) => {
      if (disposed) return result;
      if (result.ok) {
        service ??= new UploadService({ manifest: result.manifest });
        dialog = createUploadDialog(options.parent, { service, onConsole: options.onConsole });
      }
      support = result;
      if (clickPending) {
        clickPending = false;
        onClick();
      }
      return result;
    });

  return {
    ready,
    dialog: () => dialog,
    isOpen: () => (dialog?.isOpen() ?? false) || (unsupported?.isOpen() ?? false),
    dispose() {
      disposed = true;
      button.hidden = true;
      button.removeEventListener('click', onClick);
      dialog?.close();
      dialog?.element.remove();
      unsupported?.close();
      unsupported?.element.remove();
      service?.dispose();
    },
  };
}
