// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

const int LED_RED = A1;        // red LED

const int led = LED_RED;

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  pinMode(led, OUTPUT);
  for (long i = 0; i < 10; i++) {
    digitalWrite(led, HIGH);
    delay(200);
    digitalWrite(led, LOW);
    delay(200);
  }
  Serial.println("Done");
}

// The Python program has no "while True:": it has ended.
void loop() {
}
