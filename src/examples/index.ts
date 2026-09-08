/**
 * Example sketches shipped with the simulator (docs/ARCHITECTURE.md §9).
 *
 * Each `.ino` file is imported as raw text and listed here with the metadata
 * the Examples menu needs. Ids equal the file name without extension so that
 * a sketch can be referenced from tests and URLs (`#example=01_blink_red`).
 */

import blinkRed from './01_blink_red.ino?raw';
import trafficLights from './02_traffic_lights.ino?raw';
import buzzerMelody from './03_buzzer_melody.ino?raw';
import rgbRainbow from './04_rgb_rainbow.ino?raw';
import sevenSegmentCounter from './05_seven_segment_counter.ino?raw';
import servoSweep from './06_servo_sweep.ino?raw';
import dcMotor from './07_dc_motor.ino?raw';
import buttonLed from './10_button_led.ino?raw';
import buttonToggle from './11_button_toggle.ino?raw';
import potentiometerSerial from './12_potentiometer_serial.ino?raw';
import ldrNightLight from './13_ldr_night_light.ino?raw';
import dht22Serial from './14_dht22_serial.ino?raw';
import ultrasonicDistance from './15_ultrasonic_distance.ino?raw';
import serialEcho from './16_serial_echo.ino?raw';
import lcdHello from './20_lcd_hello.ino?raw';
import lcdCustomChar from './21_lcd_custom_char.ino?raw';
import parkingSensor from './30_parking_sensor.ino?raw';
import greenhouse from './31_greenhouse.ino?raw';
import reactionGame from './32_reaction_game.ino?raw';
import dimmer from './33_dimmer.ino?raw';
import i2cScanner from './34_i2c_scanner.ino?raw';

/** One example sketch as shown in the Examples menu. */
export interface Example {
  /** File name without extension, e.g. `01_blink_red`. */
  id: string;
  /** Human-friendly menu title. */
  title: string;
  /** Menu group, one of EXAMPLE_GROUPS. */
  group: string;
  /** One sentence: what the sketch does / teaches. */
  description: string;
  /** Full Arduino source of the sketch. */
  source: string;
}

/** Menu groups in the order they should be displayed. */
export const EXAMPLE_GROUPS: readonly string[] = ['Outputs', 'Inputs', 'Display', 'Projects'];

