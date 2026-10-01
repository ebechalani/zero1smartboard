// @vitest-environment happy-dom
/**
 * App header tests (happy-dom): the whole app is mounted on a virtual-clock
 * board to check the toolbar — New replaces the sketch with the Arduino IDE's
 * blank sketch (asking only when hand-written work would be lost), there is
 * no GitHub link, the Share menu copies the `#code=` / `#blocks=` link and
 * downloads the .ino, Arduino IDE opens its dialog with the sketch, the
 * Settings menu resets the board or opens the settings dialog, "Hand in to my
 * teacher" exists only when the class platform is configured and opens the
 * Hand in dialog with the work (docs/CLASSROOM.md §7.3), `#class=` links open
 * it with the code prefilled, the run status stays short, the global keys
 * leave a sketch alone while a dialog or a menu is open, and the style rules
 * that keep the header on one row at 1366×768 (also with Upload to board shown)
 * and put the actions on their own row at 1280×800 (docs/PYTHON.md §7.14).
 *
 * Blockly is never loaded: in Blocks mode `createBlocksPanel` returns a small
 * fake panel whose "blocks" are a list of block types and whose sketch lists
 * them (see FakePanel). Blocks mode shows that sketch in the Code tab's
 * read-only mirror and never touches the hand-written sketch (docs/PYTHON.md
 * §7.5-7.6); "Edit a copy in Code mode" is the only way across.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { makeBoard, settle } from './helpers';
import { BLANK_SKETCH, COPY_FALLBACK, mountApp, type App } from '../src/ui/app';
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
    join: offline,
    handIn: offline,
    forget: () => undefined,
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
  Reflect.deleteProperty(window, 'prompt');
  Reflect.deleteProperty(navigator, 'clipboard');
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

/** The Code tab's editable editor: the student's own sketch (`z1.code`). */
function editorText(root: HTMLElement): string {
  return EditorView.findFromDOM(root.querySelector<HTMLElement>('[data-slot="editor"] .cm-editor')!)!.state.doc.toString();
}

/** The Code tab's read-only mirror: the sketch made from the blocks. */
function mirrorText(root: HTMLElement): string {
  return EditorView.findFromDOM(root.querySelector<HTMLElement>('[data-slot="mirror"] .cm-editor')!)!.state.doc.toString();
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

/** The "Label ▾" trigger of a header menu (Examples, Settings, Share). */
function menuButton(root: HTMLElement, slot: string): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`[data-slot="${slot}"] > button`)!;
}

/** The labels of the items of a header menu. */
function menuItems(root: HTMLElement, slot: string): string[] {
  return Array.from(root.querySelectorAll(`[data-slot="${slot}"] [role="menuitem"]`), (b) => b.textContent ?? '');
}

/** Open the header menu `slot` and pick the item `label`. */
function pick(root: HTMLElement, slot: string, label: string): void {
  menuButton(root, slot).click();
  const item = Array.from(root.querySelectorAll<HTMLButtonElement>(`[data-slot="${slot}"] .z1-menu-item`)).find((b) => b.textContent === label);
  expect(item, label).toBeDefined();
  item!.click();
}

/** Open the Examples menu and pick `title`. */
function pickExample(root: HTMLElement, title: string): void {
  pick(root, 'examples', title);
}

