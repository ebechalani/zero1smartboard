/*
  LiquidCrystal_I2C — ZERO1 Smart Board edition
  ---------------------------------------------
  A 16x2 (or 20x4) HD44780 character LCD behind a PCF8574 I2C "backpack",
  driven in 4-bit mode. Written from the HD44780U and PCF8574 datasheets for
  the ZERO1 Smart Board simulator, as an API-compatible replacement for the
  widely used "LiquidCrystal I2C" library (Frank de Brabander's, 1.1.2) whose
  code carries no licence: every public method keeps the same name and
  signature, so a sketch written for that library compiles and behaves the
  same on the real board. Backpack wiring (the common YwRobot / DFRobot
  layout): P0 = RS, P1 = R/W, P2 = E, P3 = backlight, P4..P7 = D4..D7.

  Copyright (c) 2026 ZERO1 Smart Board simulator contributors
  SPDX-License-Identifier: MIT (see LICENSE)
*/
#ifndef LiquidCrystal_I2C_h
#define LiquidCrystal_I2C_h

#include <inttypes.h>
#include <Arduino.h>
#include <Print.h>
#include <Wire.h>

// HD44780 instruction set (datasheet table 6)
#define LCD_CLEARDISPLAY 0x01
#define LCD_RETURNHOME 0x02
#define LCD_ENTRYMODESET 0x04
#define LCD_DISPLAYCONTROL 0x08
#define LCD_CURSORSHIFT 0x10
#define LCD_FUNCTIONSET 0x20
#define LCD_SETCGRAMADDR 0x40
#define LCD_SETDDRAMADDR 0x80

// entry mode set bits
#define LCD_ENTRYRIGHT 0x00
#define LCD_ENTRYLEFT 0x02
#define LCD_ENTRYSHIFTINCREMENT 0x01
#define LCD_ENTRYSHIFTDECREMENT 0x00

// display on/off control bits
#define LCD_DISPLAYON 0x04
#define LCD_DISPLAYOFF 0x00
#define LCD_CURSORON 0x02
#define LCD_CURSOROFF 0x00
#define LCD_BLINKON 0x01
#define LCD_BLINKOFF 0x00

// cursor/display shift bits
#define LCD_DISPLAYMOVE 0x08
#define LCD_CURSORMOVE 0x00
#define LCD_MOVERIGHT 0x04
#define LCD_MOVELEFT 0x00

// function set bits
#define LCD_8BITMODE 0x10
#define LCD_4BITMODE 0x00
#define LCD_2LINE 0x08
#define LCD_1LINE 0x00
#define LCD_5x10DOTS 0x04
#define LCD_5x8DOTS 0x00

// backpack bits
#define LCD_BACKLIGHT 0x08
#define LCD_NOBACKLIGHT 0x00

#define En 0x04  // Enable
#define Rw 0x02  // Read/Write
#define Rs 0x01  // Register select

class LiquidCrystal_I2C : public Print {
public:
  /** lcd_Addr: I2C address of the backpack (0x27 on the ZERO1, 0x3F on PCF8574A boards). */
  LiquidCrystal_I2C(uint8_t lcd_Addr, uint8_t lcd_cols, uint8_t lcd_rows);

  /** Wire.begin() + the HD44780 power-up sequence; the display is cleared, on, without cursor, backlight off. */
  void init();
  /** Same as init() (the OLED variant of the original library; there is none on the ZERO1). */
  void oled_init();
  /** The power-up sequence alone (init() calls it). charsize: LCD_5x8DOTS or LCD_5x10DOTS (1-line displays only). */
  void begin(uint8_t cols, uint8_t rows, uint8_t charsize = LCD_5x8DOTS);

  void clear();
  void home();
  void setCursor(uint8_t col, uint8_t row);

  void display();
  void noDisplay();
  void cursor();
  void noCursor();
  void blink();
  void noBlink();

  void scrollDisplayLeft();
  void scrollDisplayRight();
  void leftToRight();
  void rightToLeft();
  void autoscroll();
  void noAutoscroll();
  /** Aliases of autoscroll() / noAutoscroll() kept for compatibility. */
  void shiftIncrement();
  void shiftDecrement();
  /** Declared but empty in the original library; kept so sketches compile. */
  void printLeft();
  void printRight();

  void backlight();
  void noBacklight();

  /** Store a 5x8 glyph in CGRAM slot 0..7 (8 rows, 5 low bits each); show it with write(slot). */
  void createChar(uint8_t location, uint8_t charmap[]);
  /** Same, with the rows in PROGMEM. */
  void createChar(uint8_t location, const char *charmap);

  /** Print-interface: one character (or CGRAM code 0..7) at the cursor. */
  virtual size_t write(uint8_t value);
  using Print::write;
  /** Send a raw instruction to the controller. */
  void command(uint8_t value);

  // compatibility aliases (names of the original library)
  void blink_on();
  void blink_off();
  void cursor_on();
  void cursor_off();
  void setBacklight(uint8_t new_val);
  void load_custom_character(uint8_t char_num, uint8_t *rows);
  void printstr(const char c[]);

  // functions the original library declared but never implemented (kept as no-ops)
  uint8_t status();
  void setContrast(uint8_t new_val);
  uint8_t keypad();
  void setDelay(int cmdDelay, int charDelay);
  void on();
  void off();
  uint8_t init_bargraph(uint8_t graphtype);
  void draw_horizontal_graph(uint8_t row, uint8_t column, uint8_t len, uint8_t pixel_col_end);
  void draw_vertical_graph(uint8_t row, uint8_t column, uint8_t len, uint8_t pixel_col_end);

private:
  void send(uint8_t value, uint8_t mode);
  void write4bits(uint8_t nibbleInHighBits);
  void expanderWrite(uint8_t data);
  void pulseEnable(uint8_t data);

  uint8_t _addr;
  uint8_t _cols;
  uint8_t _rows;
  uint8_t _displayfunction;
  uint8_t _displaycontrol;
  uint8_t _displaymode;
  uint8_t _backlight;
};

#endif
