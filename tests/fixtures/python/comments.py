"""
A docstring header with */ inside,
and a /* too.
"""
# The comment of the imports stays with them.
from machine import Pin
from zero1 import LED_RED   # trailing comments on imports are dropped
import time

led = Pin(LED_RED, Pin.OUT)


def flash(times):
    """Flash the red LED.

    A second paragraph.
    """
    for _ in range(times):
        led.on()
        time.sleep(0.1)
        led.off()
        time.sleep(0.1)
        # the end of the loop body stays inside its braces \
    # the end of the function body too


while True:
    # before the first statement
    flash(2)            # two flashes

    # after a blank line
    time.sleep(1)
    # the end of the main loop