/** A clipboard whose writeText resolves (or rejects); happy-dom has none. */
function stubClipboard(ok = true) {
  const writeText = vi.fn<(text: string) => Promise<void>>(() => (ok ? Promise.resolve() : Promise.reject(new Error('denied'))));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

const settingsDialog = (root: HTMLElement): HTMLDialogElement => root.querySelector<HTMLDialogElement>('dialog.z1-dialog:not(.z1-ide):not(.z1-handin)')!;

const MY_SKETCH = 'void setup() {\n  pinMode(A1, OUTPUT);\n}\n\nvoid loop() {\n  // my own work\n}\n';
/** What the Arduino IDE dialog names a download: `zero1_MMDD_HHMMSS.ino` (no student name saved). */
const SKETCH_FILE = /^zero1_\d{4}_\d{6}\.ino$/;

// ---------------------------------------------------------------------------
// Code mode
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Header at school-laptop sizes (docs/PYTHON.md §7.14)
// ---------------------------------------------------------------------------

/**
 * The style rules of src/ui/style.css that apply at a window size: the top-level rules and those
 * of every @media block whose query matches (happy-dom evaluates media queries with matchMedia but
 * does not lay out; the one-row layout itself is checked in a real browser, see §7.14).
 */
function rulesAt(width: number, height: number): CSSStyleRule[] {
  let style = document.head.querySelector<HTMLStyleElement>('style[data-test="app-css"]');
  if (!style) {
    style = document.createElement('style');
    style.dataset.test = 'app-css';
    style.textContent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/ui/style.css'), 'utf8');
    document.head.appendChild(style);
  }
  (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height });
  const rules: CSSStyleRule[] = [];
  for (const rule of Array.from(style.sheet!.cssRules)) {
    if (rule instanceof CSSMediaRule) {
      if (window.matchMedia(rule.media.mediaText).matches) rules.push(...(Array.from(rule.cssRules) as CSSStyleRule[]));
    } else if ('selectorText' in rule) {
      rules.push(rule as CSSStyleRule);
    }
  }
  return rules;
}

/** The toolbar while "Upload to board" is shown; happy-dom's `matches()` does not take :not() inside :has(). */
const UPLOAD_SHOWN = ".z1-toolbar:has([data-slot='upload']:not([hidden]))";

/** `el.matches(selector)`, with UPLOAD_SHOWN worked out here (Chromium: see the measurements in style.css). */
function matchesRule(el: Element, selector: string): boolean {
  if (selector.includes(UPLOAD_SHOWN)) {
    const shown = el.ownerDocument.querySelector("[data-slot='upload']:not([hidden])") !== null;
    selector = selector.split(UPLOAD_SHOWN).join(shown ? '.z1-toolbar' : '.z1-toolbar.z1-never');
  }
  return el.matches(selector);
}

/** The last value of `property` among the rules at that size that match `el` ('' = none). */
function cssValue(rules: CSSStyleRule[], el: Element, property: string): string {
  let value = '';
  for (const rule of rules) {
    if (matchesRule(el, rule.selectorText) && rule.style.getPropertyValue(property)) value = rule.style.getPropertyValue(property);
  }
  return value;
}

