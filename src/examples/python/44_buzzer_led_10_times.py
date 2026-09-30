"""
ZERO1 Smart Board - 44 Beep 10 times with the red LED
-----------------------------------------------------
WHAT IT TEACHES
  - A for loop counts the beeps: the same code, repeated exactly 10 times.
  - Two outputs driven together: the LED and the buzzer switch at the same
    moment, so you see and hear every beep.
  - A small function (beep) keeps the code short and readable, and a
    program without "while True:" does its job once and stops.

PARTS AND PINS
  - Buzzer ............. D8  (BUZZER)
  - Red LED ............ A1  (LED_RED)

EXPECTED BEHAVIOUR
  - 10 times: the red LED lights AND the buzzer sounds for 200 ms, then both
    are off for 300 ms. Afterwards both stay off. The Serial Monitor shows
    "Done".

TRY THIS
  - Light the green LED during the silence instead.
  - Print the number of each beep, or count down: 10, 9, 8, ... 1 with
    for n in range(10, 0, -1).
"""
from machine import Pin
from zero1 import BUZZER, LED_RED
import time

ON_TIME = 200                  # milliseconds of light + sound
OFF_TIME = 300                 # milliseconds of rest

buzzer = Pin(BUZZER, Pin.OUT)
led = Pin(LED_RED, Pin.OUT)


def beep():
    """One beep with the LED on, then a rest."""
    led.on()
    buzzer.on()
    time.sleep_ms(ON_TIME)
    led.off()
    buzzer.off()
    time.sleep_ms(OFF_TIME)


for _ in range(10):            # _ : a loop variable we do not need
    beep()

print("Done")                  # no "while True:": the program ends here
