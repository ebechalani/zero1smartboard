"""Traffic lights: red, red + green, green, with the built-in LED as a walk signal."""
from machine import Pin
from zero1 import LED_RED, LED_GREEN, LED_BUILTIN
import time

red = Pin(LED_RED, Pin.OUT)
green = Pin(LED_GREEN, Pin.OUT)
walk = Pin(LED_BUILTIN, Pin.OUT)


def set_lights(red_on, green_on):
    red.value(red_on)
    green.value(green_on)


while True:
    set_lights(1, 0)
    print("STOP")
    time.sleep(3)
    set_lights(1, 1)
    time.sleep(1)
    set_lights(0, 1)
    print("GO")
    for _ in range(3):
        walk.on()
        time.sleep(0.5)
        walk.off()
        time.sleep(0.5)
