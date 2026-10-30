/**
 * The "if" block (`controls_if`, docs/BLOCKS.md §11.2) with its else-if / else
 * buttons on the block itself, by teacher request: Blockly's own block hides
 * them behind a small gear (a mutator pop-up) that students did not find.
 *
 * - "＋ else if" (always) and "＋ else" (while there is none) on the bottom row
 *   add a branch; the "−" at the end of an else-if or else row removes it.
 *   The blocks inside a removed branch stay on the workspace (as with Blockly's
 *   gear); every other branch keeps its blocks. One click = one undo step.
 * - Same inputs (IF0 / DO0, IFn / DOn, ELSE) and the same saved state as
 *   Blockly's block (`extraState` `{ elseIfCount, hasElse }`, XML
 *   `<mutation elseif="n" else="1">`), so saved programs, links, hand-ins and
 *   the examples load unchanged, and the generator is the same.
 * - In the toolbox the buttons are only a picture (a click there takes the
 *   block out, as for any field); they do nothing on a read-only workspace.
 */
import * as Blockly from 'blockly';

/** A second button click this soon after a reshape is the second half of a double-click on a button that moved: ignored. */
export const DOUBLE_CLICK_MS = 300;

/** Names of the inputs the buttons sit in (not saved: only connections and extraState are). */
const ADD_ROW = 'ADD';
const ELSE_ROW = 'ELSE_ROW';
const removeRow = (n: number): string => `REMOVE${n}`;

/** Button size in workspace units (the block text is 12 px; the buttons are a little larger, to be found). */
const BUTTON_HEIGHT = 26;
const ADD_ELSE_IF_WIDTH = 84;
const ADD_ELSE_WIDTH = 66;
const REMOVE_SIZE = 24;

/** Visible text, alt text and tooltips of the buttons (English, docs/ARCHITECTURE.md §3). */
export const IF_BUTTON_TEXT = {
  addElseIf: '+ else if',
  addElse: '+ else',
  addElseIfAlt: 'Add else if',
  addElseAlt: 'Add else',
  addElseIfTooltip: 'Add an "else if": another condition to test when the ones above are false.',
  addElseTooltip: 'Add an "else": what to do when no condition above is true.',
  removeElseIfAlt: 'Remove this else if',
  removeElseAlt: 'Remove this else',
  removeElseIfTooltip: 'Remove this "else if". Its condition and its blocks are not deleted: they are put next to the block.',
  removeElseTooltip: 'Remove the "else". Its blocks are not deleted: they are put next to the block.',
  blockTooltip: 'If the condition is true, do the blocks inside. Use "+ else if" and "+ else" to test more cases.',
} as const;

const FONT = "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#1e1633';

function svgUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A white pill with dark text: visible on every block colour, like a button. */
function pill(label: string, width: number): string {
  const h = BUTTON_HEIGHT;
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">` +
      `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${h - 1.5}" rx="${(h - 1.5) / 2}" fill="#ffffff" stroke="${INK}" stroke-opacity="0.35" stroke-width="1.5"/>` +
      `<text x="${width / 2}" y="${h / 2 + 0.5}" dominant-baseline="central" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="${INK}">${label}</text>` +
      `</svg>`,
  );
}

/** A white circle with a red minus. */
function minusIcon(): string {
  const s = REMOVE_SIZE;
  const c = s / 2;
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">` +
      `<circle cx="${c}" cy="${c}" r="${c - 0.75}" fill="#ffffff" stroke="${INK}" stroke-opacity="0.35" stroke-width="1.5"/>` +
      `<path d="M${c - 5.5} ${c}h11" stroke="#c0262d" stroke-width="2.8" stroke-linecap="round"/>` +
      `</svg>`,
  );
}

const ADD_ELSE_IF_SRC = pill(IF_BUTTON_TEXT.addElseIf, ADD_ELSE_IF_WIDTH);
const ADD_ELSE_SRC = pill(IF_BUTTON_TEXT.addElse, ADD_ELSE_WIDTH);
const REMOVE_SRC = minusIcon();

