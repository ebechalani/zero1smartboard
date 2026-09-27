// @vitest-environment happy-dom
/**
 * "Open in Arduino IDE" dialog tests (happy-dom): the .ino download with the
 * steps naming the downloaded file, the save into a picked folder (fake
 * File System Access handles), the copy, the Blocks-mode note and the status
 * line, with every side effect replaced by a spy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARDUINO_CLOUD_URL,
  createArduinoIdeDialog,
  type ArduinoIdeDialog,
  type ArduinoIdeDialogOptions,
  type SketchFolder,
} from '../src/ui/arduino-ide-dialog';
import { saveSession } from '../src/classroom/session-store';

const SKETCH = 'void setup() {\n  pinMode(A1, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(A1, HIGH);\n}\n';
const WHEN = new Date(2026, 8, 26, 14, 32, 5); // 26 Sep 2026, 14:32:05 local time

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  Reflect.deleteProperty(window, 'showDirectoryPicker');
  vi.restoreAllMocks();
});

/** A folder in memory: records the sub-folders and files created and the text written. */
class FakeFolder implements SketchFolder {
  readonly folders = new Map<string, FakeFolder>();
  readonly files = new Map<string, string>();
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, options: { create: boolean }): Promise<FakeFolder> {
    expect(options.create).toBe(true);
    let folder = this.folders.get(name);
    if (!folder) {
      folder = new FakeFolder(name);
      this.folders.set(name, folder);
    }
    return folder;
  }
  async getFileHandle(name: string, options: { create: boolean }) {
    expect(options.create).toBe(true);
    let text = '';
    return {
      createWritable: async () => ({
        write: async (data: string) => {
          text += data;
        },
        close: async () => {
          this.files.set(name, text);
        },
      }),
    };
  }
}

function domError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

interface Mounted {
  dialog: ArduinoIdeDialog;
  el: HTMLDialogElement;
  download: ReturnType<typeof vi.fn<(fileName: string, text: string) => void>>;
  copyText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  click(action: string): void;
  button(action: string): HTMLButtonElement;
  status(): string;
}

function mount(options: ArduinoIdeDialogOptions = {}): Mounted {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const download = vi.fn<(fileName: string, text: string) => void>();
  const copyText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  const dialog = createArduinoIdeDialog(parent, { now: () => WHEN, download, copyText, ...options });
  const el = dialog.element;
  const button = (action: string) => el.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  return {
    dialog,
    el,
    download,
    copyText,
    button,
    click: (action) => button(action).click(),
    status: () => el.querySelector<HTMLElement>('[data-role="status"]')!.textContent ?? '',
  };
}

