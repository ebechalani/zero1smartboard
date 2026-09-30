// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// Colours (§3.6): literal tuples are 0xRRGGBB, computed ones the NeoPixel's Color().

#include <Adafruit_NeoPixel.h>

const int POT_LDR = A3;        // potentiometer / light sensor
const int RGB_PIN = 9;         // RGB LED (WS2812)

Adafruit_NeoPixel np(1, RGB_PIN, NEO_GRB + NEO_KHZ800);

const unsigned long RED = 0xFF0000;   // (255, 0, 0)
const unsigned long GREEN = 0x00FF00;   // (0, 255, 0)  full green
const int adc = POT_LDR;

// Runs once: the lines before "while True:"
void setup() {
  np.begin();
}

// Runs forever: the body of "while True:" (line 13)
void loop() {
  long level = (long)analogRead(adc) / 4L;
  np.setPixelColor(0, RED);
  np.show();
  delay(500);
  np.setPixelColor(0, level, 0, 255L - level);
  np.show();
  delay(500);
  np.fill(GREEN);
  np.setPixelColor(0, 0x000000);
  np.show();
  delay(500);
}
