/**
 * Python mode (docs/PYTHON.md §7): the student writes MicroPython-style Python in the Python
 * tab (saved as `z1.python`); the translator turns it into an Arduino sketch, which the Code
 * tab's read-only mirror shows and which Run, the exports and the hand-in use.
 *
 * The translator, the examples and the editor's language support live in the lazy Python
 * chunk (src/ui/python-chunk.ts, §7.16): this file imports its types only and loads it with
 * `import()` on first use, so Code and Blocks users never download it.
 */
import { createEditor, loadText, saveText, type Editor } from '../editor';
import type { MenuExample } from '../examples-menu';
import type { HandinWork } from '../handin-dialog';
import type { PythonExample, PythonTranslation } from '../python-chunk';
import { encodeSharePython } from '../../share-link';
import type { ExportedWork, ModeController, ModeHost, ModeLink, ReviewMessage, SketchResult } from './types';

type PythonChunk = typeof import('../python-chunk');

/** localStorage key of the Python program. */
export const PYTHON_STORAGE_KEY = 'z1.python';
/**
 * localStorage key of the last loaded Python text (an example, a link, New): restored unchanged
 * after a reload, the program still counts as untouched (§7.7).
 */
export const PYTHON_BASELINE_STORAGE_KEY = 'z1.python.baseline';

/** Delay between an edit and the live translation (§7.8). */
const LIVE_LINT_MS = 700;

/** Exports and uploads while the Python chunk is still being downloaded. */
export const PYTHON_LOADING = 'Python is still loading — try again in a moment';
/** The tooltip of the disabled "Edit a copy in Code mode" while the program has errors (§7.6). */
export const PYTHON_FIX_FIRST_TITLE = 'Fix the errors in your Python program first';
/** Download .ino, Arduino IDE and Upload to board refuse a program with errors (§7.11, §7.12). */
export const PYTHON_FIX_FIRST = 'Fix the errors in your Python program first — see the console.';

export class PythonMode implements ModeController {
  readonly id = 'python';
  readonly button = { label: 'Python', title: 'Write the program in Python (MicroPython style)' };
  readonly firstTab = 'python';
  readonly mirrorsCode = true;
  readonly mirror = {
    label: 'Arduino sketch made from your Python (read only)',
    banner: 'Made from your Python program — read only.',
    typing: 'This sketch is made from your Python — edit it in the Python tab',
    review: "Made from the student's Python program.",
    errorPrefix: '',
  };
  readonly lineSource = 'python';
  readonly words = {
    run: 'Run the program (Ctrl+Enter)',
    stop: 'Stop the program (Esc)',
    ide: 'Open the sketch made from this program in the Arduino IDE',
    upload: 'Upload the sketch made from this program to the ZERO1 board',
    newAria: 'Start a new blank Python program',
    newTitle: 'New blank Python program',
  };

  private chunk: PythonChunk | null = null;
  private loading: Promise<Editor | null> | null = null;
  private editor: Editor | null = null;
  /** The last loaded text (example, link, New); null = unknown origin. */
  private baseline: string | null = null;
  private lintTimer: ReturnType<typeof setTimeout> | null = null;
  /** The translation of the text it was made from (translating the same text twice is wasted work). */
  private last: { text: string; translation: PythonTranslation } | null = null;

  constructor(private readonly host: ModeHost) {}

  examples(): readonly MenuExample[] {
    return this.chunk?.PYTHON_EXAMPLES ?? [];
  }

  async enter(link: ModeLink | null): Promise<void> {
    if (!this.editor) this.host.showMirror(this, '', PYTHON_LOADING);
    const editor = await this.ensureEditor();
    if (!editor || !this.host.isCurrent(this)) return; // could not load, or the student switched back meanwhile
    if (link?.kind === 'python') this.load(link.python, 'Python program loaded from the link');
    else this.lint();
  }

  leave(): void {
    this.cancelLint();
  }

  focus(): void {
    this.editor?.focus();
  }

