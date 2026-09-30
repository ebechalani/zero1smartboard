/**
 * Application shell: header with actions (the Share menu carries Hand in,
 * the class platform's entry, when it is configured) and the Code | Blocks |
 * Python mode switch, board + inputs on the left, tabbed editors/monitors on
 * the right, console below. Wires the transpiler, the executor and the virtual
 * board together and drives the animation loop.
 *
 * Everything that differs between the modes lives in the mode registry
 * (src/ui/modes/, docs/PYTHON.md §7.1): this file never compares the mode with
 * a literal (tests/app-mode-registry.test.ts). Each mode keeps its own program
 * (§7.6). In Blocks and Python mode the Code tab shows the sketch made from
 * the program in a second, read-only editor (the mirror, §7.5), and Run
 * transpiles that sketch through the very same pipeline.
 */
import { transpile } from '../transpiler';
import { Executor } from '../runtime/executor';
import type { Zero1Board } from '../zero1';
import { createBoardView, type BoardView } from './board-view';
import { findExample, type Example } from '../examples';
import type { Clock, ConsoleMessage, Diagnostic, ExecutorStatus, TranspileResult } from '../types';
import { codeFromHash, createEditor, type Editor } from './editor';
import { APP_MODES, blocksFromHash, isAppMode, loadMode, saveMode, type AppMode } from './blocks-panel';
import { createSerialMonitor, detectBaud, type SerialMonitor } from './serial-monitor';
import { createPinMap, type PinMap } from './pinmap';
import { createConsolePanel, type ConsolePanel } from './console-panel';
import { createControls, type Controls } from './controls';
import { createSettingsDialog, type SettingsDialog } from './settings';
import { createMenu, type Menu, type MenuGroup } from './menu';
import { downloadTextFile, sketchFileName } from './sketch-file';
import { createArduinoIdeDialog, type ArduinoIdeDialog } from './arduino-ide-dialog';
import { createHandinDialog, type HandinDialog, type HandinWork } from './handin-dialog';
import { createExamplesMenu, type ExamplesMenu, type MenuExample } from './examples-menu';
import { createBuzzerAudio, loadMuted, saveMuted, type BuzzerAudio } from './audio';
import { isClassroomConfigured } from '../classroom/firebase';
import { STUDENT_ERROR_TEXT } from '../classroom/errors';
import { currentStudentName } from '../classroom/session-store';
import { classFromHash, pythonFromHash } from '../share-link';
import { placeholderErrorCount } from '../sketch/placeholder';
import { installUploadButton, type InstalledUploadButton, type UploadPayload } from '../upload';
import { CodeMode } from './modes/code-mode';
import { BlocksMode } from './modes/blocks-mode';
import { PythonMode } from './modes/python-mode';
import type {
  ExportedWork,
  HashPayload,
  ModeController,
  ModeHost,
  ModeLink,
  ProgramFile,
  ReviewMessage,
  RunWords,
  SketchFailure,
  TabId,
} from './modes/types';

export { BLANK_SKETCH } from './modes/code-mode';

/** Tooltip of the Share ▾ button; the Hand in item exists only when the class platform is configured. */
const SHARE_TITLE = 'Share: copy the link or download an .ino file';
const SHARE_TITLE_CLASS = 'Share: copy the link, download an .ino file or hand in to your teacher';
/** Shown when the clipboard refuses the link. */
export const COPY_FALLBACK = 'Press Ctrl+C to copy the link';

/** The board view may expose `pulseRx()` to flash the RX LED when the monitor sends text. */
type BoardViewWithRx = BoardView & { pulseRx?(): void };

/** Delay between an edit and the live syntax check. */
const LIVE_LINT_MS = 700;
/** Refresh rate of the pin map and input sliders. */
const SLOW_REFRESH_MS = 100;
const TOAST_MS = 2500;
/** How long "Copied into Code mode · Undo" stays (§7.6). */
const UNDO_TOAST_MS = 8000;
/** What pythonize() gets of the Serial Monitor: its last 2 KB (§7.8). */
const SERIAL_TAIL_CHARS = 2048;
/** A program without a main loop: how long a tone still sounding may go on after the end of the program (§7.8). */
const FINISH_TONE_MS = 2000;
/** The Serial Monitor tab's accessible name while its activity dot shows (§7.9). */
const SERIAL_NEW_OUTPUT = 'Serial Monitor, new output';

/**
 * Right-column tabs in display order (docs/PYTHON.md §7.2); the Blocks and
 * Python tabs exist only in their own mode. The Code tab carries a padlock
 * while it shows the read-only mirror.
 */
const TABS: readonly { id: TabId; label: string; onlyIn?: AppMode; lock?: true }[] = [
  { id: 'blocks', label: 'Blocks', onlyIn: 'blocks' },
  { id: 'code', label: 'Code', lock: true },
  { id: 'serial', label: 'Serial Monitor' },
  { id: 'pinmap', label: 'Pin Map' },
  { id: 'python', label: 'Python', onlyIn: 'python' },
  { id: 'js', label: 'Generated JS' },
];

/** The tooltip of "Edit a copy in Code mode" while it can be used. */
const COPY_TITLE = 'Put a copy of this sketch into Code mode, where you can change it by hand';

/** A padlock (inline SVG) on the Code tab while it shows the read-only mirror. */
const LOCK_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" focusable="false"><path fill="currentColor" d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2z"/></svg>';

/** Browser messages for a lazy chunk that could not be fetched (after a redeploy the hashed file is gone). */
const CHUNK_LOAD_FAILURE = /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed|ChunkLoadError/i;

/**
 * Review mode (docs/CLASSROOM.md §4.11): the simulator runs a hand-in inside
 * review.html's `<iframe sandbox="allow-scripts">`, so its origin is opaque
 * ('null'). Only then: on the site's own origin a `#review` hash is a link
 * that must go to review.html (see mountApp).
 */
export function isReviewFrame(): boolean {
  try {
    return location.hash === '#review' && self.origin === 'null';
  } catch {
    return false;
  }
}

/** The payload of a `z1-review` message, or null when it is not one. */
function reviewMessageOf(data: unknown): ReviewMessage | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as { type?: unknown; payload?: unknown };
  if (o.type !== 'z1-review' || !o.payload || typeof o.payload !== 'object') return null;
  const p = o.payload as Record<string, unknown>;
  if (!isAppMode(p.kind)) return null;
  if (typeof p.code !== 'string' || typeof p.workspaceJson !== 'string') return null;
  return { kind: p.kind, code: p.code, workspaceJson: p.workspaceJson, python: typeof p.python === 'string' ? p.python : '' };
}

/**
 * Mount the simulator into `root` and start the animation loop.
 */
