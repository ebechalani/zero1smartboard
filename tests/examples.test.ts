/**
 * The `.ino` examples (docs/ARCHITECTURE.md §9): the manifest, a clean run of every sketch, and
 * the behaviour of each one, which tests/example-behaviour.ts keeps in one table shared with the
 * Python twins (docs/PYTHON.md §10.4).
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLES, EXAMPLE_GROUPS } from '../src/examples';
import { transpile } from '../src/transpiler';
import { EXAMPLE_BEHAVIOUR, behaviourKit, describeExampleBehaviour } from './example-behaviour';

const inoSource = (id: string): string | undefined => EXAMPLES.find((e) => e.id === id)?.source;
const { runExample } = behaviourKit(inoSource);

describe('example manifest', () => {
  it('lists 41 sketches with unique ids and non-empty sources', () => {
    expect(EXAMPLES).toHaveLength(41);
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(41);
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
    expect(EXAMPLES.slice(21).map((e) => `${e.group}: ${e.id}`)).toEqual([
      'LED: 40_led_blink_red', 'LED: 41_led_red_green', 'LED: 42_led_blink_10_times',
      'Buzzer: 43_buzzer_short_beeps', 'Buzzer: 44_buzzer_led_10_times',
      'Push Button: 45_buttons_leds', 'Push Button: 46_buttons_beeps',
      'RGB LED: 47_rgb_red_green_blue', 'RGB LED: 48_rgb_buttons',
      'LDR: 49_ldr_serial', 'LDR: 50_ldr_red_green',
      'Seven-Segment: 51_seg_buttons_count',
      'Ultrasonic: 52_ultrasonic_serial', 'Ultrasonic: 53_ultrasonic_red_green', 'Ultrasonic: 54_ultrasonic_beep_rate',
      'Servo Motor: 55_servo_buttons', 'Servo Motor: 56_servo_ultrasonic_10_times',
      'DHT Sensor: 57_dht_serial', 'DHT Sensor: 58_dht_servo_slow',
      'DC Motor: 59_motor_buttons',
    ]);
  });

  it('gives the part-by-part sketches the menu titles of the lesson plan', () => {
    expect(EXAMPLES.slice(21).map((e) => e.title)).toEqual([
      'Blink the red LED',
      'Blink red and green alternately',
      'Blink the red LED 10 times',
      'Short beeps forever',
      'Beep 10 times with the red LED',
      'Buttons light the LEDs',
      'Buttons: short beep and long beep',
      'RGB LED: red, green, blue',
      'Buttons colour the RGB LED',
      'Show the light level on the Serial Monitor',
      'Night light: red when dark, green when bright',
      'Count up and down with the buttons',
      'Show the distance on the Serial Monitor',
      'Distance alarm: red LED near, green LED far',
      'Parking beeper: faster beeps when closer',
      'Buttons move the servo (0° and 90°)',
      'Servo reacts to the ultrasonic sensor, 10 times',
      'Show temperature and humidity on the Serial Monitor',
      'Servo turns slowly when it is hot (above 28 °C)',
      'Buttons run the motor',
    ]);
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

describe('the behaviour table (tests/example-behaviour.ts)', () => {
  it('checks every .ino example, and only examples that exist', () => {
    const ids = new Set(EXAMPLE_BEHAVIOUR.map((b) => b.id));
    expect(EXAMPLES.filter((e) => !ids.has(e.id)).map((e) => e.id)).toEqual([]);
    expect([...ids].filter((id) => inoSource(id) === undefined)).toEqual([]);
    expect(new Set(EXAMPLE_BEHAVIOUR.map((b) => b.name)).size).toBe(EXAMPLE_BEHAVIOUR.length);
  });
});

describeExampleBehaviour('Arduino examples', inoSource);
