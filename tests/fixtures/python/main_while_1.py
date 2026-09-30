# The main loop may be written while 1: too (§2.1).
from machine import Pin
from zero1 import LED_GREEN
import time

led = Pin(LED_GREEN, Pin.OUT)

while 1:
    led.toggle()   # on, off, on, …
    time.sleep(1)
