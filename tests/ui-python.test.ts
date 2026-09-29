// @vitest-environment happy-dom
/**
 * Python mode in the app (docs/PYTHON.md §7, §10.7), with the real Python chunk and translator:
 * the Code | Blocks | Python switch and `z1.mode`, the tab strip of each mode (§7.2), the Code tab
 * as the read-only mirror (§7.5), each mode keeping its own program (§7.6: the three-hop path,
 * "Edit a copy in Code mode" with Undo, links), New and Examples in Python mode (§7.7), Run with
 * errors and Run of example 01 (§7.8), the exports while the program has errors (§7.11, §7.12),
 * the Python hand-in, and Esc then Tab leaving both editors (§7.4).
 *
 * Blockly is never loaded: `createBlocksPanel` returns a small fake panel (as in app-header.test.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { diagnosticCount } from '@codemirror/lint';
import { TICK_COST_MS, makeBoard, settle } from './helpers';
import { VirtualClock } from '../src/runtime/clock';
import { createZero1Board } from '../src/zero1';
import { mountApp, type App } from '../src/ui/app';
import { CODE_STORAGE_KEY, encodeShareCode } from '../src/ui/editor';
import { BLOCKS_STORAGE_KEY, MODE_STORAGE_KEY, type BlocksPanel, type BlocksPanelOptions } from '../src/ui/blocks-panel';
import { PYTHON_BASELINE_STORAGE_KEY, PYTHON_FIX_FIRST, PYTHON_STORAGE_KEY } from '../src/ui/modes/python-mode';
import { CODE_PREVIOUS_STORAGE_KEY } from '../src/ui/modes/code-mode';
import { BLANK_PYTHON, PYTHON_EXAMPLES, SourceMap, pythonToArduino } from '../src/python';
import { PYTHON_PLACEHOLDER_PREFIX } from '../src/sketch/placeholder';
import { encodeSharePython } from '../src/share-link';
import { EXAMPLES } from '../src/examples';
import type { HandinWork } from '../src/ui/handin-dialog';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type FakeWorkspace = { blocks: { languageVersion: 0; blocks: { type: string; id: string }[] } };
const ws = (...types: string[]): FakeWorkspace => ({ blocks: { languageVersion: 0, blocks: types.map((type, i) => ({ type, id: `${type}-${i}` })) } });
const sketchOf = (w: object) => `// Generated from blocks: ${(w as FakeWorkspace).blocks.blocks.map((b) => b.type).join(', ')}\n\nvoid setup() {\n}\n\nvoid loop() {\n}\n`;

/** Stands in for the Blockly panel; reports every change through onChange like the real one. */
class FakePanel implements BlocksPanel {
  private w: FakeWorkspace = ws('z1_setup_hat', 'z1_loop_hat');
  constructor(private readonly options: BlocksPanelOptions) {
    this.options.onChange(this.getCode(), this.getWorkspaceJson());
  }
  getCode(): string {
    return sketchOf(this.w);
  }
  getWorkspaceJson(): object {
    return structuredClone(this.w);
  }
  loadWorkspace(json: object): void {
    const blocks = (json as Partial<FakeWorkspace>).blocks?.blocks;
    if (!Array.isArray(blocks)) throw new Error('not a workspace');
    this.w = { blocks: { languageVersion: 0, blocks } };
    this.options.onChange(this.getCode(), this.getWorkspaceJson());
  }
  clear(): void {
    this.loadWorkspace(ws('z1_setup_hat', 'z1_loop_hat'));
  }
  resize(): void {}
  destroy(): void {}
}

const fake = vi.hoisted(() => ({ panel: null as unknown, handinOpens: [] as HandinWork[] }));

vi.mock('../src/ui/blocks-panel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/blocks-panel')>()),
  createBlocksPanel: vi.fn(async (_container: HTMLElement, options: BlocksPanelOptions) => {
    const panel = new FakePanel(options);
    fake.panel = panel;
    return panel;
  }),
  loadBlockExamples: vi.fn(async () => []),
}));

