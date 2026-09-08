/**
 * Block examples (docs/BLOCKS.md §11.6) and the empty default workspace.
 *
 * Every workspace is Blockly serialization JSON with one "when the board
 * starts" hat and one "repeat forever" hat, positioned so that they do not
 * overlap when opened. Small builders keep the JSON readable.
 */

/** One block example as shown in the Examples menu. */
export interface BlockExample {
  /** Stable id, e.g. `b01_blink`. */
  id: string;
  /** Human-friendly menu title. */
  title: string;
  /** Menu group: Outputs, Inputs, Display or Projects. */
  group: string;
  /** One sentence: what the program does. */
  description: string;
  /** Blockly serialization JSON (`Blockly.serialization.workspaces.load`). */
  workspace: object;
}

/** Block JSON as understood by `Blockly.serialization.workspaces.load`. */
interface BlockJson {
  type: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, InputJson>;
  next?: { block: BlockJson };
  extraState?: unknown;
}

interface InputJson {
  block?: BlockJson;
  shadow?: BlockJson;
}

interface VariableJson {
  name: string;
  id: string;
}

// --- builders -----------------------------------------------------------------

const num = (n: number): BlockJson => ({ type: 'math_number', fields: { NUM: n } });
const text = (t: string): BlockJson => ({ type: 'text', fields: { TEXT: t } });

/** A number input: a shadow literal, optionally covered by a real block. */
const n = (value: number, block?: BlockJson): InputJson => (block ? { shadow: num(value), block } : { shadow: num(value) });
/** A text input: a shadow literal, optionally covered by a real block. */
const s = (value: string, block?: BlockJson): InputJson => (block ? { shadow: text(value), block } : { shadow: text(value) });
/** A value input holding a real block only. */
const v = (block: BlockJson): InputJson => ({ block });

const getVar = (id: string): BlockJson => ({ type: 'variables_get', fields: { VAR: { id } } });
const setVar = (id: string, value: BlockJson): BlockJson => ({ type: 'variables_set', fields: { VAR: { id } }, inputs: { VALUE: v(value) } });
const changeVar = (id: string, delta: number): BlockJson => ({ type: 'math_change', fields: { VAR: { id } }, inputs: { DELTA: n(delta) } });

const compare = (op: string, a: BlockJson, b: BlockJson): BlockJson => ({
  type: 'logic_compare',
  fields: { OP: op },
  inputs: { A: v(a), B: v(b) },
});
const arithmetic = (op: string, a: BlockJson, b: BlockJson): BlockJson => ({
  type: 'math_arithmetic',
  fields: { OP: op },
  inputs: { A: v(a), B: v(b) },
});
const join = (...items: BlockJson[]): BlockJson => {
  const inputs: Record<string, InputJson> = {};
  items.forEach((item, i) => (inputs[`ADD${i}`] = v(item)));
  return { type: 'text_join', extraState: { itemCount: items.length }, inputs };
};

/** if / else if / else: `branches` are [condition, statements] pairs; `otherwise` is the else branch. */
function ifBlock(branches: Array<[BlockJson, BlockJson[]]>, otherwise?: BlockJson[]): BlockJson {
  const inputs: Record<string, InputJson> = {};
  branches.forEach(([condition, statements], i) => {
    inputs[`IF${i}`] = v(condition);
    if (statements.length) inputs[`DO${i}`] = v(chain(statements));
  });
  if (otherwise?.length) inputs['ELSE'] = v(chain(otherwise));
  const extraState: Record<string, unknown> = {};
  if (branches.length > 1) extraState['elseIfCount'] = branches.length - 1;
  if (otherwise) extraState['hasElse'] = true;
  const block: BlockJson = { type: 'controls_if', inputs };
  if (Object.keys(extraState).length) block.extraState = extraState;
  return block;
}

function untilLoop(condition: BlockJson, body: BlockJson[]): BlockJson {
  const inputs: Record<string, InputJson> = { BOOL: v(condition) };
  if (body.length) inputs['DO'] = v(chain(body));
  return { type: 'controls_whileUntil', fields: { MODE: 'UNTIL' }, inputs };
}

/** Link statement blocks with `next`. */
function chain(blocks: BlockJson[]): BlockJson {
  const [first, ...rest] = blocks;
  if (!first) throw new Error('chain() needs at least one block');
  let current = first;
  for (const block of rest) {
    current.next = { block };
    current = block;
  }
  return first;
}

function hat(type: 'z1_setup_hat' | 'z1_loop_hat', x: number, y: number, body: BlockJson[]): BlockJson {
  const block: BlockJson = { type, x, y };
  if (body.length) block.inputs = { DO: v(chain(body)) };
  return block;
}

