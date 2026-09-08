/**
 * Block programming for the ZERO1 Smart Board simulator (docs/BLOCKS.md §11).
 *
 * The blocks generate an Arduino C++ sketch that goes through the same
 * `transpile()` → Executor path as hand-written code:
 *
 * ```ts
 * import * as Blockly from 'blockly';
 * import { registerZero1Blocks, workspaceToArduino } from './blocks';
 * const ws = new Blockly.Workspace();
 * Blockly.serialization.workspaces.load(DEFAULT_WORKSPACE, ws);
 * const sketch = workspaceToArduino(ws);
 * ```
 */
import type * as Blockly from 'blockly';
import { registerZero1Blocks } from './blocks';
import { ArduinoGenerator } from './generator';

export { registerZero1Blocks } from './blocks';
export { ArduinoGenerator, Order } from './generator';
export { TOOLBOX } from './toolbox';
export { ZERO1_THEME } from './theme';
export { BLOCK_EXAMPLES, DEFAULT_WORKSPACE, type BlockExample } from './examples';
export { inferTypes, type TypingResult } from './typing';

/** The shared generator: `arduinoGenerator.workspaceToCode(ws)` returns the full sketch text. */
export const arduinoGenerator: ArduinoGenerator = new ArduinoGenerator();

/** Define the z1_* blocks (if not done yet) and generate the sketch of a workspace. */
export function workspaceToArduino(ws: Blockly.Workspace): string {
  registerZero1Blocks();
  return arduinoGenerator.workspaceToCode(ws);
}
