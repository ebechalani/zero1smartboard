// @vitest-environment happy-dom
/**
 * Python mode in the app (docs/PYTHON.md §7, §10.7), with the real Python chunk and translator:
 * the Code | Blocks | Python switch and `z1.mode`, the tab strip of each mode (§7.2), the Python
 * panel's note and "What works" dialog (§7.3), the paste clean-up toast (§7.4), the Code tab as
 * the read-only mirror (§7.5), each mode keeping its own program (§7.6: the three-hop path,
 * "Edit a copy in Code mode" with Undo, links), New and Examples in Python mode (§7.7), live lint
 * with X-sketch-error / W-sketch on Python lines, Run with errors and Run of example 01, the
 * console texts, the finish of a program without a main loop (§7.8), input() and print() and
 * the Serial Monitor (§7.9), the console jump by source (§7.10), Share ▾ and the downloads
 * (§7.11), the Arduino IDE and Upload payloads (§7.12), the Python hand-in, and Esc then Tab
 * leaving both editors (§7.4).
 *
 * While the translator is being built, programs it cannot translate yet get a fake translation
 * (`fake.translations`, keyed by the Python text; everything else goes to the real translator).
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
import { BLANK_PYTHON, PYTHON_EXAMPLES, SourceMap, pythonToArduino, type PythonTranslation } from '../src/python';
import { message } from '../src/python/messages';
import { PythonMode } from '../src/ui/modes/python-mode';
import type { ModeHost } from '../src/ui/modes/types';
import { transpile } from '../src/transpiler';
import { saveSession } from '../src/classroom/session-store';
import type { InstallUploadButtonOptions } from '../src/upload';
import { forEachDiagnostic } from '@codemirror/lint';
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

const fake = vi.hoisted(() => ({
  panel: null as unknown,
  handinOpens: [] as HandinWork[],
  /** Fake translations by Python text (programs the translator cannot translate yet). */
  translations: new Map<string, unknown>(),
  /** The options the app gave installUploadButton (its getSketch() is the Upload payload). */
  upload: null as unknown,
}));

// The real chunk, with fake translations for the programs listed in fake.translations.
vi.mock('../src/ui/python-chunk', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ui/python-chunk')>();
  return {
    ...original,
    pythonToArduino: (source: string) => (fake.translations.get(source) as PythonTranslation | undefined) ?? original.pythonToArduino(source),
  };
});

