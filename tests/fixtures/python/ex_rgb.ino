// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
RGB LED: red, green, blue, one second each.
*/

#include <Adafruit_NeoPixel.h>

const int RGB_PIN = 9;         // RGB LED (WS2812)

Adafruit_NeoPixel np(1, RGB_PIN, NEO_GRB + NEO_KHZ800);

const unsigned long RED = 0xFF0000;   // (255, 0, 0)
const unsigned long GREEN = 0x00FF00;   // (0, 255, 0)
const unsigned long BLUE = 0x0000FF;  // (0, 0, 255)
const unsigned long COLOURS[3] = {RED, GREEN, BLUE};

// Runs once: the lines before "while True:"
void setup() {
  np.begin();
}

// Runs forever: the body of "while True:" (line 14)
void loop() {
  for (long colourIndex = 0; colourIndex < 3; colourIndex++) {
    unsigned long colour = COLOURS[colourIndex];
    np.setPixelColor(0, colour);
    np.show();
    delay(1000);
  }
}