/** Let the promise chains started by a click settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('Arduino IDE dialog', () => {
  it('opens as a modal with the title, the three ways and the Arduino Cloud note', () => {
    const m = mount({ pickDirectory: async () => new FakeFolder('Arduino') });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    expect(m.dialog.isOpen()).toBe(true);
    expect(m.el.querySelector('h2')!.textContent).toBe('Open in Arduino IDE');
    expect(m.button('download').textContent).toBe('Download sketch (.ino)');
    expect(m.button('download').classList.contains('z1-btn-primary')).toBe(true);
    expect(m.button('save-folder').textContent).toBe('Save into my Arduino folder…');
    expect(m.button('copy').textContent).toBe('Copy code');
    const cloud = m.el.querySelector<HTMLAnchorElement>(`a[href="${ARDUINO_CLOUD_URL}"]`)!;
    expect(cloud.target).toBe('_blank');
    expect(cloud.rel).toBe('noopener noreferrer');
    expect(cloud.closest('p')!.textContent).toContain('Chromebook');
    m.click('close');
    expect(m.dialog.isOpen()).toBe(false);
  });

  it('downloads a uniquely named .ino and shows the steps with that file name', () => {
    // The student's remembered name (session-store) names the file.
    saveSession({ v: 2, code: 'BKT4M9', className: '8B', firstName: 'Élise', lastName: 'M', uid: 'u1', lastUsedAt: 0, lastHandinAt: 0 });
    const m = mount();
    m.dialog.open({ code: SKETCH, kind: 'code' });
    const steps = m.el.querySelector<HTMLOListElement>('[data-role="steps"]')!;
    // The steps are readable before the download, just not highlighted.
    expect(steps.hidden).toBe(false);
    expect(steps.children).toHaveLength(3);
    expect(steps.classList.contains('is-active')).toBe(false);
    expect(steps.textContent).toContain('click OK');
    expect(steps.textContent).toContain('Tools › Board › Arduino Uno');
    expect(steps.textContent).toContain('Upload');

    m.click('download');
    expect(m.download).toHaveBeenCalledTimes(1);
    expect(m.download).toHaveBeenCalledWith('zero1_Elise_M_0926_143205.ino', SKETCH);
    expect(steps.classList.contains('is-active')).toBe(true);
    expect(steps.children[0].querySelector('b')!.textContent).toBe('zero1_Elise_M_0926_143205.ino');
    expect(m.status()).toContain('zero1_Elise_M_0926_143205.ino');
  });

  it('downloads once on a double click (the same name would be saved as "name (1).ino")', () => {
    let when = WHEN;
    const m = mount({ studentName: () => '', now: () => when });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    m.click('download');
    m.click('download');
    expect(m.download).toHaveBeenCalledTimes(1);
    expect(m.status()).toContain('zero1_0926_143205.ino');
    // A second later the name is new: that download goes ahead.
    when = new Date(WHEN.getTime() + 1000);
    m.click('download');
    expect(m.download).toHaveBeenCalledTimes(2);
    expect(m.download).toHaveBeenLastCalledWith('zero1_0926_143206.ino', SKETCH);
    expect(m.el.querySelector('[data-role="file"] b')!.textContent).toBe('zero1_0926_143206.ino');
  });

  it('uses the injected student name and falls back to zero1_<time> without one', () => {
    const m = mount({ studentName: () => '' });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    m.click('download');
    expect(m.download).toHaveBeenLastCalledWith('zero1_0926_143205.ino', SKETCH);
  });

  it('downloads through a link inside the dialog by default', async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:sketch';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked: { name: string; inDialog: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ name: this.download, inDialog: this.closest('dialog') !== null });
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const dialog = createArduinoIdeDialog(parent, { now: () => WHEN, studentName: () => '' });
    dialog.open({ code: SKETCH, kind: 'code' });
    dialog.element.querySelector<HTMLButtonElement>('[data-action="download"]')!.click();
    expect(clicked).toEqual([{ name: 'zero1_0926_143205.ino', inDialog: true }]);
    expect(blobs).toHaveLength(1);
    expect(await blobs[0].text()).toBe(SKETCH);
  });

  it('saves <name>/<name>.ino into the picked folder', async () => {
    const arduino = new FakeFolder('Arduino');
    const pickDirectory = vi.fn(async () => arduino);
    const m = mount({ pickDirectory, studentName: () => 'Alex' });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    expect(m.el.querySelector<HTMLElement>('[data-role="folder-option"]')!.hidden).toBe(false);

    m.click('save-folder');
    expect(pickDirectory).toHaveBeenCalledTimes(1);
    await settle();
    expect([...arduino.folders.keys()]).toEqual(['zero1_Alex_0926_143205']);
    const sketchFolder = arduino.folders.get('zero1_Alex_0926_143205')!;
    expect([...sketchFolder.files]).toEqual([['zero1_Alex_0926_143205.ino', SKETCH]]);
    expect(m.status()).toBe(
      'Saved Arduino/zero1_Alex_0926_143205/zero1_Alex_0926_143205.ino — in the Arduino IDE use File › Open… (or File › Sketchbook).',
    );
    expect(m.button('save-folder').disabled).toBe(false);
  });

  it('gives the focus back to the folder button once the save is over', async () => {
    let finish: (folder: FakeFolder) => void = () => undefined;
    const m = mount({ pickDirectory: () => new Promise<FakeFolder>((resolve) => (finish = resolve)) });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    m.button('save-folder').focus();
    m.click('save-folder');
    m.button('save-folder').blur(); // what a browser does when the focused button is disabled
    expect(document.activeElement).toBe(document.body);
    finish(new FakeFolder('Arduino'));
    await settle();
    expect(m.status()).toContain('Saved Arduino/');
    expect(document.activeElement).toBe(m.button('save-folder'));
  });

  it('says nothing when the student cancels the folder picker', async () => {
    const m = mount({ pickDirectory: async () => Promise.reject(domError('AbortError')) });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    m.click('save-folder');
    await settle();
    expect(m.status()).toBe('');
  });

  it('suggests the download when the folder cannot be used', async () => {
    const refused = mount({ pickDirectory: async () => Promise.reject(domError('NotAllowedError')) });
    refused.dialog.open({ code: SKETCH, kind: 'code' });
    refused.click('save-folder');
    await settle();
    expect(refused.status()).toContain('did not allow');
    expect(refused.status()).toContain('Download sketch (.ino)');
    expect(refused.el.querySelector<HTMLElement>('[data-role="status"]')!.dataset.tone).toBe('error');

    const broken = new FakeFolder('Arduino');
    broken.getDirectoryHandle = async () => Promise.reject(domError('InvalidModificationError'));
    const failed = mount({ pickDirectory: async () => broken });
    failed.dialog.open({ code: SKETCH, kind: 'code' });
    failed.click('save-folder');
    await settle();
    expect(failed.status()).toBe('The sketch could not be saved there. Use "Download sketch (.ino)" instead.');
  });

  it('hides the folder button when the browser has no folder picker', () => {
    expect('showDirectoryPicker' in window).toBe(false); // happy-dom, like Firefox and Safari
    const m = mount();
    m.dialog.open({ code: SKETCH, kind: 'code' });
    expect(m.el.querySelector<HTMLElement>('[data-role="folder-option"]')!.hidden).toBe(true);
    const off = mount({ pickDirectory: null });
    off.dialog.open({ code: SKETCH, kind: 'code' });
    expect(off.el.querySelector<HTMLElement>('[data-role="folder-option"]')!.hidden).toBe(true);
  });

  it('uses window.showDirectoryPicker where the browser has one', async () => {
    const arduino = new FakeFolder('Arduino');
    const picker = vi.fn(async (_options: unknown) => arduino);
    Object.assign(window, { showDirectoryPicker: picker });
    const m = mount({ studentName: () => '' });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    expect(m.el.querySelector<HTMLElement>('[data-role="folder-option"]')!.hidden).toBe(false);
    m.click('save-folder');
    await settle();
    expect(picker).toHaveBeenCalledWith({ id: 'zero1-sketchbook', mode: 'readwrite', startIn: 'documents' });
    expect(arduino.folders.get('zero1_0926_143205')!.files.get('zero1_0926_143205.ino')).toBe(SKETCH);
  });

  it('copies the code and explains where to paste it', async () => {
    const m = mount();
    m.dialog.open({ code: SKETCH, kind: 'code' });
    m.click('copy');
    expect(m.copyText).toHaveBeenCalledWith(SKETCH);
    await settle();
    expect(m.status()).toBe(
      'Code copied. In the Arduino IDE choose File › New Sketch, select everything (Ctrl+A) and paste (Ctrl+V).',
    );

    const failing = mount({ copyText: async () => Promise.reject(new Error('denied')) });
    failing.dialog.open({ code: SKETCH, kind: 'code' });
    failing.click('copy');
    await settle();
    expect(failing.status()).toBe('The code could not be copied. Use "Download sketch (.ino)" instead.');
  });

  it('starts clean on every open: no old status, steps back to normal, the new code', async () => {
    const m = mount({ studentName: () => '' });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    m.click('download');
    expect(m.status()).not.toBe('');
    m.dialog.close();

    m.dialog.open({ code: 'void setup() {}\nvoid loop() {}\n', kind: 'code' });
    expect(m.status()).toBe('');
    const steps = m.el.querySelector('[data-role="steps"]')!;
    expect(steps.classList.contains('is-active')).toBe(false);
    expect(steps.querySelector('[data-role="file"]')!.textContent).toBe('the downloaded .ino file');
    m.click('copy');
    expect(m.copyText).toHaveBeenLastCalledWith('void setup() {}\nvoid loop() {}\n');
  });

  it('drops an answer that arrives after the dialog was opened again', async () => {
    let finish: (folder: FakeFolder) => void = () => undefined;
    const m = mount({ pickDirectory: () => new Promise<FakeFolder>((resolve) => (finish = resolve)) });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    m.click('save-folder');
    m.dialog.close();
    m.dialog.open({ code: SKETCH, kind: 'code' });
    finish(new FakeFolder('Arduino'));
    await settle();
    expect(m.status()).toBe('');
  });

  it('drops a copy answer that arrives after the dialog was opened again', async () => {
    const answers: { resolve(): void; reject(err: Error): void }[] = [];
    const m = mount({ copyText: () => new Promise<void>((resolve, reject) => answers.push({ resolve, reject })) });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    m.click('copy');
    m.click('copy');
    m.dialog.close();
    m.dialog.open({ code: 'void setup() {}\nvoid loop() {}\n', kind: 'code' });
    answers[0].resolve();
    answers[1].reject(new Error('denied'));
    await settle();
    expect(m.status()).toBe('');
  });

  it('says in Blocks mode that this is the sketch made from the blocks', () => {
    const m = mount();
    const note = m.el.querySelector<HTMLElement>('[data-role="blocks-note"]')!;
    m.dialog.open({ code: SKETCH, kind: 'blocks' });
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('made from your blocks');
    m.dialog.close();
    m.dialog.open({ code: SKETCH, kind: 'code' });
    expect(note.hidden).toBe(true);
  });

  it('does not close when a key submits the form', () => {
    const m = mount();
    m.dialog.open({ code: SKETCH, kind: 'code' });
    const submit = new Event('submit', { cancelable: true });
    m.el.querySelector('form')!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(m.dialog.isOpen()).toBe(true);
  });
});
