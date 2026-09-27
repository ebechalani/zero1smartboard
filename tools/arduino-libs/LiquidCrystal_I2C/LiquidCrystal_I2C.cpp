/*
  LiquidCrystal_I2C — ZERO1 Smart Board edition (see LiquidCrystal_I2C.h)
  Copyright (c) 2026 ZERO1 Smart Board simulator contributors
  SPDX-License-Identifier: MIT
*/
#include "LiquidCrystal_I2C.h"

// HD44780 timing (datasheet "Instructions" table): most commands take 37 us,
// Clear display / Return home take 1.52 ms. We wait a little longer.
static const uint16_t LCD_CMD_US = 50;
static const uint16_t LCD_CLEAR_US = 2000;

LiquidCrystal_I2C::LiquidCrystal_I2C(uint8_t lcd_Addr, uint8_t lcd_cols, uint8_t lcd_rows)
    : _addr(lcd_Addr), _cols(lcd_cols), _rows(lcd_rows), _displayfunction(LCD_4BITMODE | LCD_1LINE | LCD_5x8DOTS),
      _displaycontrol(0), _displaymode(0), _backlight(LCD_NOBACKLIGHT) {}

void LiquidCrystal_I2C::init() {
  Wire.begin();
  begin(_cols, _rows);
}

void LiquidCrystal_I2C::oled_init() { init(); }

void LiquidCrystal_I2C::begin(uint8_t cols, uint8_t rows, uint8_t charsize) {
  _cols = cols;
  _rows = rows;
  _displayfunction = LCD_4BITMODE | LCD_5x8DOTS | (rows > 1 ? LCD_2LINE : LCD_1LINE);
  if (charsize != LCD_5x8DOTS && rows == 1) _displayfunction |= LCD_5x10DOTS;

  // Power-up: the controller needs 40 ms after Vcc reaches 2.7 V. The board may
  // be reset while the display stays powered, so we always run the full
  // "initializing by instruction" sequence (datasheet figure 24), which brings
  // the controller into a known state whatever it was doing. The generous
  // settle time also matches what students see with the usual Arduino library.
  delay(50);
  expanderWrite(_backlight);  // RS, R/W, E low; backlight as configured
  delay(1000);

  // Three "function set 8-bit" writes (only the high nibble is seen), then
  // switch to 4-bit mode.
  write4bits(0x30);
  delayMicroseconds(4500);
  write4bits(0x30);
  delayMicroseconds(4500);
  write4bits(0x30);
  delayMicroseconds(150);
  write4bits(0x20);

  command(LCD_FUNCTIONSET | _displayfunction);  // 4-bit, lines, font
  _displaycontrol = LCD_DISPLAYON | LCD_CURSOROFF | LCD_BLINKOFF;
  display();
  clear();
  _displaymode = LCD_ENTRYLEFT | LCD_ENTRYSHIFTDECREMENT;  // left to right, no shift
  command(LCD_ENTRYMODESET | _displaymode);
  home();
}

// ---------------------------------------------------------------- cursor and screen

void LiquidCrystal_I2C::clear() {
  command(LCD_CLEARDISPLAY);
  delayMicroseconds(LCD_CLEAR_US);
}

void LiquidCrystal_I2C::home() {
  command(LCD_RETURNHOME);
  delayMicroseconds(LCD_CLEAR_US);
}

void LiquidCrystal_I2C::setCursor(uint8_t col, uint8_t row) {
  // DDRAM line starts: line 1 at 0x00, line 2 at 0x40; on 4-line displays
  // lines 3 and 4 continue lines 1 and 2 after `cols` characters.
  static const uint8_t lineStart[] = {0x00, 0x40, 0x14, 0x54};
  if (row >= _rows) row = _rows ? _rows - 1 : 0;
  uint8_t start = row < 4 ? lineStart[row] : 0;
  if (row >= 2) start = lineStart[row - 2] + _cols;
  command(LCD_SETDDRAMADDR | ((start + col) & 0x7f));
}

void LiquidCrystal_I2C::display() {
  _displaycontrol |= LCD_DISPLAYON;
  command(LCD_DISPLAYCONTROL | _displaycontrol);
}
void LiquidCrystal_I2C::noDisplay() {
  _displaycontrol &= ~LCD_DISPLAYON;
  command(LCD_DISPLAYCONTROL | _displaycontrol);
}
void LiquidCrystal_I2C::cursor() {
  _displaycontrol |= LCD_CURSORON;
  command(LCD_DISPLAYCONTROL | _displaycontrol);
}
void LiquidCrystal_I2C::noCursor() {
  _displaycontrol &= ~LCD_CURSORON;
  command(LCD_DISPLAYCONTROL | _displaycontrol);
}
void LiquidCrystal_I2C::blink() {
  _displaycontrol |= LCD_BLINKON;
  command(LCD_DISPLAYCONTROL | _displaycontrol);
}
void LiquidCrystal_I2C::noBlink() {
  _displaycontrol &= ~LCD_BLINKON;
  command(LCD_DISPLAYCONTROL | _displaycontrol);
}

