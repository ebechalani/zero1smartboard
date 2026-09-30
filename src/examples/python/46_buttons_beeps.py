"""
ZERO1 Smart Board - 46 Buttons: short beep and long beep
--------------------------------------------------------
WHAT IT TEACHES
  - An input (a button) that triggers an output (the buzzer).
  - A "beep" is just on, a pause, off: the pause sets the length. The same
    function beep() makes a short or a long sound depending on the number
    we give it; beep() without a number uses its default, 100 ms.
  - Waiting for the button to be RELEASED: one press = one beep, even if
    you keep the button held down.

PARTS AND PINS
  - Button 1 (A) ....... D6  (BUTTON_1)
  - Button 2 (B) ....... D7  (BUTTON_2)
  - Buzzer ............. D8  (BUZZER)

EXPECTED BEHAVIOUR
  - Press Button 1: the buzzer gives ONE short beep (100 ms).
  - Press Button 2: the buzzer gives ONE long beep (1 s).
  - Holding a button does not repeat the beep: release it and press again.
  - Nothing is printed.

TRY THIS
  - Change the default of beep() to 30 for a "click".
  - Send an SOS in Morse code with the two buttons: three short, three long,
    three short.
"""
from machine import Pin
from zero1 import BUTTON_1, BUTTON_2, BUZZER
import time

LONG_BEEP = 1000               # milliseconds

button_1 = Pin(BUTTON_1, Pin.IN)
button_2 = Pin(BUTTON_2, Pin.IN)
buzzer = Pin(BUZZER, Pin.OUT)


def beep(ms=100):
    """Sounds the buzzer for ms milliseconds (100 when no number is given)."""
    buzzer.on()
    time.sleep_ms(ms)
    buzzer.off()


def wait_for_release(button):
    """Waits until the button is not pressed any more."""
    while button.value():
        time.sleep_ms(10)      # still held: check again in a moment


while True:
    if button_1.value():
        beep()                 # a short beep: 100 ms
        wait_for_release(button_1)

    if button_2.value():
        beep(LONG_BEEP)        # a long beep: 1 s
        wait_for_release(button_2)
