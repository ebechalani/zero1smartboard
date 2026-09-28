/*
  ZERO1 Smart Board - 44 Beep 10 times with the red LED
  -----------------------------------------------------
  WHAT IT TEACHES
    - A for loop counts the beeps: the same code, repeated exactly 10 times.
    - Two outputs driven together: the LED and the buzzer switch at the same
      moment, so you see and hear every beep.
    - A small function (beep) keeps the code short and readable, and putting
      the loop in setup() makes the program do its job once and stop.

  PARTS AND PINS
    - Buzzer ............. D8
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - 10 times: the red LED lights AND the buzzer sounds for 200 ms, then both
      are off for 300 ms. Afterwards both stay off. Serial prints "Done".

  TRY THIS
    - Light the green LED during the silence instead.
    - Print the number of each beep, or count down on Serial: 10, 9, 8, ... 1.
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
