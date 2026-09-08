/**
 * `LiquidCrystal_I2C` (docs/ARCHITECTURE.md §6.5): the 16x2 LCD behind its
 * I2C backpack, driven through the `LcdDevice` the LCD peripheral registers
 * on the board. `LiquidCrystal` (the parallel-wired library) is accepted so
 * that a sketch copied from the internet compiles, with a hint that the
 * ZERO1 LCD is on I2C.
 */
import type { LcdDevice } from '../../types';
import type { LibContext } from './print';
import { charCodeOf, cstr, formatPrintArg, intArg, toNumber } from './print';

const DEFAULT_COLS = 16;
const DEFAULT_ROWS = 2;
const ZERO1_LCD_ADDRESS = 0x27;
/** HD44780 `clear`/`home` take about 2 ms during which the sketch waits. */
const CLEAR_HOME_DELAY_MS = 2;
/** The HD44780 A00 character ROM shows the degree sign at this code. */
const DEGREE_CODE = 0xdf;
const QUESTION_MARK = 63;
const CUSTOM_CHAR_ROWS = 8;
const CUSTOM_CHAR_ROW_MASK = 0x1f;

const PARALLEL_LCD_WARNING = 'the ZERO1 LCD is connected over I2C; use LiquidCrystal_I2C lcd(0x27, 16, 2)';
const PRINTLN_WARNING = 'lcd.println() also sends "\\r\\n", which shows as strange characters on an LCD; use lcd.print() and lcd.setCursor()';

/** `Print`-style output shared by both LCD classes. */
export interface ArduinoLcd {
  init(): Promise<void>;
  begin(cols?: unknown, rows?: unknown): Promise<void>;
  clear(): Promise<void>;
  home(): Promise<void>;
  setCursor(col: unknown, row: unknown): void;
  print(value?: unknown, fmt?: unknown): number;
  println(value?: unknown, fmt?: unknown): number;
  write(value: unknown): number;
  printstr(value: unknown): number;
  backlight(): void;
  noBacklight(): void;
  setBacklight(on: unknown): void;
  display(): void;
  noDisplay(): void;
  cursor(): void;
  noCursor(): void;
  blink(): void;
  noBlink(): void;
  createChar(index: unknown, bitmap: unknown): void;
  scrollDisplayLeft(): void;
  scrollDisplayRight(): void;
  autoscroll(): void;
  noAutoscroll(): void;
  leftToRight(): void;
  rightToLeft(): void;
}

/** Map one character of a JS string to the HD44780 code that shows it (or `?`). */
export function lcdCharCode(code: number): number {
  if (code === 0xb0) return DEGREE_CODE;
  return code <= 0xff ? code : QUESTION_MARK;
}

