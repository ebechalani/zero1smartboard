/**
 * The part-by-part Python examples 40–59 (docs/PYTHON.md §9): the Python twins of the `.ino`
 * worksheets of the LED, Buzzer, Push Button, RGB LED, LDR, Seven-Segment, Ultrasonic, Servo
 * Motor, DHT Sensor and DC Motor groups, in the order of EXAMPLES.
 *
 * Each entry is written like the lessons of ./index.ts: `import name from './NN_name.py?raw';`
 * and `{ id, title, group, description, python: name }` with the twin's id, title and group.
 */
import type { PythonExample } from './index';
import ledBlinkRed from './40_led_blink_red.py?raw';
import ledRedGreen from './41_led_red_green.py?raw';
import ledBlink10 from './42_led_blink_10_times.py?raw';
import buzzerShortBeeps from './43_buzzer_short_beeps.py?raw';
import buzzerLed10 from './44_buzzer_led_10_times.py?raw';
import buttonsLeds from './45_buttons_leds.py?raw';
import buttonsBeeps from './46_buttons_beeps.py?raw';
import rgbRedGreenBlue from './47_rgb_red_green_blue.py?raw';
import rgbButtons from './48_rgb_buttons.py?raw';
import ldrSerial from './49_ldr_serial.py?raw';
import ldrRedGreen from './50_ldr_red_green.py?raw';
import segButtonsCount from './51_seg_buttons_count.py?raw';
import ultrasonicSerial from './52_ultrasonic_serial.py?raw';
import ultrasonicRedGreen from './53_ultrasonic_red_green.py?raw';
import ultrasonicBeepRate from './54_ultrasonic_beep_rate.py?raw';
import servoButtons from './55_servo_buttons.py?raw';
import servoUltrasonic10 from './56_servo_ultrasonic_10_times.py?raw';
import dhtSerial from './57_dht_serial.py?raw';
import dhtServoSlow from './58_dht_servo_slow.py?raw';
import motorButtons from './59_motor_buttons.py?raw';

