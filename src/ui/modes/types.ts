/**
 * The mode registry (docs/PYTHON.md §7.1): everything that differs between Code, Blocks and
 * Python mode lives behind one interface, so the app shell (src/ui/app.ts) never compares the
 * mode with a literal (tests/app-mode-registry.test.ts). One controller per mode:
 * code-mode.ts, blocks-mode.ts, python-mode.ts.
 *
 * Each mode keeps its own program (§7.6): Code mode `z1.code`, Blocks mode `z1.blocks`, Python
 * mode `z1.python`. Blocks and Python show the sketch made from their program in the Code tab's
 * second, read-only editor (the mirror, §7.5); the student's own sketch is never overwritten,
 * except by "Edit a copy in Code mode" (asked first, with Undo).
 */
import type { ConsoleMessage, Diagnostic } from '../../types';
import type { AppMode } from '../blocks-panel';
import type { ConsolePanel } from '../console-panel';
import type { MenuExample } from '../examples-menu';
import type { HandinWork } from '../handin-dialog';
import type { SerialWords } from '../serial-monitor';

export type { AppMode };

/** The right-column tabs (§7.2). */
export type TabId = 'blocks' | 'code' | 'serial' | 'pinmap' | 'python' | 'js';

/** A share link for one mode: `#code=` (or `#example=`), `#blocks=`, `#python=`. */
export type ModeLink =
  | { kind: 'code'; code: string }
  | { kind: 'blocks'; workspace: object }
  | { kind: 'python'; python: string };

/** What the URL hash carried: a mode's program, or a class to join (`#class=`). */
export type HashPayload = ModeLink | { kind: 'class'; code: string };

/** The hand-in the review page sends the sandboxed simulator (docs/CLASSROOM.md §1.4, docs/PYTHON.md §7.13). */
export interface ReviewMessage {
  kind: AppMode;
  code: string;
  workspaceJson: string;
  /** The Python program of a Python hand-in ('' for the others and for older review pages). */
  python: string;
}

/** Header texts that name the mode's work (§7.14). */
export interface ModeWords {
  /** `aria-label` of Run ("Run the sketch (Ctrl+Enter)"); while running "Run" reads "Restart". */
  run: string;
  /** `aria-label` of Stop. */
  stop: string;
  /** `aria-label` of the Arduino IDE button. */
  ide: string;
  /** `aria-label` of Upload to board. */
  upload: string;
  /** `aria-label` of New. */
  newAria: string;
  /** Tooltip of New. */
  newTitle: string;
}

/** Blocks and Python mode: the texts around the read-only sketch in the Code tab (§7.5). */
export interface MirrorWords {
  /** `aria-label` of the read-only editor. */
  label: string;
  /** The banner above it (next to "Edit a copy in Code mode"). */
  banner: string;
  /** The toast when the student types into it. */
  typing: string;
  /**
   * Review mode: the banner above the Code tab's sketch (the mirror, or the handed-in sketch when
   * the hand-in can only be shown as its sketch).
   */
  review: string;
  /** Put before an error in the sketch: the simulator made it, the student's program is not at fault. */
  errorPrefix: string;
  /** The note of the Arduino IDE dialog: the sketch it gets is made from the program (§7.12). */
  ideNote: string;
  /** The note of the Upload dialog (§7.12). */
  uploadNote: string;
  /** Python: the Upload dialog's "Done" text (where print() output goes on the real board, §7.12). */
  uploadDone?: string;
}

/** What the console says around a run (§7.8, §7.9). */
export interface RunWords {
  /** When a run starts ("Sketch started."). */
  started: string;
  /** When the student stops a run ("Sketch stopped after 12 loop() calls."). */
  stopped(loops: number, endsAfterSetup: boolean): string;
  /** Python: a program without a main loop reached its end (§7.8). */
  finished?: string;
  /** Python: the hint the first time a run prints while the Serial Monitor tab is hidden, and its action (§7.9). */
  printHint?: { text: string; action: string };
  /** Python: the Serial Monitor sends Newline only (the line-ending choice is off, with this tooltip; §7.9). */
  newlineOnly?: string;
  /** Python: the Serial Monitor's hint and send box speak of the program and print() (default: of the sketch). */
  serial?: SerialWords;
}

/** A Share ▾ download of the mode's own program ("Download .py", §7.11). */
export interface ProgramFile {
  /** The menu item and its tooltip. */
  label: string;
  title: string;
  /** A fresh file name for the (remembered) student, e.g. `zero1_ali_khoury_0928_143210.py`. */
  fileName(studentName: string, date: Date): string;
  /** The file's text. */
  contents(work: ExportedWork): string;
}

export type SketchResult =
  | {
      ok: true;
      sketch: string;
      /** Python: transpile()'s lineMap (JS line → sketch line) → JS line → Python line. */
      composeLineMap?(jsLineMap: number[]): number[];
      /** The program has no main loop: the app finishes the run after setup() (§7.8). */
      endsAfterSetup: boolean;
      /** The program reads the Serial Monitor (Python `input()`, §7.9). */
      usesInput: boolean;
      /** Python: runtime console messages in Python words (§5.9). */
      pythonize?(msg: ConsoleMessage, serialTail: string): ConsoleMessage;
      /**
       * Python: the program's warnings on its own lines (the translator's W-…, and transpile()'s
       * warnings as W-sketch); the console shows them instead of the sketch's.
       */
      diagnostics?: Diagnostic[];
    }
  | SketchFailure;

