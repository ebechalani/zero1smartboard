/*
  ZERO1 Smart Board - 45 Beep with red LED 10 times
  -------------------------------------------------
  WHAT IT TEACHES
    - Two outputs driven together: the LED and the buzzer switch at the same
      moment, so you see and hear every beep.
    - A small function (beep) keeps loop code short and readable.

  PARTS AND PINS
    - Buzzer ............. D8
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - 10 times: the red LED lights AND the buzzer sounds for 200 ms, then both
      are off for 300 ms. Afterwards both stay off. Serial prints "Done".

  TRY THIS
    - Light the green LED during the silence instead.
    - Count down on Serial: 10, 9, 8, ... 1.
*/

const int BUZZER = 8;
const int LED_RED = A1;
const int ON_TIME = 200;    // milliseconds of light + sound
const int OFF_TIME = 300;   // milliseconds of rest

// One beep with the LED on, then a rest
void beep() {
  digitalWrite(LED_RED, HIGH);
  digitalWrite(BUZZER, HIGH);
  delay(ON_TIME);
  digitalWrite(LED_RED, LOW);
  digitalWrite(BUZZER, LOW);
  delay(OFF_TIME);
}

void setup() {
  pinMode(BUZZER, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  Serial.begin(9600);

  for (int i = 1; i <= 10; i++) {
    beep();
  }
  Serial.println("Done");
}

void loop() {
  // Finished: everything happened in setup().
}
