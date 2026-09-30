// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// Fixed lists (§2.10): items, constant lists, indexes, loops, helpers, list parameters.

const int LED_RED = A1;        // red LED
const int LED_GREEN = A2;      // green LED

const long NOTES[3] = {262, 294, 330};

float average(float values[], long valuesCount) {
  float total = 0;
  for (long vIndex = 0; vIndex < valuesCount; vIndex++) {
    float v = values[vIndex];
    total += v;
  }
  return total / pyNonZero(valuesCount, 16);
}

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  String names[2] = {"ann", "bob"};
  float temps[4] = {0};
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  const int leds[2] = {LED_RED, LED_GREEN};

  for (long i = 0; i < 3; i++) {
    Serial.print(NOTES[i]);
    Serial.print(" ");
    Serial.print(NOTES[2]);
    Serial.print(" ");
    Serial.println(names[pyIndex(i % 2L, 2, 20)]);
  }
  for (long ledIndex = 0; ledIndex < 2; ledIndex++) {
    int led = leds[ledIndex];
    digitalWrite(led, HIGH);
  }
  const long xItems[3] = {1, 2, 3};
  for (long xIndex = 0; xIndex < 3; xIndex++) {
    long x = xItems[xIndex];
    Serial.println(x);
  }
  temps[1] = 2.5;
  temps[0] += 1;
  long k = random(0, 4);
  temps[pyIndex(k, 4, 28)] = 1.5;
  Serial.print(pyListTextF(temps, 4));
  Serial.print(" ");
  Serial.print(pyFloat(pySumF(temps, 4)));
  Serial.print(" ");
  Serial.print(pyFloat(pyMinListF(temps, 4, 29)));
  Serial.print(" ");
  Serial.print(pyFloat(pyMaxListF(temps, 4, 29)));
  Serial.print(" ");
  Serial.print(pyBool(pyInListF(temps, 4, 2.5)));
  Serial.print(" ");
  Serial.println(4);
  Serial.print(pyFloat(average(temps, 4)));
  Serial.print(" ");
  Serial.print(NOTES[random(0, 3)]);
  Serial.print(" ");
  Serial.print(names[random(0, 2)]);
  Serial.print(" ");
  Serial.print(pyBool(5 == 1 || 5 == 5));
  Serial.print(" ");
  Serial.println(pyBool(!pyInListS(names, 2, "bob")));
  if (4 > 0) {
    Serial.println("not empty");
  }
}

// The Python program has no "while True:": it has ended.
void loop() {
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

// Python stops with ZeroDivisionError instead of dividing by 0
long pyNonZero(long divisor, int line) {
  if (divisor == 0) pyFail(line, "ZeroDivisionError: division by zero");
  return divisor;
}

// 10 to the power n, exact on the board (pow() is not)
float pyPow10(int n) {
  float result = 1;
  for (int i = 0; i < n; i++) result *= 10;
  for (int i = 0; i > n; i--) result /= 10;
  return result;
}

// How Python shows True and False
String pyBool(bool b) {
  return b ? "True" : "False";
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

// list[i] with Python's negative indexes and IndexError
long pyIndex(long index, long size, int line) {
  if (index < 0) index += size;
  if (index < 0 || index >= size) pyFail(line, "IndexError: list index out of range");
  return index;
}

// str(list) / print(list): [1, 2, 3]
String pyListTextF(float list[], long count) {
  String text = "[";
  for (long i = 0; i < count; i++) {
    if (i > 0) text += ", ";
    text += pyFloat(list[i]);
  }
  return text + "]";
}

float pySumF(float list[], long count) {
  float total = 0;
  for (long i = 0; i < count; i++) total += list[i];
  return total;
}

float pyMinListF(float list[], long count, int line) {
  if (count == 0) pyFail(line, "ValueError: min() arg is an empty sequence");
  float smallest = list[0];
  for (long i = 1; i < count; i++) {
    if (list[i] < smallest) smallest = list[i];
  }
  return smallest;
}

float pyMaxListF(float list[], long count, int line) {
  if (count == 0) pyFail(line, "ValueError: max() arg is an empty sequence");
  float largest = list[0];
  for (long i = 1; i < count; i++) {
    if (list[i] > largest) largest = list[i];
  }
  return largest;
}

bool pyInListF(float list[], long count, float value) {
  for (long i = 0; i < count; i++) {
    if (list[i] == value) return true;
  }
  return false;
}

bool pyInListS(String list[], long count, String value) {
  for (long i = 0; i < count; i++) {
    if (list[i] == value) return true;
  }
  return false;
}
