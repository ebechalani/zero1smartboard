"""
ZERO1 Smart Board - 01 Blink the red LED
----------------------------------------
WHAT IT TEACHES
  - The two parts of every board program: the lines before "while True:" run
    once, the lines inside it run again and again, forever.
  - Pin(LED_RED, Pin.OUT) prepares a pin, led.on() / led.off() switch it,
    time.sleep() waits (in seconds).
  - on = 5 V = LED on.  off = 0 V = LED off.

PARTS AND PINS
  - Red LED ............ A1 (LED_RED)

EXPECTED BEHAVIOUR
  - The red LED is ON for 500 ms, then OFF for 500 ms (one blink per second).
  - The Serial Monitor (9600 baud) prints "ON" and "OFF" at every change.

TRY THIS
  - Change BLINK_TIME to 0.1: the LED blinks five times faster.
  - Change LED_RED to LED_GREEN (on both lines) to blink the green LED instead.
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