/** Every example sketch, in lesson order (grouped by EXAMPLE_GROUPS). */
export const EXAMPLES: Example[] = [
  // --- Outputs -------------------------------------------------------------
  {
    id: '01_blink_red',
    title: 'Blink the red LED',
    group: 'Outputs',
    description: 'The first program: the red LED (A1) blinks once per second and Serial prints ON / OFF.',
    source: blinkRed,
  },
  {
    id: '02_traffic_lights',
    title: 'Traffic lights',
    group: 'Outputs',
    description: 'Red and green LEDs alternate every 2 s with the built-in L LED; introduces functions with parameters.',
    source: trafficLights,
  },
  {
    id: '03_buzzer_melody',
    title: 'Buzzer melody',
    group: 'Outputs',
    description: 'Plays "Frere Jacques" on the buzzer (D8) with tone() and a note table.',
    source: buzzerMelody,
  },
  {
    id: '04_rgb_rainbow',
    title: 'RGB rainbow',
    group: 'Outputs',
    description: 'The NeoPixel RGB LED (D9) cycles through the rainbow using ColorHSV().',
    source: rgbRainbow,
  },
  {
    id: '05_seven_segment_counter',
    title: '7-segment counter',
    group: 'Outputs',
    description: 'Counts 0 to 9 on the 7-segment display through the 74HC595 with shiftOut().',
    source: sevenSegmentCounter,
  },
  {
    id: '06_servo_sweep',
    title: 'Servo sweep',
    group: 'Outputs',
    description: 'The servo (D4) sweeps from 0 to 180 degrees and back with the Servo library.',
    source: servoSweep,
  },
  {
    id: '07_dc_motor',
    title: 'DC motor on / off',
    group: 'Outputs',
    description: 'The motor (A0) runs 2 s and stops 2 s using millis() while the L LED keeps blinking.',
    source: dcMotor,
  },

  // --- Inputs --------------------------------------------------------------
  {
    id: '10_button_led',
    title: 'Buttons and LEDs',
    group: 'Inputs',
    description: 'Button 1 lights the red LED and Button 2 the green LED while they are held down.',
    source: buttonLed,
  },
  {
    id: '11_button_toggle',
    title: 'Button toggle (debounce)',
    group: 'Inputs',
    description: 'Each press of Button 1 toggles the red LED; edge detection with debouncing.',
    source: buttonToggle,
  },
  {
    id: '12_potentiometer_serial',
    title: 'Potentiometer to Serial',
    group: 'Inputs',
    description: 'Reads the potentiometer (A3) and prints the raw value, the voltage and a percentage with map().',
    source: potentiometerSerial,
  },
  {
    id: '13_ldr_night_light',
    title: 'LDR night light',
    group: 'Inputs',
    description: 'Turns the red LED on when the light sensor (A3, switch on LDR) reads below a threshold.',
    source: ldrNightLight,
  },
  {
    id: '14_dht22_serial',
    title: 'DHT22 temperature and humidity',
    group: 'Inputs',
    description: 'Prints temperature and humidity from the DHT22 (D5) every 2 s, with an isnan() check.',
    source: dht22Serial,
  },
  {
    id: '15_ultrasonic_distance',
    title: 'Ultrasonic distance',
    group: 'Inputs',
    description: 'Measures a distance with the HC-SR04 (TRIG D3, ECHO D2) using pulseIn() and the speed of sound.',
    source: ultrasonicDistance,
  },
  {
    id: '16_serial_echo',
    title: 'Serial echo and commands',
    group: 'Inputs',
    description: 'Reads lines typed in the Serial Monitor, echoes them and switches the red LED with "on" / "off".',
    source: serialEcho,
  },

  // --- Display -------------------------------------------------------------
  {
    id: '20_lcd_hello',
    title: 'LCD hello',
    group: 'Display',
    description: 'Shows "Hello, ZERO1!" and a seconds counter on the I2C LCD (0x27) with millis().',
    source: lcdHello,
  },
  {
    id: '21_lcd_custom_char',
    title: 'LCD custom characters',
    group: 'Display',
    description: 'Draws a beating heart with createChar() and shows the DHT22 temperature with the degree symbol.',
    source: lcdCustomChar,
  },

  // --- Projects ------------------------------------------------------------
  {
    id: '30_parking_sensor',
    title: 'Parking sensor',
    group: 'Projects',
    description: 'Ultrasonic distance drives the RGB colour and a beep rate that speeds up as an obstacle gets closer.',
    source: parkingSensor,
  },
  {
    id: '31_greenhouse',
    title: 'Smart greenhouse',
    group: 'Projects',
    description: 'DHT22 readings on the LCD; the motor acts as a fan above 28 C and the red LED blinks above 35 C.',
    source: greenhouse,
  },
  {
    id: '32_reaction_game',
    title: 'Reaction game',
    group: 'Projects',
    description: 'Countdown on the 7-segment, random wait, then measure how fast you press Button 2; score on Serial.',
    source: reactionGame,
  },
  {
    id: '33_dimmer',
    title: 'Dimmer',
    group: 'Projects',
    description: 'The potentiometer sets the servo angle, the RGB brightness and a 0-9 level on the 7-segment display.',
    source: dimmer,
  },
  {
    id: '34_i2c_scanner',
    title: 'I2C scanner',
    group: 'Projects',
    description: 'Scans the I2C bus with Wire and prints the addresses that answer (expected: 0x27, the LCD).',
    source: i2cScanner,
  },
];

/** Returns the example with the given id, or undefined when it does not exist. */
export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((example) => example.id === id);
}
