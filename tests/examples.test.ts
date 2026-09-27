import { describe, expect, it } from 'vitest';
import { EXAMPLES, EXAMPLE_GROUPS } from '../src/examples';
import { RealClock } from '../src/runtime/clock';
import { Executor } from '../src/runtime/executor';
import { transpile } from '../src/transpiler';
import type { BoardEvent } from '../src/types';
import { createZero1Board, type Zero1Board } from '../src/zero1';
import { runSketch, type RunOptions } from './helpers';

function source(id: string): string {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error(`example ${id} not found`);
  return ex.source;
}

function lcdRow(board: Zero1Board, row: number): string {
  return board.lcd.state.chars[row]!.map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : `<${c}>`)).join('');
}

async function runExample(id: string, opts: RunOptions = {}) {
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
}

/** Run a sketch on the real clock so that inputs can be changed while it runs. */
async function drive(id: string, steps: (board: Zero1Board, wait: (ms: number) => Promise<void>) => Promise<void>): Promise<void> {
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
}

describe('example manifest', () => {
  it('lists 48 sketches with unique ids and non-empty sources', () => {
    expect(EXAMPLES).toHaveLength(48);
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(48);
    for (const e of EXAMPLES) {
      expect(e.source.length).toBeGreaterThan(100);
      expect(e.title.length).toBeGreaterThan(3);
      expect(EXAMPLE_GROUPS).toContain(e.group);
    }
  });

  it('keeps the lesson groups first and the part-by-part groups after them, in menu order', () => {
    expect(EXAMPLE_GROUPS).toEqual([
      'Outputs', 'Inputs', 'Display', 'Projects',
      'LED', 'Buzzer', 'Push Button', 'RGB LED', 'LDR', 'Seven-Segment', 'Ultrasonic', 'Servo Motor', 'DHT Sensor', 'DC Motor',
    ]);
    // The examples are listed group by group, in that order.
    const order = EXAMPLES.map((e) => EXAMPLE_GROUPS.indexOf(e.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(EXAMPLES.filter((e) => e.group === 'LED').map((e) => e.id)).toEqual(['40_led_blink_red', '41_led_red_green', '42_led_blink_10_times']);
    expect(EXAMPLES.filter((e) => e.group === 'DC Motor')).toHaveLength(2);
  });

  it('LDR sketches tell the student to flip the POT / LDR switch', () => {
    for (const e of EXAMPLES.filter((x) => x.group === 'LDR')) {
      expect(e.source, e.id).toMatch(/POT \/ LDR/);
    }
  });
});

describe('every example transpiles and runs without errors', () => {
  for (const ex of EXAMPLES) {
    it(ex.id, async () => {
      const r = transpile(ex.source);
      if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join('; '));
      // Some sketches spend more than 4 s inside one loop() call (a melody, a
      // 0-9 count), so only the clean stop matters here, not the loop count.
      await runExample(ex.id, { stopAfterMs: 4000 });
    });
  }
});

describe('example behaviour', () => {
  it('01_blink_red toggles the red LED and prints ON/OFF', async () => {
    const r = await runExample('01_blink_red', { stopAfterMs: 2100 });
    const toggles = r.events.filter((e) => e.type === 'digitalWrite' && e.pin === 15);
    expect(toggles.length).toBeGreaterThanOrEqual(3);
    expect(r.serial).toContain('ON');
    expect(r.serial).toContain('OFF');
  });

  it('02_traffic_lights alternates red and green', async () => {
    const r = await runExample('02_traffic_lights', { stopAfterMs: 4500 });
    expect(r.serial).toContain('RED');
    expect(r.serial).toContain('GREEN');
  });

  it('03_buzzer_melody plays notes on D8', async () => {
    const r = await runExample('03_buzzer_melody', { stopAfterMs: 2000 });
    const tones = r.events.filter((e) => e.type === 'tone' && e.pin === 8 && e.freq !== null);
    expect(tones.length).toBeGreaterThanOrEqual(3);
    expect(r.serial).toContain('Playing');
  });

  it('04_rgb_rainbow updates the NeoPixel repeatedly', async () => {
    const r = await runExample('04_rgb_rainbow', { stopAfterMs: 500 });
    const shows = r.events.filter((e) => e.type === 'pixels' && e.pin === 9);
    expect(shows.length).toBeGreaterThanOrEqual(10);
    const { r: red, g, b } = r.board.rgb.state;
    expect(red + g + b).toBeGreaterThan(0);
  });

  it('05_seven_segment_counter shows successive digits', async () => {
    const seen = new Set<number>();
    const r = await runExample('05_seven_segment_counter', {
      stopAfterMs: 3500,
      before: (board) => board.on(() => seen.add(board.sevenSeg.state.latched)),
    });
    seen.add(r.board.sevenSeg.state.latched);
    expect([0x3f, 0x06, 0x5b].every((d) => seen.has(d))).toBe(true);
    expect(r.serial).toMatch(/0[\s\S]*1[\s\S]*2/);
  });

  it('06_servo_sweep moves the servo to 180 and back', async () => {
    const r = await runExample('06_servo_sweep', { stopAfterMs: 3000 });
    const angles = r.events.filter((e) => e.type === 'servo' && e.pin === 4).map((e) => (e as { angle: number | null }).angle);
    expect(Math.max(...angles.map((a) => a ?? 0))).toBe(180);
    expect(r.serial).toContain('Sweeping 0 -> 180');
    expect(r.serial).toContain('Sweeping 180 -> 0');
  });

  it('07_dc_motor switches the motor on and off', async () => {
    const r = await runExample('07_dc_motor', { stopAfterMs: 4500 });
    expect(r.serial).toContain('Motor ON');
    expect(r.serial).toContain('Motor OFF');
    const writes = r.events.filter((e) => e.type === 'digitalWrite' && e.pin === 14).map((e) => (e as { level: number }).level);
    expect(writes).toContain(1);
    expect(writes).toContain(0);
  });

  it('10_button_led lights the LEDs while the buttons are held', async () => {
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
  });

  it('11_button_toggle toggles the red LED on each press', async () => {
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
  });

  it('12_potentiometer_serial prints value, voltage and percent', async () => {
    const r = await runExample('12_potentiometer_serial', { stopAfterMs: 500 });
    expect(r.serial).toContain('Value: 512');
    expect(r.serial).toContain('2.50 V');
    expect(r.serial).toContain('50 %');
    const r2 = await runExample('12_potentiometer_serial', { stopAfterMs: 500, before: (b) => b.potLdr.setPot(1023) });
    expect(r2.serial).toContain('Value: 1023');
    expect(r2.serial).toContain('5.00 V');
  });

  it('13_ldr_night_light reacts to the light level', async () => {
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
  });

  it('14_dht22_serial prints temperature and humidity, and an error when unplugged', async () => {
    const r = await runExample('14_dht22_serial', { stopAfterMs: 2500 });
    expect(r.serial).toContain('Temperature: 24.0 C');
    expect(r.serial).toContain('Humidity: 55.0 %');
    const unplugged = await runExample('14_dht22_serial', { stopAfterMs: 2500, before: (b) => b.dht.setConnected(false) });
    expect(unplugged.serial).toContain('Error: no answer from the DHT22');
  });

  it('15_ultrasonic_distance measures 50 cm and reports a missing echo', async () => {
    const r = await runExample('15_ultrasonic_distance', { stopAfterMs: 1200 });
    expect(r.serial).toContain('Distance: 49.7 cm');
    const unplugged = await runExample('15_ultrasonic_distance', { stopAfterMs: 3000, before: (b) => b.ultrasonic.setConnected(false) });
    expect(unplugged.serial).toContain('No echo');
  });

  it('16_serial_echo reacts to commands typed in the Serial Monitor', async () => {
    const r = await runExample('16_serial_echo', { stopAfterMs: 1500, before: (b) => b.serial.inject('on\n') });
    expect(r.serial).toContain("Type 'on' or 'off'");
    expect(r.serial).toContain('You typed: on');
    expect(r.serial).toContain('Red LED is ON');
    expect(r.board.ledRed.state.on).toBe(true);
    const unknown = await runExample('16_serial_echo', { stopAfterMs: 1500, before: (b) => b.serial.inject('hello\n') });
    expect(unknown.serial).toContain('Unknown command');
  });

  it('20_lcd_hello writes both rows and turns the backlight on', async () => {
    const r = await runExample('20_lcd_hello', { stopAfterMs: 2500 });
    expect(lcdRow(r.board, 0)).toMatch(/^Hello, ZERO1!/);
    expect(lcdRow(r.board, 1)).toMatch(/^Time: [12] s/);
    expect(r.board.lcd.state.backlight).toBe(true);
  });

  it('21_lcd_custom_char shows the temperature with a degree glyph and a heart', async () => {
    const r = await runExample('21_lcd_custom_char', { stopAfterMs: 2500 });
    // The degree sign is either a custom glyph (codes 0..7) or the HD44780 ROM character 0xDF (223).
    expect(lcdRow(r.board, 0)).toMatch(/^Temp: 24\.0<(\d|223)>C/);
    expect(lcdRow(r.board, 1)).toMatch(/^I <\d> ZERO1/);
    expect(r.board.lcd.state.customChars.some((glyph) => glyph.some((row) => row !== 0))).toBe(true);
  });

  it('30_parking_sensor picks the zone from the distance', async () => {
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
  });

  it('31_greenhouse drives the fan from the temperature', async () => {
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
  });

  it('32_reaction_game waits for Button 1', async () => {
    const r = await runExample('32_reaction_game', { stopAfterMs: 1000 });
    expect(r.serial).toContain('Press Button 1 to start');
    expect(r.board.sevenSeg.state.latched).toBe(0);
  });

  it('33_dimmer maps the knob to the servo, the LED and the display', async () => {
    const r = await runExample('33_dimmer', { stopAfterMs: 600 });
    expect(r.serial).toContain('Pot: 512  Servo: 90 deg  Brightness: 127  Level: 4');
    expect(r.board.servo.state.target).toBe(90);
    expect(r.board.sevenSeg.state.latched).toBe(0x66);
    expect(r.board.rgb.state.r).toBeGreaterThan(0);
  });

  it('34_i2c_scanner finds the LCD at 0x27', async () => {
    const r = await runExample('34_i2c_scanner', { stopAfterMs: 3000 });
    expect(r.serial.toLowerCase()).toContain('0x27');
    const moved = await runExample('34_i2c_scanner', { stopAfterMs: 3000, config: { lcdAddress: 0x3f } });
    expect(moved.serial.toLowerCase()).toContain('0x3f');
    expect(moved.serial.toLowerCase()).not.toContain('0x27');
  });
});

// --- Part-by-part groups (40 ... 66) --------------------------------------------

const PIN = { MOTOR: 14, RED: 15, GREEN: 16, BUZZER: 8, SERVO: 4 } as const;

/** The Serial Monitor text with plain newlines (Serial.println() sends CR LF). */
const text = (r: { serial: string }): string => r.serial.replace(/\r\n/g, '\n');

/** [level, virtual time in ms] of every digitalWrite on `pin`. */
function writes(r: { events: BoardEvent[] }, pin: number): number[] {
  return r.events.filter((e) => e.type === 'digitalWrite' && e.pin === pin).map((e) => (e as { level: number }).level);
}

/** Number of rising edges (off -> on) on `pin`. */
function risingEdges(r: { events: BoardEvent[] }, pin: number): number {
  return r.events.filter((e) => e.type === 'digitalWrite' && e.pin === pin && e.level === 1 && e.prev === 0).length;
}

/** Durations (ms) of every HIGH pulse on `pin`, measured on the virtual clock. */
function highPulses(id: string, opts: RunOptions): Promise<{ pulses: number[]; serial: string }> {
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
          pulses.push(clock.now() - since);
          since = null;
        }
      });
      before?.(board, clock);
    },
  }).then((r) => ({ pulses, serial: r.serial }));
}

