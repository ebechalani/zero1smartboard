// @vitest-environment happy-dom
/**
 * Blocks-mode UI logic that does not need Blockly (docs/BLOCKS.md §11.5):
 * mode and workspace persistence, `#blocks=` share links, the workspace
 * fingerprint used by the "replace your blocks?" question, and the Examples
 * menu switching between text and block examples. Blockly itself is never
 * injected here. (There is no Code → Blocks hand-off any more: each mode keeps
 * its own program, docs/PYTHON.md §7.6; tests/app-header.test.ts covers it.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as blocksPanel from '../src/ui/blocks-panel';
import {
  APP_MODES,
  BLOCKS_STORAGE_KEY,
  MODE_STORAGE_KEY,
  blocksFromHash,
  encodeShareBlocks,
  isAppMode,
  loadMode,
  loadSavedWorkspace,
  parseWorkspaceJson,
  saveMode,
  saveWorkspace,
  workspaceFingerprint,
} from '../src/ui/blocks-panel';
import { encodeShareCode } from '../src/ui/editor';
import { createExamplesMenu } from '../src/ui/examples-menu';

/** A small workspace in Blockly's serialization format. */
const WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [
      { type: 'z1_setup_hat', id: 'setup', x: 20, y: 20 },
      {
        type: 'z1_loop_hat',
        id: 'loop',
        x: 20,
        y: 200,
        inputs: {
          DO: { block: { type: 'z1_led_set', id: 'led', fields: { LED: 'RED', STATE: 'ON' } } },
        },
      },
    ],
  },
};

function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Mode persistence
// ---------------------------------------------------------------------------

