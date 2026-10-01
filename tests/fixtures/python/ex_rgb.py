"""RGB LED: red, green, blue, one second each."""
from machine import Pin
from neopixel import NeoPixel
from zero1 import RGB_PIN
import time

RED = (255, 0, 0)
GREEN = (0, 255, 0)
BLUE = (0, 0, 255)
COLOURS = [RED, GREEN, BLUE]

np = NeoPixel(Pin(RGB_PIN), 1)

while True:
    for colour in COLOURS:
        np[0] = colour
        np.write()
        time.sleep(1)