void LiquidCrystal_I2C::scrollDisplayLeft() { command(LCD_CURSORSHIFT | LCD_DISPLAYMOVE | LCD_MOVELEFT); }
void LiquidCrystal_I2C::scrollDisplayRight() { command(LCD_CURSORSHIFT | LCD_DISPLAYMOVE | LCD_MOVERIGHT); }

void LiquidCrystal_I2C::leftToRight() {
  _displaymode |= LCD_ENTRYLEFT;
  command(LCD_ENTRYMODESET | _displaymode);
}
void LiquidCrystal_I2C::rightToLeft() {
  _displaymode &= ~LCD_ENTRYLEFT;
  command(LCD_ENTRYMODESET | _displaymode);
}
void LiquidCrystal_I2C::autoscroll() {
  _displaymode |= LCD_ENTRYSHIFTINCREMENT;
  command(LCD_ENTRYMODESET | _displaymode);
}
void LiquidCrystal_I2C::noAutoscroll() {
  _displaymode &= ~LCD_ENTRYSHIFTINCREMENT;
  command(LCD_ENTRYMODESET | _displaymode);
}
void LiquidCrystal_I2C::shiftIncrement() { autoscroll(); }
void LiquidCrystal_I2C::shiftDecrement() { noAutoscroll(); }
void LiquidCrystal_I2C::printLeft() {}
void LiquidCrystal_I2C::printRight() {}

// ---------------------------------------------------------------- backlight

void LiquidCrystal_I2C::backlight() {
  _backlight = LCD_BACKLIGHT;
  expanderWrite(0);
}
void LiquidCrystal_I2C::noBacklight() {
  _backlight = LCD_NOBACKLIGHT;
  expanderWrite(0);
}
void LiquidCrystal_I2C::setBacklight(uint8_t new_val) {
  if (new_val) backlight();
  else noBacklight();
}

// ---------------------------------------------------------------- custom characters

void LiquidCrystal_I2C::createChar(uint8_t location, uint8_t charmap[]) {
  command(LCD_SETCGRAMADDR | ((location & 0x07) << 3));
  for (uint8_t i = 0; i < 8; i++) write(charmap[i]);
}

void LiquidCrystal_I2C::createChar(uint8_t location, const char *charmap) {
  command(LCD_SETCGRAMADDR | ((location & 0x07) << 3));
  for (uint8_t i = 0; i < 8; i++) write((uint8_t)pgm_read_byte_near(charmap + i));
}

void LiquidCrystal_I2C::load_custom_character(uint8_t char_num, uint8_t *rows) { createChar(char_num, rows); }

// ---------------------------------------------------------------- data path

size_t LiquidCrystal_I2C::write(uint8_t value) {
  send(value, Rs);
  return 1;
}

void LiquidCrystal_I2C::command(uint8_t value) { send(value, 0); }

void LiquidCrystal_I2C::printstr(const char c[]) { print(c); }

/** One byte as two nibbles; `mode` is Rs for data, 0 for an instruction. */
void LiquidCrystal_I2C::send(uint8_t value, uint8_t mode) {
  write4bits((value & 0xf0) | mode);
  write4bits(((value << 4) & 0xf0) | mode);
}

/** The nibble sits in bits 4..7 of `data` (the backpack's D4..D7); bits 0..2 carry RS/RW/E. */
void LiquidCrystal_I2C::write4bits(uint8_t data) {
  expanderWrite(data);
  pulseEnable(data);
}

void LiquidCrystal_I2C::expanderWrite(uint8_t data) {
  Wire.beginTransmission(_addr);
  Wire.write((uint8_t)(data | _backlight));
  Wire.endTransmission();
}

/** The controller latches the nibble on the falling edge of E (tPW >= 450 ns). */
void LiquidCrystal_I2C::pulseEnable(uint8_t data) {
  expanderWrite(data | En);
  delayMicroseconds(1);
  expanderWrite(data & ~En);
  delayMicroseconds(LCD_CMD_US);
}

// ---------------------------------------------------------------- compatibility names

void LiquidCrystal_I2C::blink_on() { blink(); }
void LiquidCrystal_I2C::blink_off() { noBlink(); }
void LiquidCrystal_I2C::cursor_on() { cursor(); }
void LiquidCrystal_I2C::cursor_off() { noCursor(); }
void LiquidCrystal_I2C::on() { display(); }
void LiquidCrystal_I2C::off() { noDisplay(); }

uint8_t LiquidCrystal_I2C::status() { return 0; }
void LiquidCrystal_I2C::setContrast(uint8_t) {}
uint8_t LiquidCrystal_I2C::keypad() { return 0; }
void LiquidCrystal_I2C::setDelay(int, int) {}
uint8_t LiquidCrystal_I2C::init_bargraph(uint8_t) { return 0; }
void LiquidCrystal_I2C::draw_horizontal_graph(uint8_t, uint8_t, uint8_t, uint8_t) {}
void LiquidCrystal_I2C::draw_vertical_graph(uint8_t, uint8_t, uint8_t, uint8_t) {}