/** Build the `LiquidCrystal_I2C` and `LiquidCrystal` classes for one sketch run. */
export function createLcdClasses(lib: LibContext): Record<string, unknown> {
  const { board, clock } = lib.ctx;

  class LiquidCrystal_I2C implements ArduinoLcd {
    private readonly addr: number;
    private cols: number;
    private rows: number;
    private device: LcdDevice | undefined;
    private initialised = false;

    constructor(addr?: unknown, cols?: unknown, rows?: unknown) {
      this.addr = addr === undefined ? ZERO1_LCD_ADDRESS : intArg(addr);
      this.cols = cols === undefined ? DEFAULT_COLS : intArg(cols);
      this.rows = rows === undefined ? DEFAULT_ROWS : intArg(rows);
    }

    /** The device at our address, looked up on first use; warns once when nothing answers there. */
    private lookup(): LcdDevice | undefined {
      if (this.device) return this.device;
      this.device = board.i2cDevice(this.addr);
      if (!this.device) {
        const hex = this.addr.toString(16).toUpperCase().padStart(2, '0');
        lib.warnOnce(`No I2C LCD found at address 0x${hex} (the ZERO1 LCD is at 0x27)`);
      }
      return this.device;
    }

    /** The device, only once `init()`/`begin()` ran: before that the real controller ignores everything. */
    private ready(): LcdDevice | undefined {
      const device = this.lookup();
      if (!device) return undefined;
      if (!this.initialised) {
        lib.warnOnce('the LCD was used before lcd.init(): call lcd.init() (or lcd.begin()) in setup()');
        return undefined;
      }
      return device;
    }

    async init(): Promise<void> {
      await this.begin();
    }

    async begin(cols?: unknown, rows?: unknown): Promise<void> {
      if (cols !== undefined) this.cols = intArg(cols);
      if (rows !== undefined) this.rows = intArg(rows);
      const device = this.lookup();
      if (!device) return;
      this.initialised = true;
      device.display(true);
      device.cursor(false);
      device.blink(false);
      device.leftToRight();
      device.autoscroll(false);
      device.clear();
      await clock.sleep(CLEAR_HOME_DELAY_MS, lib.ctx.signal);
      device.home();
    }

    async clear(): Promise<void> {
      const device = this.ready();
      if (!device) return;
      device.clear();
      await clock.sleep(CLEAR_HOME_DELAY_MS, lib.ctx.signal);
    }

    async home(): Promise<void> {
      const device = this.ready();
      if (!device) return;
      device.home();
      await clock.sleep(CLEAR_HOME_DELAY_MS, lib.ctx.signal);
    }

    setCursor(col: unknown, row: unknown): void {
      this.ready()?.setCursor(intArg(col), intArg(row));
    }

    print(value?: unknown, fmt?: unknown): number {
      if (value === undefined) return 0;
      return this.writeText(formatPrintArg(value, fmt === undefined ? undefined : toNumber(fmt)));
    }

    println(value?: unknown, fmt?: unknown): number {
      lib.warnOnce(PRINTLN_WARNING);
      const text = value === undefined ? '' : formatPrintArg(value, fmt === undefined ? undefined : toNumber(fmt));
      return this.writeText(text + '\r\n');
    }

    /** `write(code)` sends one raw code (custom chars 0..7, `223` for °); `write("text")` sends every character. */
    write(value: unknown): number {
      if (typeof value === 'string' || Array.isArray(value)) return this.writeText(cstr(value));
      const device = this.ready();
      if (device) device.writeChar(charCodeOf(value));
      return 1;
    }

    printstr(value: unknown): number {
      return this.writeText(cstr(value));
    }

    backlight(): void {
      this.lookup()?.backlight(true);
    }

    noBacklight(): void {
      this.lookup()?.backlight(false);
    }

    setBacklight(on: unknown): void {
      this.lookup()?.backlight(toNumber(on) !== 0);
    }

    display(): void {
      this.ready()?.display(true);
    }

    noDisplay(): void {
      this.ready()?.display(false);
    }

    cursor(): void {
      this.ready()?.cursor(true);
    }

    noCursor(): void {
      this.ready()?.cursor(false);
    }

    blink(): void {
      this.ready()?.blink(true);
    }

    noBlink(): void {
      this.ready()?.blink(false);
    }

    createChar(index: unknown, bitmap: unknown): void {
      const device = this.ready();
      if (!device) return;
      const rows = Array.isArray(bitmap) ? bitmap : [];
      const glyph: number[] = [];
      for (let i = 0; i < CUSTOM_CHAR_ROWS; i++) glyph.push(intArg(rows[i]) & CUSTOM_CHAR_ROW_MASK);
      device.createChar(intArg(index) & 7, glyph);
    }

    scrollDisplayLeft(): void {
      this.ready()?.scrollDisplayLeft();
    }

    scrollDisplayRight(): void {
      this.ready()?.scrollDisplayRight();
    }

    autoscroll(): void {
      this.ready()?.autoscroll(true);
    }

    noAutoscroll(): void {
      this.ready()?.autoscroll(false);
    }

    leftToRight(): void {
      this.ready()?.leftToRight();
    }

    rightToLeft(): void {
      this.ready()?.rightToLeft();
    }

    /** Extra names the LiquidCrystal_I2C library defines as aliases/no-ops. */
    on(): void {
      this.display();
    }

    off(): void {
      this.noDisplay();
    }

    printLeft(): void {
      // Declared but empty in the library.
    }

    printRight(): void {
      // Declared but empty in the library.
    }

    private writeText(text: string): number {
      const device = this.ready();
      if (!device) return text.length;
      for (let i = 0; i < text.length; i++) device.writeChar(lcdCharCode(text.charCodeAt(i)));
      return text.length;
    }
  }

  /** The parallel-wired `LiquidCrystal(rs, en, d4, d5, d6, d7)`: warns and does nothing. */
  class LiquidCrystal implements ArduinoLcd {
    constructor() {
      lib.warnOnce(PARALLEL_LCD_WARNING);
    }

    async init(): Promise<void> {
      // Nothing is wired to those pins.
    }

    async begin(): Promise<void> {
      // Nothing is wired to those pins.
    }

    async clear(): Promise<void> {
      // no-op
    }

    async home(): Promise<void> {
      // no-op
    }

    setCursor(): void {
      // no-op
    }

    print(value?: unknown, fmt?: unknown): number {
      if (value === undefined) return 0;
      return formatPrintArg(value, fmt === undefined ? undefined : toNumber(fmt)).length;
    }

    println(value?: unknown, fmt?: unknown): number {
      return this.print(value, fmt) + 2;
    }

    write(value: unknown): number {
      return typeof value === 'string' || Array.isArray(value) ? cstr(value).length : 1;
    }

    printstr(value: unknown): number {
      return cstr(value).length;
    }

    backlight(): void {
      // no-op
    }

    noBacklight(): void {
      // no-op
    }

    setBacklight(): void {
      // no-op
    }

    display(): void {
      // no-op
    }

    noDisplay(): void {
      // no-op
    }

    cursor(): void {
      // no-op
    }

    noCursor(): void {
      // no-op
    }

    blink(): void {
      // no-op
    }

    noBlink(): void {
      // no-op
    }

    createChar(): void {
      // no-op
    }

    scrollDisplayLeft(): void {
      // no-op
    }

    scrollDisplayRight(): void {
      // no-op
    }

    autoscroll(): void {
      // no-op
    }

    noAutoscroll(): void {
      // no-op
    }

    leftToRight(): void {
      // no-op
    }

    rightToLeft(): void {
      // no-op
    }
  }

  return { LiquidCrystal_I2C, LiquidCrystal };
}
