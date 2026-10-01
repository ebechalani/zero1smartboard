/**
 * What every example does on the virtual board, written once and checked on each of its twins
 * (docs/PYTHON.md §10.4): tests/examples.test.ts runs the table on the `.ino` sketches,
 * tests/python-examples.test.ts on the sketches made from the Python examples. Both twins must
 * pass the **same assertions** (Serial texts, pin timelines, buzzer pulses, servo targets, LCD
 * rows, 7-segment patterns), so the three copies of an example cannot drift apart (§12 R6).
 *
 * `EXAMPLE_BEHAVIOUR` has one or more checks per example id; `describeExampleBehaviour(label,
 * sourceOf)` registers every check whose example `sourceOf` knows (a twin that does not exist
 * yet is left out), grouped in the describe() blocks of `suite`.
 */
import { describe, expect, it } from 'vitest';
import { RealClock } from '../src/runtime/clock';
import { Executor } from '../src/runtime/executor';
import { transpile } from '../src/transpiler';
import type { BoardEvent } from '../src/types';
import { createZero1Board, type Zero1Board } from '../src/zero1';
import { runSketch, type RunOptions, type RunResult } from './helpers';

/** The Arduino sketch of example `id` in one twin (the `.ino` source, or the sketch made from the Python); undefined when that twin does not exist. */
export type SourceOf = (id: string) => string | undefined;

/** A finished run of an example, with every board event it caused. */
export interface ExampleRun extends RunResult {
  events: BoardEvent[];
}

/** The runners a check uses, bound to the sketches of one twin. */
export interface BehaviourKit {
  /** Runs the example on the virtual clock; fails on a console error or when it does not stop cleanly. */
  runExample(id: string, opts?: RunOptions): Promise<ExampleRun>;
  /** Runs the example on the real clock so that inputs can be changed while it runs. */
  drive(id: string, steps: (board: Zero1Board, wait: (ms: number) => Promise<void>) => Promise<void>): Promise<void>;
  /** [level, virtual ms] of every level change on `pin`, rounded to the millisecond. */
  timeline(id: string, pin: number, opts?: RunOptions): Promise<{ changes: Array<[number, number]>; r: ExampleRun }>;
  /** Durations (ms) of every HIGH pulse on the buzzer, measured on the virtual clock. */
  highPulses(id: string, opts: RunOptions): Promise<{ pulses: number[]; serial: string }>;
}

/** One check of the behaviour of an example. */
export interface ExampleBehaviour {
  /** The example (EXAMPLES / PYTHON_EXAMPLES id). */
  id: string;
  /** The describe() block the check is listed in. */
  suite: string;
  /** The test name. */
  name: string;
  check(kit: BehaviourKit): Promise<void>;
}

/** The ZERO1 pins the checks look at. */
export const PIN = { MOTOR: 14, RED: 15, GREEN: 16, BUZZER: 8, SERVO: 4 } as const;

/** Segment patterns of the digits 0..9 on the 7-segment display. */
export const DIGIT = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** One LCD row as text; characters outside printable ASCII as `<code>`. */
export function lcdRow(board: Zero1Board, row: number): string {
  return board.lcd.state.chars[row]!.map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : `<${c}>`)).join('');
}

/** The Serial Monitor text with plain newlines (Serial.println() sends CR LF). */
export const text = (r: { serial: string }): string => r.serial.replace(/\r\n/g, '\n');

/** Number of rising edges (off -> on) on `pin`. */
export function risingEdges(r: { events: BoardEvent[] }, pin: number): number {
  return r.events.filter((e) => e.type === 'digitalWrite' && e.pin === pin && e.level === 1 && e.prev === 0).length;
}

/** Every servo target in the order it was written. */
export function servoTargets(r: { events: BoardEvent[] }): number[] {
  return r.events.filter((e) => e.type === 'servo' && e.pin === PIN.SERVO).map((e) => (e as { angle: number | null }).angle ?? -1);
}

/** Releases `button` once `pin` has gone LOW `count` times (the end of a sequence of runs). */
export function releaseAfterFallingEdges(board: Zero1Board, pin: number, count: number, button: { release(): void }): void {
  let seen = 0;
  board.on((e) => {
    if (e.type === 'digitalWrite' && e.pin === pin && e.level === 0 && e.prev === 1 && ++seen === count) button.release();
  });
}

/** The runners for the sketches `sourceOf` gives. */
export function behaviourKit(sourceOf: SourceOf): BehaviourKit {
  const source = (id: string): string => {
    const sketch = sourceOf(id);
    if (sketch === undefined) throw new Error(`example ${id} not found`);
    return sketch;
  };

  const runExample = async (id: string, opts: RunOptions = {}): Promise<ExampleRun> => {
    const events: BoardEvent[] = [];
    const before = opts.before;
    const result = await runSketch(source(id), {
      ...opts,
      before: (board, clock) => {
        board.on((e) => events.push(e));
        before?.(board, clock);
      },
    });
    const errors = result.console.filter((m) => m.level === 'error');
    expect(errors, `console errors in ${id}: ${errors.map((e) => e.text).join(' | ')}`).toEqual([]);
    expect(result.status).toBe('stopped');
    return { ...result, events };
  };

  const drive: BehaviourKit['drive'] = async (id, steps) => {
    const r = transpile(source(id));
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '));
    const board = createZero1Board(new RealClock());
    const executor = new Executor({ board, lineMap: r.lineMap, onConsole: (m) => { if (m.level === 'error') throw new Error(m.text); } });
    const running = executor.run(r.js);
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const frame = setInterval(() => board.tick(board.clock.now()), 10);
    try {
      await wait(30);
      await steps(board, wait);
    } finally {
      clearInterval(frame);
      await executor.stop();
      await running;
    }
    expect(executor.status).toBe('stopped');
  };

  // Runs a sketch and collects [level, virtual ms] of every level change on `pin`, rounded to the
  // millisecond (a tick costs a few hundredths of a ms on the virtual clock).
  const timeline: BehaviourKit['timeline'] = (id, pin, opts = {}) => {
    const changes: Array<[number, number]> = [];
    const before = opts.before;
    return runExample(id, {
      ...opts,
      before: (board, clock) => {
        board.on((e) => {
          if (e.type === 'digitalWrite' && e.pin === pin && e.level !== e.prev) changes.push([e.level, Math.round(clock.now())]);
        });
        before?.(board, clock);
      },
    }).then((r) => ({ changes, r }));
  };

  const highPulses: BehaviourKit['highPulses'] = (id, opts) => {
    const pulses: number[] = [];
    let since: number | null = null;
    const before = opts.before;
    return runExample(id, {
      ...opts,
      before: (board, clock) => {
        board.on((e) => {
          if (e.type !== 'digitalWrite' || e.pin !== PIN.BUZZER) return;
          if (e.level === 1 && e.prev === 0) since = clock.now();
          if (e.level === 0 && e.prev === 1 && since !== null) {
            pulses.push(Math.round(clock.now() - since)); // ticks add hundredths of a ms, and floats drift
            since = null;
          }
        });
        before?.(board, clock);
      },
    }).then((r) => ({ pulses, serial: r.serial }));
  };

  return { runExample, drive, timeline, highPulses };
}

