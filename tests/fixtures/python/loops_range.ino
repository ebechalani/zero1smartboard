// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// for loops (§2.4): range forms, the stop worked out once, a hidden counter, _ loops, parallel and chained assignment.

const int LED_RED = A1;        // red LED
const int LED_GREEN = A2;      // green LED

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  long i = 0;
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  const int leds[2] = {LED_RED, LED_GREEN};
  long n = pyInt(pyInput("n? "), 7);
  for (long iCounter = 0; iCounter < n; iCounter++) {
    i = iCounter;
    Serial.println(i);
  }
  Serial.print("last ");
  Serial.println(i);
  const long jStop = n * 2L;
  for (long jCounter = 0; jCounter < jStop; jCounter += 2) {
    long j = jCounter;
    if (j == 4) {
      j = 100;
    }
    Serial.println(j);
  }
  for (long k = n; k > 0; k -= 3) {
    Serial.println(k);
  }
  for (long l = 0; l < 2; l++) {
    for (long m = 0; m < 3; m++) {
      Serial.println("x");
    }
  }
  for (long idx = 0; idx < 2; idx++) {
    digitalWrite(leds[idx], HIGH);
  }
  long a = 0;
  long b = a;
  { long t1 = b + 1L; long t2 = a + 2L; a = t1; b = t2; }
  long nums[3] = {3, 1, 2};
  { long t1 = nums[2]; long t2 = nums[0]; nums[0] = t1; nums[2] = t2; }
  Serial.print(a);
  Serial.print(" ");
  Serial.print(b);
  Serial.print(" ");
  Serial.println(pyListTextL(nums, 3));
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

// str(list) / print(list): [1, 2, 3]
String pyListTextL(long list[], long count) {
  String text = "[";
  for (long i = 0; i < count; i++) {
    if (i > 0) text += ", ";
    text += String(list[i]);
  }
  return text + "]";
}
