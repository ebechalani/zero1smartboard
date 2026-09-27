/**
 * Block programming tests (docs/BLOCKS.md §11.5): every block example is
 * loaded into a headless workspace, generated, transpiled and run on the
 * virtual board; the generator rules (typing, includes, pins, setup order,
 * procedures, loops, orders, helpers, orphans) are checked on small
 * hand-built workspaces.
 */
import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import {
  BLOCK_EXAMPLES,
  DEFAULT_WORKSPACE,
  TOOLBOX,
  ZERO1_THEME,
  arduinoGenerator,
  inferTypes,
  registerZero1Blocks,
  workspaceToArduino,
} from '../src/blocks';
import { BLOCK_COLOURS, Z1_BLOCK_TYPES } from '../src/blocks/blocks';
import { EXAMPLE_GROUPS } from '../src/examples';
import { transpile } from '../src/transpiler';
import { runSketch, type RunOptions } from './helpers';

// --- workspace builders ---------------------------------------------------------

interface BlockJson {
  type: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson }>;
  next?: { block: BlockJson };
  extraState?: unknown;
}

const num = (n: number): BlockJson => ({ type: 'math_number', fields: { NUM: n } });
const text = (t: string): BlockJson => ({ type: 'text', fields: { TEXT: t } });
const bool = (b: boolean): BlockJson => ({ type: 'logic_boolean', fields: { BOOL: b ? 'TRUE' : 'FALSE' } });
const v = (block: BlockJson) => ({ block });
const getVar = (id: string): BlockJson => ({ type: 'variables_get', fields: { VAR: { id } } });
const setVar = (id: string, value?: BlockJson): BlockJson => ({
  type: 'variables_set',
  fields: { VAR: { id } },
  ...(value ? { inputs: { VALUE: v(value) } } : {}),
});
const arith = (op: string, a: BlockJson, b: BlockJson): BlockJson => ({ type: 'math_arithmetic', fields: { OP: op }, inputs: { A: v(a), B: v(b) } });
const compare = (op: string, a: BlockJson, b: BlockJson): BlockJson => ({ type: 'logic_compare', fields: { OP: op }, inputs: { A: v(a), B: v(b) } });
const print = (value: BlockJson, newline = true): BlockJson => ({
  type: 'z1_serial_print',
  fields: { NEWLINE: newline ? 'NEWLINE' : 'SAME_LINE' },
  inputs: { VALUE: v(value) },
});
const led = (which: string, state: string): BlockJson => ({ type: 'z1_led_set', fields: { LED: which, STATE: state } });
const waitMs = (ms: BlockJson): BlockJson => ({ type: 'z1_delay_ms', inputs: { MS: v(ms) } });
const repeat = (times: BlockJson, body: BlockJson[]): BlockJson => ({
  type: 'controls_repeat_ext',
  inputs: { TIMES: v(times), ...(body.length ? { DO: v(chain(body)) } : {}) },
});

function chain(blocks: BlockJson[]): BlockJson {
  const [first, ...rest] = blocks;
  if (!first) throw new Error('chain() needs a block');
  let current = first;
  for (const b of rest) {
    current.next = { block: b };
    current = b;
  }
  return first;
}

function hat(type: string, body: BlockJson[], x = 0, y = 0): BlockJson {
  return { type, x, y, ...(body.length ? { inputs: { DO: v(chain(body)) } } : {}) };
}

interface WorkspaceOptions {
  setup?: BlockJson[];
  loop?: BlockJson[];
  /** Extra top-level blocks (functions, orphans). */
  top?: BlockJson[];
  variables?: Array<{ name: string; id: string }>;
}

function workspaceJson(opts: WorkspaceOptions): object {
  const blocks: BlockJson[] = [hat('z1_setup_hat', opts.setup ?? [], 0, 0), hat('z1_loop_hat', opts.loop ?? [], 0, 300)];
  (opts.top ?? []).forEach((b, i) => blocks.push({ ...b, x: 400, y: i * 200 }));
  return { blocks: { languageVersion: 0, blocks }, variables: opts.variables ?? [] };
}

function load(json: object): Blockly.Workspace {
  registerZero1Blocks();
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(json, ws);
  return ws;
}

function generate(json: object): string {
  const ws = load(json);
  try {
    return workspaceToArduino(ws);
  } finally {
    ws.dispose();
  }
}

function gen(opts: WorkspaceOptions): string {
  return generate(workspaceJson(opts));
}

/** Generate, transpile and run a workspace on the virtual board; fails on console errors. */
async function run(opts: WorkspaceOptions, runOpts: RunOptions = {}) {
  const code = gen(opts);
  const result = await runSketch(code, { stopAfterMs: 1500, ...runOpts });
  const errors = result.console.filter((m) => m.level === 'error');
  expect(errors, `console errors: ${errors.map((e) => e.text).join(' | ')}\n${code}`).toEqual([]);
  expect(result.status).toBe('stopped');
  return { ...result, code };
}

function setupBody(code: string): string[] {
  const match = /void setup\(\) \{\n([\s\S]*?)\n\}/.exec(code);
  return match ? match[1]!.split('\n').map((l) => l.trim()) : [];
}

// --- tests ---------------------------------------------------------------------

describe('block definitions', () => {
  it('registers every z1_* block once', () => {
    registerZero1Blocks();
    registerZero1Blocks();
    expect(Z1_BLOCK_TYPES).toEqual([
      'z1_setup_hat', 'z1_loop_hat',
      'z1_led_set', 'z1_led_toggle', 'z1_rgb_colour', 'z1_rgb_set', 'z1_rgb_brightness', 'z1_buzzer_tone', 'z1_buzzer_note',
      'z1_buzzer_set', 'z1_sevenseg_digit', 'z1_sevenseg_clear', 'z1_motor_set', 'z1_servo_angle', 'z1_lcd_print', 'z1_lcd_line',
      'z1_lcd_clear', 'z1_lcd_backlight',
      'z1_button_pressed', 'z1_pot_read', 'z1_pot_percent', 'z1_ldr_read', 'z1_ldr_dark', 'z1_dht_read', 'z1_ultrasonic_cm',
      'z1_delay_ms', 'z1_delay_s', 'z1_millis', 'z1_map',
      'z1_serial_print', 'z1_serial_print_labeled', 'z1_serial_available', 'z1_serial_read_line',
    ]);
    for (const type of Z1_BLOCK_TYPES) {
      expect(Blockly.Blocks[type], type).toBeDefined();
      expect(typeof arduinoGenerator.forBlock[type], type).toBe('function');
    }
  });

  it('gives every block a tooltip that names its pin', () => {
    const ws = load(DEFAULT_WORKSPACE);
    const pinWords = /pin|A\d|D\d|USB/;
    for (const type of Z1_BLOCK_TYPES) {
      const block = ws.newBlock(type);
      const tooltip = block.getTooltip();
      expect(tooltip.length, type).toBeGreaterThan(10);
      if (!type.endsWith('_hat')) expect(tooltip, type).toMatch(pinWords);
    }
    ws.dispose();
  });

  it('draws the two hats with a cap', () => {
    const ws = load(DEFAULT_WORKSPACE);
    const [setup, loop] = ws.getTopBlocks(true);
    expect(setup!.hat).toBe('cap');
    expect(loop!.hat).toBe('cap');
    expect(setup!.previousConnection).toBeNull();
    expect(loop!.nextConnection).toBeNull();
    ws.dispose();
  });
});

