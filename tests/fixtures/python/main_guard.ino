// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
The main guard is unwrapped (§2.1 rule 3).
*/

const int LED_RED = A1;        // red LED

const int led = LED_RED;

void blink(long times) {
  for (long i = 0; i < times; i++) {
    digitalWrite(led, HIGH);
    delay(250);
    digitalWrite(led, LOW);
    delay(250);
  }
}

// Runs once: the lines before "while True:"
void setup() {
  pinMode(led, OUTPUT);
  // Blink three times, then once a second.
  blink(3);
}

// Runs forever: the body of "while True:" (line 20)
void loop() {
  blink(1);
  delay(1000);
}
