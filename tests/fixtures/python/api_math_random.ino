// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// math, random and micropython (§3.9).

const long LIMIT = 10;
const float SCALE = 2.5;

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  randomSeed(42);
  float x = 1 + (2 - 1) * (random(0, 1000000) / 1000000.0);
  Serial.print(pyFloat(sqrt(2)));
  Serial.print(" ");
  Serial.print(pyFloat(sin(PI / 2)));
  Serial.print(" ");
  Serial.print(pyFloat(atan2(1, 1)));
  Serial.print(" ");
  Serial.print(pyFloat(fabs(-x)));
  Serial.print(" ");
  Serial.println(pyFloat(log10(1000)));
  Serial.print((long)floor(2.7));
  Serial.print(" ");
  Serial.print((long)ceil(2.1));
  Serial.print(" ");
  Serial.print((long)trunc(-2.7));
  Serial.print(" ");
  Serial.print(pyFloat(pow(2, 8)));
  Serial.print(" ");
  Serial.print(pyFloat(radians(180)));
  Serial.print(" ");
  Serial.println(pyFloat(degrees(PI)));
  Serial.print(pyBool(isnan(x)));
  Serial.print(" ");
  Serial.print(pyBool(isinf(x)));
  Serial.print(" ");
  Serial.print(pyFloat(EULER));
  Serial.print(" ");
  Serial.println(pyFloat(LIMIT * SCALE));
  Serial.print(random(1, 7));
  Serial.print(" ");
  Serial.print(random(1, LIMIT + 1L));
  Serial.print(" ");
  Serial.print(random(10));
  Serial.print(" ");
  Serial.print(random(5, 10));
  Serial.print(" ");
  Serial.println(pyFloat(random(0, 1000000) / 1000000.0));
  Serial.print(abs(-3));
  Serial.print(" ");
  Serial.print(pyFloat(abs(x - 3)));
  Serial.print(" ");
  Serial.print(pyAbsL(random(-5, 6)));
  Serial.print(" ");
  Serial.print(pyFloat(min(3, min(7, x))));
  Serial.print(" ");
  Serial.print(max(3, 7));
  Serial.print(" ");
  Serial.println(pyMinL(random(1, 10), 5));
  Serial.print(pyRound(2.5));
  Serial.print(" ");
  Serial.print(pyRound(3.5));
  Serial.print(" ");
  Serial.print(pyFloat(pyRoundTo(x, 2)));
  Serial.print(" ");
  Serial.print(7);
  Serial.print(" ");
  Serial.print((long)3.9);
  Serial.print(" ");
  Serial.print((long)-3.9);
  Serial.print(" ");
  Serial.print(pyFloat(7.0));
  Serial.print(" ");
  Serial.print(pyBool(0 != 0));
  Serial.print(" ");
  Serial.println(pyBool(String("a").length() > 0));
  randomSeed(micros());
}

// The Python program has no "while True:": it has ended.
void loop() {
}

// ---- Helpers that make C++ behave like Python ----

// 10 to the power n, exact on the board (pow() is not)
float pyPow10(int n) {
  float result = 1;
  for (int i = 0; i < n; i++) result *= 10;
  for (int i = 0; i > n; i--) result /= 10;
  return result;
}

// Python's round(x): halves go to the even number (round(2.5) == 2)
long pyRound(float x) {
  long n = floor(x);
  float rest = x - n;
  if (rest > 0.5 || (rest == 0.5 && n % 2 != 0)) n++;
  return n;
}

// Python's round(x, n)
float pyRoundTo(float x, int decimals) {
  float scale = pyPow10(decimals);
  return floor(x * scale + 0.5) / scale;
}

// Python's abs(), min() and max(): each value is worked out once (Arduino's abs/min/max are macros)
long pyAbsL(long x) {
  return x < 0 ? -x : x;
}

long pyMinL(long a, long b) {
  return a < b ? a : b;
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
