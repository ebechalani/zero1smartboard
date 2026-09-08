/**
 * Blocks panel (docs/BLOCKS.md §11.4): a Google Blockly workspace with the
 * ZERO1 block set that is turned into an Arduino sketch after every change.
 * Blockly and the block definitions (`src/blocks`) are loaded with a dynamic
 * `import()` the first time a panel is created, so the initial bundle stays
 * free of Blockly.
 *
 * Also hosts the small pure helpers the app shell needs around blocks: the
 * mode and workspace persistence (`z1.mode`, `z1.blocks`), the `#blocks=`
 * share link, and the Code → Blocks hand-off rule.
 */
import type { BlockExample } from '../blocks';
import { decodeShareCode, encodeShareCode } from './editor';

type BlocklyModule = typeof import('blockly');
type BlocksModule = typeof import('../blocks');

/** How the student programs the board. */
export type AppMode = 'code' | 'blocks';

/** localStorage key of the selected mode (`code` | `blocks`). */
export const MODE_STORAGE_KEY = 'z1.mode';
/** localStorage key of the saved Blockly workspace (serialization JSON). */
export const BLOCKS_STORAGE_KEY = 'z1.blocks';

/** Question asked when switching Code → Blocks while the editor holds hand-written changes (§11.4). */
export const CONFIRM_TO_BLOCKS =
  'Your text changes stay in the Code editor but are not converted to blocks. Switch to Blocks?';

/** Delay between a workspace change and the regeneration of the sketch. */
const GENERATE_DEBOUNCE_MS = 150;

export interface BlocksPanel {
  /**
   * Current generated sketch. Throws (with a readable message) when the
   * generator failed on the current blocks — that is a simulator bug, not a
   * student mistake; the app reports it as "Block code error".
   */
  getCode(): string;
  /** Blockly serialization of the workspace. */
  getWorkspaceJson(): object;
  /** Replace the workspace contents (throws when `json` is not a valid workspace). */
  loadWorkspace(json: object): void;
  /** Back to DEFAULT_WORKSPACE (one setup hat + one loop hat). */
  clear(): void;
  /** Call when the panel becomes visible / the layout changes. */
  resize(): void;
  destroy(): void;
}

export interface BlocksPanelOptions {
  /** Called (debounced 150 ms) after every non-UI workspace change with the new sketch and workspace state. */
  onChange: (code: string, workspace: object) => void;
}

let blocksModule: Promise<BlocksModule> | null = null;

/** Load `src/blocks` once; shared by the panel and the Examples menu so both land in one chunk. */
function loadBlocksModule(): Promise<BlocksModule> {
  blocksModule ??= import('../blocks');
  return blocksModule;
}

/** The block examples (§11.6), loaded lazily together with the block definitions. */
export function loadBlockExamples(): Promise<BlockExample[]> {
  return loadBlocksModule().then((m) => m.BLOCK_EXAMPLES);
}

/**
 * Mount a Blockly workspace into `container`. Shows "Loading blocks…" while
 * Blockly is being downloaded; rejects when it cannot be loaded (the message
 * stays visible in the container).
 */
export async function createBlocksPanel(container: HTMLElement, opts: BlocksPanelOptions): Promise<BlocksPanel> {
  container.classList.add('z1-blocks');
  const loading = document.createElement('p');
  loading.className = 'z1-blocks-loading';
  loading.textContent = 'Loading blocks…';
  container.replaceChildren(loading);

  let Blockly: BlocklyModule;
  let blocks: BlocksModule;
  try {
    [Blockly, blocks] = await Promise.all([import('blockly'), loadBlocksModule()]);
  } catch (err) {
    loading.textContent = 'The block editor could not be loaded. Check your internet connection and reload the page.';
    throw err;
  }
  blocks.registerZero1Blocks();

  const host = document.createElement('div');
  host.className = 'z1-blocks-workspace';
  container.replaceChildren(host);

  const workspace = Blockly.inject(host, {
    renderer: 'zelos',
    theme: blocks.ZERO1_THEME,
    toolbox: blocks.TOOLBOX,
    grid: { spacing: 24, length: 3, colour: '#3b2f5c', snap: true },
    zoom: { controls: true, wheel: true, startScale: 0.85 },
    trashcan: true,
    move: { scrollbars: true, drag: true, wheel: false },
  });

  let code = '';
  let generationError: Error | null = null;
  let dirty = true;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = (): object => Blockly.serialization.workspaces.save(workspace);

  const load = (json: object): void => {
    Blockly.serialization.workspaces.load(json as Record<string, unknown>, workspace);
    dirty = true;
  };

  /** Regenerate the sketch from the blocks; a generator failure is remembered instead of thrown. */
  const generate = (): void => {
    dirty = false;
    try {
      code = blocks.workspaceToArduino(workspace);
      generationError = null;
    } catch (err) {
      generationError = err instanceof Error ? err : new Error(String(err));
      code = errorSketch(generationError.message);
    }
  };

  const emitChange = (): void => {
    timer = null;
    if (disposed) return;
    generate();
    opts.onChange(code, save());
  };

  workspace.addChangeListener((e) => {
    if (e.isUiEvent) return;
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(emitChange, GENERATE_DEBOUNCE_MS);
  });

  // Blockly sizes its SVG from the container, so follow the tab panel's size
  // (it goes through 0×0 while hidden; the real size arrives when shown).
  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          if (host.offsetWidth > 0 && host.offsetHeight > 0) Blockly.svgResize(workspace);
        })
      : null;
  observer?.observe(host);

  load(blocks.DEFAULT_WORKSPACE);

  return {
    getCode() {
      if (dirty) generate();
      if (generationError) {
        throw new Error(`the blocks could not be turned into a sketch (${generationError.message})`);
      }
      return code;
    },
    getWorkspaceJson: save,
    loadWorkspace: load,
    clear() {
      load(blocks.DEFAULT_WORKSPACE);
    },
    resize() {
      Blockly.svgResize(workspace);
    },
    destroy() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      observer?.disconnect();
      workspace.dispose();
      container.replaceChildren();
      container.classList.remove('z1-blocks');
    },
  };
}

