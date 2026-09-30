// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

// Functions (§2.4, §2.9): defaults and keywords, recursion, a missing return, list parameters, return without a value.
long DATA[3] = {1, 2, 3};

long fact(long n) {
  if (n <= 1) {
    return 1;
  }
  return n * fact(n - 1L);
}

long maybe(long x) {
  if (x > 0) {
    return x * 2L;
  }
  return 0;
}

void greet(String name, long times, bool loud) {
  for (long i = 0; i < times; i++) {
    if (loud) {
      Serial.println(pyUpper(name));
    } else {
      Serial.println(name);
    }
  }
}

float average(long values[], long valuesCount) {
  return (float)pySumL(values, valuesCount) / pyNonZero(valuesCount, 20);
}

void nothing() {
  return;
}

float half(float x) {
  return x / 2;
}

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  greet("ann", 1, false);
  greet("bob", 2, true);
  Serial.print(fact(5));
  Serial.print(" ");
  Serial.print(maybe(3));
  Serial.print(" ");
  Serial.print(pyFloat(average(DATA, 3)));
  Serial.print(" ");
  Serial.print(pyFloat(half(3)));
  Serial.print(" ");
  Serial.println(pyFloat(half(2.5)));
  nothing();
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

String pyUpper(String text) {
  text.toUpperCase();
  return text;
}

long pySumL(long list[], long count) {
  long total = 0;
  for (long i = 0; i < count; i++) total += list[i];
  return total;
}
