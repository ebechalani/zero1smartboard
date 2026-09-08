/*
  ZERO1 Smart Board - 20 LCD hello
  --------------------------------
  WHAT IT TEACHES
    - The 16x2 LCD talks over I2C (two wires: SDA and SCL) at address 0x27.
    - The LiquidCrystal_I2C library: init(), backlight(), setCursor(), print().
    - The screen has 2 rows of 16 characters. setCursor(column, row) chooses
      where the next text goes; both start at 0.
    - A counter that runs with millis(): loop() is never blocked by delay().

  PARTS AND PINS
    - LCD 16x2 ........... SDA = A4, SCL = A5 (I2C address 0x27)
      The board also has a physical "Backlight" switch: keep it on.

  EXPECTED BEHAVIOUR
    - Row 1 shows:  Hello, ZERO1!
    - Row 2 shows:  Time: 0 s   and the number grows by 1 every second
      (Time: 1 s, Time: 2 s, ...). The backlight is on.

  TRY THIS
    - Write your name on the first row.
    - Show minutes and seconds (use / and %).
    - Call lcd.noBacklight() to see what the screen looks like without light.
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);   // I2C address 0x27, 16 columns, 2 rows

unsigned long lastUpdate = 0;         // when we last refreshed the counter

void setup() {
  lcd.init();            // start the LCD
  lcd.backlight();       // turn the light on (the screen stays dark without it)

  lcd.setCursor(0, 0);   // column 0, row 0 = top left corner
  lcd.print("Hello, ZERO1!");

  lcd.setCursor(0, 1);   // column 0, row 1 = second row
  lcd.print("Time: 0 s");
}

void loop() {
  // Refresh the counter once per second, without delay() (see 07_dc_motor)
  if (millis() - lastUpdate >= 1000) {
    lastUpdate = millis();
    lcd.setCursor(6, 1);            // just after "Time: "
    lcd.print(millis() / 1000);     // whole seconds (integer division)
    lcd.print(" s");
  }
}