/** The child blocks of the else-if branches (index 0 = IF1/DO1) and of the else. */
interface Branches {
  conditions: Array<Blockly.Connection | null>;
  bodies: Array<Blockly.Connection | null>;
  /** The else branch's blocks; undefined = no else branch. */
  otherwise: Blockly.Connection | null | undefined;
}

/** The button alt texts: what a collapsed block must not read out. */
const BUTTON_ALTS: ReadonlySet<string> = new Set([IF_BUTTON_TEXT.addElseIfAlt, IF_BUTTON_TEXT.addElseAlt, IF_BUTTON_TEXT.removeElseIfAlt, IF_BUTTON_TEXT.removeElseAlt]);

/** The fields and methods this file adds to a `controls_if` block. */
export interface IfBlock extends Blockly.BlockSvg {
  elseifCount_: number;
  elseCount_: number;
  /** When a button last changed the shape (Date.now()), for the double-click guard. */
  lastReshapeAt_?: number;
  updateShape_(): void;
  /** Add an else-if branch (before the else, if any). */
  addElseIf(): void;
  /** Add the else branch (at most one). */
  addElse(): void;
  /** Remove else-if branch `n` (1 = the first "else if"); its blocks stay on the workspace. */
  removeElseIf(n: number): void;
  /** Remove the else branch; its blocks stay on the workspace. */
  removeElse(): void;
}

function button(src: string, width: number, height: number, alt: string, tooltip: string, onClick: (block: IfBlock) => void): Blockly.FieldImage {
  const field = new Blockly.FieldImage(src, width, height, alt, (f) => {
    const block = f.getSourceBlock() as IfBlock;
    // After a click the rows move: the second click of a double-click would hit another button.
    if (Date.now() - (block.lastReshapeAt_ ?? 0) < DOUBLE_CLICK_MS) return;
    onClick(block);
  });
  field.setTooltip(tooltip);
  return field;
}

/** The x/y and size of a block (size 0 in a headless workspace, where blocks are not drawn). */
function bounds(block: Blockly.Block): { x: number; y: number; width: number; height: number } {
  const xy = block.getRelativeToSurfaceXY();
  const size = (block as unknown as { getHeightWidth?(): { height: number; width: number } }).getHeightWidth?.() ?? { height: 0, width: 0 };
  return { x: xy.x, y: xy.y, width: size.width, height: size.height };
}

/**
 * The blocks of a removed branch are not deleted: put them next to the if block (to its right,
 * one under the other), where they are seen, instead of leaving them under the smaller block.
 */
function putAside(block: IfBlock, orphans: Blockly.Block[]): void {
  const home = bounds(block);
  let y = home.y;
  for (const orphan of orphans) {
    if (orphan.getParent() || orphan.isDeadOrDying()) continue;
    const at = bounds(orphan);
    orphan.moveBy(home.x + home.width + 24 - at.x, y - at.y, ['if-branch-removed']);
    y += at.height + 12;
  }
}

/** The saved form of the shape, as Blockly's change events carry it ('' = plain if). */
function shapeState(block: IfBlock): string {
  const state = block.saveExtraState?.();
  return state ? JSON.stringify(state) : '';
}

/**
 * Change the branches and keep every remaining branch's blocks: read the child connections,
 * let `edit` change them, rebuild the inputs and plug the children back in. Fires one
 * "mutation" change event in an event group, so one undo restores the block and its children.
 */
