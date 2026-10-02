// @vitest-environment happy-dom
/**
 * "Upload to board" dialog tests (happy-dom) with a fake UploadService: the
 * stages (download → compile → choose → upload → done), the size line, compile
 * errors with .ino lines and hints (also pushed to the console callback), the
 * help text per upload error code, Cancel/abort, "Try again", the Details
 * disclosure, installUploadButton's feature detection, and Python mode's
 * payload (note, Python lines, X-sketch-error, success note).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUploadDialog, HELP_TEXT, sizeText, type UploadDialog } from '../src/upload/ui/upload-dialog';
import { browserSupportsUpload, installUploadButton, UNSUPPORTED_ADVICE, UNSUPPORTED_FALLBACK, UNSUPPORTED_TEXT } from '../src/upload';
import type { ConsoleMessage } from '../src/types';
import { FAILED_BUILD, FakeUploadService, OK_BUILD, type FakeUploadServiceOptions } from './fakes/upload/fake-upload-service';

const SKETCH = 'void setup() {}\nvoid loop() {}\n';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

interface Mounted {
  dialog: UploadDialog;
  el: HTMLDialogElement;
  service: FakeUploadService;
  console: ConsoleMessage[];
  stageText(): string;
  role(name: string): HTMLElement;
  click(action: string): void;
  button(action: string): HTMLButtonElement;
}

function mount(options: FakeUploadServiceOptions = {}): Mounted {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const service = new FakeUploadService(options);
  const consoleMessages: ConsoleMessage[] = [];
  const dialog = createUploadDialog(parent, { service, onConsole: (m) => consoleMessages.push(m) });
  const el = dialog.element;
  return {
    dialog,
    el,
    service,
    console: consoleMessages,
    stageText: () => el.querySelector('[data-role="stage-text"]')!.textContent!,
    role: (name) => el.querySelector<HTMLElement>(`[data-role="${name}"]`)!,
    click: (action) => el.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click(),
    button: (action) => el.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!,
  };
}

/** One timer turn: the fake service paces its steps with setTimeout(0). */
const turn = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

/** Wait until the dialog reaches `stage` (a few timer turns at most). */
async function until(m: Mounted, stage: string): Promise<void> {
  for (let i = 0; i < 100 && m.dialog.stage() !== stage; i++) await turn();
  expect(m.dialog.stage()).toBe(stage);
}

describe('stages', () => {
  it('opens on "Downloading the compiler", shows the progress, compiles, shows the size line and asks for the board', async () => {
    const m = mount();
    m.dialog.open({ code: SKETCH, kind: 'code' });
    expect(m.el.open).toBe(true);
    expect(m.dialog.stage()).toBe('download');
    expect(m.stageText()).toBe('Downloading the compiler (once, about 6 MB)');
    await until(m, 'choose');
    expect(m.service.calls).toEqual(['prepare', 'build']);
    expect(m.service.lastSource).toBe(SKETCH);
    expect(m.role('progress').hidden).toBe(true); // the bar is for download/compile/upload only
    expect(m.role('size').hidden).toBe(false);
    expect(m.role('size').textContent).toBe(sizeText(OK_BUILD));
    expect(m.role('size').textContent).toContain('Sketch uses 1,524 bytes (5%) of program storage space. Maximum is 32,256 bytes.');
    expect(m.stageText()).toBe('Choose your board');
    expect(m.role('choose').hidden).toBe(false);
    expect(m.console.map((c) => c.level)).toEqual(['info']);
    expect(m.console[0].text).toContain('Sketch uses 1,524 bytes');
  });

  it('uploads after the board is chosen: "Uploading (page x of y)", then Done', async () => {
    const m = mount({ imageBytes: 5 * 128 });
    m.dialog.open({ code: SKETCH, kind: 'blocks', note: 'This uploads the Arduino sketch made from your blocks (the code shown in the Code tab).' });
    expect(m.role('note').hidden).toBe(false);
    expect(m.role('note').textContent).toContain('made from your blocks');
    await until(m, 'choose');
    const texts: string[] = [];
    const observer = new MutationObserver(() => texts.push(m.stageText()));
    observer.observe(m.el.querySelector('[data-role="stage-text"]')!, { childList: true, characterData: true, subtree: true });
    m.click('choose');
    await until(m, 'done');
    observer.disconnect();
    expect(m.service.calls.slice(-2)).toEqual(['requestPort', 'upload']);
    expect(texts).toContain('Connecting to the board…');
    expect(texts).toContain('Uploading (page 1 of 5)');
    expect(texts).toContain('Uploading (page 5 of 5)');
    expect(texts).toContain('Checking the upload');
    expect(m.stageText()).toBe('Done — the sketch is running on the board');
    expect(m.role('stage').dataset.tone).toBe('ok');
    expect(m.button('close').hidden).toBe(false);
    expect(m.button('cancel').hidden).toBe(true);
    expect(m.role('details').hidden).toBe(false);
    expect(m.role('raw').textContent).toContain('in sync');
    expect(m.console.at(-1)!.text).toContain('Uploaded to the board: 5 pages');
    m.click('close');
    expect(m.el.open).toBe(false);
  });

  it('a second open skips the download (the service is prepared) and recompiles', async () => {
    const m = mount();
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'choose');
    m.dialog.close();
    m.dialog.open({ code: SKETCH + '// v2\n', kind: 'code' });
    await until(m, 'choose');
    expect(m.service.calls).toEqual(['prepare', 'build', 'prepare', 'build']);
    expect(m.service.lastSource).toContain('// v2');
  });
});