// The real upload button (hidden: no Web Serial here), with its options recorded.
vi.mock('../src/upload', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/upload')>();
  return {
    ...original,
    installUploadButton: (options: InstallUploadButtonOptions) => {
      fake.upload = options;
      return original.installUploadButton({ ...options, detect: async () => ({ ok: false, reason: 'no-serial', message: '' }) });
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
  fake.translations.clear();
  fake.upload = null;
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

// ---------------------------------------------------------------------------
// Fake translations (programs the translator cannot translate yet)
// ---------------------------------------------------------------------------

/** A translation of `python` into the sketch `lines` ([C++ line, Python line it was made from]). */
function fakeTranslation(python: string, lines: [string, number][], more: Partial<PythonTranslation> = {}): string {
  fake.translations.set(python, {
    ok: true,
    sketch: `${lines.map(([text]) => text).join('\n')}\n`,
    map: new SourceMap(lines.map(([, line]) => line)),
    diagnostics: [],
    endsAfterSetup: false,
    usesInput: false,
    ...more,
  } satisfies PythonTranslation);
  return python;
}

const consoleTexts = (root: HTMLElement) => consoleEntries(root).map((e) => e.querySelector('.z1-console-text')!.textContent);
const statusText = (root: HTMLElement) => root.querySelector('[data-slot="status-text"]')!.textContent;

/** The Python editor's squiggles: [line, message]. */
function pythonDiagnostics(root: HTMLElement): [number, string][] {
  const editor = view(root, 'panel-python');
  const out: [number, string][] = [];
  forEachDiagnostic(editor.state, (d, from) => out.push([editor.state.doc.lineAt(from).number, d.message]));
  return out;
}

/** Replace the Python program as a student would (the live lint follows 700 ms later). */
function setPython(root: HTMLElement, text: string): void {
  const editor = view(root, 'panel-python');
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, userEvent: 'input.type' });
}

const X_SKETCH = (m: string) => message('X-sketch-error', { message: m });

// ---------------------------------------------------------------------------
// The Python panel (§7.3) and the editor (§7.4)
// ---------------------------------------------------------------------------

describe('the Python panel (§7.3, §7.4)', () => {
  it('has the one-line note above the editor; What works opens the dialog, which keeps the global keys away from the program', async () => {
    const root = await startPython();
    const note = root.querySelector<HTMLElement>('[data-slot="panel-python"] .z1-python-note')!;
    expect(note.textContent).toBe(
      'MicroPython-style Python for the ZERO1. It becomes the Arduino sketch in the Code tab — that sketch is what runs and what goes to the board. What works · Esc then Tab: leave the editor · Ctrl+M: Tab moves focus',
    );
    expect(note.nextElementSibling!.querySelector('.cm-editor')).not.toBeNull();
    const help = button(root, 'python-help');
    expect(help.textContent).toBe('What works');
    help.click();
    const dialog = root.querySelector<HTMLDialogElement>('dialog.z1-python-help')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('h2')!.textContent).toBe('What works in ZERO1 Python');

    const run = vi.spyOn(app!, 'run');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(run).not.toHaveBeenCalled();
    dialog.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    expect(dialog.open).toBe(false);
    help.click();
    expect(root.querySelectorAll('dialog.z1-python-help')).toHaveLength(1); // made once
  });

  it('cleans up a paste from a worksheet and says so in the toast', async () => {
    const root = await startPython();
    const editor = view(root, 'panel-python');
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });
    const data = new DataTransfer();
    data.setData('text/plain', 'print(“Hi”) \n');
    editor.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    expect(pythonText(root).endsWith('print("Hi") \n')).toBe(true);
    expect(toastText(root)).toBe('Fixed 2 curly quotes and 1 invisible space (Ctrl+Z undoes it)');
  });

  it('puts the X-sketch-error text before an error in the sketch', () => {
    const mode = new PythonMode({} as ModeHost);
    expect(`${mode.mirror.errorPrefix}boom`).toBe(X_SKETCH('boom'));
  });
});

// ---------------------------------------------------------------------------
// Live lint and Run (§7.8)
// ---------------------------------------------------------------------------

