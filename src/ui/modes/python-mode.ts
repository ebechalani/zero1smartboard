/**
 * Python mode (docs/PYTHON.md §7): the student writes MicroPython-style Python in the Python
 * tab (saved as `z1.python`); the translator turns it into an Arduino sketch, which the Code
 * tab's read-only mirror shows and which Run, the exports and the hand-in use.
 *
 * The Python tab: a one-line note with the "What works" dialog (§7.3) above the editor (§7.4:
 * ZERO1 completions, paste clean-up, visible non-breaking spaces). Live lint (§7.8) translates
 * the program 700 ms after an edit and also checks the sketch with transpile(): its errors
 * become X-sketch-error and its warnings W-sketch, on the Python lines they were made from.
 *
 * The translator, example 01 and the editor's language support live in the lazy Python chunk
 * (src/ui/python-chunk.ts, §7.16), the other examples in a lazy chunk of their own
 * (src/ui/python-examples-chunk.ts): this file imports their types only and loads both with
 * `import()` on first use, so Code and Blocks users never download them.
 *
 * In the teacher's review frame (§7.13) a Python hand-in shows read-only, with today's
 * translation in the Code tab and, when that is not the handed-in sketch, a banner that offers
 * the handed-in one.
 */
import { transpile } from '../../transpiler';
import type { ConsoleMessage, Diagnostic } from '../../types';
import { createEditor, loadText, saveText, type Editor } from '../editor';
import type { MenuExample } from '../examples-menu';
import type { HandinWork } from '../handin-dialog';
import type { PythonExample, PythonHelpDialog, PythonTranslation } from '../python-chunk';
import { pythonFileName } from '../sketch-file';
import { encodeSharePython } from '../../share-link';
import type { ExportedWork, ModeController, ModeHost, ModeLink, ProgramFile, ReviewMessage, RunWords, SketchResult } from './types';

type PythonChunk = typeof import('../python-chunk');
type PythonExamplesChunk = typeof import('../python-examples-chunk');

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

/** The one-line note above the Python editor (§7.3); "What works" opens the dialog. */
export const PYTHON_NOTE = {
  before: 'MicroPython-style Python for the ZERO1. It becomes the Arduino sketch in the Code tab — that sketch is what runs and what goes to the board.',
  help: 'What works',
  after: 'Esc then Tab: leave the editor · Ctrl+M: Tab moves focus',
};

/** The console around a run in Python mode (§7.8, §7.9). */
export const PYTHON_RUN_WORDS: RunWords = {
  started: 'Program started.',
  stopped: (loops, endsAfterSetup) =>
    endsAfterSetup ? 'Program stopped.' : `Program stopped after ${loops} round${loops === 1 ? '' : 's'} of the while True loop.`,
  finished: 'Program finished (it has no while True loop).',
  printHint: { text: 'print() output is in the Serial Monitor tab', action: 'Open the Serial Monitor' },
  newlineOnly: "Python's input() reads one line: the Serial Monitor sends Newline",
  serial: {
    hint: ['Nothing printed yet. Use ', { code: 'print("Hello")' }, ' in your program to see text here.'],
    placeholder: 'Type text to send to your program and press Enter',
    inputLabel: 'Text to send to your program',
    sendLabel: 'Send text to your program',
  },
};

/**
 * Review mode (§7.13): the banner above the student's Python program when today's translation
 * is not the sketch that was handed in, and after the teacher chose the handed-in one.
 */
export const PYTHON_REVIEW = {
  updated: "The simulator was updated since this hand-in: the Code tab shows today's translation.",
  useHandedIn: 'Use the handed-in sketch',
  usingHandedIn: 'The Code tab shows the sketch as it was handed in.',
};

/**
 * transpile()'s warning for analogWrite() on a pin without PWM (src/transpiler/codegen.ts). A
 * PWM() on such a pin already has its W-pwm-pin / W-pwm-buzzer / W-pwm-servo warning (on the
 * PWM() line; the analogWrite() comes from each duty_u16() line), so its W-sketch is left out.
 */
const ANALOG_WRITE_NO_PWM = /^analogWrite\(\) only dims on PWM pins\b/;
const PWM_WARNINGS: ReadonlySet<string> = new Set(['W-pwm-pin', 'W-pwm-buzzer', 'W-pwm-servo']);

/** Share ▾ → Download .py (§7.11). */
export const PYTHON_FILE: ProgramFile = {
  label: 'Download .py',
  title: 'Save the Python program (for the ZERO1 simulator)',
  fileName: pythonFileName,
  contents: (work) => work.python,
};

