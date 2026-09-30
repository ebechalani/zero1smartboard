/**
 * Python example programs (docs/PYTHON.md §9): the Python twins of the `.ino` examples, with the
 * same `id`, `title` and `group` and in the same relative order as EXAMPLES.
 *
 * Each `.py` file is imported as raw text. Loaded only with the Python chunk (never from
 * src/main.ts statically).
 *
 * The 13 lessons are listed here; the part-by-part examples 40–59 are in ./parts.ts and come
 * after them, as in the Examples menu of the other modes. Example 01 is in ./first.ts, which the
 * Python chunk can import without the other 32 (§7.16).
 */

import { PYTHON_FIRST_EXAMPLE } from './first';
import trafficLights from './02_traffic_lights.py?raw';
import buzzerMelody from './03_buzzer_melody.py?raw';
import servoSweep from './06_servo_sweep.py?raw';
import dcMotor from './07_dc_motor.py?raw';
import buttonToggle from './11_button_toggle.py?raw';
import potentiometerSerial from './12_potentiometer_serial.py?raw';
import serialEcho from './16_serial_echo.py?raw';
import lcdHello from './20_lcd_hello.py?raw';
import lcdCustomChar from './21_lcd_custom_char.py?raw';
import greenhouse from './31_greenhouse.py?raw';
import reactionGame from './32_reaction_game.py?raw';
import i2cScanner from './34_i2c_scanner.py?raw';
import { PYTHON_PART_EXAMPLES } from './parts';

/** One Python example as shown in the Examples menu in Python mode. */
export interface PythonExample {
  /** The `.ino` twin's id, e.g. `01_blink_red`. */
  id: string;
  /** The twin's menu title. */
  title: string;
  /** The twin's menu group (one of EXAMPLE_GROUPS). */
  group: string;
  /** One sentence: what the program does / teaches. */
  description: string;
  /** The Python program. No `source` field: the Examples menu dispatches on the mode, never on 'source' in x. */
  python: string;
}

/** The 13 lessons (§9), in lesson order. */
export const PYTHON_LESSON_EXAMPLES: PythonExample[] = [
  // --- Outputs -------------------------------------------------------------
  PYTHON_FIRST_EXAMPLE,
  {
    id: '02_traffic_lights',
    title: 'Traffic lights',
    group: 'Outputs',
    description: 'Red and green LEDs alternate every 2 s with the built-in L LED; introduces def with parameters and for _ in range(3).',
    python: trafficLights,
  },
  {
    id: '03_buzzer_melody',
    title: 'Buzzer melody',
    group: 'Outputs',
    description: 'Plays "Frere Jacques" on the buzzer (D8) with Buzzer().tone() and two lists: the notes and their durations.',
    python: buzzerMelody,
  },
  {
    id: '06_servo_sweep',
    title: 'Servo sweep',
    group: 'Outputs',
    description: 'The servo (D4) sweeps from 0 to 180 degrees and back with Servo().angle() and two range() loops.',
    python: servoSweep,
  },
  {
    id: '07_dc_motor',
    title: 'DC motor on / off',
    group: 'Outputs',
    description: 'The motor (A0) runs 2 s and stops 2 s using time.ticks_ms() while the L LED keeps blinking.',
    python: dcMotor,
  },

  // --- Inputs --------------------------------------------------------------
  {
    id: '11_button_toggle',
    title: 'Button toggle (debounce)',
    group: 'Inputs',
    description: 'Each press of Button 1 toggles the red LED; edge detection with debouncing and time.ticks_diff().',
    python: buttonToggle,
  },
  {
    id: '12_potentiometer_serial',
    title: 'Potentiometer to Serial',
    group: 'Inputs',
    description: 'Reads the potentiometer (A3) and prints the raw value, the voltage and a percentage with map_range().',
    python: potentiometerSerial,
  },
  {
    id: '16_serial_echo',
    title: 'Serial echo and commands',
    group: 'Inputs',
    description: 'Reads lines typed in the Serial Monitor with input() and switches the red LED with "on" / "off"; a number blinks it.',
    python: serialEcho,
  },

  // --- Display -------------------------------------------------------------
  {
    id: '20_lcd_hello',
    title: 'LCD hello',
    group: 'Display',
    description: 'Shows "Hello, ZERO1!" and a seconds counter on the I2C LCD (0x27) with LCD().putstr() and time.ticks_ms().',
    python: lcdHello,
  },
  {
    id: '21_lcd_custom_char',
    title: 'LCD custom characters',
    group: 'Display',
    description: 'Draws a beating heart with custom_char() and shows the DHT22 temperature with the degree symbol.',
    python: lcdCustomChar,
  },

  // --- Projects ------------------------------------------------------------
  {
    id: '31_greenhouse',
    title: 'Smart greenhouse',
    group: 'Projects',
    description: 'DHT22 readings on the LCD; the motor acts as a fan above 28 C and the red LED blinks above 35 C.',
    python: greenhouse,
  },
  {
    id: '32_reaction_game',
    title: 'Reaction game',
    group: 'Projects',
    description: 'Countdown on the 7-segment, random wait, then measure how fast you press Button 2; score on the Serial Monitor.',
    python: reactionGame,
  },
  {
    id: '34_i2c_scanner',
    title: 'I2C scanner',
    group: 'Projects',
    description: 'Scans the I2C bus with i2c.scan() and prints the addresses that answer (expected: 0x27, the LCD).',
    python: i2cScanner,
  },
];

/** Every Python example, in menu order: the lessons, then the part-by-part examples. */
export const PYTHON_EXAMPLES: PythonExample[] = [...PYTHON_LESSON_EXAMPLES, ...PYTHON_PART_EXAMPLES];
