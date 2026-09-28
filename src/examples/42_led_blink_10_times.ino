/*
  ZERO1 Smart Board - 42 Blink the red LED 10 times
  -------------------------------------------------
  WHAT IT TEACHES
    - A for loop repeats a block of code a fixed number of times.
    - Code in setup() runs only once: the blinking stops after 10 times
      because loop() is empty.

  PARTS AND PINS
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - The red LED blinks exactly 10 times (300 ms on, 300 ms off), then
      stays off.
    - Serial prints "Blink 1" ... "Blink 10" and finally "Done".

  TRY THIS
    - Change 10 to 3 in the for loop.
    - Move the for loop into loop() and add delay(2000) after it: 10 blinks,
      a 2 s pause, 10 blinks, ...
*/

const int LED_RED = A1;
const int BLINK_TIME = 300;   // milliseconds on, then off

void setup() {
  pinMode(LED_RED, OUTPUT);
  Serial.begin(9600);

  for (int i = 1; i <= 10; i++) {   // i goes 1, 2, 3, ... 10
    Serial.print("Blink ");
    Serial.println(i);
    digitalWrite(LED_RED, HIGH);
    delay(BLINK_TIME);
    digitalWrite(LED_RED, LOW);
    delay(BLINK_TIME);
  }
  Serial.println("Done");
}

void loop() {
  // Nothing here: the LED blinked 10 times in setup() and now stays off.
}
