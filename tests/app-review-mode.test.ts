// @vitest-environment happy-dom
/**
 * Review mode tests (happy-dom, docs/CLASSROOM.md §7.3, docs/PYTHON.md §7.13): the simulator
 * inside review.html's sandbox. `self.origin` is stubbed to 'null' and `location.hash` to
 * '#review'; Storage is spied so that no access at all is allowed. Blockly is never loaded: a
 * small fake panel stands in (as in app-header.test.ts). Python hand-ins use the real Python
 * chunk and translator (one test makes its download fail).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { TICK_COST_MS, makeBoard, settle } from './helpers';
import { isReviewFrame, mountApp, type App } from '../src/ui/app';
import { MODE_STORAGE_KEY, type BlocksPanel, type BlocksPanelOptions } from '../src/ui/blocks-panel';
import { CODE_STORAGE_KEY } from '../src/ui/editor';
import { PYTHON_REVIEW } from '../src/ui/modes/python-mode';
import { PYTHON_EXAMPLES, pythonToArduino } from '../src/python';
import { VirtualClock } from '../src/runtime/clock';
import { createZero1Board } from '../src/zero1';

type FakeWorkspace = { blocks: { languageVersion: 0; blocks: { type: string; id: string }[] } };
const ws = (...types: string[]): FakeWorkspace => ({ blocks: { languageVersion: 0, blocks: types.map((type, i) => ({ type, id: `${type}-${i}` })) } });
const sketchOf = (w: object) => `// Generated from blocks: ${(w as FakeWorkspace).blocks.blocks.map((b) => b.type).join(', ')}\n\nvoid setup() {\n}\n\nvoid loop() {\n}\n`;

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
  clear(): void {}
  resize(): void {}
  destroy(): void {}
}

const fake = vi.hoisted(() => ({ panel: null as unknown, panelFails: false }));

vi.mock('../src/ui/blocks-panel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/blocks-panel')>()),
  createBlocksPanel: vi.fn(async (_container: HTMLElement, options: BlocksPanelOptions) => {
    if (fake.panelFails) throw new TypeError('Failed to fetch dynamically imported module: blocks.js');
    const panel = new FakePanel(options);
    fake.panel = panel;
    return panel;
  }),
  loadBlockExamples: vi.fn(async () => []),
}));

const MY_SKETCH = 'void setup() {\n  pinMode(A1, OUTPUT);\n}\n\nvoid loop() {\n  // reviewed\n}\n';
const ORIGIN = new URL(location.href).origin;

let app: App | null = null;
let storageCalls: string[] = [];

/** Every Storage method counted; review mode must never call one. */
function spyStorage(): void {
  for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
    vi.spyOn(Storage.prototype, method).mockImplementation(function (this: Storage, ...args: unknown[]) {
      storageCalls.push(`${method}(${args.map(String).join(', ')})`);
      return null as never;
    });
  }
}

function sandbox(): void {
  Object.defineProperty(window, 'origin', { value: 'null', configurable: true });
  location.hash = '#review';
}

/**
 * A virtual clock that lets the event loop run every 500 ticks, so that a running sketch does
 * not starve the test's own timers (VirtualClock alone only yields microtasks).
 */
class SteppingClock extends VirtualClock {
  private ticks = 0;
  override async yield(): Promise<void> {
    await super.yield();
    if (++this.ticks % 500 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function start(stepping = false): HTMLElement {
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

const view = (root: HTMLElement, host: 'editor' | 'mirror' | 'panel-python') => EditorView.findFromDOM(root.querySelector<HTMLElement>(`[data-slot="${host}"] .cm-editor`)!)!;
const editorText = (root: HTMLElement) => view(root, 'editor').state.doc.toString();
const mirrorText = (root: HTMLElement) => view(root, 'mirror').state.doc.toString();
const slot = <T extends HTMLElement = HTMLElement>(root: HTMLElement, name: string) => root.querySelector<T>(`[data-slot="${name}"]`)!;

/** A message as the review page sends it (source = the parent window, the site's origin). */
function post(data: unknown, init: Partial<MessageEventInit> = {}): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin: ORIGIN, source: window.parent, ...init }));
}