describe('live lint and Run with the sketch check (§7.8)', () => {
  it('an error in the sketch made from the program is X-sketch-error on the Python line it was made from', async () => {
    const python = fakeTranslation('x = 1\ny = 2\nboom()\n', [
      ['void setup() {', 0],
      ['  foo = 1;', 3],
      ['}', 0],
      ['void loop() {', 0],
      ['}', 0],
    ]);
    const sketchError = transpile((fake.translations.get(python) as PythonTranslation).sketch);
    expect(sketchError.ok).toBe(false);
    const root = await startPython();
    setPython(root, python);
    await new Promise((r) => setTimeout(r, 800));
    const expected = X_SKETCH(sketchError.ok ? '' : sketchError.errors[0].message);
    expect(pythonDiagnostics(root)).toEqual([[3, expected]]);

    button(root, 'tab-serial').click();
    await app!.run();
    expect(consoleTexts(root)).toEqual([expected]);
    const link = consoleEntries(root)[0].querySelector<HTMLButtonElement>('.z1-console-line')!;
    expect(link.textContent).toBe('line 3');
    expect(link.getAttribute('aria-label')).toBe('Go to line 3 in the Python program');
    expect(statusText(root)).toBe('1 error');
    expect(selectedTab(root)).toBe('tab-python');
  });

  it('the program’s warnings and the sketch’s (W-sketch) are on Python lines, in the editor and in the console on Run', async () => {
    const shadow = "'max' is a Python built-in function: from here on, max() cannot be used in this program.";
    const python = fakeTranslation(
      'max = 1\ntime.sleep_ms(1.5)\n',
      [
        ['long max_2 = 1;', 1],
        ['void setup() {', 0],
        ['  delay(1.5);', 2],
        ['}', 0],
        ['void loop() {', 0],
        ['  delay(2.5);', 0], // a warning on scaffolding is left out
        ['}', 0],
      ],
      { diagnostics: [{ code: 'W-shadow', line: 1, column: 1, endLine: 1, endColumn: 4, severity: 'warning', message: shadow }] },
    );
    const root = await startPython({ python }, true);
    const sketchWarning = message('W-sketch', { warning: 'delay() takes whole milliseconds; the decimal part is ignored' });
    expect(pythonDiagnostics(root)).toEqual([
      [1, shadow],
      [2, sketchWarning],
    ]);

    const running = app!.run();
    await vi.waitFor(() => expect(consoleTexts(root)).toContain('Program started.'));
    expect(consoleTexts(root)).toEqual([shadow, sketchWarning, 'Program started.']);
    const lines = consoleEntries(root).slice(0, 2).map((e) => e.querySelector('.z1-console-line')!.getAttribute('aria-label'));
    expect(lines).toEqual(['Go to line 1 in the Python program', 'Go to line 2 in the Python program']);
    await app!.stop();
    await running;
  });

  it('says "Program started." and "Program stopped after N rounds of the while True loop."', async () => {
    const root = await startPython({}, true);
    const running = app!.run();
    await vi.waitFor(() => expect(root.querySelector('.z1-serial')!.textContent).toContain('OFF'));
    await app!.stop();
    await running;
    const texts = consoleTexts(root);
    expect(texts[0]).toBe('Program started.');
    expect(texts.at(-1)).toMatch(/^Program stopped after \d+ rounds? of the while True loop\.$/);
    expect(statusText(root)).toMatch(/^Stopped at \d+ ms$/);
  });

  it('a program without while True: finishes once no tone sounds (§7.8)', async () => {
    const python = fakeTranslation(
      'print("Hi")\nBuzzer().tone(440, 300)\n',
      [
        ['void setup() {', 0],
        ['  Serial.begin(9600);', 0],
        ['  Serial.println("Hi");', 1],
        ['  tone(8, 440, 300);', 2],
        ['}', 0],
        ['void loop() {', 0],
        ['  // The Python program has no "while True:": it has ended.', 0],
        ['}', 0],
      ],
      { endsAfterSetup: true },
    );
    const root = await startPython({ python }, true);
    await app!.run();
    expect(consoleTexts(root).at(-1)).toBe('Program finished (it has no while True loop).');
    const ms = Number(/^Finished at (\d+) ms$/.exec(statusText(root)!)?.[1]);
    expect(ms).toBeGreaterThanOrEqual(300); // the tone played to its end…
    expect(ms).toBeLessThan(1000); // …and the run ended soon after
    expect(root.querySelector('.z1-console-status')!.textContent).toBe('Finished');
    expect(root.querySelector('.z1-serial')!.textContent).toContain('Hi');
  });

  it('a program without while True: whose tone never stops finishes 2 s after its end', async () => {
    const python = fakeTranslation('Buzzer().tone(440)\n', [
      ['void setup() {', 0],
      ['  tone(8, 440);', 1],
      ['}', 0],
      ['void loop() {', 0],
      ['}', 0],
    ], { endsAfterSetup: true });
    const root = await startPython({ python }, true);
    await app!.run();
    expect(consoleTexts(root).at(-1)).toBe('Program finished (it has no while True loop).');
    const ms = Number(/^Finished at (\d+) ms$/.exec(statusText(root)!)?.[1]);
    expect(ms).toBeGreaterThanOrEqual(2000);
    expect(ms).toBeLessThan(2600);
  });
});

// ---------------------------------------------------------------------------
// print() and input() (§7.9)
// ---------------------------------------------------------------------------

