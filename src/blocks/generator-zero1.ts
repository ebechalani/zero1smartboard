/**
 * Arduino code for the ZERO1 board blocks (`z1_*`, docs/BLOCKS.md §11.2).
 *
 * Each generator registers what the finished sketch needs (pins, library
 * objects, helpers, Serial) on the generator and returns the statement or
 * the [expression, precedence] tuple listed in the contract.
 */
import type * as Blockly from 'blockly';
import { NOTES, RGB_COLOURS } from './blocks';
import { Order, formatNumber, type ArduinoGenerator, type PinName } from './generator';

type Block = Blockly.Block;
type Value = [string, Order];

const LED_PINS: Record<string, PinName> = { RED: 'LED_RED', GREEN: 'LED_GREEN', BUILTIN: 'LED_BUILTIN' };

function ledPin(block: Block, gen: ArduinoGenerator): string {
  return gen.usePin(LED_PINS[String(block.getFieldValue('LED'))] ?? 'LED_RED');
}

function level(block: Block, field = 'STATE'): string {
  return block.getFieldValue(field) === 'OFF' ? 'LOW' : 'HIGH';
}

function rgbShow(gen: ArduinoGenerator, r: string, g: string, b: string): string {
  const pixels = gen.useObject('pixels');
  return `${pixels}.setPixelColor(0, ${pixels}.Color(${r}, ${g}, ${b}));\n${pixels}.show();\n`;
}

function playTone(gen: ArduinoGenerator, frequency: string, duration: string): string {
  const buzzer = gen.usePin('BUZZER');
  return `tone(${buzzer}, ${frequency});\ndelay(${duration});\nnoTone(${buzzer});\n`;
}