function reshape(block: IfBlock, edit: (branches: Branches) => void): void {
  if (block.isInFlyout || !block.isEditable() || block.isDeadOrDying()) return;
  const branches: Branches = { conditions: [], bodies: [], otherwise: undefined };
  for (let n = 1; n <= block.elseifCount_; n++) {
    branches.conditions.push(block.getInput(`IF${n}`)?.connection?.targetConnection ?? null);
    branches.bodies.push(block.getInput(`DO${n}`)?.connection?.targetConnection ?? null);
  }
  if (block.elseCount_) branches.otherwise = block.getInput('ELSE')?.connection?.targetConnection ?? null;
  const children = [...branches.conditions, ...branches.bodies, branches.otherwise ?? null];

  const existingGroup = Blockly.Events.getGroup();
  if (!existingGroup) Blockly.Events.setGroup(true);
  try {
    const before = shapeState(block);
    edit(branches);
    const kept = new Set([...branches.conditions, ...branches.bodies, branches.otherwise ?? null]);
    const orphans = children.filter((c): c is Blockly.Connection => c !== null && !kept.has(c));
    for (const c of orphans) c.disconnect(); // out before the rebuild, so that no slot that moves up takes them
    block.elseifCount_ = branches.conditions.length;
    block.elseCount_ = branches.otherwise === undefined ? 0 : 1;
    block.updateShape_();
    branches.conditions.forEach((c, i) => c?.reconnect(block, `IF${i + 1}`));
    branches.bodies.forEach((c, i) => c?.reconnect(block, `DO${i + 1}`));
    branches.otherwise?.reconnect(block, 'ELSE');
    putAside(
      block,
      orphans.map((c) => c.getSourceBlock()),
    );
    const after = shapeState(block);
    if (before !== after) Blockly.Events.fire(new Blockly.Events.BlockChange(block, 'mutation', null, before, after));
    block.lastReshapeAt_ = Date.now();
  } finally {
    if (!existingGroup) Blockly.Events.setGroup(false);
  }
}

