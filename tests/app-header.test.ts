// @vitest-environment happy-dom
/**
 * App header tests (happy-dom): the whole app is mounted on a virtual-clock
 * board to check the toolbar — New replaces the sketch with the Arduino IDE's
 * blank sketch (asking only when hand-written work would be lost), there is
 * no GitHub link, Share opens the share dialog with the `#code=` /
 * `#blocks=` link, Arduino IDE opens its dialog with the sketch, Hand in
 * exists only when the class platform is configured and opens its dialog with
 * the work (docs/CLASSROOM.md §7.3), `#class=` links open it in join mode, the
 * run status stays short, and the global keys leave a sketch alone while a
 * dialog is open.
 *
 * Blockly is never loaded: in Blocks mode `createBlocksPanel` returns a small
 * fake panel whose "blocks" are a list of block types and whose sketch lists
 * them (see FakePanel).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { makeBoard, settle } from './helpers';
import { BLANK_SKETCH, mountApp, type App } from '../src/ui/app';
import { CODE_STORAGE_KEY, encodeShareCode } from '../src/ui/editor';
import {
  BLOCKS_BASELINE_STORAGE_KEY,
  BLOCKS_STORAGE_KEY,
  MODE_STORAGE_KEY,
  blocksFromHash,
  workspaceFingerprint,
  type BlocksPanel,
  type BlocksPanelOptions,
} from '../src/ui/blocks-panel';
import type { BlockExample } from '../src/blocks';
import { EXAMPLES } from '../src/examples';
import { saveSession } from '../src/classroom/session-store';
import { STUDENT_ERROR_TEXT } from '../src/classroom/errors';
import type { HandinWork } from '../src/ui/handin-dialog';

// ---------------------------------------------------------------------------
// Fake blocks panel
// ---------------------------------------------------------------------------

type FakeBlock = { type: string; id: string; x: number; y: number };
type FakeWorkspace = { blocks: { languageVersion: 0; blocks: FakeBlock[] } };

function workspace(...types: string[]): FakeWorkspace {
  return { blocks: { languageVersion: 0, blocks: types.map((type, i) => ({ type, id: `${type}-${i}`, x: 20, y: 20 + 120 * i })) } };
}

const DEFAULT_WS = workspace('z1_setup_hat', 'z1_loop_hat');
const BLINK_WS = workspace('z1_setup_hat', 'z1_loop_hat', 'z1_led_set', 'z1_wait');
const MY_WS = workspace('z1_setup_hat', 'z1_loop_hat', 'z1_buzzer_set');

/** The "generated sketch" of a fake workspace: the block types in a comment. */
function sketchOf(ws: object): string {
  const types = (ws as FakeWorkspace).blocks.blocks.map((b) => b.type).join(', ');
  return `// Generated from blocks: ${types}\n\nvoid setup() {\n}\n\nvoid loop() {\n}\n`;
}

const ERROR_SKETCH = '// Block code error: boom\n// The blocks could not be turned into a sketch.\n';

let nextId = 0;

/**
 * Stands in for the Blockly panel. Like Blockly it gives the blocks fresh ids
 * on every load and reports each change through `onChange` (synchronously
 * here, debounced in the real panel); `failing` makes getCode() throw like a
 * generator failure.
 */
class FakePanel implements BlocksPanel {
  private ws: FakeWorkspace = DEFAULT_WS;
  failing = false;

  constructor(private readonly options: BlocksPanelOptions) {
    this.loadWorkspace(DEFAULT_WS);
  }

  getCode(): string {
    if (this.failing) throw new Error('the blocks could not be turned into a sketch (boom)');
    return sketchOf(this.ws);
  }
  getWorkspaceJson(): object {
    return structuredClone(this.ws);
  }
  loadWorkspace(json: object): void {
    const blocks = (json as Partial<FakeWorkspace>).blocks?.blocks;
    if (!Array.isArray(blocks)) throw new Error('not a workspace');
    this.ws = { blocks: { languageVersion: 0, blocks: blocks.map((b) => ({ ...b, id: `blk${++nextId}` })) } };
    this.changed();
  }
  clear(): void {
    this.loadWorkspace(DEFAULT_WS);
  }
  resize(): void {}
  destroy(): void {}

