// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
Traffic lights: red, red + green, green, with the built-in LED as a walk signal.
*/

const int LED_RED = A1;        // red LED
const int LED_GREEN = A2;      // green LED

const int red = LED_RED;
const int green = LED_GREEN;
const int walk = LED_BUILTIN;

void set_lights(long red_on, long green_on) {
  digitalWrite(red, red_on);
  digitalWrite(green, green_on);
}

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(red, OUTPUT);
  pinMode(green, OUTPUT);
  pinMode(walk, OUTPUT);
}

// Runs forever: the body of "while True:" (line 16)
void loop() {
  set_lights(1, 0);
  Serial.println("STOP");
  delay(3000);
  set_lights(1, 1);
  delay(1000);
  set_lights(0, 1);
  Serial.println("GO");
  for (long i = 0; i < 3; i++) {
    digitalWrite(walk, HIGH);
    delay(500);
    digitalWrite(walk, LOW);
    delay(500);
  }
}
