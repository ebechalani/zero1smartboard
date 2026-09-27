/*
  ZERO1 Smart Board - 48 Button A - short beep
  --------------------------------------------
  WHAT IT TEACHES
    - An input (button) that triggers an output (buzzer).
    - A "beep" is just HIGH, a delay, LOW: the delay sets the length.

  PARTS AND PINS
    - Button A (Button 1)  D6
    - Buzzer ............. D8

  EXPECTED BEHAVIOUR
    - Each time Button A is pressed the buzzer gives a SHORT beep (100 ms).
    - Holding the button gives a beep every 300 ms (100 ms sound, 200 ms rest).

  TRY THIS
    - Change BEEP_TIME to 30 for a "click".
    - Print "Beep!" to Serial at every beep.
*/

const int BUTTON_A = 6;
const int BUZZER = 8;
const int BEEP_TIME = 100;   // milliseconds: a short beep

void setup() {
  pinMode(BUTTON_A, INPUT);
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {
    digitalWrite(BUZZER, HIGH);
    delay(BEEP_TIME);
    digitalWrite(BUZZER, LOW);
    delay(200);                // a rest, so that holding gives separate beeps
  }
}
