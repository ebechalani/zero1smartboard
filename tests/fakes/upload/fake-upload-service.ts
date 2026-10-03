/**
 * An UploadServiceLike for the dialog tests and the Playwright screenshots:
 * scripted download progress, a canned build result per source, a fake port
 * chooser and a scripted upload (progress → result or error). Every step
 * awaits a microtask so the dialog's stage changes can be observed.
 */
import type { BuildOutput, DownloadProgress, UploadOptions, UploadProgress, UploadResult, UploadServiceLike } from '../../../src/upload/service';
import type { WebSerialPortLike } from '../../../src/upload/serial/webserial';
import { UploadError, type UploadErrorCode } from '../../../src/upload/serial/errors';

export interface FakeUploadServiceOptions {
  /** Download progress steps sent by prepare() (default: 3 steps to 100%). */
  downloadSteps?: DownloadProgress[];
  /** prepare() rejects with this message. */
  prepareError?: string;
  /** The build result (default: a 1,524-byte success). Can be a function of the source. */
  build?: BuildOutput | ((source: string) => BuildOutput);
  /** build() rejects with this message (worker crash). */
  buildError?: string;
  /** requestPort() rejects with this error (e.g. 'ABORTED' when the chooser is dismissed). */
  portError?: UploadErrorCode;
  /** upload() fails with this error after `failAfterPages` pages (default: succeeds). */
  uploadError?: UploadErrorCode;
  failAfterPages?: number;
  /** Total bytes of the fake image (default 3 pages). */
  imageBytes?: number;
  /** Hold the upload until `release()` is called (for Cancel tests). */
  hold?: boolean;
}

export const OK_BUILD: BuildOutput = {
  ok: true,
  hex: ':0400000012345678E4\n:00000001FF\n',
  flashBytes: 1524,
  sizes: { flash: 1524, ram: 188 },
  maxFlash: 32256,
  maxRam: 2048,
  diagnostics: [],
  stderr: [],
  libraries: [],
  wallMs: 120,
};

