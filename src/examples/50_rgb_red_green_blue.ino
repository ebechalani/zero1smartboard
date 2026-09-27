/*
  ZERO1 Smart Board - 50 Display patterns: Red -> Green -> Blue
  -------------------------------------------------------------
  WHAT IT TEACHES
    - The RGB LED is a NeoPixel: one data wire, driven by the Adafruit library.
    - A colour is three numbers 0..255: pixels.Color(red, green, blue).
    - setPixelColor() prepares the colour, show() really sends it.

  PARTS AND PINS
    - RGB LED (NeoPixel) . D9

  EXPECTED BEHAVIOUR
    - The RGB LED shows red for 500 ms, green for 500 ms, blue for 500 ms,
      then starts again with red, forever.

  TRY THIS
    - Add yellow (255, 255, 0) and white (255, 255, 255) to the pattern.
    - Make the LED go off for 500 ms between two colours: pixels.Color(0, 0, 0).
*/

#include <Adafruit_NeoPixel.h>

const int RGB_PIN = 9;
const int WAIT_TIME = 500;   // milliseconds per colour

Adafruit_NeoPixel pixels(1, RGB_PIN, NEO_GRB + NEO_KHZ800);   // 1 LED on pin 9

// Sets the LED to one colour (each value 0..255)
void showColor(int red, int green, int blue) {
  pixels.setPixelColor(0, pixels.Color(red, green, blue));
  pixels.show();
}

void setup() {
  pixels.begin();
  pixels.setBrightness(80);   // a soft light (0..255)
}

void loop() {
  showColor(255, 0, 0);       // red
  delay(WAIT_TIME);
  showColor(0, 255, 0);       // green
  delay(WAIT_TIME);
  showColor(0, 0, 255);       // blue
  delay(WAIT_TIME);
}