  /** A fresh translation of the Python program (the mirror and the squiggles follow it). */
  async sketch(): Promise<SketchResult> {
    const editor = await this.ensureEditor();
    const chunk = this.chunk;
    if (!editor || !chunk) return { ok: false, reason: 'loading', message: 'The Python editor could not be loaded — nothing to run' };
    const translation = this.lint();
    if (!translation.ok) {
      const errors = translation.diagnostics.filter((d) => d.severity === 'error');
      const count = `${errors.length} error${errors.length === 1 ? '' : 's'}`;
      return { ok: false, reason: 'errors', message: `${count} — fix and run again`, diagnostics: translation.diagnostics };
    }
    return {
      ok: true,
      sketch: translation.sketch,
      composeLineMap: (jsLineMap) => translation.map.composeJsLineMap(jsLineMap),
      endsAfterSetup: translation.endsAfterSetup,
      usesInput: translation.usesInput,
      pythonize: (msg, serialTail) => chunk.pythonizeRuntimeMessage(msg, serialTail),
    };
  }

  /** The Python program and the sketch made from it (the placeholder while it has errors). */
  exportWork(): ExportedWork | { error: string } {
    if (!this.editor) return { error: PYTHON_LOADING };
    const python = this.editor.getCode();
    const translation = this.translate(python);
    return {
      kind: 'python',
      sketch: translation.sketch,
      hash: `#python=${encodeSharePython(python)}`,
      workspaceJson: '',
      python,
      mapLine: (sketchLine) => translation.map.pythonLineOf(sketchLine),
      ...(translation.ok ? {} : { sketchProblem: PYTHON_FIX_FIRST }),
    };
  }

  async loadExample(example: MenuExample): Promise<void> {
    const { title, python } = example as PythonExample;
    const editor = await this.ensureEditor();
    if (!editor) return;
    if (!this.confirmReplace(`Replace your Python program with the example "${title}"?`)) return;
    this.load(python, `Loaded example: ${title}`);
    this.host.selectTab('python');
    editor.focus();
  }

  /** Header "New": BLANK_PYTHON (asking first when work would be lost); does not stop a run. */
  async newProgram(): Promise<void> {
    const editor = await this.ensureEditor();
    const chunk = this.chunk;
    if (!editor || !chunk || !this.host.isCurrent(this)) return;
    if (!this.confirmReplace('Start a new blank program?')) return;
    this.load(chunk.BLANK_PYTHON, 'New blank Python program');
    this.host.selectTab('python');
    editor.focus();
  }

  untouched(): HandinWork['unchanged'] {
    const chunk = this.chunk;
    if (!chunk || !this.editor) return null;
    const text = this.editor.getCode();
    if (text.trim() === '' || text === chunk.BLANK_PYTHON) return { kind: 'blank' };
    const example = chunk.PYTHON_EXAMPLES.find((e) => e.python === text);
    return example ? { kind: 'example', title: example.title } : null;
  }

  async confirmLink(): Promise<boolean> {
    if (!(await this.ensureEditor())) return true; // nothing to lose here: the link cannot be shown either
    return this.confirmReplace('Load the Python program from this link?');
  }

  goToLine(line: number, column?: number): void {
    if (!this.editor || !this.host.isCurrent(this)) return;
    this.host.selectTab('python');
    this.editor.goToLine(line, column);
  }

  /** Python review mode is not there yet (§7.13): the app shows the handed-in sketch in Code mode. */
  async review(_message: ReviewMessage): Promise<boolean> {
    return false;
  }

  flush(): void {
    this.editor?.flush();
  }

  destroy(): void {
    this.cancelLint();
    this.editor?.destroy();
    this.editor = null;
  }

  // --- editor -----------------------------------------------------------------

  /** Load the Python chunk and create the editor on first use (null when the chunk cannot be loaded). */
  private ensureEditor(): Promise<Editor | null> {
    if (this.editor) return Promise.resolve(this.editor);
    this.loading ??= this.createEditor();
    return this.loading;
  }

