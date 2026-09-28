/*
  ZERO1 Smart Board - 40 Blink the red LED
  ----------------------------------------
  WHAT IT TEACHES
    - The simplest possible program: switch a pin HIGH, wait, switch it LOW, wait.
    - loop() runs again and again, so the LED blinks forever.

  PARTS AND PINS
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - The red LED is ON for 500 ms, then OFF for 500 ms, forever
      (one blink per second).
    - Nothing is printed to Serial.

  TRY THIS
    - Change WAIT_TIME to 100 for a fast blink, or 2000 for a slow one.
    - Use A2 instead of A1 to blink the green LED.
*/

const int LED_RED = A1;
const int WAIT_TIME = 500;   // milliseconds

void setup() {
  pinMode(LED_RED, OUTPUT);
}

void loop() {
  digitalWrite(LED_RED, HIGH);   // LED on
  delay(WAIT_TIME);
  digitalWrite(LED_RED, LOW);    // LED off
  delay(WAIT_TIME);
}
