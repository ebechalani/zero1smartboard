/**
 * The Python examples (docs/PYTHON.md §9, §10.4): the list, the translation of each one (no
 * error, no warning, a sketch the simulator reads without warnings), a clean 4-second run, and
 * the behaviour of each one checked with the **same assertions** as its `.ino` twin
 * (tests/example-behaviour.ts). 16_serial_echo has its own test for what only Python does: the
 * Serial Monitor also shows the typed line (input() echoes it), and a number blinks the LED.
 * So do the sensor examples 52–58 for their `except OSError:` branches (no echo, DHT22 unplugged),
 * where the Arduino twins print a value instead.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { PYTHON_LESSON_EXAMPLES } from '../src/examples/python';
import { PYTHON_PART_EXAMPLES } from '../src/examples/python/parts';
import { BLANK_PYTHON, PYTHON_EXAMPLES, PYTHON_FIRST_EXAMPLE, pythonToArduino, type PythonTranslation } from '../src/python';
import { transpile } from '../src/transpiler';
import { EXAMPLE_BEHAVIOUR, behaviourKit, describeExampleBehaviour, risingEdges, servoTargets, text, PIN } from './example-behaviour';

/** The 13 lessons of §9. */
const LESSONS = [
  '01_blink_red', '02_traffic_lights', '03_buzzer_melody', '06_servo_sweep', '07_dc_motor',
  '11_button_toggle', '12_potentiometer_serial', '16_serial_echo',
  '20_lcd_hello', '21_lcd_custom_char',
  '31_greenhouse', '32_reaction_game', '34_i2c_scanner',
];

/** The 20 part-by-part examples of §9 (src/examples/python/parts.ts): the twins of every .ino example 40–59. */
const PARTS = EXAMPLES.map((e) => e.id).filter((id) => /^[45]\d_/.test(id));

/** The examples without "while True:" (§2.1 rule 2): the Arduino twins end in an empty loop() too. */
const ENDING = new Set(['42_led_blink_10_times', '44_buzzer_led_10_times', '56_servo_ultrasonic_10_times']);

const translations = new Map<string, PythonTranslation>();
/** The translation of Python example `id` (once per id). */
function translationOf(id: string): PythonTranslation | undefined {
  const example = PYTHON_EXAMPLES.find((e) => e.id === id);
  if (!example) return undefined;
  let t = translations.get(id);
  if (!t) {
    t = pythonToArduino(example.python);
    translations.set(id, t);
  }
  return t;
}

/** The sketch made from Python example `id`: what Run executes. */
const sketchOf = (id: string): string | undefined => translationOf(id)?.sketch;
const { runExample } = behaviourKit(sketchOf);

