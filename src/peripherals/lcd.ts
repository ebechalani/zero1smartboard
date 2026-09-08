import type { IBoard, LcdPeripheral as LcdContract, LcdState } from '../types';
import { DEFAULT_BOARD_CONFIG, PERIPHERAL_IDS } from '../types';

/** Display memory columns per row on an HD44780; only `cols` of them are visible at a time. */
const DDRAM_COLS = 40;
/** Character code of an empty cell. */
const BLANK = 32;
const CUSTOM_CHAR_COUNT = 8;
const CUSTOM_CHAR_ROWS = 8;
/** Custom glyphs are 5 pixels wide. */
const CUSTOM_CHAR_ROW_MASK = 0x1f;

/**
 * The 16x2 character LCD behind its PCF8574 I2C backpack (HD44780 controller).
 *
 * Models the controller closely enough for real sketches: 40 columns of
 * display memory per row of which `cols` are visible, the cursor with wrap to
 * the next row after column 39, the display shift (`scrollDisplayLeft/Right`
 * and autoscroll), the writing direction, 8 custom characters and the
 * display / cursor / blink / backlight flags.
 *
 * `state.chars` is the visible window (`rows` x `cols`). `state.scroll` is
 * the memory column shown in the first visible column, and `state.cursorCol`
 * is the cursor's memory column (0..39); the cursor is visible at column
 * `(cursorCol - scroll + 40) % 40` when that is below `cols`.
 *
 * The backlight starts off, like real hardware after `lcd.init()`, until the
 * sketch calls `backlight()`. The board's physical Backlight slide switch
 * (`backlightSwitch`) is in series with it and, being physical, survives
 * `reset()`.
 */
export class LcdPeripheral implements LcdContract {
  readonly id = PERIPHERAL_IDS.LCD;
  readonly kind: 'lcd' = 'lcd';
  readonly state: LcdState;
  private board: IBoard | null = null;
  private addr: number;
  /** Display memory: `rows` x `DDRAM_COLS` character codes. */
  private readonly memory: number[][];
  private autoscrollOn = false;
  private writeLeftToRight = true;

  constructor(
    address: number = DEFAULT_BOARD_CONFIG.lcdAddress,
    readonly cols = 16,
    readonly rows = 2,
  ) {
    this.addr = address;
    this.memory = Array.from({ length: rows }, () => new Array<number>(DDRAM_COLS).fill(BLANK));
    this.state = {
      cols,
      rows,
      backlight: false,
      displayOn: true,
      cursorCol: 0,
      cursorRow: 0,
      cursorVisible: false,
      blink: false,
      chars: Array.from({ length: rows }, () => new Array<number>(cols).fill(BLANK)),
      customChars: Array.from({ length: CUSTOM_CHAR_COUNT }, () => new Array<number>(CUSTOM_CHAR_ROWS).fill(0)),
      scroll: 0,
      backlightSwitch: true,
    };
  }

  /** Current I2C address (`config.lcdAddress`). */
  get address(): number {
    return this.addr;
  }

  attach(board: IBoard): void {
    this.board = board;
    board.registerI2CDevice(this.addr, this);
  }

  /** Register the LCD at another I2C address (the backpack's address changed in Settings). */
  setAddress(address: number): void {
    this.addr = address;
    this.board?.registerI2CDevice(address, this);
  }

  reset(): void {
    this.clear();
    this.state.backlight = false;
    this.state.displayOn = true;
    this.state.cursorVisible = false;
    this.state.blink = false;
    this.autoscrollOn = false;
    for (const glyph of this.state.customChars) glyph.fill(0);
  }

  setBacklightSwitch(on: boolean): void {
    this.state.backlightSwitch = on;
  }

  // --- LcdDevice: driven by the LiquidCrystal_I2C library emulation ---

  /** Blank the whole memory, return home and (like the real command) write left to right again. */
  clear(): void {
    for (const row of this.memory) row.fill(BLANK);
    this.writeLeftToRight = true;
    this.home();
  }

  home(): void {
    this.state.cursorCol = 0;
    this.state.cursorRow = 0;
    this.state.scroll = 0;
    this.refreshWindow();
  }

  setCursor(col: number, row: number): void {
    this.state.cursorCol = clampIndex(col, DDRAM_COLS - 1);
    this.state.cursorRow = clampIndex(row, this.rows - 1);
  }

  writeChar(code: number): void {
    this.memory[this.state.cursorRow][this.state.cursorCol] = code & 0xff;
    this.advanceCursor();
    if (this.autoscrollOn) this.shiftWindow(this.writeLeftToRight ? 1 : -1);
    this.refreshWindow();
  }

  backlight(on: boolean): void {
    this.state.backlight = on;
  }

  display(on: boolean): void {
    this.state.displayOn = on;
  }

  cursor(on: boolean): void {
    this.state.cursorVisible = on;
  }

  blink(on: boolean): void {
    this.state.blink = on;
  }

  createChar(index: number, bitmap: number[]): void {
    const glyph = this.state.customChars[index & (CUSTOM_CHAR_COUNT - 1)];
    for (let row = 0; row < CUSTOM_CHAR_ROWS; row++) {
      glyph[row] = (bitmap[row] ?? 0) & CUSTOM_CHAR_ROW_MASK;
    }
  }

  scrollDisplayLeft(): void {
    this.shiftWindow(1);
    this.refreshWindow();
  }

  scrollDisplayRight(): void {
    this.shiftWindow(-1);
    this.refreshWindow();
  }

  autoscroll(on: boolean): void {
    this.autoscrollOn = on;
  }

  leftToRight(): void {
    this.writeLeftToRight = true;
  }

  rightToLeft(): void {
    this.writeLeftToRight = false;
  }

  private advanceCursor(): void {
    const s = this.state;
    if (this.writeLeftToRight) {
      s.cursorCol += 1;
      if (s.cursorCol >= DDRAM_COLS) {
        s.cursorCol = 0;
        s.cursorRow = (s.cursorRow + 1) % this.rows;
      }
    } else {
      s.cursorCol -= 1;
      if (s.cursorCol < 0) {
        s.cursorCol = DDRAM_COLS - 1;
        s.cursorRow = (s.cursorRow + this.rows - 1) % this.rows;
      }
    }
  }

  /** Move the visible window over the memory (`+1` makes the text appear to move left). */
  private shiftWindow(delta: number): void {
    this.state.scroll = (this.state.scroll + delta + DDRAM_COLS) % DDRAM_COLS;
  }

  private refreshWindow(): void {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this.state.chars[row][col] = this.memory[row][(col + this.state.scroll) % DDRAM_COLS];
      }
    }
  }
}

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}
