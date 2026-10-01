/**
 * The ZERO1 pin constants a generated sketch may declare (docs/BLOCKS.md §11.2), shared by the
 * Blocks generator and the Python translator (docs/PYTHON.md §3.1, §4.2). Blockly-free.
 */

/** Names of the pin constants a sketch may declare (docs/BLOCKS.md §11.2). */
export type PinName =
  | 'LED_RED'
  | 'LED_GREEN'
  | 'LED_BUILTIN'
  | 'BUTTON_1'
  | 'BUTTON_2'
  | 'POT_LDR'
  | 'MOTOR'
  | 'SERVO_PIN'
  | 'BUZZER'
  | 'DHT_PIN'
  | 'TRIG_PIN'
  | 'ECHO_PIN'
  | 'RGB_PIN'
  | 'SEG_DATA'
  | 'SEG_LATCH'
  | 'SEG_CLOCK';

export interface PinInfo {
  name: PinName;
  /** Arduino pin expression; null for LED_BUILTIN which already exists. */
  value: string | null;
  /** The pinMode() the Blocks generator adds to setup() when the pin is used (null: none). */
  mode: 'OUTPUT' | 'INPUT' | null;
  comment: string;
}

/** Every pin, in the order the constants and pinMode() lines are emitted. */
export const PINS: readonly PinInfo[] = [
  { name: 'LED_RED', value: 'A1', mode: 'OUTPUT', comment: 'red LED' },
  { name: 'LED_GREEN', value: 'A2', mode: 'OUTPUT', comment: 'green LED' },
  { name: 'LED_BUILTIN', value: null, mode: 'OUTPUT', comment: 'built-in LED' },
  { name: 'BUTTON_1', value: '6', mode: 'INPUT', comment: 'push button 1' },
  { name: 'BUTTON_2', value: '7', mode: 'INPUT', comment: 'push button 2' },
  { name: 'POT_LDR', value: 'A3', mode: null, comment: 'potentiometer or LDR (jumper)' },
  { name: 'MOTOR', value: 'A0', mode: 'OUTPUT', comment: 'DC motor driver' },
  { name: 'SERVO_PIN', value: '4', mode: null, comment: 'servo signal' },
  { name: 'BUZZER', value: '8', mode: 'OUTPUT', comment: 'buzzer' },
  { name: 'DHT_PIN', value: '5', mode: null, comment: 'DHT22 temperature / humidity sensor' },
  { name: 'TRIG_PIN', value: '3', mode: 'OUTPUT', comment: 'ultrasonic trigger' },
  { name: 'ECHO_PIN', value: '2', mode: 'INPUT', comment: 'ultrasonic echo' },
  { name: 'RGB_PIN', value: '9', mode: null, comment: 'RGB LED (WS2812)' },
  { name: 'SEG_DATA', value: '12', mode: 'OUTPUT', comment: '7-segment: 74HC595 data' },
  { name: 'SEG_LATCH', value: '11', mode: 'OUTPUT', comment: '7-segment: 74HC595 latch' },
  { name: 'SEG_CLOCK', value: '10', mode: 'OUTPUT', comment: '7-segment: 74HC595 clock' },
];