/** Every distinct servo target in the order it was written. */
function servoTargets(r: { events: BoardEvent[] }): number[] {
  return r.events.filter((e) => e.type === 'servo' && e.pin === PIN.SERVO).map((e) => (e as { angle: number | null }).angle ?? -1);
}

describe('LED examples', () => {
  it('40_led_blink_red blinks with a 1 s on / 1 s off rhythm', async () => {
    const timeline: Array<[number, number]> = [];
    await runExample('40_led_blink_red', {
      stopAfterMs: 2500,
      before: (b, clock) => b.on((e) => e.type === 'digitalWrite' && e.pin === PIN.RED && timeline.push([e.level, clock.now()])),
    });
    // A tick costs a few hundredths of a ms on the virtual clock, hence Math.round().
    expect(timeline.slice(0, 4).map(([level, at]) => [level, Math.round(at)])).toEqual([[1, 0], [0, 1000], [1, 2000], [0, 3000]]);
  });

  it('41_led_red_green alternates the two LEDs and never lights both', async () => {
    const seen: string[] = [];
    const r = await runExample('41_led_red_green', {
      stopAfterMs: 2200,
      before: (b) => b.on((e) => e.type === 'digitalWrite' && (e.pin === PIN.RED || e.pin === PIN.GREEN) && seen.push(`${b.ledRed.state.on ? 'R' : '-'}${b.ledGreen.state.on ? 'G' : '-'}`)),
    });
    expect(seen).toContain('R-');
    expect(seen).toContain('-G');
    expect(seen).not.toContain('RG');
    expect(risingEdges(r, PIN.RED)).toBeGreaterThanOrEqual(2);
    expect(risingEdges(r, PIN.GREEN)).toBeGreaterThanOrEqual(2);
  });

  it('42_led_blink_10_times blinks exactly 10 times and stops', async () => {
    const r = await runExample('42_led_blink_10_times', { stopAfterMs: 8000 });
    expect(risingEdges(r, PIN.RED)).toBe(10);
    expect(r.board.ledRed.state.on).toBe(false);
    expect(text(r)).toContain('Blink 1\n');
    expect(text(r)).toContain('Blink 10\nDone');
  });
});

