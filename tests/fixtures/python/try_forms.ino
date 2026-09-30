// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// try / except (§2.12): form S (the DHT22, the ultrasonic sensor) and form V (int() / float() of text).

#include <DHT.h>

const int DHT_PIN = 5;         // DHT22 temperature / humidity sensor
const int TRIG_PIN = 3;        // ultrasonic trigger
const int ECHO_PIN = 2;        // ultrasonic echo

DHT sensor(DHT_PIN, DHT22);

float read_number(String prompt) {
  while (true) {
    String valueText = pyInput(prompt);
    if (pyIsFloat(valueText)) {
      float value = pyFloatOf(valueText, 0);
      return value;
    } else {
      String e = String("could not convert string to float: '") + valueText + "'";
      Serial.print("Not a number: ");
      Serial.println(e);
    }
  }
}

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  sensor.begin();
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

// Runs forever: the body of "while True:" (line 21)
void loop() {
  float d = 0.0;
  long n = 0;
  delay(2000);
  if (sensor.read()) {         // try: sensor.measure()
    float t = sensor.readTemperature();
    Serial.print("T = ");
    Serial.println(pyFloat(t));
  } else {                     // except OSError as e:
    String e = "[Errno 110] ETIMEDOUT";
    Serial.print("DHT22: ");
    Serial.println(e);
    return;                    // continue: start the next round of the loop
  }
  d = pyDistanceCm(TRIG_PIN, ECHO_PIN, 0);
  if (d <= 0) {                // try: d = sonar.distance_cm()  except OSError:
    Serial.println("No echo");
    return;                    // continue: start the next round of the loop
  }
  long mm = (long)(pyDistanceCm(TRIG_PIN, ECHO_PIN, 0) * 10);
  if (mm > 0) {                // try: mm = sonar.distance_mm()
    Serial.print(mm);
    Serial.println(" mm");
  } else {                     // except:
  }
  String text = pyInput("Number? ");
  if (pyIsInt(text)) {
    n = pyInt(text, 0);
    Serial.println(n * 2L);
  } else {
    n = 0;
  }
  Serial.print(n);
  Serial.print(" ");
  Serial.print(pyFloat(d));
  Serial.print(" ");
  Serial.println(pyFloat(read_number("x? ")));
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

// True when int() can read the text: spaces, an optional sign, then digits
bool pyIsInt(String text) {
  text.trim();
  int start = (text.startsWith("-") || text.startsWith("+")) ? 1 : 0;
  if ((int)text.length() <= start) return false;
  for (int i = start; i < (int)text.length(); i++) {
    char c = text.charAt(i);
    if (c < '0' || c > '9') return false;
  }
  return true;
}

// Python's int(text): stops with ValueError when the text is not a whole number
long pyInt(String text, int line) {
  if (!pyIsInt(text)) pyFail(line, "ValueError: invalid literal for int() with base 10: '" + text + "'");
  text.trim();
  return text.toInt();
}

// True when float() can read the text: an optional sign, digits with at most one point, an optional exponent
bool pyIsFloat(String text) {
  text.trim();
  int i = (text.startsWith("-") || text.startsWith("+")) ? 1 : 0;
  int digits = 0;
  bool point = false;
  for (; i < (int)text.length(); i++) {
    char c = text.charAt(i);
    if (c >= '0' && c <= '9') {
      digits++;
    } else if (c == '.' && !point) {
      point = true;
    } else {
      break;
    }
  }
  if (digits == 0) return false;
  if (i < (int)text.length() && (text.charAt(i) == 'e' || text.charAt(i) == 'E')) {
    i++;
    if (i < (int)text.length() && (text.charAt(i) == '-' || text.charAt(i) == '+')) i++;
    int exponentDigits = 0;
    while (i < (int)text.length() && text.charAt(i) >= '0' && text.charAt(i) <= '9') {
      i++;
      exponentDigits++;
    }
    if (exponentDigits == 0) return false;
  }
  return i == (int)text.length();
}

// Python's float(text): stops with ValueError when the text is not a number
float pyFloatOf(String text, int line) {
  if (!pyIsFloat(text)) pyFail(line, "ValueError: could not convert string to float: '" + text + "'");
  return text.toFloat();
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
