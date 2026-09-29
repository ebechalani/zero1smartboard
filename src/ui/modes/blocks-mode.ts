/**
 * Blocks mode (docs/BLOCKS.md §11.4, docs/PYTHON.md §7.1): the sketch comes from the Blockly
 * workspace (the Blocks tab, loaded lazily with Blockly), saved as `z1.blocks`. The Code tab
 * shows the generated sketch in the read-only mirror; the student's own sketch (`z1.code`) is
 * never touched (§7.6: no hand-off, no question when switching).
 */
import type { BlockExample } from '../../blocks';
import { parseWorkspaceJson } from '../../share-link';
import {
  createBlocksPanel,
  encodeShareBlocks,
  loadBlockExamples,
  loadBlocksBaseline,
  loadSavedWorkspace,
  saveBlocksBaseline,
  saveWorkspace,
  workspaceFingerprint,
  type BlocksPanel,
} from '../blocks-panel';
import type { MenuExample } from '../examples-menu';
import type { HandinWork } from '../handin-dialog';
import type { ExportedWork, ModeController, ModeHost, ModeLink, ReviewMessage, SketchResult } from './types';

/** Delay between a block change and the save of the workspace to localStorage. */
const BLOCKS_SAVE_MS = 400;

/** Exports and uploads while Blockly is still being downloaded. */
export const BLOCKS_LOADING = 'The blocks are still loading — try again in a moment';

/** "Edit a copy in Code mode" is off while the generator fails on the blocks. */
const GENERATOR_FAILED = 'The blocks could not be turned into a sketch';

export class BlocksMode implements ModeController {
  readonly id = 'blocks';
  readonly button = { label: 'Blocks', title: 'Build the sketch with blocks' };
  readonly firstTab = 'blocks';
  readonly mirrorsCode = true;
  readonly mirror = {
    label: 'Arduino sketch made from your blocks (read only)',
    banner: 'Made from your blocks — read only.',
    typing: 'This sketch is made from your blocks — change the blocks',
    review: "Made from the student's blocks.",
    errorPrefix: 'Block code error: ',
  };
  readonly lineSource = 'sketch';
  readonly words = {
    run: 'Run the sketch (Ctrl+Enter)',
    stop: 'Stop the sketch (Esc)',
    ide: 'Open this sketch in the Arduino IDE',
    upload: 'Upload this sketch to the ZERO1 board',
    newAria: 'Start a new blank sketch',
    newTitle: 'New blank sketch',
  };

  private panel: BlocksPanel | null = null;
  private loading: Promise<BlocksPanel | null> | null = null;
  private blockExamples: BlockExample[] = [];
  /** Last sketch generated from the blocks (null until the blocks have been loaded). */
  private lastGeneratedCode: string | null = null;
  /** Fingerprint of the workspace right after the last example / link was loaded (null = unknown origin). */
  private lastLoadedBlocks: string | null = null;
  /** Fingerprint of DEFAULT_WORKSPACE (an empty program is never worth a question). */
  private defaultBlocks: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsavedWorkspace: object | null = null;

  constructor(private readonly host: ModeHost) {}

  examples(): readonly MenuExample[] {
    return this.blockExamples;
  }

  /**
   * Make sure the blocks panel exists (loading Blockly on first use), put the link's workspace
   * into it when given, and mirror the generated sketch into the Code tab.
   */
  async enter(link: ModeLink | null): Promise<void> {
    if (!this.panel) this.host.showMirror(this, '', BLOCKS_LOADING);
    const panel = await this.ensurePanel();
    if (!panel || !this.host.isCurrent(this)) return; // could not load, or the student switched back meanwhile
    if (link?.kind === 'blocks') this.loadIntoBlocks(panel, link.workspace, 'Blocks loaded from the link');
    this.syncMirror(panel);
    if (this.host.isTabSelected('blocks')) panel.resize();
  }

  leave(): void {}

  /** Blockly takes the focus when the student clicks into the workspace. */
  focus(): void {}

  async sketch(): Promise<SketchResult> {
    const panel = await this.ensurePanel();
    if (!panel) return { ok: false, reason: 'loading', message: 'The block editor could not be loaded — nothing to run' };
    try {
      return { ok: true, sketch: panel.getCode(), endsAfterSetup: false, usesInput: false };
    } catch (err) {
      return {
        ok: false,
        reason: 'errors',
        message: 'Block code error — the blocks could not be turned into a sketch',
        detail: `Block code error: ${errorText(err)}`,
      };
    }
  }

  /** The sketch generated from the blocks and the workspace; `{ error }` while the blocks are still loading. */
  exportWork(): ExportedWork | { error: string } {
    const panel = this.panel;
    if (!panel) return { error: BLOCKS_LOADING };
    let code: string;
    try {
      code = panel.getCode();
    } catch {
      code = this.lastGeneratedCode ?? ''; // generator failure: the explanation comment
    }
    const workspace = panel.getWorkspaceJson();
    return {
      kind: 'blocks',
      sketch: code,
      hash: `#blocks=${encodeShareBlocks(workspace)}`,
      workspaceJson: JSON.stringify(workspace),
      python: '',
    };
  }

  async loadExample(example: MenuExample): Promise<void> {
    const { title, workspace } = example as BlockExample;
    const panel = await this.ensurePanel();
    if (!panel) return;
    if (!this.confirmReplace(`Replace your blocks with the example "${title}"?`)) return;
    this.loadIntoBlocks(panel, workspace, `Loaded example: ${title}`);
    this.syncMirror(panel);
    this.host.selectTab('blocks');
  }

