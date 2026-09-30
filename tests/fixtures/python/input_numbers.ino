// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  // input() echoes the line (§2.6); int() / float() of text stop with ValueError like Python.
}

// Runs forever: the body of "while True:" (line 2)
void loop() {
  long age = pyInt(pyInput("Age? "), 3);
  float height = pyFloatOf(pyInput("Height in m? "), 4);
  Serial.print("In ten years: ");
  Serial.print(age + 10L);
  Serial.print(" Height: ");
  Serial.println(pyFloat(height));
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
