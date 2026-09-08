import type { BoardEvent, IBoard, MotorPeripheral as MotorContract, MotorState } from '../types';
import { PERIPHERAL_IDS } from '../types';

/** Rotor speed of the animation at full power, in degrees per second. */
const FULL_SPEED_DEG_PER_S = 720;

/**
 * The DC motor behind the H-bridge driver (only IN1 is wired, to A0).
 *
 * The motor runs while its pin is HIGH. A0 has no PWM on the UNO so the motor
 * is really on/off, but a PWM duty is honoured as a speed anyway in case the
 * pin is ever changed. `tick()` spins the rotor for the board animation.
 */
export class MotorPeripheral implements MotorContract {
  readonly id = PERIPHERAL_IDS.MOTOR;
  readonly state: MotorState = { running: false, speed: 0, angle: 0 };
  private board: IBoard | null = null;
  private lastTickMs: number | null = null;

  constructor(readonly pin: number) {}

  attach(board: IBoard): void {
    this.board = board;
    board.on((e) => this.onEvent(e));
  }

  /** Stops the motor; the rotor stays where it is. */
  reset(): void {
    this.state.running = false;
    this.state.speed = 0;
    this.lastTickMs = null;
  }

  tick(nowMs: number): void {
    const dtSeconds = this.lastTickMs === null ? 0 : Math.max(0, nowMs - this.lastTickMs) / 1000;
    this.lastTickMs = nowMs;
    if (this.state.speed > 0 && dtSeconds > 0) {
      this.state.angle = (this.state.angle + this.state.speed * FULL_SPEED_DEG_PER_S * dtSeconds) % 360;
    }
  }

  private onEvent(e: BoardEvent): void {
    if ((e.type !== 'digitalWrite' && e.type !== 'analogWrite') || e.pin !== this.pin || !this.board) return;
    const { level, pwm } = this.board.pins[this.pin];
    this.state.speed = pwm !== null ? pwm / 255 : level;
    this.state.running = this.state.speed > 0;
  }
}
