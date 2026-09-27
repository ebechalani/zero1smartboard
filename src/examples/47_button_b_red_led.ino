/*
  ZERO1 Smart Board - 47 Turn red LED ON with Button B
  ----------------------------------------------------
  WHAT IT TEACHES
    - The same idea as with Button A, but reading the second button (D7).
    - Only the pin number changes: the code stays the same.

  PARTS AND PINS
    - Button B (Button 2)  D7
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - While Button B is held down the red LED is ON. Release it: OFF.
    - Button A does nothing in this program.

  TRY THIS
    - Light the LED only when BOTH buttons are pressed (use &&).
    - Light the LED when EITHER button is pressed (use ||).
*/

const int BUTTON_B = 7;
const int LED_RED = A1;

void setup() {
  pinMode(BUTTON_B, INPUT);
  pinMode(LED_RED, OUTPUT);
}

void loop() {
  if (digitalRead(BUTTON_B) == HIGH) {   // pressed?
    digitalWrite(LED_RED, HIGH);
  } else {
    digitalWrite(LED_RED, LOW);
  }
}
