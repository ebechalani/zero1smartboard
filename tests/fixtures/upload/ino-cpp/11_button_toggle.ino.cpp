#include <Arduino.h>
#line 1 "11_button_toggle.ino"
/*
  ZERO1 Smart Board - 11 Button toggle (with debounce)
  ----------------------------------------------------
  WHAT IT TEACHES
    - Reacting to the MOMENT a button is pressed (an "edge"), not to the
      button being held down. Each press toggles the LED: on, off, on, ...
    - Debouncing: a real button "bounces" (it flickers between HIGH and LOW
      for a few milliseconds when you press it). We only trust a reading that
      has stayed the same for DEBOUNCE_TIME ms. This is the same method as
      the official Arduino "Debounce" example.
    - Remembering things between two runs of loop() with global variables.

  PARTS AND PINS
    - Button 1 (A) ....... D6  (pressed = HIGH on the ZERO1 board)
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - Press Button 1: the red LED turns on and stays on after you release it.
      Press again: it turns off. And so on.
    - Serial prints one line per press, for example:
        Press #1 -> LED ON
        Press #2 -> LED OFF
    - Holding the button down does not toggle again; only a new press does.

  TRY THIS
    - Set DEBOUNCE_TIME to 0 and press a real button quickly: sometimes the
      LED toggles twice for one press. That is the bounce.
    - Use Button 2 to reset pressCount to 0.
*/

const int BUTTON_A = 6;
const int LED_RED = A1;
const unsigned long DEBOUNCE_TIME = 50;   // ms during which the reading must stay stable

int buttonState = LOW;          // the stable (debounced) state of the button
int lastReading = LOW;          // what we read the last time round loop()
unsigned long lastChangeTime = 0;   // when the raw reading last changed
bool ledOn = false;
int pressCount = 0;

#line 41 "11_button_toggle.ino"
void setup();
#line 48 "11_button_toggle.ino"
void loop();
#line 41 "11_button_toggle.ino"
void setup() {
  pinMode(BUTTON_A, INPUT);
  pinMode(LED_RED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Press Button 1 to toggle the red LED");
}

void loop() {
  int reading = digitalRead(BUTTON_A);

  if (reading != lastReading) {
    lastChangeTime = millis();    // the signal moved: restart the timer
  }

  if (millis() - lastChangeTime > DEBOUNCE_TIME) {
    // The reading has been steady for 50 ms: we can trust it.
    if (reading != buttonState) {
      buttonState = reading;      // the button really changed

      if (buttonState == HIGH) {  // this is the moment the button goes DOWN
        ledOn = !ledOn;           // flip: true becomes false, false becomes true
        pressCount++;
        digitalWrite(LED_RED, ledOn ? HIGH : LOW);
        Serial.print("Press #");
        Serial.print(pressCount);
        Serial.println(ledOn ? " -> LED ON" : " -> LED OFF");
      }
    }
  }

  lastReading = reading;          // remember for the next loop()
}

