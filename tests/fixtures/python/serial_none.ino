// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// No print(), no input(), nothing that can stop the program: no Serial.begin (§3.4).

const int LED_RED = A1;        // red LED
const int BUTTON_1 = 6;        // button 1

const int led = LED_RED;
const int button = BUTTON_1;

// Runs once: the lines before "while True:"
void setup() {
  pinMode(led, OUTPUT);
  pinMode(button, INPUT);
}

// Runs forever: the body of "while True:" (line 8)
void loop() {
  if (digitalRead(button) == HIGH) {
    digitalWrite(led, HIGH);
  } else {
    digitalWrite(led, LOW);
  }
}