describe('header at 1366×768 and 1280×800 (docs/PYTHON.md §7.14)', () => {
  afterEach(() => {
    (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width: 1024, height: 768 });
    document.head.querySelector('style[data-test="app-css"]')?.remove();
  });

  it('at 1366×768 the Arduino IDE and Settings buttons show their icons only and the actions stay on the brand row (Python mode)', async () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'python');
    const root = start();
    await vi.waitFor(() => expect(root.querySelector('[data-slot="panel-python"] .cm-editor')).not.toBeNull(), { timeout: 10_000 });
    const rules = rulesAt(1366, 768);
    const ide = button(root, 'ide');
    expect(cssValue(rules, ide.querySelector('.z1-btn-label')!, 'display')).toBe('none');
    expect(cssValue(rules, menuButton(root, 'settings').querySelector('.z1-btn-label')!, 'display')).toBe('none');
    expect(cssValue(rules, menuButton(root, 'share').querySelector('.z1-btn-label')!, 'display')).toBe(''); // "Share" stays
    // The label is only hidden: the name and the tooltip stay.
    expect(ide.getAttribute('aria-label')).toBe('Open the sketch made from this program in the Arduino IDE');
    expect(ide.title).toBe('Open in the Arduino IDE');
    expect(cssValue(rules, root.querySelector('.z1-toolbar')!, 'flex-basis')).toBe(''); // no row of its own
    expect(cssValue(rules, root.querySelector('.z1-title-short')!, 'display')).toBe('inline');
    expect(Array.from(root.querySelectorAll('.z1-mode .z1-mode-btn'), (b) => b.textContent)).toEqual(['Code', 'Blocks', 'Python']);
    expect(root.querySelector('.z1-header')!.children).toHaveLength(4); // brand, mode switch, actions, run status
  });

  it('at 1280×800 the actions get a row of their own under the brand, mode switch and run status, with all their labels', () => {
    const root = start();
    const rules = rulesAt(1280, 800);
    const toolbar = root.querySelector('.z1-toolbar')!;
    expect(cssValue(rules, toolbar, 'flex-basis')).toBe('100%');
    expect(cssValue(rules, toolbar, 'order')).toBe('1');
    expect(cssValue(rules, button(root, 'ide').querySelector('.z1-btn-label')!, 'display')).toBe('');
    expect(cssValue(rules, menuButton(root, 'settings').querySelector('.z1-btn-label')!, 'display')).toBe('');
  });

  it('from 1440 px every label shows', () => {
    const root = start();
    const rules = rulesAt(1440, 900);
    expect(cssValue(rules, button(root, 'ide').querySelector('.z1-btn-label')!, 'display')).toBe('');
    expect(cssValue(rules, root.querySelector('.z1-toolbar')!, 'flex-basis')).toBe('');
  });

  it('with Upload to board shown, Upload and Arduino IDE show their icons only from 1366 to 1759 px (one row, measured in Chromium)', () => {
    const root = start();
    const upload = button(root, 'upload');
    const ide = button(root, 'ide');
    const label = (b: HTMLElement) => b.querySelector('.z1-btn-label')!;
    expect(label(upload).textContent).toBe('Upload to board');
    upload.hidden = false; // shown where uploading works (Web Serial and a deployed toolchain)
    for (const [width, height] of [
      [1366, 768],
      [1440, 900],
      [1536, 864],
      [1759, 900],
    ]) {
      const rules = rulesAt(width, height);
      expect(cssValue(rules, label(upload), 'display'), `${width}`).toBe('none');
      expect(cssValue(rules, label(ide), 'display'), `${width}`).toBe('none');
      expect(cssValue(rules, menuButton(root, 'share').querySelector('.z1-btn-label')!, 'display'), `${width}`).toBe('');
    }
    // The label is only hidden: the name and the tooltip stay.
    expect(upload.getAttribute('aria-label')).toBe('Upload this sketch to the ZERO1 board');
    expect(upload.title).toBe('Compile in the browser and upload to the board over USB');
    for (const [width, height] of [
      [1760, 990],
      [1280, 800],
    ]) {
      const rules = rulesAt(width, height);
      expect(cssValue(rules, label(upload), 'display'), `${width}`).toBe('');
      expect(cssValue(rules, label(ide), 'display'), `${width}`).toBe('');
    }
    // Hidden again (no Web Serial): "Arduino IDE" keeps its label from 1440 px.
    upload.hidden = true;
    expect(cssValue(rulesAt(1440, 900), label(ide), 'display')).toBe('');
    expect(cssValue(rulesAt(1536, 864), label(ide), 'display')).toBe('');
  });
});

