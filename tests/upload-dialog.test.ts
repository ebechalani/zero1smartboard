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
import { BLOCKED_TEXT, CH340_DRIVER, FTDI_DRIVER, LINUX_PORT_HINT, NO_BOARD_TEXT, createUploadDialog, detectOs, HELP_TEXT, sizeText, type ClientOs, type UploadDialog } from '../src/upload/ui/upload-dialog';
import { browserSupportsUpload, installUploadButton, isAndroid, UNSUPPORTED_ADVICE, UNSUPPORTED_FALLBACK, UNSUPPORTED_TEXT } from '../src/upload';
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

/** A person's pace: each reading of the clock is a second later, so a dismissed chooser reads as closed by hand. */
function humanClock(): () => number {
  let t = 0;
  return () => (t += 1000);
}

function mount(options: FakeUploadServiceOptions = {}, os: ClientOs = 'other', now: () => number = humanClock()): Mounted {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const service = new FakeUploadService(options);
  const consoleMessages: ConsoleMessage[] = [];
  const dialog = createUploadDialog(parent, { service, onConsole: (m) => consoleMessages.push(m), os, now });
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
    ['SIGNATURE_MISMATCH', 'the same COM port as in the Arduino IDE'],
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
    expect(m.stageText()).toBe(NO_BOARD_TEXT);
    expect(m.button('choose').disabled).toBe(false);
  });

  it('"My board is not in the list" opens after an empty chooser: the usual causes, the CH340 driver, every serial port', async () => {
    const m = mount({ portError: 'ABORTED' });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'choose');
    const tips = m.role('not-listed') as HTMLDetailsElement;
    expect(tips.open).toBe(false); // closed at first: most boards are in the list
    m.click('choose');
    for (let i = 0; i < 5; i++) await turn();
    expect(tips.open).toBe(true);
    expect(tips.textContent).toContain('data cable');
    expect(tips.textContent).not.toContain('Close the Arduino IDE'); // an open port is still listed: not a reason
    expect(tips.textContent).toContain('Site settings → Serial ports → Ask (default)'); // no list at all: the site's serial ports are blocked
    const links = Array.from(tips.querySelectorAll('a'), (a) => [a.getAttribute('href'), a.target]);
    expect(links).toEqual([
      [CH340_DRIVER.windows, '_blank'],
      [FTDI_DRIVER.windows, '_blank'],
      [CH340_DRIVER.mac, '_blank'],
    ]);
    expect(tips.textContent).toContain('If the Arduino IDE sees the board, its driver is installed');
    // the board has another USB chip: every serial port this time, and the upload goes on
    m.service.o.portError = undefined;
    m.click('choose-any');
    for (let i = 0; i < 200 && m.dialog.stage() !== 'done'; i++) await turn();
    expect(m.service.calls.filter((c) => c.startsWith('requestPort'))).toEqual(['requestPort', 'requestPort:any']);
    expect(m.dialog.stage()).toBe('done');
    // a new upload starts with the tips closed again
    m.dialog.open({ code: SKETCH, kind: 'code' });
    expect(tips.open).toBe(false);
  });

  it('after an empty chooser the keyboard focus goes to the tips that opened, then back to the button used', async () => {
    const m = mount({ portError: 'ABORTED' });
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'choose');
    const tips = m.role('not-listed') as HTMLDetailsElement;
    m.click('choose');
    for (let i = 0; i < 5 && !tips.open; i++) await turn();
    expect(document.activeElement).toBe(tips.querySelector('summary'));
    m.click('choose-any');
    for (let i = 0; i < 5 && m.button('choose-any').disabled !== false; i++) await turn();
    await turn();
    expect(document.activeElement).toBe(m.button('choose-any'));
  });

  it('a chooser refused at once (serial ports blocked for the site) says so, without the board tips', async () => {
    const m = mount({ portError: 'ABORTED' }, 'windows', () => 0); // no time passes: no list was shown
    m.dialog.open({ code: SKETCH, kind: 'code' });
    await until(m, 'choose');
    m.click('choose');
    for (let i = 0; i < 5; i++) await turn();
    expect(m.dialog.stage()).toBe('choose');
    expect(m.stageText()).toBe(BLOCKED_TEXT);
    expect(m.role('stage').dataset.tone).toBe('error');
    expect((m.role('not-listed') as HTMLDetailsElement).open).toBe(false);
    expect(m.button('choose').disabled).toBe(false);
  });

  it('a port that does not open on Linux adds the dialout group to the help', async () => {
    const linux = mount({ uploadError: 'PORT' }, 'linux');
    linux.dialog.open({ code: SKETCH, kind: 'code' });
    await until(linux, 'choose');
    linux.click('choose');
    await until(linux, 'error');
    expect(linux.role('help').textContent).toBe(`${HELP_TEXT.PORT} ${LINUX_PORT_HINT}`);
    const windows = mount({ uploadError: 'PORT' }, 'windows');
    windows.dialog.open({ code: SKETCH, kind: 'code' });
    await until(windows, 'choose');
    windows.click('choose');
    await until(windows, 'error');
    expect(windows.role('help').textContent).toBe(HELP_TEXT.PORT);
  });

  it('without an os option the dialog reads the system from the browser (the Windows teacher gets the Windows drivers)', () => {
    const nav = navigator as Navigator & { userAgentData?: unknown };
    const own = Object.getOwnPropertyDescriptor(nav, 'userAgentData');
    Object.defineProperty(nav, 'userAgentData', { value: { platform: 'Windows' }, configurable: true });
    try {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const dialog = createUploadDialog(parent, { service: new FakeUploadService({}) });
      const first = dialog.element.querySelector<HTMLAnchorElement>('[data-role="not-listed"] .z1-upload-driver-tip a.z1-upload-driver');
      expect(first?.getAttribute('href')).toBe(CH340_DRIVER.windows);
    } finally {
      if (own) Object.defineProperty(nav, 'userAgentData', own);
      else delete (nav as { userAgentData?: unknown }).userAgentData;
    }
  });

  it('the driver tip fits the computer: a download button on Windows, none needed on a Chromebook or Linux', () => {
    const tip = (os: ClientOs) => mount({}, os).role('not-listed').querySelector('.z1-upload-driver-tip')!;
    const windows = tip('windows');
    // the ZERO1 boards have a CH340 or an FTDI FT232R USB chip: both drivers, one click each
    const buttons = Array.from(windows.querySelectorAll<HTMLAnchorElement>('a.z1-upload-driver'), (a) => [a.textContent, a.getAttribute('href'), a.target]);
    expect(buttons).toEqual([
      ['⬇ CH340 driver for Windows', CH340_DRIVER.windows, '_blank'],
      ['⬇ FTDI driver for Windows', FTDI_DRIVER.windows, '_blank'],
    ]);
    expect(windows.textContent).toContain('If the Arduino IDE sees the board, its driver is installed');
    expect(windows.textContent).toContain('administrator rights');
    const mac = tip('mac');
    expect(mac.textContent).toContain('macOS 13 or newer needs no driver');
    expect(mac.querySelector('a')!.getAttribute('href')).toBe(CH340_DRIVER.mac);
    expect(tip('chromeos').textContent).toContain('needs no driver');
    expect(tip('chromeos').querySelector('a')).toBeNull();
    expect(tip('linux').textContent).toContain('brltty'); // what hides a CH340 on Ubuntu
    expect(tip('linux').textContent).not.toContain('dialout'); // it does not hide a board: it is in the help of a port that does not open
    expect(tip('linux').querySelector('a')).toBeNull();
  });

  it('detectOs reads Chrome\'s client hints, else the user agent', () => {
    expect(detectOs({ userAgentData: { platform: 'Windows' } })).toBe('windows');
    expect(detectOs({ userAgentData: { platform: 'macOS' } })).toBe('mac');
    expect(detectOs({ userAgentData: { platform: 'Chrome OS' } })).toBe('chromeos');
    expect(detectOs({ userAgentData: { platform: 'Linux' } })).toBe('linux');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36' })).toBe('windows');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15' })).toBe('mac');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36' })).toBe('chromeos');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36' })).toBe('other');
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
    expect(m.button('choose').disabled).toBe(false);
    expect(m.button('choose-any').disabled).toBe(false); // both ways to the board are open again
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

  it('Android counts as "no USB serial": Chrome there has navigator.serial for Bluetooth only', () => {
    const serial = { requestPort: async () => ({}) as never, getPorts: async () => [] };
    expect(isAndroid({ userAgentData: { platform: 'Android' } })).toBe(true);
    expect(isAndroid({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36' })).toBe(true);
    expect(isAndroid({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36' })).toBe(false);
    expect(browserSupportsUpload(serial, true).reason).toBe('no-serial');
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