describe('toolbox and theme', () => {
  it('lists the categories in the contract order with their colours', () => {
    const contents = (TOOLBOX as { contents: Array<{ kind: string; name: string; colour: string; custom?: string }> }).contents;
    expect(contents.map((c) => c.name)).toEqual([
      'Board · outputs',
      'Board · inputs',
      'Time',
      'Serial',
      'Logic',
      'Loops',
      'Math',
      'Text',
      'Variables',
      'Functions',
    ]);
    expect(contents.map((c) => c.colour)).toEqual(['#7c3aed', '#2563eb', '#f59e0b', '#0ea5e9', '210', '120', '230', '160', '330', '290']);
    expect(contents[8]!.custom).toBe('VARIABLE');
    expect(contents[9]!.custom).toBe('PROCEDURE');
  });

  it('only offers blocks the generator knows', () => {
    const contents = (TOOLBOX as { contents: Array<{ contents?: Array<{ type: string }> }> }).contents;
    for (const category of contents) {
      for (const item of category.contents ?? []) {
        expect(typeof arduinoGenerator.forBlock[item.type], item.type).toBe('function');
      }
    }
  });

  it('is a light theme with dark toolbox text', () => {
    expect(ZERO1_THEME.name).toBe('zero1');
    expect(ZERO1_THEME.getComponentStyle('workspaceBackgroundColour')).toBe('#fcfbff');
    expect(ZERO1_THEME.getComponentStyle('toolboxBackgroundColour')).toBe('#f5f3fa');
    expect(ZERO1_THEME.getComponentStyle('toolboxForegroundColour')).toBe('#1e1633');
    expect(ZERO1_THEME.getComponentStyle('flyoutBackgroundColour')).toBe('#ece7f8');
  });

  it('outlines the selected block in a colour visible on every block and on the workspace', () => {
    const glow = ZERO1_THEME.getComponentStyle('selectedGlowColour')!;
    expect(glow).toBe('#1e1633');
    const backgrounds = Object.values(BLOCK_COLOURS).map((c) => (c.startsWith('#') ? c : Blockly.utils.colour.hueToHex(Number(c))));
    backgrounds.push(ZERO1_THEME.getComponentStyle('workspaceBackgroundColour')!);
    for (const colour of backgrounds) expect(contrastRatio(glow, colour), colour).toBeGreaterThanOrEqual(3);
  });
});

/** WCAG contrast ratio of two `#rrggbb` colours. */
function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('default workspace', () => {
  it('has one setup hat and one loop hat and generates a sketch that runs', async () => {
    const ws = load(DEFAULT_WORKSPACE);
    expect(ws.getTopBlocks(true).map((b) => b.type)).toEqual(['z1_setup_hat', 'z1_loop_hat']);
    ws.dispose();
    const code = generate(DEFAULT_WORKSPACE);
    expect(code).toBe('// Generated from blocks — ZERO1 Smart Board Simulator\n\nvoid setup() {\n}\n\nvoid loop() {\n}\n');
    const result = await runSketch(code, { stopAfterMs: 100 });
    expect(result.status).toBe('stopped');
  });

  it('generates the init lines and an empty loop() when there is no hat at all', () => {
    const code = generate({ blocks: { languageVersion: 0, blocks: [led('RED', 'ON')] } });
    expect(code).toContain('void setup() {\n}');
    expect(code).toContain('void loop() {\n}');
    expect(code).not.toContain('digitalWrite');
  });
});

