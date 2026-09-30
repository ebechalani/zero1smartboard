// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  // N2-N5: division, floor division and modulo (with the non-negative facts), guards, powers.
  long x = 7;
  long y = -2;
  float f = 2.5;
  long zero = 0;
  Serial.print(pyFloat(x / 2.0));
  Serial.print(" ");
  Serial.print(pyFloat((float)x / pyNonZero(y, 6)));
  Serial.print(" ");
  Serial.print(pyFloat(1.0 / pyNonZero(x, 6)));
  Serial.print(" ");
  Serial.print(pyFloat(f / 2));
  Serial.print(" ");
  Serial.println(pyFloat(x / pyNonZeroF(f, 6)));
  Serial.print(x / 2L);
  Serial.print(" ");
  Serial.print(x % 3L);
  Serial.print(" ");
  Serial.print(pyFloorDiv(y, 2L));
  Serial.print(" ");
  Serial.print(pyMod(y, 3L));
  Serial.print(" ");
  Serial.print(pyFloorDiv(x, pyNonZero(y, 7)));
  Serial.print(" ");
  Serial.println(pyMod(x, pyNonZero(y, 7)));
  Serial.print(pyFloat(floor(f / 2)));
  Serial.print(" ");
  Serial.print(pyFloat(pyFloatMod(f, 2)));
  Serial.print(" ");
  Serial.print(pyFloat(floor(x / pyNonZeroF(f, 8))));
  Serial.print(" ");
  Serial.println(pyFloat(pyFloatMod(-f, 3)));
  Serial.print(pyPow(x, 2, 9));
  Serial.print(" ");
  Serial.print(1024);
  Serial.print(" ");
  Serial.print(-4);
  Serial.print(" ");
  Serial.print(pyFloat(pow(2, -1)));
  Serial.print(" ");
  Serial.print(pyFloat(pow(f, 2)));
  Serial.print(" ");
  Serial.println(-pyPow(x, 2, 9));
  Serial.print(pyPow(x, 3, 10));
  Serial.print(" ");
  Serial.println(pyFloat(pow(2.0, 0.5)));
  long total = 10;
  total = pyFloorDiv(total, 3L);
  total = pyMod(total, 4L);
  total = pyPow(total, 2, 14);
  long ratio = 10;
  float ratio_2 = ratio / 4.0;  // 'ratio' again, now a decimal number
  Serial.print(total);
  Serial.print(" ");
  Serial.print(pyFloat(ratio_2));
  Serial.print(" ");
  Serial.println(pyFloat(zero != 0 ? (float)x / pyNonZero(zero, 17) : 0));
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

// Python's // for whole numbers: rounds down (C++'s / rounds toward zero)
long pyFloorDiv(long a, long b) {
  long q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
  return q;
}

// Python's % for whole numbers: the result has the sign of the divisor
long pyMod(long a, long b) {
  long r = a % b;
  if (r != 0 && ((r < 0) != (b < 0))) r += b;
  return r;
}

// Python's % for decimal numbers
float pyFloatMod(float a, float b) {
  float r = fmod(a, b);
  if (r != 0 && ((r < 0) != (b < 0))) r += b;
  return r;
}

// Python stops with ZeroDivisionError instead of dividing by 0
long pyNonZero(long divisor, int line) {
  if (divisor == 0) pyFail(line, "ZeroDivisionError: division by zero");
  return divisor;
}

float pyNonZeroF(float divisor, int line) {
  if (divisor == 0) pyFail(line, "ZeroDivisionError: division by zero");
  return divisor;
}

// Python's ** for whole numbers
long pyPow(long base, long exponent, int line) {
  if (exponent < 0) pyFail(line, "a negative power of a whole number is a decimal number: write 2.0 ** n");
  long result = 1;
  for (long i = 0; i < exponent; i++) result *= base;
  return result;
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
  if (x == 0) return 1 / x < 0 ? "-0.0" : "0.0";
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
