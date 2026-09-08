/**
 * The ZERO1 Smart Board: an Arduino UNO `Board` with every on-board part
 * attached to its fixed pin (see docs/PINOUT.md).
 */
import type {
  BoardConfig,
  ButtonPeripheral,
  BuzzerPeripheral,
  Clock,
  DhtPeripheral,
  IBoard,
  LcdPeripheral,
  LedPeripheral,
  MotorPeripheral,
  PotLdrPeripheral,
  RgbPeripheral,
  ServoPeripheral,
  SevenSegPeripheral,
  UltrasonicPeripheral,
} from './types';
import { Board } from './runtime/board';
import { applyZero1Config, createZero1Peripherals, type Zero1Peripherals } from './peripherals';

export { applyZero1Config, createZero1Peripherals, type I2CUnregister, type Zero1Peripherals } from './peripherals';

/** A ZERO1 board: the UNO `IBoard` plus typed access to every on-board part and to its live settings. */
export interface Zero1Board extends IBoard {
  readonly ledRed: LedPeripheral;
  readonly ledGreen: LedPeripheral;
  readonly ledBuiltin: LedPeripheral;
  readonly rgb: RgbPeripheral;
  readonly buzzer: BuzzerPeripheral;
  readonly sevenSeg: SevenSegPeripheral;
  readonly motor: MotorPeripheral;
  readonly servo: ServoPeripheral;
  readonly potLdr: PotLdrPeripheral;
  readonly buttonA: ButtonPeripheral;
  readonly buttonB: ButtonPeripheral;
  readonly dht: DhtPeripheral;
  readonly ultrasonic: UltrasonicPeripheral;
  readonly lcd: LcdPeripheral;
  /**
   * Change settings while the board is live: `config` is updated in place and
   * the parts that depend on it (buttons, POT/LDR, buzzer, 7-segment, LCD
   * address) re-apply themselves. Undefined values and unknown keys are ignored.
   */
  applyConfig(partial: Partial<BoardConfig>): void;
}

class Zero1BoardImpl extends Board implements Zero1Board {
  private readonly parts: Zero1Peripherals;

  constructor(clock: Clock, config?: Partial<BoardConfig>) {
    super(clock, config);
    this.parts = createZero1Peripherals(this);
  }

  get ledRed(): LedPeripheral {
    return this.parts.ledRed;
  }
  get ledGreen(): LedPeripheral {
    return this.parts.ledGreen;
  }
  get ledBuiltin(): LedPeripheral {
    return this.parts.ledBuiltin;
  }
  get rgb(): RgbPeripheral {
    return this.parts.rgb;
  }
  get buzzer(): BuzzerPeripheral {
    return this.parts.buzzer;
  }
  get sevenSeg(): SevenSegPeripheral {
    return this.parts.sevenSeg;
  }
  get motor(): MotorPeripheral {
    return this.parts.motor;
  }
  get servo(): ServoPeripheral {
    return this.parts.servo;
  }
  get potLdr(): PotLdrPeripheral {
    return this.parts.potLdr;
  }
  get buttonA(): ButtonPeripheral {
    return this.parts.buttonA;
  }
  get buttonB(): ButtonPeripheral {
    return this.parts.buttonB;
  }
  get dht(): DhtPeripheral {
    return this.parts.dht;
  }
  get ultrasonic(): UltrasonicPeripheral {
    return this.parts.ultrasonic;
  }
  get lcd(): LcdPeripheral {
    return this.parts.lcd;
  }

  applyConfig(partial: Partial<BoardConfig>): void {
    applyZero1Config(this, this.parts, partial);
  }
}

/** Build a ZERO1 Smart Board: an Arduino UNO `Board` with all of its parts attached. */
export function createZero1Board(clock: Clock, config?: Partial<BoardConfig>): Zero1Board {
  return new Zero1BoardImpl(clock, config);
}