describe('Buzzer examples', () => {
  it('43_buzzer_short_beeps gives 100 ms beeps every 600 ms', async () => {
    const { pulses } = await highPulses('43_buzzer_short_beeps', { stopAfterMs: 2500 });
    expect(pulses.length).toBeGreaterThanOrEqual(4); // 0, 600, 1200, 1800 ms
    expect(pulses.every((p) => p === 100)).toBe(true);
  });

  it('44_buzzer_beep_10_times beeps exactly 10 times and stops', async () => {
    const r = await runExample('44_buzzer_beep_10_times', { stopAfterMs: 6000 });
    expect(risingEdges(r, PIN.BUZZER)).toBe(10);
    expect(r.board.buzzer.state.freq).toBeNull();
    expect(text(r)).toContain('Beep 10\nDone');
  });

  it('45_buzzer_led_10_times switches the LED and the buzzer together, 10 times', async () => {
    const r = await runExample('45_buzzer_led_10_times', { stopAfterMs: 6000 });
    expect(risingEdges(r, PIN.BUZZER)).toBe(10);
    expect(risingEdges(r, PIN.RED)).toBe(10);
    expect(r.board.ledRed.state.on).toBe(false);
    expect(r.board.buzzer.state.freq).toBeNull();
    expect(text(r)).toContain('Done');
  });
});

