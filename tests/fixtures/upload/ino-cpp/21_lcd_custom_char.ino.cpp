#include <Arduino.h>
#line 1 "21_lcd_custom_char.ino"
/*
  ZERO1 Smart Board - 21 LCD custom characters
  --------------------------------------------
  WHAT IT TEACHES
    - Each LCD character is a grid of 5 x 8 pixels. We can draw our own
      characters (up to 8 of them) with createChar() and show them with write().
    - A drawing is a byte array: one byte per row, one bit per pixel
      (B01110 = pixels off, on, on, on, off).
    - The LCD's built-in font already has a degree symbol at code 223.
    - The temperature comes from the DHT22 sensor, shown with one decimal.

  PARTS AND PINS
    - LCD 16x2 ........... SDA = A4, SCL = A5 (I2C address 0x27)
    - DHT22 .............. D5  (external header; make sure it is plugged in)

  EXPECTED BEHAVIOUR
    - Row 1 shows the temperature with the degree symbol:  Temp: 24.0<deg>C
      (or "Temp: --.-<deg>C" if the sensor is unplugged). It is refreshed every 2 s.
    - Row 2 shows:  I <heart> ZERO1   and the heart beats: it is small for
      500 ms, then big for 500 ms, and so on.

  TRY THIS
    - Draw a smiley: change the bits of heartBig.
    - Show the humidity on the second row instead of the text.
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

const int DHT_PIN = 5;
const int HEART_SMALL = 0;   // slot numbers of our custom characters (0..7)
const int HEART_BIG = 1;
const int DEGREE = 223;      // code of the degree symbol in the LCD font
const int HEART_COL = 2;     // column where the heart is drawn on row 1

LiquidCrystal_I2C lcd(0x27, 16, 2);
DHT dht(DHT_PIN, DHT22);

// A custom character is 8 rows of 5 pixels: 1 = pixel on, 0 = pixel off
byte heartSmall[8] = {
  B00000,
  B00000,
  B01010,
  B01110,
  B00100,
  B00000,
  B00000,
  B00000
};

byte heartBig[8] = {
  B00000,
  B01010,
  B11111,
  B11111,
  B01110,
  B00100,
  B00000,
  B00000
};

#line 63 "21_lcd_custom_char.ino"
void setup();
#line 77 "21_lcd_custom_char.ino"
void showTemperature();
#line 92 "21_lcd_custom_char.ino"
void drawHeart(int which);
#line 97 "21_lcd_custom_char.ino"
void loop();
#line 63 "21_lcd_custom_char.ino"
void setup() {
  lcd.init();
  lcd.backlight();
  lcd.createChar(HEART_SMALL, heartSmall);   // store our drawings in the LCD
  lcd.createChar(HEART_BIG, heartBig);
  dht.begin();

  lcd.setCursor(0, 1);
  lcd.print("I ");
  lcd.write((byte)HEART_BIG);   // write() shows custom character number 1
  lcd.print(" ZERO1");
}

// Draws the temperature on the first row, for example "Temp: 24.0<deg>C"
void showTemperature() {
  float t = dht.readTemperature();

  lcd.setCursor(0, 0);
  lcd.print("Temp: ");
  if (isnan(t)) {
    lcd.print("--.-");   // the sensor did not answer
  } else {
    lcd.print(t, 1);     // one digit after the point
  }
  lcd.write(DEGREE);     // the degree symbol
  lcd.print("C  ");      // the spaces erase leftovers of a longer number
}

// Draws one heart (HEART_SMALL or HEART_BIG) on the second row
void drawHeart(int which) {
  lcd.setCursor(HEART_COL, 1);
  lcd.write((byte)which);
}

void loop() {
  showTemperature();

  // Two heartbeats take 2 s; then the temperature is refreshed
  for (int i = 0; i < 2; i++) {
    drawHeart(HEART_SMALL);
    delay(500);
    drawHeart(HEART_BIG);
    delay(500);
  }
}

