"""
ZERO1 Smart Board - 42 Blink the red LED 10 times
-------------------------------------------------
WHAT IT TEACHES
  - A for loop repeats a block of code a fixed number of times.
    range(1, 11) counts 1, 2, 3, ... 10: it stops BEFORE 11.
  - A program without "while True:" runs once, from top to bottom, and then
    ends: the blinking stops after 10 times.

PARTS AND PINS
  - Red LED ............ A1  (LED_RED)

EXPECTED BEHAVIOUR
  - The red LED blinks exactly 10 times (300 ms on, 300 ms off), then
    stays off.
  - The Serial Monitor shows "Blink 1" ... "Blink 10" and finally "Done".

TRY THIS
  - Change 11 to 4 in range(): only 3 blinks.
  - Put the for loop inside a "while True:" loop and add time.sleep(2)
    after it: 10 blinks, a 2 s pause, 10 blinks, ...
"""
from machine import Pin
from zero1 import LED_RED
import time

BLINK_TIME = 0.3               # seconds on, then off

led = Pin(LED_RED, Pin.OUT)

for n in range(1, 11):         # n goes 1, 2, 3, ... 10
    print("Blink", n)
    led.on()
    time.sleep(BLINK_TIME)
    led.off()
    time.sleep(BLINK_TIME)

print("Done")                  # no "while True:": the program ends here
