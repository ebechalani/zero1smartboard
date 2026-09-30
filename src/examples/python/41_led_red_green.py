"""
ZERO1 Smart Board - 41 Blink red and green alternately
------------------------------------------------------
WHAT IT TEACHES
  - Driving two outputs: while one LED is on, the other one is off.
  - Switch the old LED off before the new one on, so both are never lit
    together.

PARTS AND PINS
  - Red LED ............ A1  (LED_RED)
  - Green LED .......... A2  (LED_GREEN)

EXPECTED BEHAVIOUR
  - Red ON and green OFF for 500 ms, then red OFF and green ON for 500 ms,
    forever. The two LEDs are never on at the same time.

TRY THIS
  - Make the red LED stay on twice as long as the green one.
  - Turn both LEDs on together for 0.2 s between the two steps.
"""
from machine import Pin
from zero1 import LED_RED, LED_GREEN
import time

WAIT_TIME = 0.5                # seconds

red = Pin(LED_RED, Pin.OUT)
green = Pin(LED_GREEN, Pin.OUT)

while True:
    green.off()                # green off first ...
    red.on()                   # ... then red on
    time.sleep(WAIT_TIME)

    red.off()                  # red off first ...
    green.on()                 # ... then green on
    time.sleep(WAIT_TIME)
