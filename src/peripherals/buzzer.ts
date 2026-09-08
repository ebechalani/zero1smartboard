import type { BoardEvent, BuzzerPeripheral as BuzzerContract, BuzzerState, IBoard } from '../types';
import { PERIPHERAL_IDS } from '../types';

/** Frequency an active buzzer produces on its own when its pin is HIGH. */
const ACTIVE_BUZZER_HZ = 2500;

/**
 * The on-board buzzer.
 *
 * `tone()` on its pin always sounds at the requested frequency. When the board
 * is configured with an active buzzer (`config.buzzerType === 'active'`, the
 * default) a plain `digitalWrite(pin, HIGH)` sounds too, at a fixed pitch; a
 * passive buzzer stays silent without `tone()`. `state.level` mirrors the pin.
 */
export class BuzzerPeripheral implements BuzzerContract {
  readonly id = PERIPHERAL_IDS.BUZZER;
  readonly state: BuzzerState = { freq: null, level: 0 };
  private board: IBoard | null = null;

  constructor(readonly pin: number) {}

  attach(board: IBoard): void {
    this.board = board;
    board.on((e) => this.onEvent(e));
  }

  reset(): void {
    this.state.level = 0;
    this.state.freq = null;
  }

  /** Re-evaluate the sound from the pin (call after `config.buzzerType` changed). */
  refresh(): void {
    if (!this.board) return;
    const { level, tone } = this.board.pins[this.pin];
    this.state.level = level;
    const selfSounding = this.board.config.buzzerType === 'active' && level === 1;
    this.state.freq = tone ?? (selfSounding ? ACTIVE_BUZZER_HZ : null);
  }

  private onEvent(e: BoardEvent): void {
    if (e.type !== 'tone' && e.type !== 'digitalWrite' && e.type !== 'analogWrite') return;
    if (e.pin === this.pin) this.refresh();
  }
}
