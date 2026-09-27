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
import ledBlinkRed from './40_led_blink_red.ino?raw';
import ledRedGreen from './41_led_red_green.ino?raw';
import ledBlink10 from './42_led_blink_10_times.ino?raw';
import buzzerShortBeeps from './43_buzzer_short_beeps.ino?raw';
import buzzerBeep10 from './44_buzzer_beep_10_times.ino?raw';
import buzzerLed10 from './45_buzzer_led_10_times.ino?raw';
import buttonARedLed from './46_button_a_red_led.ino?raw';
import buttonBRedLed from './47_button_b_red_led.ino?raw';
import buttonAShortBeep from './48_button_a_short_beep.ino?raw';
import buttonBLongBeep from './49_button_b_long_beep.ino?raw';
import rgbRedGreenBlue from './50_rgb_red_green_blue.ino?raw';
import rgbButtons from './51_rgb_buttons.ino?raw';
import ldrSerial from './52_ldr_serial.ino?raw';
import ldrRedGreen from './53_ldr_red_green.ino?raw';
import segButtonA1To4 from './54_seg_button_a_1_to_4.ino?raw';
import segButtonB7To1 from './55_seg_button_b_7_to_1.ino?raw';
import ultrasonicSerial from './56_ultrasonic_serial.ino?raw';
import ultrasonicRedNear from './57_ultrasonic_red_near.ino?raw';
import ultrasonicGreenFar from './58_ultrasonic_green_far.ino?raw';
import ultrasonicBeepRate from './59_ultrasonic_beep_rate.ino?raw';
import servoButtonA0 from './60_servo_button_a_0.ino?raw';
import servoButtonB90 from './61_servo_button_b_90.ino?raw';
import servoUltrasonic10 from './62_servo_ultrasonic_10_times.ino?raw';
import dhtSerial from './63_dht_serial.ino?raw';
import dhtServoSlow from './64_dht_servo_slow.ino?raw';
import motorButtonA5 from './65_motor_button_a_5_times.ino?raw';
import motorButtonB5Slow from './66_motor_button_b_5_times_slow.ino?raw';

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
export const EXAMPLE_GROUPS: readonly string[] = [
  'Outputs',
  'Inputs',
  'Display',
  'Projects',
  'LED',
  'Buzzer',
  'Push Button',
  'RGB LED',
  'LDR',
  'Seven-Segment',
  'Ultrasonic',
  'Servo Motor',
  'DHT Sensor',
  'DC Motor',
];

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

  // --- LED -------------------------------------------------------------------
  {
    id: '40_led_blink_red',
    title: 'Blinking red LED',
    group: 'LED',
    description: 'The red LED (A1) is on for 1 s and off for 1 s, forever.',
    source: ledBlinkRed,
  },
  {
    id: '41_led_red_green',
    title: 'Blinking alternately between red and green',
    group: 'LED',
    description: 'Red (A1) and green (A2) take turns every 500 ms; they are never on together.',
    source: ledRedGreen,
  },
  {
    id: '42_led_blink_10_times',
    title: 'Blinking 10 times',
    group: 'LED',
    description: 'A for loop in setup() blinks the red LED exactly 10 times, then the program stops.',
    source: ledBlink10,
  },

  // --- Buzzer ----------------------------------------------------------------
  {
    id: '43_buzzer_short_beeps',
    title: 'Short beeps (infinite)',
    group: 'Buzzer',
    description: 'The active buzzer (D8) gives a 100 ms beep every 600 ms, forever.',
    source: buzzerShortBeeps,
  },
  {
    id: '44_buzzer_beep_10_times',
    title: 'Beep 10 times',
    group: 'Buzzer',
    description: 'A for loop beeps the buzzer exactly 10 times, then silence.',
    source: buzzerBeep10,
  },
  {
    id: '45_buzzer_led_10_times',
    title: 'Beep with red LED 10 times',
    group: 'Buzzer',
    description: 'The buzzer and the red LED switch on and off together, 10 times.',
    source: buzzerLed10,
  },

  // --- Push Button -----------------------------------------------------------
  {
    id: '46_button_a_red_led',
    title: 'Turn red LED ON with Button A',
    group: 'Push Button',
    description: 'The red LED is on while Button A (D6) is held down.',
    source: buttonARedLed,
  },
  {
    id: '47_button_b_red_led',
    title: 'Turn red LED ON with Button B',
    group: 'Push Button',
    description: 'The red LED is on while Button B (D7) is held down.',
    source: buttonBRedLed,
  },
  {
    id: '48_button_a_short_beep',
    title: 'Button A – short beep',
    group: 'Push Button',
    description: 'Pressing Button A gives a short 100 ms beep on the buzzer.',
    source: buttonAShortBeep,
  },
  {
    id: '49_button_b_long_beep',
    title: 'Button B – long beep',
    group: 'Push Button',
    description: 'Pressing Button B gives a long 1 s beep on the buzzer.',
    source: buttonBLongBeep,
  },

  // --- RGB LED ---------------------------------------------------------------
  {
    id: '50_rgb_red_green_blue',
    title: 'Display patterns: Red → Green → Blue',
    group: 'RGB LED',
    description: 'The NeoPixel RGB LED (D9) shows red, green and blue for 500 ms each, forever.',
    source: rgbRedGreenBlue,
  },
  {
    id: '51_rgb_buttons',
    title: 'Button A → Red (RGB), Button B → Green (RGB)',
    group: 'RGB LED',
    description: 'Button A makes the RGB LED red, Button B makes it green; otherwise it is off.',
    source: rgbButtons,
  },

  // --- LDR -------------------------------------------------------------------
  {
    id: '52_ldr_serial',
    title: 'Display LDR value on Serial Monitor',
    group: 'LDR',
    description: 'Prints the light sensor value (A3, switch on LDR) every 200 ms.',
    source: ldrSerial,
  },
  {
    id: '53_ldr_red_green',
    title: 'Red LED ON if LDR < 500; Green LED ON if LDR > 500',
    group: 'LDR',
    description: 'Below 500 the red LED is on, otherwise the green one (A3, switch on LDR).',
    source: ldrRedGreen,
  },

  // --- Seven-Segment ---------------------------------------------------------
  {
    id: '54_seg_button_a_1_to_4',
    title: 'On Button A → display numbers from 1 to 4',
    group: 'Seven-Segment',
    description: 'Pressing Button A counts 1, 2, 3, 4 on the 7-segment display, one digit per second.',
    source: segButtonA1To4,
  },
  {
    id: '55_seg_button_b_7_to_1',
    title: 'On Button B → display numbers from 7 to 1',
    group: 'Seven-Segment',
    description: 'Pressing Button B counts down 7 to 1 on the 7-segment display, one digit per second.',
    source: segButtonB7To1,
  },

  // --- Ultrasonic ------------------------------------------------------------
  {
    id: '56_ultrasonic_serial',
    title: 'Display distance on the Serial Monitor',
    group: 'Ultrasonic',
    description: 'Measures the distance with the HC-SR04 (TRIG D3, ECHO D2) and prints it every 300 ms.',
    source: ultrasonicSerial,
  },
  {
    id: '57_ultrasonic_red_near',
    title: 'Red LED ON if distance < 10 cm',
    group: 'Ultrasonic',
    description: 'The red LED lights when an object is closer than 10 cm.',
    source: ultrasonicRedNear,
  },
  {
    id: '58_ultrasonic_green_far',
    title: 'Green LED ON if distance > 10 cm',
    group: 'Ultrasonic',
    description: 'The green LED lights when the closest object is farther than 10 cm.',
    source: ultrasonicGreenFar,
  },
  {
    id: '59_ultrasonic_beep_rate',
    title: 'Speed up the buzzer tone as the distance decreases',
    group: 'Ultrasonic',
    description: 'The buzzer beeps faster as an object gets closer (parking sensor), using map().',
    source: ultrasonicBeepRate,
  },

  // --- Servo Motor -----------------------------------------------------------
  {
    id: '60_servo_button_a_0',
    title: 'Button A → move servo to 0°',
    group: 'Servo Motor',
    description: 'The servo (D4) starts at 90° and goes to 0° when Button A is pressed.',
    source: servoButtonA0,
  },
  {
    id: '61_servo_button_b_90',
    title: 'Button B → move servo to 90°',
    group: 'Servo Motor',
    description: 'The servo (D4) starts at 0° and goes to 90° when Button B is pressed.',
    source: servoButtonB90,
  },
  {
    id: '62_servo_ultrasonic_10_times',
    title: 'Object < 10 cm → servo 180°, otherwise 0°, repeat 10 times',
    group: 'Servo Motor',
    description: 'Ten times: an object closer than 10 cm sends the servo to 180°, otherwise to 0°.',
    source: servoUltrasonic10,
  },

  // --- DHT Sensor ------------------------------------------------------------
  {
    id: '63_dht_serial',
    title: 'Display temperature and humidity on the Serial Monitor',
    group: 'DHT Sensor',
    description: 'Prints the DHT22 (D5) temperature and humidity every 2 s.',
    source: dhtSerial,
  },
  {
    id: '64_dht_servo_slow',
    title: 'If temperature > 28 °C → move servo to 180° slowly',
    group: 'DHT Sensor',
    description: 'Above 28 °C the servo turns slowly (one degree every 20 ms) from 0° to 180°.',
    source: dhtServoSlow,
  },

  // --- DC Motor --------------------------------------------------------------
  {
    id: '65_motor_button_a_5_times',
    title: 'Button A → turn forward 5 times',
    group: 'DC Motor',
    description: 'Button A runs the DC motor (A0) 5 times for 500 ms with 500 ms stops.',
    source: motorButtonA5,
  },
  {
    id: '66_motor_button_b_5_times_slow',
    title: 'Button B → turn 5 times, slower rhythm',
    group: 'DC Motor',
    description: 'Button B runs the motor 5 times with 1 s runs and 1 s stops (the board cannot reverse the motor: only IN1 is wired).',
    source: motorButtonB5Slow,
  },
];

/** Returns the example with the given id, or undefined when it does not exist. */
export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((example) => example.id === id);
}
