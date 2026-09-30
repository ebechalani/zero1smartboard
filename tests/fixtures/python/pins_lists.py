# Pins in lists and as parameters (§2.9 Objects), parts made on the spot.
from machine import Pin, PWM
from zero1 import *
import time

leds = [Pin(LED_RED, Pin.OUT), Pin(LED_GREEN, Pin.OUT)]
buttons = [Pin(BUTTON_1, Pin.IN), Pin(BUTTON_2, Pin.IN)]

def blink(pin, times=2):
    for _ in range(times):
        pin.on()
        time.sleep_ms(100)
        pin.off()
        time.sleep_ms(100)

def pressed(i):
    return buttons[i].value() == 1

while True:
    for i in range(2):
        if pressed(i):
            blink(leds[i])
    if not buttons[0].value():
        Pin(MOTOR, Pin.OUT).off()
    else:
        Pin(MOTOR, Pin.OUT).on()
    leds[0].value(not leds[1].value())
    x = leds[1]()
    print(x, buttons[0]())