vi.mock('../src/classroom/firebase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/classroom/firebase')>()),
  isClassroomConfigured: () => true,
}));

// The real dialog over a StudentApi that never answers; open() is recorded.
vi.mock('../src/ui/handin-dialog', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ui/handin-dialog')>();
  const api = { restore: async () => null } as unknown as import('../src/classroom/student').StudentApi;
  return {
    ...original,
    createHandinDialog: (parent: HTMLElement, options?: import('../src/ui/handin-dialog').HandinDialogOptions) => {
      const dialog = original.createHandinDialog(parent, { ...options, loadApi: async () => api });
      const open = dialog.open;
      dialog.open = (work, opts) => {
        fake.handinOpens.push(work);
        open(work, opts);
      };
      return dialog;
    },
  };
});

// ---------------------------------------------------------------------------
// Mounting & helpers
// ---------------------------------------------------------------------------

const MY_SKETCH = 'void setup() {\n  pinMode(A1, OUTPUT);\n}\n\nvoid loop() {\n  // my own work\n}\n';
const EXAMPLE_01 = PYTHON_EXAMPLES[0].python;
/** A Python program with a syntax error (the colon after `while True` is missing). */
const BROKEN = 'from machine import Pin\n\nwhile True\n    pass\n';
const SKETCH_FILE = /^zero1_\d{4}_\d{6}\.ino$/;

let app: App | null = null;

afterEach(() => {
  app?.destroy();
  app = null;
  fake.panel = null;
  fake.handinOpens = [];
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  location.hash = '';
  Reflect.deleteProperty(window, 'confirm');
  vi.restoreAllMocks();
});

/**
 * A virtual clock that lets the event loop run every 500 ticks, so that a sketch that loops
 * forever does not starve the test's own timers (VirtualClock alone only yields microtasks).
 */
class SteppingClock extends VirtualClock {
  private ticks = 0;
  override async yield(): Promise<void> {
    await super.yield();
    if (++this.ticks % 500 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function start(saved: { code?: string; python?: string; mode?: string } = {}, stepping = false): HTMLElement {
  if (saved.code !== undefined) localStorage.setItem(CODE_STORAGE_KEY, saved.code);
  if (saved.python !== undefined) localStorage.setItem(PYTHON_STORAGE_KEY, saved.python);
  if (saved.mode !== undefined) localStorage.setItem(MODE_STORAGE_KEY, saved.mode);
  const root = document.createElement('div');
  document.body.appendChild(root);
  if (stepping) {
    const clock = new SteppingClock({ yieldCostMs: TICK_COST_MS });
    app = mountApp(root, createZero1Board(clock), clock);
  } else {
    const { board, clock } = makeBoard();
    app = mountApp(root, board, clock);
  }
  return root;
}

/** Mount in Python mode and wait for the Python chunk and editor. */
async function startPython(saved: { code?: string; python?: string } = {}, stepping = false): Promise<HTMLElement> {
  const root = start({ ...saved, mode: 'python' }, stepping);
  await pythonReady(root);
  return root;
}

async function pythonReady(root: HTMLElement): Promise<void> {
  await vi.waitFor(() => expect(root.querySelector('[data-slot="panel-python"] .cm-editor')).not.toBeNull(), { timeout: 10_000 });
  await settle();
}

const view = (root: HTMLElement, host: 'editor' | 'mirror' | 'panel-python'): EditorView =>
  EditorView.findFromDOM(root.querySelector<HTMLElement>(`[data-slot="${host}"] .cm-editor`)!)!;
const codeText = (root: HTMLElement) => view(root, 'editor').state.doc.toString();
const mirrorText = (root: HTMLElement) => view(root, 'mirror').state.doc.toString();
const pythonText = (root: HTMLElement) => view(root, 'panel-python').state.doc.toString();
const button = (root: HTMLElement, slot: string) => root.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)!;
const toastText = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-slot="toast"]')!.textContent ?? '';
const selectedTab = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!.dataset.slot;
const visibleTabs = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]:not([hidden])'), (t) => t.dataset.slot);
const consoleEntries = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.z1-console-entry'));

