import type { BoardEvent, IBoard, RgbPeripheral as RgbContract, RgbState } from '../types';
import { PERIPHERAL_IDS } from '../types';

/**
 * The on-board WS2812B ("NeoPixel") RGB LED, driven from a single data pin.
 *
 * Shows the first colour of every `pixels` frame the sketch sends to its pin
 * (`Adafruit_NeoPixel::show()`); the library has already applied its
 * brightness setting. Extra pixels declared by the sketch are counted but not
 * displayed, because the board has only one.
 */
export class RgbPeripheral implements RgbContract {
  readonly id = PERIPHERAL_IDS.RGB;
  readonly state: RgbState = { r: 0, g: 0, b: 0, count: 0 };

  constructor(readonly pin: number) {}

  attach(board: IBoard): void {
    board.on((e) => this.onEvent(e));
  }

  reset(): void {
    this.state.r = 0;
    this.state.g = 0;
    this.state.b = 0;
    this.state.count = 0;
  }

  private onEvent(e: BoardEvent): void {
    if (e.type !== 'pixels' || e.pin !== this.pin) return;
    const packed = e.colors[0] ?? 0;
    this.state.r = (packed >> 16) & 0xff;
    this.state.g = (packed >> 8) & 0xff;
    this.state.b = packed & 0xff;
    this.state.count = e.colors.length;
  }
}