  /** The student rearranges the blocks into `ws`. */
  edit(ws: FakeWorkspace): void {
    this.loadWorkspace(ws);
  }
  /** The generator fails on the next change (the real panel then reports an explanation comment). */
  breakGenerator(): void {
    this.failing = true;
    this.options.onChange(ERROR_SKETCH, this.getWorkspaceJson());
  }
  private changed(): void {
    if (!this.failing) this.options.onChange(this.getCode(), this.getWorkspaceJson());
  }
}

const fake = vi.hoisted(() => ({
  panel: null as unknown,
  examples: [] as unknown[],
  /** Whether the class platform counts as configured (docs/CLASSROOM.md §7.3: mocked, not read from the real config). */
  configured: true,
  /** Every open() of the Hand in dialog: the work and the join code. */
  handinOpens: [] as { work: HandinWork; joinCode?: string }[],
}));

vi.mock('../src/classroom/firebase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/classroom/firebase')>()),
  isClassroomConfigured: () => fake.configured,
}));

// The real dialog over a fake StudentApi (nothing saved, every request "offline"), with its open() recorded.
vi.mock('../src/ui/handin-dialog', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ui/handin-dialog')>();
  const { ClassroomError } = await import('../src/classroom/errors');
  const offline = async () => {
    throw new ClassroomError('offline');
  };
  const api = {
    restore: async () => null,
    findClass: offline,
    refreshClass: offline,
    join: offline,
    continueAs: offline,
    confirm: () => undefined,
    handIn: offline,
    myHandins: offline,
    leave: async () => undefined,
  } as unknown as import('../src/classroom/student').StudentApi;
  return {
    ...original,
    createHandinDialog: (parent: HTMLElement, options?: import('../src/ui/handin-dialog').HandinDialogOptions) => {
      const dialog = original.createHandinDialog(parent, { ...options, loadApi: async () => api });
      const open = dialog.open;
      dialog.open = (work, opts) => {
        fake.handinOpens.push({ work, joinCode: opts?.joinCode });
        open(work, opts);
      };
      return dialog;
    },
  };
});

vi.mock('../src/ui/blocks-panel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/blocks-panel')>()),
  createBlocksPanel: vi.fn(async (_container: HTMLElement, options: BlocksPanelOptions) => {
    const panel = new FakePanel(options);
    fake.panel = panel;
    return panel;
  }),
  loadBlockExamples: vi.fn(async () => fake.examples),
}));

const BLINK_EXAMPLE: BlockExample = {
  id: 'b01_blink',
  title: 'Blink the red LED',
  group: 'Outputs',
  description: 'The red LED turns on and off every second.',
  workspace: BLINK_WS,
};

function panel(): FakePanel {
  return fake.panel as FakePanel;
}

const fingerprint = (ws: object): string => workspaceFingerprint(ws);

// ---------------------------------------------------------------------------
// Mounting & helpers
// ---------------------------------------------------------------------------

let app: App | null = null;

afterEach(() => {
  app?.destroy();
  app = null;
  fake.panel = null;
  fake.examples = [];
  fake.configured = true;
  fake.handinOpens = [];
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  location.hash = '';
  Reflect.deleteProperty(window, 'confirm');
  vi.restoreAllMocks();
});

function start(savedCode?: string): HTMLElement {
  if (savedCode !== undefined) localStorage.setItem(CODE_STORAGE_KEY, savedCode);
  const root = document.createElement('div');
  document.body.appendChild(root);
  const { board, clock } = makeBoard();
  app = mountApp(root, board, clock);
  return root;
}

/** Mount in Blocks mode (as after a visit that ended in Blocks mode) and wait for the fake panel. */
async function startBlocks(): Promise<HTMLElement> {
  localStorage.setItem(MODE_STORAGE_KEY, 'blocks');
  fake.examples = [BLINK_EXAMPLE];
  const root = start();
  await settle();
  expect(fake.panel).not.toBeNull();
  return root;
}

/** Close the page (the app saves the blocks) and open it again. */
async function reload(): Promise<HTMLElement> {
  app!.destroy();
  app = null;
  document.body.innerHTML = '';
  return startBlocks();
}

function editorText(root: HTMLElement): string {
  return EditorView.findFromDOM(root.querySelector<HTMLElement>('.cm-editor')!)!.state.doc.toString();
}

function button(root: HTMLElement, slot: string): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)!;
}

function toastText(root: HTMLElement): string {
  return root.querySelector<HTMLElement>('[data-slot="toast"]')!.textContent ?? '';
}

