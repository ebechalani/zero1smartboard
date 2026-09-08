/**
 * Software models of the parts on the ZERO1 Smart Board.
 *
 * Each class implements the matching `...Peripheral` interface from
 * `src/types.ts` and is wired to a board with `board.addPeripheral()`.
 * `createZero1Peripherals()` below builds the full set on the board's fixed
 * pins (docs/PINOUT.md); `createZero1Board()` in `src/zero1.ts` combines it
 * with the runtime `Board`.
 */
import type { BoardConfig, IBoard } from '../types';
import { DEFAULT_BOARD_CONFIG, PERIPHERAL_IDS, Z1 } from '../types';
import { LedPeripheral } from './led';
import { RgbPeripheral } from './rgb';
import { BuzzerPeripheral } from './buzzer';
import { SevenSegPeripheral } from './sevenseg';
import { MotorPeripheral } from './motor';
import { ServoPeripheral } from './servo';
import { PotLdrPeripheral } from './potldr';
import { ButtonPeripheral } from './button';
import { DhtPeripheral } from './dht';
import { UltrasonicPeripheral } from './ultrasonic';
import { LcdPeripheral } from './lcd';

export {
  LedPeripheral,
  RgbPeripheral,
  BuzzerPeripheral,
  SevenSegPeripheral,
  MotorPeripheral,
  ServoPeripheral,
  PotLdrPeripheral,
  ButtonPeripheral,
  DhtPeripheral,
  UltrasonicPeripheral,
  LcdPeripheral,
};

/** The concrete parts of a ZERO1 board, typed as their classes so the settings-refresh methods are reachable. */
export interface Zero1Peripherals {
  ledRed: LedPeripheral;
  ledGreen: LedPeripheral;
  ledBuiltin: LedPeripheral;
  rgb: RgbPeripheral;
  buzzer: BuzzerPeripheral;
  sevenSeg: SevenSegPeripheral;
  motor: MotorPeripheral;
  servo: ServoPeripheral;
  potLdr: PotLdrPeripheral;
  buttonA: ButtonPeripheral;
  buttonB: ButtonPeripheral;
  dht: DhtPeripheral;
  ultrasonic: UltrasonicPeripheral;
  lcd: LcdPeripheral;
}

/** What `applyZero1Config` needs from the board beyond `IBoard` (the runtime `Board` provides it). */
export interface I2CUnregister {
  unregisterI2CDevice(addr: number): void;
}

/** Create every ZERO1 part on its fixed pin, with its `PERIPHERAL_IDS` id, and add it to `board`. */
export function createZero1Peripherals(board: IBoard): Zero1Peripherals {
  const parts: Zero1Peripherals = {
    ledRed: new LedPeripheral(PERIPHERAL_IDS.LED_RED, Z1.LED_RED),
    ledGreen: new LedPeripheral(PERIPHERAL_IDS.LED_GREEN, Z1.LED_GREEN),
    ledBuiltin: new LedPeripheral(PERIPHERAL_IDS.LED_BUILTIN, Z1.LED_BUILTIN),
    rgb: new RgbPeripheral(Z1.RGB),
    buzzer: new BuzzerPeripheral(Z1.BUZZER),
    sevenSeg: new SevenSegPeripheral(Z1.SEG_DATA, Z1.SEG_LATCH, Z1.SEG_CLK),
    motor: new MotorPeripheral(Z1.MOTOR_IN1),
    servo: new ServoPeripheral(Z1.SERVO),
    potLdr: new PotLdrPeripheral(Z1.POT_LDR),
    buttonA: new ButtonPeripheral(PERIPHERAL_IDS.BTN_A, Z1.BTN_A),
    buttonB: new ButtonPeripheral(PERIPHERAL_IDS.BTN_B, Z1.BTN_B),
    dht: new DhtPeripheral(Z1.DHT22),
    ultrasonic: new UltrasonicPeripheral(Z1.US_TRIG, Z1.US_ECHO),
    lcd: new LcdPeripheral(board.config.lcdAddress),
  };
  for (const part of Object.values(parts)) board.addPeripheral(part);
  return parts;
}

/**
 * Apply a settings change to a live board and its parts: `board.config` is
 * updated in place, then the parts that depend on it (buttons, POT/LDR,
 * buzzer, 7-segment) re-apply themselves and the LCD moves to its new I2C
 * address if that changed. Undefined values and unknown keys are ignored.
 */
export function applyZero1Config(
  board: IBoard & I2CUnregister,
  parts: Zero1Peripherals,
  partial: Partial<BoardConfig>,
): void {
  const previousAddress = board.config.lcdAddress;
  const known = new Set(Object.keys(DEFAULT_BOARD_CONFIG));
  const changes = Object.fromEntries(
    Object.entries(partial).filter(([key, value]) => known.has(key) && value !== undefined),
  );
  Object.assign(board.config, changes);

  parts.potLdr.refresh();
  parts.buttonA.refresh();
  parts.buttonB.refresh();
  parts.buzzer.refresh();
  parts.sevenSeg.refresh();
  if (board.config.lcdAddress !== previousAddress) {
    board.unregisterI2CDevice(previousAddress);
    parts.lcd.setAddress(board.config.lcdAddress);
  }
}