/** Type at the start of an editor, as a student would. */
function type(target: EditorView, text: string): void {
  target.dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type' });
}

function stubConfirm(answer: boolean) {
  const confirm = vi.fn((_message?: string) => answer);
  window.confirm = confirm;
  return confirm;
}

async function switchTo(root: HTMLElement, mode: 'code' | 'blocks' | 'python'): Promise<void> {
  button(root, `mode-${mode}`).click();
  if (mode === 'python') await pythonReady(root);
  else await settle();
}

function pick(root: HTMLElement, slot: string, label: string): void {
  root.querySelector<HTMLButtonElement>(`[data-slot="${slot}"] > button`)!.click();
  const item = Array.from(root.querySelectorAll<HTMLButtonElement>(`[data-slot="${slot}"] .z1-menu-item`)).find((b) => b.textContent === label);
  expect(item, label).toBeDefined();
  item!.click();
}

function menuItems(root: HTMLElement, slot: string): string[] {
  return Array.from(root.querySelectorAll(`[data-slot="${slot}"] [role="menuitem"]`), (b) => b.textContent ?? '');
}

function hashChange(hash: string): void {
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

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
  return { files: () => Promise.all(clicks.map(async (c) => ({ name: c.name, text: await blobs.get(c.href)!.text() }))) };
}

// ---------------------------------------------------------------------------
// Mode switch and tabs
// ---------------------------------------------------------------------------