/** window.confirm answering `answer` (happy-dom has none; removed again after each test). */
function stubConfirm(answer: boolean) {
  const confirm = vi.fn((_message?: string) => answer);
  window.confirm = confirm;
  return confirm;
}

function key(init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

/**
 * Catch the files a dialog downloads (through a Blob URL and a clicked
 * `<a download>`); `files()` resolves to their names and texts.
 */
function catchDownloads(): { files(): Promise<{ name: string; text: string }[]> } {
  const blobs = new Map<string, Blob>();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:test-${blobs.size + 1}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const clicks: { name: string; href: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ name: this.download, href: this.getAttribute('href') ?? '' });
  });
  return {
    files: () => Promise.all(clicks.map(async (c) => ({ name: c.name, text: await blobs.get(c.href)!.text() }))),
  };
}

/** Open the Examples menu and pick `title`. */
function pickExample(root: HTMLElement, title: string): void {
  root.querySelector<HTMLButtonElement>('[data-slot="examples"] > button')!.click();
  const item = Array.from(root.querySelectorAll<HTMLButtonElement>('.z1-menu-item')).find((b) => b.textContent === title);
  expect(item, title).toBeDefined();
  item!.click();
}

const MY_SKETCH = 'void setup() {\n  pinMode(A1, OUTPUT);\n}\n\nvoid loop() {\n  // my own work\n}\n';
/** What the Arduino IDE dialog names a download: `zero1_MMDD_HHMMSS.ino` (no student name saved). */
const SKETCH_FILE = /^zero1_\d{4}_\d{6}\.ino$/;

// ---------------------------------------------------------------------------
// Code mode
// ---------------------------------------------------------------------------

describe('header toolbar', () => {
  it('starts with New, has no GitHub link and ends with Hand in, Share and Arduino IDE', () => {
    const root = start();
    const toolbar = root.querySelector('.z1-toolbar')!;
    const first = toolbar.firstElementChild as HTMLElement;
    expect(first.dataset.slot).toBe('new');
    expect(first.textContent!.trim().endsWith('New')).toBe(true);
    expect(first.getAttribute('aria-label')).toBe('Start a new blank sketch');
    expect(Array.from(toolbar.children, (el) => (el as HTMLElement).dataset.slot)).toEqual([
      'new',
      'examples',
      'run',
      'stop',
      'reset',
      'settings',
      'handin',
      'share',
      'ide',
    ]);
    const handin = button(root, 'handin');
    expect(handin.textContent!.replace(/\s+/g, ' ').trim()).toBe('📥 Hand in');
    expect(handin.getAttribute('aria-label')).toBe('Hand in your work to your teacher');
    expect(handin.title).toBe('Hand in: send this work to your teacher');
    expect(button(root, 'share').title).toBe('Share: copy the link or download an .ino file');
    // The brand: the full name for assistive technology, the short one on smaller screens.
    expect(root.querySelector('.z1-title-full')!.textContent).toBe('ZERO1 Smart Board Simulator');
    expect(root.querySelector('.z1-title-short')!.textContent).toBe('ZERO1 Simulator');
    const ide = button(root, 'ide');
    expect(ide.type).toBe('button');
    expect(ide.textContent!.trim().endsWith('Arduino IDE')).toBe(true);
    expect(ide.getAttribute('aria-label')).toBe('Open this sketch in the Arduino IDE');
    expect(ide.title).toBe('Open in the Arduino IDE');
    expect(root.querySelector('a[href*="github"]')).toBeNull();
    expect(root.querySelector('header')!.textContent).not.toContain('GitHub');
  });

  it('has no Hand in button at all while the class platform is not configured', () => {
    fake.configured = false;
    const root = start();
    expect(root.querySelector('[data-slot="handin"]')).toBeNull();
    expect(root.querySelector('dialog.z1-handin')).toBeNull();
    expect(Array.from(root.querySelectorAll('.z1-toolbar > *'), (el) => (el as HTMLElement).dataset.slot)).toEqual([
      'new',
      'examples',
      'run',
      'stop',
      'reset',
      'settings',
      'share',
      'ide',
    ]);
  });

  it('reads "Hand in · ali.k" from the saved class session', () => {
    saveSession({ v: 1, code: 'BKT4M9', className: '8B Robotics', teacherName: 'Mr. B', studentId: 'ali00001', username: 'ali.k', uid: 'u1', lastUsedAt: 0, lastHandinAt: 0, lastHandinTitle: '' });
    const root = start();
    const handin = button(root, 'handin');
    expect(handin.querySelector('.z1-handin-name')!.textContent).toBe(' · ali.k');
    expect(handin.textContent!.replace(/\s+/g, ' ').trim()).toBe('📥 Hand in · ali.k');
    expect(handin.getAttribute('aria-label')).toBe('Hand in as ali.k to your class');
  });

  it('is exactly the Arduino IDE blank sketch', () => {
    expect(BLANK_SKETCH).toBe(
      'void setup() {\n  // put your setup code here, to run once:\n\n}\n\nvoid loop() {\n  // put your main code here, to run repeatedly:\n\n}\n',
    );
  });
});

