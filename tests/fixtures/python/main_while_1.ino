// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// The main loop may be written while 1: too (§2.1).

const int LED_GREEN = A2;      // green LED

const int led = LED_GREEN;

// Runs once: the lines before "while 1:"
void setup() {
  pinMode(led, OUTPUT);
}

// Runs forever: the body of "while 1:" (line 8)
void loop() {
  digitalWrite(led, !digitalRead(led));   // on, off, on, …
  delay(1000);
}
