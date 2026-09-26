// @vitest-environment happy-dom
/**
 * App header tests (happy-dom): the whole app is mounted in Code mode on a
 * virtual-clock board (Blockly is never loaded) to check the toolbar — New
 * replaces the sketch with the Arduino IDE's blank sketch (asking only when
 * hand-written work would be lost), there is no GitHub link, and Share opens
 * the share dialog with the `#code=` link.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { makeBoard } from './helpers';
import { BLANK_SKETCH, mountApp, type App } from '../src/ui/app';
import { CODE_STORAGE_KEY, encodeShareCode } from '../src/ui/editor';
import { EXAMPLES } from '../src/examples';

let app: App | null = null;

afterEach(() => {
  app?.destroy();
  app = null;
  document.body.innerHTML = '';
  localStorage.clear();
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

function editorText(root: HTMLElement): string {
  return EditorView.findFromDOM(root.querySelector<HTMLElement>('.cm-editor')!)!.state.doc.toString();
}

function button(root: HTMLElement, slot: string): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)!;
}

/** window.confirm answering `answer` (happy-dom has none; removed again after each test). */
function stubConfirm(answer: boolean) {
  const confirm = vi.fn((_message?: string) => answer);
  window.confirm = confirm;
  return confirm;
}

const MY_SKETCH = 'void setup() {\n  pinMode(A1, OUTPUT);\n}\n\nvoid loop() {\n  // my own work\n}\n';

describe('header toolbar', () => {
  it('starts with New, has no GitHub link and keeps the other actions', () => {
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
      'share',
    ]);
    expect(root.querySelector('a[href*="github"]')).toBeNull();
    expect(root.querySelector('header')!.textContent).not.toContain('GitHub');
  });

  it('is exactly the Arduino IDE blank sketch', () => {
    expect(BLANK_SKETCH).toBe(
      'void setup() {\n  // put your setup code here, to run once:\n\n}\n\nvoid loop() {\n  // put your main code here, to run repeatedly:\n\n}\n',
    );
  });
});

describe('New', () => {
  it('replaces hand-written code only after the student confirms', async () => {
    const root = start(MY_SKETCH);
    expect(editorText(root)).toBe(MY_SKETCH);

    const refuse = stubConfirm(false);
    button(root, 'new').click();
    await Promise.resolve();
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(refuse.mock.calls[0][0]).toBe('Start a new blank sketch?\nYour current code will be lost.');
    expect(editorText(root)).toBe(MY_SKETCH);

    const accept = stubConfirm(true);
    button(root, 'new').click();
    await Promise.resolve();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(editorText(root)).toBe(BLANK_SKETCH);
    expect(localStorage.getItem(CODE_STORAGE_KEY)).toBe(BLANK_SKETCH);
    expect(root.querySelector<HTMLElement>('[data-slot="toast"]')!.textContent).toBe('New blank sketch');
    expect(button(root, 'tab-code').getAttribute('aria-selected')).toBe('true');
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
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(stop).not.toHaveBeenCalled();

    dialog.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    expect(dialog.open).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
