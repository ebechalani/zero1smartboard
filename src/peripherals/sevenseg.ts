import type { BoardEvent, IBoard, SevenSegPeripheral as SevenSegContract, SevenSegState } from '../types';
import { PERIPHERAL_IDS } from '../types';

/** Outputs of the 74HC595: one per segment a..g plus the decimal point. */
const SEGMENT_COUNT = 8;

/**
 * The single 7-segment digit, driven by a 74HC595 shift register.
 *
 * Every rising edge on the clock pin shifts the data pin's level into the
 * shift register; a rising edge on the latch pin copies the shift register to
 * the outputs (`latched`). Which output lights which segment, and whether a
 * 1 or a 0 lights it, follow `config.sevenSegOrder` and
 * `config.sevenSegCommon`. This is exactly what `shiftOut()` followed by a
 * latch pulse produces.
 */
export class SevenSegPeripheral implements SevenSegContract {
  readonly id = PERIPHERAL_IDS.SEVEN_SEG;
  readonly state: SevenSegState = {
    segments: new Array<boolean>(SEGMENT_COUNT).fill(false),
    latched: 0,
    shift: 0,
  };
  private board: IBoard | null = null;

  constructor(
    readonly dataPin: number,
    readonly latchPin: number,
    readonly clockPin: number,
  ) {}

  attach(board: IBoard): void {
    this.board = board;
    board.on((e) => this.onEvent(e));
    this.refresh();
  }

  reset(): void {
    this.state.shift = 0;
    this.state.latched = 0;
    this.refresh();
  }

  /** Recompute the lit segments from the latched byte and the board settings. */
  refresh(): void {
    if (!this.board) return;
    const { sevenSegOrder, sevenSegCommon } = this.board.config;
    for (let segment = 0; segment < SEGMENT_COUNT; segment++) {
      const bit = sevenSegOrder === 'Q0=a' ? segment : SEGMENT_COUNT - 1 - segment;
      const outputHigh = ((this.state.latched >> bit) & 1) === 1;
      this.state.segments[segment] = sevenSegCommon === 'anode' ? !outputHigh : outputHigh;
    }
  }

  private onEvent(e: BoardEvent): void {
    if (e.type !== 'digitalWrite' || !this.board) return;
    const risingEdge = e.prev === 0 && e.level === 1;
    if (!risingEdge) return;
    if (e.pin === this.clockPin) {
      const dataBit = this.board.pins[this.dataPin].level;
      this.state.shift = ((this.state.shift << 1) | dataBit) & 0xff;
    } else if (e.pin === this.latchPin) {
      this.state.latched = this.state.shift;
      this.refresh();
    }
  }
}
