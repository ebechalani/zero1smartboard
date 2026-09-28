/*
  ZERO1 Smart Board - 43 Short beeps forever
  ------------------------------------------
  WHAT IT TEACHES
    - The board has an ACTIVE buzzer: it sounds as long as its pin is HIGH,
      exactly like an LED lights as long as its pin is HIGH.
    - A short HIGH followed by a longer LOW makes a "beep ... beep ... beep".

  PARTS AND PINS
    - Buzzer ............. D8

  EXPECTED BEHAVIOUR
    - A 100 ms beep followed by 400 ms of silence, forever: two beeps per
      second (one every 500 ms).

  TRY THIS
    - Change PAUSE_TIME to 100 for an alarm sound.
    - Replace the digitalWrite() calls by tone(BUZZER, 1000) and noTone(BUZZER).
*/

const int BUZZER = 8;
const int BEEP_TIME = 100;    // milliseconds of sound
const int PAUSE_TIME = 400;   // milliseconds of silence

void setup() {
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  digitalWrite(BUZZER, HIGH);   // the buzzer sounds
  delay(BEEP_TIME);
  digitalWrite(BUZZER, LOW);    // silence
  delay(PAUSE_TIME);
}