describe('mode switch', () => {
  it('has three mode buttons; Python is remembered in z1.mode and an unknown value opens Code mode', async () => {
    let root = start();
    const modes = Array.from(root.querySelectorAll<HTMLButtonElement>('.z1-mode .z1-mode-btn'));
    expect(modes.map((b) => [b.dataset.slot, b.textContent])).toEqual([
      ['mode-code', 'Code'],
      ['mode-blocks', 'Blocks'],
      ['mode-python', 'Python'],
    ]);
    expect(button(root, 'mode-python').title).toBe('Write the program in Python (MicroPython style)');
    expect(modes.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);

    await switchTo(root, 'python');
    expect(document.body.dataset.mode).toBe('python');
    expect(modes.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('python');
    expect(toastText(root)).toBe('Python mode');

    app!.destroy();
    document.body.innerHTML = '';
    root = start();
    await pythonReady(root);
    expect(document.body.dataset.mode).toBe('python');
    expect(button(root, 'mode-python').getAttribute('aria-pressed')).toBe('true');

    app!.destroy();
    document.body.innerHTML = '';
    root = start({ mode: 'pyth0n' });
    expect(document.body.dataset.mode).toBe('code');
    expect(button(root, 'mode-code').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the tab strip of each mode, with the Python tab just before Generated JS (§7.2, D1)', async () => {
    const root = start();
    expect(visibleTabs(root)).toEqual(['tab-code', 'tab-serial', 'tab-pinmap', 'tab-js']);
    expect(selectedTab(root)).toBe('tab-code');

    await switchTo(root, 'blocks');
    expect(visibleTabs(root)).toEqual(['tab-blocks', 'tab-code', 'tab-serial', 'tab-pinmap', 'tab-js']);
    expect(selectedTab(root)).toBe('tab-blocks');
    expect(button(root, 'tab-code').getAttribute('aria-label')).toBe('Code (read only)');

    await switchTo(root, 'python');
    expect(visibleTabs(root)).toEqual(['tab-code', 'tab-serial', 'tab-pinmap', 'tab-python', 'tab-js']);
    expect(selectedTab(root)).toBe('tab-python');
    expect(button(root, 'tab-python').textContent).toBe('Python');
    const codeTab = button(root, 'tab-code');
    expect(codeTab.getAttribute('aria-label')).toBe('Code (read only)');
    expect(root.querySelector<HTMLElement>('[data-slot="code-lock"]')!.hidden).toBe(false);
    expect(root.querySelector('[data-slot="code-lock"] svg')).not.toBeNull();

    // Arrow keys move over the visible tabs only.
    button(root, 'tab-pinmap').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(selectedTab(root)).toBe('tab-python');
    button(root, 'tab-python').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(selectedTab(root)).toBe('tab-js');
    button(root, 'tab-js').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(selectedTab(root)).toBe('tab-code');

    await switchTo(root, 'code');
    expect(visibleTabs(root)).toEqual(['tab-code', 'tab-serial', 'tab-pinmap', 'tab-js']);
    expect(codeTab.hasAttribute('aria-label')).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-slot="code-lock"]')!.hidden).toBe(true);
  });

  it('names the program in the header in Python mode (§7.14)', async () => {
    const root = await startPython();
    expect(button(root, 'run').getAttribute('aria-label')).toBe('Run the program (Ctrl+Enter)');
    expect(button(root, 'stop').getAttribute('aria-label')).toBe('Stop the program (Esc)');
    expect(button(root, 'new').getAttribute('aria-label')).toBe('Start a new blank Python program');
    expect(button(root, 'new').title).toBe('New blank Python program');
    expect(button(root, 'ide').getAttribute('aria-label')).toBe('Open the sketch made from this program in the Arduino IDE');
    expect(button(root, 'upload').getAttribute('aria-label')).toBe('Upload the sketch made from this program to the ZERO1 board');
    await switchTo(root, 'code');
    expect(button(root, 'run').getAttribute('aria-label')).toBe('Run the sketch (Ctrl+Enter)');
    expect(button(root, 'new').getAttribute('aria-label')).toBe('Start a new blank sketch');
  });
});

// ---------------------------------------------------------------------------
// The Code tab in Python mode
// ---------------------------------------------------------------------------

describe('the Code tab in Python mode (§7.5)', () => {
  it('shows the sketch made from the program, read-only but focusable and labelled; typing says where to edit', async () => {
    const root = await startPython();
    expect(pythonText(root)).toBe(EXAMPLE_01);
    expect(mirrorText(root)).toBe(pythonToArduino(EXAMPLE_01).sketch);
    expect(root.querySelector('[data-slot="code-banner-text"]')!.textContent).toBe('Made from your Python program — read only.');
    expect(root.querySelector<HTMLElement>('[data-slot="editor"]')!.hidden).toBe(true);

    const mirror = view(root, 'mirror');
    expect(mirror.state.readOnly).toBe(true);
    expect(mirror.contentDOM.getAttribute('contenteditable')).toBe('true'); // focusable, selectable
    expect(mirror.contentDOM.getAttribute('aria-readonly')).toBe('true');
    expect(mirror.contentDOM.getAttribute('aria-label')).toBe('Arduino sketch made from your Python (read only)');
    expect(view(root, 'editor').contentDOM.getAttribute('aria-label')).toBe('Arduino sketch');
    expect(view(root, 'panel-python').contentDOM.getAttribute('aria-label')).toBe('Python program');

    mirror.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    expect(toastText(root)).toBe('This sketch is made from your Python — edit it in the Python tab');
    expect(mirrorText(root)).toBe(pythonToArduino(EXAMPLE_01).sketch);

    await switchTo(root, 'blocks');
    expect(view(root, 'mirror').contentDOM.getAttribute('aria-label')).toBe('Arduino sketch made from your blocks (read only)');
    view(root, 'mirror').contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    expect(toastText(root)).toBe('This sketch is made from your blocks — change the blocks');
  });

  it('follows the Python editor after the live-lint delay, with the placeholder while there are errors', async () => {
    const root = await startPython();
    type(view(root, 'panel-python'), 'while True\n'); // a syntax error on line 1
    await new Promise((r) => setTimeout(r, 500));
    expect(mirrorText(root)).toBe(pythonToArduino(EXAMPLE_01).sketch); // not before the delay
    await new Promise((r) => setTimeout(r, 300));
    expect(mirrorText(root).startsWith(PYTHON_PLACEHOLDER_PREFIX)).toBe(true);
    expect(diagnosticCount(view(root, 'panel-python').state)).toBeGreaterThan(0);
    expect(button(root, 'copy-to-code').disabled).toBe(true);
    expect(button(root, 'copy-to-code').title).toBe('Fix the errors in your Python program first');
    // The placeholder is no sketch: the mirror's own check does not underline it.
    await new Promise((r) => setTimeout(r, 800));
    expect(diagnosticCount(view(root, 'mirror').state)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Each mode keeps its own program (§7.6)
// ---------------------------------------------------------------------------

describe('each mode keeps its own program (§7.6)', () => {
  it('Code (hand-written) → Blocks → Python → Code keeps z1.code byte for byte, also after the update prompt and pagehide', async () => {
    const confirm = stubConfirm(false);
    const root = start({ code: MY_SKETCH });
    await switchTo(root, 'blocks');
    (fake.panel as FakePanel).loadWorkspace(ws('z1_setup_hat', 'z1_loop_hat', 'z1_led_set'));
    await switchTo(root, 'python');
    type(view(root, 'panel-python'), '# mine\n');
    await switchTo(root, 'code');
    expect(codeText(root)).toBe(MY_SKETCH);
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(MY_SKETCH);

    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })); // the update prompt flushes every mode
    expect(button(root, 'update').hidden).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(MY_SKETCH);
    expect(localStorage.getItem(PYTHON_STORAGE_KEY)).toBe(`# mine\n${EXAMPLE_01}`);
    expect(JSON.parse(localStorage.getItem(BLOCKS_STORAGE_KEY)!).blocks.blocks).toHaveLength(3);
    app!.destroy();
    app = null;
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(MY_SKETCH);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Edit a copy in Code mode asks nothing when the Code editor is untouched', async () => {
    const confirm = stubConfirm(false);
    const root = await startPython(); // z1.code: none, so Code mode holds example 01 untouched
    button(root, 'copy-to-code').click();
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(document.body.dataset.mode).toBe('code');
    const sketch = pythonToArduino(EXAMPLE_01).sketch;
    expect(codeText(root)).toBe(sketch);
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(sketch);
    expect(localStorage.getItem(CODE_PREVIOUS_STORAGE_KEY)).toBe(EXAMPLES[0].source);
    expect(toastText(root)).toBe('Copied into Code mode · Undo');
    expect(pythonText(root)).toBe(EXAMPLE_01); // the Python program stays
  });

  it('Edit a copy in Code mode confirms before replacing hand-written code, and Undo brings it back', async () => {
    const root = await startPython({ code: MY_SKETCH });
    const refuse = stubConfirm(false);
    button(root, 'copy-to-code').click();
    await settle();
    expect(refuse).toHaveBeenCalledWith('Replace your Arduino code in Code mode with this sketch?\nYour current Arduino code can be brought back with Undo.');
    expect(document.body.dataset.mode).toBe('python');
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(MY_SKETCH);

    stubConfirm(true);
    button(root, 'copy-to-code').click();
    await settle();
    expect(document.body.dataset.mode).toBe('code');
    expect(codeText(root)).toBe(pythonToArduino(EXAMPLE_01).sketch);
    expect(localStorage.getItem(CODE_PREVIOUS_STORAGE_KEY)).toBe(MY_SKETCH);
    const undo = root.querySelector<HTMLButtonElement>('[data-slot="toast"] button')!;
    expect(undo.textContent).toBe('Undo');
    undo.click();
    expect(codeText(root)).toBe(MY_SKETCH);
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(MY_SKETCH);
    expect(root.querySelector<HTMLElement>('[data-slot="toast"]')!.hidden).toBe(true);
  });

  it('Edit a copy in Code mode is off while the Python program has errors', async () => {
    const root = await startPython({ python: BROKEN });
    const copy = button(root, 'copy-to-code');
    expect(copy.disabled).toBe(true);
    expect(copy.title).toBe('Fix the errors in your Python program first');
    expect(mirrorText(root).startsWith(PYTHON_PLACEHOLDER_PREFIX)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Links (§7.6)
// ---------------------------------------------------------------------------

describe('share links', () => {
  it('#code= in Python mode switches to Code mode and asks only when z1.code is hand-written', async () => {
    const confirm = stubConfirm(false);
    const root = await startPython();
    hashChange(`#code=${encodeShareCode(MY_SKETCH)}`);
    await settle();
    expect(confirm).not.toHaveBeenCalled(); // Code mode held example 01, untouched
    expect(document.body.dataset.mode).toBe('code');
    expect(codeText(root)).toBe(MY_SKETCH);

    type(view(root, 'editor'), '// changed\n');
    await switchTo(root, 'python');
    hashChange(`#code=${encodeShareCode('void setup() {}\nvoid loop() {}\n')}`);
    await settle();
    expect(confirm).toHaveBeenCalledWith('Load the sketch from this link?\nYour current code will be lost.');
    expect(document.body.dataset.mode).toBe('python');
    expect(codeText(root)).toBe(`// changed\n${MY_SKETCH}`);
  });

  it('#python= opens Python mode at start-up; later links ask only when the Python program is not untouched', async () => {
    const first = 'import time\n\nwhile True:\n    time.sleep(1)\n';
    location.hash = `#python=${encodeSharePython(first)}`;
    const root = start({ code: MY_SKETCH });
    await pythonReady(root);
    expect(location.hash).toBe('');
    expect(document.body.dataset.mode).toBe('python');
    expect(pythonText(root)).toBe(first);
    expect(localStorage.getItem(PYTHON_STORAGE_KEY)).toBe(first);
    expect(localStorage.getItem(PYTHON_BASELINE_STORAGE_KEY)).toBe(first);
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(MY_SKETCH);

    const confirm = stubConfirm(false);
    const second = 'print("Hi")\n';
    hashChange(`#python=${encodeSharePython(second)}`);
    await settle();
    expect(confirm).not.toHaveBeenCalled(); // the last loaded program is untouched
    expect(pythonText(root)).toBe(second);
    expect(toastText(root)).toBe('Python program loaded from the link');

    type(view(root, 'panel-python'), '# edited\n');
    await switchTo(root, 'code');
    hashChange(`#python=${encodeSharePython(first)}`);
    await settle();
    expect(confirm).toHaveBeenCalledWith('Load the Python program from this link?\nYour current Python program will be lost.');
    expect(document.body.dataset.mode).toBe('code');
    expect(pythonText(root)).toBe(`# edited\n${second}`);

    stubConfirm(true);
    hashChange(`#python=${encodeSharePython(first)}`);
    await settle();
    expect(document.body.dataset.mode).toBe('python');
    expect(selectedTab(root)).toBe('tab-python');
    expect(pythonText(root)).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// New and Examples (§7.7)
// ---------------------------------------------------------------------------

describe('New and Examples in Python mode (§7.7)', () => {
  it('first entry shows example 01 untouched; New puts the blank program, asking only when work would be lost', async () => {
    const root = await startPython();
    expect(pythonText(root)).toBe(EXAMPLE_01);
    expect(localStorage.getItem(PYTHON_STORAGE_KEY)).toBeNull(); // nothing typed yet

    const confirm = stubConfirm(false);
    button(root, 'new').click();
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(pythonText(root)).toBe(BLANK_PYTHON);
    expect(localStorage.getItem(PYTHON_STORAGE_KEY)).toBe(BLANK_PYTHON);
    expect(toastText(root)).toBe('New blank Python program');
    expect(selectedTab(root)).toBe('tab-python');

    type(view(root, 'panel-python'), 'x = 1\n');
    button(root, 'new').click();
    await settle();
    expect(confirm).toHaveBeenCalledWith('Start a new blank program?\nYour current Python program will be lost.');
    expect(pythonText(root)).toBe(`x = 1\n${BLANK_PYTHON}`);
    expect(codeText(root)).toBe(EXAMPLES[0].source); // New never touches another mode's program
  });

  it('lists the Python examples and loads them into the Python editor, never the C++ one', async () => {
    const root = await startPython();
    expect(menuItems(root, 'examples')).toEqual(PYTHON_EXAMPLES.map((e) => e.title));
    button(root, 'new').click();
    await settle();
    button(root, 'tab-serial').click();

    const confirm = stubConfirm(false);
    pick(root, 'examples', PYTHON_EXAMPLES[0].title);
    await settle();
    expect(confirm).not.toHaveBeenCalled(); // the blank program: nothing to lose
    expect(pythonText(root)).toBe(EXAMPLE_01);
    expect(codeText(root)).toBe(EXAMPLES[0].source);
    expect(toastText(root)).toBe(`Loaded example: ${PYTHON_EXAMPLES[0].title}`);
    expect(selectedTab(root)).toBe('tab-python');

    type(view(root, 'panel-python'), '# mine\n');
    pick(root, 'examples', PYTHON_EXAMPLES[0].title);
    await settle();
    expect(confirm).toHaveBeenCalledWith(`Replace your Python program with the example "${PYTHON_EXAMPLES[0].title}"?\nYour current Python program will be lost.`);

    await switchTo(root, 'code');
    expect(menuItems(root, 'examples').sort()).toEqual(EXAMPLES.map((e) => e.title).sort());
  });
});

// ---------------------------------------------------------------------------
// Run (§7.8)
// ---------------------------------------------------------------------------

describe('Run in Python mode (§7.8)', () => {
  it('a program with errors: Python lines in the console, "N errors" in the header, the Python tab and the cursor on the first error', async () => {
    const root = await startPython({ python: BROKEN });
    const expected = pythonToArduino(BROKEN).diagnostics;
    const errors = expected.filter((d) => d.severity === 'error');
    button(root, 'tab-serial').click();
    await app!.run();
    const entries = consoleEntries(root);
    expect(entries.map((e) => e.querySelector('.z1-console-text')!.textContent)).toEqual(expected.map((d) => d.message));
    expect(entries[0].querySelector('.z1-console-line')!.textContent).toBe(`line ${errors[0].line}`);
    const count = `${errors.length} error${errors.length === 1 ? '' : 's'}`;
    expect(root.querySelector('[data-slot="status-text"]')!.textContent).toBe(count);
    expect(root.querySelector('.z1-console-status')!.textContent).toBe(`${count} — fix and run again`);
    expect(selectedTab(root)).toBe('tab-python');
    const python = view(root, 'panel-python');
    expect(python.state.doc.lineAt(python.state.selection.main.head).number).toBe(errors[0].line);

    // The console's "line N" goes back to the Python editor, not the sketch.
    python.dispatch({ selection: { anchor: python.state.doc.length } });
    button(root, 'tab-code').click();
    entries[0].querySelector<HTMLButtonElement>('.z1-console-line')!.click();
    expect(selectedTab(root)).toBe('tab-python');
    expect(python.state.doc.lineAt(python.state.selection.main.head).number).toBe(errors[0].line);
  });

  it('example 01 runs the sketch made from it, with the line map composed through the source map', async () => {
    const compose = vi.spyOn(SourceMap.prototype, 'composeJsLineMap');
    const root = await startPython({}, true);
    const running = app!.run();
    await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-slot="status"]')!.dataset.status).toBe('running'));
    expect(compose).toHaveBeenCalledTimes(1);
    expect(button(root, 'run').getAttribute('aria-label')).toBe('Restart the program (Ctrl+Enter)');
    await vi.waitFor(() => expect(root.querySelector('.z1-serial')!.textContent).toContain('ON'));
    await app!.stop();
    await running;
    expect(mirrorText(root)).toBe(pythonToArduino(EXAMPLE_01).sketch);
    button(root, 'tab-js').click();
    expect(root.querySelector('[data-slot="js-code"]')!.textContent).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// Exports and hand-in (§7.11, §7.12, §8.3)
// ---------------------------------------------------------------------------

describe('exports in Python mode', () => {
  it('Copy link works with errors; Download .ino and the Arduino IDE refuse a program with errors', async () => {
    const root = await startPython({ python: BROKEN });
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const downloads = catchDownloads();
    pick(root, 'share', 'Copy link');
    expect(writeText.mock.calls[0][0].endsWith(`#python=${encodeSharePython(BROKEN)}`)).toBe(true);

    pick(root, 'share', 'Download .ino');
    expect(toastText(root)).toBe(PYTHON_FIX_FIRST);
    button(root, 'ide').click();
    expect(toastText(root)).toBe(PYTHON_FIX_FIRST);
    expect(root.querySelector<HTMLDialogElement>('dialog.z1-ide')!.open).toBe(false);
    expect(await downloads.files()).toEqual([]);
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('Download .ino and the Arduino IDE get the sketch made from a program without errors', async () => {
    const root = await startPython();
    const downloads = catchDownloads();
    pick(root, 'share', 'Download .ino');
    button(root, 'ide').click();
    expect(root.querySelector<HTMLDialogElement>('dialog.z1-ide')!.open).toBe(true);
    const [file] = await downloads.files();
    expect(file.name).toMatch(SKETCH_FILE);
    expect(file.text).toBe(pythonToArduino(EXAMPLE_01).sketch);
  });

  it('Hand in carries the Python program with its sketch, the untouched example and the Python error count', async () => {
    const root = await startPython();
    pick(root, 'share', 'Hand in to my teacher');
    expect(fake.handinOpens[0]).toEqual({
      kind: 'python',
      code: pythonToArduino(EXAMPLE_01).sketch,
      workspaceJson: '',
      python: EXAMPLE_01,
      unchanged: { kind: 'example', title: PYTHON_EXAMPLES[0].title },
      errorCount: 0,
    });
    root.querySelector<HTMLDialogElement>('dialog.z1-handin')!.close();

    view(root, 'panel-python').dispatch({ changes: { from: 0, to: view(root, 'panel-python').state.doc.length, insert: BROKEN } });
    pick(root, 'share', 'Hand in to my teacher');
    const work = fake.handinOpens[1];
    const errors = pythonToArduino(BROKEN).diagnostics.filter((d) => d.severity === 'error').length;
    expect(work.kind).toBe('python');
    expect(work.python).toBe(BROKEN);
    expect(work.code.startsWith(PYTHON_PLACEHOLDER_PREFIX)).toBe(true);
    expect(work.errorCount).toBe(errors);
    expect(work.unchanged).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Keyboard (§7.4)
// ---------------------------------------------------------------------------

describe('Esc then Tab leaves the editor (§7.4, WCAG 2.1.2)', () => {
  const press = (target: EditorView, key: string, keyCode: number): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit);
    target.contentDOM.dispatchEvent(event);
    return event;
  };

  it('in the sketch editor and in the Python editor, Esc stops the run and the next Tab is left to the browser', async () => {
    const root = await startPython();
    const stop = vi.spyOn(app!, 'stop').mockResolvedValue(undefined);
    for (const host of ['editor', 'panel-python'] as const) {
      const editor = view(root, host);
      const before = editor.state.doc.toString();
      expect(press(editor, 'Tab', 9).defaultPrevented, host).toBe(true); // Tab indents…
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: before } });
      expect(press(editor, 'Escape', 27).defaultPrevented, host).toBe(true);
      expect(press(editor, 'Tab', 9).defaultPrevented, host).toBe(false); // …but right after Esc the focus moves on
      expect(editor.state.doc.toString(), host).toBe(before);
    }
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