describe('compile errors', () => {
  it('lists each error with its .ino line and hint, pushes them to the console, and shows the raw output under Details', async () => {
    const m = mount({ build: FAILED_BUILD });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'error');
    expect(m.stageText()).toBe('Compile error');
    expect(m.role('message').textContent).toBe('The sketch does not compile: 1 error.');
    const items = [...m.role('diagnostics').querySelectorAll('li')];
    expect(items).toHaveLength(1); // the note is not listed
    expect(items[0].dataset.severity).toBe('error');
    expect(items[0].textContent).toContain('line 9: ');
    expect(items[0].textContent).toContain("'digitalwrite' was not declared in this scope");
    expect(items[0].querySelector('.z1-upload-hint')!.textContent).toBe("Did you mean 'digitalWrite'? (Arduino names are case-sensitive.)");
    expect(m.role('help').hidden).toBe(true); // the hint says it all
    expect(m.console).toEqual([{ level: 'error', text: "sketch.ino:9:3: error: 'digitalwrite' was not declared in this scope — Did you mean 'digitalWrite'? (Arduino names are case-sensitive.)", line: 9 }]);
    expect(m.role('details').hidden).toBe(false);
    expect(m.role('raw').textContent).toContain('   ^~~~~~~~~~~~');
    expect(m.role('choose').hidden).toBe(true);
    expect(m.button('retry').hidden).toBe(false);
    expect(m.button('close').hidden).toBe(false);
  });

  it('"Try again" after a compile error recompiles', async () => {
    let fail = true;
    const m = mount({ build: () => (fail ? FAILED_BUILD : OK_BUILD) });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'error');
    fail = false;
    m.click('retry');
    await until(m, 'choose');
    expect(m.service.calls.filter((c) => c === 'build')).toHaveLength(2);
  });

  it('a sketch bigger than the flash is refused before the board is asked for', async () => {
    const m = mount({ build: { ...OK_BUILD, flashBytes: 33000, sizes: { flash: 33000, ram: 100 } } });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'error');
    expect(m.stageText()).toBe('Sketch too big');
    expect(m.role('help').textContent).toBe(HELP_TEXT.TOO_LARGE);
    expect(m.role('size').textContent).toContain('33,000 bytes (102%)');
  });

  it('a compiler that cannot start is reported with a plain message', async () => {
    const m = mount({ prepareError: 'HTTP 404' });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'error');
    expect(m.stageText()).toBe('The compiler could not start');
    expect(m.role('message').textContent).toContain('HTTP 404');
    expect(m.console[0].text).toContain('HTTP 404');
  });
});