export interface SketchFailure {
  ok: false;
  /** 'loading': the mode's editor could not be loaded; 'errors': the program has errors. */
  reason: 'loading' | 'errors';
  /**
   * The console status line, e.g. "2 errors — fix and run again"; for 'errors' the header's run
   * status shows its words before " — " ("2 errors").
   */
  message: string;
  /** The errors, on lines of the mode's own program (`ModeController.lineSource`). */
  diagnostics?: Diagnostic[];
  /** An error without a line for the console (Blocks: "Block code error: …"). */
  detail?: string;
}

export interface ExportedWork {
  kind: AppMode;
  /** The Arduino sketch (Python with errors: the placeholder of src/sketch/placeholder.ts). */
  sketch: string;
  /** `#code=…`, `#blocks=…` or `#python=…`. */
  hash: string;
  /** The Blockly workspace JSON in Blocks mode, else ''. */
  workspaceJson: string;
  /** The Python program in Python mode, else ''. */
  python: string;
  /** Python mode: the Python line of a sketch line (for upload compile errors). */
  mapLine?(sketchLine: number): number;
  /** Python mode: an error in the generated sketch in the student's words (X-sketch-error, for upload compile errors). */
  sketchError?(message: string): string;
  /**
   * Why the sketch cannot be downloaded, opened in the Arduino IDE or uploaded (Python with
   * errors); Copy link and Hand in still work.
   */
  sketchProblem?: string;
}

export interface ModeController {
  readonly id: AppMode;
  readonly button: { label: string; title: string };
  /** The tab selected on entering the mode ('code' | 'blocks' | 'python'). */
  readonly firstTab: TabId;
  /** The Code tab shows the read-only mirror (Blocks, Python) instead of the student's sketch (Code). */
  readonly mirrorsCode: boolean;
  /** The texts around the mirror; null in Code mode. */
  readonly mirror: MirrorWords | null;
  readonly words: ModeWords;
  /** The console texts of a run in this mode (§7.8). */
  readonly runWords: RunWords;
  /** Share ▾ → "Download .py" in Python mode; absent in Code and Blocks mode (§7.11). */
  readonly programFile?: ProgramFile;
  /** Where the lines of the mode's own diagnostics and of a composed line map are (the console jumps there, §7.10). */
  readonly lineSource: 'sketch' | 'python';
  /** The Examples menu in this mode ([] while the mode's chunk loads). */
  examples(): readonly MenuExample[];
  /** The mode's chunk (and with it its examples) is being downloaded: the menu says "Loading…" (§7.7). */
  examplesLoading?(): boolean;
  /**
   * The mode became the current one (the app has already shown its tabs): show its own program,
   * or the link's when `link` is given (loaded without a question: `confirmLink()` asked before).
   */
  enter(link: ModeLink | null): Promise<void>;
  /** Another mode becomes the current one. */
  leave(): void;
  /** After a mode switch: the keyboard focus into the mode's own editor (Blocks: none). */
  focus(): void;
  /** Run, live lint and every export call this; Python translates afresh (never reads the mirror). */
  sketch(): Promise<SketchResult>;
  /** The work to hand out; `{ error }` (toasted as is) while it cannot be read yet. */
  exportWork(): ExportedWork | { error: string } | null;
  loadExample(example: MenuExample): Promise<void>;
  newProgram(): Promise<void>;
  /** The blank program or an untouched example (with its title), for the Hand in dialog. */
  untouched(): HandinWork['unchanged'];
  /** Before a share link replaces the mode's program: true when nothing would be lost or the student agreed. */
  confirmLink(): Promise<boolean>;
  /** A share link opened with the page asks with confirmLink() too, like one opened later (Python, §7.6). */
  readonly confirmsStartLink?: boolean;
  /** Move the cursor to a line of the mode's own program; absent in Blocks mode (no text editor). */
  goToLine?(line: number, column?: number): void;
  /** The mode's own tab became visible or the window was resized (Blocks: Blockly measures again). */
  resize?(): void;
  /** Review mode: show the hand-in in this mode; false = the app shows the handed-in sketch in Code mode. */
  review(message: ReviewMessage): Promise<boolean>;
  /** Review mode, when `review()` returned false: the handed-in sketch is read-only in Code mode (Python, §7.13). */
  readonly reviewReadOnly?: boolean;
  /** Write pending saves now (update prompt, page hide). */
  flush(): void;
  destroy(): void;
}

/** What the app shell offers the mode controllers. */
export interface ModeHost {
  /** Inside review.html's sandbox: nothing is read from or written to storage (docs/CLASSROOM.md §4.11). */
  readonly review: boolean;
  readonly console: ConsolePanel;
  /** Where a mode's dialogs are appended (the app root; Python's "What works"). */
  readonly dialogParent: HTMLElement;
  /** Whether `mode` is the current mode (a chunk that finished loading late checks it). */
  isCurrent(mode: ModeController): boolean;
  /** Make `id` the current mode (header, tabs, `z1.mode`) without entering it. */
  setMode(id: AppMode): void;
  /** The panel element of a tab. */
  panel(tab: TabId): HTMLElement;
  selectTab(tab: TabId): void;
  isTabSelected(tab: TabId): boolean;
  toast(text: string): void;
  /** The mode's examples changed (its chunk arrived): the Examples menu shows them while it is current. */
  examplesChanged(mode: ModeController): void;
  /**
   * The sketch made from the mode's program, for the read-only Code tab; `problem` (null = none)
   * disables "Edit a copy in Code mode" and is its tooltip. Ignored unless `mode` is current.
   */
  showMirror(mode: ModeController, sketch: string, problem: string | null): void;
  /** A lazy chunk could not be loaded: console error and status, and the update prompt after a redeploy. */
  loadFailed(what: string, err: unknown): void;
  /** The editors' Ctrl/Cmd+Enter and Esc. */
  run(): void;
  stop(): void;
}
