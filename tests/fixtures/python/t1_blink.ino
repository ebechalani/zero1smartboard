// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
ZERO1 Smart Board - 01 Blink the red LED
...
*/

const int LED_RED = A1;        // red LED

const float BLINK_TIME = 0.5;  // how long the LED stays on (and off), in seconds
const int led = LED_RED;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(led, OUTPUT);        // the red LED is an output
}

// Runs forever: the body of "while True:" (line 13)
void loop() {
  digitalWrite(led, HIGH);     // 5 V on the pin: the LED lights up
  Serial.println("ON");
  delay(round(BLINK_TIME * 1000));  // wait; the board does nothing else meanwhile

  digitalWrite(led, LOW);      // 0 V on the pin: the LED goes off
  Serial.println("OFF");
  delay(round(BLINK_TIME * 1000));
}