describe('Push Button examples', () => {
  it('46_button_a_red_led follows Button A only', async () => {
    const idle = await runExample('46_button_a_red_led', { stopAfterMs: 200 });
    expect(idle.board.ledRed.state.on).toBe(false);
    const a = await runExample('46_button_a_red_led', { stopAfterMs: 200, before: (b) => b.buttonA.press() });
    expect(a.board.ledRed.state.on).toBe(true);
    const b = await runExample('46_button_a_red_led', { stopAfterMs: 200, before: (bd) => bd.buttonB.press() });
    expect(b.board.ledRed.state.on).toBe(false);
  });

  it('47_button_b_red_led follows Button B only', async () => {
    const a = await runExample('47_button_b_red_led', { stopAfterMs: 200, before: (b) => b.buttonA.press() });
    expect(a.board.ledRed.state.on).toBe(false);
    const b = await runExample('47_button_b_red_led', { stopAfterMs: 200, before: (bd) => bd.buttonB.press() });
    expect(b.board.ledRed.state.on).toBe(true);
  });

  it('48_button_a_short_beep beeps 100 ms while Button A is held, and stays silent otherwise', async () => {
    const quiet = await highPulses('48_button_a_short_beep', { stopAfterMs: 500 });
    expect(quiet.pulses).toEqual([]);
    const { pulses } = await highPulses('48_button_a_short_beep', { stopAfterMs: 650, before: (b) => b.buttonA.press() });
    expect(pulses.length).toBeGreaterThanOrEqual(2); // 0, 300, 600 ms
    expect(pulses.every((p) => p === 100)).toBe(true);
  });

  it('49_button_b_long_beep beeps 1 s while Button B is held', async () => {
    const { pulses } = await highPulses('49_button_b_long_beep', { stopAfterMs: 1500, before: (b) => b.buttonB.press() });
    expect(pulses.length).toBeGreaterThanOrEqual(1);
    expect(pulses.every((p) => p === 1000)).toBe(true);
    const wrong = await highPulses('49_button_b_long_beep', { stopAfterMs: 1500, before: (b) => b.buttonA.press() });
    expect(wrong.pulses).toEqual([]);
  });
});