describe('the Python examples (§9)', () => {
  it('are the 13 lessons, then the 20 part-by-part examples: 33 in all', () => {
    expect(PARTS).toHaveLength(20);
    expect(PYTHON_LESSON_EXAMPLES.map((e) => e.id)).toEqual(LESSONS);
    expect(PYTHON_PART_EXAMPLES.map((e) => e.id)).toEqual(PARTS);
    expect(PYTHON_EXAMPLES).toEqual([...PYTHON_LESSON_EXAMPLES, ...PYTHON_PART_EXAMPLES]);
    expect(PYTHON_EXAMPLES).toHaveLength(33);
    expect(new Set(PYTHON_EXAMPLES.map((e) => e.id)).size).toBe(PYTHON_EXAMPLES.length);
  });

  it('PYTHON_FIRST_EXAMPLE is example 01, the first entry (a chunk can import it without the other 32, §7.16)', () => {
    expect(PYTHON_FIRST_EXAMPLE).toBe(PYTHON_EXAMPLES[0]);
    expect(PYTHON_FIRST_EXAMPLE.id).toBe('01_blink_red');
  });

  it('have the id, title and group of their .ino twin, in the order of EXAMPLES', () => {
    const indexes = PYTHON_EXAMPLES.map((e) => EXAMPLES.findIndex((x) => x.id === e.id));
    expect(indexes.every((i) => i >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    for (const e of PYTHON_EXAMPLES) {
      const twin = EXAMPLES.find((x) => x.id === e.id)!;
      expect({ title: e.title, group: e.group }, e.id).toEqual({ title: twin.title, group: twin.group });
      expect(e.description.length, e.id).toBeGreaterThan(20);
      expect('source' in e).toBe(false);
    }
  });

  it('start with a docstring header with the four sections of the .ino headers', () => {
    for (const e of PYTHON_EXAMPLES) {
      const header = /^"""\n([\s\S]*?)\n"""\n/.exec(e.python)?.[1] ?? '';
      const lines = header.split('\n');
      expect(lines[0], e.id).toBe(`ZERO1 Smart Board - ${e.id.slice(0, 2)} ${e.title}`);
      expect(lines[1], e.id).toBe('-'.repeat(lines[0].length));
      const sections = lines.filter((l) => /^[A-Z][A-Z ]+[A-Z]$/.test(l));
      expect(sections, e.id).toEqual(['WHAT IT TEACHES', 'PARTS AND PINS', 'EXPECTED BEHAVIOUR', 'TRY THIS']);
    }
  });

  it('LDR examples tell the student to flip the POT / LDR switch, like their twins', () => {
    for (const e of PYTHON_EXAMPLES.filter((x) => x.group === 'LDR')) expect(e.python, e.id).toMatch(/POT \/ LDR/);
  });

  it('each has its behaviour checked by the table shared with the .ino twins', () => {
    const checked = new Set(EXAMPLE_BEHAVIOUR.map((b) => b.id));
    expect(PYTHON_EXAMPLES.filter((e) => !checked.has(e.id)).map((e) => e.id)).toEqual([]);
  });
});

describe('every Python example translates with no error and no warning', () => {
  for (const e of PYTHON_EXAMPLES) {
    it(e.id, () => {
      const t = translationOf(e.id)!;
      expect(t.diagnostics.map((d) => `${d.line}:${d.column} ${d.code} ${d.message}`)).toEqual([]);
      expect(t.ok).toBe(true);
      expect(t.endsAfterSetup).toBe(ENDING.has(e.id));
      expect(t.usesInput).toBe(e.id === '16_serial_echo');
      const r = transpile(t.sketch);
      if (!r.ok) throw new Error(r.errors.map((x) => `${x.line}:${x.column} ${x.message}`).join('; '));
      expect(r.warnings).toEqual([]);
    });
  }
});

describe('every Python example runs 4,000 virtual ms without console errors or warnings', () => {
  for (const e of PYTHON_EXAMPLES) {
    it(e.id, async () => {
      const r = await runExample(e.id, { stopAfterMs: 4000 });
      expect(r.console.filter((m) => m.level !== 'info').map((m) => m.text)).toEqual([]);
    });
  }
});

describeExampleBehaviour('Python examples', sketchOf);

describe('16_serial_echo in Python: input()', () => {
  it('shows each typed line on the Serial Monitor before the answer', async () => {
    const r = await runExample('16_serial_echo', { stopAfterMs: 1500, before: (b) => b.serial.inject('on\nOFF \nhello\n') });
    expect(text(r)).toBe(
      "Type 'on' or 'off' and press Send\n" +
        'on\nYou typed: on\nRed LED is ON\n' +
        'OFF \nYou typed: off\nRed LED is OFF\n' +
        "hello\nYou typed: hello\nUnknown command. Try 'on' or 'off'.\n",
    );
    expect(r.board.ledRed.state.on).toBe(false);
  });

  it('blinks the red LED as many times as the number typed (try / except ValueError)', async () => {
    const r = await runExample('16_serial_echo', { stopAfterMs: 2000, before: (b) => b.serial.inject('3\n') });
    expect(text(r)).toContain('3\nYou typed: 3\nBlinked 3 times\n');
    expect(risingEdges(r, PIN.RED)).toBe(3);
    expect(r.board.ledRed.state.on).toBe(false);
  });

  it('waits for a line: nothing typed, nothing happens', async () => {
    const r = await runExample('16_serial_echo', { stopAfterMs: 1000 });
    expect(text(r)).toBe("Type 'on' or 'off' and press Send\n");
  });
});

/** Calls `then` once the board has sent its `count`-th line on the Serial Monitor. */
function afterLines(board: { serial: { onTx(listener: (chunk: string) => void): void } }, count: number, then: () => void): void {
  let lines = 0;
  board.serial.onTx((chunk) => {
    if (chunk.includes('\n') && ++lines === count) then();
  });
}

const NO_ECHO = 'No echo (is the sensor plugged in?)\n';
const DHT_ERROR = 'DHT22 error (is it plugged in?)\n';

// §9: "the no-echo / sensor-unplugged branches of 52–58 get their own Python tests (the Arduino
// twins print a value there instead)". 55 has no sensor.
describe('the sensor examples in Python: the except OSError: branch (sensor unplugged)', () => {
  it('52_ultrasonic_serial prints "No echo" while the sensor is unplugged, and the distance again once it is back', async () => {
    const r = await runExample('52_ultrasonic_serial', {
      stopAfterMs: 2100,
      before: (b) => {
        b.ultrasonic.setConnected(false);
        afterLines(b, 2, () => b.ultrasonic.setConnected(true));
      },
    });
    expect(text(r)).toMatch(/^No echo \(is the sensor plugged in\?\)\nNo echo \(is the sensor plugged in\?\)\n(Distance: 49\.7 cm\n){2,}$/);
  });

  it('53_ultrasonic_red_green switches both LEDs off and prints "No echo" once the sensor is unplugged', async () => {
    const r = await runExample('53_ultrasonic_red_green', {
      stopAfterMs: 1200,
      before: (b) => afterLines(b, 1, () => b.ultrasonic.setConnected(false)),
    });
    expect(text(r)).toBe(`Distance: 49.7 cm -> free\n${NO_ECHO}${NO_ECHO}`);
    expect(risingEdges(r, PIN.GREEN)).toBe(1);
    expect(r.board.ledGreen.state.on).toBe(false);
    expect(risingEdges(r, PIN.RED)).toBe(0);
  });

  it('54_ultrasonic_beep_rate stays silent while the sensor is unplugged and beeps again once it is back', async () => {
    const r = await runExample('54_ultrasonic_beep_rate', {
      stopAfterMs: 1500,
      before: (b) => {
        b.ultrasonic.setConnected(false);
        afterLines(b, 2, () => b.ultrasonic.setConnected(true));
      },
    });
    expect(text(r)).toBe(`${NO_ECHO}${NO_ECHO}Distance: 49.7 cm -> pause 497 ms\n`);
    expect(risingEdges(r, PIN.BUZZER)).toBe(1);
  });

  it('56_servo_ultrasonic_10_times reports "no echo" in every round and keeps the servo at 0 when the sensor is unplugged', async () => {
    const r = await runExample('56_servo_ultrasonic_10_times', { stopAfterMs: 11000, before: (b) => b.ultrasonic.setConnected(false) });
    expect(text(r)).toBe(`${Array.from({ length: 10 }, (_, i) => `Round ${i + 1}: no echo -> servo 0\n`).join('')}Done\n`);
    expect(servoTargets(r).filter((a) => a === 180)).toEqual([]);
    expect(r.board.servo.state.target).toBe(0);
  });

  it('56_servo_ultrasonic_10_times goes on with the next rounds after a round without echo', async () => {
    const r = await runExample('56_servo_ultrasonic_10_times', {
      stopAfterMs: 11000,
      before: (b) => {
        b.ultrasonic.setDistance(5);
        afterLines(b, 1, () => b.ultrasonic.setConnected(false));
        afterLines(b, 2, () => b.ultrasonic.setConnected(true));
      },
    });
    expect(text(r)).toMatch(/^Round 1: [\d.]+ cm -> servo 180\nRound 2: no echo -> servo 0\nRound 3: [\d.]+ cm -> servo 180\n/);
    expect(text(r).match(/-> servo 180\n/g)).toHaveLength(9);
    expect(text(r)).toMatch(/Round 10: [\d.]+ cm -> servo 180\nDone\n$/);
  });

  it('57_dht_serial prints "DHT22 error (is it plugged in?)" every 2 s while the DHT22 is unplugged, then the readings again', async () => {
    // The run stops at the first tick after the deadline: the line printed right after the
    // time.sleep(2) that crosses it (6000 ms) is still there.
    const r = await runExample('57_dht_serial', {
      stopAfterMs: 5900,
      before: (b) => {
        b.dht.setConnected(false);
        afterLines(b, 2, () => b.dht.setConnected(true));
      },
    });
    expect(text(r)).toBe(`${DHT_ERROR}${DHT_ERROR}Temperature: 24.0 C  Humidity: 55.0 %\n`);
  });

  it('58_dht_servo_slow prints "DHT22 error (is it plugged in?)" and leaves the servo at 0 while the DHT22 is unplugged, even when it is warm', async () => {
    const r = await runExample('58_dht_servo_slow', {
      stopAfterMs: 3900,
      before: (b) => {
        b.dht.set(30, 55);
        b.dht.setConnected(false);
      },
    });
    expect(text(r)).toBe(`${DHT_ERROR}${DHT_ERROR}`);
    const targets = servoTargets(r);
    expect(targets.slice(targets.indexOf(0))).toEqual([0]); // after attaching: the start position only
    expect(r.board.servo.state.target).toBe(0);
  });
});

describe('BLANK_PYTHON (§10.4 item 3)', () => {
  it('translates without errors or warnings to empty setup() / loop() bodies with the two comments', () => {
    const t = pythonToArduino(BLANK_PYTHON);
    expect(t.ok).toBe(true);
    expect(t.diagnostics).toEqual([]);
    expect(t.sketch).toMatch(/\/\/ Code here runs once, when the board starts\.\n/);
    expect(t.sketch).toMatch(/void loop\(\) \{\n {2}\/\/ Code here runs again and again, forever\.\n\}/);
    expect(transpile(t.sketch)).toMatchObject({ ok: true, warnings: [] });
  });
});
