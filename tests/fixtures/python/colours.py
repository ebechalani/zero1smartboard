# Colours (§3.6): literal tuples are 0xRRGGBB, computed ones the NeoPixel's Color().
from machine import Pin
from neopixel import NeoPixel
from zero1 import RGB_PIN, POT_LDR
from machine import ADC
import time

RED = (255, 0, 0)
GREEN = (0, 255, 0)     # full green
np = NeoPixel(Pin(RGB_PIN), 1)
adc = ADC(POT_LDR)

while True:
    level = adc.read() // 4
    np[0] = RED
    np.write()
    time.sleep(0.5)
    np[0] = (level, 0, 255 - level)
    np.write()
    time.sleep(0.5)
    np.fill(GREEN)
    np[-1] = (0, 0, 0)
    np.write()
    time.sleep(0.5)
