"""
ZERO1 Smart Board - 40 Blink the red LED
----------------------------------------
WHAT IT TEACHES
  - The simplest possible program: switch a pin on, wait, switch it off,
    wait.
  - The lines inside "while True:" run again and again, so the LED blinks
    forever.

PARTS AND PINS
  - Red LED ............ A1  (LED_RED)

EXPECTED BEHAVIOUR
  - The red LED is ON for 500 ms, then OFF for 500 ms, forever
    (one blink per second).
  - Nothing is printed to the Serial Monitor.

TRY THIS
  - Change WAIT_TIME to 0.1 for a fast blink, or 2 for a slow one.
  - Use LED_GREEN instead of LED_RED (on both lines) to blink the green LED.
"""
from machine import Pin
from zero1 import LED_RED
import time

WAIT_TIME = 0.5                # seconds

led = Pin(LED_RED, Pin.OUT)    # the red LED is an output

while True:
    led.on()                   # LED on
    time.sleep(WAIT_TIME)
    led.off()                  # LED off
    time.sleep(WAIT_TIME)
