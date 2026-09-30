/**
 * Code mode (docs/PYTHON.md §7.1): the hand-written Arduino sketch in the Code tab's editable
 * editor, saved as `z1.code`. The other modes never write it (§7.6); only "Edit a copy in Code
 * mode" replaces it, through `copyIn()`, which keeps the old text in `z1.code.previous` for Undo.
 */
import { EXAMPLES, type Example } from '../../examples';
import { createEditor, encodeShareCode, loadSavedCode, saveText, type Editor } from '../editor';
import type { MenuExample } from '../examples-menu';
import type { HandinWork } from '../handin-dialog';
import type { ExportedWork, ModeController, ModeHost, ModeLink, ReviewMessage, RunWords, SketchResult } from './types';

/** What "New" puts in the editor: exactly the Arduino IDE's File > New. */
export const BLANK_SKETCH = `void setup() {
  // put your setup code here, to run once:

}

void loop() {
  // put your main code here, to run repeatedly:

}
`;

/** localStorage key of the sketch that "Edit a copy in Code mode" replaced (Undo brings it back). */
export const CODE_PREVIOUS_STORAGE_KEY = 'z1.code.previous';

/** The console around a run of an Arduino sketch (Code and Blocks mode). */
export const SKETCH_RUN_WORDS: RunWords = {
  started: 'Sketch started.',
  stopped: (loops) => `Sketch stopped after ${loops} loop() calls.`,
};

/** Asked before "Edit a copy in Code mode" replaces hand-written code (§7.6). */
export const CONFIRM_COPY =
  'Replace your Arduino code in Code mode with this sketch?\nYour current Arduino code can be brought back with Undo.';

export class CodeMode implements ModeController {
  readonly id = 'code';
  readonly button = { label: 'Code', title: 'Write the sketch as Arduino C++ text' };
  readonly firstTab = 'code';
  readonly mirrorsCode = false;
  readonly mirror = null;
  readonly lineSource = 'sketch';
  readonly words = {
    run: 'Run the sketch (Ctrl+Enter)',
    stop: 'Stop the sketch (Esc)',
    ide: 'Open this sketch in the Arduino IDE',
    upload: 'Upload this sketch to the ZERO1 board',
    newAria: 'Start a new blank sketch',
    newTitle: 'New blank sketch',
  };
  readonly runWords = SKETCH_RUN_WORDS;

  /** The student's own sketch: the editable editor of the Code tab. */
  readonly editor: Editor;
  /** The text last put in by an example, a link, New or a copy (null = hand-written origin). */
  private lastLoadedSource: string | null;
  /** What the last copy replaced, for its Undo. */
  private beforeCopy: { text: string; lastLoaded: string | null } | null = null;

  /** Mount the editor into `container`: the saved sketch, else the first example (a review frame starts empty). */
  constructor(
    private readonly host: ModeHost,
    container: HTMLElement,
    onChange: () => void,
  ) {
    let initial = '';
    this.lastLoadedSource = null;
    if (!host.review) {
      const saved = loadSavedCode();
      if (saved !== null && saved.trim() !== '') {
        initial = saved;
        this.lastLoadedSource = EXAMPLES.some((e) => e.source === saved) ? saved : null;
      } else {
        initial = EXAMPLES[0]?.source ?? '';
        this.lastLoadedSource = initial;
      }
    }
    this.editor = createEditor(container, {
      initialCode: initial,
      persist: !host.review,
      ariaLabel: 'Arduino sketch',
      onRun: () => host.run(),
      onStop: () => host.stop(),
      onChange,
    });
  }

  examples(): readonly MenuExample[] {
    return EXAMPLES;
  }

  async enter(link: ModeLink | null): Promise<void> {
    if (link?.kind !== 'code') return;
    this.setText(link.code);
    this.host.toast('Sketch loaded from the link');
  }

  leave(): void {}

  focus(): void {
    this.editor.focus();
  }

