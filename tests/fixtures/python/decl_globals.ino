// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// D1: globals with an initialiser, without one (assigned where they are), shared with functions.

const int POT_LDR = A3;        // potentiometer / light sensor

const int adc = POT_LDR;
long total = 0;                // the sum of every reading
long start = 0;
long readings = 0;
long best = 0;

void add(long value) {
  total += value;
  readings += 1;
}

void reset() {
  best = 0;
}

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  start = (long)millis();      // not a fixed value: assigned in setup()

  reset();
}

// Runs forever: the body of "while True:" (line 24)
void loop() {
  add(analogRead(adc));
  if (readings % 10L == 0) {
    Serial.print(pyFloorDiv(total, pyNonZero(readings, 27)));
    Serial.print(" ");
    Serial.print((long)millis() - start);
    Serial.print(" ");
    Serial.println(best);
  }
  delay(100);
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

// Python stops with ZeroDivisionError instead of dividing by 0
long pyNonZero(long divisor, int line) {
  if (divisor == 0) pyFail(line, "ZeroDivisionError: division by zero");
  return divisor;
}
