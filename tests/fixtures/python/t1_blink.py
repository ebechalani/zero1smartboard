"""
ZERO1 Smart Board - 01 Blink the red LED
...
"""
from machine import Pin
from zero1 import LED_RED
import time

BLINK_TIME = 0.5              # how long the LED stays on (and off), in seconds

led = Pin(LED_RED, Pin.OUT)   # the red LED is an output

while True:
    led.on()                  # 5 V on the pin: the LED lights up
    print("ON")
    time.sleep(BLINK_TIME)    # wait; the board does nothing else meanwhile

    led.off()                 # 0 V on the pin: the LED goes off
    print("OFF")
    time.sleep(BLINK_TIME)
