import type { BoardEvent, IBoard, ServoPeripheral as ServoContract, ServoState } from '../types';
import { PERIPHERAL_IDS } from '../types';

/** How fast an SG90 horn turns (about 0.12 s per 60 degrees), in degrees per second. */
const SLEW_DEG_PER_S = 500;
/** Where the horn sits at power-on: the Servo library's default pulse is the centre position. */
const INITIAL_ANGLE = 90;

/**
 * The SG90 servo plugged into the SERVO header.
 *
 * A `servo` event with an angle means the Servo library is sending pulses on
 * its pin (`attached`); `null` means `detach()`. The horn does not jump: it
 * slews toward `target` in `tick()` at a realistic speed, and only while the
 * module is plugged in (`connected`) and receiving a signal.
 */
export class ServoPeripheral implements ServoContract {
  readonly id = PERIPHERAL_IDS.SERVO;
  readonly state: ServoState = {
    attached: false,
    target: INITIAL_ANGLE,
    angle: INITIAL_ANGLE,
    connected: true,
  };
  private lastTickMs: number | null = null;

  constructor(readonly pin: number) {}

  attach(board: IBoard): void {
    board.on((e) => this.onEvent(e));
  }

  /** Drops the signal; the horn stays where it is and the module stays plugged in. */
  reset(): void {
    this.state.attached = false;
    this.state.target = this.state.angle;
    this.lastTickMs = null;
  }

  setConnected(on: boolean): void {
    this.state.connected = on;
  }

  tick(nowMs: number): void {
    const dtSeconds = this.lastTickMs === null ? 0 : Math.max(0, nowMs - this.lastTickMs) / 1000;
    this.lastTickMs = nowMs;
    if (!this.state.connected || !this.state.attached || dtSeconds <= 0) return;
    const maxStep = SLEW_DEG_PER_S * dtSeconds;
    const remaining = this.state.target - this.state.angle;
    if (Math.abs(remaining) <= maxStep) {
      this.state.angle = this.state.target;
    } else {
      this.state.angle += Math.sign(remaining) * maxStep;
    }
  }

  private onEvent(e: BoardEvent): void {
    if (e.type !== 'servo' || e.pin !== this.pin) return;
    if (e.angle === null) {
      this.state.attached = false;
      return;
    }
    this.state.attached = true;
    this.state.target = Math.min(180, Math.max(0, e.angle));
  }
}
