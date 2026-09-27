// @vitest-environment happy-dom
/**
 * Review mode tests (happy-dom, docs/CLASSROOM.md §7.3): the simulator inside
 * review.html's sandbox. `self.origin` is stubbed to 'null' and `location.hash`
 * to '#review'; Storage is spied so that no access at all is allowed. Blockly
 * is never loaded: a small fake panel stands in (as in app-header.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { makeBoard, settle } from './helpers';
import { isReviewFrame, mountApp, type App } from '../src/ui/app';
import { MODE_STORAGE_KEY, type BlocksPanel, type BlocksPanelOptions } from '../src/ui/blocks-panel';
import { CODE_STORAGE_KEY } from '../src/ui/editor';

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

function start(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const { board, clock } = makeBoard();
  app = mountApp(root, board, clock);
  return root;
}

const editorText = (root: HTMLElement) => EditorView.findFromDOM(root.querySelector<HTMLElement>('.cm-editor')!)!.state.doc.toString();
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

  it('touches no storage at all, announces itself to the parent and hides New, Examples, Hand in, Share and Arduino IDE', () => {
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
    for (const name of ['new', 'examples', 'share', 'ide']) expect(slot(root, name).hidden, name).toBe(true);
    expect(root.querySelector('[data-slot="handin"]')).toBeNull();
    for (const name of ['run', 'stop', 'reset', 'settings', 'mode-code', 'mode-blocks']) expect(slot(root, name).hidden, name).toBe(false);
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
    EditorView.findFromDOM(root.querySelector<HTMLElement>('.cm-editor')!)!.dispatch({ changes: { from: 0, insert: '// note\n' } });
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
    expect(editorText(root)).toBe(sketchOf(blocks));
    expect(storageCalls).toEqual([]);

    // A workspace that cannot be read: the generated sketch in Code mode, with the "generated from blocks" banner.
    app!.destroy();
    app = null;
    document.body.innerHTML = '';
    const again = start();
    post({ type: 'z1-review', payload: { v: 1, kind: 'blocks', code: MY_SKETCH, workspaceJson: 'not json', who: 'x', className: '', task: '', title: '', at: 0 } });
    await settle();
    expect(document.body.dataset.mode).toBe('code');
    expect(editorText(again)).toBe(MY_SKETCH);
    expect(slot(again, 'code-banner').hidden).toBe(false);
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