/** What the Code tab shows when the generator failed: a comment, so nothing runs by accident. */
function errorSketch(message: string): string {
  return [
    `// Block code error: ${message}`,
    '// The blocks could not be turned into a sketch. This is a simulator bug,',
    '// not a mistake in your program — please tell your teacher.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Mode & workspace persistence
// ---------------------------------------------------------------------------

/** The mode chosen on a previous visit (default `code`). */
export function loadMode(): AppMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'blocks' ? 'blocks' : 'code';
  } catch {
    return 'code';
  }
}

/** Remember the mode for the next visit (silently ignores storage errors). */
export function saveMode(mode: AppMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Private mode or quota exceeded: the choice simply is not remembered.
  }
}

/** The workspace saved by a previous visit, or null when there is none (or it is unreadable). */
export function loadSavedWorkspace(): object | null {
  try {
    const raw = localStorage.getItem(BLOCKS_STORAGE_KEY);
    return raw === null ? null : parseWorkspaceJson(raw);
  } catch {
    return null;
  }
}

/** Save the workspace for the next visit (silently ignores storage errors). */
export function saveWorkspace(workspace: object): void {
  try {
    localStorage.setItem(BLOCKS_STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    // Private mode or quota exceeded: the blocks simply are not remembered.
  }
}

/** Parse serialized workspace JSON; null unless it is a JSON object. */
export function parseWorkspaceJson(text: string): object | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * A comparable form of a workspace that ignores where the blocks are placed
 * (`x` / `y`), so that merely dragging blocks around does not count as a change.
 *
 * Blockly gives every block and variable a fresh random `id` each time a
 * workspace is loaded, so ids are renumbered in order of appearance. Without
 * that, the same program saved and restored would look different and students
 * would be asked "your blocks will be lost" before they changed anything.
 */
export function workspaceFingerprint(workspace: object): string {
  const seen = new Map<string, string>();
  return JSON.stringify(workspace, (key, value: unknown) => {
    if (key === 'x' || key === 'y') return undefined;
    if (key === 'id' && typeof value === 'string') {
      let id = seen.get(value);
      if (id === undefined) {
        id = `#${seen.size}`;
        seen.set(value, id);
      }
      return id;
    }
    return value;
  });
}

// ---------------------------------------------------------------------------
// Share links (#blocks=<base64url JSON>)
// ---------------------------------------------------------------------------

/** Encode a workspace for a `#blocks=` link (base64url of its JSON). */
export function encodeShareBlocks(workspace: object): string {
  return encodeShareCode(JSON.stringify(workspace));
}

/** Extract the workspace from a URL hash such as `#blocks=...`, or null. */
export function blocksFromHash(hash: string): object | null {
  const match = /^#blocks=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return null;
  const text = decodeShareCode(match[1]);
  return text === null ? null : parseWorkspaceJson(text);
}

// ---------------------------------------------------------------------------
// Mode switch hand-off
// ---------------------------------------------------------------------------

/**
 * Whether switching Code → Blocks must ask first (§11.4): yes when the editor
 * text differs from the last sketch generated from the blocks — unless the
 * text is "untouched" (empty, or exactly an example / the last loaded sketch),
 * because then no hand-written work can be lost.
 */
export function needsConfirmToBlocks(editorText: string, lastGeneratedCode: string | null, untouched: boolean): boolean {
  if (untouched) return false;
  return editorText !== lastGeneratedCode;
}
