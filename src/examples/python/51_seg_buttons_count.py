"""
ZERO1 Smart Board - 51 Count up and down with the buttons
---------------------------------------------------------
WHAT IT TEACHES
  - The 7-segment display is driven by a 74HC595 shift register;
    SevenSegment() does that for you: display.show(n) shows the digit n
    (0 to 9), display.clear() switches every segment off.
  - A for loop that counts UP, range(1, 5), and one that counts DOWN,
    range(7, 0, -1), each started by its own button.

PARTS AND PINS
  - Button 1 (A) ....... D6  (BUTTON_1)
  - Button 2 (B) ....... D7  (BUTTON_2)
  - 7-segment DATA ..... D12 (74HC595 DS)
  - 7-segment LATCH .... D11 (74HC595 ST_CP)
  - 7-segment CLOCK .... D10 (74HC595 SH_CP)

EXPECTED BEHAVIOUR
  - At the start the display is blank.
  - Press Button 1: the display shows 1, 2, 3, 4 (one digit per second),
    then goes blank again.
  - Press Button 2: the display shows 7, 6, 5, 4, 3, 2, 1 (one digit per
    second), then goes blank again.
  - The Serial Monitor shows each digit as it is shown.

TRY THIS
  - Count from 1 to 9, or down from 9 to 0 with a beep at 0 (a launch
    countdown!).
  - Show the digits faster (time.sleep(0.3)).
"""
from machine import Pin
from zero1 import BUTTON_1, BUTTON_2, SevenSegment
import time

button_1 = Pin(BUTTON_1, Pin.IN)
button_2 = Pin(BUTTON_2, Pin.IN)
display = SevenSegment()


def show_digit(digit):
    """Shows one digit (0 to 9) for a second and prints it."""
    display.show(digit)
    print(digit)
    time.sleep(1)


display.clear()                # blank display

while True:
    if button_1.value():
        for n in range(1, 5):          # 1, 2, 3, 4
            show_digit(n)
        display.clear()                # blank again

    if button_2.value():
        for n in range(7, 0, -1):      # 7, 6, 5, 4, 3, 2, 1
            show_digit(n)
        display.clear()                # blank again
