"""
ZERO1 Smart Board - 45 Buttons light the LEDs
---------------------------------------------
WHAT IT TEACHES
  - button.value() tells us whether a button is pressed (1) or not (0).
  - if / else: one thing when pressed, another thing when released.
  - Two inputs and two outputs in the same "while True:" loop: each button
    is checked in turn, again and again, many times per second.

PARTS AND PINS
  - Button 1 (A) ....... D6  (BUTTON_1)
  - Button 2 (B) ....... D7  (BUTTON_2)
  - Red LED ............ A1  (LED_RED)
  - Green LED .......... A2  (LED_GREEN)

EXPECTED BEHAVIOUR
  - While Button 1 is held down the red LED is ON. Release it: OFF.
  - While Button 2 is held down the green LED is ON. Release it: OFF.
  - Both can be pressed at the same time. Nothing is printed.

TRY THIS
  - Swap the LEDs: Button 1 -> green, Button 2 -> red.
  - Light the red LED only when BOTH buttons are pressed (use "and").
"""
from machine import Pin
from zero1 import BUTTON_1, BUTTON_2, LED_RED, LED_GREEN
import time

button_1 = Pin(BUTTON_1, Pin.IN)   # we READ these pins ...
button_2 = Pin(BUTTON_2, Pin.IN)
red = Pin(LED_RED, Pin.OUT)        # ... and we WRITE these ones
green = Pin(LED_GREEN, Pin.OUT)

while True:
    if button_1.value():           # Button 1 pressed?
        red.on()
    else:
        red.off()

    if button_2.value():           # Button 2 pressed?
        green.on()
    else:
        green.off()

    time.sleep_ms(10)              # a short rest: 100 checks per second is plenty
