"""
ZERO1 Smart Board - 47 RGB LED: red, green, blue
------------------------------------------------
WHAT IT TEACHES
  - The RGB LED is a NeoPixel: one data wire, any colour.
  - A colour is three numbers from 0 to 255: (red, green, blue).
    (255, 0, 0) is the brightest red; this program uses 80 for a soft light.
  - np[0] = colour prepares the colour of LED number 0, np.write() really
    sends it.

PARTS AND PINS
  - RGB LED (NeoPixel) . D9  (RGB_PIN)

EXPECTED BEHAVIOUR
  - The RGB LED shows red for 1 s, green for 1 s, blue for 1 s, then starts
    again with red, forever.

TRY THIS
  - Add yellow (80, 80, 0) and white (80, 80, 80) to the pattern.
  - Make the LED go off for 1 s between two colours: (0, 0, 0).
"""
from machine import Pin
from neopixel import NeoPixel
from zero1 import RGB_PIN
import time

WAIT_TIME = 1                  # seconds per colour

# Colours: (red, green, blue), each from 0 to 255. 80 is a soft light.
RED = (80, 0, 0)
GREEN = (0, 80, 0)
BLUE = (0, 0, 80)

np = NeoPixel(Pin(RGB_PIN), 1)   # 1 LED on pin 9


def show_colour(colour):
    """Sets the LED to one colour."""
    np[0] = colour
    np.write()


while True:
    show_colour(RED)
    time.sleep(WAIT_TIME)
    show_colour(GREEN)
    time.sleep(WAIT_TIME)
    show_colour(BLUE)
    time.sleep(WAIT_TIME)
