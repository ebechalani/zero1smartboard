#include <Arduino.h>
#line 1 "01_blink_red.ino"
/*
  ZERO1 Smart Board - 01 Blink the red LED
  ----------------------------------------
  WHAT IT TEACHES
    - The two parts of every Arduino program: setup() runs once, loop() runs forever.
    - pinMode() prepares a pin, digitalWrite() switches it, delay() waits.
    - HIGH = 5 V = LED on.  LOW = 0 V = LED off.

  PARTS AND PINS
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - The red LED is ON for 500 ms, then OFF for 500 ms (one blink per second).
    - The Serial Monitor (9600 baud) prints "ON" and "OFF" at every change.

  TRY THIS
    - Change BLINK_TIME to 100: the LED blinks five times faster.
    - Change A1 to A2 to blink the green LED instead.
*/

const int LED_RED = A1;      // the red LED is wired to pin A1
const int BLINK_TIME = 500;  // how long the LED stays on (and off), in milliseconds

#line 24 "01_blink_red.ino"
void setup();
#line 29 "01_blink_red.ino"
void loop();
#line 24 "01_blink_red.ino"
void setup() {
  pinMode(LED_RED, OUTPUT);  // tell the board that we will drive this pin
  Serial.begin(9600);        // open the Serial Monitor at 9600 baud
}

void loop() {
  digitalWrite(LED_RED, HIGH);  // 5 V on the pin: the LED lights up
  Serial.println("ON");
  delay(BLINK_TIME);            // wait; the board does nothing else meanwhile

  digitalWrite(LED_RED, LOW);   // 0 V on the pin: the LED goes off
  Serial.println("OFF");
  delay(BLINK_TIME);
}