/** Install the `forBlock` entries for the z1_* blocks on a generator. */
export function installZero1Generators(g: ArduinoGenerator): void {
  const f = g.forBlock;

  // --- hats ------------------------------------------------------------------

  f['z1_setup_hat'] = (block: Block, gen: ArduinoGenerator): null => {
    gen.addSetupCode(gen.statementToCode(block, 'DO'));
    return null;
  };

  f['z1_loop_hat'] = (block: Block, gen: ArduinoGenerator): null => {
    gen.addLoopCode(gen.statementToCode(block, 'DO'));
    return null;
  };

  // --- Board · outputs -------------------------------------------------------

  f['z1_led_set'] = (block: Block, gen: ArduinoGenerator): string => {
    return `digitalWrite(${ledPin(block, gen)}, ${level(block)});\n`;
  };

  f['z1_led_toggle'] = (block: Block, gen: ArduinoGenerator): string => {
    const pin = ledPin(block, gen);
    return `digitalWrite(${pin}, !digitalRead(${pin}));\n`;
  };

  f['z1_rgb_colour'] = (block: Block, gen: ArduinoGenerator): string => {
    const value = String(block.getFieldValue('COLOUR'));
    const colour = RGB_COLOURS.find((c) => c.value === value) ?? RGB_COLOURS[RGB_COLOURS.length - 1]!;
    const [r, gr, b] = colour.rgb;
    return rgbShow(gen, String(r), String(gr), String(b));
  };

  f['z1_rgb_set'] = (block: Block, gen: ArduinoGenerator): string => {
    const r = gen.value(block, 'R', Order.NONE, '0');
    const gr = gen.value(block, 'G', Order.NONE, '0');
    const b = gen.value(block, 'B', Order.NONE, '0');
    return rgbShow(gen, r, gr, b);
  };

  f['z1_rgb_brightness'] = (block: Block, gen: ArduinoGenerator): string => {
    const pixels = gen.useObject('pixels');
    const value = gen.value(block, 'VALUE', Order.NONE, '0');
    return `${pixels}.setBrightness(${value});\n${pixels}.show();\n`;
  };

  f['z1_buzzer_tone'] = (block: Block, gen: ArduinoGenerator): string => {
    const frequency = gen.value(block, 'FREQ', Order.NONE, '0');
    const duration = gen.value(block, 'DURATION', Order.NONE, '0');
    return playTone(gen, frequency, duration);
  };

  f['z1_buzzer_note'] = (block: Block, gen: ArduinoGenerator): string => {
    const value = String(block.getFieldValue('NOTE'));
    const note = NOTES.find((n) => n.value === value) ?? NOTES[0]!;
    const duration = gen.value(block, 'DURATION', Order.NONE, '0');
    return playTone(gen, String(note.hz), duration);
  };

  f['z1_buzzer_set'] = (block: Block, gen: ArduinoGenerator): string => {
    return `digitalWrite(${gen.usePin('BUZZER')}, ${level(block)});\n`;
  };

  f['z1_sevenseg_digit'] = (block: Block, gen: ArduinoGenerator): string => {
    const digit = gen.value(block, 'DIGIT', Order.NONE, '0');
    return `${gen.useHelper('showDigit')}(${digit});\n`;
  };

  f['z1_sevenseg_clear'] = (_block: Block, gen: ArduinoGenerator): string => {
    return `${gen.useHelper('showSegments')}(0);\n`;
  };

  f['z1_motor_set'] = (block: Block, gen: ArduinoGenerator): string => {
    return `digitalWrite(${gen.usePin('MOTOR')}, ${level(block)});\n`;
  };

  f['z1_servo_angle'] = (block: Block, gen: ArduinoGenerator): string => {
    const servo = gen.useObject('servo');
    return `${servo}.write(${gen.value(block, 'ANGLE', Order.NONE, '0')});\n`;
  };

  f['z1_lcd_print'] = (block: Block, gen: ArduinoGenerator): string => {
    const lcd = gen.useObject('lcd');
    const text = gen.value(block, 'TEXT', Order.NONE, '""');
    const row = block.getFieldValue('ROW') === '1' ? '1' : '0';
    const col = gen.value(block, 'COL', Order.NONE, '0');
    return `${lcd}.setCursor(${col}, ${row});\n${lcd}.print(${text});\n`;
  };

  f['z1_lcd_line'] = (block: Block, gen: ArduinoGenerator): string => {
    const lcd = gen.useObject('lcd');
    const text = gen.value(block, 'TEXT', Order.NONE, '""');
    const row = block.getFieldValue('ROW') === '1' ? '1' : '0';
    return `${lcd}.setCursor(0, ${row});\n${lcd}.print("                ");\n${lcd}.setCursor(0, ${row});\n${lcd}.print(${text});\n`;
  };

  f['z1_lcd_clear'] = (_block: Block, gen: ArduinoGenerator): string => {
    return `${gen.useObject('lcd')}.clear();\n`;
  };

  f['z1_lcd_backlight'] = (block: Block, gen: ArduinoGenerator): string => {
    const lcd = gen.useObject('lcd');
    return block.getFieldValue('STATE') === 'OFF' ? `${lcd}.noBacklight();\n` : `${lcd}.backlight();\n`;
  };

  // --- Board · inputs --------------------------------------------------------

  f['z1_button_pressed'] = (block: Block, gen: ArduinoGenerator): Value => {
    const pin = gen.usePin(block.getFieldValue('BUTTON') === '2' ? 'BUTTON_2' : 'BUTTON_1');
    return [`(digitalRead(${pin}) == HIGH)`, Order.ATOMIC];
  };

  f['z1_pot_read'] = (_block: Block, gen: ArduinoGenerator): Value => {
    return [`analogRead(${gen.usePin('POT_LDR')})`, Order.UNARY_POSTFIX];
  };

  f['z1_pot_percent'] = (_block: Block, gen: ArduinoGenerator): Value => {
    return [`map(analogRead(${gen.usePin('POT_LDR')}), 0, 1023, 0, 100)`, Order.UNARY_POSTFIX];
  };

  f['z1_ldr_read'] = (_block: Block, gen: ArduinoGenerator): Value => {
    return [`analogRead(${gen.usePin('POT_LDR')})`, Order.UNARY_POSTFIX];
  };

  f['z1_ldr_dark'] = (block: Block, gen: ArduinoGenerator): Value => {
    const threshold = gen.value(block, 'THRESHOLD', Order.RELATIONAL, '0');
    return [`(analogRead(${gen.usePin('POT_LDR')}) < ${threshold})`, Order.ATOMIC];
  };

  f['z1_dht_read'] = (block: Block, gen: ArduinoGenerator): Value => {
    const dht = gen.useObject('dht');
    const method = block.getFieldValue('WHAT') === 'HUMIDITY' ? 'readHumidity' : 'readTemperature';
    return [`${dht}.${method}()`, Order.UNARY_POSTFIX];
  };

  f['z1_ultrasonic_cm'] = (_block: Block, gen: ArduinoGenerator): Value => {
    return [`${gen.useHelper('readDistanceCm')}()`, Order.UNARY_POSTFIX];
  };

  // --- Time ------------------------------------------------------------------

  f['z1_delay_ms'] = (block: Block, gen: ArduinoGenerator): string => {
    return `delay(${gen.value(block, 'MS', Order.NONE, '0')});\n`;
  };

  f['z1_delay_s'] = (block: Block, gen: ArduinoGenerator): string => {
    const literal = gen.literalNumber(block, 'S');
    if (literal !== null) return `delay(${formatNumber(Math.round(literal * 1000))});\n`;
    return `delay(${gen.value(block, 'S', Order.MULTIPLICATIVE, '0')} * 1000);\n`;
  };

  f['z1_millis'] = (): Value => {
    return ['millis()', Order.UNARY_POSTFIX];
  };

  f['z1_map'] = (block: Block, gen: ArduinoGenerator): Value => {
    const args = ['VALUE', 'FROM_LOW', 'FROM_HIGH', 'TO_LOW', 'TO_HIGH'].map((name) => gen.value(block, name, Order.NONE, '0'));
    return [`map(${args.join(', ')})`, Order.UNARY_POSTFIX];
  };

  // --- Serial ----------------------------------------------------------------

  f['z1_serial_print'] = (block: Block, gen: ArduinoGenerator): string => {
    gen.useSerial();
    const value = gen.value(block, 'VALUE', Order.NONE, '""');
    const method = block.getFieldValue('NEWLINE') === 'SAME_LINE' ? 'print' : 'println';
    return `Serial.${method}(${value});\n`;
  };

  f['z1_serial_print_labeled'] = (block: Block, gen: ArduinoGenerator): string => {
    gen.useSerial();
    const label = String(block.getFieldValue('LABEL') ?? '');
    const value = gen.value(block, 'VALUE', Order.NONE, '""');
    return `Serial.print(${gen.quote(`${label}: `)});\nSerial.println(${value});\n`;
  };

  f['z1_serial_available'] = (_block: Block, gen: ArduinoGenerator): Value => {
    gen.useSerial();
    return ['(Serial.available() > 0)', Order.ATOMIC];
  };

  f['z1_serial_read_line'] = (_block: Block, gen: ArduinoGenerator): Value => {
    return [`${gen.useHelper('readLine')}()`, Order.UNARY_POSTFIX];
  };
}
