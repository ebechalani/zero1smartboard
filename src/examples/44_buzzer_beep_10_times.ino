/*
  ZERO1 Smart Board - 44 Beep 10 times
  ------------------------------------
  WHAT IT TEACHES
    - A for loop counts the beeps: the same code, repeated 10 times.
    - Putting the loop in setup() makes the program do its job once and stop.

  PARTS AND PINS
    - Buzzer ............. D8

  EXPECTED BEHAVIOUR
    - Exactly 10 beeps of 200 ms with 200 ms of silence between them, then
      silence forever. Serial prints "Beep 1" ... "Beep 10" and "Done".

  TRY THIS
    - Make every beep a bit shorter than the previous one (use i in delay()).
    - Beep 3 times, wait 2 s, beep 3 times, ... (move the loop into loop()).
*/

const int BUZZER = 8;
const int BEEP_TIME = 200;   // milliseconds

void setup() {
  pinMode(BUZZER, OUTPUT);
  Serial.begin(9600);

  for (int i = 1; i <= 10; i++) {
    Serial.print("Beep ");
    Serial.println(i);
    digitalWrite(BUZZER, HIGH);
    delay(BEEP_TIME);
    digitalWrite(BUZZER, LOW);
    delay(BEEP_TIME);
  }
  Serial.println("Done");
}

void loop() {
  // Nothing more to do: the 10 beeps were played in setup().
}