  /** Header "New": the empty program (asking first when work would be lost); does not stop a run. */
  async newProgram(): Promise<void> {
    const panel = await this.ensurePanel();
    if (!panel || !this.host.isCurrent(this)) return; // could not load, or the student switched back meanwhile
    if (!this.confirmReplace('Start a new blank program?')) return;
    panel.clear();
    this.setBaseline(this.defaultBlocks);
    this.syncMirror(panel);
    this.host.selectTab('blocks');
    this.host.toast('New blank program');
  }

  untouched(): HandinWork['unchanged'] {
    if (!this.panel) return null;
    const current = workspaceFingerprint(this.panel.getWorkspaceJson());
    if (current === this.defaultBlocks) return { kind: 'blank' };
    const example = this.blockExamples.find((e) => workspaceFingerprint(e.workspace) === current);
    return example ? { kind: 'example', title: example.title } : null;
  }

  async confirmLink(): Promise<boolean> {
    return this.confirmReplace('Load the blocks from this link?');
  }

  resize(): void {
    this.panel?.resize(); // the workspace was hidden: let Blockly measure its container again
  }

  /** Review mode: the blocks when they can be read (and Blockly loads), else the app shows the sketch. */
  async review(message: ReviewMessage): Promise<boolean> {
    const workspace = parseWorkspaceJson(message.workspaceJson);
    if (!workspace) return false;
    this.host.setMode(this.id);
    await this.enter({ kind: 'blocks', workspace });
    return this.panel !== null;
  }

  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.unsavedWorkspace && !this.host.review) saveWorkspace(this.unsavedWorkspace);
    this.unsavedWorkspace = null;
  }

  destroy(): void {
    this.flush();
    this.panel?.destroy();
    this.panel = null;
  }

  // --- panel ------------------------------------------------------------------

  private ensurePanel(): Promise<BlocksPanel | null> {
    if (this.panel) return Promise.resolve(this.panel);
    this.loading ??= this.createPanel();
    return this.loading;
  }

  /** First use of Blocks mode: load Blockly, restore the saved workspace (else the default) and the block examples. */
  private async createPanel(): Promise<BlocksPanel | null> {
    // The examples travel in the same chunk as the block definitions: fill the menu at the same time.
    const examples = loadBlockExamples().then(
      (list) => {
        this.blockExamples = list;
        this.host.examplesChanged(this);
      },
      () => undefined, // the panel below reports the loading failure
    );
    let panel: BlocksPanel;
    try {
      panel = await createBlocksPanel(this.host.panel('blocks'), {
        onChange: (code, workspace) => this.onBlocksChange(code, workspace),
      });
    } catch (err) {
      this.loading = null; // the next attempt (Run, mode switch) tries again
      this.host.loadFailed('block editor', err);
      return null;
    }
    await examples;

    this.defaultBlocks = workspaceFingerprint(panel.getWorkspaceJson()); // a new panel starts with DEFAULT_WORKSPACE
    const saved = this.host.review ? null : loadSavedWorkspace();
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
    this.panel = panel;
    return panel;
  }

  /** Debounced regeneration from the panel: mirror the sketch and persist the workspace. */
  private onBlocksChange(code: string, workspace: object): void {
    this.lastGeneratedCode = code;
    this.host.showMirror(this, code, this.generatorProblem());
    this.unsavedWorkspace = workspace;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, BLOCKS_SAVE_MS);
  }

  /** Why "Edit a copy in Code mode" is off: the generator failed on the current blocks (else null). */
  private generatorProblem(): string | null {
    try {
      this.panel?.getCode();
      return null;
    } catch {
      return GENERATOR_FAILED;
    }
  }

  /** Put the generated sketch into the mirror right away, without waiting for the debounce. */
  private syncMirror(panel: BlocksPanel): void {
    let code: string;
    try {
      code = panel.getCode();
    } catch (err) {
      this.host.console.push({ level: 'error', text: `Block code error: ${errorText(err)}` });
      this.host.showMirror(this, this.lastGeneratedCode ?? '', GENERATOR_FAILED);
      return;
    }
    this.lastGeneratedCode = code;
    this.host.showMirror(this, code, null);
  }

  /** Load a workspace (example or share link) and remember it as the untouched baseline. */
  private loadIntoBlocks(panel: BlocksPanel, workspace: object, toast: string): void {
    try {
      panel.loadWorkspace(workspace);
    } catch (err) {
      panel.clear();
      this.setBaseline(this.defaultBlocks);
      this.host.console.push({ level: 'error', text: `Block code error: these blocks could not be loaded (${errorText(err)}).` });
      return;
    }
    this.setBaseline(workspaceFingerprint(panel.getWorkspaceJson()));
    this.host.toast(toast);
  }

  /** Remember the untouched workspace, also for the next visit (the workspace itself is saved on change). */
  private setBaseline(fingerprint: string | null): void {
    this.lastLoadedBlocks = fingerprint;
    if (!this.host.review) saveBlocksBaseline(fingerprint);
  }

  /** Ask before discarding blocks that differ from the last loaded example (and from the empty program). */
  private confirmReplace(question: string): boolean {
    const panel = this.panel;
    if (!panel) return true;
    const current = workspaceFingerprint(panel.getWorkspaceJson());
    const untouched = current === this.lastLoadedBlocks || current === this.defaultBlocks;
    return untouched || window.confirm(`${question}\nYour current blocks will be lost.`);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