describe('block examples', () => {
  it('lists 39 examples in the 14 groups with unique ids', () => {
    expect(BLOCK_EXAMPLES).toHaveLength(39);
    expect(new Set(BLOCK_EXAMPLES.map((e) => e.id)).size).toBe(39);
    const groups = [...new Set(BLOCK_EXAMPLES.map((e) => e.group))];
    expect(groups).toEqual(EXAMPLE_GROUPS);
    for (const e of BLOCK_EXAMPLES) {
      expect(e.title.length).toBeGreaterThan(3);
      expect(e.description.length).toBeGreaterThan(20);
    }
  });

  for (const example of BLOCK_EXAMPLES) {
    it(`${example.id} has both hats, transpiles and runs without errors`, async () => {
      const ws = load(example.workspace);
      const tops = ws.getTopBlocks(true);
      expect(tops.filter((b) => b.type === 'z1_setup_hat')).toHaveLength(1);
      expect(tops.filter((b) => b.type === 'z1_loop_hat')).toHaveLength(1);
      // Hats must not overlap: the loop hat sits below the setup hat.
      const setup = tops.find((b) => b.type === 'z1_setup_hat')!;
      const loop = tops.find((b) => b.type === 'z1_loop_hat')!;
      expect(loop.getRelativeToSurfaceXY().y).toBeGreaterThan(setup.getRelativeToSurfaceXY().y + 60);
      const code = workspaceToArduino(ws);
      ws.dispose();

      const result = transpile(code);
      expect(result.ok, result.ok ? '' : `${result.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join('; ')}\n${code}`).toBe(true);
      const ran = await runSketch(code, { stopAfterMs: 1500 });
      const errors = ran.console.filter((m) => m.level === 'error');
      expect(errors, `console errors in ${example.id}: ${errors.map((e) => e.text).join(' | ')}`).toEqual([]);
      expect(ran.status).toBe('stopped');
    });
  }

  it('b01_blink generates exactly the expected sketch', () => {
    const blink = BLOCK_EXAMPLES.find((e) => e.id === 'b01_blink')!;
    expect(generate(blink.workspace)).toBe(
      [
        '// Generated from blocks — ZERO1 Smart Board Simulator',
        '',
        'const int LED_RED = A1;  // red LED',
        '',
        'void setup() {',
        '  pinMode(LED_RED, OUTPUT);',
        '}',
        '',
        'void loop() {',
        '  digitalWrite(LED_RED, HIGH);',
        '  delay(500);',
        '  digitalWrite(LED_RED, LOW);',
        '  delay(500);',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('b01_blink really blinks the red LED', async () => {
    const blink = BLOCK_EXAMPLES.find((e) => e.id === 'b01_blink')!;
    const events: number[] = [];
    await runSketch(generate(blink.workspace), {
      stopAfterMs: 1200,
      before: (board) => board.on((e) => e.type === 'digitalWrite' && e.pin === 15 && events.push(e.level)),
    });
    expect(events.slice(0, 3)).toEqual([1, 0, 1]);
  });

  it('b20_lcd_hello writes on both LCD lines', async () => {
    const example = BLOCK_EXAMPLES.find((e) => e.id === 'b20_lcd_hello')!;
    const result = await runSketch(generate(example.workspace), { stopAfterMs: 1500 });
    const row = (r: number) => result.board.lcd.state.chars[r]!.map((c) => String.fromCharCode(c)).join('');
    expect(row(0)).toMatch(/^Hello, ZERO1!/);
    expect(row(1)).toMatch(/^Time: 1 s/);
  });

  it('b30_parking prints the distance and lights the RGB LED', async () => {
    const example = BLOCK_EXAMPLES.find((e) => e.id === 'b30_parking')!;
    const result = await runSketch(generate(example.workspace), {
      stopAfterMs: 1500,
      before: (board) => board.ultrasonic.setDistance(20),
    });
    // 20 cm measured through pulseIn() (whole microseconds) comes back as 19.89
    expect(result.serial).toMatch(/distance \(cm\): (19|20)\.\d\d/);
    expect(result.board.rgb.state.r).toBeGreaterThan(0);
    expect(result.board.rgb.state.g).toBe(0);
  });

  // --- part-by-part groups (b40 ... b66) -------------------------------------------

  const example = (id: string) => BLOCK_EXAMPLES.find((e) => e.id === id)!;
  const rising = (events: Array<[number, number]>, pin: number) => events.filter(([p, level]) => p === pin && level === 1).length;

  it('b41_led_red_green never lights both LEDs together', async () => {
    const both: boolean[] = [];
    await runSketch(generate(example('b41_led_red_green').workspace), {
      stopAfterMs: 2200,
      before: (board) => board.on((e) => e.type === 'digitalWrite' && both.push(board.ledRed.state.on && board.ledGreen.state.on)),
    });
    expect(both.length).toBeGreaterThanOrEqual(8);
    expect(both).not.toContain(true);
  });

  it('b42_led_blink_10_times and b44_buzzer_beep_10_times run exactly 10 times in setup()', async () => {
    for (const [id, pin] of [['b42_led_blink_10_times', 15], ['b44_buzzer_beep_10_times', 8]] as const) {
      const events: Array<[number, number]> = [];
      const code = generate(example(id).workspace);
      expect(code).toMatch(/void setup\(\) \{[\s\S]*for \(int i = 0; i < 10; i\+\+\)/);
      const result = await runSketch(code, { stopAfterMs: 8000, before: (board) => board.on((e) => e.type === 'digitalWrite' && events.push([e.pin, e.level])) });
      expect(rising(events, pin), id).toBe(10);
      expect(result.status).toBe('stopped');
    }
  });

  it('b45_buzzer_led_10_times switches the LED and the buzzer together', async () => {
    const events: Array<[number, number]> = [];
    await runSketch(generate(example('b45_buzzer_led_10_times').workspace), {
      stopAfterMs: 6000,
      before: (board) => board.on((e) => e.type === 'digitalWrite' && events.push([e.pin, e.level])),
    });
    expect(rising(events, 15)).toBe(10);
    expect(rising(events, 8)).toBe(10);
  });

  it('b46 / b47 light the red LED for their own button only', async () => {
    const run = (id: string, press: 'buttonA' | 'buttonB') => runSketch(generate(example(id).workspace), { stopAfterMs: 200, before: (b) => b[press].press() });
    expect((await run('b46_button_a_red_led', 'buttonA')).board.ledRed.state.on).toBe(true);
    expect((await run('b46_button_a_red_led', 'buttonB')).board.ledRed.state.on).toBe(false);
    expect((await run('b47_button_b_red_led', 'buttonB')).board.ledRed.state.on).toBe(true);
    expect((await run('b47_button_b_red_led', 'buttonA')).board.ledRed.state.on).toBe(false);
  });

  it('b48 / b49 give a short and a long beep', async () => {
    const pulses = async (id: string, press: 'buttonA' | 'buttonB') => {
      const out: number[] = [];
      let since = 0;
      await runSketch(generate(example(id).workspace), {
        stopAfterMs: 1500,
        before: (b, clock) => {
          b[press].press();
          b.on((e) => {
            if (e.type !== 'digitalWrite' || e.pin !== 8) return;
            if (e.level === 1) since = clock.now();
            else out.push(clock.now() - since);
          });
        },
      });
      return out;
    };
    const short = await pulses('b48_button_a_short_beep', 'buttonA');
    expect(short.length).toBeGreaterThanOrEqual(2);
    expect(short.every((p) => p === 100)).toBe(true);
    const long = await pulses('b49_button_b_long_beep', 'buttonB');
    expect(long.length).toBeGreaterThanOrEqual(1);
    expect(long.every((p) => p === 1000)).toBe(true);
    expect(await pulses('b48_button_a_short_beep', 'buttonB')).toEqual([]);
  });

  it('b50_rgb_red_green_blue cycles the three colours', async () => {
    const seen: string[] = [];
    await runSketch(generate(example('b50_rgb_red_green_blue').workspace), {
      stopAfterMs: 1400,
      before: (b) => b.on((e) => e.type === 'pixels' && seen.push(`${b.rgb.state.r > 0 ? 'R' : ''}${b.rgb.state.g > 0 ? 'G' : ''}${b.rgb.state.b > 0 ? 'B' : ''}`)),
    });
    // The generated setup() first shows "all off"; then the loop cycles the colours.
    expect(seen.slice(1, 4)).toEqual(['R', 'G', 'B']);
  });

  it('b51_rgb_buttons picks the colour from the buttons', async () => {
    const code = generate(example('b51_rgb_buttons').workspace);
    const a = await runSketch(code, { stopAfterMs: 200, before: (b) => b.buttonA.press() });
    expect(a.board.rgb.state.r).toBeGreaterThan(a.board.rgb.state.g);
    const b = await runSketch(code, { stopAfterMs: 200, before: (bd) => bd.buttonB.press() });
    expect(b.board.rgb.state.g).toBeGreaterThan(b.board.rgb.state.r);
    const none = await runSketch(code, { stopAfterMs: 200 });
    expect(none.board.rgb.state.r + none.board.rgb.state.g + none.board.rgb.state.b).toBe(0);
  });

  it('b52 / b53 read the LDR and pick the LED from the 500 threshold', async () => {
    const ldr = (light: number) => (b: Parameters<NonNullable<RunOptions['before']>>[0]) => {
      b.potLdr.setSource('ldr');
      b.potLdr.setLight(light);
    };
    const serial = await runSketch(generate(example('b52_ldr_serial').workspace), { stopAfterMs: 300, before: ldr(60) });
    expect(serial.serial).toContain('LDR: 580');
    const code = generate(example('b53_ldr_red_green').workspace);
    const bright = await runSketch(code, { stopAfterMs: 300, before: ldr(60) });
    expect(bright.board.ledGreen.state.on).toBe(true);
    expect(bright.board.ledRed.state.on).toBe(false);
    const dark = await runSketch(code, { stopAfterMs: 300, before: ldr(20) });
    expect(dark.serial).toContain('LDR: 220');
    expect(dark.board.ledRed.state.on).toBe(true);
    expect(dark.board.ledGreen.state.on).toBe(false);
  });

  it('b54 / b55 count 1..4 and 7..1 on the 7-segment display', async () => {
    const DIGIT = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
    const latched = async (id: string, press: 'buttonA' | 'buttonB', ms: number) => {
      const seen: number[] = [];
      await runSketch(generate(example(id).workspace), {
        stopAfterMs: ms,
        before: (b) => {
          b[press].press();
          b.on((e) => e.type === 'digitalWrite' && e.pin === 11 && e.level === 1 && seen.push(b.sevenSeg.state.latched));
        },
      });
      return seen;
    };
    expect(await latched('b54_seg_button_a_1_to_4', 'buttonA', 4500)).toEqual(expect.arrayContaining([0, DIGIT[1], DIGIT[2], DIGIT[3], DIGIT[4]]));
    expect((await latched('b54_seg_button_a_1_to_4', 'buttonA', 4500)).slice(0, 6)).toEqual([0, DIGIT[1], DIGIT[2], DIGIT[3], DIGIT[4], 0]);
    expect(generate(example('b55_seg_button_b_7_to_1').workspace)).toContain('for (n = 7; n >= 1; n--)');
    expect((await latched('b55_seg_button_b_7_to_1', 'buttonB', 7500)).slice(0, 9)).toEqual([0, DIGIT[7], DIGIT[6], DIGIT[5], DIGIT[4], DIGIT[3], DIGIT[2], DIGIT[1], 0]);
    expect(await latched('b55_seg_button_b_7_to_1', 'buttonA', 500)).toEqual([0]);
  });

  it('b56 - b59 react to the ultrasonic distance', async () => {
    const at = (cm: number) => (b: Parameters<NonNullable<RunOptions['before']>>[0]) => b.ultrasonic.setDistance(cm);
    const serial = await runSketch(generate(example('b56_ultrasonic_serial').workspace), { stopAfterMs: 400 });
    expect(serial.serial).toMatch(/distance \(cm\): (49|50)\.\d\d/);
    const red = generate(example('b57_ultrasonic_red_near').workspace);
    expect((await runSketch(red, { stopAfterMs: 300, before: at(5) })).board.ledRed.state.on).toBe(true);
    expect((await runSketch(red, { stopAfterMs: 300, before: at(50) })).board.ledRed.state.on).toBe(false);
    const green = generate(example('b58_ultrasonic_green_far').workspace);
    expect((await runSketch(green, { stopAfterMs: 300, before: at(50) })).board.ledGreen.state.on).toBe(true);
    expect((await runSketch(green, { stopAfterMs: 300, before: at(5) })).board.ledGreen.state.on).toBe(false);
    const beeps = async (cm: number) => {
      let count = 0;
      await runSketch(generate(example('b59_ultrasonic_beep_rate').workspace), {
        stopAfterMs: 3000,
        before: (b) => {
          b.ultrasonic.setDistance(cm);
          b.on((e) => e.type === 'digitalWrite' && e.pin === 8 && e.level === 1 && count++);
        },
      });
      return count;
    };
    const far = await beeps(50);
    expect(far).toBeGreaterThanOrEqual(5);
    expect(await beeps(5)).toBeGreaterThan(far * 3);
  });

  it('b60 - b62 move the servo from the buttons and the distance', async () => {
    const a = generate(example('b60_servo_button_a_0').workspace);
    expect((await runSketch(a, { stopAfterMs: 200 })).board.servo.state.target).toBe(90);
    expect((await runSketch(a, { stopAfterMs: 200, before: (b) => b.buttonA.press() })).board.servo.state.target).toBe(0);
    const b = generate(example('b61_servo_button_b_90').workspace);
    expect((await runSketch(b, { stopAfterMs: 200 })).board.servo.state.target).toBe(0);
    expect((await runSketch(b, { stopAfterMs: 200, before: (bd) => bd.buttonB.press() })).board.servo.state.target).toBe(90);
    const ten = generate(example('b62_servo_ultrasonic_10_times').workspace);
    const angles: number[] = [];
    const near = await runSketch(ten, {
      stopAfterMs: 6000,
      before: (bd) => {
        bd.ultrasonic.setDistance(5);
        bd.on((e) => e.type === 'servo' && e.angle !== null && angles.push(e.angle));
      },
    });
    expect(angles.filter((x) => x === 180)).toHaveLength(10);
    expect(near.board.servo.state.target).toBe(180);
    expect((await runSketch(ten, { stopAfterMs: 6000 })).board.servo.state.target).toBe(0);
  });

  it('b63 / b64 print the DHT22 and open the servo slowly above 28 C', async () => {
    const serial = await runSketch(generate(example('b63_dht_serial').workspace), { stopAfterMs: 300 });
    expect(serial.serial).toContain('temperature (C): 24.00');
    expect(serial.serial).toContain('humidity (%): 55.00');
    const code = generate(example('b64_dht_servo_slow').workspace);
    expect((await runSketch(code, { stopAfterMs: 500 })).board.servo.state.target).toBe(0);
    const angles: number[] = [];
    const warm = await runSketch(code, {
      stopAfterMs: 4500,
      before: (b) => {
        b.dht.set(30, 55);
        b.on((e) => e.type === 'servo' && e.angle !== null && angles.push(e.angle));
      },
    });
    expect(angles.slice(angles.indexOf(1), angles.indexOf(1) + 180)).toEqual(Array.from({ length: 180 }, (_, i) => i + 1));
    expect(warm.board.servo.state.target).toBe(180);
  });

  it('b65 / b66 run the motor 5 times from their button', async () => {
    const runs = async (id: string, press: 'buttonA' | 'buttonB', ms: number) => {
      const levels: number[] = [];
      const r = await runSketch(generate(example(id).workspace), {
        stopAfterMs: ms,
        before: (b) => {
          b[press].press();
          b.on((e) => e.type === 'digitalWrite' && e.pin === 14 && levels.push(e.level));
        },
      });
      return { levels, running: r.board.motor.state.running };
    };
    const fast = await runs('b65_motor_button_a_5_times', 'buttonA', 5200);
    expect(fast.levels.slice(0, 10)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    expect(fast.running).toBe(false);
    const slow = await runs('b66_motor_button_b_5_times_slow', 'buttonB', 10200);
    expect(slow.levels.slice(0, 10)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    expect((await runs('b66_motor_button_b_5_times_slow', 'buttonA', 500)).levels).toEqual([]);
  });
});

describe('generator: layout', () => {
  it('adds includes, objects and init lines only for what is used, in the contract order', () => {
    const code = gen({
      loop: [
        print(text('hi')),
        led('GREEN', 'ON'),
        { type: 'z1_motor_set', fields: { STATE: 'ON' } },
        { type: 'z1_lcd_clear' },
        { type: 'z1_rgb_colour', fields: { COLOUR: 'RED' } },
        { type: 'z1_servo_angle', inputs: { ANGLE: v(num(90)) } },
        setVar('t', { type: 'z1_dht_read', fields: { WHAT: 'TEMPERATURE' } }),
        setVar('p', { type: 'z1_button_pressed', fields: { BUTTON: '2' } }),
        setVar('d', { type: 'z1_ultrasonic_cm' }),
      ],
      variables: [
        { name: 't', id: 't' },
        { name: 'p', id: 'p' },
        { name: 'd', id: 'd' },
      ],
    });
    expect(code).toMatch(/^\/\/ Generated from blocks — ZERO1 Smart Board Simulator\n\n#include <Servo\.h>\n#include <Wire\.h>\n#include <LiquidCrystal_I2C\.h>\n#include <DHT\.h>\n#include <Adafruit_NeoPixel\.h>\n\n/);
    const pins = code.match(/^const int (\w+) = /gm)!.map((l) => l.split(' ')[2]);
    expect(pins).toEqual(['LED_GREEN', 'BUTTON_2', 'MOTOR', 'SERVO_PIN', 'DHT_PIN', 'TRIG_PIN', 'ECHO_PIN', 'RGB_PIN']);
    expect(code).not.toContain('LED_RED');
    expect(code).not.toContain('BUTTON_1');
    expect(code).toContain('Servo servo;\nLiquidCrystal_I2C lcd(0x27, 16, 2);\nDHT dht(DHT_PIN, DHT22);\nAdafruit_NeoPixel pixels(1, RGB_PIN, NEO_GRB + NEO_KHZ800);');
    expect(setupBody(code)).toEqual([
      'Serial.begin(9600);',
      'pinMode(LED_GREEN, OUTPUT);',
      'pinMode(MOTOR, OUTPUT);',
      'pinMode(TRIG_PIN, OUTPUT);',
      'pinMode(BUTTON_2, INPUT);',
      'pinMode(ECHO_PIN, INPUT);',
      'lcd.init();',
      'lcd.backlight();',
      'pixels.begin();',
      'pixels.show();',
      'dht.begin();',
      'servo.attach(SERVO_PIN);',
    ]);
    expect(code).toContain('float t = 0.0;\nbool p = false;\nfloat d = 0.0;');
    expect(transpile(code).ok).toBe(true);
  });

  it('omits includes and pins that no block uses', () => {
    const code = gen({ loop: [led('RED', 'ON')] });
    expect(code).not.toContain('#include');
    expect(code).not.toContain('Serial.begin');
    expect(code).not.toContain('pinMode(LED_GREEN');
    expect(code).toContain('const int LED_RED = A1;');
  });

  it('puts setup hat statements after the init lines and supports several hats', () => {
    const code = generate({
      blocks: {
        languageVersion: 0,
        blocks: [
          hat('z1_setup_hat', [led('RED', 'ON')], 0, 0),
          hat('z1_loop_hat', [led('GREEN', 'ON')], 0, 200),
          hat('z1_setup_hat', [led('GREEN', 'OFF')], 0, 400),
          hat('z1_loop_hat', [led('RED', 'OFF')], 0, 600),
        ],
      },
    });
    expect(code).toContain(
      'void setup() {\n  pinMode(LED_RED, OUTPUT);\n  pinMode(LED_GREEN, OUTPUT);\n\n  digitalWrite(LED_RED, HIGH);\n  digitalWrite(LED_GREEN, LOW);\n}',
    );
    expect(code).toContain('void loop() {\n  digitalWrite(LED_GREEN, HIGH);\n  digitalWrite(LED_RED, LOW);\n}');
  });

  it('ignores orphan blocks', () => {
    const code = gen({
      loop: [waitMs(num(10))],
      top: [led('RED', 'ON'), { type: 'z1_servo_angle', inputs: { ANGLE: v(num(45)) } }, num(3)],
    });
    expect(code).not.toContain('LED_RED');
    expect(code).not.toContain('Servo');
    expect(code).not.toContain('digitalWrite');
    expect(code).toContain('void loop() {\n  delay(10);\n}');
  });

  it('emits each helper once', () => {
    const code = gen({
      setup: [{ type: 'z1_sevenseg_clear' }],
      loop: [
        { type: 'z1_sevenseg_digit', inputs: { DIGIT: v(num(3)) } },
        { type: 'z1_sevenseg_digit', inputs: { DIGIT: v(num(4)) } },
        print({ type: 'z1_ultrasonic_cm' }),
        print({ type: 'z1_ultrasonic_cm' }),
        print({ type: 'z1_serial_read_line' }),
      ],
    });
    expect(code.match(/void showSegments\(byte pattern\)/g)).toHaveLength(1);
    expect(code.match(/void showDigit\(int digit\)/g)).toHaveLength(1);
    expect(code.match(/float readDistanceCm\(\)/g)).toHaveLength(1);
    expect(code.match(/String readLine\(\)/g)).toHaveLength(1);
    expect(code.indexOf('void showSegments')).toBeLessThan(code.indexOf('void showDigit'));
    expect(code.indexOf('void showDigit')).toBeLessThan(code.indexOf('void setup()'));
    expect(code).toContain('pinMode(SEG_DATA, OUTPUT);');
    expect(code).toContain('pinMode(TRIG_PIN, OUTPUT);');
    expect(code).toContain('pinMode(ECHO_PIN, INPUT);');
    expect(code).toContain('Serial.begin(9600);');
    expect(transpile(code).ok).toBe(true);
  });

  it('turns block comments into // comments', () => {
    const json = workspaceJson({ loop: [led('RED', 'ON')] }) as { blocks: { blocks: BlockJson[] } };
    (json.blocks.blocks[1]!.inputs!['DO']!.block as BlockJson & { icons?: unknown }).icons = { comment: { text: 'light up' } };
    expect(generate(json)).toContain('  // light up\n  digitalWrite(LED_RED, HIGH);');
  });
});

describe('generator: variables and typing', () => {
  it('types variables int / float / String / bool from their assignments', () => {
    const code = gen({
      setup: [
        setVar('count', num(0)),
        setVar('ratio', num(0.5)),
        setVar('name', text('ZERO1')),
        setVar('flag', bool(true)),
        setVar('half', arith('DIVIDE', getVar('count'), num(2))),
        setVar('copy', getVar('ratio')),
        setVar('mixed', num(1)),
        setVar('mixed', text('x')),
      ],
      variables: ['count', 'ratio', 'name', 'flag', 'half', 'copy', 'mixed'].map((n) => ({ name: n, id: n })),
    });
    expect(code).toContain('int count = 0;');
    expect(code).toContain('float ratio = 0.0;');
    expect(code).toContain('String name = "";');
    expect(code).toContain('bool flag = false;');
    expect(code).toContain('float half = 0.0;');
    expect(code).toContain('float copy = 0.0;');
    expect(code).toContain('String mixed = "";');
    expect(code).toContain('count = 0;\n  ratio = 0.5;\n  name = "ZERO1";\n  flag = true;\n  half = count / 2;');
    expect(transpile(code).ok).toBe(true);
  });

  it('types a never-assigned variable as int and defaults an empty value input', () => {
    const code = gen({ loop: [print(getVar('x')), setVar('y')], variables: [{ name: 'x', id: 'x' }, { name: 'y', id: 'y' }] });
    expect(code).toContain('int x = 0;');
    expect(code).toContain('y = 0;');
  });

  it('exposes the inference through inferTypes()', () => {
    const ws = load(workspaceJson({ setup: [setVar('a', num(1.5)), { type: 'text_append', fields: { VAR: { id: 'b' } }, inputs: { TEXT: v(text('!')) } }], variables: [{ name: 'a', id: 'a' }, { name: 'b', id: 'b' }] }));
    const types = inferTypes(ws);
    expect(types.variables.get('a')).toBe('float');
    expect(types.variables.get('b')).toBe('String');
    ws.dispose();
  });

  it('sanitises names and avoids C++ keywords and runtime names', () => {
    const code = gen({
      setup: [setVar('a', num(1)), setVar('b', num(2)), setVar('c', num(3)), setVar('d', num(4))],
      variables: [
        { name: 'my var', id: 'a' },
        { name: 'for', id: 'b' },
        { name: 'delay', id: 'c' },
        { name: 'Serial', id: 'd' },
      ],
    });
    expect(code).toContain('int my_var = 0;');
    expect(code).toContain('int for2 = 0;');
    expect(code).toContain('int delay2 = 0;');
    expect(code).toContain('int Serial2 = 0;');
    expect(transpile(code).ok).toBe(true);
  });

  it('generates math_change and text_append', async () => {
    const result = await run({
      setup: [setVar('n', num(1)), { type: 'math_change', fields: { VAR: { id: 'n' } }, inputs: { DELTA: v(num(2)) } }, print(getVar('n'))],
      loop: [{ type: 'text_append', fields: { VAR: { id: 's' } }, inputs: { TEXT: v(num(7)) } }, print(getVar('s')), waitMs(num(100))],
      variables: [
        { name: 'n', id: 'n' },
        { name: 's', id: 's' },
      ],
    });
    expect(result.code).toContain('n += 2;');
    expect(result.code).toContain('s += String(7);');
    expect(result.serial.startsWith('3\r\n7\r\n77\r\n') || result.serial.startsWith('3\n7\n77\n')).toBe(true);
  });
});

describe('generator: procedures', () => {
  const defReturn = (name: string, params: Array<{ name: string; id: string }>, body: BlockJson[], ret: BlockJson): BlockJson => ({
    type: 'procedures_defreturn',
    fields: { NAME: name },
    extraState: { params },
    inputs: { ...(body.length ? { STACK: v(chain(body)) } : {}), RETURN: v(ret) },
  });
  const defNoReturn = (name: string, params: Array<{ name: string; id: string }>, body: BlockJson[]): BlockJson => ({
    type: 'procedures_defnoreturn',
    fields: { NAME: name },
    extraState: { params },
    ...(body.length ? { inputs: { STACK: v(chain(body)) } } : {}),
  });
  const call = (name: string, params: string[], args: BlockJson[], returns: boolean): BlockJson => {
    const inputs: Record<string, { block: BlockJson }> = {};
    args.forEach((a, i) => (inputs[`ARG${i}`] = v(a)));
    return { type: returns ? 'procedures_callreturn' : 'procedures_callnoreturn', extraState: { name, params }, inputs };
  };

  it('types parameters from the call sites and the return type from the returned value', async () => {
    const result = await run({
      top: [
        defReturn('add numbers', [{ name: 'a', id: 'pa' }, { name: 'b', id: 'pb' }], [], arith('ADD', getVar('pa'), getVar('pb'))),
        defNoReturn('say hello', [{ name: 'who', id: 'pw' }], [print({ type: 'text_join', extraState: { itemCount: 2 }, inputs: { ADD0: v(text('Hello ')), ADD1: v(getVar('pw')) } })]),
      ],
      setup: [
        print(call('add numbers', ['a', 'b'], [num(1), num(2.5)], true)),
        call('say hello', ['who'], [text('ZERO1')], false),
      ],
      variables: [
        { name: 'a', id: 'pa' },
        { name: 'b', id: 'pb' },
        { name: 'who', id: 'pw' },
      ],
    });
    expect(result.code).toContain('float add_numbers(int a, float b) {\n  return a + b;\n}');
    expect(result.code).toContain('void say_hello(String who) {\n  Serial.println(String("Hello ") + String(who));\n}');
    expect(result.code).toContain('Serial.println(add_numbers(1, 2.5));');
    expect(result.code).toContain('say_hello("ZERO1");');
    // parameters are not declared as globals
    expect(result.code).not.toMatch(/^(int|float|String) (a|b|who) = /m);
    expect(result.serial).toContain('3.50');
    expect(result.serial).toContain('Hello ZERO1');
  });

  it('keeps a parameter global when it is also used outside its function, and separates clashing names', async () => {
    const result = await run({
      top: [defNoReturn('count', [{ name: 'count', id: 'pc' }], [print(getVar('pc'))])],
      setup: [setVar('pc', num(5)), call('count', ['count'], [getVar('pc')], false), print(getVar('pc'))],
      variables: [{ name: 'count', id: 'pc' }],
    });
    expect(result.code).toContain('int count = 0;');
    expect(result.code).toContain('void count2(int count) {');
    expect(result.code).toContain('count2(count);');
    expect(result.serial).toMatch(/^5\r?\n5\r?\n/);
  });

  it('emits functions before setup(), in workspace order, with if-return', () => {
    const code = gen({
      top: [
        defNoReturn('second', [], [led('RED', 'ON')]),
        defReturn('first', [{ name: 'x', id: 'px' }], [{ type: 'procedures_ifreturn', extraState: '<mutation value="1"></mutation>', inputs: { CONDITION: v(compare('LT', getVar('px'), num(0))), VALUE: v(num(0)) } }], getVar('px')),
      ],
      loop: [call('second', [], [], false)],
      variables: [{ name: 'x', id: 'px' }],
    });
    expect(code.indexOf('void second()')).toBeLessThan(code.indexOf('int first(int x)'));
    expect(code.indexOf('int first(int x)')).toBeLessThan(code.indexOf('void setup()'));
    expect(code).toContain('int first(int x) {\n  if (x < 0) {\n    return 0;\n  }\n  return x;\n}');
    expect(transpile(code).ok).toBe(true);
  });
});

describe('generator: control flow', () => {
  it('generates if / else if / else', () => {
    const code = gen({
      loop: [
        {
          type: 'controls_if',
          extraState: { elseIfCount: 1, hasElse: true },
          inputs: {
            IF0: v(compare('GT', getVar('x'), num(10))),
            DO0: v(led('RED', 'ON')),
            IF1: v(compare('EQ', getVar('x'), num(10))),
            DO1: v(led('GREEN', 'ON')),
            ELSE: v(led('BUILTIN', 'ON')),
          },
        },
      ],
      variables: [{ name: 'x', id: 'x' }],
    });
    expect(code).toContain(
      '  if (x > 10) {\n    digitalWrite(LED_RED, HIGH);\n  } else if (x == 10) {\n    digitalWrite(LED_GREEN, HIGH);\n  } else {\n    digitalWrite(LED_BUILTIN, HIGH);\n  }\n',
    );
    expect(code).toContain('pinMode(LED_BUILTIN, OUTPUT);');
    expect(code).not.toContain('const int LED_BUILTIN');
    expect(transpile(code).ok).toBe(true);
  });

  it('names nested repeat counters i, j and skips names taken by variables', async () => {
    const result = await run({
      setup: [repeat(num(2), [repeat(num(3), [{ type: 'math_change', fields: { VAR: { id: 'n' } }, inputs: { DELTA: v(num(1)) } }])]), print(getVar('n'))],
      variables: [{ name: 'n', id: 'n' }],
    });
    expect(result.code).toContain('for (int i = 0; i < 2; i++) {\n    for (int j = 0; j < 3; j++) {\n      n += 1;\n    }\n  }');
    expect(result.serial).toMatch(/^6/);

    const code = gen({ setup: [repeat(num(2), [repeat(num(3), [waitMs(num(1))])]), setVar('i', num(0))], variables: [{ name: 'i', id: 'i' }] });
    expect(code).toContain('for (int j = 0; j < 2; j++) {\n    for (int k = 0; k < 3; k++) {');
  });

  it('generates while / until loops, counted for loops and break', () => {
    const code = gen({
      loop: [
        { type: 'controls_whileUntil', fields: { MODE: 'WHILE' }, inputs: { BOOL: v(compare('LT', getVar('n'), num(3))), DO: v(waitMs(num(1))) } },
        { type: 'controls_whileUntil', fields: { MODE: 'UNTIL' }, inputs: { BOOL: v({ type: 'z1_button_pressed', fields: { BUTTON: '1' } }), DO: v(waitMs(num(1))) } },
        { type: 'controls_whileUntil', fields: { MODE: 'UNTIL' }, inputs: { BOOL: v(getVar('done')), DO: v({ type: 'controls_flow_statements', fields: { FLOW: 'BREAK' } }) } },
        { type: 'controls_for', fields: { VAR: { id: 'n' } }, inputs: { FROM: v(num(1)), TO: v(num(10)), BY: v(num(1)), DO: v(waitMs(num(1))) } },
        { type: 'controls_for', fields: { VAR: { id: 'n' } }, inputs: { FROM: v(num(10)), TO: v(num(0)), BY: v(num(-2)), DO: v(waitMs(num(1))) } },
      ],
      variables: [
        { name: 'n', id: 'n' },
        { name: 'done', id: 'done' },
      ],
    });
    expect(code).toContain('while (n < 3) {');
    expect(code).toContain('while (!(digitalRead(BUTTON_1) == HIGH)) {');
    expect(code).toContain('while (!done) {\n    break;\n  }');
    expect(code).toContain('for (n = 1; n <= 10; n++) {');
    expect(code).toContain('for (n = 10; n >= 0; n -= 2) {');
    expect(code).toContain('int n = 0;');
    expect(transpile(code).ok).toBe(true);
  });
});

describe('generator: expressions', () => {
  it('adds parentheses only where needed', () => {
    const code = gen({
      setup: [
        setVar('r', arith('MULTIPLY', arith('ADD', getVar('a'), getVar('b')), getVar('c'))),
        setVar('r', arith('ADD', getVar('a'), arith('MULTIPLY', getVar('b'), getVar('c')))),
        setVar('r', arith('MINUS', getVar('a'), arith('MINUS', getVar('b'), getVar('c')))),
        setVar('r', arith('MINUS', getVar('a'), num(-1))),
        setVar('r', { type: 'math_single', fields: { OP: 'NEG' }, inputs: { NUM: v(arith('ADD', getVar('a'), num(1))) } }),
        setVar('f', { type: 'logic_negate', inputs: { BOOL: v({ type: 'logic_operation', fields: { OP: 'AND' }, inputs: { A: v(getVar('f')), B: v(compare('LT', getVar('a'), getVar('b'))) } }) } }),
        setVar('r', { type: 'logic_ternary', inputs: { IF: v(getVar('f')), THEN: v(num(1)), ELSE: v(num(2)) } }),
      ],
      variables: ['a', 'b', 'c', 'r', 'f'].map((n) => ({ name: n, id: n })),
    });
    expect(code).toContain('r = (a + b) * c;');
    expect(code).toContain('r = a + b * c;');
    expect(code).toContain('r = a - (b - c);');
    expect(code).toContain('r = a - -1;');
    expect(code).toContain('r = -(a + 1);');
    expect(code).toContain('f = !(f && a < b);');
    expect(code).toContain('r = f ? 1 : 2;');
    expect(transpile(code).ok).toBe(true);
  });

  it('generates the math blocks', async () => {
    const single = (op: string, x: BlockJson): BlockJson => ({ type: 'math_single', fields: { OP: op }, inputs: { NUM: v(x) } });
    const result = await run({
      setup: [
        print(arith('POWER', num(2), num(3))),
        print(single('ROOT', num(16))),
        print(single('ABS', num(-4))),
        print(single('LN', num(1))),
        print(single('POW10', num(2))),
        print({ type: 'math_trig', fields: { OP: 'SIN' }, inputs: { NUM: v(num(90)) } }),
        print({ type: 'math_trig', fields: { OP: 'ASIN' }, inputs: { NUM: v(num(1)) } }),
        print({ type: 'math_constant', fields: { CONSTANT: 'PI' } }),
        print({ type: 'math_constant', fields: { CONSTANT: 'E' } }),
        print({ type: 'math_number_property', fields: { PROPERTY: 'EVEN' }, inputs: { NUMBER_TO_CHECK: v(num(4)) } }),
        print({ type: 'math_number_property', fields: { PROPERTY: 'PRIME' }, inputs: { NUMBER_TO_CHECK: v(num(7)) } }),
        print({ type: 'math_number_property', fields: { PROPERTY: 'WHOLE' }, inputs: { NUMBER_TO_CHECK: v(num(2.5)) } }),
        print({ type: 'math_number_property', fields: { PROPERTY: 'DIVISIBLE_BY' }, extraState: '<mutation divisor_input="true"></mutation>', inputs: { NUMBER_TO_CHECK: v(num(9)), DIVISOR: v(num(3)) } }),
        print({ type: 'math_round', fields: { OP: 'ROUNDUP' }, inputs: { NUM: v(num(2.1)) } }),
        print({ type: 'math_modulo', inputs: { DIVIDEND: v(num(17)), DIVISOR: v(num(5)) } }),
        print({ type: 'math_constrain', inputs: { VALUE: v(num(200)), LOW: v(num(0)), HIGH: v(num(100)) } }),
        setVar('r', { type: 'math_random_int', inputs: { FROM: v(num(1)), TO: v(num(6)) } }),
        setVar('q', { type: 'math_random_float' }),
      ],
      variables: [
        { name: 'r', id: 'r' },
        { name: 'q', id: 'q' },
      ],
    });
    expect(result.code).toContain('Serial.println(pow(2, 3));');
    expect(result.code).toContain('Serial.println(sqrt(16));');
    expect(result.code).toContain('Serial.println(abs(-4));');
    expect(result.code).toContain('Serial.println(log(1));');
    expect(result.code).toContain('Serial.println(pow(10, 2));');
    expect(result.code).toContain('Serial.println(sin(radians(90)));');
    expect(result.code).toContain('Serial.println(degrees(asin(1)));');
    expect(result.code).toContain('Serial.println(PI);');
    expect(result.code).toContain('Serial.println(EULER);');
    expect(result.code).toContain('Serial.println(4 % 2 == 0);');
    expect(result.code).toContain('Serial.println(isPrime(7));');
    expect(result.code).toContain('Serial.println(2.5 == (long) 2.5);');
    expect(result.code).toContain('Serial.println(9 % 3 == 0);');
    expect(result.code).toContain('Serial.println(ceil(2.1));');
    expect(result.code).toContain('Serial.println(17 % 5);');
    expect(result.code).toContain('Serial.println(constrain(200, 0, 100));');
    expect(result.code).toContain('r = random(1, 6 + 1);');
    expect(result.code).toContain('q = random(0, 1000) / 1000.0;');
    expect(result.code).toContain('float q = 0.0;');
    expect(result.code).toContain('int r = 0;');
    const lines = result.serial.split(/\r?\n/);
    expect(lines.slice(0, 16)).toEqual(['8.00', '4.00', '4', '0.00', '100.00', '1.00', '90.00', '3.14', '2.72', '1', '1', '0', '1', '3.00', '2', '100']);
  });

  it('generates the text blocks and their helpers', async () => {
    const result = await run({
      setup: [
        setVar('s', text('hello world')),
        print({ type: 'text_join', extraState: { itemCount: 3 }, inputs: { ADD0: v(text('a')), ADD1: v(getVar('s')), ADD2: v(num(1)) } }),
        print({ type: 'text_join', extraState: { itemCount: 1 }, inputs: { ADD0: v(num(5)) } }),
        print({ type: 'text_length', inputs: { VALUE: v(getVar('s')) } }),
        print({ type: 'text_length', inputs: { VALUE: v(text('abc')) } }),
        print({ type: 'text_isEmpty', inputs: { VALUE: v(getVar('s')) } }),
        print({ type: 'text_changeCase', fields: { CASE: 'UPPERCASE' }, inputs: { TEXT: v(getVar('s')) } }),
        print({ type: 'text_changeCase', fields: { CASE: 'LOWERCASE' }, inputs: { TEXT: v(text('ABC')) } }),
        print({ type: 'text_changeCase', fields: { CASE: 'TITLECASE' }, inputs: { TEXT: v(getVar('s')) } }),
        print({ type: 'text_trim', fields: { MODE: 'BOTH' }, inputs: { TEXT: v(text('  x  ')) } }, false),
        print({ type: 'text_trim', fields: { MODE: 'LEFT' }, inputs: { TEXT: v(text('  y  ')) } }, false),
        print({ type: 'text_trim', fields: { MODE: 'RIGHT' }, inputs: { TEXT: v(text('  z  ')) } }),
        print(getVar('s')),
        print(text('quote " and \\ backslash')),
      ],
      variables: [{ name: 's', id: 's' }],
    });
    expect(result.code).toContain('Serial.println(String("a") + String(s) + String(1));');
    expect(result.code).toContain('Serial.println(String(5));');
    expect(result.code).toContain('Serial.println(s.length());');
    expect(result.code).toContain('Serial.println(String("abc").length());');
    expect(result.code).toContain('Serial.println(s.length() == 0);');
    expect(result.code).toContain('Serial.println(toUpper(s));');
    expect(result.code).toContain('Serial.println(toTitle(s));');
    expect(result.code).toContain('Serial.println("quote \\" and \\\\ backslash");');
    expect(result.code.match(/String toUpper\(String text\)/g)).toHaveLength(1);
    const lines = result.serial.split(/\r?\n/);
    // "x" + "y  " + "  z" (the first two are printed on the same line)
    expect(lines.slice(0, 10)).toEqual(['ahello world1', '5', '11', '3', '0', 'HELLO WORLD', 'abc', 'Hello World', 'xy    z', 'hello world']);
    expect(lines[10]).toBe('quote " and \\ backslash');
  });
});

describe('generator: board blocks', () => {
  it('generates the output blocks', () => {
    const code = gen({
      loop: [
        { type: 'z1_led_toggle', fields: { LED: 'GREEN' } },
        { type: 'z1_rgb_set', inputs: { R: v(num(10)), G: v(num(20)), B: v(num(30)) } },
        { type: 'z1_rgb_brightness', inputs: { VALUE: v(num(50)) } },
        { type: 'z1_buzzer_tone', inputs: { FREQ: v(num(440)), DURATION: v(num(200)) } },
        { type: 'z1_buzzer_note', fields: { NOTE: 'A4' }, inputs: { DURATION: v(num(100)) } },
        { type: 'z1_buzzer_set', fields: { STATE: 'ON' } },
        { type: 'z1_buzzer_set', fields: { STATE: 'OFF' } },
        { type: 'z1_motor_set', fields: { STATE: 'OFF' } },
        { type: 'z1_lcd_print', fields: { ROW: '1' }, inputs: { TEXT: v(text('Hi')), COL: v(num(3)) } },
        { type: 'z1_lcd_line', fields: { ROW: '0' }, inputs: { TEXT: v(num(42)) } },
        { type: 'z1_lcd_backlight', fields: { STATE: 'OFF' } },
        { type: 'z1_lcd_backlight', fields: { STATE: 'ON' } },
      ],
    });
    expect(code).toContain('digitalWrite(LED_GREEN, !digitalRead(LED_GREEN));');
    expect(code).toContain('pixels.setPixelColor(0, pixels.Color(10, 20, 30));\n  pixels.show();');
    expect(code).toContain('pixels.setBrightness(50);\n  pixels.show();');
    expect(code).toContain('tone(BUZZER, 440);\n  delay(200);\n  noTone(BUZZER);');
    expect(code).toContain('tone(BUZZER, 440);\n  delay(100);\n  noTone(BUZZER);');
    expect(code).toContain('digitalWrite(BUZZER, HIGH);\n  digitalWrite(BUZZER, LOW);');
    expect(code).toContain('digitalWrite(MOTOR, LOW);');
    expect(code).toContain('lcd.setCursor(3, 1);\n  lcd.print("Hi");');
    expect(code).toContain('lcd.setCursor(0, 0);\n  lcd.print("                ");\n  lcd.setCursor(0, 0);\n  lcd.print(42);');
    expect(code).toContain('lcd.noBacklight();\n  lcd.backlight();');
    expect(transpile(code).ok).toBe(true);
  });

  it('generates the input, time and serial blocks', () => {
    const code = gen({
      loop: [
        setVar('a', { type: 'z1_pot_read' }),
        setVar('a', { type: 'z1_pot_percent' }),
        setVar('a', { type: 'z1_ldr_read' }),
        setVar('b', { type: 'z1_ldr_dark', inputs: { THRESHOLD: v(num(200)) } }),
        setVar('h', { type: 'z1_dht_read', fields: { WHAT: 'HUMIDITY' } }),
        setVar('t', { type: 'z1_millis' }),
        setVar('a', { type: 'z1_map', inputs: { VALUE: v(getVar('a')), FROM_LOW: v(num(0)), FROM_HIGH: v(num(1023)), TO_LOW: v(num(0)), TO_HIGH: v(num(180)) } }),
        { type: 'z1_delay_s', inputs: { S: v(num(2)) } },
        { type: 'z1_delay_s', inputs: { S: v(num(0.25)) } },
        { type: 'z1_delay_s', inputs: { S: v(getVar('t')) } },
        { type: 'z1_delay_s', inputs: { S: v(arith('ADD', getVar('t'), num(1))) } },
        print(getVar('a'), false),
        { type: 'z1_serial_print_labeled', fields: { LABEL: 'light' }, inputs: { VALUE: v(getVar('a')) } },
        setVar('b', { type: 'z1_serial_available' }),
        setVar('s', { type: 'z1_serial_read_line' }),
      ],
      variables: ['a', 'b', 'h', 't', 's'].map((n) => ({ name: n, id: n })),
    });
    expect(code).toContain('a = analogRead(POT_LDR);');
    expect(code).toContain('a = map(analogRead(POT_LDR), 0, 1023, 0, 100);');
    expect(code).toContain('b = (analogRead(POT_LDR) < 200);');
    expect(code).toContain('h = dht.readHumidity();');
    expect(code).toContain('t = millis();');
    expect(code).toContain('a = map(a, 0, 1023, 0, 180);');
    expect(code).toContain('delay(2000);\n  delay(250);\n  delay(t * 1000);\n  delay((t + 1) * 1000);');
    expect(code).toContain('Serial.print(a);');
    expect(code).toContain('Serial.print("light: ");\n  Serial.println(a);');
    expect(code).toContain('b = (Serial.available() > 0);');
    expect(code).toContain('s = readLine();');
    expect(code).toContain('bool b = false;');
    expect(code).toContain('float h = 0.0;');
    expect(code).toContain('String s = "";');
    expect(code).not.toContain('pinMode(POT_LDR');
    expect(transpile(code).ok).toBe(true);
  });

  it('reads the buttons, the potentiometer and the LDR on the virtual board', async () => {
    const result = await run(
      {
        loop: [
          {
            type: 'controls_if',
            extraState: { hasElse: true },
            inputs: { IF0: v({ type: 'z1_button_pressed', fields: { BUTTON: '1' } }), DO0: v(led('RED', 'ON')), ELSE: v(led('RED', 'OFF')) },
          },
          { type: 'z1_serial_print_labeled', fields: { LABEL: 'pot' }, inputs: { VALUE: v({ type: 'z1_pot_percent' }) } },
          waitMs(num(100)),
        ],
      },
      {
        before: (board) => {
          board.buttonA.press();
          board.potLdr.setPot(1023);
        },
      },
    );
    expect(result.code).toContain('if (digitalRead(BUTTON_1) == HIGH) {');
    expect(result.board.ledRed.state.on).toBe(true);
    expect(result.serial).toContain('pot: 100');
  });
});
