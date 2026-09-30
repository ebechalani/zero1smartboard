"""The main guard is unwrapped (§2.1 rule 3)."""
from machine import Pin
from zero1 import LED_RED
import time

led = Pin(LED_RED, Pin.OUT)


def blink(times):
    for _ in range(times):
        led.on()
        time.sleep(0.25)
        led.off()
        time.sleep(0.25)


if __name__ == "__main__":
    # Blink three times, then once a second.
    blink(3)
    while True:
        blink(1)
        time.sleep(1)