/** Every value the 7-segment latch held at a rising edge of the latch pin (D11). */
function latchedSequence(kit: BehaviourKit, id: string, before: (b: Zero1Board) => void, stopAfterMs: number) {
  const seen: number[] = [];
  return kit
    .runExample(id, {
      stopAfterMs,
      before: (b) => {
        before(b);
        b.on((e) => {
          if (e.type === 'digitalWrite' && e.pin === 11 && e.level === 1) seen.push(b.sevenSeg.state.latched);
        });
      },
    })
    .then((r) => ({ seen, r }));
}

const LESSONS = 'example behaviour';

/** The behaviour of every example (docs/ARCHITECTURE.md §9 and docs/PYTHON.md §9), keyed by example id. */
export const EXAMPLE_BEHAVIOUR: readonly ExampleBehaviour[] = [
  // --- The lessons (01 ... 34) -----------------------------------------------------
  {
    id: '01_blink_red',
    suite: LESSONS,
    name: '01_blink_red toggles the red LED and prints ON/OFF',
    async check({ runExample }) {
      const r = await runExample('01_blink_red', { stopAfterMs: 2100 });
      const toggles = r.events.filter((e) => e.type === 'digitalWrite' && e.pin === 15);
      expect(toggles.length).toBeGreaterThanOrEqual(3);
      expect(r.serial).toContain('ON');
      expect(r.serial).toContain('OFF');
    },
  },
  {
    id: '02_traffic_lights',
    suite: LESSONS,
    name: '02_traffic_lights alternates red and green',
    async check({ runExample }) {
      const r = await runExample('02_traffic_lights', { stopAfterMs: 4500 });
      expect(r.serial).toContain('RED');
      expect(r.serial).toContain('GREEN');
    },
  },
  {
    id: '03_buzzer_melody',
    suite: LESSONS,
    name: '03_buzzer_melody plays notes on D8',
    async check({ runExample }) {
      const r = await runExample('03_buzzer_melody', { stopAfterMs: 2000 });
      const tones = r.events.filter((e) => e.type === 'tone' && e.pin === 8 && e.freq !== null);
      expect(tones.length).toBeGreaterThanOrEqual(3);
      expect(r.serial).toContain('Playing');
    },
  },
  {
    id: '04_rgb_rainbow',
    suite: LESSONS,
    name: '04_rgb_rainbow updates the NeoPixel repeatedly',
    async check({ runExample }) {
      const r = await runExample('04_rgb_rainbow', { stopAfterMs: 500 });
      const shows = r.events.filter((e) => e.type === 'pixels' && e.pin === 9);
      expect(shows.length).toBeGreaterThanOrEqual(10);
      const { r: red, g, b } = r.board.rgb.state;
      expect(red + g + b).toBeGreaterThan(0);
    },
  },
  {
    id: '05_seven_segment_counter',
    suite: LESSONS,
    name: '05_seven_segment_counter shows successive digits',
    async check({ runExample }) {
      const seen = new Set<number>();
      const r = await runExample('05_seven_segment_counter', {
        stopAfterMs: 3500,
        before: (board) => board.on(() => seen.add(board.sevenSeg.state.latched)),
      });
      seen.add(r.board.sevenSeg.state.latched);
      expect([0x3f, 0x06, 0x5b].every((d) => seen.has(d))).toBe(true);
      expect(r.serial).toMatch(/0[\s\S]*1[\s\S]*2/);
    },
  },
  {
    id: '06_servo_sweep',
    suite: LESSONS,
    name: '06_servo_sweep moves the servo to 180 and back',
    async check({ runExample }) {
      const r = await runExample('06_servo_sweep', { stopAfterMs: 3000 });
      const angles = r.events.filter((e) => e.type === 'servo' && e.pin === 4).map((e) => (e as { angle: number | null }).angle);
      expect(Math.max(...angles.map((a) => a ?? 0))).toBe(180);
      expect(r.serial).toContain('Sweeping 0 -> 180');
      expect(r.serial).toContain('Sweeping 180 -> 0');
    },
  },
  {
    id: '07_dc_motor',
    suite: LESSONS,
    name: '07_dc_motor switches the motor on and off',
    async check({ runExample }) {
      const r = await runExample('07_dc_motor', { stopAfterMs: 4500 });
      expect(r.serial).toContain('Motor ON');
      expect(r.serial).toContain('Motor OFF');
      const writes = r.events.filter((e) => e.type === 'digitalWrite' && e.pin === 14).map((e) => (e as { level: number }).level);
      expect(writes).toContain(1);
      expect(writes).toContain(0);
    },
  },
  {
    id: '10_button_led',
    suite: LESSONS,
    name: '10_button_led lights the LEDs while the buttons are held',
    async check({ drive }) {
      await drive('10_button_led', async (board, wait) => {
        expect(board.ledRed.state.on).toBe(false);
        board.buttonA.press();
        await wait(60);
        expect(board.ledRed.state.on).toBe(true);
        expect(board.ledGreen.state.on).toBe(false);
        board.buttonA.release();
        board.buttonB.press();
        await wait(60);
        expect(board.ledRed.state.on).toBe(false);
        expect(board.ledGreen.state.on).toBe(true);
        board.buttonB.release();
      });
    },
  },
  {
    id: '11_button_toggle',
    suite: LESSONS,
    name: '11_button_toggle toggles the red LED on each press',
    async check({ drive }) {
      let out = '';
      await drive('11_button_toggle', async (board, wait) => {
        board.serial.onTx((t) => (out += t));
        board.buttonA.press();
        await wait(120);
        board.buttonA.release();
        await wait(120);
        expect(board.ledRed.state.on).toBe(true);
        board.buttonA.press();
        await wait(120);
        board.buttonA.release();
        await wait(120);
        expect(board.ledRed.state.on).toBe(false);
      });
      expect(out).toContain('Press #1 -> LED ON');
      expect(out).toContain('Press #2 -> LED OFF');
    },
  },
  {
    id: '12_potentiometer_serial',
    suite: LESSONS,
    name: '12_potentiometer_serial prints value, voltage and percent',
    async check({ runExample }) {
      const r = await runExample('12_potentiometer_serial', { stopAfterMs: 500 });
      expect(r.serial).toContain('Value: 512');
      expect(r.serial).toContain('2.50 V');
      expect(r.serial).toContain('50 %');
      const r2 = await runExample('12_potentiometer_serial', { stopAfterMs: 500, before: (b) => b.potLdr.setPot(1023) });
      expect(r2.serial).toContain('Value: 1023');
      expect(r2.serial).toContain('5.00 V');
    },
  },
  {
    id: '13_ldr_night_light',
    suite: LESSONS,
    name: '13_ldr_night_light reacts to the light level',
    async check({ runExample }) {
      const bright = await runExample('13_ldr_night_light', { stopAfterMs: 500, before: (b) => b.potLdr.setSource('ldr') });
      expect(bright.serial).toContain('Light: 580');
      expect(bright.serial).toContain('bright, light OFF');
      expect(bright.board.ledRed.state.on).toBe(false);
      const dark = await runExample('13_ldr_night_light', {
        stopAfterMs: 500,
        before: (b) => {
          b.potLdr.setSource('ldr');
          b.potLdr.setLight(20);
        },
      });
      expect(dark.serial).toContain('dark, light ON');
      expect(dark.board.ledRed.state.on).toBe(true);
    },
  },
  {
    id: '14_dht22_serial',
    suite: LESSONS,
    name: '14_dht22_serial prints temperature and humidity, and an error when unplugged',
    async check({ runExample }) {
      const r = await runExample('14_dht22_serial', { stopAfterMs: 2500 });
      expect(r.serial).toContain('Temperature: 24.0 C');
      expect(r.serial).toContain('Humidity: 55.0 %');
      const unplugged = await runExample('14_dht22_serial', { stopAfterMs: 2500, before: (b) => b.dht.setConnected(false) });
      expect(unplugged.serial).toContain('Error: no answer from the DHT22');
    },
  },
  {
    id: '15_ultrasonic_distance',
    suite: LESSONS,
    name: '15_ultrasonic_distance measures 50 cm and reports a missing echo',
    async check({ runExample }) {
      const r = await runExample('15_ultrasonic_distance', { stopAfterMs: 1200 });
      expect(r.serial).toContain('Distance: 49.7 cm');
      const unplugged = await runExample('15_ultrasonic_distance', { stopAfterMs: 3000, before: (b) => b.ultrasonic.setConnected(false) });
      expect(unplugged.serial).toContain('No echo');
    },
  },
  {
    id: '16_serial_echo',
    suite: LESSONS,
    name: '16_serial_echo reacts to commands typed in the Serial Monitor',
    async check({ runExample }) {
      const r = await runExample('16_serial_echo', { stopAfterMs: 1500, before: (b) => b.serial.inject('on\n') });
      expect(r.serial).toContain("Type 'on' or 'off'");
      expect(r.serial).toContain('You typed: on');
      expect(r.serial).toContain('Red LED is ON');
      expect(r.board.ledRed.state.on).toBe(true);
      const unknown = await runExample('16_serial_echo', { stopAfterMs: 1500, before: (b) => b.serial.inject('hello\n') });
      expect(unknown.serial).toContain('Unknown command');
    },
  },
  {
    id: '20_lcd_hello',
    suite: LESSONS,
    name: '20_lcd_hello writes both rows and turns the backlight on',
    async check({ runExample }) {
      const r = await runExample('20_lcd_hello', { stopAfterMs: 2500 });
      expect(lcdRow(r.board, 0)).toMatch(/^Hello, ZERO1!/);
      expect(lcdRow(r.board, 1)).toMatch(/^Time: [12] s/);
      expect(r.board.lcd.state.backlight).toBe(true);
    },
  },
  {
    id: '21_lcd_custom_char',
    suite: LESSONS,
    name: '21_lcd_custom_char shows the temperature with a degree glyph and a heart',
    async check({ runExample }) {
      const r = await runExample('21_lcd_custom_char', { stopAfterMs: 2500 });
      // The degree sign is either a custom glyph (codes 0..7) or the HD44780 ROM character 0xDF (223).
      expect(lcdRow(r.board, 0)).toMatch(/^Temp: 24\.0<(\d|223)>C/);
      expect(lcdRow(r.board, 1)).toMatch(/^I <\d> ZERO1/);
      expect(r.board.lcd.state.customChars.some((glyph) => glyph.some((row) => row !== 0))).toBe(true);
    },
  },
  {
    id: '30_parking_sensor',
    suite: LESSONS,
    name: '30_parking_sensor picks the zone from the distance',
    async check({ runExample }) {
      const mid = await runExample('30_parking_sensor', { stopAfterMs: 1200 });
      expect(mid.serial).toContain('beep every 380 ms');
      const { r, g, b } = mid.board.rgb.state;
      expect(r).toBeGreaterThan(0);
      expect(b).toBe(0);
      expect(g).toBeGreaterThan(0);
      const far = await runExample('30_parking_sensor', { stopAfterMs: 1200, before: (bd) => bd.ultrasonic.setDistance(200) });
      expect(far.board.rgb.state.g).toBeGreaterThan(far.board.rgb.state.r);
      expect(far.board.buzzer.state.freq).toBeNull();
      const near = await runExample('30_parking_sensor', { stopAfterMs: 1200, before: (bd) => bd.ultrasonic.setDistance(10) });
      expect(near.board.rgb.state.r).toBeGreaterThan(near.board.rgb.state.g);
      expect(near.board.buzzer.state.freq).toBe(2000);
    },
  },
  {
    id: '31_greenhouse',
    suite: LESSONS,
    name: '31_greenhouse drives the fan from the temperature',
    async check({ runExample }) {
      const ok = await runExample('31_greenhouse', { stopAfterMs: 2500 });
      expect(lcdRow(ok.board, 0)).toMatch(/^T:24\.0C H:55%/);
      expect(lcdRow(ok.board, 1)).toMatch(/^OK: fan OFF/);
      expect(ok.board.motor.state.running).toBe(false);
      expect(ok.serial).toContain('fan=OFF');
      const warm = await runExample('31_greenhouse', { stopAfterMs: 2500, before: (b) => b.dht.set(31, 55) });
      expect(lcdRow(warm.board, 1)).toMatch(/^Warm: fan ON/);
      expect(warm.board.motor.state.running).toBe(true);
      const hot = await runExample('31_greenhouse', { stopAfterMs: 3000, before: (b) => b.dht.set(38, 55) });
      expect(lcdRow(hot.board, 1)).toMatch(/^TOO HOT! Fan ON/);
      const blinks = hot.events.filter((e) => e.type === 'digitalWrite' && e.pin === 15);
      expect(blinks.length).toBeGreaterThanOrEqual(2);
    },
  },
  {
    id: '32_reaction_game',
    suite: LESSONS,
    name: '32_reaction_game waits for Button 1',
    async check({ runExample }) {
      const r = await runExample('32_reaction_game', { stopAfterMs: 1000 });
      expect(r.serial).toContain('Press Button 1 to start');
      expect(r.board.sevenSeg.state.latched).toBe(0);
    },
  },
  {
    id: '33_dimmer',
    suite: LESSONS,
    name: '33_dimmer maps the knob to the servo, the LED and the display',
    async check({ runExample }) {
      const r = await runExample('33_dimmer', { stopAfterMs: 600 });
      expect(r.serial).toContain('Pot: 512  Servo: 90 deg  Brightness: 127  Level: 4');
      expect(r.board.servo.state.target).toBe(90);
      expect(r.board.sevenSeg.state.latched).toBe(0x66);
      expect(r.board.rgb.state.r).toBeGreaterThan(0);
    },
  },
  {
    id: '34_i2c_scanner',
    suite: LESSONS,
    name: '34_i2c_scanner finds the LCD at 0x27',
    async check({ runExample }) {
      const r = await runExample('34_i2c_scanner', { stopAfterMs: 3000 });
      expect(r.serial.toLowerCase()).toContain('0x27');
      const moved = await runExample('34_i2c_scanner', { stopAfterMs: 3000, config: { lcdAddress: 0x3f } });
      expect(moved.serial.toLowerCase()).toContain('0x3f');
      expect(moved.serial.toLowerCase()).not.toContain('0x27');
    },
  },

  // --- Part-by-part groups (40 ... 59) --------------------------------------------
  {
    id: '40_led_blink_red',
    suite: 'LED examples',
    name: '40_led_blink_red blinks with a 500 ms on / 500 ms off rhythm',
    async check({ timeline }) {
      const { changes } = await timeline('40_led_blink_red', PIN.RED, { stopAfterMs: 1800 });
      expect(changes.slice(0, 4)).toEqual([[1, 0], [0, 500], [1, 1000], [0, 1500]]);
    },
  },
  {
    id: '41_led_red_green',
    suite: 'LED examples',
    name: '41_led_red_green alternates the two LEDs every 500 ms and never lights both',
    async check({ timeline }) {
      const seen: string[] = [];
      const red = await timeline('41_led_red_green', PIN.RED, {
        stopAfterMs: 2200,
        before: (b) => b.on((e) => e.type === 'digitalWrite' && (e.pin === PIN.RED || e.pin === PIN.GREEN) && seen.push(`${b.ledRed.state.on ? 'R' : '-'}${b.ledGreen.state.on ? 'G' : '-'}`)),
      });
      expect(red.changes.slice(0, 4)).toEqual([[1, 0], [0, 500], [1, 1000], [0, 1500]]);
      expect(seen).toContain('R-');
      expect(seen).toContain('-G');
      expect(seen).not.toContain('RG');
      const green = await timeline('41_led_red_green', PIN.GREEN, { stopAfterMs: 2200 });
      expect(green.changes.slice(0, 4)).toEqual([[1, 500], [0, 1000], [1, 1500], [0, 2000]]);
    },
  },
  {
    id: '42_led_blink_10_times',
    suite: 'LED examples',
    name: '42_led_blink_10_times blinks exactly 10 times (300 ms / 300 ms) and stops',
    async check({ timeline }) {
      const { changes, r } = await timeline('42_led_blink_10_times', PIN.RED, { stopAfterMs: 8000 });
      expect(risingEdges(r, PIN.RED)).toBe(10);
      expect(changes).toHaveLength(20);
      expect(changes.slice(0, 4)).toEqual([[1, 0], [0, 300], [1, 600], [0, 900]]);
      expect(r.board.ledRed.state.on).toBe(false);
      expect(text(r)).toContain('Blink 1\n');
      expect(text(r)).toContain('Blink 10\nDone');
    },
  },
  {
    id: '43_buzzer_short_beeps',
    suite: 'Buzzer examples',
    name: '43_buzzer_short_beeps gives 100 ms beeps with 400 ms pauses, forever',
    async check({ highPulses, timeline }) {
      const { pulses } = await highPulses('43_buzzer_short_beeps', { stopAfterMs: 2100 });
      expect(pulses.length).toBeGreaterThanOrEqual(4); // 0, 500, 1000, 1500, 2000 ms
      expect(pulses.every((p) => p === 100)).toBe(true);
      const { changes } = await timeline('43_buzzer_short_beeps', PIN.BUZZER, { stopAfterMs: 1100 });
      expect(changes.slice(0, 4)).toEqual([[1, 0], [0, 100], [1, 500], [0, 600]]);
    },
  },
  {
    id: '44_buzzer_led_10_times',
    suite: 'Buzzer examples',
    name: '44_buzzer_led_10_times switches the LED and the buzzer together, exactly 10 times',
    async check({ timeline }) {
      const { changes, r } = await timeline('44_buzzer_led_10_times', PIN.BUZZER, { stopAfterMs: 6000 });
      expect(risingEdges(r, PIN.BUZZER)).toBe(10);
      expect(risingEdges(r, PIN.RED)).toBe(10);
      expect(changes.slice(0, 4)).toEqual([[1, 0], [0, 200], [1, 500], [0, 700]]);
      expect(r.board.ledRed.state.on).toBe(false);
      expect(r.board.buzzer.state.freq).toBeNull();
      expect(text(r)).toBe('Done\n');
    },
  },
  {
    id: '45_buttons_leds',
    suite: 'Push Button examples',
    name: '45_buttons_leds lights the red LED for Button 1 and the green LED for Button 2',
    async check({ runExample, drive }) {
      const idle = await runExample('45_buttons_leds', { stopAfterMs: 200 });
      expect(idle.board.ledRed.state.on).toBe(false);
      expect(idle.board.ledGreen.state.on).toBe(false);
      const a = await runExample('45_buttons_leds', { stopAfterMs: 200, before: (b) => b.buttonA.press() });
      expect(a.board.ledRed.state.on).toBe(true);
      expect(a.board.ledGreen.state.on).toBe(false);
      const b = await runExample('45_buttons_leds', { stopAfterMs: 200, before: (bd) => bd.buttonB.press() });
      expect(b.board.ledRed.state.on).toBe(false);
      expect(b.board.ledGreen.state.on).toBe(true);
      const both = await runExample('45_buttons_leds', { stopAfterMs: 200, before: (bd) => { bd.buttonA.press(); bd.buttonB.press(); } });
      expect(both.board.ledRed.state.on).toBe(true);
      expect(both.board.ledGreen.state.on).toBe(true);
      // Released: the LED goes off again (real clock, so the button can be released while it runs).
      await drive('45_buttons_leds', async (board, wait) => {
        board.buttonA.press();
        await wait(60);
        expect(board.ledRed.state.on).toBe(true);
        board.buttonA.release();
        await wait(60);
        expect(board.ledRed.state.on).toBe(false);
      });
    },
  },
  {
    id: '46_buttons_beeps',
    suite: 'Push Button examples',
    name: '46_buttons_beeps gives one 100 ms beep per press of Button 1 and one 1 s beep per press of Button 2',
    async check({ highPulses, drive }) {
      const quiet = await highPulses('46_buttons_beeps', { stopAfterMs: 500 });
      expect(quiet.pulses).toEqual([]);
      // Held down for the whole run: still exactly one beep.
      const a = await highPulses('46_buttons_beeps', { stopAfterMs: 1500, before: (b) => b.buttonA.press() });
      expect(a.pulses).toEqual([100]);
      const b = await highPulses('46_buttons_beeps', { stopAfterMs: 3000, before: (bd) => bd.buttonB.press() });
      expect(b.pulses).toEqual([1000]);
      // Release and press again: one more beep each time (real clock, so the button can be released).
      let beeps = 0;
      await drive('46_buttons_beeps', async (board, wait) => {
        board.on((e) => {
          if (e.type === 'digitalWrite' && e.pin === PIN.BUZZER && e.level === 1 && e.prev === 0) beeps++;
        });
        board.buttonA.press();
        await wait(150);
        board.buttonA.release();
        await wait(60);
        expect(beeps).toBe(1);
        board.buttonA.press();
        await wait(150);
        board.buttonA.release();
        await wait(60);
        expect(beeps).toBe(2);
      });
    },
  },
  {
    id: '47_rgb_red_green_blue',
    suite: 'RGB LED examples',
    name: '47_rgb_red_green_blue cycles red, green, blue every second',
    async check({ runExample }) {
      const colours: Array<[string, number]> = [];
      await runExample('47_rgb_red_green_blue', {
        stopAfterMs: 3200,
        before: (b, clock) => b.on((e) => e.type === 'pixels' && colours.push([`${b.rgb.state.r},${b.rgb.state.g},${b.rgb.state.b}`, Math.round(clock.now())])),
      });
      // setBrightness(80) scales 255 down to 80
      expect(colours.slice(0, 4)).toEqual([['80,0,0', 0], ['0,80,0', 1000], ['0,0,80', 2000], ['80,0,0', 3000]]);
    },
  },
  {
    id: '48_rgb_buttons',
    suite: 'RGB LED examples',
    name: '48_rgb_buttons shows red for Button 1, green for Button 2, off otherwise',
    async check({ runExample }) {
      const idle = await runExample('48_rgb_buttons', { stopAfterMs: 200 });
      expect([idle.board.rgb.state.r, idle.board.rgb.state.g, idle.board.rgb.state.b]).toEqual([0, 0, 0]);
      const a = await runExample('48_rgb_buttons', { stopAfterMs: 200, before: (b) => b.buttonA.press() });
      expect(a.board.rgb.state.r).toBeGreaterThan(0);
      expect(a.board.rgb.state.g).toBe(0);
      const b = await runExample('48_rgb_buttons', { stopAfterMs: 200, before: (bd) => bd.buttonB.press() });
      expect(b.board.rgb.state.g).toBeGreaterThan(0);
      expect(b.board.rgb.state.r).toBe(0);
      const both = await runExample('48_rgb_buttons', { stopAfterMs: 200, before: (bd) => { bd.buttonA.press(); bd.buttonB.press(); } });
      expect(both.board.rgb.state.r).toBeGreaterThan(0); // Button 1 wins
      expect(both.board.rgb.state.g).toBe(0);
    },
  },
  {
    id: '49_ldr_serial',
    suite: 'LDR examples',
    name: '49_ldr_serial prints the light value every 500 ms',
    async check({ runExample }) {
      const r = await runExample('49_ldr_serial', { stopAfterMs: 1600, before: (b) => b.potLdr.setSource('ldr') });
      expect(text(r).split('\n').filter((l) => l === 'Light: 580')).toHaveLength(4); // 0, 500, 1000, 1500 ms
      const dark = await runExample('49_ldr_serial', { stopAfterMs: 300, before: (b) => { b.potLdr.setSource('ldr'); b.potLdr.setLight(0); } });
      expect(text(dark)).toContain('Light: 40\n');
    },
  },
  {
    id: '50_ldr_red_green',
    suite: 'LDR examples',
    name: '50_ldr_red_green lights red below 500 and green at 500 or above',
    async check({ runExample }) {
      const bright = await runExample('50_ldr_red_green', { stopAfterMs: 600, before: (b) => b.potLdr.setSource('ldr') });
      expect(text(bright)).toContain('Light: 580 -> bright');
      expect(bright.board.ledGreen.state.on).toBe(true);
      expect(bright.board.ledRed.state.on).toBe(false);
      const dark = await runExample('50_ldr_red_green', { stopAfterMs: 600, before: (b) => { b.potLdr.setSource('ldr'); b.potLdr.setLight(20); } });
      expect(text(dark)).toContain('Light: 220 -> dark');
      expect(dark.board.ledRed.state.on).toBe(true);
      expect(dark.board.ledGreen.state.on).toBe(false);
    },
  },
  {
    id: '51_seg_buttons_count',
    suite: 'Seven-Segment examples',
    name: '51_seg_buttons_count stays blank, counts 1..4 on Button 1 and 7..1 on Button 2',
    async check(kit) {
      const idle = await latchedSequence(kit, '51_seg_buttons_count', () => {}, 500);
      expect(idle.seen).toEqual([0]);
      const up = await latchedSequence(kit, '51_seg_buttons_count', (b) => b.buttonA.press(), 4500);
      expect(up.seen.slice(0, 6)).toEqual([0, DIGIT[1], DIGIT[2], DIGIT[3], DIGIT[4], 0]);
      expect(text(up.r)).toMatch(/^1\n2\n3\n4\n/);
      const down = await latchedSequence(kit, '51_seg_buttons_count', (b) => b.buttonB.press(), 7500);
      expect(down.seen.slice(0, 9)).toEqual([0, DIGIT[7], DIGIT[6], DIGIT[5], DIGIT[4], DIGIT[3], DIGIT[2], DIGIT[1], 0]);
      expect(text(down.r)).toMatch(/^7\n6\n5\n4\n3\n2\n1\n/);
    },
  },
  {
    id: '52_ultrasonic_serial',
    suite: 'Ultrasonic examples',
    name: '52_ultrasonic_serial prints the distance every 500 ms and follows the slider',
    async check({ runExample }) {
      const r = await runExample('52_ultrasonic_serial', { stopAfterMs: 1600 });
      expect(text(r).split('\n').filter((l) => l === 'Distance: 49.7 cm')).toHaveLength(4); // 0, 500, 1000, 1500 ms
      const near = await runExample('52_ultrasonic_serial', { stopAfterMs: 100, before: (b) => b.ultrasonic.setDistance(20) });
      expect(text(near)).toMatch(/Distance: (19|20)\.\d cm/);
    },
  },
  {
    id: '53_ultrasonic_red_green',
    suite: 'Ultrasonic examples',
    name: '53_ultrasonic_red_green lights green at 10 cm or more and red under 10 cm',
    async check({ runExample }) {
      const far = await runExample('53_ultrasonic_red_green', { stopAfterMs: 300 });
      expect(far.board.ledGreen.state.on).toBe(true);
      expect(far.board.ledRed.state.on).toBe(false);
      expect(text(far)).toContain('Distance: 49.7 cm -> free\n');
      const near = await runExample('53_ultrasonic_red_green', { stopAfterMs: 300, before: (b) => b.ultrasonic.setDistance(5) });
      expect(near.board.ledRed.state.on).toBe(true);
      expect(near.board.ledGreen.state.on).toBe(false);
      expect(text(near)).toContain('-> too close!');
    },
  },
  {
    id: '54_ultrasonic_beep_rate',
    suite: 'Ultrasonic examples',
    name: '54_ultrasonic_beep_rate pauses 10 ms per centimetre (50 ... 1000 ms) between 50 ms beeps',
    async check({ runExample, highPulses }) {
      const far = await runExample('54_ultrasonic_beep_rate', { stopAfterMs: 3000 });
      expect(text(far)).toContain('Distance: 49.7 cm -> pause 497 ms');
      const farBeeps = risingEdges(far, PIN.BUZZER);
      expect(farBeeps).toBeGreaterThanOrEqual(5); // 3000 / 547
      const { pulses } = await highPulses('54_ultrasonic_beep_rate', { stopAfterMs: 3000 });
      expect(pulses.length).toBeGreaterThanOrEqual(5);
      expect(pulses.every((p) => p === 50)).toBe(true);
      const mid = await runExample('54_ultrasonic_beep_rate', { stopAfterMs: 500, before: (b) => b.ultrasonic.setDistance(20) });
      expect(text(mid)).toMatch(/-> pause (19\d|200) ms/);
      const near = await runExample('54_ultrasonic_beep_rate', { stopAfterMs: 3000, before: (b) => b.ultrasonic.setDistance(5) });
      expect(text(near)).toContain('pause 50 ms');
      expect(risingEdges(near, PIN.BUZZER)).toBeGreaterThan(farBeeps * 3);
      const veryFar = await runExample('54_ultrasonic_beep_rate', { stopAfterMs: 500, before: (b) => b.ultrasonic.setDistance(200) });
      expect(text(veryFar)).toContain('pause 1000 ms');
      const none = await runExample('54_ultrasonic_beep_rate', { stopAfterMs: 1500, before: (b) => b.ultrasonic.setConnected(false) });
      expect(text(none)).toContain('No echo');
      expect(risingEdges(none, PIN.BUZZER)).toBe(0);
    },
  },
  {
    id: '55_servo_buttons',
    suite: 'Servo Motor examples',
    name: '55_servo_buttons starts at 0, Button 2 -> 90 and Button 1 -> 0, printing the angle',
    async check({ runExample, drive }) {
      const idle = await runExample('55_servo_buttons', { stopAfterMs: 300 });
      expect(idle.board.servo.state.target).toBe(0);
      expect(text(idle)).toBe('');
      // A button held for the whole run: one move and one line only (waits for the release).
      const b = await runExample('55_servo_buttons', { stopAfterMs: 1000, before: (bd) => bd.buttonB.press() });
      expect(b.board.servo.state.target).toBe(90);
      expect(text(b)).toBe('Servo -> 90\n');
      const a = await runExample('55_servo_buttons', { stopAfterMs: 1000, before: (bd) => bd.buttonA.press() });
      expect(a.board.servo.state.target).toBe(0);
      expect(text(a)).toBe('Servo -> 0\n');
      // Button 2, then Button 1 (real clock): to 90 and back to 0.
      await drive('55_servo_buttons', async (board, wait) => {
        board.buttonB.press();
        await wait(60);
        board.buttonB.release();
        expect(board.servo.state.target).toBe(90);
        await wait(350);
        board.buttonA.press();
        await wait(60);
        board.buttonA.release();
        expect(board.servo.state.target).toBe(0);
      });
    },
  },
  {
    id: '56_servo_ultrasonic_10_times',
    suite: 'Servo Motor examples',
    name: '56_servo_ultrasonic_10_times checks the distance 10 times, one second apart, then rests at 0',
    async check({ runExample }) {
      const far = await runExample('56_servo_ultrasonic_10_times', { stopAfterMs: 11000 });
      expect(text(far).match(/-> servo 0\n/g)).toHaveLength(10);
      expect(text(far)).toContain('Round 1: 49.7 cm -> servo 0\n');
      expect(text(far)).toContain('Round 10: 49.7 cm -> servo 0\nDone');
      expect(far.board.servo.state.target).toBe(0);
      const near = await runExample('56_servo_ultrasonic_10_times', { stopAfterMs: 11000, before: (b) => b.ultrasonic.setDistance(5) });
      expect(text(near).match(/-> servo 180\n/g)).toHaveLength(10);
      expect(servoTargets(near).filter((a) => a === 180)).toHaveLength(10);
      expect(text(near)).toContain('Done');
      expect(near.board.servo.state.target).toBe(0); // back to the rest position
    },
  },
  {
    id: '57_dht_serial',
    suite: 'DHT Sensor examples',
    name: '57_dht_serial prints the temperature and the humidity on one line every 2 s',
    async check({ runExample }) {
      // Each finished line with the virtual time it was printed at (the deadline
      // is only checked at ticks, so a plain line count would include the line
      // printed right after the delay() that crosses it).
      const lines: Array<[string, number]> = [];
      let pending = '';
      await runExample('57_dht_serial', {
        stopAfterMs: 3900,
        before: (b, clock) => b.serial.onTx((chunk) => {
          pending += chunk;
          if (pending.endsWith('\n')) {
            lines.push([pending.replace(/\r\n/g, '\n'), Math.round(clock.now())]);
            pending = '';
          }
        }),
      });
      expect(lines).toEqual([['Temperature: 24.0 C  Humidity: 55.0 %\n', 2000], ['Temperature: 24.0 C  Humidity: 55.0 %\n', 4000]]);
      const hot = await runExample('57_dht_serial', { stopAfterMs: 2500, before: (b) => b.dht.set(31.5, 70) });
      expect(text(hot)).toContain('Temperature: 31.5 C  Humidity: 70.0 %\n');
      const unplugged = await runExample('57_dht_serial', { stopAfterMs: 2500, before: (b) => b.dht.setConnected(false) });
      expect(text(unplugged)).toContain('DHT22 error');
    },
  },
  {
    id: '58_dht_servo_slow',
    suite: 'DHT Sensor examples',
    name: '58_dht_servo_slow sweeps the servo 0..180 one degree every 15 ms above 28 C, else rests at 0',
    async check({ runExample }) {
      const cool = await runExample('58_dht_servo_slow', { stopAfterMs: 2500 });
      expect(text(cool)).toContain('Temperature: 24.0 C\nOK: closed');
      expect(cool.board.servo.state.target).toBe(0);
      const stamps: Array<[number, number]> = [];
      const warm = await runExample('58_dht_servo_slow', {
        stopAfterMs: 6000,
        before: (b, clock) => {
          b.dht.set(30, 55);
          b.on((e) => e.type === 'servo' && e.pin === PIN.SERVO && stamps.push([(e as { angle: number | null }).angle ?? -1, clock.now()]));
        },
      });
      expect(text(warm)).toContain('Temperature: 30.0 C\nToo warm: opening');
      const targets = servoTargets(warm);
      const sweep = targets.slice(targets.indexOf(1), targets.indexOf(1) + 180);
      expect(sweep).toEqual(Array.from({ length: 180 }, (_, i) => i + 1)); // one write per degree, 1 .. 180
      const first = stamps.findIndex(([angle]) => angle === 1);
      expect(Math.round(stamps[first + 1]![1] - stamps[first]![1])).toBe(15);
      const turn = stamps[first + 179]![1] - stamps[first]![1]; // 2.7 s for the whole turn (ticks add hundredths of a ms)
      expect(turn).toBeGreaterThanOrEqual(179 * 15);
      expect(turn).toBeLessThan(179 * 15 + 10);
      expect(warm.board.servo.state.target).toBe(180); // the turn (2000 .. 4715 ms) is over, the next reading is at 6715 ms
      // Still warm at the next reading (6715 ms): the servo turns slowly again, from 0 (stop half-way through that turn).
      const twice = await runExample('58_dht_servo_slow', { stopAfterMs: 8000, before: (b) => b.dht.set(30, 55) });
      expect(text(twice).match(/Too warm: opening\n/g)).toHaveLength(2);
      expect(servoTargets(twice).filter((a) => a === 180)).toHaveLength(1); // the first turn finished ...
      expect(servoTargets(twice).filter((a) => a === 0)).toHaveLength(3); // ... setup() and the start of each turn
      expect(twice.board.servo.state.target).toBeGreaterThan(0);
      expect(twice.board.servo.state.target).toBeLessThan(180); // ... and the second one is under way
      // Cooling down closes the window at once.
      const cooled = await runExample('58_dht_servo_slow', {
        stopAfterMs: 7000,
        before: (b) => {
          b.dht.set(30, 55);
          let lines = 0;
          b.serial.onTx((chunk) => { if (chunk.includes('\n') && ++lines === 2) b.dht.set(24, 55); }); // after "Too warm: opening"
        },
      });
      expect(text(cooled)).toContain('Too warm: opening\nTemperature: 24.0 C\nOK: closed');
      expect(cooled.board.servo.state.target).toBe(0);
    },
  },
  {
    id: '59_motor_buttons',
    suite: 'DC Motor examples',
    name: '59_motor_buttons runs the motor 5 times: short runs for Button 1, long runs for Button 2',
    async check({ runExample, timeline }) {
      const idle = await runExample('59_motor_buttons', { stopAfterMs: 500 });
      expect(risingEdges(idle, PIN.MOTOR)).toBe(0);
      expect(text(idle)).toBe('');
      const short = await timeline('59_motor_buttons', PIN.MOTOR, {
        stopAfterMs: 7000,
        before: (b) => { b.buttonA.press(); releaseAfterFallingEdges(b, PIN.MOTOR, 5, b.buttonA); },
      });
      expect(short.changes).toEqual([[1, 0], [0, 500], [1, 1000], [0, 1500], [1, 2000], [0, 2500], [1, 3000], [0, 3500], [1, 4000], [0, 4500]]);
      expect(text(short.r)).toBe('Short run 1\nShort run 2\nShort run 3\nShort run 4\nShort run 5\nDone\n');
      expect(short.r.board.motor.state.running).toBe(false);
      const long = await timeline('59_motor_buttons', PIN.MOTOR, {
        stopAfterMs: 12000,
        before: (b) => { b.buttonB.press(); releaseAfterFallingEdges(b, PIN.MOTOR, 5, b.buttonB); },
      });
      expect(long.changes).toEqual([[1, 0], [0, 1000], [1, 2000], [0, 3000], [1, 4000], [0, 5000], [1, 6000], [0, 7000], [1, 8000], [0, 9000]]);
      expect(text(long.r)).toBe('Long run 1\nLong run 2\nLong run 3\nLong run 4\nLong run 5\nDone\n');
      expect(long.r.board.motor.state.running).toBe(false);
    },
  },
];

/**
 * Registers every check of EXAMPLE_BEHAVIOUR whose example `sourceOf` knows, in a describe() block
 * named `label` with the table's suites inside it. The `.ino` twins and the Python twins call it
 * with their own sketches, so both pass the same assertions.
 */
export function describeExampleBehaviour(label: string, sourceOf: SourceOf): void {
  const kit = behaviourKit(sourceOf);
  const known = EXAMPLE_BEHAVIOUR.filter((b) => sourceOf(b.id) !== undefined);
  describe(label, () => {
    for (const suite of [...new Set(known.map((b) => b.suite))]) {
      describe(suite, () => {
        for (const b of known.filter((x) => x.suite === suite)) it(b.name, () => b.check(kit));
      });
    }
  });
}
