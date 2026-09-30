// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// D4: which parts make a variable, library objects, the lines each part needs (§3).

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <Adafruit_NeoPixel.h>
#include <Servo.h>

const int LED_RED = A1;        // red LED
const int LED_GREEN = A2;      // green LED
const int BUTTON_1 = 6;        // button 1
const int POT_LDR = A3;        // potentiometer / light sensor
const int SERVO_PIN = 4;       // servo signal
const int BUZZER = 8;          // buzzer
const int DHT_PIN = 5;         // DHT22 temperature / humidity sensor
const int TRIG_PIN = 3;        // ultrasonic trigger
const int ECHO_PIN = 2;        // ultrasonic echo
const int RGB_PIN = 9;         // RGB LED (WS2812)
const int SEG_DATA = 12;       // 7-segment: 74HC595 data
const int SEG_LATCH = 11;      // 7-segment: 74HC595 latch
const int SEG_CLOCK = 10;      // 7-segment: 74HC595 clock

Servo servo;
LiquidCrystal_I2C lcd(0x27, 16, 2);
Adafruit_NeoPixel np(1, RGB_PIN, NEO_GRB + NEO_KHZ800);
DHT sensor(DHT_PIN, DHT22);

const int led = LED_RED;
const int button = BUTTON_1;
const int green = LED_GREEN;
const int builtin = LED_BUILTIN;
const int dimmer = RGB_PIN;
const int adc = POT_LDR;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(led, OUTPUT);
  digitalWrite(led, HIGH);
  pinMode(button, INPUT_PULLUP);
  pinMode(green, OUTPUT);
  pinMode(builtin, OUTPUT);
  pinMode(dimmer, OUTPUT);
  analogWrite(dimmer, 127);
  Wire.begin();
  servo.attach(SERVO_PIN);
  lcd.init();
  lcd.backlight();
  np.begin();
  sensor.begin();
  pinMode(BUZZER, OUTPUT);
  pinMode(SEG_DATA, OUTPUT);
  pinMode(SEG_LATCH, OUTPUT);
  pinMode(SEG_CLOCK, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

// Runs forever: the body of "while True:" (line 22)
void loop() {
  digitalWrite(led, digitalRead(button));
  digitalWrite(green, !digitalRead(green));
  digitalWrite(builtin, 0);
  analogWrite(dimmer, (long)analogRead(adc) * 64L / 257);
  servo.write(90);
  lcd.clear();
  np.fill(0x000020);
  np.show();
  noTone(BUZZER);
  showSegments(0);
  Serial.println(pyFloat(pyDistanceCm(TRIG_PIN, ECHO_PIN, 33)));
}

// ---- Helpers that make C++ behave like Python ----

// Stops the program like a Python error: the message goes to the Serial Monitor, then the board halts
void pyFail(int line, String text) {
  Serial.print("Line ");
  Serial.print(line);
  Serial.print(": ");
  Serial.println(text);
  Serial.flush();
  abort();
}

// 10 to the power n, exact on the board (pow() is not)
float pyPow10(int n) {
  float result = 1;
  for (int i = 0; i < n; i++) result *= 10;
  for (int i = 0; i > n; i--) result /= 10;
  return result;
}

// How MicroPython shows a decimal number: 7 significant digits, 3.0 keeps its .0,
// and 1e-05 / 1e+07 style below 0.0001 and from 10000000 on
String pyFloat(float x) {
  if (isnan(x)) return "nan";
  if (isinf(x)) return x > 0 ? "inf" : "-inf";
  if (x == 0) return "0.0";
  float size = fabs(x);
  int exponent = floor(log10(size));
  if (size < pyPow10(exponent)) exponent--;
  if (size >= pyPow10(exponent + 1)) exponent++;
  String text = pyDigits(x, exponent);
  if (pySignificant(text) > 7) {          // 9999999.6 rounds up to 10000000: one more digit
    exponent++;
    text = pyDigits(x, exponent);
  }
  if (exponent < -4 || exponent >= 7) {
    text += exponent < 0 ? "e-" : "e+";
    if (abs(exponent) < 10) text += "0";
    text += String(abs(exponent));
  } else if (text.indexOf('.') < 0) {
    text += ".0";
  }
  return text;
}

// The 7 significant digits of x, without the zeros at the end (for pyFloat)
String pyDigits(float x, int exponent) {
  bool scientific = exponent < -4 || exponent >= 7;
  int decimals = scientific ? 6 : 6 - exponent;
  String text = String(scientific ? x / pyPow10(exponent) : x, decimals);
  if (decimals > 0) {
    while (text.endsWith("0")) text.remove(text.length() - 1);
    if (text.endsWith(".")) text.remove(text.length() - 1);
  }
  return text;
}

// How many significant digits a number text has (for pyFloat)
int pySignificant(String text) {
  int count = 0;
  bool started = false;
  for (unsigned int i = 0; i < text.length(); i++) {
    char c = text.charAt(i);
    if (c >= '1' && c <= '9') started = true;
    if (started && c >= '0' && c <= '9') count++;
  }
  return count;
}

// HC-SR04: a 10 µs pulse on trig, then the echo time on echo; no echo gives 0,
// or stops the program with MicroPython's OSError when line > 0
float pyDistanceCm(int trigPin, int echoPin, int line) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long duration = pulseIn(echoPin, HIGH, 30000);
  if (duration == 0 && line > 0) pyFail(line, "OSError: Out of range");
  return duration * 0.0343 / 2;
}

void showSegments(byte pattern) {          // 74HC595: a = bit 0 … g = bit 6, dp = bit 7
  digitalWrite(SEG_LATCH, LOW);
  shiftOut(SEG_DATA, SEG_CLOCK, MSBFIRST, pattern);
  digitalWrite(SEG_LATCH, HIGH);
}
