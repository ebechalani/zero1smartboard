/*
  ZERO1 Smart Board - 46 Buttons: short beep and long beep
  --------------------------------------------------------
  WHAT IT TEACHES
    - An input (a button) that triggers an output (the buzzer).
    - A "beep" is just HIGH, a delay, LOW: the delay sets the length. The
      same function beep() makes a short or a long sound depending on the
      number we give it.
    - Waiting for the button to be RELEASED: one press = one beep, even if
      you keep the button held down.

  PARTS AND PINS
    - Button 1 (A) ....... D6
    - Button 2 (B) ....... D7
    - Buzzer ............. D8

  EXPECTED BEHAVIOUR
    - Press Button 1: the buzzer gives ONE short beep (100 ms).
    - Press Button 2: the buzzer gives ONE long beep (1 s).
    - Holding a button does not repeat the beep: release it and press again.
    - Nothing is printed to Serial.

  TRY THIS
    - Change SHORT_BEEP to 30 for a "click".
    - Send an SOS in Morse code with the two buttons: three short, three long,
      three short.
*/

const int BUTTON_A = 6;
const int BUTTON_B = 7;
const int BUZZER = 8;
const int SHORT_BEEP = 100;   // milliseconds
const int LONG_BEEP = 1000;   // milliseconds

// Sounds the buzzer for ms milliseconds
void beep(int ms) {
  digitalWrite(BUZZER, HIGH);
  delay(ms);
  digitalWrite(BUZZER, LOW);
}

// Waits until the button is not pressed any more
void waitForRelease(int button) {
  while (digitalRead(button) == HIGH) {
    delay(10);   // still held: check again in a moment
  }
}

void setup() {
  pinMode(BUTTON_A, INPUT);
  pinMode(BUTTON_B, INPUT);
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {
    beep(SHORT_BEEP);
    waitForRelease(BUTTON_A);
  }

  if (digitalRead(BUTTON_B) == HIGH) {
    beep(LONG_BEEP);
    waitForRelease(BUTTON_B);
  }
}