describe('RGB LED examples', () => {
  it('50_rgb_red_green_blue cycles red, green, blue every 500 ms', async () => {
    const colours: string[] = [];
    await runExample('50_rgb_red_green_blue', {
      stopAfterMs: 1700,
      before: (b) => b.on((e) => e.type === 'pixels' && colours.push(`${b.rgb.state.r},${b.rgb.state.g},${b.rgb.state.b}`)),
    });
    // setBrightness(80) scales 255 down to 80
    expect(colours.slice(0, 4)).toEqual(['80,0,0', '0,80,0', '0,0,80', '80,0,0']);
  });

  it('51_rgb_buttons shows red for Button A, green for Button B, off otherwise', async () => {
    const idle = await runExample('51_rgb_buttons', { stopAfterMs: 200 });
    expect([idle.board.rgb.state.r, idle.board.rgb.state.g, idle.board.rgb.state.b]).toEqual([0, 0, 0]);
    const a = await runExample('51_rgb_buttons', { stopAfterMs: 200, before: (b) => b.buttonA.press() });
    expect(a.board.rgb.state.r).toBeGreaterThan(0);
    expect(a.board.rgb.state.g).toBe(0);
    const b = await runExample('51_rgb_buttons', { stopAfterMs: 200, before: (bd) => bd.buttonB.press() });
    expect(b.board.rgb.state.g).toBeGreaterThan(0);
    expect(b.board.rgb.state.r).toBe(0);
  });
});

describe('LDR examples', () => {
  it('52_ldr_serial prints the light value every 200 ms', async () => {
    const r = await runExample('52_ldr_serial', { stopAfterMs: 650, before: (b) => b.potLdr.setSource('ldr') });
    expect(text(r).split('\n').filter((l) => l.startsWith('LDR: 580'))).toHaveLength(4);
    const dark = await runExample('52_ldr_serial', { stopAfterMs: 300, before: (b) => { b.potLdr.setSource('ldr'); b.potLdr.setLight(0); } });
    expect(text(dark)).toContain('LDR: 40');
  });

  it('53_ldr_red_green lights red below 500 and green above', async () => {
    const bright = await runExample('53_ldr_red_green', { stopAfterMs: 300, before: (b) => b.potLdr.setSource('ldr') });
    expect(text(bright)).toContain('LDR: 580 -> bright');
    expect(bright.board.ledGreen.state.on).toBe(true);
    expect(bright.board.ledRed.state.on).toBe(false);
    const dark = await runExample('53_ldr_red_green', { stopAfterMs: 300, before: (b) => { b.potLdr.setSource('ldr'); b.potLdr.setLight(20); } });
    expect(text(dark)).toContain('LDR: 220 -> dark');
    expect(dark.board.ledRed.state.on).toBe(true);
    expect(dark.board.ledGreen.state.on).toBe(false);
  });
});