describe('New', () => {
  it('replaces hand-written code only after the student confirms, and shows the Code tab', async () => {
    const root = start(MY_SKETCH);
    expect(editorText(root)).toBe(MY_SKETCH);

    const refuse = stubConfirm(false);
    button(root, 'new').click();
    await Promise.resolve();
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(refuse.mock.calls[0][0]).toBe('Start a new blank sketch?\nYour current code will be lost.');
    expect(editorText(root)).toBe(MY_SKETCH);

    button(root, 'tab-serial').click();
    expect(button(root, 'tab-code').getAttribute('aria-selected')).toBe('false');

    const accept = stubConfirm(true);
    button(root, 'new').click();
    await Promise.resolve();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(editorText(root)).toBe(BLANK_SKETCH);
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(BLANK_SKETCH);
    expect(toastText(root)).toBe('New blank sketch');
    expect(button(root, 'tab-code').getAttribute('aria-selected')).toBe('true');
    expect(button(root, 'tab-serial').getAttribute('aria-selected')).toBe('false');
  });

  it('does not ask when there is nothing to lose (an example, or the blank sketch after a reload)', async () => {
    const root = start();
    expect(editorText(root)).toBe(EXAMPLES[0].source);
    const confirm = stubConfirm(false);
    button(root, 'new').click();
    await Promise.resolve();
    expect(editorText(root)).toBe(BLANK_SKETCH);

    // Reload: the blank sketch comes back from localStorage and still counts as untouched.
    app!.destroy();
    app = null;
    document.body.innerHTML = '';
    const again = start(BLANK_SKETCH);
    expect(editorText(again)).toBe(BLANK_SKETCH);
    button(again, 'new').click();
    await Promise.resolve();
    expect(confirm).not.toHaveBeenCalled();
    expect(editorText(again)).toBe(BLANK_SKETCH);
  });
});