export function mountApp(root: HTMLElement, board: Zero1Board, clock: Clock): App {
  // A review link opened on the site's own origin: a hand-in never runs here (docs/CLASSROOM.md §3.4).
  if (!isReviewFrame() && /^#(review|rid)=/.test(location.hash)) location.replace(`./review.html${location.hash}`);
  return new App(root, board, clock);
}

export class App {
  private readonly boardView: BoardViewWithRx;
  private readonly serialMonitor: SerialMonitor;
  private readonly pinMap: PinMap;
  private readonly consolePanel: ConsolePanel;
  private readonly controls: Controls;
  private readonly settings: SettingsDialog;
  /** Header "Share ▾": Hand in (when configured), Copy link, Download .py (Python), Download .ino. */
  private readonly shareMenu: Menu;
  /** Header "Settings ▾": Reset the board, Board settings…. */
  private readonly settingsMenu: Menu;
  private readonly ideDialog: ArduinoIdeDialog;
  /** "Upload to board" (shown only in browsers with Web Serial and when the toolchain is deployed). */
  private readonly uploadButton: InstalledUploadButton;
  /** The Hand in dialog of the class platform; null while it is not configured (no menu item either). */
  private readonly handinDialog: HandinDialog | null;
  private readonly examplesMenu: ExamplesMenu<MenuExample>;
  private readonly audio: BuzzerAudio;

  // --- the modes (src/ui/modes) ------------------------------------------------
  private readonly codeMode: CodeMode;
  private readonly modes: Record<AppMode, ModeController>;
  private mode: ModeController;
  /** The Code tab's read-only editor: the sketch made from the blocks / the Python program (§7.5). */
  private readonly mirror: Editor;

  private readonly runButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly newButton: HTMLButtonElement;
  private readonly ideButton: HTMLButtonElement;
  private readonly uploadSlot: HTMLButtonElement;
  private readonly statusBox: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly toastBox: HTMLElement;
  private readonly jsView: HTMLElement;
  private readonly codeBanner: HTMLElement;
  private readonly codeBannerText: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly modeButtons = new Map<AppMode, HTMLButtonElement>();
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private readonly panels = new Map<TabId, HTMLElement>();

  private executor: Executor | null = null;
  /** Incremented by every run(); an older run that is still waiting to start gives up. */
  private runToken = 0;
  /**
   * The current run of a program without a main loop (§7.8): the frame loop ends it once setup()
   * returned and no tone sounds (2 s at most). `since`: board time when setup() was seen done;
   * `finishedAt`: board time when it was ended.
   */
  private finishing: { executor: Executor; since: number | null; finishedAt: number | null } | null = null;
  /** The console hint of the current run, until the first print while the Serial Monitor is hidden (§7.9). */
  private printHint: RunWords['printHint'] | null = null;
  private activeTab: TabId = 'code';
  private running = false;
  private lastMillisShown = -1;
  private lastJsSource: string | null = null;
  private readonly lintTimers = new Map<Editor, ReturnType<typeof setTimeout>>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private frameHandle = 0;
  private readonly slowTimer: ReturnType<typeof setInterval>;

  /** Review mode: inside review.html's sandbox; no storage, no links, no hand-in (docs/CLASSROOM.md §4.11). */
  private readonly review: boolean;
  private reviewListener: ((e: MessageEvent) => void) | null = null;

  /** What the mode controllers may use of the shell. */
  private readonly host: ModeHost;

  constructor(
    private readonly root: HTMLElement,
    private readonly board: Zero1Board,
    private readonly clock: Clock,
  ) {
    document.body.dataset.running = 'false';
    const review = isReviewFrame();
    this.review = review;
    const fromLink = review ? null : takeHashPayload();
    const modeLink: ModeLink | null = fromLink && fromLink.kind !== 'class' ? fromLink : null;
    root.innerHTML = this.template();

    this.runButton = this.slot<HTMLButtonElement>('run');
    this.stopButton = this.slot<HTMLButtonElement>('stop');
    this.newButton = this.slot<HTMLButtonElement>('new');
    this.ideButton = this.slot<HTMLButtonElement>('ide');
    this.uploadSlot = this.slot<HTMLButtonElement>('upload');
    this.statusBox = this.slot('status');
    this.statusText = this.slot('status-text');
    this.toastBox = this.slot('toast');
    this.jsView = this.slot('js-code');
    this.codeBanner = this.slot('code-banner');
    this.codeBannerText = this.slot('code-banner-text');
    this.copyButton = this.slot<HTMLButtonElement>('copy-to-code');
    this.copyButton.hidden = review; // the review frame writes nothing, not even z1.code

    for (const tab of TABS) {
      this.tabButtons.set(tab.id, this.slot<HTMLButtonElement>(`tab-${tab.id}`));
      this.panels.set(tab.id, this.slot(`panel-${tab.id}`));
    }

    // --- panels -----------------------------------------------------------
    this.consolePanel = createConsolePanel(this.slot('console'), {
      onJumpToLine: (line, source) => this.jumpToLine[source ?? 'sketch'](line),
    });

    this.host = {
      review,
      console: this.consolePanel,
      dialogParent: root,
      isCurrent: (mode) => mode === this.mode,
      setMode: (id) => this.setMode(id),
      panel: (tab) => this.panels.get(tab)!,
      selectTab: (tab) => this.selectTab(tab),
      isTabSelected: (tab) => this.activeTab === tab,
      toast: (text) => this.toast(text),
      examplesChanged: (mode) => {
        if (mode === this.mode) this.examplesMenu.setExamples(mode.examples());
      },
      showMirror: (mode, sketch, problem) => this.showMirror(mode, sketch, problem),
      loadFailed: (what, err) => this.loadFailed(what, err),
      run: () => void this.run(),
      stop: () => void this.stop(),
    };

    this.mirror = createEditor(this.slot('mirror'), {
      initialCode: '',
      readOnlyMirror: true,
      ariaLabel: 'Arduino sketch (read only)',
      onRun: () => void this.run(),
      onStop: () => void this.stop(),
      onReadOnlyInput: () => {
        const words = this.mode.mirror;
        if (words) this.toast(words.typing);
      },
      onChange: () => this.scheduleLiveLint(this.mirror),
    });
    this.codeMode = new CodeMode(this.host, this.slot('editor'), () => this.scheduleLiveLint(this.codeMode.editor));
    this.modes = { code: this.codeMode, blocks: new BlocksMode(this.host), python: new PythonMode(this.host) };
    // A share link decides the mode (a `#code=` link opens in Code mode even after a Blocks visit).
    // In review mode the payload decides it later; nothing is read from storage.
    this.mode = this.modes[review ? this.codeMode.id : (modeLink?.kind ?? loadMode())];

    this.boardView = createBoardView(this.slot('board'), board);

    this.serialMonitor = createSerialMonitor(this.panels.get('serial')!, {
      onSend: (text) => {
        board.serial.inject(text);
        this.boardView.pulseRx?.();
      },
    });
    board.serial.onTx((text) => {
      this.serialMonitor.append(text);
      if (this.activeTab !== 'serial') this.showSerialActivity();
    });

    this.pinMap = createPinMap(this.panels.get('pinmap')!, board);

    this.audio = createBuzzerAudio({ muted: review ? false : loadMuted() });
    this.controls = createControls(this.slot('inputs'), board, {
      initialMuted: this.audio.isMuted(),
      onMuteChange: (muted) => {
        this.audio.setMuted(muted);
        if (!review) saveMuted(muted);
      },
    });

    this.settings = createSettingsDialog(root, {
      persist: !review,
      getConfig: () => board.config,
      onApply: (config) => {
        board.applyConfig(config);
        this.toast('Board settings saved');
      },
    });

    this.ideDialog = createArduinoIdeDialog(root);
    this.uploadButton = installUploadButton({
      button: this.uploadSlot,
      parent: root,
      getSketch: () => this.uploadPayload(),
      onConsole: (msg) => this.consolePanel.push(msg),
      toast: (text) => this.toast(text),
    });
    this.handinDialog =
      !review && isClassroomConfigured()
        ? createHandinDialog(root, {
            onSessionChange: (name) => this.setHandinName(name),
            onAppUpdated: () => this.showUpdatePrompt(),
            toast: (text) => this.toast(text),
          })
        : null;

    // The menu lists the current mode's examples; a pick goes to that mode (never decided by the example's shape).
    this.examplesMenu = createExamplesMenu<MenuExample>(this.slot('examples'), this.mode.examples(), (example) => void this.mode.loadExample(example));

    this.settingsMenu = createMenu(
      this.slot('settings'),
      { icon: '⚙', label: 'Settings', ariaLabel: 'Open the settings menu', title: 'Settings: reset the board, board settings', listLabel: 'Settings', compact: true },
      [
        {
          items: [
            { label: 'Reset the board', title: 'Stop and reset the board: all pins and peripherals back to their power-on state', onSelect: () => void this.reset() },
            { label: 'Board settings…', title: 'How the real board is wired', onSelect: () => this.settings.open() },
          ],
        },
      ],
    );
    this.shareMenu = createMenu(
      this.slot('share'),
      { icon: '🔗', label: 'Share', ariaLabel: 'Open the share menu', title: this.handinDialog ? SHARE_TITLE_CLASS : SHARE_TITLE, listLabel: 'Share your work', compact: true },
      this.shareItems(),
    );

    // --- header actions ---------------------------------------------------
    this.createModeButtons();
    this.newButton.addEventListener('click', () => void this.newSketch());
    this.runButton.addEventListener('click', () => void this.run());
    this.stopButton.addEventListener('click', () => void this.stop());
    this.ideButton.addEventListener('click', () => this.openInIde());
    this.copyButton.addEventListener('click', () => void this.copyToCode());
    if (this.handinDialog) this.setHandinName(currentStudentName()); // the previous student's name shows until they press Change
    this.slot('reload').addEventListener('click', () => location.reload());
    if (review) {
      // The teacher reviews one hand-in: no new work, no examples, no links out of the sandbox.
      for (const slot of ['new', 'examples', 'share', 'ide']) this.slot(slot).hidden = true;
      this.uploadButton.dispose(); // review mode: no upload from a hand-in
    }

    for (const tab of TABS) {
      const button = this.tabButtons.get(tab.id)!;
      button.addEventListener('click', () => this.selectTab(tab.id));
      button.addEventListener('keydown', (e) => this.onTabKeyDown(e, tab.id));
    }

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keydown', this.onBlocksKeyDown, true);
    if (!review) window.addEventListener('hashchange', this.onHashChange);
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('vite:preloadError', this.onPreloadError);

    // --- loops ------------------------------------------------------------
    this.applyMode();
    void this.mode.enter(modeLink);
    this.setStatus('idle', 'Ready');
    this.scheduleLiveLint(this.codeMode.editor);
    this.frameHandle = requestAnimationFrame(this.frame);
    this.slowTimer = setInterval(() => {
      this.controls.refresh();
      if (this.activeTab === 'pinmap') this.pinMap.refresh();
    }, SLOW_REFRESH_MS);
    if (fromLink?.kind === 'class') this.openClassLink(fromLink.code);
    if (review) this.startReview();
  }

  // -------------------------------------------------------------------------
  // Review mode (docs/CLASSROOM.md §1.4, §4.11)
  // -------------------------------------------------------------------------

  /**
   * Ask review.html for the hand-in and wait for it. The frame has an opaque
   * origin, so it posts to '*'; the answer is accepted only from the parent
   * window on the site's own origin. Nothing runs until the teacher presses Run.
   */
  private startReview(): void {
    const origin = new URL(location.href).origin;
    this.reviewListener = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== origin) return;
      const payload = reviewMessageOf(event.data);
      if (payload) void this.loadReview(payload);
    };
    window.addEventListener('message', this.reviewListener);
    window.parent.postMessage({ type: 'z1-review-ready' }, '*');
  }

  /**
   * Show the hand-in in its own mode when that mode can (Blocks: the blocks when they can be
   * read), else the handed-in sketch in Code mode, with a banner naming what it was made from.
   */
  private async loadReview(payload: ReviewMessage): Promise<void> {
    const kind = this.modes[payload.kind];
    if (await kind.review(payload)) return;
    this.setMode(this.codeMode.id);
    this.codeMode.showHandedIn(payload.code);
    const note = kind.mirror?.review ?? null;
    this.codeBannerText.textContent = note ?? '';
    this.codeBanner.hidden = note === null;
    this.selectTab(this.codeMode.firstTab);
  }

  /**
   * The site was redeployed under this tab: a lazy chunk (Blockly, Python,
   * the class features) is gone. Save the work, then ask for a reload.
   */
  private showUpdatePrompt(): void {
    for (const mode of this.allModes()) mode.flush();
    this.slot('update-text').textContent = STUDENT_ERROR_TEXT.app_updated;
    this.slot('update').hidden = false;
  }

  private readonly onPreloadError = (e: Event): void => {
    e.preventDefault(); // Vite would rethrow and reload on its own; the banner asks first
    this.showUpdatePrompt();
  };

  /** A mode's lazy chunk could not be loaded (Blockly, the Python chunk). */
  private loadFailed(what: string, err: unknown): void {
    this.consolePanel.push({ level: 'error', text: `The ${what} could not be loaded: ${errorText(err)}` });
    this.consolePanel.setStatus(`The ${what} could not be loaded — check your connection and reload`);
    if (CHUNK_LOAD_FAILURE.test(errorText(err)) && navigator.onLine !== false) this.showUpdatePrompt();
  }

  // -------------------------------------------------------------------------
  // Run / stop / reset
  // -------------------------------------------------------------------------

  /**
   * Transpile the current mode's sketch (the editor text in Code mode, the
   * sketch made from the blocks or the Python program otherwise) and start it,
   * restarting if one is running. Like the Arduino IDE, a sketch that does not
   * compile leaves the board running whatever it was running before.
   */
  async run(): Promise<void> {
    const mode = this.mode;
    const prepared = await mode.sketch();
    if (!prepared.ok) {
      this.showSketchFailure(mode, prepared);
      return;
    }
    const code = prepared.sketch;
    const result = safeTranspile(code);
    this.consolePanel.clear();
    // Python: the console shows the program's own warnings (on Python lines), not the sketch's.
    this.showDiagnostics(result, !prepared.diagnostics || !result.ok);
    for (const d of prepared.diagnostics ?? []) {
      this.consolePanel.push({ level: d.severity === 'error' ? 'error' : 'warn', text: d.message, line: d.line, source: mode.lineSource });
    }

    if (!result.ok) {
      const count = result.errors.length;
      const errors = `${count} error${count === 1 ? '' : 's'}`;
      this.consolePanel.setStatus(`${errors} — fix and run again`);
      if (!this.running) this.setStatus('error', errors);
      const first = result.errors[0];
      // In Blocks and Python mode the sketch is machine-made: the cursor stays where the student works.
      if (first && !mode.mirrorsCode) this.codeMode.editor.goToLine(first.line, first.column);
      return;
    }
    this.showGeneratedJs(result.js, code);

    const token = ++this.runToken;
    await this.stopExecutor();
    if (token !== this.runToken) return; // Run was pressed again while we waited: that run takes over.

    // A real board restarts millis() at 0 on every upload.
    this.clock.reset();
    this.board.reset();
    if (this.serialMonitor.getText().length > 0) this.serialMonitor.addDivider('sketch restarted');
    this.serialMonitor.setBaud(detectBaud(code));

    // Python: runtime lines are Python lines, in Python words.
    const { composeLineMap, pythonize } = prepared;
    const executor = new Executor({
      board: this.board,
      lineMap: composeLineMap ? composeLineMap(result.lineMap) : result.lineMap,
      onConsole: (msg: ConsoleMessage) => {
        const shown = pythonize ? pythonize(msg, this.serialMonitor.getText().slice(-SERIAL_TAIL_CHARS)) : msg;
        this.consolePanel.push(composeLineMap ? { ...shown, source: mode.lineSource } : shown);
      },
    });
    this.executor = executor;
    const finishing = prepared.endsAfterSetup ? { executor, since: null, finishedAt: null } : null;
    this.finishing = finishing;
    this.printHint = mode.runWords.printHint ?? null;
    this.setRunning(true);
    this.setStatus('running', 'Running · 0 ms');
    this.consolePanel.setStatus('Running');
    this.consolePanel.push({ level: 'info', text: mode.runWords.started });
    // input() reads the Serial Monitor: show it, with the cursor in its send box (§7.9).
    if (prepared.usesInput) this.selectTab('serial');

    try {
      await executor.run(result.js);
    } catch (err) {
      // The executor never rejects by contract; a bug in it must still not leave the UI stuck on "Running".
      this.consolePanel.push({ level: 'error', text: `The simulator crashed: ${errorText(err)}` });
    }
    if (this.executor !== executor) return; // a newer run took over
    this.executor = null;
    if (this.finishing === finishing) this.finishing = null;
    this.printHint = null;
    this.setRunning(false);
    const millis = Math.floor(this.clock.now());
    if (executor.status === 'error') {
      this.setStatus('error', `Error at ${millis} ms`);
      this.consolePanel.setStatus('Stopped by an error — click the message to jump to the line');
    } else if (finishing?.finishedAt != null) {
      this.setStatus('stopped', `Finished at ${finishing.finishedAt} ms`);
      this.consolePanel.setStatus('Finished');
      this.consolePanel.push({ level: 'info', text: mode.runWords.finished ?? mode.runWords.stopped(executor.loops, true) });
    } else {
      this.setStatus('stopped', `Stopped at ${millis} ms`);
      this.consolePanel.setStatus('Stopped');
      this.consolePanel.push({ level: 'info', text: mode.runWords.stopped(executor.loops, prepared.endsAfterSetup) });
    }
  }

  /**
   * A program without a main loop (§7.8): once setup() returned (the first loop() call is
   * done), the run ends as soon as no tone sounds, or 2 s of board time later. Checked in the
   * frame loop.
   */
  private checkFinished(now: number): void {
    const run = this.finishing;
    if (!run || run.finishedAt !== null || this.executor !== run.executor || run.executor.loops < 1) return;
    run.since ??= now;
    const sounding = Boolean(this.board.buzzer.state.freq); // null (or 0) when silent
    if (sounding && now - run.since < FINISH_TONE_MS) return;
    run.finishedAt = Math.floor(now);
    void run.executor.stop();
  }

  /** Stop the running sketch (no-op when idle). */
  async stop(): Promise<void> {
    await this.stopExecutor();
  }

  /** Stop, return the board to power-on state and clear the serial monitor. */
  async reset(): Promise<void> {
    await this.stopExecutor();
    this.board.reset();
    this.serialMonitor.clear();
    this.setStatus('idle', 'Ready');
    this.consolePanel.setStatus('Board reset');
    this.consolePanel.push({ level: 'info', text: 'Board reset: all pins and peripherals are back to their power-on state.' });
  }

  /**
   * Run found nothing to run: the mode's editor could not be loaded, or its
   * program has errors (Python) / cannot be turned into a sketch (Blocks).
   */
  private showSketchFailure(mode: ModeController, failure: SketchFailure): void {
    if (failure.reason === 'loading') {
      this.consolePanel.setStatus(failure.message);
      return;
    }
    this.consolePanel.clear();
    const diagnostics = failure.diagnostics ?? [];
    for (const d of diagnostics) {
      this.consolePanel.push({ level: d.severity === 'error' ? 'error' : 'warn', text: d.message, line: d.line, source: mode.lineSource });
    }
    if (failure.detail) this.consolePanel.push({ level: 'error', text: failure.detail });
    this.consolePanel.setStatus(failure.message);
    if (!this.running) this.setStatus('error', failure.message.split(' — ')[0]);
    const first = diagnostics.find((d) => d.severity === 'error');
    if (first) mode.goToLine?.(first.line, first.column);
  }

  private async stopExecutor(): Promise<void> {
    const executor = this.executor;
    if (!executor) return;
    await executor.stop();
  }

  private setRunning(on: boolean): void {
    this.running = on;
    document.body.dataset.running = on ? 'true' : 'false';
    this.stopButton.disabled = !on;
    this.runButton.classList.toggle('is-restart', on);
    this.updateRunLabel();
    this.lastMillisShown = -1;
  }

  /** "Run the sketch (Ctrl+Enter)", or "Restart …" while a sketch runs. */
  private updateRunLabel(): void {
    const label = this.mode.words.run;
    this.runButton.setAttribute('aria-label', this.running ? label.replace(/^Run\b/, 'Restart') : label);
  }

  /**
   * The run status in the header. Keep the texts short ("2 errors", "Error at
   * 1523 ms") so the header stays on one row at 1366-1536 px; the console
   * status line has the full sentence.
   */
  private setStatus(status: ExecutorStatus, text: string): void {
    this.statusBox.dataset.status = status;
    if (this.statusText.textContent !== text) this.statusText.textContent = text;
  }

  // -------------------------------------------------------------------------
  // Diagnostics & generated JS
  // -------------------------------------------------------------------------

  /** Transpile `editor`'s text a moment after it changed and underline the problems in it. */
  private scheduleLiveLint(editor: Editor): void {
    const pending = this.lintTimers.get(editor);
    if (pending !== undefined) clearTimeout(pending);
    this.lintTimers.set(
      editor,
      setTimeout(() => {
        this.lintTimers.delete(editor);
        const code = editor.getCode();
        // The stand-in for a Python program with errors is no sketch: its errors are in the Python tab.
        const result = placeholderErrorCount(code) === null ? safeTranspile(code) : null;
        editor.setDiagnostics(!result ? [] : result.ok ? result.warnings : [...result.errors, ...result.warnings]);
      }, LIVE_LINT_MS),
    );
  }

  /** The Code tab's visible editor: the student's sketch, or the mirror in Blocks and Python mode. */
  private sketchEditor(): Editor {
    return this.mode.mirrorsCode ? this.mirror : this.codeMode.editor;
  }

  private showDiagnostics(result: TranspileResult, toConsole: boolean): void {
    const errors: Diagnostic[] = result.ok ? [] : result.errors;
    const all = [...errors, ...result.warnings];
    this.sketchEditor().setDiagnostics(all);
    if (!toConsole) return;
    // In Blocks mode the sketch is machine-generated: an error in it is a generator bug, not the student's.
    const prefix = this.mode.mirror?.errorPrefix ?? '';
    for (const d of all) {
      const text = d.severity === 'error' ? `${prefix}${d.message}` : d.message;
      this.consolePanel.push({ level: d.severity === 'error' ? 'error' : 'warn', text, line: d.line });
    }
  }

  private showGeneratedJs(js: string, source: string): void {
    this.lastJsSource = source;
    this.jsView.textContent = js;
  }

  /** Make sure the Generated JS tab shows the current sketch (transpiling if needed). */
  private refreshGeneratedJs(): void {
    const code = this.sketchEditor().getCode();
    if (code === this.lastJsSource) return;
    this.lastJsSource = code;
    if (placeholderErrorCount(code) !== null) {
      this.jsView.textContent = '// Fix the errors in your Python program to see the generated JavaScript.';
      return;
    }
    const result = safeTranspile(code);
    if (result.ok) {
      this.showGeneratedJs(result.js, code);
    } else {
      this.jsView.textContent = result.errors
        .map((e) => `// line ${e.line}: ${e.message}`)
        .join('\n')
        .concat('\n// Fix the errors above to see the generated JavaScript.');
    }
  }

  /**
   * Console "line N" (§7.10): a Python line opens the Python tab (switching to Python mode when
   * needed, e.g. after a run in Python mode) and moves the Python editor there; a sketch line
   * opens the Code tab of the current mode.
   */
  private readonly jumpToLine: Record<'sketch' | 'python', (line: number) => void> = {
    sketch: (line) => {
      this.selectTab('code');
      this.sketchEditor().goToLine(line);
    },
    python: (line) => void this.goToProgramLine(this.modes.python, line),
  };

  private async goToProgramLine(mode: ModeController, line: number): Promise<void> {
    if (mode !== this.mode) await this.switchMode(mode.id);
    if (mode === this.mode) mode.goToLine?.(line);
  }

  // -------------------------------------------------------------------------
  // Modes (src/ui/modes, docs/PYTHON.md §7.1, §7.6)
  // -------------------------------------------------------------------------

  /** The header's Code | Blocks | Python switch, in APP_MODES order. */
  private createModeButtons(): void {
    const group = this.slot('modes');
    for (const id of APP_MODES) {
      const mode = this.modes[id];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'z1-btn z1-mode-btn';
      button.dataset.slot = `mode-${id}`;
      button.title = mode.button.title;
      button.textContent = mode.button.label;
      button.addEventListener('click', () => void this.switchMode(id));
      group.appendChild(button);
      this.modeButtons.set(id, button);
    }
  }

  /**
   * Header mode switch: the target mode shows its own program. Nothing is
   * copied and nothing is asked (§7.6); "Edit a copy in Code mode" is the
   * only way a sketch made from blocks or Python reaches the Code editor.
   */
  async switchMode(id: AppMode): Promise<void> {
    const target = this.modes[id];
    if (target === this.mode) return;
    this.setMode(id);
    this.toast(`${target.button.label} mode`);
    await target.enter(null);
    if (this.mode === target) target.focus();
  }

  private setMode(id: AppMode): void {
    const next = this.modes[id];
    if (next !== this.mode) this.mode.leave();
    this.mode = next;
    if (!this.review) saveMode(id);
    this.applyMode();
  }

  /** Reflect the current mode in the header, the tab list, the Code tab and the Examples menu. */
  private applyMode(): void {
    const mode = this.mode;
    document.body.dataset.mode = mode.id;
    for (const [id, button] of this.modeButtons) button.setAttribute('aria-pressed', id === mode.id ? 'true' : 'false');
    for (const tab of TABS) this.tabButtons.get(tab.id)!.hidden = !this.isTabVisible(tab.id);

    // The Code tab: the student's sketch, or the read-only mirror with its banner and padlock.
    const words = mode.mirror;
    this.slot('editor').hidden = words !== null;
    this.slot('mirror').hidden = words === null;
    this.codeBanner.hidden = words === null;
    this.slot('code-lock').hidden = words === null;
    const codeTab = this.tabButtons.get('code')!;
    if (words) {
      this.codeBannerText.textContent = words.banner;
      this.mirror.setLabel(words.label);
      codeTab.setAttribute('aria-label', 'Code (read only)');
    } else {
      codeTab.removeAttribute('aria-label');
    }

    // Header words: what Run, Stop, New, Arduino IDE and Upload act on.
    this.updateRunLabel();
    this.stopButton.setAttribute('aria-label', mode.words.stop);
    this.newButton.setAttribute('aria-label', mode.words.newAria);
    this.newButton.title = mode.words.newTitle;
    this.ideButton.setAttribute('aria-label', mode.words.ide);
    this.uploadSlot.setAttribute('aria-label', mode.words.upload);

    this.examplesMenu.setExamples(mode.examples());
    this.shareMenu.setItems(this.shareItems());
    // Python's input() reads one line: the Serial Monitor sends Newline in Python mode (§7.9).
    this.serialMonitor.forceNewline(mode.runWords.newlineOnly ?? null);
    this.selectTab(mode.firstTab);
  }

  /** A mode's sketch for the mirror (only the current mode's is shown). */
  private showMirror(mode: ModeController, sketch: string, problem: string | null): void {
    if (mode !== this.mode || !mode.mirrorsCode) return;
    if (this.mirror.getCode() !== sketch) this.mirror.setCode(sketch);
    this.copyButton.disabled = problem !== null;
    this.copyButton.title = problem ?? COPY_TITLE;
  }

  /**
   * "Edit a copy in Code mode" (§7.6): the sketch made from the blocks / the
   * Python program replaces the Code editor's text (asking first when that is
   * hand-written; Undo brings it back), then Code mode opens.
   */
  private async copyToCode(): Promise<void> {
    const from = this.mode;
    const result = await from.sketch();
    if (from !== this.mode) return; // the student switched modes meanwhile
    if (!result.ok) {
      this.toast(result.message);
      return;
    }
    if (!this.codeMode.confirmCopy()) return;
    this.codeMode.copyIn(result.sketch);
    await this.switchMode(this.codeMode.id);
    this.toast('Copied into Code mode', { label: 'Undo', onSelect: () => this.codeMode.undoCopy() }, UNDO_TOAST_MS);
  }

  private allModes(): ModeController[] {
    return APP_MODES.map((id) => this.modes[id]);
  }

  // -------------------------------------------------------------------------
  // New, examples, sharing, tabs
  // -------------------------------------------------------------------------

  /**
   * Header "New": the current mode's blank program (Code: the Arduino IDE's
   * File > New), asking first when work would be lost. Like loading an
   * example, it does not stop a running sketch: the board keeps running the
   * last upload until Run or Stop.
   */
  async newSketch(): Promise<void> {
    await this.mode.newProgram();
  }

  /**
   * The current work to hand out; null (with a toast) while the mode cannot
   * produce it yet (the blocks or Python are still loading).
   */
  private exportWork(): ExportedWork | null {
    const work = this.mode.exportWork();
    if (work && 'error' in work) {
      this.toast(work.error);
      return null;
    }
    return work;
  }

  /** The work for a file or a board: refused (with a toast) while it has no real sketch (Python with errors). */
  private boardWork(): ExportedWork | null {
    const work = this.exportWork();
    if (work?.sketchProblem) {
      this.toast(work.sketchProblem);
      return null;
    }
    return work;
  }

  /**
   * Share ▾ → Copy link: the `#code=` / `#blocks=` / `#python=` link onto the
   * clipboard. When the clipboard refuses (no permission, http://), a prompt
   * shows the link selected, ready for Ctrl+C.
   */
  private copyLink(): void {
    const work = this.exportWork();
    if (!work) return;
    const url = `${location.origin}${location.pathname}${location.search}${work.hash}`;
    const copy = navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject(new Error('clipboard unavailable'));
    copy.then(
      () => this.toast('Link copied'),
      () => {
        this.toast(COPY_FALLBACK);
        if (typeof window.prompt === 'function') window.prompt(COPY_FALLBACK, url);
      },
    );
  }

  /**
   * Share ▾ in the current mode (§7.11): Hand in (when the class platform is configured), Copy
   * link, the mode's own file (Python: Download .py), Download .ino.
   */
  private shareItems(): MenuGroup[] {
    const file = this.mode.programFile;
    return [
      {
        items: [
          ...(this.handinDialog ? [{ label: 'Hand in to my teacher', title: 'Send this work to your teacher', onSelect: () => this.handIn() }] : []),
          { label: 'Copy link', title: 'Anyone who opens the link sees your work in the simulator', onSelect: () => this.copyLink() },
          ...(file ? [{ label: file.label, title: file.title, onSelect: () => this.downloadProgram(file) }] : []),
          { label: 'Download .ino', title: 'Save the sketch for the Arduino IDE', onSelect: () => this.downloadSketch() },
        ],
      },
    ];
  }

  /** Share ▾ → Download .ino: `sketchFileName()` named after the remembered student (sketch-file.ts). */
  private downloadSketch(): void {
    const work = this.boardWork();
    if (!work) return;
    const fileName = sketchFileName(currentStudentName(), new Date());
    downloadTextFile(fileName, work.sketch);
    this.toast(`Downloading ${fileName}`);
  }

  /** Share ▾ → Download .py: the mode's own program, also while it has errors. */
  private downloadProgram(file: ProgramFile): void {
    const work = this.exportWork();
    if (!work) return;
    const fileName = file.fileName(currentStudentName(), new Date());
    downloadTextFile(fileName, file.contents(work));
    this.toast(`Downloading ${fileName}`);
  }

  /**
   * Share ▾ → Hand in to my teacher: the same work as Share, plus what the dialog warns
   * about (an untouched example or blank program, errors), then the
   * Hand in dialog (docs/CLASSROOM.md §1.2).
   */
  private handIn(joinCode?: string): void {
    const work = this.handinWork();
    if (!work || !this.handinDialog) return;
    this.handinDialog.open(work, joinCode === undefined ? undefined : { joinCode });
  }

  /** A `#class=` link: join that class (or say that classes are not set up here). */
  private openClassLink(code: string): void {
    if (!this.handinDialog) {
      this.toast(STUDENT_ERROR_TEXT.not_configured);
      return;
    }
    this.handIn(code);
  }

  /** The current work as the Hand in dialog wants it, or null while the mode is still loading. */
  private handinWork(): HandinWork | null {
    const work = this.exportWork();
    if (!work) return null;
    // A Python program with errors hands in the placeholder, which carries its error count.
    const pythonErrors = placeholderErrorCount(work.sketch);
    let errorCount = pythonErrors ?? 0;
    if (pythonErrors === null) {
      const result = safeTranspile(work.sketch);
      errorCount = result.ok ? 0 : result.errors.length;
    }
    return {
      kind: work.kind,
      code: work.sketch,
      workspaceJson: work.workspaceJson,
      python: work.python,
      unchanged: this.mode.untouched(),
      errorCount,
    };
  }

  /** The Share button reads "Share · Ali Khoury" while a name is remembered, "Share" otherwise. */
  private setHandinName(studentName: string): void {
    const button = this.shareMenu.trigger;
    let name = button.querySelector<HTMLElement>('.z1-handin-name');
    if (!name) {
      name = document.createElement('span');
      name.className = 'z1-handin-name';
      button.querySelector('.z1-btn-label')!.after(name);
    }
    name.textContent = studentName ? ` · ${studentName}` : '';
    button.setAttribute('aria-label', studentName ? `Open the share menu (hand in as ${studentName})` : 'Open the share menu');
    button.title = studentName ? `Share: copy the link, download an .ino file or hand in as ${studentName}` : SHARE_TITLE_CLASS;
  }

  /** Header "Arduino IDE": download / save / copy the sketch for the desktop Arduino IDE. */
  private openInIde(): void {
    const work = this.boardWork();
    if (!work) return;
    this.ideDialog.open({ code: work.sketch, kind: work.kind, note: this.mode.mirror?.ideNote });
  }

  /**
   * What Upload to board sends: the sketch, or `{ error }` (toasted by the upload button) while
   * there is none. In Python mode compile errors point at Python lines (§7.12).
   */
  private uploadPayload(): UploadPayload | { error: string } | null {
    const mode = this.mode;
    const work = mode.exportWork();
    if (!work || 'error' in work) return work;
    if (work.sketchProblem) return { error: work.sketchProblem };
    return {
      code: work.sketch,
      kind: work.kind,
      note: mode.mirror?.uploadNote,
      successNote: mode.mirror?.uploadDone,
      mapLine: work.mapLine,
      source: work.mapLine ? mode.lineSource : undefined,
      sketchError: work.sketchError,
    };
  }

  /** Tabs that exist in the current mode (the Blocks and Python tabs only in their own mode). */
  private visibleTabs(): { id: TabId; label: string }[] {
    return TABS.filter((t) => this.isTabVisible(t.id));
  }

  private isTabVisible(id: TabId): boolean {
    const onlyIn = TABS.find((t) => t.id === id)?.onlyIn;
    return onlyIn === undefined || onlyIn === this.mode.id;
  }

  private selectTab(id: TabId): void {
    if (!this.isTabVisible(id)) id = this.mode.firstTab;
    this.activeTab = id;
    for (const tab of TABS) {
      const selected = tab.id === id;
      const button = this.tabButtons.get(tab.id)!;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
      this.panels.get(tab.id)!.hidden = !selected;
    }
    if (id === this.mode.firstTab) {
      this.mode.resize?.(); // Blocks: the workspace was hidden, let Blockly measure its container again
    }
    if (id === 'serial') {
      const serial = this.tabButtons.get('serial')!;
      serial.classList.remove('has-activity');
      serial.removeAttribute('aria-label');
      this.serialMonitor.focusInput();
    } else if (id === 'pinmap') {
      this.pinMap.refresh();
    } else if (id === 'js') {
      this.refreshGeneratedJs();
    }
  }

  /**
   * The sketch printed while the Serial Monitor tab is hidden: the dot on the tab (with the
   * accessible name "Serial Monitor, new output"), and in Python mode, once per run, the console
   * hint with a link to the tab (§7.9).
   */
  private showSerialActivity(): void {
    const tab = this.tabButtons.get('serial')!;
    tab.classList.add('has-activity');
    tab.setAttribute('aria-label', SERIAL_NEW_OUTPUT);
    const hint = this.printHint;
    if (!hint || !this.running) return;
    this.printHint = null;
    this.consolePanel.push({ level: 'info', text: hint.text }, { label: hint.action, onSelect: () => this.selectTab('serial') });
  }

  private onTabKeyDown(e: KeyboardEvent, id: TabId): void {
    const tabs = this.visibleTabs();
    const index = tabs.findIndex((t) => t.id === id);
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = tabs[next].id;
    this.selectTab(target);
    this.tabButtons.get(target)!.focus();
  }

  // -------------------------------------------------------------------------
  // Global events & loops
  // -------------------------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return;
    // Keys pressed in a dialog are for the dialog (Esc closes it), never for the sketch behind it.
    if (
      this.settings.element.open ||
      this.ideDialog.isOpen() ||
      this.uploadButton.isOpen() ||
      this.handinDialog?.isOpen() ||
      this.root.querySelector('dialog[open]') // a mode's dialog ("What works")
    ) {
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void this.run();
    } else if (e.key === 'Escape') {
      // Esc in an open header menu closes the menu (menu.ts), never the sketch.
      if (this.examplesMenu.isOpen() || this.shareMenu.isOpen() || this.settingsMenu.isOpen()) return;
      void this.stop();
    }
  };

  /**
   * Ctrl/Cmd+Enter with the focus inside the Blockly workspace runs the sketch
   * instead of opening Blockly's block context menu. Bound in the capture
   * phase so that Blockly (which listens on its own injection div) never sees
   * the key; keys pressed anywhere else are left to the normal handler above.
   */
  private readonly onBlocksKeyDown = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
    if (!(e.target instanceof Node) || !this.panels.get('blocks')!.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    void this.run();
  };

  /** A share link pasted into the address bar of an already open simulator. */
  private readonly onHashChange = (): void => {
    const payload = takeHashPayload();
    if (!payload) return;
    if (payload.kind === 'class') this.openClassLink(payload.code);
    else void this.openLink(payload);
  };

  /**
   * Show a share link in its mode, asking first when that mode's own program
   * would be lost (§7.6); switches to the mode.
   */
  private async openLink(link: ModeLink): Promise<void> {
    const target = this.modes[link.kind];
    if (!(await target.confirmLink())) return;
    this.setMode(target.id);
    await target.enter(link);
    if (this.mode === target) this.selectTab(target.firstTab);
  }

  private readonly onWindowResize = (): void => {
    if (this.activeTab === this.mode.firstTab) this.mode.resize?.();
  };

  private readonly onPageHide = (): void => {
    for (const mode of this.allModes()) mode.flush();
  };

  private readonly frame = (): void => {
    const now = this.clock.now();
    this.board.tick(now);
    this.boardView.update();
    this.audio.update(this.board.buzzer.state.freq);
    this.checkFinished(now);
    if (this.running) {
      const millis = Math.floor(now);
      if (millis - this.lastMillisShown >= SLOW_REFRESH_MS) {
        this.lastMillisShown = millis;
        this.setStatus('running', `Running · ${millis} ms`);
      }
    }
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  /** A short message at the bottom of the page; `action` adds a button to it (e.g. Undo). */
  private toast(text: string, action?: { label: string; onSelect(): void }, ms = TOAST_MS): void {
    this.toastBox.textContent = text;
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'z1-toast-action';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        this.toastBox.hidden = true;
        action.onSelect();
      });
      this.toastBox.append(' · ', button);
    }
    this.toastBox.hidden = false;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastBox.hidden = true;
      this.toastTimer = null;
    }, ms);
  }

  /** Stop everything and remove the UI (used by tests and hot reloads). */
  destroy(): void {
    cancelAnimationFrame(this.frameHandle);
    clearInterval(this.slowTimer);
    for (const timer of this.lintTimers.values()) clearTimeout(timer);
    this.lintTimers.clear();
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keydown', this.onBlocksKeyDown, true);
    window.removeEventListener('hashchange', this.onHashChange);
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('vite:preloadError', this.onPreloadError);
    if (this.reviewListener) window.removeEventListener('message', this.reviewListener);
    void this.stopExecutor();
    this.uploadButton.dispose();
    this.audio.dispose();
    this.boardView.destroy();
    this.examplesMenu.destroy();
    this.shareMenu.destroy();
    this.settingsMenu.destroy();
    for (const mode of this.allModes()) mode.destroy();
    this.mirror.destroy();
    this.root.replaceChildren();
  }

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------

  private slot<T extends HTMLElement = HTMLElement>(name: string): T {
    const el = this.root.querySelector<T>(`[data-slot="${name}"]`);
    if (!el) throw new Error(`app: missing slot "${name}"`);
    return el;
  }

  /** The page skeleton; applyMode() then shows the current mode's tabs, words and Code tab. */
  private template(): string {
    const tabs = TABS.map(
      (t) =>
        `<button type="button" role="tab" id="z1-tab-${t.id}" class="z1-tab" data-slot="tab-${t.id}" aria-controls="z1-panel-${t.id}" aria-selected="false" tabindex="-1"${
          t.onlyIn ? ' hidden' : ''
        }>${t.lock ? `<span class="z1-tab-lock" data-slot="code-lock" aria-hidden="true" hidden>${LOCK_ICON}</span>` : ''}${t.label}</button>`,
    ).join('');
    const panelContent: Partial<Record<TabId, string>> = {
      code:
        '<div class="z1-banner" data-slot="code-banner" role="note" hidden><span data-slot="code-banner-text"></span><button type="button" class="z1-btn z1-btn-small z1-banner-action" data-slot="copy-to-code">Edit a copy in Code mode</button></div>' +
        '<div class="z1-editor-host" data-slot="editor"></div><div class="z1-editor-host" data-slot="mirror" hidden></div>',
      js: '<p class="z1-muted z1-js-hint">The JavaScript the simulator runs for your sketch (for curious students and teachers). It updates every time you run.</p><pre class="z1-js" tabindex="0" aria-label="Generated JavaScript"><code data-slot="js-code"></code></pre>',
    };
    const panels = TABS.map(
      (t) =>
        `<div role="tabpanel" id="z1-panel-${t.id}" class="z1-panel z1-panel-${t.id}" data-slot="panel-${t.id}" aria-labelledby="z1-tab-${t.id}" hidden>${panelContent[t.id] ?? ''}</div>`,
    ).join('');

    return `
      <div class="z1-app">
        <div class="z1-update" data-slot="update" role="alert" hidden><span data-slot="update-text"></span> <button type="button" class="z1-btn" data-slot="reload">Reload</button></div>
        <header class="z1-header">
          <div class="z1-brand">
            <span class="z1-logo" aria-hidden="true">Z1</span>
            <h1 class="z1-title"><span class="z1-title-full">ZERO1 Smart Board Simulator</span><span class="z1-title-short" aria-hidden="true">ZERO1 Simulator</span></h1>
          </div>
          <div class="z1-mode" role="group" aria-label="Programming mode" data-slot="modes"></div>
          <nav class="z1-toolbar" aria-label="Sketch actions">
            <button type="button" class="z1-btn" data-slot="new" aria-label="Start a new blank sketch" title="New blank sketch"><span aria-hidden="true">＋</span> New</button>
            <div data-slot="examples"></div>
            <button type="button" class="z1-btn z1-btn-run" data-slot="run" aria-label="Run the sketch (Ctrl+Enter)" title="Run (Ctrl+Enter)"><span aria-hidden="true">▶</span> Run</button>
            <button type="button" class="z1-btn z1-btn-stop" data-slot="stop" aria-label="Stop the sketch (Esc)" title="Stop (Esc)" disabled><span aria-hidden="true">■</span> Stop</button>
            <div data-slot="settings"></div>
            <div data-slot="share"></div>
            <button type="button" class="z1-btn" data-slot="ide" aria-label="Open this sketch in the Arduino IDE" title="Open in the Arduino IDE"><span aria-hidden="true">∞</span> <span class="z1-btn-label">Arduino IDE</span></button>
            <button type="button" class="z1-btn" data-slot="upload" aria-label="Upload this sketch to the ZERO1 board" title="Compile in the browser and upload to the board over USB" hidden><span aria-hidden="true">⬆</span> Upload to board</button>
          </nav>
          <div class="z1-run-status" data-slot="status" data-status="idle" role="status" aria-live="polite">
            <span class="z1-run-dot" aria-hidden="true"></span>
            <span data-slot="status-text">Ready</span>
          </div>
        </header>
        <main class="z1-main">
          <section class="z1-left" aria-label="Board">
            <div class="z1-board" data-slot="board"></div>
            <div data-slot="inputs"></div>
          </section>
          <section class="z1-right" aria-label="Code and monitors">
            <div class="z1-tabs" role="tablist" aria-label="Panels">${tabs}</div>
            <div class="z1-panels">${panels}</div>
            <div data-slot="console"></div>
          </section>
        </main>
        <div class="z1-toast" data-slot="toast" role="status" aria-live="polite" hidden></div>
      </div>
    `;
  }
}

