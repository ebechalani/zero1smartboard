/*
  ZERO1 Smart Board - 48 Buttons colour the RGB LED
  -------------------------------------------------
  WHAT IT TEACHES
    - Two inputs choose the colour of one output.
    - if / else if / else: three cases, only one of them runs.

  PARTS AND PINS
    - Button 1 (A) ....... D6
    - Button 2 (B) ....... D7
    - RGB LED (NeoPixel) . D9

  EXPECTED BEHAVIOUR
    - While Button 1 is held the RGB LED is red; while Button 2 is held it is
      green; when no button is pressed it is off.
    - If both are pressed, Button 1 wins (it is tested first).

  TRY THIS
    - Show blue when both buttons are pressed (test that case first, with &&).
    - Keep the last colour instead of turning the LED off.
*/

#include <Adafruit_NeoPixel.h>

const int BUTTON_A = 6;
const int BUTTON_B = 7;
const int RGB_PIN = 9;

Adafruit_NeoPixel pixels(1, RGB_PIN, NEO_GRB + NEO_KHZ800);

void showColor(int red, int green, int blue) {
  pixels.setPixelColor(0, pixels.Color(red, green, blue));
  pixels.show();
}

void setup() {
  pinMode(BUTTON_A, INPUT);
  pinMode(BUTTON_B, INPUT);
  pixels.begin();
  pixels.setBrightness(80);
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {
    showColor(255, 0, 0);          // red
  } else if (digitalRead(BUTTON_B) == HIGH) {
    showColor(0, 255, 0);          // green
  } else {
    showColor(0, 0, 0);            // off
  }
  delay(20);
}
