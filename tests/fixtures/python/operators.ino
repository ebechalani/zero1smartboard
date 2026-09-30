// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// Operators and webs (§2.5, §2.9): a name that changes kind, int + bool, compound assignments, min / max / abs.

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  long x = 5;
  Serial.println(x);
  float x_2 = 2.5;             // 'x' again, now a decimal number
  Serial.println(pyFloat(x_2));
  long state = 0;
  long count = 0;
  while (count < 3) {
    state = state == 0;
    count += 1;
    Serial.println(state);
  }
  long t = pyAbsL(pyInt(pyInput("t? "), 13) - 3L);
  Serial.print(max(t, max(3, 4)));
  Serial.print(" ");
  Serial.print(pyMinL(t, pyInt("7", 14)));
  Serial.print(" ");
  Serial.print(abs(-t));
  Serial.print(" ");
  Serial.print(pyRound(-2.5));
  Serial.print(" ");
  Serial.print(pyRound(0.5));
  Serial.print(" ");
  Serial.println(pyRound(1.5));
  String s = pyFloat(3.0) + pyBool(true) + String(12);
  Serial.print(s);
  Serial.print(" ");
  Serial.print((long)s.length());
  Serial.print(" ");
  Serial.print(pyCharAt(s, 1, 16));
  Serial.print(" ");
  Serial.println(pyBool(s.indexOf("3") >= 0));
  long v = 10;
  v -= 3;
  v *= 2;
  v <<= 1;
  v >>= 1;
  v &= 0xFF;
  v |= 1;
  v ^= 2;
  Serial.print(v);
  Serial.print(" ");
  Serial.print(~v);
  Serial.print(" ");
  Serial.print(-v);
  Serial.print(" ");
  Serial.print(v);
  Serial.print(" ");
  Serial.print(pyPow(v, 2, 25));
  Serial.print(" ");
  Serial.print(pyFloorDiv(7L, -2L));
  Serial.print(" ");
  Serial.println(pyMod(-7L, 3L));
  bool flag = true;
  flag &= false;
  Serial.print(pyBool(flag));
  Serial.print(" ");
  Serial.print(pyBool(1 < v && v < 100));
  Serial.print(" ");
  Serial.print(pyBool(v == 1 || v == 2 || v == 3));
  Serial.print(" ");
  Serial.println(pyBool(v != 5));
  Serial.println(pyFloat(v > 3 ? 10 : 2.5));
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

// Python's round(x): halves go to the even number (round(2.5) == 2)
long pyRound(float x) {
  long n = floor(x);
  float rest = x - n;
  if (rest > 0.5 || (rest == 0.5 && n % 2 != 0)) n++;
  return n;
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

// text[i] with Python's negative indexes and IndexError
String pyCharAt(String text, long index, int line) {
  if (index < 0) index += text.length();
  if (index < 0 || index >= (long)text.length()) pyFail(line, "IndexError: string index out of range");
  return String(text.charAt(index));
}
