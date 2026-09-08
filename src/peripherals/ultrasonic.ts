import type { BoardEvent, IBoard, UltrasonicPeripheral as UltrasonicContract, UltrasonicState } from '../types';
import { PERIPHERAL_IDS } from '../types';

/** Shortest trigger pulse an HC-SR04 accepts (the datasheet asks for 10 us). */
const MIN_TRIGGER_US = 2;
/** How long after a trigger the echo pulse can still be measured. */
const ECHO_WINDOW_MS = 60;
/** Round-trip time of sound per centimetre of distance. */
const US_PER_CM = 58;
const MIN_DISTANCE_CM = 2;
const MAX_DISTANCE_CM = 400;
const DEFAULT_DISTANCE_CM = 50;

/**
 * The HC-SR04 ultrasonic module plugged into the ULTRASONIC header.
 *
 * Watches the trigger pin: a HIGH pulse of at least 2 us followed by a falling
 * edge is a trigger (`lastPingAt`, recorded whether or not the module is
 * plugged in, so the UI can decide what to animate). `pulseIn(echo, HIGH)`
 * then measures an echo of `distance x 58 us`, but only while the module is
 * plugged in and the trigger is recent (60 ms); otherwise it times out with
 * 0, like a missing sensor. The distance and the plug are physical, so
 * `reset()` keeps them.
 */
export class UltrasonicPeripheral implements UltrasonicContract {
  readonly id = PERIPHERAL_IDS.ULTRASONIC;
  readonly state: UltrasonicState = {
    distanceCm: DEFAULT_DISTANCE_CM,
    connected: true,
    lastPingAt: null,
  };
  private board: IBoard | null = null;
  private trigHighSinceUs: number | null = null;

  constructor(
    readonly trigPin: number,
    readonly echoPin: number,
  ) {}

  attach(board: IBoard): void {
    this.board = board;
    board.on((e) => this.onEvent(e));
    board.registerPulseSource(this.echoPin, { measure: (level) => this.measure(level) });
  }

  reset(): void {
    this.state.lastPingAt = null;
    this.trigHighSinceUs = null;
  }

  setDistance(cm: number): void {
    if (!Number.isFinite(cm)) return;
    this.state.distanceCm = Math.min(MAX_DISTANCE_CM, Math.max(MIN_DISTANCE_CM, cm));
  }

  setConnected(on: boolean): void {
    this.state.connected = on;
  }

  private onEvent(e: BoardEvent): void {
    if (e.type !== 'digitalWrite' || e.pin !== this.trigPin || !this.board) return;
    const nowUs = this.board.clock.micros();
    if (e.prev === 0 && e.level === 1) {
      this.trigHighSinceUs = nowUs;
    } else if (e.prev === 1 && e.level === 0 && this.trigHighSinceUs !== null) {
      const pulseUs = nowUs - this.trigHighSinceUs;
      this.trigHighSinceUs = null;
      if (pulseUs >= MIN_TRIGGER_US) this.state.lastPingAt = this.board.clock.now();
    }
  }

  private measure(level: 0 | 1): number {
    if (level !== 1 || !this.state.connected || this.state.lastPingAt === null || !this.board) return 0;
    if (this.board.clock.now() - this.state.lastPingAt > ECHO_WINDOW_MS) return 0;
    return Math.round(this.state.distanceCm * US_PER_CM);
  }
}
