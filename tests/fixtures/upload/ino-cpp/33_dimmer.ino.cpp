#include <Arduino.h>
#line 1 "33_dimmer.ino"
/*
  ZERO1 Smart Board - 33 Dimmer (project)
  ---------------------------------------
  WHAT IT TEACHES
    - One input controls three outputs at the same time.
    - The same measurement (0..1023) converted with map() to three different
      ranges: an angle (0..180), a brightness (0..255) and a level (0..9).
    - Printing only when something changes, so the Serial Monitor stays readable.

  PARTS AND PINS
    - Potentiometer ...... A3  (put the POT / LDR switch on POT)
    - Servo .............. D4  (external header; plug it in)
    - RGB LED (NeoPixel) . D9
    - 7-segment .......... DATA D12, LATCH D11, CLOCK D10

  EXPECTED BEHAVIOUR (turn the potentiometer)
    - The servo follows the knob: fully left = 0 degrees, fully right = 180.
    - The RGB LED shows a warm orange light that gets brighter as you turn right
      (off when fully left).
    - The 7-segment display shows a level from 0 (left) to 9 (right).
    - With the knob in the middle (512) Serial prints
        Pot: 512  Servo: 90 deg  Brightness: 127  Level: 4
      and it prints a new line each time the level changes.

  TRY THIS
    - Change the colour of the LED.
    - Use the LDR instead of the potentiometer (switch on LDR): a light meter!
*/

#include <Servo.h>
#include <Adafruit_NeoPixel.h>

const int POT_PIN = A3;
const int SERVO_PIN = 4;
const int RGB_PIN = 9;
const int DATA_PIN = 12;
const int LATCH_PIN = 11;
const int CLOCK_PIN = 10;

// Segment patterns for the digits 0..9 (see 05_seven_segment_counter)
const byte DIGITS[10] = { 0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F };

Servo dimmerServo;
Adafruit_NeoPixel pixels(1, RGB_PIN, NEO_GRB + NEO_KHZ800);

int lastLevel = -1;   // -1 so that the first level is always printed

// Shows one digit (0..9) on the 7-segment display
#line 49 "33_dimmer.ino"
void showDigit(int n);
#line 55 "33_dimmer.ino"
void setup();
#line 64 "33_dimmer.ino"
void loop();
#line 49 "33_dimmer.ino"
void showDigit(int n) {
  digitalWrite(LATCH_PIN, LOW);
  shiftOut(DATA_PIN, CLOCK_PIN, MSBFIRST, DIGITS[n]);
  digitalWrite(LATCH_PIN, HIGH);
}

void setup() {
  pinMode(DATA_PIN, OUTPUT);
  pinMode(LATCH_PIN, OUTPUT);
  pinMode(CLOCK_PIN, OUTPUT);
  dimmerServo.attach(SERVO_PIN);
  pixels.begin();
  Serial.begin(9600);
}

void loop() {
  int value = analogRead(POT_PIN);                 // 0 .. 1023

  // The same measurement, converted to three different ranges
  int angle = map(value, 0, 1023, 0, 180);         // servo: 0 .. 180 degrees
  int brightness = map(value, 0, 1023, 0, 255);    // RGB LED: 0 (off) .. 255 (full)
  int level = map(value, 0, 1023, 0, 9);           // display: 0 .. 9

  dimmerServo.write(angle);

  pixels.setBrightness(brightness);
  pixels.setPixelColor(0, pixels.Color(255, 180, 0));   // warm orange
  pixels.show();

  showDigit(level);

  // Print only when the level changes, otherwise the Serial Monitor floods
  if (level != lastLevel) {
    lastLevel = level;
    Serial.print("Pot: ");
    Serial.print(value);
    Serial.print("  Servo: ");
    Serial.print(angle);
    Serial.print(" deg");
    Serial.print("  Brightness: ");
    Serial.print(brightness);
    Serial.print("  Level: ");
    Serial.println(level);
  }

  delay(50);
}

