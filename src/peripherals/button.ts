import type { BoardConfig, ButtonPeripheral as ButtonContract, ButtonState, IBoard } from '../types';

/** Duration of a `click()` when none is given, in milliseconds. */
const DEFAULT_CLICK_MS = 80;

/**
 * One of the two tactile push buttons.
 *
 * Pressing and releasing drives the pin level the board's wiring produces
 * (`config.buttonWiring`): with a pull-down resistor a press reads HIGH, with
 * a pull-up it reads LOW, and with no resistor at all a released button leaves
 * the pin floating (so the sketch needs `INPUT_PULLUP`). The pressed state is
 * physical, so `reset()` only re-applies it.
 */
export class ButtonPeripheral implements ButtonContract {
  readonly state: ButtonState = { pressed: false };
  private board: IBoard | null = null;

  constructor(
    readonly id: string,
    readonly pin: number,
  ) {}

  attach(board: IBoard): void {
    this.board = board;
    // A board reset clears every pin, so drive the level again once it is done.
    board.on((e) => {
      if (e.type === 'reset') this.refresh();
    });
    this.refresh();
  }

  reset(): void {
    this.refresh();
  }

  press(): void {
    this.state.pressed = true;
    this.refresh();
  }

  release(): void {
    this.state.pressed = false;
    this.refresh();
  }

  async click(ms = DEFAULT_CLICK_MS): Promise<void> {
    this.press();
    if (this.board) await this.board.clock.sleep(ms);
    this.release();
  }

  /** Drive the pin level that matches `pressed` and `config.buttonWiring` (call after the wiring setting changes). */
  refresh(): void {
    if (!this.board) return;
    this.board.setDigitalInput(this.pin, wiredLevel(this.board.config.buttonWiring, this.state.pressed));
  }
}

/** Level the pin sees for a given wiring; `null` is a floating pin. */
function wiredLevel(wiring: BoardConfig['buttonWiring'], pressed: boolean): 0 | 1 | null {
  switch (wiring) {
    case 'pulldown':
      return pressed ? 1 : 0;
    case 'pullup':
      return pressed ? 0 : 1;
    case 'none':
      return pressed ? 0 : null;
  }
}