describe('Seven-Segment examples', () => {
  const DIGIT = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

  function latchedSequence(id: string, before: (b: Zero1Board) => void, stopAfterMs: number) {
    const seen: number[] = [];
    return runExample(id, {
      stopAfterMs,
      before: (b) => {
        before(b);
        b.on((e) => {
          if (e.type === 'digitalWrite' && e.pin === 11 && e.level === 1) seen.push(b.sevenSeg.state.latched);
        });
      },
    }).then((r) => ({ seen, r }));
  }

  it('54_seg_button_a_1_to_4 stays blank until Button A, then counts 1..4', async () => {
    const idle = await latchedSequence('54_seg_button_a_1_to_4', () => {}, 500);
    expect(idle.seen).toEqual([0]);
    const { seen, r } = await latchedSequence('54_seg_button_a_1_to_4', (b) => b.buttonA.press(), 4500);
    expect(seen.slice(0, 6)).toEqual([0, DIGIT[1], DIGIT[2], DIGIT[3], DIGIT[4], 0]);
    expect(text(r)).toMatch(/^1\n2\n3\n4\n/);
  });

  it('55_seg_button_b_7_to_1 counts down 7..1 on Button B', async () => {
    const { seen, r } = await latchedSequence('55_seg_button_b_7_to_1', (b) => b.buttonB.press(), 7500);
    expect(seen.slice(0, 9)).toEqual([0, DIGIT[7], DIGIT[6], DIGIT[5], DIGIT[4], DIGIT[3], DIGIT[2], DIGIT[1], 0]);
    expect(text(r)).toMatch(/^7\n6\n5\n4\n3\n2\n1\n/);
    const wrong = await latchedSequence('55_seg_button_b_7_to_1', (b) => b.buttonA.press(), 500);
    expect(wrong.seen).toEqual([0]);
  });
});

describe('Ultrasonic examples', () => {
  it('56_ultrasonic_serial prints the distance every 300 ms and follows the slider', async () => {
    const r = await runExample('56_ultrasonic_serial', { stopAfterMs: 1000 });
    expect(text(r).split('\n').filter((l) => l === 'Distance: 49.7 cm')).toHaveLength(4);
    const near = await runExample('56_ultrasonic_serial', { stopAfterMs: 100, before: (b) => b.ultrasonic.setDistance(20) });
    expect(text(near)).toMatch(/Distance: (19|20)\.\d cm/);
  });

  it('57_ultrasonic_red_near lights the red LED under 10 cm', async () => {
    const far = await runExample('57_ultrasonic_red_near', { stopAfterMs: 300 });
    expect(far.board.ledRed.state.on).toBe(false);
    expect(text(far)).toContain('Distance: 49.7 cm\n');
    const near = await runExample('57_ultrasonic_red_near', { stopAfterMs: 300, before: (b) => b.ultrasonic.setDistance(5) });
    expect(near.board.ledRed.state.on).toBe(true);
    expect(text(near)).toContain('-> too close!');
  });

  it('58_ultrasonic_green_far lights the green LED over 10 cm', async () => {
    const far = await runExample('58_ultrasonic_green_far', { stopAfterMs: 300 });
    expect(far.board.ledGreen.state.on).toBe(true);
    expect(text(far)).toContain('-> free');
    const near = await runExample('58_ultrasonic_green_far', { stopAfterMs: 300, before: (b) => b.ultrasonic.setDistance(5) });
    expect(near.board.ledGreen.state.on).toBe(false);
  });

  it('59_ultrasonic_beep_rate beeps faster as the object gets closer', async () => {
    const far = await runExample('59_ultrasonic_beep_rate', { stopAfterMs: 3000 });
    expect(text(far)).toContain('Distance: 49.7 cm -> pause 490 ms');
    const farBeeps = risingEdges(far, PIN.BUZZER);
    expect(farBeeps).toBeGreaterThanOrEqual(5); // 3000 / 540
    const near = await runExample('59_ultrasonic_beep_rate', { stopAfterMs: 3000, before: (b) => b.ultrasonic.setDistance(5) });
    expect(text(near)).toContain('pause 50 ms');
    expect(risingEdges(near, PIN.BUZZER)).toBeGreaterThan(farBeeps * 3);
    const none = await runExample('59_ultrasonic_beep_rate', { stopAfterMs: 1500, before: (b) => b.ultrasonic.setConnected(false) });
    expect(text(none)).toContain('No echo');
    expect(risingEdges(none, PIN.BUZZER)).toBe(0);
  });
});

