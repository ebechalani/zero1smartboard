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
 * The button stays hidden until feature detection passes (Chrome/Edge on a
 * computer, WebAssembly, module workers, toolchain published with the site).
 */
import { createUploadDialog, type UploadDialog, type UploadPayload } from './ui/upload-dialog';
import { UploadService, detectUploadSupport, type UploadServiceLike, type UploadSupport } from './service';
import type { ConsoleMessage } from '../types';

export { UploadService, detectUploadSupport, browserSupportsUpload, supportsModuleWorkers, UNSUPPORTED_TEXT, BOARD_USB_FILTERS } from './service';
export type { UploadServiceLike, UploadSupport, UnsupportedReason, UploadOptions, BuildOutput, DownloadProgress, UploadProgress, UploadResult } from './service';
export { createUploadDialog, HELP_TEXT, sizeText, describeError } from './ui/upload-dialog';
export type { UploadDialog, UploadDialogOptions, UploadPayload, UploadStage } from './ui/upload-dialog';
export { UploadError } from './serial/errors';
export type { UploadErrorCode } from './serial/errors';

export interface InstallUploadButtonOptions {
  /** The header button (`<button data-slot="upload" hidden>`); it is shown when uploading is supported. */
  button: HTMLButtonElement;
  /** Where the dialog is appended (the app root). */
  parent: HTMLElement;
  /** The current sketch (null with a toast when the blocks are still loading). */
  getSketch(): UploadPayload | null;
  /** Compile errors and upload results, for the app console. */
  onConsole?(message: ConsoleMessage): void;
  toast?(text: string): void;
  /** A ready service (tests); default: a real UploadService once support is detected. */
  service?: UploadServiceLike;
  /** Feature detection override (tests); default: detectUploadSupport(). */
  detect?(): Promise<UploadSupport>;
}

export interface InstalledUploadButton {
  /** Resolves once feature detection ran (the button is then shown or left hidden). */
  readonly ready: Promise<UploadSupport>;
  /** The dialog, once installed (null while unsupported). */
  dialog(): UploadDialog | null;
  /** True while the dialog is open (the app's global keys leave a sketch alone then). */
  isOpen(): boolean;
  dispose(): void;
}

/**
 * Wire the header button: hidden unless the feature is supported here, opens
 * the Upload dialog with the current sketch otherwise.
 */
export function installUploadButton(options: InstallUploadButtonOptions): InstalledUploadButton {
  const { button } = options;
  let dialog: UploadDialog | null = null;
  let service: UploadServiceLike | null = options.service ?? null;
  button.hidden = true;

  const onClick = (): void => {
    const sketch = options.getSketch();
    if (!sketch) {
      options.toast?.('The blocks are still loading — try again in a moment');
      return;
    }
    dialog?.open(sketch);
  };

  const ready = (options.detect ?? (() => detectUploadSupport()))().then(
    (support) => {
      if (!support.ok) return support;
      service ??= new UploadService({ manifest: support.manifest });
      dialog = createUploadDialog(options.parent, { service, onConsole: options.onConsole });
      button.hidden = false;
      button.addEventListener('click', onClick);
      return support;
    },
    (err: unknown): UploadSupport => ({ ok: false, reason: 'no-toolchain', message: String((err as Error)?.message ?? err) }),
  );

  return {
    ready,
    dialog: () => dialog,
    isOpen: () => dialog?.isOpen() ?? false,
    dispose() {
      button.removeEventListener('click', onClick);
      dialog?.close();
      dialog?.element.remove();
      service?.dispose();
    },
  };
}
