/*
  ZERO1 Smart Board - 10 Buttons and LEDs
  ---------------------------------------
  WHAT IT TEACHES
    - Reading a push button with digitalRead(): it gives HIGH or LOW.
    - Taking a decision with if / else.
    - On the ZERO1 board a pressed button reads HIGH (there is a pull-down
      resistor next to each button). Not pressed = LOW.

  PARTS AND PINS
    - Button 1 (A) ....... D6
    - Button 2 (B) ....... D7
    - Red LED ............ A1
    - Green LED .......... A2

  EXPECTED BEHAVIOUR
    - While Button 1 is held down, the red LED is on. Release it: the LED is off.
    - While Button 2 is held down, the green LED is on.
    - Both can be pressed at the same time. Nothing is printed to Serial.

  TRY THIS
    - Swap the LEDs: Button 1 -> green, Button 2 -> red.
    - Light the red LED only when BOTH buttons are pressed (use &&).
*/

const int BUTTON_A = 6;
const int BUTTON_B = 7;
const int LED_RED = A1;
const int LED_GREEN = A2;

void setup() {
  pinMode(BUTTON_A, INPUT);    // we READ these pins...
  pinMode(BUTTON_B, INPUT);
  pinMode(LED_RED, OUTPUT);    // ...and we WRITE these ones
  pinMode(LED_GREEN, OUTPUT);
}

void loop() {
  // Button 1 -> red LED, written the long way with if / else
  if (digitalRead(BUTTON_A) == HIGH) {
    digitalWrite(LED_RED, HIGH);     // pressed: LED on
  } else {
    digitalWrite(LED_RED, LOW);      // not pressed: LED off
  }

  // Button 2 -> green LED, written the short way:
  // digitalRead() gives HIGH or LOW, exactly what digitalWrite() needs
  digitalWrite(LED_GREEN, digitalRead(BUTTON_B));
}