/** A workspace with the two hats; the loop hat sits below the setup hat. */
function workspace(setup: BlockJson[], loop: BlockJson[], variables: VariableJson[] = []): object {
  const loopY = 150 + setup.length * 45;
  const ws: Record<string, unknown> = {
    blocks: { languageVersion: 0, blocks: [hat('z1_setup_hat', 30, 30, setup), hat('z1_loop_hat', 30, loopY, loop)] },
  };
  if (variables.length) ws['variables'] = variables;
  return ws;
}

// --- board statements ----------------------------------------------------------

const led = (which: 'RED' | 'GREEN' | 'BUILTIN', state: 'ON' | 'OFF'): BlockJson => ({ type: 'z1_led_set', fields: { LED: which, STATE: state } });
const rgb = (colour: string): BlockJson => ({ type: 'z1_rgb_colour', fields: { COLOUR: colour } });
const note = (name: string, ms: number): BlockJson => ({ type: 'z1_buzzer_note', fields: { NOTE: name }, inputs: { DURATION: n(ms) } });
const waitMs = (ms: number, block?: BlockJson): BlockJson => ({ type: 'z1_delay_ms', inputs: { MS: n(ms, block) } });
const waitS = (seconds: number): BlockJson => ({ type: 'z1_delay_s', inputs: { S: n(seconds) } });
const servo = (angle: number, block?: BlockJson): BlockJson => ({ type: 'z1_servo_angle', inputs: { ANGLE: n(angle, block) } });
const printLabeled = (label: string, value: BlockJson): BlockJson => ({ type: 'z1_serial_print_labeled', fields: { LABEL: label }, inputs: { VALUE: v(value) } });
const printLine = (value: BlockJson): BlockJson => ({ type: 'z1_serial_print', fields: { NEWLINE: 'NEWLINE' }, inputs: { VALUE: v(value) } });
const lcdLine = (row: '0' | '1', value: BlockJson): BlockJson => ({ type: 'z1_lcd_line', fields: { ROW: row }, inputs: { TEXT: v(value) } });
const buttonPressed = (button: '1' | '2'): BlockJson => ({ type: 'z1_button_pressed', fields: { BUTTON: button } });
const millis = (): BlockJson => ({ type: 'z1_millis' });

/** An empty program: the two hats and nothing else. */
export const DEFAULT_WORKSPACE: object = workspace([], []);