describe('mode persistence', () => {
  it('defaults to Code mode', () => {
    expect(loadMode()).toBe('code');
  });

  it('remembers the chosen mode under z1.mode', () => {
    saveMode('blocks');
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('blocks');
    expect(loadMode()).toBe('blocks');
    saveMode('python');
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('python');
    expect(loadMode()).toBe('python');
    saveMode('code');
    expect(loadMode()).toBe('code');
  });

  it('falls back to Code mode for unknown values (docs/PYTHON.md §7.15)', () => {
    for (const value of ['pyth0n', 'Python', 'BLOCKS', '', 'undefined']) {
      localStorage.setItem(MODE_STORAGE_KEY, value);
      expect(loadMode(), value).toBe('code');
    }
  });

  it('knows the three modes in header order', () => {
    expect(APP_MODES).toEqual(['code', 'blocks', 'python']);
    for (const mode of APP_MODES) expect(isAppMode(mode)).toBe(true);
    for (const value of ['pyth0n', null, undefined, 1, {}]) expect(isAppMode(value)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Workspace persistence
// ---------------------------------------------------------------------------

describe('workspace persistence', () => {
  it('round-trips the workspace JSON under z1.blocks', () => {
    saveWorkspace(WORKSPACE);
    expect(localStorage.getItem(BLOCKS_STORAGE_KEY)).toBe(JSON.stringify(WORKSPACE));
    expect(loadSavedWorkspace()).toEqual(WORKSPACE);
  });

  it('returns null when nothing is saved or the saved text is not a workspace', () => {
    expect(loadSavedWorkspace()).toBeNull();
    localStorage.setItem(BLOCKS_STORAGE_KEY, '{oops');
    expect(loadSavedWorkspace()).toBeNull();
    localStorage.setItem(BLOCKS_STORAGE_KEY, '[1, 2]');
    expect(loadSavedWorkspace()).toBeNull();
  });

  it('parses only JSON objects', () => {
    expect(parseWorkspaceJson('{"blocks": {}}')).toEqual({ blocks: {} });
    expect(parseWorkspaceJson('42')).toBeNull();
    expect(parseWorkspaceJson('null')).toBeNull();
    expect(parseWorkspaceJson('"text"')).toBeNull();
    expect(parseWorkspaceJson('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

describe('share links (#blocks=)', () => {
  it('round-trips a workspace through base64url', () => {
    const encoded = encodeShareBlocks(WORKSPACE);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(blocksFromHash(`#blocks=${encoded}`)).toEqual(WORKSPACE);
  });

  it('rejects other hashes and garbage', () => {
    expect(blocksFromHash('')).toBeNull();
    expect(blocksFromHash('#code=aGk')).toBeNull();
    expect(blocksFromHash('#blocks=!!!not base64')).toBeNull();
    expect(blocksFromHash(`#blocks=${encodeShareCode('not json')}`)).toBeNull();
    expect(blocksFromHash(`#blocks=${encodeShareCode('[1]')}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fingerprint (what counts as "the blocks changed")
// ---------------------------------------------------------------------------

describe('workspace fingerprint', () => {
  it('ignores where the blocks are placed', () => {
    const moved = structuredClone(WORKSPACE);
    moved.blocks.blocks[1].x = 300;
    moved.blocks.blocks[1].y = 50;
    expect(workspaceFingerprint(moved)).toBe(workspaceFingerprint(WORKSPACE));
  });

  it('ignores the random ids Blockly gives on every load', () => {
    // Saving and restoring the same program renumbers every id; that must not
    // count as a change, or students are warned before touching anything.
    const reloaded = structuredClone(WORKSPACE);
    let n = 0;
    const renumber = (block: { id?: string; inputs?: Record<string, { block: object }> }): void => {
      if (block.id) block.id = `blockly-fresh-${n++}`;
      for (const input of Object.values(block.inputs ?? {})) renumber(input.block as typeof block);
    };
    for (const block of reloaded.blocks.blocks) renumber(block);
    expect(workspaceFingerprint(reloaded)).toBe(workspaceFingerprint(WORKSPACE));
  });

  it('notices a changed field or an added block', () => {
    const edited = structuredClone(WORKSPACE);
    edited.blocks.blocks[1].inputs!.DO.block.fields.STATE = 'OFF';
    expect(workspaceFingerprint(edited)).not.toBe(workspaceFingerprint(WORKSPACE));

    const added = structuredClone(WORKSPACE);
    added.blocks.blocks.push({ type: 'z1_setup_hat', id: 'extra', x: 0, y: 0 });
    expect(workspaceFingerprint(added)).not.toBe(workspaceFingerprint(WORKSPACE));
  });
});

// ---------------------------------------------------------------------------
// No Code → Blocks hand-off (docs/PYTHON.md §7.6, §13 D2)
// ---------------------------------------------------------------------------

describe('Code → Blocks hand-off', () => {
  it('is gone: no question, no rule, no text', () => {
    expect('CONFIRM_TO_BLOCKS' in blocksPanel).toBe(false);
    expect('needsConfirmToBlocks' in blocksPanel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Examples menu per mode
// ---------------------------------------------------------------------------

describe('examples menu per mode', () => {
  const textExamples = [{ id: 'a', title: 'Blink', group: 'Outputs', description: 'blinks', source: '// a' }];
  const blockExamples = [
    { id: 'b01_blink', title: 'Blink (blocks)', group: 'Outputs', description: 'blinks', workspace: WORKSPACE },
    { id: 'b10_button_led', title: 'Button and LED', group: 'Inputs', description: 'button', workspace: WORKSPACE },
  ];
  type AnyExample = (typeof textExamples)[number] | (typeof blockExamples)[number];
  const titles = (): (string | null)[] =>
    Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent);

  it('swaps between text and block examples', () => {
    const chosen: string[] = [];
    const menu = createExamplesMenu<AnyExample>(mount(), textExamples, (ex) => chosen.push(ex.id));
    expect(titles()).toEqual(['Blink']);

    menu.setExamples(blockExamples);
    expect(titles()).toEqual(['Blink (blocks)', 'Button and LED']);
    expect(Array.from(document.querySelectorAll('.z1-menu-group-title')).map((g) => g.textContent)).toEqual([
      'Outputs',
      'Inputs',
    ]);
    document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1].click();
    expect(chosen).toEqual(['b10_button_led']);

    menu.setExamples([]);
    expect(titles()).toEqual([]);
    expect(document.querySelector('.z1-menu-empty')!.textContent).toBe('No examples available');

    menu.setExamples(textExamples);
    expect(titles()).toEqual(['Blink']);
  });

  it('closes an open menu when the list changes', () => {
    const menu = createExamplesMenu<AnyExample>(mount(), textExamples, () => {});
    menu.open();
    expect(menu.isOpen()).toBe(true);
    menu.setExamples(blockExamples);
    expect(menu.isOpen()).toBe(false);
  });
});
