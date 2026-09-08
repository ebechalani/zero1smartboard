/**
 * Dark purple Blockly theme matching the simulator UI (docs/BLOCKS.md §11.1).
 * Built on the Zelos theme so that it renders well with the 'zelos' renderer.
 */
import * as Blockly from 'blockly';
import { BLOCK_COLOURS } from './blocks';

/** Hue (as used by classic Blockly categories) → hex colour. */
function hue(value: string): string {
  return Blockly.utils.colour.hueToHex(Number(value));
}

const CATEGORY_COLOURS: Record<string, string> = {
  outputs: BLOCK_COLOURS.outputs,
  inputs: BLOCK_COLOURS.inputs,
  time: BLOCK_COLOURS.time,
  serial: BLOCK_COLOURS.serial,
  logic: hue(BLOCK_COLOURS.logic),
  loops: hue(BLOCK_COLOURS.loops),
  math: hue(BLOCK_COLOURS.math),
  text: hue(BLOCK_COLOURS.text),
  variables: hue(BLOCK_COLOURS.variables),
  functions: hue(BLOCK_COLOURS.functions),
};

/** The theme handed to `Blockly.inject({ theme })`. */
export const ZERO1_THEME: Blockly.Theme = Blockly.Theme.defineTheme('zero1', {
  name: 'zero1',
  base: Blockly.Themes.Zelos,
  blockStyles: {
    logic_blocks: { colourPrimary: CATEGORY_COLOURS['logic'] },
    loop_blocks: { colourPrimary: CATEGORY_COLOURS['loops'] },
    math_blocks: { colourPrimary: CATEGORY_COLOURS['math'] },
    text_blocks: { colourPrimary: CATEGORY_COLOURS['text'] },
    variable_blocks: { colourPrimary: CATEGORY_COLOURS['variables'] },
    variable_dynamic_blocks: { colourPrimary: CATEGORY_COLOURS['variables'] },
    procedure_blocks: { colourPrimary: CATEGORY_COLOURS['functions'] },
    hat_blocks: { colourPrimary: BLOCK_COLOURS.hat, hat: 'cap' },
    z1_output_blocks: { colourPrimary: CATEGORY_COLOURS['outputs'] },
    z1_input_blocks: { colourPrimary: CATEGORY_COLOURS['inputs'] },
    z1_time_blocks: { colourPrimary: CATEGORY_COLOURS['time'] },
    z1_serial_blocks: { colourPrimary: CATEGORY_COLOURS['serial'] },
  },
  categoryStyles: {
    z1_outputs_category: { colour: CATEGORY_COLOURS['outputs']! },
    z1_inputs_category: { colour: CATEGORY_COLOURS['inputs']! },
    z1_time_category: { colour: CATEGORY_COLOURS['time']! },
    z1_serial_category: { colour: CATEGORY_COLOURS['serial']! },
    logic_category: { colour: CATEGORY_COLOURS['logic']! },
    loop_category: { colour: CATEGORY_COLOURS['loops']! },
    math_category: { colour: CATEGORY_COLOURS['math']! },
    text_category: { colour: CATEGORY_COLOURS['text']! },
    variable_category: { colour: CATEGORY_COLOURS['variables']! },
    procedure_category: { colour: CATEGORY_COLOURS['functions']! },
  },
  componentStyles: {
    workspaceBackgroundColour: '#1b1533',
    toolboxBackgroundColour: '#241a3d',
    toolboxForegroundColour: '#ede9fe',
    flyoutBackgroundColour: '#2a2048',
    flyoutForegroundColour: '#ede9fe',
    flyoutOpacity: 1,
    scrollbarColour: '#8b5cf6',
    scrollbarOpacity: 0.5,
    insertionMarkerColour: '#ffffff',
    insertionMarkerOpacity: 0.3,
    markerColour: '#a78bfa',
    cursorColour: '#a78bfa',
    selectedGlowColour: '#c4b5fd',
    selectedGlowOpacity: 0.5,
    replacementGlowColour: '#ffffff',
    replacementGlowOpacity: 0.3,
  },
  fontStyle: {
    family: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    weight: '600',
    size: 12,
  },
  startHats: false,
});
