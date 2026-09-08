import type { BoardEvent, IBoard, LedPeripheral as LedContract, LedState } from '../types';

/** Brightness of an LED whose pin is only pulled HIGH by the weak internal pull-up resistor. */
const PULLUP_GLOW = 0.15;

/**
 * A single-colour LED between a pin and GND (through a series resistor).
 *
 * `digitalWrite(pin, HIGH)` lights it fully and `analogWrite` on a PWM pin
 * dims it (`brightness = duty / 255`). `pinMode(pin, INPUT_PULLUP)` makes a
 * real LED glow faintly through the internal pull-up resistor, so that is
 * shown too.
 */
export class LedPeripheral implements LedContract {
  readonly state: LedState = { on: false, brightness: 0 };
  private board: IBoard | null = null;

  constructor(
    readonly id: string,
    readonly pin: number,
  ) {}

  attach(board: IBoard): void {
    this.board = board;
    board.on((e) => this.onEvent(e));
  }

  reset(): void {
    this.state.on = false;
    this.state.brightness = 0;
  }

  private onEvent(e: BoardEvent): void {
    if (!this.board) return;
    if (e.type === 'pinMode' && e.pin === this.pin && e.mode === 'INPUT_PULLUP') {
      this.state.on = true;
      this.state.brightness = PULLUP_GLOW;
      return;
    }
    if ((e.type !== 'digitalWrite' && e.type !== 'analogWrite') || e.pin !== this.pin) return;
    const { level, pwm } = this.board.pins[this.pin];
    this.state.on = level === 1 || (pwm !== null && pwm > 0);
    this.state.brightness = pwm !== null ? pwm / 255 : level;
  }
}