describe('Share', () => {
  it('opens the share dialog with the #code= link, and Esc there does not stop the sketch', () => {
    const root = start(MY_SKETCH);
    button(root, 'share').click();
    const dialog = root.querySelector<HTMLDialogElement>('dialog.z1-share')!;
    expect(dialog.open).toBe(true);
    const link = dialog.querySelector<HTMLInputElement>('#z1-share-url')!.value;
    expect(link.endsWith(`#code=${encodeShareCode(MY_SKETCH)}`)).toBe(true);

    const stop = vi.spyOn(app!, 'stop');
    key({ key: 'Escape' });
    expect(stop).not.toHaveBeenCalled();

    dialog.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    expect(dialog.open).toBe(false);
    key({ key: 'Escape' });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('Hand in', () => {
  it('opens the Hand in dialog with the editor text and the untouched-example / error facts', async () => {
    const root = start(MY_SKETCH);
    button(root, 'handin').click();
    await settle();
    const dialog = root.querySelector<HTMLDialogElement>('dialog.z1-handin')!;
    expect(dialog.open).toBe(true);
    expect(fake.handinOpens).toHaveLength(1);
    expect(fake.handinOpens[0]).toEqual({ work: { kind: 'code', code: MY_SKETCH, workspaceJson: '', unchanged: null, errorCount: 0 }, joinCode: undefined });
    // Nothing saved: the dialog asks for the class code without downloading anything.
    expect(dialog.querySelector<HTMLElement>('[data-view="code"]')!.hidden).toBe(false);

    const stop = vi.spyOn(app!, 'stop');
    key({ key: 'Escape' });
    expect(stop).not.toHaveBeenCalled();
    dialog.close();

    // An untouched example, and a sketch with errors.
    stubConfirm(true);
    pickExample(root, EXAMPLES[0].title);
    button(root, 'handin').click();
    expect(fake.handinOpens[1].work.unchanged).toEqual({ kind: 'example', title: EXAMPLES[0].title });
    expect(fake.handinOpens[1].work.errorCount).toBe(0);
    dialog.close();
    button(root, 'new').click();
    await Promise.resolve();
    button(root, 'handin').click();
    expect(fake.handinOpens[2].work.unchanged).toEqual({ kind: 'blank' });
    dialog.close();
    EditorView.findFromDOM(root.querySelector<HTMLElement>('.cm-editor')!)!.dispatch({ changes: { from: 0, insert: 'int x = ;\n' } });
    button(root, 'handin').click();
    expect(fake.handinOpens[3].work.unchanged).toBeNull();
    expect(fake.handinOpens[3].work.errorCount).toBeGreaterThan(0);
  });

  it('a #class= link opens the dialog in join mode with the code, and is dropped from the address bar', async () => {
    location.hash = '#class=bkt-4m9';
    const root = start(MY_SKETCH);
    await settle();
    expect(location.hash).toBe('');
    expect(fake.handinOpens).toHaveLength(1);
    expect(fake.handinOpens[0].joinCode).toBe('BKT4M9');
    expect(fake.handinOpens[0].work.code).toBe(MY_SKETCH);
    expect(root.querySelector<HTMLDialogElement>('dialog.z1-handin')!.open).toBe(true);
    expect(editorText(root)).toBe(MY_SKETCH); // the link changed nothing else
  });

  it('a #class= link on an unconfigured site only says that classes are not set up', async () => {
    fake.configured = false;
    location.hash = '#class=BKT4M9';
    const root = start(MY_SKETCH);
    await settle();
    expect(location.hash).toBe('');
    expect(toastText(root)).toBe(STUDENT_ERROR_TEXT.not_configured);
    expect(root.querySelector('dialog.z1-handin')).toBeNull();
  });

  it('a saved Blocks mode does not override a #code= share link (B1a)', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'blocks');
    location.hash = `#code=${encodeShareCode(MY_SKETCH)}`;
    const root = start();
    expect(document.body.dataset.mode).toBe('code');
    expect(editorText(root)).toBe(MY_SKETCH);
    expect(button(root, 'mode-code').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Arduino IDE', () => {
  it('opens its dialog with the editor text, ready to download as a uniquely named .ino', async () => {
    const root = start(MY_SKETCH);
    const downloads = catchDownloads();
    button(root, 'ide').click();
    const dialog = root.querySelector<HTMLDialogElement>('dialog.z1-ide')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector<HTMLElement>('[data-role="blocks-note"]')!.hidden).toBe(true);

    dialog.querySelector<HTMLButtonElement>('[data-action="download"]')!.click();
    const [file] = await downloads.files();
    expect(file.name).toMatch(SKETCH_FILE);
    expect(file.text).toBe(MY_SKETCH);
    expect(dialog.querySelector('[data-role="steps"]')!.textContent).toContain(file.name);
  });
});

describe('run status', () => {
  const status = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('[data-slot="status"]')!;
  const consoleStatus = (root: HTMLElement): string => root.querySelector('.z1-console-status')!.textContent ?? '';

  // A long status would wrap the header onto a second row at 1366-1536 px.
  it('keeps a compile error short in the header, with the full sentence in the console', async () => {
    const root = start('void setup() {\n  pinMode(A1, OUTPUT)\n}\n\nvoid loop() {\n}\n');
    await app!.run();
    expect(status(root).dataset.status).toBe('error');
    expect(status(root).textContent!.trim()).toBe('1 error');
    expect(consoleStatus(root)).toBe('1 error — fix and run again');
  });

  it('keeps a runtime error short in the header, with the full sentence in the console', async () => {
    const root = start('int zero = 0;\n\nvoid setup() {\n  int x = 5 / zero;\n}\n\nvoid loop() {\n}\n');
    await app!.run();
    expect(status(root).dataset.status).toBe('error');
    expect(status(root).textContent!.trim()).toMatch(/^Error at \d+ ms$/);
    expect(consoleStatus(root)).toBe('Stopped by an error — click the message to jump to the line');
  });
});

describe('global keys with a dialog open', () => {
  it('leave the sketch alone while the Arduino IDE, Share, Hand in or Settings dialog is open', () => {
    const root = start(MY_SKETCH);
    const run = vi.spyOn(app!, 'run').mockResolvedValue(undefined);
    const stop = vi.spyOn(app!, 'stop').mockResolvedValue(undefined);

    for (const [slot, selector] of [
      ['ide', 'dialog.z1-ide'],
      ['share', 'dialog.z1-share'],
      ['handin', 'dialog.z1-handin'],
      ['settings', 'dialog.z1-dialog:not(.z1-share):not(.z1-ide):not(.z1-handin)'],
    ] as const) {
      button(root, slot).click();
      const dialog = root.querySelector<HTMLDialogElement>(selector)!;
      expect(dialog.open, slot).toBe(true);
      key({ key: 'Enter', ctrlKey: true });
      key({ key: 'Enter', metaKey: true });
      key({ key: 'Escape' });
      expect(run, slot).not.toHaveBeenCalled();
      expect(stop, slot).not.toHaveBeenCalled();
      dialog.close();
    }

    key({ key: 'Enter', ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    key({ key: 'Escape' });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Blocks mode
// ---------------------------------------------------------------------------

describe('Blocks mode', () => {
  it('mirrors the sketch generated from the blocks in the editor', async () => {
    const root = await startBlocks();
    expect(button(root, 'tab-blocks').getAttribute('aria-selected')).toBe('true');
    expect(editorText(root)).toBe(sketchOf(DEFAULT_WS));
    panel().edit(MY_WS);
    expect(editorText(root)).toBe(sketchOf(MY_WS));
  });

  it('Share opens the dialog with the #blocks= link, and Download .ino saves the generated sketch', async () => {
    const root = await startBlocks();
    panel().edit(MY_WS);
    const downloads = catchDownloads();
    button(root, 'share').click();
    const dialog = root.querySelector<HTMLDialogElement>('dialog.z1-share')!;
    expect(dialog.open).toBe(true);
    const link = dialog.querySelector<HTMLInputElement>('#z1-share-url')!.value;
    const hash = link.slice(link.indexOf('#'));
    expect(hash.startsWith('#blocks=')).toBe(true);
    expect(fingerprint(blocksFromHash(hash)!)).toBe(fingerprint(MY_WS));

    dialog.querySelector<HTMLButtonElement>('[data-action="download"]')!.click();
    const [file] = await downloads.files();
    expect(file.name).toMatch(/^zero1_\w*\.ino$/);
    expect(file.text).toBe(sketchOf(MY_WS));
  });

  it('the Arduino IDE dialog gets the sketch generated from the blocks', async () => {
    const root = await startBlocks();
    panel().edit(MY_WS);
    const downloads = catchDownloads();
    button(root, 'ide').click();
    const dialog = root.querySelector<HTMLDialogElement>('dialog.z1-ide')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector<HTMLElement>('[data-role="blocks-note"]')!.hidden).toBe(false);
    dialog.querySelector<HTMLButtonElement>('[data-action="download"]')!.click();
    const [file] = await downloads.files();
    expect(file.name).toMatch(SKETCH_FILE);
    expect(file.text).toBe(sketchOf(MY_WS));
  });

  it('Hand in gets the generated sketch, the workspace JSON and the example / blank facts', async () => {
    const root = await startBlocks();
    button(root, 'handin').click();
    expect(fake.handinOpens[0].work).toEqual({
      kind: 'blocks',
      code: sketchOf(panel().getWorkspaceJson()),
      workspaceJson: JSON.stringify(panel().getWorkspaceJson()),
      unchanged: { kind: 'blank' },
      errorCount: 0,
    });
    root.querySelector<HTMLDialogElement>('dialog.z1-handin')!.close();
    pickExample(root, BLINK_EXAMPLE.title);
    await settle();
    button(root, 'handin').click();
    expect(fake.handinOpens[1].work.unchanged).toEqual({ kind: 'example', title: BLINK_EXAMPLE.title });
    root.querySelector<HTMLDialogElement>('dialog.z1-handin')!.close();
    panel().edit(MY_WS);
    button(root, 'handin').click();
    expect(fake.handinOpens[2].work.unchanged).toBeNull();
    expect(fake.handinOpens[2].work.workspaceJson).toBe(JSON.stringify(panel().getWorkspaceJson()));
  });

  it('asks to wait while the blocks are still loading', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'blocks');
    const root = start();
    for (const slot of ['share', 'ide', 'handin']) {
      button(root, slot).click();
      expect(toastText(root), slot).toBe('The blocks are still loading — try again in a moment');
    }
    expect(root.querySelector<HTMLDialogElement>('dialog.z1-share')!.open).toBe(false);
    expect(root.querySelector<HTMLDialogElement>('dialog.z1-ide')!.open).toBe(false);
    expect(root.querySelector<HTMLDialogElement>('dialog.z1-handin')!.open).toBe(false);
    expect(fake.handinOpens).toEqual([]);
  });

  it('hands out the explanation comment when the blocks cannot be turned into a sketch', async () => {
    const root = await startBlocks();
    panel().edit(MY_WS);
    panel().breakGenerator();
    expect(editorText(root)).toBe(ERROR_SKETCH);
    const downloads = catchDownloads();

    button(root, 'share').click();
    const share = root.querySelector<HTMLDialogElement>('dialog.z1-share')!;
    expect(share.querySelector<HTMLInputElement>('#z1-share-url')!.value).toContain('#blocks=');
    share.querySelector<HTMLButtonElement>('[data-action="download"]')!.click();
    share.close();

    button(root, 'ide').click();
    root.querySelector<HTMLButtonElement>('dialog.z1-ide [data-action="download"]')!.click();

    const files = await downloads.files();
    expect(files.map((f) => f.text)).toEqual([ERROR_SKETCH, ERROR_SKETCH]);
  });

  it('New asks only when the blocks differ from the empty program or the last loaded example', async () => {
    const root = await startBlocks();
    const quiet = stubConfirm(false);
    button(root, 'new').click();
    await settle();
    expect(quiet).not.toHaveBeenCalled(); // the empty program: nothing to lose
    expect(toastText(root)).toBe('New blank program');

    panel().edit(MY_WS);
    button(root, 'new').click();
    await settle();
    expect(quiet).toHaveBeenCalledTimes(1);
    expect(quiet.mock.calls[0][0]).toBe('Start a new blank program?\nYour current blocks will be lost.');
    expect(fingerprint(panel().getWorkspaceJson())).toBe(fingerprint(MY_WS));

    const accept = stubConfirm(true);
    button(root, 'new').click();
    await settle();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(fingerprint(panel().getWorkspaceJson())).toBe(fingerprint(DEFAULT_WS));
    expect(editorText(root)).toBe(sketchOf(DEFAULT_WS));

    // An example just loaded is the new "untouched" state.
    pickExample(root, BLINK_EXAMPLE.title);
    await settle();
    expect(fingerprint(panel().getWorkspaceJson())).toBe(fingerprint(BLINK_WS));
    const again = stubConfirm(false);
    button(root, 'new').click();
    await settle();
    expect(again).not.toHaveBeenCalled();
    expect(fingerprint(panel().getWorkspaceJson())).toBe(fingerprint(DEFAULT_WS));
  });

  it('an example restored unchanged after a reload still counts as untouched', async () => {
    let root = await startBlocks();
    pickExample(root, BLINK_EXAMPLE.title);
    await settle();
    expect(localStorage.getItem(BLOCKS_BASELINE_STORAGE_KEY)).toBe(fingerprint(BLINK_WS));

    root = await reload();
    expect(fingerprint(panel().getWorkspaceJson())).toBe(fingerprint(BLINK_WS)); // restored from z1.blocks
    const confirm = stubConfirm(false);
    button(root, 'new').click();
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(fingerprint(panel().getWorkspaceJson())).toBe(fingerprint(DEFAULT_WS));
    expect(localStorage.getItem(BLOCKS_BASELINE_STORAGE_KEY)).toBe(fingerprint(DEFAULT_WS));

    // Changed after loading the example: the reload keeps the question.
    pickExample(root, BLINK_EXAMPLE.title);
    await settle();
    panel().edit(MY_WS);
    root = await reload();
    expect(fingerprint(JSON.parse(localStorage.getItem(BLOCKS_STORAGE_KEY)!))).toBe(fingerprint(MY_WS));
    pickExample(root, BLINK_EXAMPLE.title);
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toBe(`Replace your blocks with the example "${BLINK_EXAMPLE.title}"?\nYour current blocks will be lost.`);
    expect(fingerprint(panel().getWorkspaceJson())).toBe(fingerprint(MY_WS));
  });
});