beforeEach(() => {
  storageCalls = [];
});

afterEach(() => {
  app?.destroy();
  app = null;
  fake.panel = null;
  fake.panelFails = false;
  vi.doUnmock('../src/ui/python-chunk');
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'origin');
  location.hash = '';
  localStorage.clear();
});

describe('review mode', () => {
  it('is on only for #review inside an opaque origin', () => {
    expect(isReviewFrame()).toBe(false);
    location.hash = '#review';
    expect(isReviewFrame()).toBe(false);
    sandbox();
    expect(isReviewFrame()).toBe(true);
  });

  it('touches no storage at all, announces itself to the parent and hides New, Examples, Share (with Hand in) and Arduino IDE', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'blocks');
    localStorage.setItem(CODE_STORAGE_KEY, 'void setup() { /* saved */ }');
    sandbox();
    spyStorage();
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const root = start();
    expect(storageCalls).toEqual([]);
    expect(postMessage).toHaveBeenCalledWith({ type: 'z1-review-ready' }, '*');
    expect(document.body.dataset.mode).toBe('code'); // not the saved Blocks mode: storage was never read
    expect(editorText(root)).toBe('');
    for (const name of ['examples', 'share', 'ide']) expect(slot(root, name).hidden, name).toBe(true); // "＋ New ▾" holds New and the examples
    expect(root.querySelector('dialog.z1-handin')).toBeNull();
    expect(Array.from(root.querySelectorAll('[data-slot="share"] [role="menuitem"]'), (b) => b.textContent)).toEqual(['Copy link', 'Download .ino']);
    // The Settings menu (Reset the board, Board settings…, About…) stays: the teacher may reset and rewire the board.
    for (const name of ['run', 'settings', 'mode-code', 'mode-blocks', 'mode-python']) expect(slot(root, name).hidden, name).toBe(false);
    expect(slot(root, 'upload').hidden).toBe(true); // no upload from a hand-in
    expect(slot(root, 'copy-to-code').hidden).toBe(true); // a copy would write z1.code
    expect(Array.from(root.querySelectorAll('[data-slot="settings"] [role="menuitem"]'), (b) => b.textContent)).toEqual(['Reset the board', 'Board settings…', 'About…']);
    // About stays, without a link: the sandbox has no allow-popups (a link would do nothing)
    const about = root.querySelector<HTMLDialogElement>('dialog.z1-about')!;
    expect(about.querySelector('a')).toBeNull();
    expect(about.textContent).toContain('THIRD_PARTY_NOTICES.md');
    expect(about.textContent).toContain('All rights reserved.');
    expect(location.hash).toBe('#review'); // the hash is not a share link and stays
  });

  it('shows the sketch from the payload, without running it and without saving it', async () => {
    sandbox();
    spyStorage();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const root = start();
    const run = vi.spyOn(app!, 'run');
    post({ type: 'z1-review', payload: { v: 1, kind: 'code', code: MY_SKETCH, workspaceJson: '', who: 'ali.k', className: '8B', task: '', title: '', at: 0 } });
    await settle();
    expect(editorText(root)).toBe(MY_SKETCH);
    expect(document.body.dataset.mode).toBe('code');
    expect(slot(root, 'code-banner').hidden).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(slot(root, 'status').dataset.status).toBe('idle');
    // Editing in the frame changes nothing outside it.
    EditorView.findFromDOM(root.querySelector<HTMLElement>('[data-slot="editor"] .cm-editor')!)!.dispatch({ changes: { from: 0, insert: '// note\n' } });
    await new Promise((r) => setTimeout(r, 600));
    app!.destroy();
    app = null;
    expect(storageCalls).toEqual([]);
  });

  it('takes Blocks mode from the payload and loads the workspace, falling back to the sketch with the banner', async () => {
    sandbox();
    spyStorage();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const root = start();
    const blocks = ws('z1_setup_hat', 'z1_loop_hat', 'z1_led_set');
    post({ type: 'z1-review', payload: { v: 1, kind: 'blocks', code: sketchOf(blocks), workspaceJson: JSON.stringify(blocks), who: 'ali.k', className: '8B', task: '', title: '', at: 0 } });
    await settle();
    expect(document.body.dataset.mode).toBe('blocks');
    expect(fake.panel).not.toBeNull();
    expect((fake.panel as FakePanel).getWorkspaceJson()).toEqual(blocks);
    expect(mirrorText(root)).toBe(sketchOf(blocks));
    // The Code tab speaks to the teacher, not to the student ("Made from your blocks").
    expect(slot(root, 'code-banner-text').textContent).toBe("Made from the student's blocks.");
    expect(storageCalls).toEqual([]);

    // A workspace that cannot be read: the generated sketch in Code mode, with the "made from blocks" banner.
    app!.destroy();
    app = null;
    document.body.innerHTML = '';
    const again = start();
    post({ type: 'z1-review', payload: { v: 1, kind: 'blocks', code: MY_SKETCH, workspaceJson: 'not json', who: 'x', className: '', task: '', title: '', at: 0 } });
    await settle();
    expect(document.body.dataset.mode).toBe('code');
    expect(editorText(again)).toBe(MY_SKETCH);
    expect(slot(again, 'code-banner').hidden).toBe(false);
    expect(slot(again, 'code-banner-text').textContent).toBe("Made from the student's blocks.");
    expect(storageCalls).toEqual([]);
  });

  it('shows a Python hand-in in Python mode: the program read-only, its sketch in the Code tab, nothing run or saved (docs/PYTHON.md §7.13)', async () => {
    sandbox();
    spyStorage();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const root = start();
    const run = vi.spyOn(app!, 'run');
    const python = PYTHON_EXAMPLES[0].python;
    const { sketch } = pythonToArduino(python);
    post({ type: 'z1-review', payload: { v: 1, kind: 'python', code: sketch, workspaceJson: '', python, who: 'ali.k', className: '8B', task: '', title: '', at: 0 } });
    await vi.waitFor(() => expect(document.body.dataset.mode).toBe('python'), { timeout: 10_000 });
    await settle();
    const editor = view(root, 'panel-python');
    expect(editor.state.doc.toString()).toBe(python);
    expect(editor.state.readOnly).toBe(true);
    expect(editor.contentDOM.getAttribute('contenteditable')).toBe('true'); // still focusable and selectable
    expect(root.querySelector('[data-slot="tab-python"]')!.getAttribute('aria-selected')).toBe('true');
    expect(mirrorText(root)).toBe(sketch);
    expect(root.querySelector('[data-slot="python-review"]')).toBeNull(); // today's translation is the handed-in sketch
    expect(slot(root, 'code-banner').hidden).toBe(false);
    expect(slot(root, 'code-banner-text').textContent).toBe("Made from the student's Python program.");
    expect(slot(root, 'copy-to-code').hidden).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(slot(root, 'status').dataset.status).toBe('idle');
    await new Promise((r) => setTimeout(r, 800)); // past the live lint and the save debounce
    app!.destroy();
    app = null;
    expect(storageCalls).toEqual([]);
  });

  it('when today\'s translation differs from the handed-in sketch, a banner offers it; the Code tab and Run then use it', async () => {
    sandbox();
    spyStorage();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const root = start(true);
    const python = 'print("today")\n';
    const handedIn = 'void setup() {\n  Serial.begin(9600);\n  Serial.println("handed in");\n}\n\nvoid loop() {\n}\n';
    post({ type: 'z1-review', payload: { v: 1, kind: 'python', code: handedIn, workspaceJson: '', python, who: 'ali.k', className: '8B', task: '', title: '', at: 0 } });
    await vi.waitFor(() => expect(document.body.dataset.mode).toBe('python'), { timeout: 10_000 });
    await settle();
    expect(mirrorText(root)).toBe(pythonToArduino(python).sketch);
    const banner = slot(root, 'python-review');
    expect(banner.getAttribute('role')).toBe('note');
    expect(banner.textContent).toBe(`${PYTHON_REVIEW.updated}${PYTHON_REVIEW.useHandedIn}`);
    expect(PYTHON_REVIEW.updated).toBe("The simulator was updated since this hand-in: the Code tab shows today's translation.");
    expect(banner.nextElementSibling!.classList.contains('z1-python-note')).toBe(true); // above the note and the program
    expect(document.body.dataset.running).toBe('false'); // never run on its own

    const use = slot<HTMLButtonElement>(root, 'use-handed-in');
    expect(use.textContent).toBe('Use the handed-in sketch');
    use.click();
    expect(mirrorText(root)).toBe(handedIn);
    expect(banner.textContent).toBe(PYTHON_REVIEW.usingHandedIn);
    expect(root.querySelector('[data-slot="use-handed-in"]')).toBeNull();
    expect(document.activeElement).toBe(banner);

    await app!.run();
    const serial = root.querySelector('.z1-serial')!.textContent!;
    expect(serial).toContain('handed in');
    expect(serial).not.toContain('today');
    // The live lint after the switch keeps the handed-in sketch in the Code tab.
    await new Promise((r) => setTimeout(r, 800));
    expect(mirrorText(root)).toBe(handedIn);
    app!.destroy();
    app = null;
    expect(storageCalls).toEqual([]);
  });

  it('shows a Python hand-in with errors as its sketch in Code mode, read-only, with the "made from Python" banner', async () => {
    sandbox();
    spyStorage();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const root = start();
    const broken = 'from machine import Pin\n\nwhile True\n    pass\n';
    const { sketch } = pythonToArduino(broken); // the placeholder: "Your Python program has 1 error…"
    post({ type: 'z1-review', payload: { v: 1, kind: 'python', code: sketch, workspaceJson: '', python: broken, who: 'x', className: '', task: '', title: '', at: 0 } });
    await vi.waitFor(() => expect(editorText(root)).toBe(sketch), { timeout: 10_000 });
    expect(document.body.dataset.mode).toBe('code');
    expect(view(root, 'editor').state.readOnly).toBe(true);
    expect(slot(root, 'code-banner').hidden).toBe(false);
    expect(slot(root, 'code-banner-text').textContent).toBe("Made from the student's Python program.");
    expect(root.querySelector('[data-slot="python-review"]')).toBeNull();

    // Python mode then shows the student's program (read-only), not example 01.
    slot(root, 'mode-python').click();
    await settle();
    expect(view(root, 'panel-python').state.doc.toString()).toBe(broken);
    expect(view(root, 'panel-python').state.readOnly).toBe(true);
    expect(storageCalls).toEqual([]);
  });

  it('shows a Python hand-in as its sketch in Code mode when the payload has no Python (an older review page) or the kind is unknown', async () => {
    sandbox();
    spyStorage();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const root = start();
    post({ type: 'z1-review', payload: { v: 1, kind: 'python', code: MY_SKETCH, workspaceJson: '', who: 'x', className: '', task: '', title: '', at: 0 } });
    await settle();
    expect(document.body.dataset.mode).toBe('code');
    expect(editorText(root)).toBe(MY_SKETCH);
    expect(view(root, 'editor').state.readOnly).toBe(true);
    expect(slot(root, 'code-banner-text').textContent).toBe("Made from the student's Python program.");
    post({ type: 'z1-review', payload: { v: 1, kind: 'pyth0n', code: 'int ignored;\n', workspaceJson: '', who: 'x', className: '', task: '', title: '', at: 0 } });
    await settle();
    expect(editorText(root)).toBe(MY_SKETCH);
    expect(storageCalls).toEqual([]);
  });

  it('shows a Python hand-in as its sketch in Code mode when the Python chunk cannot be loaded', async () => {
    // The chunk's download fails (after a redeploy); resetModules drops the copy loaded by the tests above.
    vi.doMock('../src/ui/python-chunk', () => {
      throw new TypeError('Failed to fetch dynamically imported module: python-chunk.js');
    });
    vi.resetModules();
    sandbox();
    spyStorage();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const root = start();
    const python = PYTHON_EXAMPLES[0].python;
    post({ type: 'z1-review', payload: { v: 1, kind: 'python', code: MY_SKETCH, workspaceJson: '', python, who: 'x', className: '', task: '', title: '', at: 0 } });
    await vi.waitFor(() => expect(editorText(root)).toBe(MY_SKETCH), { timeout: 10_000 });
    expect(root.querySelector('.z1-console-entry')!.textContent).toContain('The Python editor could not be loaded');
    expect(document.body.dataset.mode).toBe('code');
    expect(view(root, 'editor').state.readOnly).toBe(true);
    expect(slot(root, 'code-banner-text').textContent).toBe("Made from the student's Python program.");
    expect(storageCalls).toEqual([]);
  });

  it('Python mode in the frame reads and writes no storage either', async () => {
    localStorage.setItem('z1.python', 'print("saved")\n');
    sandbox();
    spyStorage();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const root = start();
    slot(root, 'mode-python').click();
    await vi.waitFor(() => expect(root.querySelector('[data-slot="panel-python"] .cm-editor')).not.toBeNull(), { timeout: 10_000 });
    const python = EditorView.findFromDOM(root.querySelector<HTMLElement>('[data-slot="panel-python"] .cm-editor')!)!;
    expect(python.state.doc.toString()).not.toContain('saved'); // storage was never read
    python.dispatch({ changes: { from: 0, insert: '# note\n' } });
    window.confirm = () => true;
    root.querySelector<HTMLButtonElement>('[data-slot="examples"] .z1-menu-item')!.click(); // New: hidden in the frame, but even a click writes nothing
    await new Promise((r) => setTimeout(r, 600));
    expect(python.state.doc.toString().startsWith('from machine import Pin')).toBe(true);
    app!.destroy();
    app = null;
    Reflect.deleteProperty(window, 'confirm');
    expect(storageCalls).toEqual([]);
  });

  it('ignores messages from another source, another origin or of another shape', async () => {
    sandbox();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const root = start();
    const payload = { v: 1, kind: 'code', code: MY_SKETCH, workspaceJson: '', who: 'x', className: '', task: '', title: '', at: 0 };
    post({ type: 'z1-review', payload }, { origin: 'https://evil.example' });
    post({ type: 'z1-review', payload }, { source: null });
    post({ type: 'z1-review', payload: { kind: 'code', code: 42, workspaceJson: '' } });
    post({ type: 'z1-review-ready' });
    post('z1-review');
    await settle();
    expect(editorText(root)).toBe('');
    post({ type: 'z1-review', payload });
    await settle();
    expect(editorText(root)).toBe(MY_SKETCH);
  });

  it('has no hashchange listener: a share link pasted into the frame changes nothing', async () => {
    sandbox();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const listeners: string[] = [];
    vi.spyOn(window, 'addEventListener').mockImplementation(function (this: Window, type: string) {
      listeners.push(type);
    });
    start();
    expect(listeners).not.toContain('hashchange');
    expect(listeners).toContain('message');
  });

  it('sends a #review= link opened on the site origin to review.html', () => {
    location.hash = '#review=abc';
    const replace = vi.spyOn(location, 'replace').mockImplementation(() => undefined);
    start();
    expect(replace).toHaveBeenCalledWith('./review.html#review=abc');
    expect(isReviewFrame()).toBe(false);
    app!.destroy();
    app = null;
    location.hash = '#rid=ABCDEFGHIJKLMNOP';
    start();
    expect(replace).toHaveBeenLastCalledWith('./review.html#rid=ABCDEFGHIJKLMNOP');
  });
});

describe('update prompt', () => {
  it('saves the work and asks for a reload on vite:preloadError', async () => {
    const root = start();
    expect(slot(root, 'update').hidden).toBe(true);
    EditorView.findFromDOM(root.querySelector<HTMLElement>('.cm-editor')!)!.dispatch({ changes: { from: 0, insert: '// edited\n' } });
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(slot(root, 'update').hidden).toBe(false);
    expect(slot(root, 'update-text').textContent).toBe('The simulator was updated. Reload the page to continue (your work is saved).');
    expect(localStorage.getItem(CODE_STORAGE_KEY)!.startsWith('// edited\n')).toBe(true); // flushed at once, not after the debounce
    expect(slot<HTMLButtonElement>(root, 'reload').textContent).toBe('Reload');
  });

  it('shows the prompt when the Blockly chunk cannot be fetched any more', async () => {
    fake.panelFails = true;
    const root = start();
    slot(root, 'mode-blocks').click();
    await settle();
    expect(slot(root, 'update').hidden).toBe(false);
  });
});