  private async createEditor(): Promise<Editor | null> {
    const panel = this.host.panel('python');
    panel.classList.add('z1-python');
    const note = document.createElement('p');
    note.className = 'z1-python-loading';
    note.textContent = 'Loading Python…';
    panel.replaceChildren(note);
    let chunk: PythonChunk;
    try {
      chunk = await import('../python-chunk');
    } catch (err) {
      note.textContent = 'The Python editor could not be loaded. Check your internet connection and reload the page.';
      this.loading = null; // the next attempt (Run, mode switch) tries again
      this.host.loadFailed('Python editor', err);
      return null;
    }
    this.chunk = chunk;

    // First visit: example 01, untouched. The review frame reads no storage.
    const saved = this.host.review ? null : loadText(PYTHON_STORAGE_KEY);
    const hasSaved = saved !== null && saved.trim() !== '';
    const initial = hasSaved ? saved : (chunk.PYTHON_EXAMPLES[0]?.python ?? chunk.BLANK_PYTHON);
    this.baseline = hasSaved ? (this.host.review ? null : loadText(PYTHON_BASELINE_STORAGE_KEY)) : initial;

    const editorHost = document.createElement('div');
    editorHost.className = 'z1-editor-host';
    panel.replaceChildren(editorHost);
    this.editor = createEditor(editorHost, {
      initialCode: initial,
      persist: !this.host.review,
      language: chunk.pythonLanguageSupport(),
      storageKey: PYTHON_STORAGE_KEY,
      indent: 4,
      ariaLabel: 'Python program',
      onRun: () => this.host.run(),
      onStop: () => this.host.stop(),
      onChange: () => this.scheduleLint(),
    });
    this.host.examplesChanged(this);
    return this.editor;
  }

  // --- translation ------------------------------------------------------------

  private translate(text: string): PythonTranslation {
    if (this.last?.text !== text) this.last = { text, translation: this.chunk!.pythonToArduino(text) };
    return this.last.translation;
  }

  /** Translate the program now: squiggles in the Python editor, the sketch (or placeholder) in the mirror. */
  private lint(): PythonTranslation {
    this.cancelLint();
    const translation = this.translate(this.editor!.getCode());
    this.editor!.setDiagnostics(translation.diagnostics);
    this.host.showMirror(this, translation.sketch, translation.ok ? null : PYTHON_FIX_FIRST_TITLE);
    return translation;
  }

  private scheduleLint(): void {
    this.cancelLint();
    this.lintTimer = setTimeout(() => {
      this.lintTimer = null;
      if (this.editor && this.chunk) this.lint();
    }, LIVE_LINT_MS);
  }

  private cancelLint(): void {
    if (this.lintTimer === null) return;
    clearTimeout(this.lintTimer);
    this.lintTimer = null;
  }

  // --- untouched programs -----------------------------------------------------

  /** Put `text` into the editor (saved) as the new untouched baseline. */
  private load(text: string, toast: string): void {
    this.editor!.setCode(text);
    this.baseline = text;
    if (!this.host.review) saveText(PYTHON_BASELINE_STORAGE_KEY, text);
    this.lint();
    this.host.toast(toast);
  }

  /** Nothing to lose: empty, BLANK_PYTHON, a Python example or the last loaded text (§7.7). */
  private isUntouched(text: string): boolean {
    const chunk = this.chunk;
    return (
      text.trim() === '' ||
      text === this.baseline ||
      (chunk !== null && (text === chunk.BLANK_PYTHON || chunk.PYTHON_EXAMPLES.some((e) => e.python === text)))
    );
  }

  /** Ask before discarding a Python program that is not untouched. */
  private confirmReplace(question: string): boolean {
    const text = this.editor?.getCode() ?? '';
    return this.isUntouched(text) || window.confirm(`${question}\nYour current Python program will be lost.`);
  }
}
