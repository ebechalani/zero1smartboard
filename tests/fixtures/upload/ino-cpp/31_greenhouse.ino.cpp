#include <Arduino.h>
#line 1 "31_greenhouse.ino"
/*
  ZERO1 Smart Board - 31 Smart greenhouse (project)
  -------------------------------------------------
  WHAT IT TEACHES
    - An automatic system: measure (DHT22), decide (thresholds), act (fan and
      alarm), inform (LCD and Serial).
    - Two timers with millis(): the sensor is read every 2 s while the alarm
      LED blinks every 300 ms, without any delay() in loop().
    - Splitting the program into small functions (checkClimate).

  PARTS AND PINS
    - DHT22 .............. D5  (external header; plug it in)
    - LCD 16x2 ........... SDA = A4, SCL = A5 (I2C address 0x27)
    - Motor driver IN1 ... A0  (the DC motor plays the role of the fan)
    - Red LED ............ A1  (alarm)

  EXPECTED BEHAVIOUR (move the DHT temperature slider in the simulator)
    - LCD row 1:  T:24.0C H:55%      (temperature and humidity, refreshed every 2 s)
    - Temperature 28 C or less:   row 2 "OK: fan OFF",     motor stopped, LED off.
    - Above 28 C:                 row 2 "Warm: fan ON",    motor running.
    - Above 35 C:                 row 2 "TOO HOT! Fan ON", motor running and
                                  the red LED blinks (300 ms on, 300 ms off).
    - Sensor unplugged:           "Sensor error!" / "Check the DHT22", motor stopped.
    - Every 2 s Serial prints a line such as  T=24.0C  H=55%  fan=OFF

  TRY THIS
    - Add a "too dry" alarm when the humidity is below 30 %.
    - Sound the buzzer (D8) during the alarm.
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

const int DHT_PIN = 5;
const int FAN_PIN = A0;               // the motor driver input
const int LED_RED = A1;
const float FAN_ON_TEMP = 28.0;       // above this temperature the fan runs
const float ALARM_TEMP = 35.0;        // above this the red LED blinks
const unsigned long READ_INTERVAL = 2000;   // ms between two sensor readings
const unsigned long BLINK_INTERVAL = 300;   // ms for the alarm blink

LiquidCrystal_I2C lcd(0x27, 16, 2);
DHT dht(DHT_PIN, DHT22);

unsigned long lastRead = 0;
unsigned long lastBlink = 0;
bool tooHot = false;
bool ledOn = false;

// Reads the sensor, drives the fan and updates the LCD and Serial
#line 52 "31_greenhouse.ino"
void checkClimate();
#line 97 "31_greenhouse.ino"
void setup();
#line 109 "31_greenhouse.ino"
void loop();
#line 52 "31_greenhouse.ino"
void checkClimate() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  lcd.clear();
  if (isnan(t) || isnan(h)) {
    lcd.print("Sensor error!");
    lcd.setCursor(0, 1);
    lcd.print("Check the DHT22");
    digitalWrite(FAN_PIN, LOW);
    tooHot = false;
    Serial.println("Sensor error: no answer from the DHT22");
    return;
  }

  bool fanOn = t > FAN_ON_TEMP;
  tooHot = t > ALARM_TEMP;
  digitalWrite(FAN_PIN, fanOn ? HIGH : LOW);

  // Row 1: T:24.0C H:55%
  lcd.print("T:");
  lcd.print(t, 1);
  lcd.print("C H:");
  lcd.print(h, 0);
  lcd.print("%");

  // Row 2: what the greenhouse is doing
  lcd.setCursor(0, 1);
  if (tooHot) {
    lcd.print("TOO HOT! Fan ON");
  } else if (fanOn) {
    lcd.print("Warm: fan ON");
  } else {
    lcd.print("OK: fan OFF");
  }

  Serial.print("T=");
  Serial.print(t, 1);
  Serial.print("C  H=");
  Serial.print(h, 0);
  Serial.print("%  fan=");
  Serial.print(fanOn ? "ON" : "OFF");
  Serial.println(tooHot ? "  ALARM" : "");
}

void setup() {
  Serial.begin(9600);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  lcd.init();
  lcd.backlight();
  lcd.print("Smart greenhouse");
  dht.begin();
  delay(1000);          // show the title for a second
  checkClimate();       // first measurement right away
}

void loop() {
  // Timer 1: read the sensor every 2 s
  if (millis() - lastRead >= READ_INTERVAL) {
    lastRead = millis();
    checkClimate();
  }

  // Timer 2: blink the red LED while it is too hot
  if (tooHot) {
    if (millis() - lastBlink >= BLINK_INTERVAL) {
      lastBlink = millis();
      ledOn = !ledOn;
      digitalWrite(LED_RED, ledOn ? HIGH : LOW);
    }
  } else if (ledOn) {
    ledOn = false;      // alarm over: make sure the LED is off
    digitalWrite(LED_RED, LOW);
  }
}

