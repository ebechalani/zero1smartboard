/**
 * Application shell: header with actions (the Share menu carries Hand in,
 * the class platform's entry, when it is configured) and the Code | Blocks mode switch,
 * board + inputs on the left, tabbed blocks/editor/monitors on the right,
 * console below. Wires the transpiler, the executor and the virtual board
 * together and drives the animation loop.
 *
 * In Blocks mode (docs/BLOCKS.md §11.4) the sketch comes from the Blockly
 * workspace; the Code tab mirrors the generated sketch read-only and Run
 * transpiles that sketch through the very same pipeline.
 */
import { transpile } from '../transpiler';
import { Executor } from '../runtime/executor';
import type { Zero1Board } from '../zero1';
import { createBoardView, type BoardView } from './board-view';
import { EXAMPLES, findExample, type Example } from '../examples';
import type { BlockExample } from '../blocks';
import type { Clock, ConsoleMessage, Diagnostic, ExecutorStatus, TranspileResult } from '../types';
import { codeFromHash, createEditor, encodeShareCode, loadSavedCode, type Editor } from './editor';
import {
  CONFIRM_TO_BLOCKS,
  blocksFromHash,
  createBlocksPanel,
  encodeShareBlocks,
  loadBlockExamples,
  loadBlocksBaseline,
  loadMode,
  loadSavedWorkspace,
  needsConfirmToBlocks,
  saveBlocksBaseline,
  saveMode,
  saveWorkspace,
  workspaceFingerprint,
  type AppMode,
  type BlocksPanel,
} from './blocks-panel';
import { createSerialMonitor, detectBaud, type SerialMonitor } from './serial-monitor';
import { createPinMap, type PinMap } from './pinmap';
import { createConsolePanel, type ConsolePanel } from './console-panel';
import { createControls, type Controls } from './controls';
import { createSettingsDialog, type SettingsDialog } from './settings';
import { createMenu, type Menu } from './menu';
import { downloadTextFile, sketchFileName } from './sketch-file';
import { createArduinoIdeDialog, type ArduinoIdeDialog } from './arduino-ide-dialog';
import { createHandinDialog, type HandinDialog, type HandinWork } from './handin-dialog';
import { createExamplesMenu, type ExamplesMenu } from './examples-menu';
import { createBuzzerAudio, loadMuted, saveMuted, type BuzzerAudio } from './audio';
import { isClassroomConfigured } from '../classroom/firebase';
import { STUDENT_ERROR_TEXT } from '../classroom/errors';
import { currentStudentName } from '../classroom/session-store';
import { classFromHash, parseWorkspaceJson } from '../share-link';
import { installUploadButton, type InstalledUploadButton } from '../upload';

/** Tooltip of the Share ▾ button; the Hand in item exists only when the class platform is configured. */
const SHARE_TITLE = 'Share: copy the link or download an .ino file';
const SHARE_TITLE_CLASS = 'Share: copy the link, download an .ino file or hand in to your teacher';
/** Shown when the clipboard refuses the link. */
export const COPY_FALLBACK = 'Press Ctrl+C to copy the link';

/** What "New" puts in the editor: exactly the Arduino IDE's File > New. */
export const BLANK_SKETCH = `void setup() {
  // put your setup code here, to run once:

}

void loop() {
  // put your main code here, to run repeatedly:

}
`;

type TabId = 'blocks' | 'code' | 'serial' | 'pinmap' | 'js';

/** The board view may expose `pulseRx()` to flash the RX LED when the monitor sends text. */
type BoardViewWithRx = BoardView & { pulseRx?(): void };

/** What a share link / `#example=` / `#class=` hash carried. */
type HashPayload = { kind: 'code'; code: string } | { kind: 'blocks'; workspace: object } | { kind: 'class'; code: string };

/** The work as it leaves the simulator (Share, Arduino IDE): the sketch and its share-link hash. */
interface ExportedSketch {
  /** The Arduino sketch (in Blocks mode: the sketch generated from the blocks). */
  code: string;
  kind: AppMode;
  /** `#code=…` or `#blocks=…`. */
  hash: string;
  /** The Blockly workspace in Blocks mode, null in Code mode. */
  workspace: object | null;
}

/** Delay between an edit and the live syntax check. */
const LIVE_LINT_MS = 700;
/** Refresh rate of the pin map and input sliders. */
const SLOW_REFRESH_MS = 100;
/** Delay between a block change and the save of the workspace to localStorage. */
const BLOCKS_SAVE_MS = 400;
const TOAST_MS = 2500;

/** Right-column tabs in display order; the Blocks tab only exists in Blocks mode. */
const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'blocks', label: 'Blocks' },
  { id: 'code', label: 'Code' },
  { id: 'serial', label: 'Serial Monitor' },
  { id: 'pinmap', label: 'Pin Map' },
  { id: 'js', label: 'Generated JS' },
];

const MODES: readonly AppMode[] = ['code', 'blocks'];

