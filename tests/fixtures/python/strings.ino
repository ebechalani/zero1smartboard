// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// Text in the sketch (S1): UTF-8, escapes, split literals, the LCD's degree sign.

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  lcd.init();
  lcd.backlight();
  Serial.println("ABC tab\there quote \" and \\ backslash What?" "? Lumière allumée");
  Serial.print(String("\x01") + "A");
  Serial.println(" bell\x07");
  Serial.println("\x01" "A a\x7F" "b");   // an escape before a hex digit: the literal is split
  lcd.print("Temp: 23\xDF" "C");
  lcd.print(21.5, 1);
  lcd.print("\xDF" "C");
}

// The Python program has no "while True:": it has ended.
void loop() {
}