/** `transpile()` must never throw, but a bug in it should not take the UI down. */
function safeTranspile(code: string): TranspileResult {
  try {
    return transpile(code);
  } catch (err) {
    return {
      ok: false,
      errors: [
        { line: 1, column: 1, severity: 'error', message: `The simulator could not read this sketch: ${errorText(err)}` },
      ],
      warnings: [],
    };
  }
}

/**
 * What the URL hash carries — `#code=<base64url>` / `#example=<id>` (a text
 * sketch), `#blocks=<base64url JSON>` (a workspace), `#python=<base64url>` (a
 * Python program) or `#class=<code>` (a class to join) — or null. The hash is
 * removed afterwards so that a reload shows the saved work instead of loading
 * the link again.
 */
function takeHashPayload(): HashPayload | null {
  const hash = location.hash;
  const classCode = classFromHash(hash);
  if (classCode !== null) {
    dropHash();
    return { kind: 'class', code: classCode };
  }
  const exampleId = /^#example=([\w-]+)$/.exec(hash)?.[1];
  const example: Example | undefined = exampleId === undefined ? undefined : findExample(exampleId);
  const code = example ? example.source : codeFromHash(hash);
  let payload: HashPayload | null = null;
  if (code !== null) {
    payload = { kind: 'code', code };
  } else {
    const workspace = blocksFromHash(hash);
    const python = workspace ? null : pythonFromHash(hash);
    if (workspace) payload = { kind: 'blocks', workspace };
    else if (python !== null) payload = { kind: 'python', python };
  }
  if (!payload) return null;
  dropHash();
  return payload;
}

function dropHash(): void {
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    // Some contexts (file://) refuse; the hash then simply stays in the address bar.
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
