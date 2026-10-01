// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  // raise and assert stop the program like an uncaught Python exception (§2.12).
  long level = pyInt(pyInput("Level? "), 2);
  if (!(level >= 0)) pyFail(3, "AssertionError: the level cannot be negative");
  if (!(level < 100)) pyFail(4, "AssertionError");
  if (level == 42) {
    pyFail(6, String("ValueError: no ") + String(level) + ", please");
  }
  if (level == 43) {
    pyFail(8, "RuntimeError");
  }
  if (level == 44) {
    pyFail(10, "KeyError: forty-four");
  }
  Serial.print("Level ");
  Serial.println(level);
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