describe('where print() and input() happen (§7.9)', () => {
  it('a program with input() shows the Serial Monitor with the cursor in its send box', async () => {
    const python = fakeTranslation('name = input("Name? ")\n', [
      ['void setup() {', 0],
      ['  Serial.begin(9600);', 0],
      ['}', 0],
      ['void loop() {', 0],
      ['}', 0],
    ], { usesInput: true });
    const root = await startPython({ python }, true);
    expect(selectedTab(root)).toBe('tab-python');
    const running = app!.run();
    await vi.waitFor(() => expect(selectedTab(root)).toBe('tab-serial'));
    expect(document.activeElement).toBe(root.querySelector('.z1-serial [data-role="input"]'));
    await app!.stop();
    await running;
  });

  it('the first print while the Serial Monitor is hidden brings one console hint, with a link to the tab; the tab says it has new output', async () => {
    const root = await startPython({}, true);
    const serialTab = button(root, 'tab-serial');
    const running = app!.run();
    await vi.waitFor(() => expect(consoleTexts(root)).toContain('print() output is in the Serial Monitor tab'));
    expect(serialTab.classList.contains('has-activity')).toBe(true);
    expect(serialTab.getAttribute('aria-label')).toBe('Serial Monitor, new output');
    await vi.waitFor(() => expect(root.querySelector('.z1-serial')!.textContent).toMatch(/ON[\s\S]*OFF[\s\S]*ON/));
    expect(consoleTexts(root).filter((t) => t === 'print() output is in the Serial Monitor tab')).toHaveLength(1);

    const action = root.querySelector<HTMLButtonElement>('.z1-console-action')!;
    expect(action.textContent).toBe('Open the Serial Monitor');
    action.click();
    expect(selectedTab(root)).toBe('tab-serial');
    expect(serialTab.classList.contains('has-activity')).toBe(false);
    expect(serialTab.hasAttribute('aria-label')).toBe(false);
    await app!.stop();
    await running;
  });

  it('Code mode has no print() hint', async () => {
    const root = start({ code: 'void setup() {\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  Serial.println("tick");\n  delay(100);\n}\n' }, true);
    button(root, 'tab-pinmap').click();
    const running = app!.run();
    await vi.waitFor(() => expect(root.querySelector('.z1-serial')!.textContent).toContain('tick'));
    expect(button(root, 'tab-serial').getAttribute('aria-label')).toBe('Serial Monitor, new output');
    await app!.stop();
    await running;
    expect(consoleTexts(root)[0]).toBe('Sketch started.');
    expect(consoleTexts(root)).not.toContain('print() output is in the Serial Monitor tab');
    expect(consoleTexts(root).at(-1)).toMatch(/^Sketch stopped after \d+ loop\(\) calls\.$/);
  });

  it('forces the Serial Monitor to send Newline in Python mode and gives the choice back in Code mode', async () => {
    const root = start();
    const ending = root.querySelector<HTMLSelectElement>('.z1-serial [data-role="ending"]')!;
    ending.value = 'none';
    await switchTo(root, 'python');
    expect(ending.value).toBe('newline');
    expect(ending.disabled).toBe(true);
    expect(ending.title).toBe("Python's input() reads one line: the Serial Monitor sends Newline");
    await switchTo(root, 'code');
    expect(ending.value).toBe('none');
    expect(ending.disabled).toBe(false);
    expect(ending.hasAttribute('title')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Console (§7.10)
// ---------------------------------------------------------------------------

describe('the console jumps by source (§7.10)', () => {
  it('a Python line opens the Python program also after a switch to Code mode; a sketch line opens the sketch', async () => {
    const root = await startPython({ python: BROKEN });
    await app!.run();
    const error = pythonToArduino(BROKEN).diagnostics[0];
    await switchTo(root, 'code');
    const link = consoleEntries(root)[0].querySelector<HTMLButtonElement>('.z1-console-line')!;
    expect(link.getAttribute('aria-label')).toBe(`Go to line ${error.line} in the Python program`);
    link.click();
    await pythonReady(root);
    expect(document.body.dataset.mode).toBe('python');
    expect(selectedTab(root)).toBe('tab-python');
    const python = view(root, 'panel-python');
    expect(python.state.doc.lineAt(python.state.selection.main.head).number).toBe(error.line);

    await switchTo(root, 'code');
    view(root, 'editor').dispatch({ changes: { from: 0, to: view(root, 'editor').state.doc.length, insert: 'void setup() {\n  foo = 1;\n}\nvoid loop() {}\n' } });
    await app!.run();
    const sketchLink = consoleEntries(root)[0].querySelector<HTMLButtonElement>('.z1-console-line')!;
    expect(sketchLink.getAttribute('aria-label')).toBe('Go to line 2 in the sketch');
    sketchLink.click();
    expect(document.body.dataset.mode).toBe('code');
    expect(selectedTab(root)).toBe('tab-code');
  });
});

// ---------------------------------------------------------------------------
// Share ▾, Arduino IDE, Upload (§7.11, §7.12)
// ---------------------------------------------------------------------------

describe('Share ▾ and the board in Python mode (§7.11, §7.12)', () => {
  it('lists Download .py and Download .ino in Python mode only', async () => {
    const root = start();
    expect(menuItems(root, 'share')).toEqual(['Hand in to my teacher', 'Copy link', 'Download .ino']);
    await switchTo(root, 'python');
    expect(menuItems(root, 'share')).toEqual(['Hand in to my teacher', 'Copy link', 'Download .py', 'Download .ino']);
    const item = Array.from(root.querySelectorAll<HTMLElement>('[data-slot="share"] [role="menuitem"]')).find((b) => b.textContent === 'Download .py')!;
    expect(item.title).toBe('Save the Python program (for the ZERO1 simulator)');
    await switchTo(root, 'blocks');
    expect(menuItems(root, 'share')).toEqual(['Hand in to my teacher', 'Copy link', 'Download .ino']);
  });

  it('Download .py saves the program, also with errors, as zero1_<name>_MMDD_HHMMSS.py', async () => {
    saveSession({ v: 2, code: 'BKT4M9', className: '8B Robotics', firstName: 'Ali', lastName: 'Khoury', uid: 'u1', lastUsedAt: 0, lastHandinAt: 0 });
    const root = await startPython({ python: BROKEN });
    const downloads = catchDownloads();
    pick(root, 'share', 'Download .py');
    const [file] = await downloads.files();
    expect(file.name).toMatch(/^zero1_ali_khoury_\d{4}_\d{6}\.py$/);
    expect(file.text).toBe(BROKEN);
    expect(toastText(root)).toBe(`Downloading ${file.name}`);
  });

  it('the Arduino IDE dialog says that the sketch is made from the Python program', async () => {
    const root = await startPython();
    button(root, 'ide').click();
    const note = root.querySelector<HTMLElement>('dialog.z1-ide [data-role="note"]')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('This is the Arduino sketch made from your Python program (the code in the Code tab). The board runs this sketch: it cannot run Python itself.');
  });

  it('Upload gets the sketch with the Python notes, the line map and X-sketch-error; a program with errors is refused', async () => {
    const root = await startPython();
    const options = fake.upload as InstallUploadButtonOptions;
    const payload = options.getSketch();
    if (!payload || 'error' in payload) throw new Error('no payload');
    const translation = pythonToArduino(EXAMPLE_01);
    expect(payload.code).toBe(translation.sketch);
    expect(payload.kind).toBe('python');
    expect(payload.note).toBe('This uploads the Arduino sketch made from your Python program (the code in the Code tab). The board runs this sketch: it cannot run Python itself.');
    expect(payload.successNote).toBe('Done — the program is running on the board. Its print() output: open the Arduino IDE Serial Monitor at 9600 baud.');
    expect(payload.source).toBe('python');
    const sketchLine = translation.map.sketchToPython.findIndex((line) => line > 0) + 1;
    expect(payload.mapLine!(sketchLine)).toBe(translation.map.pythonLineOf(sketchLine));
    expect(payload.sketchError!("'x' was not declared in this scope")).toBe(X_SKETCH("'x' was not declared in this scope"));

    setPython(root, BROKEN);
    expect(options.getSketch()).toEqual({ error: PYTHON_FIX_FIRST });
    await switchTo(root, 'code');
    const code = options.getSketch();
    expect(code).toEqual({ code: EXAMPLES[0].source, kind: 'code', note: undefined, successNote: undefined, mapLine: undefined, source: undefined, sketchError: undefined });
  });
});