export const FAILED_BUILD: BuildOutput = {
  ok: false,
  stage: 'compile sketch',
  maxFlash: 32256,
  maxRam: 2048,
  diagnostics: [
    { file: 'sketch.ino', line: 9, column: 3, severity: 'error', message: "'digitalwrite' was not declared in this scope", inSketch: true, hint: "Did you mean 'digitalWrite'? (Arduino names are case-sensitive.)" },
    { file: 'sketch.ino', line: 9, column: 3, severity: 'note', message: "suggested alternative: 'digitalWrite'", inSketch: true },
  ],
  stderr: ["sketch.ino: In function 'void loop()':", "sketch.ino:9:3: error: 'digitalwrite' was not declared in this scope", '   digitalwrite(LED, HIGH);', '   ^~~~~~~~~~~~'],
  libraries: [],
  wallMs: 80,
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const MESSAGES: Record<UploadErrorCode, string> = {
  NO_ANSWER: 'No answer from the board — is the Arduino IDE Serial Monitor (or another program or browser tab) using this port?',
  NOT_IN_SYNC: 'The board answered, but not like an Arduino bootloader (it sent text "Temp: 21.5 C⏎").',
  PORT: "Could not open the board's port: it is being used by another program.",
  UNSUPPORTED: 'This browser cannot talk to USB boards.',
  TOO_LARGE: 'The program is too big: 33000 bytes, but this board only has room for 32256 bytes.',
  SIGNATURE_MISMATCH: 'This board does not look like an Arduino UNO (chip signature 1E 98 01, expected 1E 95 0F).',
  VERIFY_FAILED: 'Verification failed at address 0x0105: wrote 0x12, read back 0x13.',
  PROTOCOL: 'The board stopped answering correctly during the upload (no reply to PROG_PAGE 0x100 after 1000 ms).',
  ABORTED: 'Upload cancelled. The board may now hold an incomplete program — upload again before using it.',
  HEX_PARSE: 'The compiled program (.hex) is damaged.',
  HEX_CHECKSUM: 'The compiled program (.hex) is damaged: checksum error.',
};

export class FakeUploadService implements UploadServiceLike {
  readonly calls: string[] = [];
  readonly downloadBytes = 6_000_000;
  prepared = 0;
  lastSource = '';
  lastSignal: AbortSignal | undefined;
  private releaseHold: (() => void) | null = null;

  constructor(readonly o: FakeUploadServiceOptions = {}) {}

  /** True while a held upload waits for release(). */
  releaseAvailable(): boolean {
    return this.releaseHold !== null;
  }

  /** Let a held upload continue. */
  release(): void {
    this.releaseHold?.();
    this.releaseHold = null;
  }

  async prepare(onProgress?: (p: DownloadProgress) => void): Promise<void> {
    this.calls.push('prepare');
    if (this.o.prepareError) {
      await tick();
      throw new Error(this.o.prepareError);
    }
    if (this.prepared++ === 0) {
      const steps = this.o.downloadSteps ?? [1, 2, 3].map((i) => ({ stage: 'download' as const, file: 'tools/cc1plus.wasm', loaded: i * 2_000_000, total: 6_000_000, fromCache: false }));
      for (const s of steps) {
        await tick();
        onProgress?.(s);
      }
    }
  }

  async build(source: string): Promise<BuildOutput> {
    this.calls.push('build');
    this.lastSource = source;
    await tick();
    if (this.o.buildError) throw new Error(this.o.buildError);
    const b = this.o.build ?? OK_BUILD;
    return typeof b === 'function' ? b(source) : b;
  }

  async requestPort(options: { anyPort?: boolean } = {}): Promise<WebSerialPortLike> {
    this.calls.push(options.anyPort ? 'requestPort:any' : 'requestPort');
    await tick();
    if (this.o.portError) throw new UploadError(this.o.portError, this.o.portError === 'ABORTED' ? 'No board selected.' : MESSAGES[this.o.portError]);
    return { open: async () => {}, close: async () => {}, readable: null, writable: null, setSignals: async () => {} };
  }

  async upload(_hex: string, options: UploadOptions = {}): Promise<UploadResult> {
    this.calls.push('upload');
    this.lastSignal = options.signal;
    const total = this.o.imageBytes ?? 3 * 128;
    const progress = (p: Omit<UploadProgress, 'baud'>) => options.onProgress?.({ ...p, baud: 115200 });
    progress({ phase: 'connect', message: 'Connecting to the board…', done: 0, total: 0, percent: 0 });
    options.log?.('sync @115200 reset 1 try 1: in sync');
    await tick();
    const fail = (code: UploadErrorCode) => new UploadError(code, MESSAGES[code]);
    if (this.o.uploadError && this.o.failAfterPages === undefined) throw fail(this.o.uploadError);
    for (let done = 0; done < total; done += 128) {
      if (this.o.hold && done === 128) {
        await new Promise<void>((r) => {
          this.releaseHold = r;
        });
      }
      if (options.signal?.aborted) throw fail('ABORTED');
      if (this.o.uploadError && this.o.failAfterPages !== undefined && done / 128 >= this.o.failAfterPages) throw fail(this.o.uploadError);
      progress({ phase: 'write', message: 'Writing…', done, total, percent: 5 + (55 * done) / total });
      await tick();
    }
    progress({ phase: 'write', message: 'Writing…', done: total, total, percent: 60 });
    progress({ phase: 'verify', message: 'Checking…', done: total, total, percent: 100 });
    await tick();
    progress({ phase: 'done', message: 'Done', done: total, total, percent: 100 });
    return {
      baud: 115200,
      signature: [0x1e, 0x95, 0x0f],
      bootloaderVersion: { major: 4, minor: 4 },
      bytesInHex: total,
      pagesWritten: total / 128,
      bytesWritten: total,
      bytesVerified: total,
      syncAttempts: 2,
      resets: 1,
      ms: { connect: 720, write: 60, verify: 40, total: 820 },
    };
  }

  dispose(): void {
    this.calls.push('dispose');
  }
}
