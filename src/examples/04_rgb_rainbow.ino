/*
  ZERO1 Smart Board - 04 RGB rainbow
  ----------------------------------
  WHAT IT TEACHES
    - The RGB LED is a NeoPixel (WS2812): one data wire, driven by a library.
    - A colour can be described by its hue (its place on the colour circle):
      0 = red, 21845 = green, 43690 = blue, 65535 = red again.
    - Using a library object: pixels.begin(), pixels.setPixelColor(), pixels.show().

  PARTS AND PINS
    - RGB LED (NeoPixel) . D9

  EXPECTED BEHAVIOUR
    - The RGB LED cycles smoothly through the rainbow:
      red -> yellow -> green -> cyan -> blue -> magenta -> red ...
    - One full turn of the colour circle takes about 2.6 s
      (256 steps of 10 ms), and it never stops.

  TRY THIS
    - Change HUE_STEP to 1024 to spin faster.
    - Change setBrightness(80) to 255 for full power.
    - Show a fixed colour instead: pixels.setPixelColor(0, pixels.Color(255, 0, 0));
*/

#include <Adafruit_NeoPixel.h>

const int RGB_PIN = 9;
const int NUM_PIXELS = 1;      // the board has one RGB LED
const long HUE_STEP = 256;     // how much the hue moves at every loop

// The object that talks to the LED: number of LEDs, pin, LED type
Adafruit_NeoPixel pixels(NUM_PIXELS, RGB_PIN, NEO_GRB + NEO_KHZ800);

long hue = 0;                  // 0 .. 65535 = one turn of the colour circle

void setup() {
  pixels.begin();              // prepare the LED
  pixels.setBrightness(80);    // 0..255: a soft light is easier on the eyes
  pixels.show();               // send "all off" to the LED
}

void loop() {
  // ColorHSV() turns a hue into a colour; gamma32() makes it look natural
  unsigned long color = pixels.gamma32(pixels.ColorHSV(hue));

  pixels.setPixelColor(0, color);   // pixel number 0 gets this colour...
  pixels.show();                    // ...and now it is really sent to the LED

  hue = hue + HUE_STEP;
  if (hue > 65535) {
    hue = 0;                        // back to red
  }
  delay(10);
}
