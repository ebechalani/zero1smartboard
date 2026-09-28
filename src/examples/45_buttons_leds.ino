/*
  ZERO1 Smart Board - 45 Buttons light the LEDs
  ---------------------------------------------
  WHAT IT TEACHES
    - digitalRead() tells us whether a button is pressed (HIGH) or not (LOW).
    - if / else: one thing when pressed, another thing when released.
    - Two inputs and two outputs in the same loop(): each button is checked
      in turn, again and again, many times per second.

  PARTS AND PINS
    - Button 1 (A) ....... D6
    - Button 2 (B) ....... D7
    - Red LED ............ A1
    - Green LED .......... A2

  EXPECTED BEHAVIOUR
    - While Button 1 is held down the red LED is ON. Release it: OFF.
    - While Button 2 is held down the green LED is ON. Release it: OFF.
    - Both can be pressed at the same time. Nothing is printed to Serial.

  TRY THIS
    - Swap the LEDs: Button 1 -> green, Button 2 -> red.
    - Light the red LED only when BOTH buttons are pressed (use &&).
*/

const int BUTTON_A = 6;
const int BUTTON_B = 7;
const int LED_RED = A1;
const int LED_GREEN = A2;

void setup() {
  pinMode(BUTTON_A, INPUT);    // we READ these pins ...
  pinMode(BUTTON_B, INPUT);
  pinMode(LED_RED, OUTPUT);    // ... and we WRITE these ones
  pinMode(LED_GREEN, OUTPUT);
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {   // Button 1 pressed?
    digitalWrite(LED_RED, HIGH);
  } else {
    digitalWrite(LED_RED, LOW);
  }

  if (digitalRead(BUTTON_B) == HIGH) {   // Button 2 pressed?
    digitalWrite(LED_GREEN, HIGH);
  } else {
    digitalWrite(LED_GREEN, LOW);
  }

  delay(10);   // a short rest: 100 checks per second is plenty
}