describe('Servo Motor examples', () => {
  it('60_servo_button_a_0 starts at 90 and goes to 0 on Button A', async () => {
    const idle = await runExample('60_servo_button_a_0', { stopAfterMs: 300 });
    expect(idle.board.servo.state.target).toBe(90);
    const a = await runExample('60_servo_button_a_0', { stopAfterMs: 300, before: (b) => b.buttonA.press() });
    expect(a.board.servo.state.target).toBe(0);
    expect(text(a)).toContain('Servo -> 0');
  });

  it('61_servo_button_b_90 starts at 0 and goes to 90 on Button B', async () => {
    const idle = await runExample('61_servo_button_b_90', { stopAfterMs: 300 });
    expect(idle.board.servo.state.target).toBe(0);
    const b = await runExample('61_servo_button_b_90', { stopAfterMs: 300, before: (bd) => bd.buttonB.press() });
    expect(b.board.servo.state.target).toBe(90);
    expect(text(b)).toContain('Servo -> 90');
  });

  it('62_servo_ultrasonic_10_times checks the distance 10 times and moves the servo', async () => {
    const far = await runExample('62_servo_ultrasonic_10_times', { stopAfterMs: 6000 });
    expect(text(far).match(/-> servo 0\n/g)).toHaveLength(10);
    expect(text(far)).toContain('Check 10: 49.7 cm -> servo 0\nDone');
    expect(far.board.servo.state.target).toBe(0);
    const near = await runExample('62_servo_ultrasonic_10_times', { stopAfterMs: 6000, before: (b) => b.ultrasonic.setDistance(5) });
    expect(text(near).match(/-> servo 180\n/g)).toHaveLength(10);
    expect(servoTargets(near).filter((a) => a === 180)).toHaveLength(10);
    expect(near.board.servo.state.target).toBe(180);
  });
});

describe('DHT Sensor examples', () => {
  it('63_dht_serial prints the temperature and the humidity on two lines', async () => {
    const r = await runExample('63_dht_serial', { stopAfterMs: 2500 });
    expect(text(r)).toContain('Temperature: 24.0 C\nHumidity: 55.0 %\n');
    const hot = await runExample('63_dht_serial', { stopAfterMs: 2500, before: (b) => b.dht.set(31.5, 70) });
    expect(text(hot)).toContain('Temperature: 31.5 C\nHumidity: 70.0 %\n');
    const unplugged = await runExample('63_dht_serial', { stopAfterMs: 2500, before: (b) => b.dht.setConnected(false) });
    expect(text(unplugged)).toContain('DHT22 error');
  });

  it('64_dht_servo_slow opens the servo one degree at a time above 28 C', async () => {
    const cool = await runExample('64_dht_servo_slow', { stopAfterMs: 2500 });
    expect(text(cool)).toContain('OK: closed');
    expect(cool.board.servo.state.target).toBe(0);
    const warm = await runExample('64_dht_servo_slow', { stopAfterMs: 6000, before: (b) => b.dht.set(30, 55) });
    expect(text(warm)).toContain('Too warm: opening');
    const targets = servoTargets(warm);
    const climb = targets.slice(targets.indexOf(1));
    expect(climb).toEqual(Array.from({ length: 180 }, (_, i) => i + 1)); // one write per degree, 1 .. 180
    expect(warm.board.servo.state.target).toBe(180);
  });
});

describe('DC Motor examples', () => {
  it('65_motor_button_a_5_times runs the motor 5 times on Button A', async () => {
    const idle = await runExample('65_motor_button_a_5_times', { stopAfterMs: 500 });
    expect(risingEdges(idle, PIN.MOTOR)).toBe(0);
    const r = await runExample('65_motor_button_a_5_times', { stopAfterMs: 5200, before: (b) => b.buttonA.press() });
    expect(text(r)).toContain('Run 5\nDone');
    expect(writes(r, PIN.MOTOR).slice(0, 10)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    expect(r.board.motor.state.running).toBe(false);
  });

  it('66_motor_button_b_5_times_slow runs the motor 5 times with 1 s runs on Button B', async () => {
    const r = await runExample('66_motor_button_b_5_times_slow', { stopAfterMs: 10200, before: (b) => b.buttonB.press() });
    expect(text(r)).toContain('Slow run 5\nDone');
    expect(writes(r, PIN.MOTOR).slice(0, 10)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    expect(r.board.motor.state.running).toBe(false);
    const wrong = await runExample('66_motor_button_b_5_times_slow', { stopAfterMs: 500, before: (b) => b.buttonA.press() });
    expect(risingEdges(wrong, PIN.MOTOR)).toBe(0);
  });
});
