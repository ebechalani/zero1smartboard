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

function whileLoop(condition: BlockJson, body: BlockJson[]): BlockJson {
  const inputs: Record<string, InputJson> = { BOOL: v(condition) };
  if (body.length) inputs['DO'] = v(chain(body));
  return { type: 'controls_whileUntil', fields: { MODE: 'WHILE' }, inputs };
}

/** constrain(value, low, high). */
const constrain = (value: BlockJson, low: number, high: number): BlockJson => ({
  type: 'math_constrain',
  inputs: { VALUE: v(value), LOW: n(low), HIGH: n(high) },
});

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
/** Wait until the button is released, so that one press does one thing (holding does not repeat). */
const waitForRelease = (button: '1' | '2'): BlockJson => whileLoop(buttonPressed(button), [waitMs(10)]);

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
    title: 'Blink the red LED',
    group: 'LED',
    description: 'The simplest program: the red LED (A1) is on for 500 ms and off for 500 ms, forever.',
    workspace: workspace([], [led('RED', 'ON'), waitMs(500), led('RED', 'OFF'), waitMs(500)]),
  },
  {
    id: 'b41_led_red_green',
    title: 'Blink red and green alternately',
    group: 'LED',
    description: 'Red (A1) and green (A2) take turns every 500 ms; the old one goes off before the new one comes on, so they are never on together.',
    workspace: workspace([], [led('GREEN', 'OFF'), led('RED', 'ON'), waitMs(500), led('RED', 'OFF'), led('GREEN', 'ON'), waitMs(500)]),
  },
  {
    id: 'b42_led_blink_10_times',
    title: 'Blink the red LED 10 times',
    group: 'LED',
    description: 'When the board starts, a repeat block blinks the red LED exactly 10 times (300 ms on, 300 ms off), prints "Done" and the LED stays off.',
    workspace: workspace([repeat(10, [led('RED', 'ON'), waitMs(300), led('RED', 'OFF'), waitMs(300)]), printLine(text('Done'))], []),
  },

  // --- Buzzer ------------------------------------------------------------------
  {
    id: 'b43_buzzer_short_beeps',
    title: 'Short beeps forever',
    group: 'Buzzer',
    description: 'The buzzer (D8) is switched on for 100 ms and off for 400 ms, forever: one short beep every half second.',
    workspace: workspace([], [...beep(100), waitMs(400)]),
  },
  {
    id: 'b44_buzzer_led_10_times',
    title: 'Beep 10 times with the red LED',
    group: 'Buzzer',
    description: 'When the board starts, 10 times: the buzzer and the red LED come on together for 200 ms, then both go off for 300 ms; then "Done" is printed and all stays silent.',
    workspace: workspace(
      [repeat(10, [buzzer('ON'), led('RED', 'ON'), waitMs(200), buzzer('OFF'), led('RED', 'OFF'), waitMs(300)]), printLine(text('Done'))],
      [],
    ),
  },

  // --- Push Button -------------------------------------------------------------
  {
    id: 'b45_buttons_leds',
    title: 'Buttons light the LEDs',
    group: 'Push Button',
    description: 'The red LED (A1) is on while button 1 (D6) is held and the green LED (A2) while button 2 (D7) is held; a released button switches its LED off.',
    workspace: workspace(
      [],
      [
        ifBlock([[buttonPressed('1'), [led('RED', 'ON')]]], [led('RED', 'OFF')]),
        ifBlock([[buttonPressed('2'), [led('GREEN', 'ON')]]], [led('GREEN', 'OFF')]),
        waitMs(20),
      ],
    ),
  },
  {
    id: 'b46_buttons_beeps',
    title: 'Buttons: short beep and long beep',
    group: 'Push Button',
    description: 'A press of button 1 gives one short beep (100 ms) and a press of button 2 one long beep (1 s); the program then waits for the release, so holding does not repeat the beep.',
    workspace: workspace(
      [],
      [
        ifBlock([[buttonPressed('1'), [...beep(100), waitForRelease('1')]]]),
        ifBlock([[buttonPressed('2'), [...beep(1000), waitForRelease('2')]]]),
      ],
    ),
  },

  // --- RGB LED -----------------------------------------------------------------
  {
    id: 'b47_rgb_red_green_blue',
    title: 'RGB LED: red, green, blue',
    group: 'RGB LED',
    description: 'The RGB LED (D9) shows red, green and blue for one second each, forever.',
    workspace: workspace([], [rgb('RED'), waitS(1), rgb('GREEN'), waitS(1), rgb('BLUE'), waitS(1)]),
  },
  {
    id: 'b48_rgb_buttons',
    title: 'Buttons colour the RGB LED',
    group: 'RGB LED',
    description: 'While button 1 is held the RGB LED is red, while button 2 is held it is green, and it is off when no button is pressed.',
    workspace: workspace([], [ifBlock([[buttonPressed('1'), [rgb('RED')]], [buttonPressed('2'), [rgb('GREEN')]]], [rgb('OFF')]), waitMs(20)]),
  },

  // --- LDR ---------------------------------------------------------------------
  {
    id: 'b49_ldr_serial',
    title: 'Show the light level on the Serial Monitor',
    group: 'LDR',
    description: 'Prints "Light: <value>" from the light sensor (A3) every 500 ms. Flip the POT / LDR slide switch to LDR, or you read the knob instead.',
    workspace: workspace([], [printLabeled('Light', ldrRead()), waitMs(500)]),
  },
  {
    id: 'b50_ldr_red_green',
    title: 'Night light: red when dark, green when bright',
    group: 'LDR',
    description: 'Below 500 (dark) the red LED is on, otherwise the green one; the value is printed every 500 ms. Flip the POT / LDR slide switch to LDR.',
    workspace: workspace(
      [],
      [
        setVar('light', ldrRead()),
        printLabeled('Light', getVar('light')),
        ifBlock([[compare('LT', getVar('light'), num(500)), [led('RED', 'ON'), led('GREEN', 'OFF')]]], [led('GREEN', 'ON'), led('RED', 'OFF')]),
        waitMs(500),
      ],
      [{ name: 'light', id: 'light' }],
    ),
  },

  // --- Seven-Segment -----------------------------------------------------------
  {
    id: 'b51_seg_buttons_count',
    title: 'Count up and down with the buttons',
    group: 'Seven-Segment',
    description: 'Button 1 counts 1, 2, 3, 4 and button 2 counts 7, 6, 5, 4, 3, 2, 1 on the 7-segment display (one digit per second, each one printed too); then the display goes blank again.',
    workspace: workspace(
      [sevenSegClear()],
      [
        ifBlock([[buttonPressed('1'), [forLoop('n', 1, 4, 1, [sevenSegDigit(1, getVar('n')), printLine(getVar('n')), waitS(1)]), sevenSegClear()]]]),
        ifBlock([[buttonPressed('2'), [forLoop('n', 7, 1, -1, [sevenSegDigit(7, getVar('n')), printLine(getVar('n')), waitS(1)]), sevenSegClear()]]]),
      ],
      [{ name: 'n', id: 'n' }],
    ),
  },

  // --- Ultrasonic --------------------------------------------------------------
  {
    id: 'b52_ultrasonic_serial',
    title: 'Show the distance on the Serial Monitor',
    group: 'Ultrasonic',
    description: 'Prints "Distance: <cm> cm" measured by the ultrasonic sensor (TRIG D3 / ECHO D2) every 500 ms.',
    workspace: workspace([], [printLine(join(text('Distance: '), distanceCm(), text(' cm'))), waitMs(500)]),
  },
  {
    id: 'b53_ultrasonic_red_green',
    title: 'Distance alarm: red LED near, green LED far',
    group: 'Ultrasonic',
    description: 'Closer than 10 cm the red LED is on, otherwise the green one; the distance is printed every 500 ms.',
    workspace: workspace(
      [],
      [
        setVar('distance', distanceCm()),
        printLine(join(text('Distance: '), getVar('distance'), text(' cm'))),
        ifBlock([[compare('LT', getVar('distance'), num(10)), [led('RED', 'ON'), led('GREEN', 'OFF')]]], [led('GREEN', 'ON'), led('RED', 'OFF')]),
        waitMs(500),
      ],
      [{ name: 'distance', id: 'distance' }],
    ),
  },
  {
    id: 'b54_ultrasonic_beep_rate',
    title: 'Parking beeper: faster beeps when closer',
    group: 'Ultrasonic',
    description: 'A 50 ms beep, then a pause of distance x 10 ms kept between 50 and 1000 ms with a constrain block: the closer the object, the faster the beeps.',
    workspace: workspace(
      [],
      [
        setVar('distance', distanceCm()),
        setVar('pause', constrain(arithmetic('MULTIPLY', getVar('distance'), num(10)), 50, 1000)),
        printLine(join(text('Distance: '), getVar('distance'), text(' cm'))),
        ...beep(50),
        waitMs(500, getVar('pause')),
      ],
      [
        { name: 'distance', id: 'distance' },
        { name: 'pause', id: 'pause' },
      ],
    ),
  },

  // --- Servo Motor -------------------------------------------------------------
  {
    id: 'b55_servo_buttons',
    title: 'Buttons move the servo (0° and 90°)',
    group: 'Servo Motor',
    description: 'The servo (D4) starts at 0 degrees; a press of button 1 sends it to 0 degrees and a press of button 2 to 90 degrees; the angle is printed on each move.',
    workspace: workspace(
      [servo(0)],
      [
        ifBlock([[buttonPressed('1'), [servo(0), printLabeled('Servo angle', num(0)), waitForRelease('1')]]]),
        ifBlock([[buttonPressed('2'), [servo(90), printLabeled('Servo angle', num(90)), waitForRelease('2')]]]),
      ],
    ),
  },
  {
    id: 'b56_servo_ultrasonic_10_times',
    title: 'Servo reacts to the ultrasonic sensor, 10 times',
    group: 'Servo Motor',
    description: 'When the board starts, 10 rounds one second apart: closer than 10 cm the servo goes to 180 degrees, otherwise to 0; the round number and the angle are printed, then the servo stops at 0.',
    workspace: workspace(
      [
        forLoop('turn', 1, 10, 1, [
          ifBlock([[compare('LT', distanceCm(), num(10)), [setVar('angle', num(180))]]], [setVar('angle', num(0))]),
          servo(0, getVar('angle')),
          printLabeled('Round', getVar('turn')),
          printLabeled('Angle', getVar('angle')),
          waitS(1),
        ]),
        servo(0),
      ],
      [],
      [
        { name: 'turn', id: 'turn' },
        { name: 'angle', id: 'angle' },
      ],
    ),
  },

  // --- DHT Sensor --------------------------------------------------------------
  {
    id: 'b57_dht_serial',
    title: 'Show temperature and humidity on the Serial Monitor',
    group: 'DHT Sensor',
    description: 'Every 2 seconds prints "Temperature: <t> C  Humidity: <h> %" measured by the DHT22 (D5).',
    workspace: workspace(
      [],
      [printLine(join(text('Temperature: '), dhtRead('TEMPERATURE'), text(' C  Humidity: '), dhtRead('HUMIDITY'), text(' %'))), waitS(2)],
    ),
  },
  {
    id: 'b58_dht_servo_slow',
    title: 'Servo turns slowly when it is hot (above 28 °C)',
    group: 'DHT Sensor',
    description: 'Every 2 s the temperature is printed; above 28 degrees a count loop moves the servo one degree every 15 ms from 0 to 180 (slowly), otherwise it goes back to 0.',
    workspace: workspace(
      [servo(0)],
      [
        setVar('temperature', dhtRead('TEMPERATURE')),
        printLabeled('Temperature', getVar('temperature')),
        ifBlock([[compare('GT', getVar('temperature'), num(28)), [forLoop('angle', 0, 180, 1, [servo(0, getVar('angle')), waitMs(15)])]]], [servo(0)]),
        waitS(2),
      ],
      [
        { name: 'temperature', id: 'temperature' },
        { name: 'angle', id: 'angle' },
      ],
    ),
  },

  // --- DC Motor ----------------------------------------------------------------
  {
    id: 'b59_motor_buttons',
    title: 'Buttons run the motor',
    group: 'DC Motor',
    description: 'Button 1 starts 5 short runs of the DC motor (A0): on 500 ms, off 500 ms; button 2 starts 5 long runs: on 1 s, off 1 s. Only IN1 is wired, so the motor runs forward or stops, never backward.',
    workspace: workspace(
      [],
      [
        ifBlock([[buttonPressed('1'), [forLoop('run', 1, 5, 1, [printLine(join(text('Short run '), getVar('run'))), motor('ON'), waitMs(500), motor('OFF'), waitMs(500)])]]]),
        ifBlock([[buttonPressed('2'), [forLoop('run', 1, 5, 1, [printLine(join(text('Long run '), getVar('run'))), motor('ON'), waitS(1), motor('OFF'), waitS(1)])]]]),
      ],
      [{ name: 'run', id: 'run' }],
    ),
  },
];
