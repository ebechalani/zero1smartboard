"""
ZERO1 Smart Board - 48 Buttons colour the RGB LED
-------------------------------------------------
WHAT IT TEACHES
  - Two inputs choose the colour of one output.
  - if / elif / else: three cases, only one of them runs.

PARTS AND PINS
  - Button 1 (A) ....... D6  (BUTTON_1)
  - Button 2 (B) ....... D7  (BUTTON_2)
  - RGB LED (NeoPixel) . D9  (RGB_PIN)

EXPECTED BEHAVIOUR
  - While Button 1 is held the RGB LED is red; while Button 2 is held it is
    green; when no button is pressed it is off.
  - If both are pressed, Button 1 wins (it is tested first).

TRY THIS
  - Show blue when both buttons are pressed (test that case first, with "and").
  - Keep the last colour instead of turning the LED off.
"""
from machine import Pin
from neopixel import NeoPixel
from zero1 import BUTTON_1, BUTTON_2, RGB_PIN
import time

RED = (80, 0, 0)
GREEN = (0, 80, 0)
OFF = (0, 0, 0)

button_1 = Pin(BUTTON_1, Pin.IN)
button_2 = Pin(BUTTON_2, Pin.IN)
np = NeoPixel(Pin(RGB_PIN), 1)

while True:
    if button_1.value():
        np[0] = RED            # Button 1 is tested first: it wins
    elif button_2.value():
        np[0] = GREEN
    else:
        np[0] = OFF            # no button: off
    np.write()
    time.sleep_ms(20)
