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
  /** Menu group: Outputs, Inputs, Display, Projects, or one of the part-by-part groups (LED, Buzzer, ...). */
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

/** repeat N times. */
function repeat(times: number, body: BlockJson[]): BlockJson {
  const inputs: Record<string, InputJson> = { TIMES: n(times) };
  if (body.length) inputs['DO'] = v(chain(body));
  return { type: 'controls_repeat_ext', inputs };
}

/** count with `id` from `from` to `to` by `by`. */
function forLoop(id: string, from: number, to: number, by: number, body: BlockJson[]): BlockJson {
  const inputs: Record<string, InputJson> = { FROM: n(from), TO: n(to), BY: n(by) };
  if (body.length) inputs['DO'] = v(chain(body));
  return { type: 'controls_for', fields: { VAR: { id } }, inputs };
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
const buzzer = (state: 'ON' | 'OFF'): BlockJson => ({ type: 'z1_buzzer_set', fields: { STATE: state } });
const motor = (state: 'ON' | 'OFF'): BlockJson => ({ type: 'z1_motor_set', fields: { STATE: state } });
const sevenSegDigit = (digit: number, block?: BlockJson): BlockJson => ({ type: 'z1_sevenseg_digit', inputs: { DIGIT: n(digit, block) } });
const sevenSegClear = (): BlockJson => ({ type: 'z1_sevenseg_clear' });
const ldrRead = (): BlockJson => ({ type: 'z1_ldr_read' });
const distanceCm = (): BlockJson => ({ type: 'z1_ultrasonic_cm' });
const dhtRead = (what: 'TEMPERATURE' | 'HUMIDITY'): BlockJson => ({ type: 'z1_dht_read', fields: { WHAT: what } });
const beep = (ms: number): BlockJson[] => [buzzer('ON'), waitMs(ms), buzzer('OFF')];

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

  // --- LED ---------------------------------------------------------------------
  {
    id: 'b40_led_blink_red',
    title: 'Blinking red LED',
    group: 'LED',
    description: 'The red LED (A1) is on for 1 second and off for 1 second, forever.',
    workspace: workspace([], [led('RED', 'ON'), waitS(1), led('RED', 'OFF'), waitS(1)]),
  },
  {
    id: 'b41_led_red_green',
    title: 'Blinking alternately between red and green',
    group: 'LED',
    description: 'Red (A1) and green (A2) take turns every 500 ms; the old one goes off before the new one comes on.',
    workspace: workspace([], [led('GREEN', 'OFF'), led('RED', 'ON'), waitMs(500), led('RED', 'OFF'), led('GREEN', 'ON'), waitMs(500)]),
  },
  {
    id: 'b42_led_blink_10_times',
    title: 'Blinking 10 times',
    group: 'LED',
    description: 'When the board starts, a repeat block blinks the red LED exactly 10 times; then nothing else happens.',
    workspace: workspace([repeat(10, [led('RED', 'ON'), waitMs(300), led('RED', 'OFF'), waitMs(300)])], []),
  },

  // --- Buzzer ------------------------------------------------------------------
  {
    id: 'b43_buzzer_short_beeps',
    title: 'Short beeps (infinite)',
    group: 'Buzzer',
    description: 'The buzzer (D8) is switched on for 100 ms and off for 500 ms, forever.',
    workspace: workspace([], [...beep(100), waitMs(500)]),
  },
  {
    id: 'b44_buzzer_beep_10_times',
    title: 'Beep 10 times',
    group: 'Buzzer',
    description: 'When the board starts, a repeat block beeps the buzzer exactly 10 times (200 ms on, 200 ms off).',
    workspace: workspace([repeat(10, [...beep(200), waitMs(200)])], []),
  },
  {
    id: 'b45_buzzer_led_10_times',
    title: 'Beep with red LED 10 times',
    group: 'Buzzer',
    description: 'Ten times: the red LED and the buzzer come on together for 200 ms, then both go off for 300 ms.',
    workspace: workspace([repeat(10, [led('RED', 'ON'), buzzer('ON'), waitMs(200), led('RED', 'OFF'), buzzer('OFF'), waitMs(300)])], []),
  },

  // --- Push Button -------------------------------------------------------------
  {
    id: 'b46_button_a_red_led',
    title: 'Turn red LED ON with Button A',
    group: 'Push Button',
    description: 'The red LED (A1) is on while button 1 (D6) is pressed, off otherwise.',
    workspace: workspace([], [ifBlock([[buttonPressed('1'), [led('RED', 'ON')]]], [led('RED', 'OFF')])]),
  },
  {
    id: 'b47_button_b_red_led',
    title: 'Turn red LED ON with Button B',
    group: 'Push Button',
    description: 'The red LED (A1) is on while button 2 (D7) is pressed, off otherwise.',
    workspace: workspace([], [ifBlock([[buttonPressed('2'), [led('RED', 'ON')]]], [led('RED', 'OFF')])]),
  },
  {
    id: 'b48_button_a_short_beep',
    title: 'Button A – short beep',
    group: 'Push Button',
    description: 'While button 1 is pressed the buzzer gives short 100 ms beeps with 200 ms of rest between them.',
    workspace: workspace([], [ifBlock([[buttonPressed('1'), [...beep(100), waitMs(200)]]])]),
  },
  {
    id: 'b49_button_b_long_beep',
    title: 'Button B – long beep',
    group: 'Push Button',
    description: 'While button 2 is pressed the buzzer gives long 1 s beeps with 200 ms of rest between them.',
    workspace: workspace([], [ifBlock([[buttonPressed('2'), [...beep(1000), waitMs(200)]]])]),
  },

  // --- RGB LED -----------------------------------------------------------------
  {
    id: 'b50_rgb_red_green_blue',
    title: 'Display patterns: Red → Green → Blue',
    group: 'RGB LED',
    description: 'The RGB LED (D9) shows red, green and blue for half a second each, forever.',
    workspace: workspace([], [rgb('RED'), waitMs(500), rgb('GREEN'), waitMs(500), rgb('BLUE'), waitMs(500)]),
  },
  {
    id: 'b51_rgb_buttons',
    title: 'Button A → Red (RGB), Button B → Green (RGB)',
    group: 'RGB LED',
    description: 'Button 1 makes the RGB LED red, button 2 makes it green, and it is off when no button is pressed.',
    workspace: workspace([], [ifBlock([[buttonPressed('1'), [rgb('RED')]], [buttonPressed('2'), [rgb('GREEN')]]], [rgb('OFF')]), waitMs(20)]),
  },

  // --- LDR ---------------------------------------------------------------------
  {
    id: 'b52_ldr_serial',
    title: 'Display LDR value on Serial Monitor',
    group: 'LDR',
    description: 'Prints the light sensor value (A3) every 200 ms. Flip the POT / LDR switch to LDR, or you read the knob.',
    workspace: workspace([], [printLabeled('LDR', ldrRead()), waitMs(200)]),
  },
  {
    id: 'b53_ldr_red_green',
    title: 'Red LED ON if LDR < 500; Green LED ON if LDR > 500',
    group: 'LDR',
    description: 'Below 500 the red LED is on, otherwise the green one; the value is printed. Flip the POT / LDR switch to LDR.',
    workspace: workspace(
      [],
      [
        setVar('light', ldrRead()),
        printLabeled('LDR', getVar('light')),
        ifBlock([[compare('LT', getVar('light'), num(500)), [led('RED', 'ON'), led('GREEN', 'OFF')]]], [led('RED', 'OFF'), led('GREEN', 'ON')]),
        waitMs(200),
      ],
      [{ name: 'light', id: 'light' }],
    ),
  },

  // --- Seven-Segment -----------------------------------------------------------
  {
    id: 'b54_seg_button_a_1_to_4',
    title: 'On Button A → display numbers from 1 to 4',
    group: 'Seven-Segment',
    description: 'When button 1 is pressed, a count loop shows 1, 2, 3, 4 on the 7-segment display (one per second), then clears it.',
    workspace: workspace(
      [sevenSegClear()],
      [ifBlock([[buttonPressed('1'), [forLoop('n', 1, 4, 1, [sevenSegDigit(1, getVar('n')), waitS(1)]), sevenSegClear()]]])],
      [{ name: 'n', id: 'n' }],
    ),
  },
  {
    id: 'b55_seg_button_b_7_to_1',
    title: 'On Button B → display numbers from 7 to 1',
    group: 'Seven-Segment',
    description: 'When button 2 is pressed, a count loop (by -1) shows 7, 6, 5, 4, 3, 2, 1 on the display, then clears it.',
    workspace: workspace(
      [sevenSegClear()],
      [ifBlock([[buttonPressed('2'), [forLoop('n', 7, 1, -1, [sevenSegDigit(7, getVar('n')), waitS(1)]), sevenSegClear()]]])],
      [{ name: 'n', id: 'n' }],
    ),
  },

  // --- Ultrasonic --------------------------------------------------------------
  {
    id: 'b56_ultrasonic_serial',
    title: 'Display distance on the Serial Monitor',
    group: 'Ultrasonic',
    description: 'Prints the distance measured by the ultrasonic sensor (D3/D2) every 300 ms.',
    workspace: workspace([], [printLabeled('distance (cm)', distanceCm()), waitMs(300)]),
  },
  {
    id: 'b57_ultrasonic_red_near',
    title: 'Red LED ON if distance < 10 cm',
    group: 'Ultrasonic',
    description: 'The red LED is on when the ultrasonic sensor sees something closer than 10 cm; the distance is printed.',
    workspace: workspace(
      [],
      [
        setVar('distance', distanceCm()),
        printLabeled('distance (cm)', getVar('distance')),
        ifBlock([[compare('LT', getVar('distance'), num(10)), [led('RED', 'ON')]]], [led('RED', 'OFF')]),
        waitMs(200),
      ],
      [{ name: 'distance', id: 'distance' }],
    ),
  },
  {
    id: 'b58_ultrasonic_green_far',
    title: 'Green LED ON if distance > 10 cm',
    group: 'Ultrasonic',
    description: 'The green LED is on when the closest object is farther than 10 cm; the distance is printed.',
    workspace: workspace(
      [],
      [
        setVar('distance', distanceCm()),
        printLabeled('distance (cm)', getVar('distance')),
        ifBlock([[compare('GT', getVar('distance'), num(10)), [led('GREEN', 'ON')]]], [led('GREEN', 'OFF')]),
        waitMs(200),
      ],
      [{ name: 'distance', id: 'distance' }],
    ),
  },
  {
    id: 'b59_ultrasonic_beep_rate',
    title: 'Speed up the buzzer tone as the distance decreases',
    group: 'Ultrasonic',
    description: 'A 50 ms beep, then a pause of distance x 10 ms: the closer the object, the faster the beeps.',
    workspace: workspace(
      [],
      [
        setVar('pause', arithmetic('MULTIPLY', distanceCm(), num(10))),
        printLabeled('pause (ms)', getVar('pause')),
        ...beep(50),
        waitMs(500, getVar('pause')),
      ],
      [{ name: 'pause', id: 'pause' }],
    ),
  },

  // --- Servo Motor -------------------------------------------------------------
  {
    id: 'b60_servo_button_a_0',
    title: 'Button A → move servo to 0°',
    group: 'Servo Motor',
    description: 'The servo (D4) starts at 90 degrees; pressing button 1 sends it to 0 degrees.',
    workspace: workspace([servo(90)], [ifBlock([[buttonPressed('1'), [servo(0)]]])]),
  },
  {
    id: 'b61_servo_button_b_90',
    title: 'Button B → move servo to 90°',
    group: 'Servo Motor',
    description: 'The servo (D4) starts at 0 degrees; pressing button 2 sends it to 90 degrees.',
    workspace: workspace([servo(0)], [ifBlock([[buttonPressed('2'), [servo(90)]]])]),
  },
  {
    id: 'b62_servo_ultrasonic_10_times',
    title: 'Object < 10 cm → servo 180°, otherwise 0°, repeat 10 times',
    group: 'Servo Motor',
    description: 'When the board starts, 10 times: if the ultrasonic sensor sees something under 10 cm the servo goes to 180, else to 0.',
    workspace: workspace(
      [repeat(10, [ifBlock([[compare('LT', distanceCm(), num(10)), [servo(180)]]], [servo(0)]), waitMs(500)])],
      [],
    ),
  },

  // --- DHT Sensor --------------------------------------------------------------
  {
    id: 'b63_dht_serial',
    title: 'Display temperature and humidity on the Serial Monitor',
    group: 'DHT Sensor',
    description: 'Prints the temperature and the humidity of the DHT22 (D5) every 2 seconds.',
    workspace: workspace([], [printLabeled('temperature (C)', dhtRead('TEMPERATURE')), printLabeled('humidity (%)', dhtRead('HUMIDITY')), waitS(2)]),
  },
  {
    id: 'b64_dht_servo_slow',
    title: 'If temperature > 28 °C → move servo to 180° slowly',
    group: 'DHT Sensor',
    description: 'Every 2 s: above 28 degrees a count loop moves the servo one degree every 20 ms up to 180; otherwise it goes to 0.',
    workspace: workspace(
      [servo(0)],
      [
        printLabeled('temperature (C)', dhtRead('TEMPERATURE')),
        ifBlock([[compare('GT', dhtRead('TEMPERATURE'), num(28)), [forLoop('angle', 1, 180, 1, [servo(0, getVar('angle')), waitMs(20)])]]], [servo(0)]),
        waitS(2),
      ],
      [{ name: 'angle', id: 'angle' }],
    ),
  },

  // --- DC Motor ----------------------------------------------------------------
  {
    id: 'b65_motor_button_a_5_times',
    title: 'Button A → turn forward 5 times',
    group: 'DC Motor',
    description: 'When button 1 is pressed the DC motor (A0) runs 5 times for 500 ms with 500 ms stops.',
    workspace: workspace([], [ifBlock([[buttonPressed('1'), [repeat(5, [motor('ON'), waitMs(500), motor('OFF'), waitMs(500)])]]])]),
  },
  {
    id: 'b66_motor_button_b_5_times_slow',
    title: 'Button B → turn 5 times, slower rhythm',
    group: 'DC Motor',
    description: 'When button 2 is pressed the motor runs 5 times for 1 s with 1 s stops (only IN1 is wired, so it cannot run backward).',
    workspace: workspace([], [ifBlock([[buttonPressed('2'), [repeat(5, [motor('ON'), waitS(1), motor('OFF'), waitS(1)])]]])]),
  },
];