/** Browser messages for a lazy chunk that could not be fetched (after a redeploy the hashed file is gone). */
const CHUNK_LOAD_FAILURE = /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed|ChunkLoadError/i;

/** The message the review page sends the sandboxed simulator (docs/CLASSROOM.md §1.4). */
interface ReviewMessage {
  kind: 'code' | 'blocks';
  code: string;
  workspaceJson: string;
}

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
  if (p.kind !== 'code' && p.kind !== 'blocks') return null;
  if (typeof p.code !== 'string' || typeof p.workspaceJson !== 'string') return null;
  return { kind: p.kind, code: p.code, workspaceJson: p.workspaceJson };
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
  private readonly editor: Editor;
  private readonly boardView: BoardViewWithRx;
  private readonly serialMonitor: SerialMonitor;
  private readonly pinMap: PinMap;
  private readonly consolePanel: ConsolePanel;
  private readonly controls: Controls;
  private readonly settings: SettingsDialog;
  /** Header "Share ▾": Hand in (when configured), Copy link, Download .ino. */
  private readonly shareMenu: Menu;
  /** Header "Settings ▾": Reset the board, Board settings…. */
  private readonly settingsMenu: Menu;
  private readonly ideDialog: ArduinoIdeDialog;
  /** "Upload to board" (shown only in browsers with Web Serial and when the toolchain is deployed). */
  private readonly uploadButton: InstalledUploadButton;
  /** The Hand in dialog of the class platform; null while it is not configured (no menu item either). */
  private readonly handinDialog: HandinDialog | null;
  private readonly examplesMenu: ExamplesMenu<Example | BlockExample>;
  private readonly audio: BuzzerAudio;

  private readonly runButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly statusBox: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly toastBox: HTMLElement;
  private readonly jsView: HTMLElement;
  private readonly codeBanner: HTMLElement;
  private readonly modeButtons = new Map<AppMode, HTMLButtonElement>();
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private readonly panels = new Map<TabId, HTMLElement>();

  private executor: Executor | null = null;
  /** Incremented by every run(); an older run that is still waiting to start gives up. */
  private runToken = 0;
  private mode: AppMode;
  private activeTab: TabId;
  private running = false;
  private lastMillisShown = -1;
  private lastLoadedSource: string | null = null;
  private lastJsSource: string | null = null;
  private lintTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private frameHandle = 0;
  private readonly slowTimer: ReturnType<typeof setInterval>;

  // --- Blocks mode --------------------------------------------------------
  private blocksPanel: BlocksPanel | null = null;
  private blocksLoading: Promise<BlocksPanel | null> | null = null;
  private blockExamples: BlockExample[] = [];
  /** Last sketch generated from the blocks (null until the blocks have been loaded). */
  private lastGeneratedCode: string | null = null;
  /** Fingerprint of the workspace right after the last example / link was loaded (null = unknown origin). */
  private lastLoadedBlocks: string | null = null;
  /** Fingerprint of DEFAULT_WORKSPACE (an empty program is never worth a question). */
  private defaultBlocks: string | null = null;
  private blocksSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsavedWorkspace: object | null = null;

  /** Review mode: inside review.html's sandbox; no storage, no links, no hand-in (docs/CLASSROOM.md §4.11). */
  private readonly review: boolean;
  private reviewListener: ((e: MessageEvent) => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly board: Zero1Board,
    private readonly clock: Clock,
  ) {
    document.body.dataset.running = 'false';
    const review = isReviewFrame();
    this.review = review;
    const fromLink = review ? null : takeHashPayload();
    // A share link decides the mode (a `#code=` link opens in Code mode even after a Blocks visit).
    // In review mode the payload decides it later; nothing is read from storage.
    this.mode = review ? 'code' : fromLink && fromLink.kind !== 'class' ? fromLink.kind : loadMode();
    this.activeTab = this.mode === 'blocks' ? 'blocks' : 'code';
    root.innerHTML = this.template();

    this.runButton = this.slot<HTMLButtonElement>('run');
    this.stopButton = this.slot<HTMLButtonElement>('stop');
    this.statusBox = this.slot('status');
    this.statusText = this.slot('status-text');
    this.toastBox = this.slot('toast');
    this.jsView = this.slot('js-code');
    this.codeBanner = this.slot('code-banner');

    for (const mode of MODES) this.modeButtons.set(mode, this.slot<HTMLButtonElement>(`mode-${mode}`));
    for (const tab of TABS) {
      this.tabButtons.set(tab.id, this.slot<HTMLButtonElement>(`tab-${tab.id}`));
      this.panels.set(tab.id, this.slot(`panel-${tab.id}`));
    }

    // --- panels -----------------------------------------------------------
    this.editor = createEditor(this.slot('editor'), {
      initialCode: review ? '' : this.initialCode(fromLink),
      persist: !review,
      onRun: () => void this.run(),
      onStop: () => void this.stop(),
      onChange: () => this.scheduleLiveLint(),
    });

    this.boardView = createBoardView(this.slot('board'), board);

    this.serialMonitor = createSerialMonitor(this.panels.get('serial')!, {
      onSend: (text) => {
        board.serial.inject(text);
        this.boardView.pulseRx?.();
      },
    });
    board.serial.onTx((text) => {
      this.serialMonitor.append(text);
      if (this.activeTab !== 'serial') this.tabButtons.get('serial')!.classList.add('has-activity');
    });

    this.pinMap = createPinMap(this.panels.get('pinmap')!, board);

    this.consolePanel = createConsolePanel(this.slot('console'), {
      onJumpToLine: (line) => {
        this.selectTab('code');
        this.editor.goToLine(line);
      },
    });

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
      button: this.slot<HTMLButtonElement>('upload'),
      parent: root,
      getSketch: () => this.exportSketch(),
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

    this.examplesMenu = createExamplesMenu<Example | BlockExample>(this.slot('examples'), EXAMPLES, (example) => {
      if ('source' in example) this.loadExample(example);
      else void this.loadBlockExample(example);
    });

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
      [
        {
          items: [
            ...(this.handinDialog ? [{ label: 'Hand in to my teacher', title: 'Send this work to your teacher', onSelect: () => this.handIn() }] : []),
            { label: 'Copy link', title: 'Anyone who opens the link sees your work in the simulator', onSelect: () => this.copyLink() },
            { label: 'Download .ino', title: 'Save the sketch for the Arduino IDE', onSelect: () => this.downloadSketch() },
          ],
        },
      ],
    );

    // --- header actions ---------------------------------------------------
    this.slot('new').addEventListener('click', () => void this.newSketch());
    this.runButton.addEventListener('click', () => void this.run());
    this.stopButton.addEventListener('click', () => void this.stop());
    this.slot('ide').addEventListener('click', () => this.openInIde());
    if (this.handinDialog) this.setHandinName(currentStudentName()); // the previous student's name shows until they press Change
    this.slot('reload').addEventListener('click', () => location.reload());
    if (review) {
      // The teacher reviews one hand-in: no new work, no examples, no links out of the sandbox.
      for (const slot of ['new', 'examples', 'share', 'ide']) this.slot(slot).hidden = true;
      this.uploadButton.dispose(); // review mode: no upload from a hand-in
    }
    for (const mode of MODES) this.modeButtons.get(mode)!.addEventListener('click', () => void this.switchMode(mode));

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
    if (this.mode === 'blocks') void this.enterBlocksMode(fromLink?.kind === 'blocks' ? fromLink.workspace : null);
    this.setStatus('idle', 'Ready');
    this.scheduleLiveLint();
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

  /** Show the hand-in: the blocks when they can be read, else the sketch (with the "generated from blocks" banner). */
  private async loadReview(payload: ReviewMessage): Promise<void> {
    if (payload.kind === 'blocks') {
      const workspace = parseWorkspaceJson(payload.workspaceJson);
      if (workspace) {
        this.setMode('blocks');
        await this.enterBlocksMode(workspace);
        if (this.blocksPanel) return;
      }
    }
    this.setMode('code');
    this.editor.setCode(payload.code);
    this.lastLoadedSource = payload.code;
    this.codeBanner.hidden = payload.kind !== 'blocks';
    this.selectTab('code');
  }

  /**
   * The site was redeployed under this tab: a lazy chunk (Blockly, the class
   * features) is gone. Save the work, then ask for a reload.
   */
  private showUpdatePrompt(): void {
    this.editor.flush();
    this.flushBlocksSave();
    this.slot('update-text').textContent = STUDENT_ERROR_TEXT.app_updated;
    this.slot('update').hidden = false;
  }

  private readonly onPreloadError = (e: Event): void => {
    e.preventDefault(); // Vite would rethrow and reload on its own; the banner asks first
    this.showUpdatePrompt();
  };

  // -------------------------------------------------------------------------
  // Run / stop / reset
  // -------------------------------------------------------------------------

  /**
   * Transpile the current sketch (editor text in Code mode, the sketch
   * generated from the blocks in Blocks mode) and start it, restarting if one
   * is running. Like the Arduino IDE, a sketch that does not compile leaves
   * the board running whatever it was running before.
   */
  async run(): Promise<void> {
    const code = await this.sketchToRun();
    if (code === null) return;
    const result = safeTranspile(code);
    this.consolePanel.clear();
    this.showDiagnostics(result, true);

    if (!result.ok) {
      const count = result.errors.length;
      const errors = `${count} error${count === 1 ? '' : 's'}`;
      this.consolePanel.setStatus(`${errors} — fix and run again`);
      if (!this.running) this.setStatus('error', errors);
      const first = result.errors[0];
      if (first && this.mode === 'code') this.editor.goToLine(first.line, first.column);
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

    const executor = new Executor({
      board: this.board,
      lineMap: result.lineMap,
      onConsole: (msg: ConsoleMessage) => this.consolePanel.push(msg),
    });
    this.executor = executor;
    this.setRunning(true);
    this.setStatus('running', 'Running · 0 ms');
    this.consolePanel.setStatus('Running');
    this.consolePanel.push({ level: 'info', text: 'Sketch started.' });

    try {
      await executor.run(result.js);
    } catch (err) {
      // The executor never rejects by contract; a bug in it must still not leave the UI stuck on "Running".
      this.consolePanel.push({ level: 'error', text: `The simulator crashed: ${errorText(err)}` });
    }
    if (this.executor !== executor) return; // a newer run took over
    this.executor = null;
    this.setRunning(false);
    const millis = Math.floor(this.clock.now());
    if (executor.status === 'error') {
      this.setStatus('error', `Error at ${millis} ms`);
      this.consolePanel.setStatus('Stopped by an error — click the message to jump to the line');
    } else {
      this.setStatus('stopped', `Stopped at ${millis} ms`);
      this.consolePanel.setStatus('Stopped');
      this.consolePanel.push({ level: 'info', text: `Sketch stopped after ${executor.loops} loop() calls.` });
    }
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

  /** The sketch Run should compile, or null when there is nothing to run (the reason is already shown). */
  private async sketchToRun(): Promise<string | null> {
    if (this.mode !== 'blocks') return this.editor.getCode();
    const panel = await this.ensureBlocksPanel();
    if (!panel) {
      this.consolePanel.setStatus('The block editor could not be loaded — nothing to run');
      return null;
    }
    try {
      return panel.getCode();
    } catch (err) {
      this.consolePanel.clear();
      this.consolePanel.push({ level: 'error', text: `Block code error: ${errorText(err)}` });
      this.consolePanel.setStatus('Block code error — the blocks could not be turned into a sketch');
      if (!this.running) this.setStatus('error', 'Block code error');
      return null;
    }
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
    this.runButton.setAttribute('aria-label', on ? 'Restart the sketch (Ctrl+Enter)' : 'Run the sketch (Ctrl+Enter)');
    this.lastMillisShown = -1;
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

  private scheduleLiveLint(): void {
    if (this.lintTimer !== null) clearTimeout(this.lintTimer);
    this.lintTimer = setTimeout(() => {
      this.lintTimer = null;
      this.showDiagnostics(safeTranspile(this.editor.getCode()), false);
    }, LIVE_LINT_MS);
  }

  private showDiagnostics(result: TranspileResult, toConsole: boolean): void {
    const errors: Diagnostic[] = result.ok ? [] : result.errors;
    const all = [...errors, ...result.warnings];
    this.editor.setDiagnostics(all);
    if (!toConsole) return;
    for (const d of all) {
      // In Blocks mode the sketch is machine-generated: an error in it is a generator bug, not the student's.
      const text = this.mode === 'blocks' && d.severity === 'error' ? `Block code error: ${d.message}` : d.message;
      this.consolePanel.push({ level: d.severity === 'error' ? 'error' : 'warn', text, line: d.line });
    }
  }

  private showGeneratedJs(js: string, source: string): void {
    this.lastJsSource = source;
    this.jsView.textContent = js;
  }

  /** Make sure the Generated JS tab shows the current sketch (transpiling if needed). */
  private refreshGeneratedJs(): void {
    const code = this.currentSketch();
    if (code === this.lastJsSource) return;
    const result = safeTranspile(code);
    if (result.ok) {
      this.showGeneratedJs(result.js, code);
    } else {
      this.lastJsSource = code;
      this.jsView.textContent = result.errors
        .map((e) => `// line ${e.line}: ${e.message}`)
        .join('\n')
        .concat('\n// Fix the errors above to see the generated JavaScript.');
    }
  }

  /** The sketch the panels describe: editor text in Code mode, the generated sketch in Blocks mode. */
  private currentSketch(): string {
    if (this.mode === 'blocks' && this.blocksPanel) {
      try {
        return this.blocksPanel.getCode();
      } catch {
        // Generator failure: the editor mirrors the explanation comment.
      }
    }
    return this.editor.getCode();
  }

  // -------------------------------------------------------------------------
  // Code | Blocks mode
  // -------------------------------------------------------------------------

  /**
   * Header mode switch (§11.4). Blocks → Code puts the generated sketch into
   * the editor, editable (the blocks stay saved). Code → Blocks restores the
   * saved workspace, asking first when hand-written text would be left behind.
   */
  async switchMode(mode: AppMode): Promise<void> {
    if (mode === this.mode) return;
    if (mode === 'blocks') {
      const text = this.editor.getCode();
      if (needsConfirmToBlocks(text, this.lastGeneratedCode, this.isUntouchedText(text)) && !window.confirm(CONFIRM_TO_BLOCKS)) {
        return;
      }
      this.setMode('blocks');
      await this.enterBlocksMode(null);
    } else {
      let code = this.lastGeneratedCode;
      if (this.blocksPanel) {
        try {
          code = this.blocksPanel.getCode();
        } catch {
          // Generator failure: keep what the Code tab already shows.
        }
      }
      this.setMode('code');
      if (code !== null) {
        this.editor.setCode(code);
        this.lastLoadedSource = code; // reproducible from the saved blocks: not worth a question later
      }
      this.selectTab('code');
      this.editor.focus();
    }
  }

  private setMode(mode: AppMode): void {
    this.mode = mode;
    if (!this.review) saveMode(mode);
    this.applyMode();
  }

  /** Reflect `this.mode` in the header, the tab list, the editor and the Examples menu. */
  private applyMode(): void {
    const blocks = this.mode === 'blocks';
    document.body.dataset.mode = this.mode;
    for (const mode of MODES) this.modeButtons.get(mode)!.setAttribute('aria-pressed', mode === this.mode ? 'true' : 'false');
    this.tabButtons.get('blocks')!.hidden = !blocks;
    this.codeBanner.hidden = !blocks;
    this.editor.setReadOnly(blocks);
    this.examplesMenu.setExamples(blocks ? this.blockExamples : EXAMPLES);
    if (blocks) this.selectTab('blocks');
    else if (this.activeTab === 'blocks') this.selectTab('code');
  }

  /**
   * Make sure the blocks panel exists (loading Blockly on first use), put
   * `workspace` (from a share link) into it when given, and mirror the
   * generated sketch into the read-only editor.
   */
  private async enterBlocksMode(workspace: object | null): Promise<void> {
    const panel = await this.ensureBlocksPanel();
    if (!panel || this.mode !== 'blocks') return; // could not load, or the student switched back meanwhile
    if (workspace) this.loadIntoBlocks(panel, workspace, 'Blocks loaded from the link');
    this.syncEditorWithBlocks(panel);
    if (this.activeTab === 'blocks') panel.resize();
  }

  private ensureBlocksPanel(): Promise<BlocksPanel | null> {
    if (this.blocksPanel) return Promise.resolve(this.blocksPanel);
    this.blocksLoading ??= this.createBlocks();
    return this.blocksLoading;
  }

  /** First use of Blocks mode: load Blockly, restore the saved workspace (else the default) and the block examples. */
  private async createBlocks(): Promise<BlocksPanel | null> {
    // The examples travel in the same chunk as the block definitions: fill the menu at the same time.
    const examples = loadBlockExamples().then(
      (list) => {
        this.blockExamples = list;
        if (this.mode === 'blocks') this.examplesMenu.setExamples(list);
      },
      () => undefined, // the panel below reports the loading failure
    );
    let panel: BlocksPanel;
    try {
      panel = await createBlocksPanel(this.panels.get('blocks')!, {
        onChange: (code, workspace) => this.onBlocksChange(code, workspace),
      });
    } catch (err) {
      this.consolePanel.push({ level: 'error', text: `The block editor could not be loaded: ${errorText(err)}` });
      this.consolePanel.setStatus('The block editor could not be loaded — check your connection and reload');
      this.blocksLoading = null; // the next attempt (Run, mode switch) tries again
      if (CHUNK_LOAD_FAILURE.test(errorText(err)) && navigator.onLine !== false) this.showUpdatePrompt();
      return null;
    }
    await examples;

    this.defaultBlocks = workspaceFingerprint(panel.getWorkspaceJson()); // a new panel starts with DEFAULT_WORKSPACE
    const saved = this.review ? null : loadSavedWorkspace();
    if (saved) {
      try {
        panel.loadWorkspace(saved);
      } catch {
        panel.clear(); // unreadable saved state: start fresh rather than fail
      }
    }
    // The baseline is saved like the workspace: an example restored untouched
    // after a reload is still not worth a question.
    this.lastLoadedBlocks = saved ? loadBlocksBaseline() : this.defaultBlocks;
    this.blocksPanel = panel;
    return panel;
  }

  /** Debounced regeneration from the panel: mirror the sketch and persist the workspace. */
  private onBlocksChange(code: string, workspace: object): void {
    this.lastGeneratedCode = code;
    if (this.mode === 'blocks' && this.editor.getCode() !== code) this.editor.setCode(code);
    this.unsavedWorkspace = workspace;
    if (this.blocksSaveTimer !== null) clearTimeout(this.blocksSaveTimer);
    this.blocksSaveTimer = setTimeout(() => {
      this.blocksSaveTimer = null;
      this.flushBlocksSave();
    }, BLOCKS_SAVE_MS);
  }

  private flushBlocksSave(): void {
    if (this.blocksSaveTimer !== null) {
      clearTimeout(this.blocksSaveTimer);
      this.blocksSaveTimer = null;
    }
    if (this.unsavedWorkspace && !this.review) saveWorkspace(this.unsavedWorkspace);
    this.unsavedWorkspace = null;
  }

  /** Put the generated sketch into the (read-only) editor right away, without waiting for the debounce. */
  private syncEditorWithBlocks(panel: BlocksPanel): void {
    let code: string;
    try {
      code = panel.getCode();
    } catch (err) {
      this.consolePanel.push({ level: 'error', text: `Block code error: ${errorText(err)}` });
      return;
    }
    this.lastGeneratedCode = code;
    if (this.editor.getCode() !== code) this.editor.setCode(code);
  }

  /** Load a workspace (example or share link) and remember it as the untouched baseline. */
  private loadIntoBlocks(panel: BlocksPanel, workspace: object, toast: string): void {
    try {
      panel.loadWorkspace(workspace);
    } catch (err) {
      panel.clear();
      this.setBlocksBaseline(this.defaultBlocks);
      this.consolePanel.push({ level: 'error', text: `Block code error: these blocks could not be loaded (${errorText(err)}).` });
      return;
    }
    this.setBlocksBaseline(workspaceFingerprint(panel.getWorkspaceJson()));
    this.toast(toast);
  }

  /** Remember the untouched workspace, also for the next visit (the workspace itself is saved on change). */
  private setBlocksBaseline(fingerprint: string | null): void {
    this.lastLoadedBlocks = fingerprint;
    if (!this.review) saveBlocksBaseline(fingerprint);
  }

  private async loadBlockExample(example: BlockExample): Promise<void> {
    const panel = await this.ensureBlocksPanel();
    if (!panel) return;
    if (!this.confirmReplaceBlocks(`Replace your blocks with the example "${example.title}"?`)) return;
    this.loadIntoBlocks(panel, example.workspace, `Loaded example: ${example.title}`);
    this.syncEditorWithBlocks(panel);
    this.selectTab('blocks');
  }

  /** Ask before discarding blocks that differ from the last loaded example (and from the empty program). */
  private confirmReplaceBlocks(question: string): boolean {
    const panel = this.blocksPanel;
    if (!panel) return true;
    const current = workspaceFingerprint(panel.getWorkspaceJson());
    const untouched = current === this.lastLoadedBlocks || current === this.defaultBlocks;
    return untouched || window.confirm(`${question}\nYour current blocks will be lost.`);
  }

  // -------------------------------------------------------------------------
  // Examples, sharing, tabs
  // -------------------------------------------------------------------------

  /** Sketch shown on load: the URL hash, else the saved sketch, else the first example. */
  private initialCode(fromLink: HashPayload | null): string {
    if (fromLink?.kind === 'code') {
      this.lastLoadedSource = fromLink.code;
      return fromLink.code;
    }
    const saved = loadSavedCode();
    if (saved !== null && saved.trim() !== '') {
      this.lastLoadedSource = EXAMPLES.some((e) => e.source === saved) ? saved : null;
      return saved;
    }
    const code = EXAMPLES[0]?.source ?? '';
    this.lastLoadedSource = code;
    return code;
  }

  /**
   * Header "New": the empty sketch of the Arduino IDE's File > New, or the
   * empty program in Blocks mode (asking first when work would be lost). Like
   * loading an example, it does not stop a running sketch: the board keeps
   * running the last upload until Run or Stop.
   */
  async newSketch(): Promise<void> {
    if (this.mode === 'blocks') {
      const panel = await this.ensureBlocksPanel();
      if (!panel || this.mode !== 'blocks') return; // could not load, or the student switched back meanwhile
      if (!this.confirmReplaceBlocks('Start a new blank program?')) return;
      panel.clear();
      this.setBlocksBaseline(this.defaultBlocks);
      this.syncEditorWithBlocks(panel);
      this.selectTab('blocks');
      this.toast('New blank program');
      return;
    }
    if (!this.confirmReplace('Start a new blank sketch?')) return;
    this.editor.setCode(BLANK_SKETCH);
    this.lastLoadedSource = BLANK_SKETCH;
    this.selectTab('code');
    this.editor.focus();
    this.toast('New blank sketch');
  }

  private loadExample(example: Example): void {
    if (!this.confirmReplace(`Replace your code with the example "${example.title}"?`)) return;
    this.editor.setCode(example.source);
    this.lastLoadedSource = example.source;
    this.selectTab('code');
    this.editor.focus();
    this.toast(`Loaded example: ${example.title}`);
  }

  /** Text that carries no hand-written work: empty, the blank sketch, or exactly an example / the last loaded sketch. */
  private isUntouchedText(text: string): boolean {
    return (
      text.trim() === '' ||
      text === BLANK_SKETCH ||
      text === this.lastLoadedSource ||
      EXAMPLES.some((e) => e.source === text)
    );
  }

  /** Ask before discarding code that differs from the last loaded example. */
  private confirmReplace(question: string): boolean {
    return this.isUntouchedText(this.editor.getCode()) || window.confirm(`${question}\nYour current code will be lost.`);
  }

  /**
   * Share ▾ → Copy link: the `#code=` / `#blocks=` link onto the clipboard.
   * When the clipboard refuses (no permission, http://), a prompt shows the
   * link selected, ready for Ctrl+C.
   */
  private copyLink(): void {
    const sketch = this.exportSketch();
    if (!sketch) return;
    const url = `${location.origin}${location.pathname}${location.search}${sketch.hash}`;
    const copy = navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject(new Error('clipboard unavailable'));
    copy.then(
      () => this.toast('Link copied'),
      () => {
        this.toast(COPY_FALLBACK);
        if (typeof window.prompt === 'function') window.prompt(COPY_FALLBACK, url);
      },
    );
  }

  /** Share ▾ → Download .ino: `sketchFileName()` named after the remembered student (sketch-file.ts). */
  private downloadSketch(): void {
    const sketch = this.exportSketch();
    if (!sketch) return;
    const fileName = sketchFileName(currentStudentName(), new Date());
    downloadTextFile(fileName, sketch.code);
    this.toast(`Downloading ${fileName}`);
  }

  /**
   * Share ▾ → Hand in to my teacher: the same work as Share, plus what the dialog warns
   * about (an untouched example or blank sketch, transpiler errors), then the
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

  /** The current work as the Hand in dialog wants it, or null while the blocks are still loading. */
  private handinWork(): HandinWork | null {
    const sketch = this.exportSketch();
    if (!sketch) return null;
    const result = safeTranspile(sketch.code);
    return {
      kind: sketch.kind,
      code: sketch.code,
      workspaceJson: sketch.workspace ? JSON.stringify(sketch.workspace) : '',
      unchanged: this.unchangedWork(sketch),
      errorCount: result.ok ? 0 : result.errors.length,
    };
  }

  /** Whether the work is still the blank sketch / empty program or an untouched example (with its title). */
  private unchangedWork(sketch: ExportedSketch): HandinWork['unchanged'] {
    if (sketch.kind === 'code') {
      const text = sketch.code;
      if (text.trim() === '' || text === BLANK_SKETCH) return { kind: 'blank' };
      const example = EXAMPLES.find((e) => e.source === text);
      return example ? { kind: 'example', title: example.title } : null;
    }
    if (!sketch.workspace) return null;
    const current = workspaceFingerprint(sketch.workspace);
    if (current === this.defaultBlocks) return { kind: 'blank' };
    const example = this.blockExamples.find((e) => workspaceFingerprint(e.workspace) === current);
    return example ? { kind: 'example', title: example.title } : null;
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
    const sketch = this.exportSketch();
    if (!sketch) return;
    this.ideDialog.open({ code: sketch.code, kind: sketch.kind });
  }

  /**
   * The work to hand out: the editor text in Code mode, the sketch generated
   * from the blocks in Blocks mode. Null (with a toast) while the blocks are
   * still loading.
   */
  private exportSketch(): ExportedSketch | null {
    if (this.mode !== 'blocks') {
      const code = this.editor.getCode();
      return { code, kind: 'code', hash: `#code=${encodeShareCode(code)}`, workspace: null };
    }
    const panel = this.blocksPanel;
    if (!panel) {
      this.toast('The blocks are still loading — try again in a moment');
      return null;
    }
    let code: string;
    try {
      code = panel.getCode();
    } catch {
      code = this.lastGeneratedCode ?? this.editor.getCode(); // generator failure: the explanation comment
    }
    const workspace = panel.getWorkspaceJson();
    return { code, kind: 'blocks', hash: `#blocks=${encodeShareBlocks(workspace)}`, workspace };
  }

  /** Tabs that exist in the current mode (the Blocks tab is hidden in Code mode). */
  private visibleTabs(): { id: TabId; label: string }[] {
    return TABS.filter((t) => t.id !== 'blocks' || this.mode === 'blocks');
  }

  private selectTab(id: TabId): void {
    if (id === 'blocks' && this.mode !== 'blocks') id = 'code';
    this.activeTab = id;
    for (const tab of TABS) {
      const selected = tab.id === id;
      const button = this.tabButtons.get(tab.id)!;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
      this.panels.get(tab.id)!.hidden = !selected;
    }
    if (id === 'blocks') {
      this.blocksPanel?.resize(); // the workspace was hidden: let Blockly measure its container again
    } else if (id === 'serial') {
      this.tabButtons.get('serial')!.classList.remove('has-activity');
      this.serialMonitor.focusInput();
    } else if (id === 'pinmap') {
      this.pinMap.refresh();
    } else if (id === 'js') {
      this.refreshGeneratedJs();
    }
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
      this.handinDialog?.isOpen()
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
    if (payload.kind === 'class') {
      this.openClassLink(payload.code);
    } else if (payload.kind === 'code') {
      if (this.mode === 'code' && !this.confirmReplace('Load the sketch from this link?')) return;
      if (this.mode !== 'code') this.setMode('code'); // the generated text is reproducible: no question needed
      this.editor.setCode(payload.code);
      this.lastLoadedSource = payload.code;
      this.selectTab('code');
      this.toast('Sketch loaded from the link');
    } else {
      if (!this.confirmReplaceBlocks('Load the blocks from this link?')) return;
      if (this.mode !== 'blocks') this.setMode('blocks');
      void this.enterBlocksMode(payload.workspace);
    }
  };

  private readonly onWindowResize = (): void => {
    if (this.mode === 'blocks' && this.activeTab === 'blocks') this.blocksPanel?.resize();
  };

  private readonly onPageHide = (): void => {
    this.flushBlocksSave();
  };

  private readonly frame = (): void => {
    const now = this.clock.now();
    this.board.tick(now);
    this.boardView.update();
    this.audio.update(this.board.buzzer.state.freq);
    if (this.running) {
      const millis = Math.floor(now);
      if (millis - this.lastMillisShown >= SLOW_REFRESH_MS) {
        this.lastMillisShown = millis;
        this.setStatus('running', `Running · ${millis} ms`);
      }
    }
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  private toast(text: string): void {
    this.toastBox.textContent = text;
    this.toastBox.hidden = false;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastBox.hidden = true;
      this.toastTimer = null;
    }, TOAST_MS);
  }

  /** Stop everything and remove the UI (used by tests and hot reloads). */
  destroy(): void {
    cancelAnimationFrame(this.frameHandle);
    clearInterval(this.slowTimer);
    if (this.lintTimer !== null) clearTimeout(this.lintTimer);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.flushBlocksSave();
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
    this.blocksPanel?.destroy();
    this.blocksPanel = null;
    this.editor.destroy();
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

  private template(): string {
    const initialTab = this.activeTab;
    const tabs = TABS.map(
      (t) =>
        `<button type="button" role="tab" id="z1-tab-${t.id}" class="z1-tab" data-slot="tab-${t.id}" aria-controls="z1-panel-${t.id}" aria-selected="${t.id === initialTab}" tabindex="${t.id === initialTab ? 0 : -1}"${
          t.id === 'blocks' && this.mode !== 'blocks' ? ' hidden' : ''
        }>${t.label}</button>`,
    ).join('');
    const panelContent: Partial<Record<TabId, string>> = {
      code:
        '<div class="z1-banner" data-slot="code-banner" role="note" hidden>Generated from your blocks. Switch to Code mode to edit it by hand.</div><div class="z1-editor-host" data-slot="editor"></div>',
      js: '<p class="z1-muted z1-js-hint">The JavaScript the simulator runs for your sketch (for curious students and teachers). It updates every time you run.</p><pre class="z1-js" tabindex="0" aria-label="Generated JavaScript"><code data-slot="js-code"></code></pre>',
    };
    const panels = TABS.map(
      (t) =>
        `<div role="tabpanel" id="z1-panel-${t.id}" class="z1-panel z1-panel-${t.id}" data-slot="panel-${t.id}" aria-labelledby="z1-tab-${t.id}"${
          t.id === initialTab ? '' : ' hidden'
        }>${panelContent[t.id] ?? ''}</div>`,
    ).join('');
    const modeSwitch = MODES.map(
      (m) =>
        `<button type="button" class="z1-btn z1-mode-btn" data-slot="mode-${m}" aria-pressed="${m === this.mode}" title="${
          m === 'code' ? 'Write the sketch as Arduino C++ text' : 'Build the sketch with blocks'
        }">${m === 'code' ? 'Code' : 'Blocks'}</button>`,
    ).join('');

    return `
      <div class="z1-app">
        <div class="z1-update" data-slot="update" role="alert" hidden><span data-slot="update-text"></span> <button type="button" class="z1-btn" data-slot="reload">Reload</button></div>
        <header class="z1-header">
          <div class="z1-brand">
            <span class="z1-logo" aria-hidden="true">Z1</span>
            <h1 class="z1-title"><span class="z1-title-full">ZERO1 Smart Board Simulator</span><span class="z1-title-short" aria-hidden="true">ZERO1 Simulator</span></h1>
          </div>
          <div class="z1-mode" role="group" aria-label="Programming mode">${modeSwitch}</div>
          <nav class="z1-toolbar" aria-label="Sketch actions">
            <button type="button" class="z1-btn" data-slot="new" aria-label="Start a new blank sketch" title="New blank sketch"><span aria-hidden="true">＋</span> New</button>
            <div data-slot="examples"></div>
            <button type="button" class="z1-btn z1-btn-run" data-slot="run" aria-label="Run the sketch (Ctrl+Enter)" title="Run (Ctrl+Enter)"><span aria-hidden="true">▶</span> Run</button>
            <button type="button" class="z1-btn z1-btn-stop" data-slot="stop" aria-label="Stop the sketch (Esc)" title="Stop (Esc)" disabled><span aria-hidden="true">■</span> Stop</button>
            <div data-slot="settings"></div>
            <div data-slot="share"></div>
            <button type="button" class="z1-btn" data-slot="ide" aria-label="Open this sketch in the Arduino IDE" title="Open in the Arduino IDE"><span aria-hidden="true">∞</span> Arduino IDE</button>
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
 * sketch), `#blocks=<base64url JSON>` (a workspace) or `#class=<code>` (a
 * class to join) — or null. The hash is removed afterwards so that a reload
 * shows the saved work instead of loading the link again.
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
    if (workspace) payload = { kind: 'blocks', workspace };
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
