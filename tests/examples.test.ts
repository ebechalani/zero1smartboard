import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
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
  it('lists 21 sketches with unique ids and non-empty sources', () => {
    expect(EXAMPLES).toHaveLength(21);
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(21);
    for (const e of EXAMPLES) {
      expect(e.source.length).toBeGreaterThan(100);
      expect(e.title.length).toBeGreaterThan(3);
      expect(['Outputs', 'Inputs', 'Display', 'Projects']).toContain(e.group);
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