describe('Python mode (docs/PYTHON.md §7.12)', () => {
  const X_SKETCH = 'Python translation error (a bug in the simulator, please tell your teacher): ';
  const DONE = 'Done — the program is running on the board. Its print() output: open the Arduino IDE Serial Monitor at 9600 baud.';
  const payload = {
    code: SKETCH,
    kind: 'python' as const,
    note: 'This uploads the Arduino sketch made from your Python program (the code in the Code tab). The board runs this sketch: it cannot run Python itself.',
    successNote: DONE,
    mapLine: (sketchLine: number) => (sketchLine === 9 ? 4 : 0),
    source: 'python' as const,
    sketchError: (message: string) => `${X_SKETCH}${message}`,
  };

  it('a compile error points at the Python line and says the sketch made from the program is at fault', async () => {
    const m = mount({ build: FAILED_BUILD });
    m.dialog.open(payload);
    expect(m.role('note').textContent).toBe(payload.note);
    await until(m, 'error');
    expect(m.role('message').textContent).toBe('The sketch does not compile: 1 error.');
    const items = [...m.role('diagnostics').querySelectorAll('li')];
    expect(items.map((li) => li.textContent)).toEqual([`line 4: ${X_SKETCH}'digitalwrite' was not declared in this scope`]);
    expect(items[0].querySelector('.z1-upload-hint')).toBeNull(); // no C++ advice: the student cannot fix the sketch
    expect(m.role('help').hidden).toBe(true);
    expect(m.console).toEqual([{ level: 'error', text: `${X_SKETCH}'digitalwrite' was not declared in this scope`, line: 4, source: 'python' }]);
  });

  it('an error on a line made from no Python line has no line; a sketch too big for the board keeps its own words', async () => {
    const tooBig = "The sketch is too big for the board (32,256 bytes of program storage). Remove code or libraries.";
    const m = mount({
      build: {
        ...FAILED_BUILD,
        stage: 'link',
        diagnostics: [
          { file: 'sketch.ino', line: 2, column: 1, severity: 'error', message: "'pyFail' was not declared in this scope", inSketch: true },
          { file: '', line: 0, severity: 'error', message: "region 'text' overflowed by 120 bytes", inSketch: false, hint: tooBig },
        ],
      },
    });
    m.dialog.open(payload);
    await until(m, 'error');
    const items = [...m.role('diagnostics').querySelectorAll('li')];
    expect(items[0].textContent).toBe(`${X_SKETCH}'pyFail' was not declared in this scope`);
    expect(items[1].textContent).toBe(`region 'text' overflowed by 120 bytes${tooBig}`);
    expect(items[1].querySelector('.z1-upload-hint')!.textContent).toBe(tooBig);
    expect(m.console).toEqual([
      { level: 'error', text: `${X_SKETCH}'pyFail' was not declared in this scope`, line: undefined, source: 'python' },
      { level: 'error', text: `error: region 'text' overflowed by 120 bytes — ${tooBig}`, line: undefined, source: 'python' },
    ]);
  });

  it('says where print() output goes once the program is on the board', async () => {
    const m = mount();
    m.dialog.open(payload);
    await until(m, 'choose');
    m.click('choose');
    await until(m, 'done');
    expect(m.stageText()).toBe(DONE);
  });
});

describe('upload errors', () => {
  it.each([
    ['NO_ANSWER', 'Is the Arduino IDE Serial Monitor open?'],
    ['NOT_IN_SYNC', 'Press the RESET button on the board now'],
    ['PORT', 'Check that the USB cable is plugged in'],
    ['SIGNATURE_MISMATCH', 'USB-SERIAL CH340'],
    ['VERIFY_FAILED', 'Try again.'],
    ['PROTOCOL', 'Unplug and replug the board'],
  ] as const)('%s shows the uploader message and the help text, and logs to the console', async (code, help) => {
    const m = mount({ uploadError: code });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'choose');
    m.click('choose');
    await until(m, 'error');
    expect(m.stageText()).toBe('Upload failed');
    expect(m.role('help').textContent).toContain(help);
    expect(m.role('help').textContent).toBe(HELP_TEXT[code]);
    expect(m.role('message').textContent!.length).toBeGreaterThan(20);
    expect(m.console.at(-1)!.text).toContain(`Upload failed (${code})`);
    expect(m.role('raw').textContent).toContain('in sync'); // the protocol log under Details
  });

  it('an unsupported browser gets "Uploading works in Chrome or Edge on a computer"', async () => {
    const m = mount({ portError: 'UNSUPPORTED' });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'choose');
    m.click('choose');
    await until(m, 'error');
    expect(m.role('help').textContent).toBe('Uploading works in Chrome or Edge on a computer.');
  });

  it('dismissing the chooser keeps the dialog on "Choose your board"', async () => {
    const m = mount({ portError: 'ABORTED' });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'choose');
    m.click('choose');
    for (let i = 0; i < 5; i++) await turn();
    expect(m.dialog.stage()).toBe('choose');
    expect(m.stageText()).toContain('No board chosen');
    expect(m.button('choose').disabled).toBe(false);
  });

  it('"Try again" after an upload error goes back to the board chooser without recompiling', async () => {
    const m = mount({ uploadError: 'NO_ANSWER' });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'choose');
    m.click('choose');
    await until(m, 'error');
    m.click('retry');
    expect(m.dialog.stage()).toBe('choose');
    expect(m.service.calls.filter((c) => c === 'build')).toHaveLength(1);
  });

  it('Cancel during the upload aborts it (ABORTED help text) instead of closing the dialog', async () => {
    const m = mount({ hold: true, imageBytes: 4 * 128 });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'choose');
    m.click('choose');
    for (let i = 0; i < 100 && !m.service.releaseAvailable(); i++) await turn();
    expect(m.dialog.stage()).toBe('upload');
    m.click('cancel');
    expect(m.service.lastSignal?.aborted).toBe(true);
    m.service.release();
    await until(m, 'error');
    expect(m.el.open).toBe(true);
    expect(m.stageText()).toBe('Upload cancelled');
    expect(m.role('help').textContent).toBe(HELP_TEXT.ABORTED);
  });

  it('Cancel before the upload closes the dialog and drops the late build result', async () => {
    const m = mount();
    m.dialog.open({ code: SKETCH, kind: 'code' });
    m.click('cancel');
    expect(m.el.open).toBe(false);
    for (let i = 0; i < 10; i++) await turn();
    expect(m.role('size').hidden).toBe(true);
  });
});

