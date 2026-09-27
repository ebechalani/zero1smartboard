/*
  ZERO1 Smart Board - 49 Button B - long beep
  -------------------------------------------
  WHAT IT TEACHES
    - The same program as the short beep, with a longer delay: the length of
      a sound is the time the pin stays HIGH.

  PARTS AND PINS
    - Button B (Button 2)  D7
    - Buzzer ............. D8

  EXPECTED BEHAVIOUR
    - Each time Button B is pressed the buzzer gives a LONG beep (1 s).
    - Holding the button gives a 1 s beep every 1.2 s.

  TRY THIS
    - Combine with sketch 48: Button A short beep, Button B long beep.
    - Send an SOS in Morse code: three short, three long, three short.
*/

const int BUTTON_B = 7;
const int BUZZER = 8;
const int BEEP_TIME = 1000;   // milliseconds: a long beep

void setup() {
  pinMode(BUTTON_B, INPUT);
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  if (digitalRead(BUTTON_B) == HIGH) {
    digitalWrite(BUZZER, HIGH);
    delay(BEEP_TIME);
    digitalWrite(BUZZER, LOW);
    delay(200);                // a rest between two long beeps
  }
}
