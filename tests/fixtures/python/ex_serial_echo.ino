// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
Serial echo and commands: on, off, blink <n>.
*/

const int LED_RED = A1;        // red LED

const int led = LED_RED;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(led, OUTPUT);
  Serial.println("Type on, off or a number of blinks");
}

// Runs forever: the body of "while True:" (line 9)
void loop() {
  String command = pyLower(pyStrip(pyInput("> ")));
  if (command == "on") {
    digitalWrite(led, HIGH);
    Serial.println("LED on");
  } else if (command == "off") {
    digitalWrite(led, LOW);
    Serial.println("LED off");
  } else {
    if (pyIsInt(command)) {
      long times = pyInt(command, 0);
      for (long i = 0; i < times; i++) {
        digitalWrite(led, HIGH);
        delay(200);
        digitalWrite(led, LOW);
        delay(200);
      }
      Serial.print("Blinked ");
      Serial.print(times);
      Serial.println(" times");
    } else {
      Serial.print("Unknown command: ");
      Serial.println(command);
    }
  }
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

String pyLower(String text) {
  text.toLowerCase();
  return text;
}

String pyStrip(String text) {
  text.trim();
  return text;
}
