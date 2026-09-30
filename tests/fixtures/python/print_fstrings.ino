// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  // print() and f-strings (§2.11): pieces, sep / end, every accepted format spec.
  long n = -5;
  float x = 3.14159;
  String name = "ab";
  bool ok = true;
  Serial.println();
  Serial.print("one ");
  Serial.print(2);
  Serial.print(" ");
  Serial.print(pyFloat(3.5));
  Serial.print(" ");
  Serial.print(pyBool(ok));
  Serial.print(" ");
  Serial.println(name);
  Serial.println("a-b!");
  Serial.print("no newline");
  Serial.print(" then");
  Serial.println(n);
  Serial.print(pyPad(String(n), 3, '0'));
  Serial.print("|");
  Serial.print(pyHex(-1, false));
  Serial.print("|");
  Serial.print(pyBin(n));
  Serial.print("|");
  Serial.print(pyPad(name, 5, '<'));
  Serial.print("|");
  Serial.print((float)512, 2);
  Serial.print("|");
  Serial.print(x, 6);
  Serial.print("|");
  Serial.print(pyPad(String(n), 6, '>'));
  Serial.print("|");
  Serial.print(pyPad(name, 4, '>'));
  Serial.print("|");
  Serial.print(name.substring(0, 1));
  Serial.print("|");
  Serial.print(pyPad(String(x, 3), 8, '0'));
  Serial.print("|");
  Serial.print(pyBool(ok));
  Serial.print("|");
  Serial.print(pyHex(255, true));
  Serial.print("|");
  Serial.print(n);
  Serial.print("|");
  Serial.print(name);
  Serial.print("|");
  Serial.println((long)ok);
  String text = String("T = ") + String(x, 1) + " C, n = " + String(n) + ", ok = " + pyBool(ok);
  Serial.print(text);
  Serial.print(" ");
  Serial.print(String(n) + pyFloat(x));
  Serial.print(" ");
  Serial.println(pyBool(ok));
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

// f-string widths: '>' spaces on the left (numbers), '<' spaces on the right (text), '0' zeros after the sign
String pyPad(String text, int width, char how) {
  while ((int)text.length() < width) {
    if (how == '<') {
      text += " ";
    } else if (how == '0' && text.startsWith("-")) {
      text = "-0" + text.substring(1);
    } else if (how == '0') {
      text = "0" + text;
    } else {
      text = " " + text;
    }
  }
  return text;
}

// f"{n:x}" and f"{n:X}": hexadecimal, with "-" in front of negative numbers
String pyHex(long n, bool upper) {
  String text = String(n < 0 ? -n : n, HEX);
  if (upper) text.toUpperCase();
  else text.toLowerCase();
  return n < 0 ? "-" + text : text;
}

// f"{n:b}": binary, with "-" in front of negative numbers
String pyBin(long n) {
  String text = String(n < 0 ? -n : n, BIN);
  return n < 0 ? "-" + text : text;
}
