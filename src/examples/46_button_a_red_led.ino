/*
  ZERO1 Smart Board - 46 Turn red LED ON with Button A
  ----------------------------------------------------
  WHAT IT TEACHES
    - digitalRead() tells us whether a button is pressed (HIGH) or not (LOW).
    - if / else: one thing when pressed, another thing when released.

  PARTS AND PINS
    - Button A (Button 1)  D6
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - While Button A is held down the red LED is ON. Release it: OFF.
    - Nothing is printed to Serial.

  TRY THIS
    - Invert it: the LED is on until you press the button.
    - Use the green LED (A2) instead.
*/

const int BUTTON_A = 6;
const int LED_RED = A1;

void setup() {
  pinMode(BUTTON_A, INPUT);
  pinMode(LED_RED, OUTPUT);
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {   // pressed?
    digitalWrite(LED_RED, HIGH);
  } else {
    digitalWrite(LED_RED, LOW);
  }
}