describe('header toolbar', () => {
  it('starts with New, has no GitHub link and ends with the Settings and Share menus and Arduino IDE', () => {
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
      'settings',
      'share',
      'ide',
      'upload',
    ]);
    // "Upload to board" only shows itself in browsers with Web Serial and a deployed toolchain.
    expect((toolbar.lastElementChild as HTMLElement).hidden).toBe(true);
    // No separate Reset or Hand in buttons: they live in the Settings and Share menus.
    expect(root.querySelector('[data-slot="reset"], [data-slot="handin"]')).toBeNull();
    const settings = menuButton(root, 'settings');
    expect(settings.textContent!.replace(/\s+/g, ' ').trim()).toBe('⚙ Settings ▾');
    expect(settings.getAttribute('aria-haspopup')).toBe('menu');
    expect(settings.getAttribute('aria-label')).toBe('Open the settings menu');
    expect(settings.querySelector('.z1-btn-label')!.textContent).toBe('Settings'); // hidden at 1366-1439 px by the CSS
    expect(menuItems(root, 'settings')).toEqual(['Reset the board', 'Board settings…']);
    const share = menuButton(root, 'share');
    expect(share.textContent!.replace(/\s+/g, ' ').trim()).toBe('🔗 Share ▾');
    expect(share.getAttribute('aria-haspopup')).toBe('menu');
    expect(share.getAttribute('aria-label')).toBe('Open the share menu');
    expect(share.title).toBe('Share: copy the link, download an .ino file or hand in to your teacher');
    expect(menuItems(root, 'share')).toEqual(['Hand in to my teacher', 'Copy link', 'Download .ino']);
    for (const slot of ['settings', 'share']) expect(root.querySelector(`[data-slot="${slot}"] [role="menu"]`)!.classList.contains('z1-menu-compact'), slot).toBe(true);
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

  it('has no Hand in item at all while the class platform is not configured', () => {
    fake.configured = false;
    const root = start();
    expect(root.querySelector('dialog.z1-handin')).toBeNull();
    expect(menuItems(root, 'share')).toEqual(['Copy link', 'Download .ino']);
    expect(menuButton(root, 'share').title).toBe('Share: copy the link or download an .ino file');
    expect(menuButton(root, 'share').querySelector('.z1-handin-name')).toBeNull();
    expect(Array.from(root.querySelectorAll('.z1-toolbar > *'), (el) => (el as HTMLElement).dataset.slot)).toEqual([
      'new',
      'examples',
      'run',
      'stop',
      'settings',
      'share',
      'ide',
      'upload',
    ]);
  });

  it('reads "Share · Ali Khoury" from the saved class session', () => {
    saveSession({ v: 2, code: 'BKT4M9', className: '8B Robotics', firstName: 'Ali', lastName: 'Khoury', uid: 'u1', lastUsedAt: 0, lastHandinAt: 0 });
    const root = start();
    const share = menuButton(root, 'share');
    expect(share.querySelector('.z1-handin-name')!.textContent).toBe(' · Ali Khoury');
    expect(share.textContent!.replace(/\s+/g, ' ').trim()).toBe('🔗 Share · Ali Khoury ▾');
    expect(share.getAttribute('aria-label')).toBe('Open the share menu (hand in as Ali Khoury)');
    expect(share.title).toBe('Share: copy the link, download an .ino file or hand in as Ali Khoury');
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

describe('Share menu', () => {
  it('Copy link puts the #code= link on the clipboard and closes the menu; Esc in the open menu does not stop the sketch', async () => {
    const root = start(MY_SKETCH);
    const writeText = stubClipboard();
    const stop = vi.spyOn(app!, 'stop');
    menuButton(root, 'share').click();
    expect(menuButton(root, 'share').getAttribute('aria-expanded')).toBe('true');
    key({ key: 'Escape' });
    expect(stop).not.toHaveBeenCalled();

    menuButton(root, 'share').click(); // closed again
    expect(menuButton(root, 'share').getAttribute('aria-expanded')).toBe('false');
    pick(root, 'share', 'Copy link');
    expect(menuButton(root, 'share').getAttribute('aria-expanded')).toBe('false');
    expect(writeText).toHaveBeenCalledTimes(1);
    const link = writeText.mock.calls[0][0];
    expect(link.startsWith(`${location.origin}${location.pathname}`)).toBe(true);
    expect(link.endsWith(`#code=${encodeShareCode(MY_SKETCH)}`)).toBe(true);
    await settle();
    expect(toastText(root)).toBe('Link copied');

    key({ key: 'Escape' });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('asks for Ctrl+C with the link in a prompt when the clipboard refuses or is missing', async () => {
    const root = start(MY_SKETCH);
    const prompt = vi.fn((_text?: string, _value?: string) => null);
    window.prompt = prompt;
    stubClipboard(false);
    pick(root, 'share', 'Copy link');
    await settle();
    expect(toastText(root)).toBe(COPY_FALLBACK);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0][0]).toBe(COPY_FALLBACK);
    expect(prompt.mock.calls[0][1]!.endsWith(`#code=${encodeShareCode(MY_SKETCH)}`)).toBe(true);

    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); // http://, old browsers
    pick(root, 'share', 'Copy link');
    await settle();
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('Download .ino saves the sketch under a unique name that carries the remembered student name', async () => {
    const root = start(MY_SKETCH);
    const downloads = catchDownloads();
    pick(root, 'share', 'Download .ino');
    let [file] = await downloads.files();
    expect(file.name).toMatch(SKETCH_FILE);
    expect(file.text).toBe(MY_SKETCH);
    expect(toastText(root)).toBe(`Downloading ${file.name}`);

    app!.destroy();
    app = null;
    document.body.innerHTML = '';
    saveSession({ v: 2, code: 'BKT4M9', className: '8B', firstName: 'Élise', lastName: 'M', uid: 'u1', lastUsedAt: 0, lastHandinAt: 0 });
    const again = start(MY_SKETCH);
    pick(again, 'share', 'Download .ino');
    [, file] = await downloads.files();
    expect(file.name).toMatch(/^zero1_Elise_M_\d{4}_\d{6}\.ino$/);
  });
});

describe('Settings menu', () => {
  it('Reset the board resets at once; Board settings… opens the settings dialog', () => {
    const root = start(MY_SKETCH);
    const reset = vi.spyOn(app!, 'reset').mockResolvedValue(undefined);
    pick(root, 'settings', 'Reset the board');
    expect(reset).toHaveBeenCalledTimes(1);
    expect(menuButton(root, 'settings').getAttribute('aria-expanded')).toBe('false');
    expect(settingsDialog(root).open).toBe(false);

    pick(root, 'settings', 'Board settings…');
    expect(settingsDialog(root).open).toBe(true);
    expect(settingsDialog(root).querySelector('h2')!.textContent).toBe('Board settings');
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('Hand in', () => {
  it('opens the Hand in dialog with the editor text and the untouched-example / error facts', async () => {
    const root = start(MY_SKETCH);
    pick(root, 'share', 'Hand in to my teacher');
    await settle();
    const dialog = root.querySelector<HTMLDialogElement>('dialog.z1-handin')!;
    expect(dialog.open).toBe(true);
    expect(fake.handinOpens).toHaveLength(1);
    expect(fake.handinOpens[0]).toEqual({ work: { kind: 'code', code: MY_SKETCH, workspaceJson: '', python: '', unchanged: null, errorCount: 0 }, joinCode: undefined });
    // Nothing saved: the dialog asks for the class code without downloading anything.
    expect(dialog.querySelector<HTMLElement>('[data-view="code"]')!.hidden).toBe(false);

    const stop = vi.spyOn(app!, 'stop');
    key({ key: 'Escape' });
    expect(stop).not.toHaveBeenCalled();
    dialog.close();

    // An untouched example, and a sketch with errors.
    stubConfirm(true);
    pickExample(root, EXAMPLES[0].title);
    pick(root, 'share', 'Hand in to my teacher');
    expect(fake.handinOpens[1].work.unchanged).toEqual({ kind: 'example', title: EXAMPLES[0].title });
    expect(fake.handinOpens[1].work.errorCount).toBe(0);
    dialog.close();
    button(root, 'new').click();
    await Promise.resolve();
    pick(root, 'share', 'Hand in to my teacher');
    expect(fake.handinOpens[2].work.unchanged).toEqual({ kind: 'blank' });
    dialog.close();
    EditorView.findFromDOM(root.querySelector<HTMLElement>('[data-slot="editor"] .cm-editor')!)!.dispatch({ changes: { from: 0, insert: 'int x = ;\n' } });
    pick(root, 'share', 'Hand in to my teacher');
    expect(fake.handinOpens[3].work.unchanged).toBeNull();
    expect(fake.handinOpens[3].work.errorCount).toBeGreaterThan(0);
  });

  it('a #class= link opens the dialog with the code prefilled, and is dropped from the address bar', async () => {
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
    expect(dialog.querySelector<HTMLElement>('[data-role="note"]')!.hidden).toBe(true);

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

describe('global keys with a dialog or a menu open', () => {
  it('leave the sketch alone while the Arduino IDE, Hand in or Settings dialog is open', () => {
    const root = start(MY_SKETCH);
    const run = vi.spyOn(app!, 'run').mockResolvedValue(undefined);
    const stop = vi.spyOn(app!, 'stop').mockResolvedValue(undefined);

    for (const [name, open, selector] of [
      ['ide', () => button(root, 'ide').click(), 'dialog.z1-ide'],
      ['handin', () => pick(root, 'share', 'Hand in to my teacher'), 'dialog.z1-handin'],
      ['settings', () => pick(root, 'settings', 'Board settings…'), 'dialog.z1-dialog:not(.z1-ide):not(.z1-handin)'],
    ] as const) {
      open();
      const dialog = root.querySelector<HTMLDialogElement>(selector)!;
      expect(dialog.open, name).toBe(true);
      key({ key: 'Enter', ctrlKey: true });
      key({ key: 'Enter', metaKey: true });
      key({ key: 'Escape' });
      expect(run, name).not.toHaveBeenCalled();
      expect(stop, name).not.toHaveBeenCalled();
      dialog.close();
    }

    key({ key: 'Enter', ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    key({ key: 'Escape' });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('Esc does not stop the sketch while the Examples, Settings or Share menu is open', () => {
    const root = start(MY_SKETCH);
    const stop = vi.spyOn(app!, 'stop').mockResolvedValue(undefined);
    for (const slot of ['examples', 'settings', 'share']) {
      const trigger = menuButton(root, slot);
      trigger.click();
      expect(trigger.getAttribute('aria-expanded'), slot).toBe('true');
      key({ key: 'Escape' });
      expect(stop, slot).not.toHaveBeenCalled();
      trigger.click();
      expect(trigger.getAttribute('aria-expanded'), slot).toBe('false');
    }
    key({ key: 'Escape' });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Blocks mode
// ---------------------------------------------------------------------------

describe('Blocks mode', () => {
  it('mirrors the sketch generated from the blocks in the read-only mirror, leaving the hand-written sketch alone', async () => {
    localStorage.setItem(CODE_STORAGE_KEY, MY_SKETCH);
    const root = await startBlocks();
    expect(button(root, 'tab-blocks').getAttribute('aria-selected')).toBe('true');
    expect(mirrorText(root)).toBe(sketchOf(DEFAULT_WS));
    panel().edit(MY_WS);
    expect(mirrorText(root)).toBe(sketchOf(MY_WS));
    expect(editorText(root)).toBe(MY_SKETCH);
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(MY_SKETCH);
    // The Code tab shows the mirror, with its banner, instead of the student's editor.
    expect(root.querySelector<HTMLElement>('[data-slot="mirror"]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-slot="editor"]')!.hidden).toBe(true);
    expect(root.querySelector('[data-slot="code-banner-text"]')!.textContent).toBe('Made from your blocks — read only.');
  });

  it('switching Code ↔ Blocks asks nothing and copies nothing (docs/PYTHON.md §7.6)', async () => {
    const confirm = stubConfirm(false);
    const root = start(MY_SKETCH);
    button(root, 'mode-blocks').click();
    await settle();
    expect(document.body.dataset.mode).toBe('blocks');
    panel().edit(MY_WS);
    button(root, 'mode-code').click();
    await settle();
    expect(document.body.dataset.mode).toBe('code');
    expect(editorText(root)).toBe(MY_SKETCH);
    expect(button(root, 'tab-code').getAttribute('aria-selected')).toBe('true');
    button(root, 'mode-blocks').click();
    await settle();
    expect(fingerprint(panel().getWorkspaceJson())).toBe(fingerprint(MY_WS));
    expect(confirm).not.toHaveBeenCalled();
    app!.destroy(); // flushes every save
    app = null;
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(MY_SKETCH);
    expect(fingerprint(JSON.parse(localStorage.getItem(BLOCKS_STORAGE_KEY)!))).toBe(fingerprint(MY_WS));
  });

  it('Edit a copy in Code mode copies the generated sketch, asks only for hand-written code, and Undo brings it back', async () => {
    localStorage.setItem(CODE_STORAGE_KEY, MY_SKETCH);
    const root = await startBlocks();
    panel().edit(MY_WS);
    const copy = button(root, 'copy-to-code');
    expect(copy.textContent).toBe('Edit a copy in Code mode');
    expect(copy.disabled).toBe(false);

    const refuse = stubConfirm(false);
    copy.click();
    await settle();
    expect(refuse).toHaveBeenCalledWith('Replace your Arduino code in Code mode with this sketch?\nYour current Arduino code can be brought back with Undo.');
    expect(document.body.dataset.mode).toBe('blocks');
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(MY_SKETCH);

    stubConfirm(true);
    copy.click();
    await settle();
    expect(document.body.dataset.mode).toBe('code');
    expect(editorText(root)).toBe(sketchOf(MY_WS));
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(sketchOf(MY_WS));
    expect(localStorage.getItem('z1.code.previous')).toBe(MY_SKETCH);
    expect(toastText(root)).toBe('Copied into Code mode · Undo');
    root.querySelector<HTMLButtonElement>('[data-slot="toast"] button')!.click();
    expect(editorText(root)).toBe(MY_SKETCH);
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(MY_SKETCH);

    // The copied text is not hand-written: copying again asks nothing.
    button(root, 'mode-blocks').click();
    await settle();
    copy.click();
    await settle();
    const quiet = stubConfirm(false);
    button(root, 'mode-blocks').click();
    await settle();
    copy.click();
    await settle();
    expect(quiet).not.toHaveBeenCalled();
    expect(editorText(root)).toBe(sketchOf(MY_WS));
  });

  it('Edit a copy in Code mode is off while the generator fails', async () => {
    const root = await startBlocks();
    panel().breakGenerator();
    expect(button(root, 'copy-to-code').disabled).toBe(true);
    expect(button(root, 'copy-to-code').title).toBe('The blocks could not be turned into a sketch');
  });

  it('Copy link copies the #blocks= link, and Download .ino saves the generated sketch', async () => {
    const root = await startBlocks();
    panel().edit(MY_WS);
    const downloads = catchDownloads();
    const writeText = stubClipboard();
    pick(root, 'share', 'Copy link');
    const link = writeText.mock.calls[0][0];
    const hash = link.slice(link.indexOf('#'));
    expect(hash.startsWith('#blocks=')).toBe(true);
    expect(fingerprint(blocksFromHash(hash)!)).toBe(fingerprint(MY_WS));

    pick(root, 'share', 'Download .ino');
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
    const note = dialog.querySelector<HTMLElement>('[data-role="note"]')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('This is the Arduino sketch made from your blocks (the code shown in the Code tab).');
    dialog.querySelector<HTMLButtonElement>('[data-action="download"]')!.click();
    const [file] = await downloads.files();
    expect(file.name).toMatch(SKETCH_FILE);
    expect(file.text).toBe(sketchOf(MY_WS));
  });

  it('Hand in gets the generated sketch, the workspace JSON and the example / blank facts', async () => {
    const root = await startBlocks();
    pick(root, 'share', 'Hand in to my teacher');
    expect(fake.handinOpens[0].work).toEqual({
      kind: 'blocks',
      code: sketchOf(panel().getWorkspaceJson()),
      workspaceJson: JSON.stringify(panel().getWorkspaceJson()),
      python: '',
      unchanged: { kind: 'blank' },
      errorCount: 0,
    });
    root.querySelector<HTMLDialogElement>('dialog.z1-handin')!.close();
    pickExample(root, BLINK_EXAMPLE.title);
    await settle();
    pick(root, 'share', 'Hand in to my teacher');
    expect(fake.handinOpens[1].work.unchanged).toEqual({ kind: 'example', title: BLINK_EXAMPLE.title });
    root.querySelector<HTMLDialogElement>('dialog.z1-handin')!.close();
    panel().edit(MY_WS);
    pick(root, 'share', 'Hand in to my teacher');
    expect(fake.handinOpens[2].work.unchanged).toBeNull();
    expect(fake.handinOpens[2].work.workspaceJson).toBe(JSON.stringify(panel().getWorkspaceJson()));
  });

  it('asks to wait while the blocks are still loading', async () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'blocks');
    const root = start();
    const writeText = stubClipboard();
    const downloads = catchDownloads();
    for (const item of ['Hand in to my teacher', 'Copy link', 'Download .ino']) {
      pick(root, 'share', item);
      expect(toastText(root), item).toBe('The blocks are still loading — try again in a moment');
    }
    button(root, 'ide').click();
    expect(toastText(root)).toBe('The blocks are still loading — try again in a moment');
    expect(writeText).not.toHaveBeenCalled();
    expect(await downloads.files()).toEqual([]);
    expect(root.querySelector<HTMLDialogElement>('dialog.z1-ide')!.open).toBe(false);
    expect(root.querySelector<HTMLDialogElement>('dialog.z1-handin')!.open).toBe(false);
    expect(fake.handinOpens).toEqual([]);
  });

  it('hands out the explanation comment when the blocks cannot be turned into a sketch', async () => {
    const root = await startBlocks();
    panel().edit(MY_WS);
    panel().breakGenerator();
    expect(mirrorText(root)).toBe(ERROR_SKETCH);
    const downloads = catchDownloads();

    const writeText = stubClipboard();
    pick(root, 'share', 'Copy link');
    expect(writeText.mock.calls[0][0]).toContain('#blocks=');
    pick(root, 'share', 'Download .ino');

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
    expect(mirrorText(root)).toBe(sketchOf(DEFAULT_WS));

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