/** The block examples of the Examples menu, in lesson order. */
export const BLOCK_EXAMPLES: BlockExample[] = [
  // --- Outputs -----------------------------------------------------------------
  {
    id: 'b01_blink',
    title: 'Blink the red LED',
    group: 'Outputs',
    description: 'The first program: the red LED (A1) goes on for half a second, then off for half a second.',
    workspace: workspace([], [led('RED', 'ON'), waitMs(500), led('RED', 'OFF'), waitMs(500)]),
  },
  {
    id: 'b02_rgb_party',
    title: 'RGB party',
    group: 'Outputs',
    description: 'The RGB LED (D9) cycles through red, green, blue and yellow.',
    workspace: workspace([], [rgb('RED'), waitS(0.5), rgb('GREEN'), waitS(0.5), rgb('BLUE'), waitS(0.5), rgb('YELLOW'), waitS(0.5)]),
  },
  {
    id: 'b03_melody',
    title: 'Melody',
    group: 'Outputs',
    description: 'Plays the first notes of "Frere Jacques" on the buzzer (D8), then pauses.',
    workspace: workspace([], [note('C4', 400), note('D4', 400), note('E4', 400), note('C4', 400), waitS(1)]),
  },
  {
    id: 'b04_count_7seg',
    title: 'Count on the 7-segment',
    group: 'Outputs',
    description: 'A variable counts from 0 to 9 on the 7-segment display, one step per second, then starts again.',
    workspace: workspace(
      [setVar('count', num(0))],
      [
        { type: 'z1_sevenseg_digit', inputs: { DIGIT: n(0, getVar('count')) } },
        waitS(1),
        changeVar('count', 1),
        ifBlock([[compare('GT', getVar('count'), num(9)), [setVar('count', num(0))]]]),
      ],
      [{ name: 'count', id: 'count' }],
    ),
  },
  {
    id: 'b05_servo_wave',
    title: 'Servo wave',
    group: 'Outputs',
    description: 'The servo (D4) swings from 0 to 180 degrees and back, waiting a second at each end.',
    workspace: workspace([], [servo(0), waitS(1), servo(180), waitS(1)]),
  },

  // --- Inputs ------------------------------------------------------------------
  {
    id: 'b10_button_led',
    title: 'Button and LED',
    group: 'Inputs',
    description: 'The red LED (A1) is on while button 1 (D6) is pressed.',
    workspace: workspace([], [ifBlock([[buttonPressed('1'), [led('RED', 'ON')]]], [led('RED', 'OFF')])]),
  },
  {
    id: 'b11_pot_servo',
    title: 'Potentiometer drives the servo',
    group: 'Inputs',
    description: 'The potentiometer (A3) position, mapped from 0-1023 to 0-180, becomes the servo (D4) angle.',
    workspace: workspace(
      [],
      [
        setVar('angle', {
          type: 'z1_map',
          inputs: { VALUE: n(0, { type: 'z1_pot_read' }), FROM_LOW: n(0), FROM_HIGH: n(1023), TO_LOW: n(0), TO_HIGH: n(180) },
        }),
        servo(90, getVar('angle')),
        waitMs(20),
      ],
      [{ name: 'angle', id: 'angle' }],
    ),
  },
  {
    id: 'b12_night_light',
    title: 'Night light',
    group: 'Inputs',
    description: 'When the LDR (A3, jumper on LDR) sees little light the red LED (A1) turns on; the light level is printed.',
    workspace: workspace(
      [],
      [
        ifBlock([[{ type: 'z1_ldr_dark', inputs: { THRESHOLD: n(300) } }, [led('RED', 'ON')]]], [led('RED', 'OFF')]),
        printLabeled('light', { type: 'z1_ldr_read' }),
        waitMs(500),
      ],
    ),
  },
  {
    id: 'b13_dht_serial',
    title: 'DHT22 on the Serial Monitor',
    group: 'Inputs',
    description: 'Prints the temperature and the humidity of the DHT22 (D5) every 2 seconds.',
    workspace: workspace(
      [],
      [
        printLabeled('temperature', { type: 'z1_dht_read', fields: { WHAT: 'TEMPERATURE' } }),
        printLabeled('humidity', { type: 'z1_dht_read', fields: { WHAT: 'HUMIDITY' } }),
        waitS(2),
      ],
    ),
  },

  // --- Display -----------------------------------------------------------------
  {
    id: 'b20_lcd_hello',
    title: 'LCD hello',
    group: 'Display',
    description: 'Line 1 of the LCD says hello; line 2 shows the seconds since the board started.',
    workspace: workspace(
      [lcdLine('0', text('Hello, ZERO1!'))],
      [lcdLine('1', join(text('Time: '), arithmetic('DIVIDE', millis(), num(1000)), text(' s'))), waitS(1)],
    ),
  },

  // --- Projects ----------------------------------------------------------------
  {
    id: 'b30_parking',
    title: 'Parking sensor',
    group: 'Projects',
    description: 'The ultrasonic sensor (D3/D2) sets the RGB LED to green, orange or red; below 30 cm the buzzer beeps.',
    workspace: workspace(
      [],
      [
        setVar('distance', { type: 'z1_ultrasonic_cm' }),
        printLabeled('distance (cm)', getVar('distance')),
        ifBlock(
          [
            [compare('LT', getVar('distance'), num(30)), [rgb('RED'), { type: 'z1_buzzer_tone', inputs: { FREQ: n(1000), DURATION: n(100) } }]],
            [compare('LT', getVar('distance'), num(60)), [rgb('ORANGE')]],
          ],
          [rgb('GREEN')],
        ),
        waitMs(200),
      ],
      [{ name: 'distance', id: 'distance' }],
    ),
  },
  {
    id: 'b31_reaction',
    title: 'Reaction game',
    group: 'Projects',
    description: 'Press button 1, wait for the green LED, then press button 2 as fast as you can: your reaction time is printed.',
    workspace: workspace(
      [],
      [
        led('GREEN', 'OFF'),
        printLine(text('Press button 1 to start')),
        untilLoop(buttonPressed('1'), [waitMs(10)]),
        waitMs(1000, { type: 'math_random_int', inputs: { FROM: n(1000), TO: n(3000) } }),
        led('GREEN', 'ON'),
        setVar('start', millis()),
        untilLoop(buttonPressed('2'), [waitMs(10)]),
        setVar('reaction', arithmetic('MINUS', millis(), getVar('start'))),
        printLabeled('reaction time (ms)', getVar('reaction')),
        led('GREEN', 'OFF'),
        waitS(2),
      ],
      [
        { name: 'start', id: 'start' },
        { name: 'reaction', id: 'reaction' },
      ],
    ),
  },
];
