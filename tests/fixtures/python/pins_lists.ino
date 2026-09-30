// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// Pins in lists and as parameters (§2.9 Objects), parts made on the spot.

const int LED_RED = A1;        // red LED
const int LED_GREEN = A2;      // green LED
const int BUTTON_1 = 6;        // button 1
const int BUTTON_2 = 7;        // button 2
const int MOTOR = A0;          // DC motor driver

const int leds[2] = {LED_RED, LED_GREEN};
const int buttons[2] = {BUTTON_1, BUTTON_2};

void blink(int pin, long times) {
  for (long j = 0; j < times; j++) {
    digitalWrite(pin, HIGH);
    delay(100);
    digitalWrite(pin, LOW);
    delay(100);
  }
}

bool pressed(long i) {
  return digitalRead(buttons[pyIndex(i, 2, 17)]) == 1;
}

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(BUTTON_1, INPUT);
  pinMode(BUTTON_2, INPUT);
}

// Runs forever: the body of "while True:" (line 19)
void loop() {
  for (long i = 0; i < 2; i++) {
    if (pressed(i)) {
      blink(leds[i], 2);
    }
  }
  if (digitalRead(buttons[0]) == LOW) {
    pinMode(MOTOR, OUTPUT);
    digitalWrite(MOTOR, LOW);
  } else {
    pinMode(MOTOR, OUTPUT);
    digitalWrite(MOTOR, HIGH);
  }
  digitalWrite(leds[0], digitalRead(leds[1]) == LOW);
  long x = digitalRead(leds[1]);
  Serial.print(x);
  Serial.print(" ");
  Serial.println(digitalRead(buttons[0]));
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

// list[i] with Python's negative indexes and IndexError
long pyIndex(long index, long size, int line) {
  if (index < 0) index += size;
  if (index < 0 || index >= size) pyFail(line, "IndexError: list index out of range");
  return index;
}
