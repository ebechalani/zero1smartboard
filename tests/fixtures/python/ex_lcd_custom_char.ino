// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
LCD custom characters: a beating heart and the temperature of the DHT22.
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

const int DHT_PIN = 5;         // DHT22 temperature / humidity sensor

LiquidCrystal_I2C lcd(0x27, 16, 2);
DHT sensor(DHT_PIN, DHT22);

byte HEART_SMALL[8] = {0b00000, 0b00000, 0b01010, 0b01110, 0b00100, 0b00000, 0b00000, 0b00000};
byte HEART_BIG[8] = {0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000};

void show_temperature() {
  lcd.setCursor(0, 0);
  lcd.print("Temp: ");
  if (sensor.read()) {         // try: sensor.measure()
    lcd.print(sensor.readTemperature(), 1);
  } else {                     // except OSError:
    lcd.print("--.-");
  }
  lcd.write((byte)223);
  lcd.print("C  ");
}

// Runs once: the lines before "while True:"
void setup() {
  lcd.init();
  lcd.backlight();
  sensor.begin();
  lcd.createChar(0, HEART_SMALL);
  lcd.createChar(1, HEART_BIG);
  lcd.setCursor(0, 1);
  lcd.print("I ");
  lcd.write((byte)1);
  lcd.print(" ZERO1");
}

// Runs forever: the body of "while True:" (line 33)
void loop() {
  show_temperature();
  for (long i = 0; i < 2; i++) {
    lcd.setCursor(2, 1);
    lcd.write((byte)0);
    delay(500);
    lcd.setCursor(2, 1);
    lcd.write((byte)1);
    delay(500);
  }
}