/** Every part-by-part Python example, in menu order (after the lessons). */
export const PYTHON_PART_EXAMPLES: PythonExample[] = [
  // --- LED -------------------------------------------------------------------
  {
    id: '40_led_blink_red',
    title: 'Blink the red LED',
    group: 'LED',
    description: 'The red LED (A1) is on for 500 ms and off for 500 ms, forever: led.on(), led.off() and sleep().',
    python: ledBlinkRed,
  },
  {
    id: '41_led_red_green',
    title: 'Blink red and green alternately',
    group: 'LED',
    description: 'Red (A1) and green (A2) take turns every 500 ms; the old one goes off before the new one comes on.',
    python: ledRedGreen,
  },
  {
    id: '42_led_blink_10_times',
    title: 'Blink the red LED 10 times',
    group: 'LED',
    description: 'A for loop blinks the red LED exactly 10 times and prints Done; with no while True: the program then ends.',
    python: ledBlink10,
  },

  // --- Buzzer ----------------------------------------------------------------
  {
    id: '43_buzzer_short_beeps',
    title: 'Short beeps forever',
    group: 'Buzzer',
    description: 'The active buzzer (D8) sounds 100 ms and rests 400 ms, forever, switched like an LED with Pin(BUZZER, Pin.OUT).',
    python: buzzerShortBeeps,
  },
  {
    id: '44_buzzer_led_10_times',
    title: 'Beep 10 times with the red LED',
    group: 'Buzzer',
    description: 'A beep() function switches the buzzer and the red LED on (200 ms) and off (300 ms) together, exactly 10 times.',
    python: buzzerLed10,
  },

  // --- Push Button -----------------------------------------------------------
  {
    id: '45_buttons_leds',
    title: 'Buttons light the LEDs',
    group: 'Push Button',
    description: 'The red LED is on while Button 1 (D6) is held and the green LED while Button 2 (D7) is held: button.value() and if / else.',
    python: buttonsLeds,
  },
  {
    id: '46_buttons_beeps',
    title: 'Buttons: short beep and long beep',
    group: 'Push Button',
    description: 'A press of Button 1 gives one 100 ms beep, a press of Button 2 one 1 s beep, with def beep(ms=100); holding does not repeat.',
    python: buttonsBeeps,
  },

  // --- RGB LED ---------------------------------------------------------------
  {
    id: '47_rgb_red_green_blue',
    title: 'RGB LED: red, green, blue',
    group: 'RGB LED',
    description: 'The NeoPixel RGB LED (D9) shows red, green and blue for 1 s each, forever, with (r, g, b) colour constants.',
    python: rgbRedGreenBlue,
  },
  {
    id: '48_rgb_buttons',
    title: 'Buttons colour the RGB LED',
    group: 'RGB LED',
    description: 'Button 1 makes the RGB LED red, Button 2 makes it green; otherwise it is off (if / elif / else).',
    python: rgbButtons,
  },

  // --- LDR -------------------------------------------------------------------
  {
    id: '49_ldr_serial',
    title: 'Show the light level on the Serial Monitor',
    group: 'LDR',
    description: 'Prints the light sensor value (A3, switch on LDR) every 500 ms with ADC(POT_LDR).read().',
    python: ldrSerial,
  },
  {
    id: '50_ldr_red_green',
    title: 'Night light: red when dark, green when bright',
    group: 'LDR',
    description: 'Below 500 the red LED is on, otherwise the green one; the value is printed every 500 ms (A3, switch on LDR).',
    python: ldrRedGreen,
  },

  // --- Seven-Segment ---------------------------------------------------------
  {
    id: '51_seg_buttons_count',
    title: 'Count up and down with the buttons',
    group: 'Seven-Segment',
    description: 'Button 1 counts 1, 2, 3, 4 and Button 2 counts 7 down to 1 on the 7-segment display with SevenSegment().show().',
    python: segButtonsCount,
  },

  // --- Ultrasonic ------------------------------------------------------------
  {
    id: '52_ultrasonic_serial',
    title: 'Show the distance on the Serial Monitor',
    group: 'Ultrasonic',
    description: 'Measures the distance with HCSR04().distance_cm() (TRIG D3, ECHO D2) and prints it every 500 ms; except OSError: no echo.',
    python: ultrasonicSerial,
  },
  {
    id: '53_ultrasonic_red_green',
    title: 'Distance alarm: red LED near, green LED far',
    group: 'Ultrasonic',
    description: 'The red LED lights when an object is closer than 10 cm, the green LED otherwise; the distance is printed.',
    python: ultrasonicRedGreen,
  },
  {
    id: '54_ultrasonic_beep_rate',
    title: 'Parking beeper: faster beeps when closer',
    group: 'Ultrasonic',
    description: 'The buzzer beeps 50 ms, then waits 10 ms per centimetre, kept between 50 and 1000 ms with min() and max().',
    python: ultrasonicBeepRate,
  },

  // --- Servo Motor -----------------------------------------------------------
  {
    id: '55_servo_buttons',
    title: 'Buttons move the servo (0° and 90°)',
    group: 'Servo Motor',
    description: 'Button 1 sends the servo (D4) to 0 degrees and Button 2 to 90 degrees with Servo().angle(); the angle is printed.',
    python: servoButtons,
  },
  {
    id: '56_servo_ultrasonic_10_times',
    title: 'Servo reacts to the ultrasonic sensor, 10 times',
    group: 'Servo Motor',
    description: 'Ten rounds, one per second: an object closer than 10 cm sends the servo to 180 degrees, otherwise to 0; then the program ends.',
    python: servoUltrasonic10,
  },

  // --- DHT Sensor ------------------------------------------------------------
  {
    id: '57_dht_serial',
    title: 'Show temperature and humidity on the Serial Monitor',
    group: 'DHT Sensor',
    description: 'Prints the DHT22 (D5) temperature and humidity on one line every 2 s: sensor.measure() with except OSError.',
    python: dhtSerial,
  },
  {
    id: '58_dht_servo_slow',
    title: 'Servo turns slowly when it is hot (above 28 °C)',
    group: 'DHT Sensor',
    description: 'Above 28 C the servo turns slowly (one degree every 15 ms) from 0 to 180 degrees with turn_slowly(); otherwise it is at 0.',
    python: dhtServoSlow,
  },

  // --- DC Motor --------------------------------------------------------------
  {
    id: '59_motor_buttons',
    title: 'Buttons run the motor',
    group: 'DC Motor',
    description: 'Button 1 runs the DC motor (A0) 5 times for 500 ms, Button 2 5 times for 1 s (the board cannot reverse the motor: only IN1 is wired).',
    python: motorButtons,
  },
];
