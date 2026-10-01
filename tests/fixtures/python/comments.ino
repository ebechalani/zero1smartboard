// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
A docstring header with * / inside,
and a / * too.
*/
// The comment of the imports stays with them.

const int LED_RED = A1;        // red LED

const int led = LED_RED;

// Flash the red LED.
//
// A second paragraph.
void flash(long times) {
  for (long i = 0; i < times; i++) {
    digitalWrite(led, HIGH);
    delay(100);
    digitalWrite(led, LOW);
    delay(100);
    // the end of the loop body stays inside its braces \.
  }
  // the end of the function body too
}

// Runs once: the lines before "while True:"
void setup() {
  pinMode(led, OUTPUT);
}

// Runs forever: the body of "while True:" (line 27)
void loop() {
  // before the first statement
  flash(2);                    // two flashes

  // after a blank line
  delay(1000);
  // the end of the main loop
}