  async sketch(): Promise<SketchResult> {
    return { ok: true, sketch: this.editor.getCode(), endsAfterSetup: false, usesInput: false };
  }

  exportWork(): ExportedWork {
    const code = this.editor.getCode();
    return { kind: 'code', sketch: code, hash: `#code=${encodeShareCode(code)}`, workspaceJson: '', python: '' };
  }

  async loadExample(example: MenuExample): Promise<void> {
    const { title, source } = example as Example;
    if (!this.confirmReplace(`Replace your code with the example "${title}"?`)) return;
    this.setText(source);
    this.host.selectTab('code');
    this.editor.focus();
    this.host.toast(`Loaded example: ${title}`);
  }

  /**
   * Header "New": the empty sketch of the Arduino IDE's File > New (asking first when work
   * would be lost). Like loading an example, it does not stop a running sketch.
   */
  async newProgram(): Promise<void> {
    if (!this.confirmReplace('Start a new blank sketch?')) return;
    this.setText(BLANK_SKETCH);
    this.host.selectTab('code');
    this.editor.focus();
    this.host.toast('New blank sketch');
  }

  untouched(): HandinWork['unchanged'] {
    const text = this.editor.getCode();
    if (text.trim() === '' || text === BLANK_SKETCH) return { kind: 'blank' };
    const example = EXAMPLES.find((e) => e.source === text);
    return example ? { kind: 'example', title: example.title } : null;
  }

  async confirmLink(): Promise<boolean> {
    return this.confirmReplace('Load the sketch from this link?');
  }

  goToLine(line: number, column?: number): void {
    this.host.selectTab('code');
    this.editor.goToLine(line, column);
  }

  /** Review mode shows a Code hand-in through the app's fallback (the sketch in this editor). */
  async review(_message: ReviewMessage): Promise<boolean> {
    return false;
  }

  /** Review mode: the handed-in sketch (never saved: the editor does not persist in the review frame). */
  showHandedIn(code: string): void {
    this.setText(code);
  }

  flush(): void {
    this.editor.flush();
  }

  destroy(): void {
    this.editor.destroy();
  }

  // --- Edit a copy in Code mode (§7.6) --------------------------------------

  /** The editor holds hand-written text: not blank, not an example, not the last loaded or copied text. */
  isHandWritten(): boolean {
    return !this.isUntouchedText(this.editor.getCode());
  }

  /** Ask before a copy replaces hand-written text (it can be brought back with Undo). */
  confirmCopy(): boolean {
    return !this.isHandWritten() || window.confirm(CONFIRM_COPY);
  }

  /** Replace the sketch with `sketch` (saved), keeping the old text in `z1.code.previous` for Undo. */
  copyIn(sketch: string): void {
    const text = this.editor.getCode();
    this.beforeCopy = { text, lastLoaded: this.lastLoadedSource };
    if (!this.host.review) saveText(CODE_PREVIOUS_STORAGE_KEY, text);
    this.setText(sketch);
  }

  /** Undo the last copy: the sketch it replaced comes back. */
  undoCopy(): void {
    const before = this.beforeCopy;
    if (!before) return;
    this.beforeCopy = null;
    this.editor.setCode(before.text);
    this.lastLoadedSource = before.lastLoaded;
  }

  // --- helpers ----------------------------------------------------------------

  private setText(code: string): void {
    this.editor.setCode(code);
    this.lastLoadedSource = code;
  }

  /** Text that carries no hand-written work: empty, the blank sketch, or exactly an example / the last loaded sketch. */
  private isUntouchedText(text: string): boolean {
    return text.trim() === '' || text === BLANK_SKETCH || text === this.lastLoadedSource || EXAMPLES.some((e) => e.source === text);
  }

  /** Ask before discarding code that differs from the last loaded example. */
  private confirmReplace(question: string): boolean {
    return this.isUntouchedText(this.editor.getCode()) || window.confirm(`${question}\nYour current code will be lost.`);
  }
}
