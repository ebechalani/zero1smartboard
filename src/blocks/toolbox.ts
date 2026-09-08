/**
 * Category toolbox of the block editor (docs/BLOCKS.md §11.2): Board ·
 * outputs, Board · inputs, Time, Serial, Logic, Loops, Math, Text, Variables,
 * Functions. Number and text inputs carry shadow blocks so that every block
 * dragged from the toolbox is complete.
 */
import type * as Blockly from 'blockly';
import { BLOCK_COLOURS } from './blocks';

type Inputs = Record<string, { shadow: { type: string; fields: Record<string, unknown> } }>;

interface BlockItem {
  kind: 'block';
  type: string;
  fields?: Record<string, unknown>;
  inputs?: Inputs;
}

function num(n: number): { shadow: { type: string; fields: Record<string, unknown> } } {
  return { shadow: { type: 'math_number', fields: { NUM: n } } };
}

function str(text: string): { shadow: { type: string; fields: Record<string, unknown> } } {
  return { shadow: { type: 'text', fields: { TEXT: text } } };
}

function block(type: string, inputs?: Inputs, fields?: Record<string, unknown>): BlockItem {
  const item: BlockItem = { kind: 'block', type };
  if (inputs) item.inputs = inputs;
  if (fields) item.fields = fields;
  return item;
}

function category(name: string, colour: string, contents: BlockItem[]): Record<string, unknown> {
  return { kind: 'category', name, colour, contents };
}

/** The toolbox definition handed to `Blockly.inject`. */
export const TOOLBOX: Blockly.utils.toolbox.ToolboxDefinition = {
  kind: 'categoryToolbox',
  contents: [
    category('Board · outputs', BLOCK_COLOURS.outputs, [
      block('z1_led_set'),
      block('z1_led_toggle'),
      block('z1_rgb_colour'),
      block('z1_rgb_set', { R: num(255), G: num(0), B: num(0) }),
      block('z1_rgb_brightness', { VALUE: num(50) }),
      block('z1_buzzer_note', { DURATION: num(300) }),
      block('z1_buzzer_tone', { FREQ: num(440), DURATION: num(300) }),
      block('z1_buzzer_set'),
      block('z1_sevenseg_digit', { DIGIT: num(7) }),
      block('z1_sevenseg_clear'),
      block('z1_motor_set'),
      block('z1_servo_angle', { ANGLE: num(90) }),
      block('z1_lcd_line', { TEXT: str('Hello!') }),
      block('z1_lcd_print', { TEXT: str('Hello!'), COL: num(0) }),
      block('z1_lcd_clear'),
      block('z1_lcd_backlight'),
    ]),
    category('Board · inputs', BLOCK_COLOURS.inputs, [
      block('z1_button_pressed'),
      block('z1_pot_read'),
      block('z1_pot_percent'),
      block('z1_ldr_read'),
      block('z1_ldr_dark', { THRESHOLD: num(300) }),
      block('z1_dht_read'),
      block('z1_ultrasonic_cm'),
    ]),
    category('Time', BLOCK_COLOURS.time, [
      block('z1_delay_ms', { MS: num(500) }),
      block('z1_delay_s', { S: num(1) }),
      block('z1_millis'),
      block('z1_map', { VALUE: num(0), FROM_LOW: num(0), FROM_HIGH: num(1023), TO_LOW: num(0), TO_HIGH: num(180) }),
    ]),
    category('Serial', BLOCK_COLOURS.serial, [
      block('z1_serial_print', { VALUE: str('Hello') }),
      block('z1_serial_print_labeled', { VALUE: num(0) }),
      block('z1_serial_available'),
      block('z1_serial_read_line'),
    ]),
    category('Logic', BLOCK_COLOURS.logic, [
      block('controls_if'),
      block('logic_compare'),
      block('logic_operation'),
      block('logic_negate'),
      block('logic_boolean'),
      block('logic_ternary'),
    ]),
    category('Loops', BLOCK_COLOURS.loops, [
      block('z1_setup_hat'),
      block('z1_loop_hat'),
      block('controls_repeat_ext', { TIMES: num(10) }),
      block('controls_whileUntil'),
      block('controls_for', { FROM: num(1), TO: num(10), BY: num(1) }),
      block('controls_flow_statements'),
    ]),
    category('Math', BLOCK_COLOURS.math, [
      block('math_number', undefined, { NUM: 0 }),
      block('math_arithmetic', { A: num(1), B: num(1) }),
      block('math_single', { NUM: num(9) }),
      block('math_trig', { NUM: num(45) }),
      block('math_constant'),
      block('math_number_property', { NUMBER_TO_CHECK: num(0) }),
      block('math_round', { NUM: num(3.1) }),
      block('math_modulo', { DIVIDEND: num(64), DIVISOR: num(10) }),
      block('math_constrain', { VALUE: num(50), LOW: num(1), HIGH: num(100) }),
      block('math_random_int', { FROM: num(1), TO: num(100) }),
      block('math_random_float'),
    ]),
    category('Text', BLOCK_COLOURS.text, [
      block('text'),
      block('text_join'),
      block('text_length', { VALUE: str('abc') }),
      block('text_isEmpty', { VALUE: str('') }),
      block('text_append', { TEXT: str('') }),
      block('text_changeCase', { TEXT: str('abc') }),
      block('text_trim', { TEXT: str(' abc ') }),
    ]),
    { kind: 'category', name: 'Variables', colour: BLOCK_COLOURS.variables, custom: 'VARIABLE' },
    { kind: 'category', name: 'Functions', colour: BLOCK_COLOURS.functions, custom: 'PROCEDURE' },
  ],
} as unknown as Blockly.utils.toolbox.ToolboxInfo;
