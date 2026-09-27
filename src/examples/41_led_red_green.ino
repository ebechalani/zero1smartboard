/*
  ZERO1 Smart Board - 41 Blinking alternately between red and green
  -----------------------------------------------------------------
  WHAT IT TEACHES
    - Driving two outputs: while one LED is on, the other one is off.
    - Switch the old LED OFF before the new one ON, so both are never lit together.

  PARTS AND PINS
    - Red LED ............ A1
    - Green LED .......... A2

  EXPECTED BEHAVIOUR
    - Red ON and green OFF for 500 ms, then red OFF and green ON for 500 ms,
      forever. The two LEDs are never on at the same time.

  TRY THIS
    - Make the red LED stay on twice as long as the green one.
    - Turn both LEDs on together for 200 ms between the two steps.
*/

const int LED_RED = A1;
const int LED_GREEN = A2;
const int WAIT_TIME = 500;   // milliseconds

void setup() {
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
}

void loop() {
  digitalWrite(LED_GREEN, LOW);    // green off first ...
  digitalWrite(LED_RED, HIGH);     // ... then red on
  delay(WAIT_TIME);

  digitalWrite(LED_RED, LOW);      // red off first ...
  digitalWrite(LED_GREEN, HIGH);   // ... then green on
  delay(WAIT_TIME);
}
