// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
Smart greenhouse: the fan runs above 28 °C, the red LED warns of dry air.
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

const int LED_RED = A1;        // red LED
const int MOTOR = A0;          // DC motor driver
const int DHT_PIN = 5;         // DHT22 temperature / humidity sensor

DHT sensor(DHT_PIN, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);

const float TOO_HOT = 28.0;
const float TOO_DRY = 30.0;
const int fan = MOTOR;
const int alarm = LED_RED;
bool fan_on = false;

void check_climate(float t, float h) {
  fan_on = t > TOO_HOT;
  digitalWrite(fan, fan_on);
  digitalWrite(alarm, h < TOO_DRY);
}

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  sensor.begin();
  pinMode(fan, OUTPUT);
  pinMode(alarm, OUTPUT);
  lcd.init();
  lcd.backlight();
}

// Runs forever: the body of "while True:" (line 24)
void loop() {
  if (!sensor.read()) {        // try: sensor.measure()  except OSError:
    lcd.setCursor(0, 0);
    lcd.print("Sensor error    ");
    delay(2000);
    return;                    // continue: start the next round of the loop
  }
  float t = sensor.readTemperature();
  float h = sensor.readHumidity();
  check_climate(t, h);
  lcd.setCursor(0, 0);
  lcd.print("T ");
  lcd.print(t, 1);
  lcd.print("\xDF" "C H ");
  lcd.print(h, 0);
  lcd.print("%");
  lcd.setCursor(0, 1);
  lcd.print(fan_on ? String("Fan on    ") : String("Fan off   "));
  Serial.print(t, 1);
  Serial.print(" C, ");
  Serial.print(h, 1);
  Serial.print(" %, fan ");
  Serial.println(pyBool(fan_on));
  delay(2000);
}

// ---- Helpers that make C++ behave like Python ----

// How Python shows True and False
String pyBool(bool b) {
  return b ? "True" : "False";
}
