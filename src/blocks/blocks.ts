/**
 * Definitions of the ZERO1 custom blocks (`z1_*`, docs/BLOCKS.md §11.2).
 *
 * Every block is defined with JSON so that it works both in the browser and
 * headless in Node. The tables in this file (colours, notes, block colours)
 * are shared with the code generator and the toolbox.
 */
import * as Blockly from 'blockly';

/** Colour of each toolbox category / block family (docs/BLOCKS.md §11.2). */
export const BLOCK_COLOURS = {
  /** The two hat blocks ("when the board starts", "repeat forever"). */
  hat: '#d946ef',
  outputs: '#7c3aed',
  inputs: '#2563eb',
  time: '#f59e0b',
  serial: '#0ea5e9',
  logic: '210',
  loops: '120',
  math: '230',
  text: '160',
  variables: '330',
  functions: '290',
} as const;

/** Named colours of the `z1_rgb_colour` dropdown, as [label, value] and the RGB triple generated for each. */
export const RGB_COLOURS: ReadonlyArray<{ label: string; value: string; rgb: [number, number, number] }> = [
  { label: 'red', value: 'RED', rgb: [255, 0, 0] },
  { label: 'green', value: 'GREEN', rgb: [0, 255, 0] },
  { label: 'blue', value: 'BLUE', rgb: [0, 0, 255] },
  { label: 'yellow', value: 'YELLOW', rgb: [255, 255, 0] },
  { label: 'cyan', value: 'CYAN', rgb: [0, 255, 255] },
  { label: 'magenta', value: 'MAGENTA', rgb: [255, 0, 255] },
  { label: 'orange', value: 'ORANGE', rgb: [255, 120, 0] },
  { label: 'purple', value: 'PURPLE', rgb: [128, 0, 255] },
  { label: 'white', value: 'WHITE', rgb: [255, 255, 255] },
  { label: 'off', value: 'OFF', rgb: [0, 0, 0] },
];

/** Notes of the `z1_buzzer_note` dropdown (C4 … C6) with their frequency in Hz. */
export const NOTES: ReadonlyArray<{ label: string; value: string; hz: number }> = [
  { label: 'C4 (do)', value: 'C4', hz: 262 },
  { label: 'D4 (re)', value: 'D4', hz: 294 },
  { label: 'E4 (mi)', value: 'E4', hz: 330 },
  { label: 'F4 (fa)', value: 'F4', hz: 349 },
  { label: 'G4 (sol)', value: 'G4', hz: 392 },
  { label: 'A4 (la)', value: 'A4', hz: 440 },
  { label: 'B4 (si)', value: 'B4', hz: 494 },
  { label: 'C5 (do)', value: 'C5', hz: 523 },
  { label: 'D5 (re)', value: 'D5', hz: 587 },
  { label: 'E5 (mi)', value: 'E5', hz: 659 },
  { label: 'F5 (fa)', value: 'F5', hz: 698 },
  { label: 'G5 (sol)', value: 'G5', hz: 784 },
  { label: 'A5 (la)', value: 'A5', hz: 880 },
  { label: 'B5 (si)', value: 'B5', hz: 988 },
  { label: 'C6 (do)', value: 'C6', hz: 1047 },
];

/** Names of the extensions registered by {@link registerZero1Blocks}. */
const EXT = {
  hatCap: 'z1_hat_cap',
  ledTooltip: 'z1_led_tooltip',
  ledToggleTooltip: 'z1_led_toggle_tooltip',
  buttonTooltip: 'z1_button_tooltip',
  dhtTooltip: 'z1_dht_tooltip',
} as const;

const LED_PINS: Record<string, string> = {
  RED: 'the red LED on pin A1',
  GREEN: 'the green LED on pin A2',
  BUILTIN: 'the small built-in LED "L" on pin 13',
};

const ON_OFF = [
  ['on', 'ON'],
  ['off', 'OFF'],
];

const LED_OPTIONS = [
  ['red', 'RED'],
  ['green', 'GREEN'],
  ['built-in', 'BUILTIN'],
];

const ROW_OPTIONS = [
  ['1', '0'],
  ['2', '1'],
];

function statement(def: Record<string, unknown>): Record<string, unknown> {
  return { previousStatement: null, nextStatement: null, ...def };
}

function value(check: string, def: Record<string, unknown>): Record<string, unknown> {
  return { output: check, ...def };
}

