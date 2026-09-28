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
  it('lists 32 examples in the 14 groups with unique ids', () => {
    expect(BLOCK_EXAMPLES).toHaveLength(32);
    expect(new Set(BLOCK_EXAMPLES.map((e) => e.id)).size).toBe(32);
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

  // --- part-by-part groups (b40 ... b59) -------------------------------------------

  type Board = Parameters<NonNullable<RunOptions['before']>>[0];
  const PIN = { RED: 15, GREEN: 16, BUZZER: 8, MOTOR: 14, LATCH: 11 } as const;
  const example = (id: string) => BLOCK_EXAMPLES.find((e) => e.id === id)!;
  const code = (id: string) => generate(example(id).workspace);
  const rising = (events: Array<[number, number]>, pin: number) => events.filter(([p, level]) => p === pin && level === 1).length;
  const count = (serial: string, re: RegExp) => (serial.match(re) ?? []).length;

  /** [level, virtual ms] of every write to `pin`, plus the run result. */
  const timeline = async (id: string, pin: number, ms: number, before?: (b: Board) => void) => {
    const events: Array<[number, number]> = [];
    const result = await runSketch(code(id), {
      stopAfterMs: ms,
      before: (b, clock) => {
        before?.(b);
        b.on((e) => e.type === 'digitalWrite' && e.pin === pin && events.push([e.level, clock.now()]));
      },
    });
    return { events, ...result };
  };

  /** Buzzer pulses: on-durations and the gaps between them (virtual ms). `before` may also install hooks. */
  const pulses = async (id: string, ms: number, before?: (b: Board) => void) => {
    const on: number[] = [];
    const gaps: number[] = [];
    let since = 0;
    let off = -1;
    await runSketch(code(id), {
      stopAfterMs: ms,
      before: (b, clock) => {
        before?.(b);
        b.on((e) => {
          if (e.type !== 'digitalWrite' || e.pin !== PIN.BUZZER || e.level === e.prev) return;
          if (e.level === 1) {
            since = clock.now();
            if (off >= 0) gaps.push(clock.now() - off);
          } else {
            on.push(clock.now() - since);
            off = clock.now();
          }
        });
      },
    });
    return { on, gaps };
  };

  // LED
  it('b40_led_blink_red blinks 500 ms on / 500 ms off', async () => {
    const { events } = await timeline('b40_led_blink_red', PIN.RED, 1600);
    expect(events.map(([level]) => level).slice(0, 4)).toEqual([1, 0, 1, 0]);
    expect(events[1]![1] - events[0]![1]).toBeCloseTo(500, 0);
    expect(events[2]![1] - events[1]![1]).toBeCloseTo(500, 0);
    expect(events[3]![1] - events[2]![1]).toBeCloseTo(500, 0);
  });

  it('b41_led_red_green alternates every 500 ms and never lights both LEDs together', async () => {
    const both: boolean[] = [];
    const green: number[] = [];
    const red: number[] = [];
    await runSketch(code('b41_led_red_green'), {
      stopAfterMs: 2200,
      before: (board, clock) =>
        board.on((e) => {
          if (e.type !== 'digitalWrite') return;
          both.push(board.ledRed.state.on && board.ledGreen.state.on);
          if (e.level === 1 && e.pin === PIN.RED) red.push(clock.now());
          if (e.level === 1 && e.pin === PIN.GREEN) green.push(clock.now());
        }),
    });
    expect(both.length).toBeGreaterThanOrEqual(8);
    expect(both).not.toContain(true);
    expect(green[0]! - red[0]!).toBeCloseTo(500, 0);
    expect(red[1]! - green[0]!).toBeCloseTo(500, 0);
  });

  it('b42_led_blink_10_times blinks exactly 10 times in setup(), prints Done and stays off', async () => {
    expect(code('b42_led_blink_10_times')).toMatch(/void setup\(\) \{[\s\S]*for \(int i = 0; i < 10; i\+\+\)[\s\S]*Serial\.println\("Done"\);\n\}/);
    const { events, serial, board, status } = await timeline('b42_led_blink_10_times', PIN.RED, 8000);
    expect(events.filter(([level]) => level === 1)).toHaveLength(10);
    expect(events[1]![1] - events[0]![1]).toBeCloseTo(300, 0);
    expect(events[2]![1] - events[1]![1]).toBeCloseTo(300, 0);
    expect(serial).toContain('Done');
    expect(board.ledRed.state.on).toBe(false);
    expect(status).toBe('stopped');
  });

  // Buzzer
  it('b43_buzzer_short_beeps beeps 100 ms every 500 ms forever', async () => {
    const { on, gaps } = await pulses('b43_buzzer_short_beeps', 2600);
    expect(on.length).toBeGreaterThanOrEqual(5);
    expect(on.every((p) => Math.abs(p - 100) < 0.5)).toBe(true);
    expect(gaps.every((g) => Math.abs(g - 400) < 0.5)).toBe(true);
  });

  it('b44_buzzer_led_10_times switches the buzzer and the red LED together, 10 times, then prints Done', async () => {
    expect(code('b44_buzzer_led_10_times')).toMatch(/void setup\(\) \{[\s\S]*for \(int i = 0; i < 10; i\+\+\)[\s\S]*Serial\.println\("Done"\);\n\}/);
    const events: Array<[number, number]> = [];
    let buzzer = 0;
    const together: boolean[] = [];
    const result = await runSketch(code('b44_buzzer_led_10_times'), {
      stopAfterMs: 6000,
      before: (board) =>
        board.on((e) => {
          if (e.type !== 'digitalWrite') return;
          events.push([e.pin, e.level]);
          if (e.pin === PIN.BUZZER) buzzer = e.level;
          if (e.pin === PIN.RED) together.push(buzzer === e.level);
        }),
    });
    expect(rising(events, PIN.RED)).toBe(10);
    expect(rising(events, PIN.BUZZER)).toBe(10);
    expect(together).toHaveLength(20);
    expect(together).not.toContain(false);
    const { on, gaps } = await pulses('b44_buzzer_led_10_times', 6000);
    expect(on).toHaveLength(10);
    expect(on.every((p) => Math.abs(p - 200) < 0.5)).toBe(true);
    expect(gaps).toHaveLength(9);
    expect(gaps.every((g) => Math.abs(g - 300) < 0.5)).toBe(true);
    expect(result.serial).toContain('Done');
    expect(result.board.ledRed.state.on).toBe(false);
  });

  // Push Button
  it('b45_buttons_leds lights the red LED for button 1 and the green LED for button 2 while held', async () => {
    const run = (before?: (b: Board) => void) => runSketch(code('b45_buttons_leds'), { stopAfterMs: 200, before });
    const a = await run((b) => b.buttonA.press());
    expect([a.board.ledRed.state.on, a.board.ledGreen.state.on]).toEqual([true, false]);
    const b = await run((bd) => bd.buttonB.press());
    expect([b.board.ledRed.state.on, b.board.ledGreen.state.on]).toEqual([false, true]);
    const both = await run((bd) => {
      bd.buttonA.press();
      bd.buttonB.press();
    });
    expect([both.board.ledRed.state.on, both.board.ledGreen.state.on]).toEqual([true, true]);
    const none = await run();
    expect([none.board.ledRed.state.on, none.board.ledGreen.state.on]).toEqual([false, false]);
  });

  it('b46_buttons_beeps gives one 100 ms beep per press of button 1 and one 1000 ms beep per press of button 2', async () => {
    expect(code('b46_buttons_beeps')).toContain('while (digitalRead(BUTTON_1) == HIGH) {');
    expect(code('b46_buttons_beeps')).toContain('while (digitalRead(BUTTON_2) == HIGH) {');
    // Holding a button gives exactly one beep.
    expect((await pulses('b46_buttons_beeps', 1500, (b) => b.buttonA.press())).on).toEqual([100]);
    expect((await pulses('b46_buttons_beeps', 2500, (b) => b.buttonB.press())).on).toEqual([1000]);
    expect((await pulses('b46_buttons_beeps', 1500)).on).toEqual([]);
    // Release after the short beep, then press button 2: a second (long) beep follows.
    const released = await pulses('b46_buttons_beeps', 2500, (b) => {
      b.buttonA.press();
      b.on((e) => {
        if (e.type !== 'digitalWrite' || e.pin !== PIN.BUZZER || e.level !== 0) return;
        if (b.buttonA.state.pressed) {
          b.buttonA.release();
          b.buttonB.press();
        } else {
          b.buttonB.release();
        }
      });
    });
    expect(released.on).toEqual([100, 1000]);
  });

  // RGB LED
  it('b47_rgb_red_green_blue shows red, green and blue for 1 s each', async () => {
    const seen: Array<[string, number]> = [];
    await runSketch(code('b47_rgb_red_green_blue'), {
      stopAfterMs: 3400,
      before: (b, clock) =>
        b.on((e) => e.type === 'pixels' && seen.push([`${b.rgb.state.r > 0 ? 'R' : ''}${b.rgb.state.g > 0 ? 'G' : ''}${b.rgb.state.b > 0 ? 'B' : ''}`, clock.now()])),
    });
    // The generated setup() first shows "all off"; then the loop cycles the colours.
    expect(seen.slice(1, 5).map(([c]) => c)).toEqual(['R', 'G', 'B', 'R']);
    expect(seen[2]![1] - seen[1]![1]).toBeCloseTo(1000, 0);
    expect(seen[3]![1] - seen[2]![1]).toBeCloseTo(1000, 0);
  });

  it('b48_rgb_buttons colours the RGB LED red for button 1, green for button 2, off otherwise', async () => {
    const a = await runSketch(code('b48_rgb_buttons'), { stopAfterMs: 200, before: (b) => b.buttonA.press() });
    expect(a.board.rgb.state.r).toBeGreaterThan(0);
    expect(a.board.rgb.state.g + a.board.rgb.state.b).toBe(0);
    const b = await runSketch(code('b48_rgb_buttons'), { stopAfterMs: 200, before: (bd) => bd.buttonB.press() });
    expect(b.board.rgb.state.g).toBeGreaterThan(0);
    expect(b.board.rgb.state.r + b.board.rgb.state.b).toBe(0);
    const none = await runSketch(code('b48_rgb_buttons'), { stopAfterMs: 200 });
    expect(none.board.rgb.state.r + none.board.rgb.state.g + none.board.rgb.state.b).toBe(0);
  });

  // LDR
  const ldr = (light: number) => (b: Board) => {
    b.potLdr.setSource('ldr');
    b.potLdr.setLight(light);
  };

  it('b49_ldr_serial prints "Light: <value>" every 500 ms', async () => {
    const bright = await runSketch(code('b49_ldr_serial'), { stopAfterMs: 1200, before: ldr(60) });
    expect(count(bright.serial, /Light: 580/g)).toBe(3);
    const dark = await runSketch(code('b49_ldr_serial'), { stopAfterMs: 300, before: ldr(20) });
    expect(dark.serial).toContain('Light: 220');
  });

  it('b50_ldr_red_green lights red below 500 and green otherwise, printing the value', async () => {
    const bright = await runSketch(code('b50_ldr_red_green'), { stopAfterMs: 1200, before: ldr(60) });
    expect(count(bright.serial, /Light: 580/g)).toBe(3);
    expect([bright.board.ledRed.state.on, bright.board.ledGreen.state.on]).toEqual([false, true]);
    const dark = await runSketch(code('b50_ldr_red_green'), { stopAfterMs: 300, before: ldr(20) });
    expect(dark.serial).toContain('Light: 220');
    expect([dark.board.ledRed.state.on, dark.board.ledGreen.state.on]).toEqual([true, false]);
  });

  // Seven-Segment
  it('b51_seg_buttons_count counts 1..4 for button 1 and 7..1 for button 2, one digit per second, then blanks', async () => {
    const DIGIT = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
    const latched = async (press: 'buttonA' | 'buttonB' | null, ms: number) => {
      const seen: Array<[number, number]> = [];
      const result = await runSketch(code('b51_seg_buttons_count'), {
        stopAfterMs: ms,
        before: (b, clock) => {
          if (press) b[press].press();
          b.on((e) => e.type === 'digitalWrite' && e.pin === PIN.LATCH && e.level === 1 && seen.push([b.sevenSeg.state.latched, clock.now()]));
        },
      });
      return { seen, serial: result.serial };
    };
    expect(code('b51_seg_buttons_count')).toContain('for (n = 1; n <= 4; n++)');
    expect(code('b51_seg_buttons_count')).toContain('for (n = 7; n >= 1; n--)');
    const up = await latched('buttonA', 4500);
    expect(up.seen.slice(0, 6).map(([p]) => p)).toEqual([0, DIGIT[1], DIGIT[2], DIGIT[3], DIGIT[4], 0]);
    expect(up.seen[2]![1] - up.seen[1]![1]).toBeCloseTo(1000, 0);
    expect(up.serial).toMatch(/^1\r?\n2\r?\n3\r?\n4\r?\n/);
    const down = await latched('buttonB', 7500);
    expect(down.seen.slice(0, 9).map(([p]) => p)).toEqual([0, DIGIT[7], DIGIT[6], DIGIT[5], DIGIT[4], DIGIT[3], DIGIT[2], DIGIT[1], 0]);
    expect(down.serial).toMatch(/^7\r?\n6\r?\n5\r?\n4\r?\n3\r?\n2\r?\n1\r?\n/);
    const idle = await latched(null, 500);
    expect(idle.seen.map(([p]) => p)).toEqual([0]);
    expect(idle.serial).toBe('');
  });

  // Ultrasonic
  const at = (cm: number) => (b: Board) => b.ultrasonic.setDistance(cm);

  it('b52_ultrasonic_serial prints "Distance: <cm> cm" every 500 ms', async () => {
    // 50 cm measured through pulseIn() (whole microseconds) comes back as 49.7
    const far = await runSketch(code('b52_ultrasonic_serial'), { stopAfterMs: 1200 });
    expect(count(far.serial, /Distance: (49|50)\.\d\d cm/g)).toBe(3);
    const near = await runSketch(code('b52_ultrasonic_serial'), { stopAfterMs: 300, before: at(20) });
    expect(near.serial).toMatch(/Distance: (19|20)\.\d\d cm/);
  });

  it('b53_ultrasonic_red_green lights red under 10 cm and green otherwise, printing the distance', async () => {
    const near = await runSketch(code('b53_ultrasonic_red_green'), { stopAfterMs: 300, before: at(5) });
    expect([near.board.ledRed.state.on, near.board.ledGreen.state.on]).toEqual([true, false]);
    expect(near.serial).toMatch(/Distance: (4|5)\.\d\d cm/);
    const far = await runSketch(code('b53_ultrasonic_red_green'), { stopAfterMs: 300, before: at(50) });
    expect([far.board.ledRed.state.on, far.board.ledGreen.state.on]).toEqual([false, true]);
    expect(far.serial).toMatch(/Distance: (49|50)\.\d\d cm/);
  });

  it('b54_ultrasonic_beep_rate beeps 50 ms with a pause of distance x 10 ms kept between 50 and 1000 ms', async () => {
    expect(code('b54_ultrasonic_beep_rate')).toContain('constrain(distance * 10, 50, 1000)');
    const mid = await pulses('b54_ultrasonic_beep_rate', 3000, at(50));
    expect(mid.on.length).toBeGreaterThanOrEqual(5);
    expect(mid.on.every((p) => Math.abs(p - 50) < 0.5)).toBe(true);
    expect(mid.gaps.every((g) => g >= 490 && g <= 505)).toBe(true);
    const near = await pulses('b54_ultrasonic_beep_rate', 3000, at(3));
    expect(near.gaps.length).toBeGreaterThanOrEqual(25);
    expect(near.gaps.every((g) => g >= 50 && g <= 51)).toBe(true);
    const far = await pulses('b54_ultrasonic_beep_rate', 3000, at(150));
    expect(far.gaps.length).toBeGreaterThanOrEqual(2);
    expect(far.gaps.every((g) => g >= 1000 && g <= 1010)).toBe(true);
    expect(near.on.length).toBeGreaterThan(mid.on.length * 3);
  });

  // Servo Motor
  it('b55_servo_buttons sends the servo to 0 for button 1 and to 90 for button 2, printing the angle once per press', async () => {
    const idle = await runSketch(code('b55_servo_buttons'), { stopAfterMs: 200 });
    expect(idle.board.servo.state.target).toBe(0);
    expect(idle.serial).toBe('');
    const b = await runSketch(code('b55_servo_buttons'), { stopAfterMs: 1000, before: (bd) => bd.buttonB.press() });
    expect(b.board.servo.state.target).toBe(90);
    expect(count(b.serial, /Servo angle: 90/g)).toBe(1);
    // Button 1 after button 2: back to 0.
    const a = await runSketch(code('b55_servo_buttons'), {
      stopAfterMs: 1000,
      before: (bd) => {
        bd.buttonB.press();
        bd.on((e) => {
          if (e.type !== 'serialTx') return;
          if (bd.buttonB.state.pressed) {
            bd.buttonB.release();
            bd.buttonA.press();
          }
        });
      },
    });
    expect(a.board.servo.state.target).toBe(0);
    expect(count(a.serial, /Servo angle: 90/g)).toBe(1);
    expect(count(a.serial, /Servo angle: 0/g)).toBe(1);
  });

  it('b56_servo_ultrasonic_10_times does 10 rounds 1 s apart (180 under 10 cm, else 0) and then rests at 0', async () => {
    expect(code('b56_servo_ultrasonic_10_times')).toMatch(/void setup\(\) \{[\s\S]*for \(turn = 1; turn <= 10; turn\+\+\)/);
    const angles: Array<[number, number]> = [];
    const near = await runSketch(code('b56_servo_ultrasonic_10_times'), {
      stopAfterMs: 10500,
      before: (bd, clock) => {
        bd.ultrasonic.setDistance(5);
        bd.on((e) => e.type === 'servo' && e.angle !== null && angles.push([e.angle, clock.now()]));
      },
    });
    const moves = angles.slice(1); // the first event is servo.attach()
    expect(moves.map(([a]) => a)).toEqual([...Array(10).fill(180), 0]);
    expect(moves[1]![1] - moves[0]![1]).toBeGreaterThanOrEqual(1000);
    expect(moves[1]![1] - moves[0]![1]).toBeLessThan(1002);
    expect(near.board.servo.state.target).toBe(0);
    for (let i = 1; i <= 10; i++) expect(near.serial).toContain(`Round: ${i}`);
    expect(count(near.serial, /Angle: 180/g)).toBe(10);
    const far = await runSketch(code('b56_servo_ultrasonic_10_times'), { stopAfterMs: 10500 });
    expect(count(far.serial, /Angle: 0/g)).toBe(10);
    expect(far.board.servo.state.target).toBe(0);
    // Only two rounds fit in the first 1.5 s.
    expect(count((await runSketch(code('b56_servo_ultrasonic_10_times'), { stopAfterMs: 1500 })).serial, /Round: /g)).toBe(2);
  });

  // DHT Sensor
  it('b57_dht_serial prints temperature and humidity on one line every 2 s', async () => {
    const room = await runSketch(code('b57_dht_serial'), { stopAfterMs: 4500 });
    expect(count(room.serial, /Temperature: 24\.00 C  Humidity: 55\.00 %/g)).toBe(3);
    const hot = await runSketch(code('b57_dht_serial'), { stopAfterMs: 300, before: (b) => b.dht.set(30, 60) });
    expect(hot.serial).toContain('Temperature: 30.00 C  Humidity: 60.00 %');
  });

  it('b58_dht_servo_slow sweeps the servo 0..180 by 1 degree every 15 ms above 28 C, else rests at 0', async () => {
    expect(code('b58_dht_servo_slow')).toContain('for (angle = 0; angle <= 180; angle++)');
    const cold = await runSketch(code('b58_dht_servo_slow'), { stopAfterMs: 500 });
    expect(cold.board.servo.state.target).toBe(0);
    expect(cold.serial).toContain('Temperature: 24.00');
    const angles: Array<[number, number]> = [];
    const warm = await runSketch(code('b58_dht_servo_slow'), {
      stopAfterMs: 3500,
      before: (b, clock) => {
        b.dht.set(30, 55);
        b.on((e) => e.type === 'servo' && e.angle !== null && angles.push([e.angle, clock.now()]));
      },
    });
    expect(warm.serial).toContain('Temperature: 30.00');
    const first = angles.findIndex(([a]) => a === 1);
    const sweep = angles.slice(first, first + 180);
    expect(sweep.map(([a]) => a)).toEqual(Array.from({ length: 180 }, (_, i) => i + 1));
    expect(sweep[179]![1] - sweep[0]![1]).toBeGreaterThanOrEqual(179 * 15);
    expect(sweep[179]![1] - sweep[0]![1]).toBeLessThan(179 * 15 + 10);
    expect(warm.board.servo.state.target).toBe(180);
  });

  // DC Motor
  it('b59_motor_buttons runs the motor 5 x 500 ms for button 1 and 5 x 1 s for button 2, printing each run', async () => {
    const short = await timeline('b59_motor_buttons', PIN.MOTOR, 4700, (b) => b.buttonA.press());
    expect(short.events.map(([level]) => level)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    expect(short.events[1]![1] - short.events[0]![1]).toBeCloseTo(500, 0);
    expect(short.events[2]![1] - short.events[1]![1]).toBeCloseTo(500, 0);
    for (let i = 1; i <= 5; i++) expect(short.serial).toContain(`Short run ${i}`);
    expect(short.serial).not.toContain('Long run');
    expect(short.board.motor.state.running).toBe(false);
    const long = await timeline('b59_motor_buttons', PIN.MOTOR, 9500, (b) => b.buttonB.press());
    expect(long.events.map(([level]) => level)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    expect(long.events[1]![1] - long.events[0]![1]).toBeCloseTo(1000, 0);
    expect(long.events[2]![1] - long.events[1]![1]).toBeCloseTo(1000, 0);
    for (let i = 1; i <= 5; i++) expect(long.serial).toContain(`Long run ${i}`);
    expect(long.serial).not.toContain('Short run');
    expect(long.board.motor.state.running).toBe(false);
    const idle = await timeline('b59_motor_buttons', PIN.MOTOR, 500);
    expect(idle.events).toEqual([]);
    expect(idle.serial).toBe('');
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