const IF_BLOCK_MIXIN = {
  elseifCount_: 0,
  elseCount_: 0,

  init(this: IfBlock): void {
    this.setStyle('logic_blocks');
    this.setHelpUrl(Blockly.Msg['CONTROLS_IF_HELPURL'] ?? '');
    this.appendValueInput('IF0').setCheck('Boolean').appendField(Blockly.Msg['CONTROLS_IF_MSG_IF'] ?? 'if');
    this.appendStatementInput('DO0').appendField(Blockly.Msg['CONTROLS_IF_MSG_THEN'] ?? 'do');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    // Inline, so that each "−" sits at the end of its own row.
    this.inputsInlineDefault = true;
    this.setInputsInline(true);
    this.suppressPrefixSuffix = true;
    this.setTooltip(IF_BUTTON_TEXT.blockTooltip);
    this.updateShape_();
  },

  /** XML (old share links, Blockly's clipboard in XML): `<mutation elseif="n" else="1">`. */
  mutationToDom(this: IfBlock): Element | null {
    if (!this.elseifCount_ && !this.elseCount_) return null;
    const container = Blockly.utils.xml.createElement('mutation');
    if (this.elseifCount_) container.setAttribute('elseif', String(this.elseifCount_));
    if (this.elseCount_) container.setAttribute('else', '1');
    return container;
  },

  domToMutation(this: IfBlock, xml: Element): void {
    this.elseifCount_ = Math.max(0, parseInt(xml.getAttribute('elseif') ?? '', 10) || 0);
    this.elseCount_ = parseInt(xml.getAttribute('else') ?? '', 10) ? 1 : 0;
    this.updateShape_();
  },

  /** JSON: `{ elseIfCount, hasElse }`, null for a plain if (the same as Blockly's block). */
  saveExtraState(this: IfBlock): { elseIfCount?: number; hasElse?: boolean } | null {
    if (!this.elseifCount_ && !this.elseCount_) return null;
    const state: { elseIfCount?: number; hasElse?: boolean } = {};
    if (this.elseifCount_) state.elseIfCount = this.elseifCount_;
    if (this.elseCount_) state.hasElse = true;
    return state;
  },

  loadExtraState(this: IfBlock, state: { elseIfCount?: unknown; hasElse?: unknown } | null): void {
    const count = Number(state?.elseIfCount);
    this.elseifCount_ = Number.isInteger(count) && count > 0 ? count : 0;
    this.elseCount_ = state?.hasElse ? 1 : 0;
    this.updateShape_();
  },

  /**
   * Rebuild every input after IF0 / DO0 from the counts. The blocks in an input that exists
   * before and after (the else, an else-if below the new one) are plugged back in, so that an
   * undo / redo (loadExtraState) and a paste keep them; reshape() moves the others.
   */
  updateShape_(this: IfBlock): void {
    const kept = new Map<string, Blockly.Connection>();
    for (const input of [...this.inputList]) {
      if (input.name === 'IF0' || input.name === 'DO0') continue;
      const child = input.connection?.targetConnection;
      if (child && /^(IF|DO)\d+$|^ELSE$/.test(input.name)) kept.set(input.name, child);
      this.removeInput(input.name);
    }
    for (let n = 1; n <= this.elseifCount_; n++) {
      this.appendValueInput(`IF${n}`).setCheck('Boolean').appendField(Blockly.Msg['CONTROLS_IF_MSG_ELSEIF'] ?? 'else if');
      const branch = n;
      this.appendDummyInput(removeRow(n)).appendField(
        button(REMOVE_SRC, REMOVE_SIZE, REMOVE_SIZE, IF_BUTTON_TEXT.removeElseIfAlt, IF_BUTTON_TEXT.removeElseIfTooltip, (b) => b.removeElseIf(branch)),
      );
      this.appendStatementInput(`DO${n}`).appendField(Blockly.Msg['CONTROLS_IF_MSG_THEN'] ?? 'do');
    }
    if (this.elseCount_) {
      this.appendDummyInput(ELSE_ROW)
        .appendField(Blockly.Msg['CONTROLS_IF_MSG_ELSE'] ?? 'else')
        .appendField(button(REMOVE_SRC, REMOVE_SIZE, REMOVE_SIZE, IF_BUTTON_TEXT.removeElseAlt, IF_BUTTON_TEXT.removeElseTooltip, (b) => b.removeElse()));
      this.appendStatementInput('ELSE');
    }
    const add = this.appendDummyInput(ADD_ROW);
    add.appendField(button(ADD_ELSE_IF_SRC, ADD_ELSE_IF_WIDTH, BUTTON_HEIGHT, IF_BUTTON_TEXT.addElseIfAlt, IF_BUTTON_TEXT.addElseIfTooltip, (b) => b.addElseIf()));
    if (!this.elseCount_) {
      add.appendField(button(ADD_ELSE_SRC, ADD_ELSE_WIDTH, BUTTON_HEIGHT, IF_BUTTON_TEXT.addElseAlt, IF_BUTTON_TEXT.addElseTooltip, (b) => b.addElse()));
    }
    for (const [name, child] of kept) if (this.getInput(name)) child.reconnect(this, name);
  },

  /** The words of a collapsed block ("if ? do ? …", Blockly's toString): without the buttons' alt texts. */
  toTokens(this: IfBlock, emptyToken?: string): string[] {
    const base = Blockly.Block.prototype as unknown as { toTokens(emptyToken?: string): string[] };
    return base.toTokens.call(this, emptyToken).filter((token) => !BUTTON_ALTS.has(token));
  },

  addElseIf(this: IfBlock): void {
    reshape(this, (b) => {
      b.conditions.push(null);
      b.bodies.push(null);
    });
  },

  addElse(this: IfBlock): void {
    if (this.elseCount_) return;
    reshape(this, (b) => {
      b.otherwise = null;
    });
  },

  removeElseIf(this: IfBlock, n: number): void {
    if (!Number.isInteger(n) || n < 1 || n > this.elseifCount_) return;
    reshape(this, (b) => {
      b.conditions.splice(n - 1, 1);
      b.bodies.splice(n - 1, 1);
    });
  },

  removeElse(this: IfBlock): void {
    if (!this.elseCount_) return;
    reshape(this, (b) => {
      b.otherwise = undefined;
    });
  },
};

/** Replace Blockly's `controls_if` (gear pop-up) with the one above. Safe to call more than once. */
export function registerIfBlock(): void {
  Blockly.Blocks['controls_if'] = IF_BLOCK_MIXIN;
}