/** A translation, and what transpile() said about its sketch (on Python lines). */
interface Checked {
  translation: PythonTranslation;
  /** Errors first (the translator's, else X-sketch-error), then warnings (the translator's, then W-sketch). */
  diagnostics: Diagnostic[];
  /** No error at all: the sketch can run. */
  ok: boolean;
}

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
    /** X-sketch-error (src/python/messages.ts) without its {message}; tests keep the two equal. */
    errorPrefix: 'Python translation error (a bug in the simulator, please tell your teacher): ',
    ideNote: 'This is the Arduino sketch made from your Python program (the code in the Code tab). The board runs this sketch: it cannot run Python itself.',
    uploadNote: 'This uploads the Arduino sketch made from your Python program (the code in the Code tab). The board runs this sketch: it cannot run Python itself.',
    uploadDone: 'Done — the program is running on the board. Its print() output: open the Arduino IDE Serial Monitor at 9600 baud.',
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
  readonly runWords = PYTHON_RUN_WORDS;
  readonly programFile = PYTHON_FILE;
  /** A Python hand-in that cannot be shown here is its sketch, read-only, in Code mode (§7.13). */
  readonly reviewReadOnly = true;
  /** A #python= link that opens the page asks before it replaces a program that is not untouched (§7.6). */
  readonly confirmsStartLink = true;

  private chunk: PythonChunk | null = null;
  /** The Python examples (§9), from their own chunk; null until it is loaded. */
  private exampleList: readonly PythonExample[] | null = null;
  /** The last download of the chunks failed (the Examples menu then says there are none). */
  private chunkFailed = false;
  private loading: Promise<Editor | null> | null = null;
  private editor: Editor | null = null;
  /** The last loaded text (example, link, New); null = unknown origin. */
  private baseline: string | null = null;
  private lintTimer: ReturnType<typeof setTimeout> | null = null;
  /** The translation of the text it was made from (translating the same text twice is wasted work). */
  private last: { text: string; translation: PythonTranslation } | null = null;
  /** The last check (translation + transpile()) and the text it was made from. */
  private lastChecked: { text: string; checked: Checked } | null = null;
  /** "What works" (§7.3), made on first use. */
  private helpDialog: PythonHelpDialog | null = null;
  /** Review mode (§7.13): the handed-in sketch, once the teacher chose it over today's translation. */
  private handedIn: string | null = null;
  /** Review mode: the banner above the Python program when today's translation differs from the hand-in. */
  private reviewBanner: HTMLElement | null = null;

  constructor(private readonly host: ModeHost) {}

  examples(): readonly MenuExample[] {
    return this.exampleList ?? [];
  }

  /** The chunks are on the way (or about to be: the mode is entered right after it shows): the Examples menu says "Loading…" (§7.7). */
  examplesLoading(): boolean {
    return this.exampleList === null && !this.chunkFailed;
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
    const { translation, diagnostics, ok } = this.lint();
    if (!ok) {
      const errors = diagnostics.filter((d) => d.severity === 'error');
      const count = `${errors.length} error${errors.length === 1 ? '' : 's'}`;
      return { ok: false, reason: 'errors', message: `${count} — fix and run again`, diagnostics };
    }
    const pythonize = (msg: ConsoleMessage, serialTail: string) => chunk.pythonizeRuntimeMessage(msg, serialTail);
    if (this.handedIn !== null) {
      // Review mode, "Use the handed-in sketch" (§7.13): today's source map does not fit it, so
      // its messages stay on sketch lines (a runtime stop still names its Python line).
      const { endsAfterSetup, usesInput } = translation;
      return { ok: true, sketch: this.handedIn, endsAfterSetup, usesInput, pythonize };
    }
    return {
      ok: true,
      sketch: translation.sketch,
      composeLineMap: (jsLineMap) => translation.map.composeJsLineMap(jsLineMap),
      endsAfterSetup: translation.endsAfterSetup,
      usesInput: translation.usesInput,
      pythonize,
      diagnostics,
    };
  }

  /** The Python program and the sketch made from it (the placeholder while it has errors). */
  exportWork(): ExportedWork | { error: string } {
    const chunk = this.chunk;
    if (!this.editor || !chunk) return { error: PYTHON_LOADING };
    const python = this.editor.getCode();
    const translation = this.translate(python);
    return {
      kind: 'python',
      sketch: translation.sketch,
      hash: `#python=${encodeSharePython(python)}`,
      workspaceJson: '',
      python,
      mapLine: (sketchLine) => translation.map.pythonLineOf(sketchLine),
      sketchError: (message) => chunk.message('X-sketch-error', { message }),
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
    const example = this.exampleList?.find((e) => e.python === text);
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

  /**
   * Review mode (§7.13): the student's Python program, read-only, and today's translation of it
   * in the Code tab; when that is not the handed-in sketch, a banner offers the handed-in one
   * ("Use the handed-in sketch": the mirror and Run then use it). Nothing runs, nothing is saved.
   * False — the app shows the handed-in sketch in Code mode — when the payload has no Python
   * (an older review page), the chunk cannot be loaded or the program has errors today.
   */
  async review(message: ReviewMessage): Promise<boolean> {
    if (message.python.trim() === '') return false;
    const editor = await this.ensureEditor();
    if (!editor) return false;
    // Also on the way to the fallback: a switch to Python mode then shows the program and its errors.
    editor.setCode(message.python); // never saved: the review frame's editors do not persist
    editor.setReadOnly(true);
    this.baseline = message.python;
    this.handedIn = null;
    const { translation, ok } = this.check(message.python);
    this.showReviewBanner(ok && translation.sketch !== message.code ? message.code : null);
    if (!ok) return false;
    this.host.setMode(this.id);
    this.lint();
    return true;
  }

  flush(): void {
    this.editor?.flush();
  }

  destroy(): void {
    this.cancelLint();
    this.reviewBanner?.remove();
    this.reviewBanner = null;
    this.helpDialog?.close();
    this.helpDialog?.element.remove();
    this.helpDialog = null;
    this.editor?.destroy();
    this.editor = null;
  }

  /** The "What works" dialog (§7.3); null until the chunk is loaded. */
  showHelp(): PythonHelpDialog | null {
    const chunk = this.chunk;
    if (!chunk) return null;
    this.helpDialog ??= chunk.createPythonHelpDialog(this.host.dialogParent, chunk.WHAT_WORKS);
    this.helpDialog.open();
    return this.helpDialog;
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
    this.chunkFailed = false;
    let chunk: PythonChunk;
    let examples: PythonExamplesChunk;
    try {
      // The examples come in a chunk of their own (§7.16), fetched at the same time: when the
      // editor exists, every list that asks "is this an example?" is complete.
      const [main, more] = await Promise.all([import('../python-chunk'), import('../python-examples-chunk')]);
      // After a redeploy Vite's preload error is swallowed (App.onPreloadError): import() then gives undefined.
      if (!main || !more) throw new Error('Failed to fetch dynamically imported module: python-chunk');
      chunk = main;
      examples = more;
    } catch (err) {
      note.textContent = 'The Python editor could not be loaded. Check your internet connection and reload the page.';
      this.loading = null; // the next attempt (Run, mode switch) tries again
      this.chunkFailed = true;
      this.host.examplesChanged(this);
      this.host.loadFailed('Python editor', err);
      return null;
    }
    this.chunk = chunk;
    this.exampleList = examples.PYTHON_EXAMPLES;

    // First visit: example 01, untouched. The review frame reads no storage.
    const saved = this.host.review ? null : loadText(PYTHON_STORAGE_KEY);
    const hasSaved = saved !== null && saved.trim() !== '';
    const initial = hasSaved ? saved : chunk.PYTHON_FIRST_EXAMPLE.python;
    this.baseline = hasSaved ? (this.host.review ? null : loadText(PYTHON_BASELINE_STORAGE_KEY)) : initial;

    const editorHost = document.createElement('div');
    editorHost.className = 'z1-editor-host';
    panel.replaceChildren(this.createNote(), editorHost);
    this.editor = createEditor(editorHost, {
      initialCode: initial,
      persist: !this.host.review,
      language: chunk.pythonLanguageSupport(chunk.API_COMPLETIONS),
      storageKey: PYTHON_STORAGE_KEY,
      indent: 4,
      ariaLabel: 'Python program',
      onRun: () => this.host.run(),
      onStop: () => this.host.stop(),
      onChange: () => this.scheduleLint(),
      extraExtensions: [chunk.showNonBreakingSpaces, chunk.pythonPasteCleanup((fixes) => this.host.toast(chunk.pasteToast(fixes)))],
    });
    this.host.examplesChanged(this);
    return this.editor;
  }

  /** "MicroPython-style Python for the ZERO1. … What works · Esc then Tab: leave the editor · …" (§7.3). */
  private createNote(): HTMLElement {
    const note = document.createElement('p');
    note.className = 'z1-python-note';
    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'z1-linkbtn';
    help.dataset.slot = 'python-help';
    help.textContent = PYTHON_NOTE.help;
    help.addEventListener('click', () => void this.showHelp());
    note.append(`${PYTHON_NOTE.before} `, help, ` · ${PYTHON_NOTE.after}`);
    return note;
  }

  /**
   * Review mode: the banner above the Python program while today's translation is not the
   * handed-in sketch (`handedIn`; null removes the banner). Its button puts the handed-in
   * sketch into the Code tab and Run.
   */
  private showReviewBanner(handedIn: string | null): void {
    this.reviewBanner?.remove();
    this.reviewBanner = null;
    if (handedIn === null) return;
    const banner = document.createElement('div');
    banner.className = 'z1-banner z1-python-review';
    banner.dataset.slot = 'python-review';
    banner.setAttribute('role', 'note');
    const text = document.createElement('span');
    text.textContent = PYTHON_REVIEW.updated;
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'z1-btn z1-btn-small z1-banner-action';
    use.dataset.slot = 'use-handed-in';
    use.textContent = PYTHON_REVIEW.useHandedIn;
    use.addEventListener('click', () => {
      this.handedIn = handedIn;
      text.textContent = PYTHON_REVIEW.usingHandedIn;
      use.remove();
      banner.tabIndex = -1; // the focus stays on the banner, which now says what the Code tab shows
      banner.focus();
      if (this.editor && this.chunk) this.lint();
    });
    banner.append(text, use);
    this.host.panel('python').prepend(banner);
    this.reviewBanner = banner;
  }

  // --- translation ------------------------------------------------------------

  private translate(text: string): PythonTranslation {
    if (this.last?.text !== text) this.last = { text, translation: this.chunk!.pythonToArduino(text) };
    return this.last.translation;
  }

  /**
   * The translation and, when it has no error, what transpile() says about its sketch, both on
   * Python lines: an error in the sketch is the simulator's fault (X-sketch-error), a warning is
   * W-sketch; a warning on a line made from no Python line (scaffolding, helpers) is left out.
   */
  private check(text: string): Checked {
    if (this.lastChecked?.text === text) return this.lastChecked.checked;
    const chunk = this.chunk!;
    const translation = this.translate(text);
    let checked: Checked = { translation, diagnostics: translation.diagnostics, ok: translation.ok };
    if (translation.ok) {
      const result = safeTranspile(translation.sketch);
      const errors: Diagnostic[] = result.ok
        ? []
        : result.errors.map((d) => ({
            line: translation.map.pythonLineOf(d.line) || 1,
            column: 1,
            severity: 'error',
            message: chunk.message('X-sketch-error', { message: d.message }),
          }));
      const seen = new Set<string>(); // one Python line can make several sketch lines with the same warning
      const pwmWarned = translation.diagnostics.some((d) => PWM_WARNINGS.has(d.code));
      const warnings: Diagnostic[] = result.warnings.flatMap((d) => {
        const line = translation.map.pythonLineOf(d.line);
        const message = chunk.message('W-sketch', { warning: d.message });
        if (!line || seen.has(`${line}:${message}`)) return [];
        if (pwmWarned && ANALOG_WRITE_NO_PWM.test(d.message)) return []; // said already, in Python words
        seen.add(`${line}:${message}`);
        return [{ line, column: 1, severity: 'warning' as const, message }];
      });
      // The translation is ok: its diagnostics are warnings. By position; the translator's first on a line.
      const all = [...translation.diagnostics, ...warnings].sort((a, b) => a.line - b.line || a.column - b.column);
      checked = { translation, diagnostics: [...errors, ...all], ok: errors.length === 0 };
    }
    this.lastChecked = { text, checked };
    return checked;
  }

  /** Check the program now: squiggles in the Python editor, the sketch (or placeholder) in the mirror. */
  private lint(): Checked {
    this.cancelLint();
    const checked = this.check(this.editor!.getCode());
    this.editor!.setDiagnostics(checked.diagnostics);
    const sketch = this.handedIn ?? checked.translation.sketch;
    this.host.showMirror(this, sketch, checked.translation.ok ? null : PYTHON_FIX_FIRST_TITLE);
    return checked;
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
      (chunk !== null && text === chunk.BLANK_PYTHON) ||
      (this.exampleList?.some((e) => e.python === text) ?? false)
    );
  }

  /** Ask before discarding a Python program that is not untouched. */
  private confirmReplace(question: string): boolean {
    const text = this.editor?.getCode() ?? '';
    return this.isUntouched(text) || window.confirm(`${question}\nYour current Python program will be lost.`);
  }
}

/** transpile() never throws by contract; a bug in it still must not stop the Python editor. */
function safeTranspile(sketch: string): ReturnType<typeof transpile> {
  try {
    return transpile(sketch);
  } catch (err) {
    return { ok: false, errors: [{ line: 1, column: 1, severity: 'error', message: err instanceof Error ? err.message : String(err) }], warnings: [] };
  }
}
