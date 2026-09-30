// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// The zero1 parts (§3.8): Servo, LCD, Buzzer, SevenSegment, map_range, input_available.

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>

const int POT_LDR = A3;        // potentiometer / light sensor
const int SERVO_PIN = 4;       // servo signal
const int BUZZER = 8;          // buzzer
const int SEG_DATA = 12;       // 7-segment: 74HC595 data
const int SEG_LATCH = 11;      // 7-segment: 74HC595 latch
const int SEG_CLOCK = 10;      // 7-segment: 74HC595 clock

Servo servo;
LiquidCrystal_I2C lcd(0x27, 16, 2);

const int adc = POT_LDR;
byte HEART[8] = {0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000};

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  servo.attach(SERVO_PIN);
  lcd.init();
  lcd.backlight();
  pinMode(BUZZER, OUTPUT);
  pinMode(SEG_DATA, OUTPUT);
  pinMode(SEG_LATCH, OUTPUT);
  pinMode(SEG_CLOCK, OUTPUT);
  lcd.createChar(0, HEART);
  byte bitmap[8] = {0, 0, 0, 0, 0, 0, 0, 31};
  lcd.createChar(1, bitmap);
}

// Runs forever: the body of "while True:" (line 15)
void loop() {
  long angle = map(analogRead(adc), 0, 1023, 0, 180);
  servo.write(angle);
  lcd.setCursor(0, 0);
  lcd.print("Angle: ");
  lcd.print(servo.read());
  lcd.print("   ");
  lcd.setCursor(0, 1);
  lcd.print("24.5\xDF" "C ");
  lcd.write((byte)0);
  lcd.write((byte)223);
  lcd.print("!");
  lcd.backlight();
  lcd.display();
  lcd.noCursor();
  lcd.noBlink();
  showDigit(pyFloorDiv(angle, 20L));
  showSegments(0b10000000);
  tone(BUZZER, 440, 50);
  if (Serial.available() > 0) {
    Serial.print("You typed ");
    Serial.println(pyInput(""));
    noTone(BUZZER);
    servo.detach();
  }
  delay(100);
}

// ---- Helpers that make C++ behave like Python ----

// Python's // for whole numbers: rounds down (C++'s / rounds toward zero)
long pyFloorDiv(long a, long b) {
  long q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
  return q;
}

// Python's input(): waits for one line typed in the Serial Monitor and shows it, like a terminal
String pyInput(String prompt) {
  Serial.print(prompt);
  while (Serial.available() == 0) {
  }
  String line = Serial.readStringUntil('\n');
  if (line.endsWith("\r")) line.remove(line.length() - 1);
  Serial.println(line);
  return line;
}

void showSegments(byte pattern) {          // 74HC595: a = bit 0 … g = bit 6, dp = bit 7
  digitalWrite(SEG_LATCH, LOW);
  shiftOut(SEG_DATA, SEG_CLOCK, MSBFIRST, pattern);
  digitalWrite(SEG_LATCH, HIGH);
}

void showDigit(int digit) {
  const byte DIGITS[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
  if (digit < 0 || digit > 9) { showSegments(0); return; }
  showSegments(DIGITS[digit]);
}