function numberInput(name: string): Record<string, unknown> {
  return { type: 'input_value', name, check: 'Number' };
}

/** JSON definitions of every z1_* block. */
const BLOCK_DEFINITIONS: Record<string, unknown>[] = [
  // --- hats ---------------------------------------------------------------
  {
    type: 'z1_setup_hat',
    message0: 'when the board starts',
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: BLOCK_COLOURS.hat,
    tooltip: 'The blocks inside run once, when the board is powered on or reset (this is setup()).',
    extensions: [EXT.hatCap],
  },
  {
    type: 'z1_loop_hat',
    message0: 'repeat forever',
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: BLOCK_COLOURS.hat,
    tooltip: 'The blocks inside run again and again, as long as the board is on (this is loop()).',
    extensions: [EXT.hatCap],
  },

  // --- Board · outputs ------------------------------------------------------
  statement({
    type: 'z1_led_set',
    message0: 'turn %1 LED %2',
    args0: [
      { type: 'field_dropdown', name: 'LED', options: LED_OPTIONS },
      { type: 'field_dropdown', name: 'STATE', options: ON_OFF },
    ],
    colour: BLOCK_COLOURS.outputs,
    extensions: [EXT.ledTooltip],
  }),
  statement({
    type: 'z1_led_toggle',
    message0: 'toggle %1 LED',
    args0: [{ type: 'field_dropdown', name: 'LED', options: LED_OPTIONS }],
    colour: BLOCK_COLOURS.outputs,
    extensions: [EXT.ledToggleTooltip],
  }),
  statement({
    type: 'z1_rgb_colour',
    message0: 'set RGB LED to %1',
    args0: [{ type: 'field_dropdown', name: 'COLOUR', options: RGB_COLOURS.map((c) => [c.label, c.value]) }],
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Lights the RGB LED (WS2812 on pin 9) in a colour, or switches it off.',
  }),
  statement({
    type: 'z1_rgb_set',
    message0: 'set RGB LED red %1 green %2 blue %3',
    args0: [numberInput('R'), numberInput('G'), numberInput('B')],
    inputsInline: true,
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Mixes a colour for the RGB LED (pin 9): red, green and blue from 0 (off) to 255 (full).',
  }),
  statement({
    type: 'z1_rgb_brightness',
    message0: 'set RGB brightness %1',
    args0: [numberInput('VALUE')],
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Brightness of the RGB LED (pin 9), from 0 (off) to 255 (maximum).',
  }),
  statement({
    type: 'z1_buzzer_tone',
    message0: 'play tone %1 Hz for %2 ms',
    args0: [numberInput('FREQ'), numberInput('DURATION')],
    inputsInline: true,
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Sounds the buzzer (pin 8) at a frequency in hertz for some milliseconds, then stops it.',
  }),
  statement({
    type: 'z1_buzzer_note',
    message0: 'play note %1 for %2 ms',
    args0: [{ type: 'field_dropdown', name: 'NOTE', options: NOTES.map((n) => [n.label, n.value]) }, numberInput('DURATION')],
    inputsInline: true,
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Plays a musical note on the buzzer (pin 8) for some milliseconds.',
  }),
  statement({
    type: 'z1_buzzer_set',
    message0: 'buzzer %1',
    args0: [{ type: 'field_dropdown', name: 'STATE', options: ON_OFF }],
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Switches the buzzer (pin 8) on or off, like an LED.',
  }),
  statement({
    type: 'z1_sevenseg_digit',
    message0: '7-segment show digit %1',
    args0: [numberInput('DIGIT')],
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Shows a digit from 0 to 9 on the 7-segment display (74HC595 on pins 12, 11 and 10).',
  }),
  statement({
    type: 'z1_sevenseg_clear',
    message0: '7-segment clear',
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Switches every segment of the 7-segment display off (74HC595 on pins 12, 11 and 10).',
  }),
  statement({
    type: 'z1_motor_set',
    message0: 'motor %1',
    args0: [{ type: 'field_dropdown', name: 'STATE', options: ON_OFF }],
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Starts or stops the DC motor (driver on pin A0).',
  }),
  statement({
    type: 'z1_servo_angle',
    message0: 'servo turn to %1 degrees',
    args0: [numberInput('ANGLE')],
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Turns the servo (header on pin 4) to an angle from 0 to 180 degrees.',
  }),
  statement({
    type: 'z1_lcd_print',
    message0: 'LCD write %1 at row %2 column %3',
    args0: [
      { type: 'input_value', name: 'TEXT' },
      { type: 'field_dropdown', name: 'ROW', options: ROW_OPTIONS },
      numberInput('COL'),
    ],
    inputsInline: true,
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Writes text or a number on the LCD (I2C on pins A4/A5) starting at a row (1-2) and a column (0-15).',
  }),
  statement({
    type: 'z1_lcd_line',
    message0: 'LCD show %1 on line %2',
    args0: [
      { type: 'input_value', name: 'TEXT' },
      { type: 'field_dropdown', name: 'ROW', options: ROW_OPTIONS },
    ],
    inputsInline: true,
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Clears one line of the LCD (I2C on pins A4/A5) and shows text or a number on it.',
  }),
  statement({
    type: 'z1_lcd_clear',
    message0: 'LCD clear',
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Erases everything on the LCD (I2C on pins A4/A5).',
  }),
  statement({
    type: 'z1_lcd_backlight',
    message0: 'LCD backlight %1',
    args0: [{ type: 'field_dropdown', name: 'STATE', options: ON_OFF }],
    colour: BLOCK_COLOURS.outputs,
    tooltip: 'Switches the light behind the LCD (I2C on pins A4/A5) on or off.',
  }),

  // --- Board · inputs -------------------------------------------------------
  value('Boolean', {
    type: 'z1_button_pressed',
    message0: 'button %1 is pressed',
    args0: [
      {
        type: 'field_dropdown',
        name: 'BUTTON',
        options: [
          ['1', '1'],
          ['2', '2'],
        ],
      },
    ],
    colour: BLOCK_COLOURS.inputs,
    extensions: [EXT.buttonTooltip],
  }),
  value('Number', {
    type: 'z1_pot_read',
    message0: 'potentiometer value (0-1023)',
    colour: BLOCK_COLOURS.inputs,
    tooltip: 'Position of the potentiometer knob (pin A3, jumper on POT): 0 to 1023.',
  }),
  value('Number', {
    type: 'z1_pot_percent',
    message0: 'potentiometer %%',
    colour: BLOCK_COLOURS.inputs,
    tooltip: 'Position of the potentiometer knob (pin A3, jumper on POT) as a percentage: 0 to 100.',
  }),
  value('Number', {
    type: 'z1_ldr_read',
    message0: 'light level (0-1023)',
    colour: BLOCK_COLOURS.inputs,
    tooltip: 'Amount of light on the LDR (pin A3, jumper on LDR): 0 = dark, 1023 = very bright.',
  }),
  value('Boolean', {
    type: 'z1_ldr_dark',
    message0: 'it is dark (light below %1)',
    args0: [numberInput('THRESHOLD')],
    colour: BLOCK_COLOURS.inputs,
    tooltip: 'True when the light on the LDR (pin A3, jumper on LDR) is below the value.',
  }),
  value('Number', {
    type: 'z1_dht_read',
    message0: 'DHT22 %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'WHAT',
        options: [
          ['temperature °C', 'TEMPERATURE'],
          ['humidity %', 'HUMIDITY'],
        ],
      },
    ],
    colour: BLOCK_COLOURS.inputs,
    extensions: [EXT.dhtTooltip],
  }),
  value('Number', {
    type: 'z1_ultrasonic_cm',
    message0: 'distance (cm)',
    colour: BLOCK_COLOURS.inputs,
    tooltip: 'Distance measured by the ultrasonic sensor (HC-SR04: trigger on pin 3, echo on pin 2), in centimetres.',
  }),

  // --- Time -----------------------------------------------------------------
  statement({
    type: 'z1_delay_ms',
    message0: 'wait %1 milliseconds',
    args0: [numberInput('MS')],
    colour: BLOCK_COLOURS.time,
    tooltip: 'Pauses the program for some milliseconds (1000 ms = 1 second). No pin is used.',
  }),
  statement({
    type: 'z1_delay_s',
    message0: 'wait %1 seconds',
    args0: [numberInput('S')],
    colour: BLOCK_COLOURS.time,
    tooltip: 'Pauses the program for some seconds. No pin is used.',
  }),
  value('Number', {
    type: 'z1_millis',
    message0: 'time since start (ms)',
    colour: BLOCK_COLOURS.time,
    tooltip: 'Milliseconds since the board started (millis()). No pin is used.',
  }),
  value('Number', {
    type: 'z1_map',
    message0: 'map %1 from %2 … %3 to %4 … %5',
    args0: [numberInput('VALUE'), numberInput('FROM_LOW'), numberInput('FROM_HIGH'), numberInput('TO_LOW'), numberInput('TO_HIGH')],
    inputsInline: true,
    colour: BLOCK_COLOURS.time,
    tooltip: 'Converts a value from one range to another, e.g. 0…1023 from the potentiometer to 0…180 for the servo. No pin is used.',
  }),

  // --- Serial ---------------------------------------------------------------
  statement({
    type: 'z1_serial_print',
    message0: 'Serial print %1 %2',
    args0: [
      { type: 'input_value', name: 'VALUE' },
      {
        type: 'field_dropdown',
        name: 'NEWLINE',
        options: [
          ['and go to next line', 'NEWLINE'],
          ['on the same line', 'SAME_LINE'],
        ],
      },
    ],
    inputsInline: true,
    colour: BLOCK_COLOURS.serial,
    tooltip: 'Sends text or a number to the Serial Monitor (USB, pins 0 and 1) at 9600 baud.',
  }),
  statement({
    type: 'z1_serial_print_labeled',
    message0: 'Serial print %1 = %2',
    args0: [
      { type: 'field_input', name: 'LABEL', text: 'value' },
      { type: 'input_value', name: 'VALUE' },
    ],
    colour: BLOCK_COLOURS.serial,
    tooltip: 'Sends a label and a value to the Serial Monitor (USB, pins 0 and 1), e.g. "light: 512".',
  }),
  value('Boolean', {
    type: 'z1_serial_available',
    message0: 'text received from Serial',
    colour: BLOCK_COLOURS.serial,
    tooltip: 'True when the Serial Monitor (USB, pins 0 and 1) has sent text that was not read yet.',
  }),
  value('String', {
    type: 'z1_serial_read_line',
    message0: 'line received from Serial',
    colour: BLOCK_COLOURS.serial,
    tooltip: 'Reads one line of text typed in the Serial Monitor (USB, pins 0 and 1).',
  }),
];

