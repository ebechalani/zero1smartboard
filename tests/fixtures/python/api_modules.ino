// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// The modules by their own names (§3): machine.…, neopixel.…, dht.…, hcsr04.…, utime.

#include <Wire.h>
#include <DHT.h>
#include <Adafruit_NeoPixel.h>

const int MOTOR = A0;          // DC motor driver
const int DHT_PIN = 5;         // DHT22 temperature / humidity sensor
const int TRIG_PIN = 3;        // ultrasonic trigger
const int ECHO_PIN = 2;        // ultrasonic echo
const int RGB_PIN = 9;         // RGB LED (WS2812)

DHT sensor(DHT_PIN, DHT11);
Adafruit_NeoPixel np(1, RGB_PIN, NEO_GRB + NEO_KHZ800);

const int fade = 11;
const int motor = MOTOR;
const int led = 13;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  sensor.begin();
  np.begin();
  Wire.begin();
  pinMode(fade, OUTPUT);
  pinMode(motor, OUTPUT);
  digitalWrite(motor, LOW);
  pinMode(led, OUTPUT);
}

// Runs forever: the body of "while True:" (line 18)
void loop() {
  if (!sensor.read()) pyFail(19, "OSError: [Errno 110] ETIMEDOUT");
  float d = pyDistanceCm(TRIG_PIN, ECHO_PIN, 20);
  long mm = (long)(pyDistanceCm(TRIG_PIN, ECHO_PIN, 21) * 10);
  long level = (long)sensor.readHumidity();
  np.fill(np.Color(level, 0, 0));
  np.setPixelColor(1L - 1L, 0, level, 0);
  np.show();
  analogWrite(fade, 127);
  digitalWrite(motor, d < 20);
  digitalWrite(led, true);
  Serial.print(pyFloat(d));
  Serial.print(" ");
  Serial.print(mm);
  Serial.print(" ");
  Serial.print(pyFloat(sensor.readTemperature()));
  Serial.print(" ");
  Serial.println((long)millis() - 0L);
  delay(500);
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