describe('installUploadButton', () => {
  it('shows the button and, where uploading works, opens the dialog with the current sketch', async () => {
    const button = document.createElement('button');
    button.hidden = true;
    const parent = document.createElement('div');
    document.body.append(button, parent);
    const service = new FakeUploadService();
    const consoleMessages: ConsoleMessage[] = [];
    const installed = installUploadButton({
      button,
      parent,
      service,
      detect: async () => ({ ok: true, message: '' }),
      getSketch: () => ({ code: SKETCH, kind: 'code' }),
      onConsole: (m) => consoleMessages.push(m),
    });
    const support = await installed.ready;
    expect(support.ok).toBe(true);
    expect(button.hidden).toBe(false);
    expect(installed.isOpen()).toBe(false);
    button.click();
    expect(installed.isOpen()).toBe(true);
    expect(installed.dialog()!.stage()).toBe('download');
    for (let i = 0; i < 100 && installed.dialog()!.stage() !== 'choose'; i++) await turn();
    expect(service.lastSource).toBe(SKETCH);
    expect(consoleMessages.length).toBe(1);
    installed.dispose();
    expect(installed.isOpen()).toBe(false);
    expect(service.calls).toContain('dispose');
  });

  it('shows nothing when disposed before the detection ends (the review frame, docs/CLASSROOM.md §4.11)', async () => {
    const button = document.createElement('button');
    const parent = document.createElement('div');
    document.body.append(button, parent);
    const service = new FakeUploadService();
    const installed = installUploadButton({ button, parent, service, detect: async () => ({ ok: true, message: '' }), getSketch: () => ({ code: SKETCH, kind: 'code' }) });
    installed.dispose();
    await installed.ready;
    expect(button.hidden).toBe(true);
    expect(installed.dialog()).toBeNull();
    expect(parent.querySelector('dialog')).toBeNull();
    button.click();
    expect(installed.isOpen()).toBe(false);
  });

  it('keeps the button shown where uploading cannot work, and a click says why and what to do (Firefox, Safari, phones)', async () => {
    const button = document.createElement('button');
    button.hidden = true; // as in the page markup
    const parent = document.createElement('div');
    document.body.append(button, parent);
    const getSketch = vi.fn(() => ({ code: SKETCH, kind: 'code' as const }));
    const installed = installUploadButton({ button, parent, detect: async () => ({ ok: false, reason: 'no-serial', message: UNSUPPORTED_TEXT['no-serial'] }), getSketch });
    expect(button.hidden).toBe(false); // at once, not only after the detection: a hidden button cannot be found
    const support = await installed.ready;
    expect(support.reason).toBe('no-serial');
    expect(button.hidden).toBe(false);
    expect(installed.dialog()).toBeNull(); // no Upload dialog, no compiler download here
    button.click();
    const dialog = parent.querySelector<HTMLDialogElement>('dialog.z1-upload-unsupported')!;
    expect(dialog.open).toBe(true);
    expect(installed.isOpen()).toBe(true); // the app's global keys leave the sketch alone
    expect(getSketch).not.toHaveBeenCalled();
    expect(dialog.querySelector('[data-role="reason"]')!.textContent).toBe(
      'This browser cannot send a program to the board over USB: uploading works in Chrome or Edge on a computer.',
    );
    expect(Array.from(dialog.querySelectorAll('[data-role="advice"] li'), (li) => li.textContent)).toEqual(UNSUPPORTED_ADVICE['no-serial']);
    expect(dialog.textContent).toContain(UNSUPPORTED_FALLBACK); // the Arduino IDE way works everywhere
    dialog.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    expect(dialog.open).toBe(false);
    button.click(); // a second click reuses the same dialog
    expect(parent.querySelectorAll('dialog.z1-upload-unsupported')).toHaveLength(1);
    installed.dispose();
    expect(button.hidden).toBe(true);
    expect(parent.querySelector('dialog')).toBeNull();
  });

  it('an http:// page is "insecure-context", not "use Chrome": Chrome and Edge expose no navigator.serial there', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
    Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true });
    try {
      // Chromium on http://192.168.1.20:4173: no navigator.serial at all
      expect(browserSupportsUpload(null)).toMatchObject({ ok: false, reason: 'insecure-context', message: UNSUPPORTED_TEXT['insecure-context'] });
      expect(UNSUPPORTED_ADVICE['insecure-context'][0]).toContain('https://');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'isSecureContext', descriptor);
      else delete (globalThis as { isSecureContext?: boolean }).isSecureContext;
    }
    expect(browserSupportsUpload(null).reason).toBe('no-serial'); // a secure page without Web Serial: Firefox, Safari
  });

  it('a site without the compiler (no toolchain/manifest.json) says so on click', async () => {
    const button = document.createElement('button');
    const parent = document.createElement('div');
    document.body.append(button, parent);
    const installed = installUploadButton({ button, parent, detect: async () => ({ ok: false, reason: 'no-toolchain', message: UNSUPPORTED_TEXT['no-toolchain'] }), getSketch: () => null });
    await installed.ready;
    button.click();
    const dialog = parent.querySelector<HTMLDialogElement>('dialog.z1-upload-unsupported')!;
    expect(dialog.querySelector('[data-role="reason"]')!.textContent).toBe(UNSUPPORTED_TEXT['no-toolchain']);
    expect(Array.from(dialog.querySelectorAll('[data-role="advice"] li'), (li) => li.textContent)).toEqual(UNSUPPORTED_ADVICE['no-toolchain']);
  });

  it('a detection that throws counts as "no compiler": the button still explains itself', async () => {
    const button = document.createElement('button');
    const parent = document.createElement('div');
    document.body.append(button, parent);
    const installed = installUploadButton({ button, parent, detect: () => Promise.reject(new Error('offline')), getSketch: () => null });
    const support = await installed.ready;
    expect(support).toMatchObject({ ok: false, reason: 'no-toolchain', message: 'offline' });
    button.click();
    expect(parent.querySelector<HTMLDialogElement>('dialog.z1-upload-unsupported')!.open).toBe(true);
  });

  it('a click before the detection ends is answered when it ends', async () => {
    const button = document.createElement('button');
    const parent = document.createElement('div');
    document.body.append(button, parent);
    let finish!: (s: { ok: boolean; message: string }) => void;
    const service = new FakeUploadService();
    const installed = installUploadButton({
      button,
      parent,
      service,
      detect: () => new Promise((resolve) => (finish = resolve)),
      getSketch: () => ({ code: SKETCH, kind: 'code' }),
    });
    button.click();
    expect(installed.isOpen()).toBe(false);
    finish({ ok: true, message: '' });
    await installed.ready;
    expect(installed.isOpen()).toBe(true); // the Upload dialog, with the sketch of the moment it opens
    installed.dispose();
  });

  it('toasts the { error } of a sketch that is not ready as is, and does nothing for null (docs/PYTHON.md §7.12)', async () => {
    const button = document.createElement('button');
    const parent = document.createElement('div');
    document.body.append(button, parent);
    const toast = vi.fn();
    let sketch: { error: string } | null = { error: 'The blocks are still loading — try again in a moment' };
    const installed = installUploadButton({ button, parent, service: new FakeUploadService(), detect: async () => ({ ok: true, message: '' }), getSketch: () => sketch, toast });
    await installed.ready;
    button.click();
    expect(toast).toHaveBeenCalledWith('The blocks are still loading — try again in a moment');
    expect(installed.isOpen()).toBe(false);
    sketch = null;
    button.click();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(installed.isOpen()).toBe(false);
  });
});