/** Every z1_* block type, in definition order. */
export const Z1_BLOCK_TYPES: readonly string[] = BLOCK_DEFINITIONS.map((d) => d['type'] as string);

/**
 * Defines every z1_* block (and the extensions they use). Safe to call more
 * than once: the second call does nothing.
 */
export function registerZero1Blocks(): void {
  if (Blockly.Blocks['z1_setup_hat']) return;

  Blockly.Extensions.register(EXT.hatCap, function (this: Blockly.Block) {
    this.hat = 'cap';
  });
  Blockly.Extensions.register(
    EXT.ledTooltip,
    Blockly.Extensions.buildTooltipForDropdown('LED', {
      RED: `Switches ${LED_PINS['RED']} on or off.`,
      GREEN: `Switches ${LED_PINS['GREEN']} on or off.`,
      BUILTIN: `Switches ${LED_PINS['BUILTIN']} on or off.`,
    }),
  );
  Blockly.Extensions.register(
    EXT.ledToggleTooltip,
    Blockly.Extensions.buildTooltipForDropdown('LED', {
      RED: `Switches ${LED_PINS['RED']} off when it is on, and on when it is off.`,
      GREEN: `Switches ${LED_PINS['GREEN']} off when it is on, and on when it is off.`,
      BUILTIN: `Switches ${LED_PINS['BUILTIN']} off when it is on, and on when it is off.`,
    }),
  );
  Blockly.Extensions.register(
    EXT.buttonTooltip,
    Blockly.Extensions.buildTooltipForDropdown('BUTTON', {
      '1': 'True while push button 1 (pin 6) is held down.',
      '2': 'True while push button 2 (pin 7) is held down.',
    }),
  );
  Blockly.Extensions.register(
    EXT.dhtTooltip,
    Blockly.Extensions.buildTooltipForDropdown('WHAT', {
      TEMPERATURE: 'Temperature in °C measured by the DHT22 sensor (header on pin 5).',
      HUMIDITY: 'Relative humidity in % measured by the DHT22 sensor (header on pin 5).',
    }),
  );

  Blockly.common.defineBlocksWithJsonArray(BLOCK_DEFINITIONS);
}
