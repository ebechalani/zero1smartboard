"""
ZERO1 Smart Board - 32 Reaction game
------------------------------------
WHAT IT TEACHES
  - A small game with a clear sequence: wait for START, count down, wait a
    random time, GO, measure the reaction time.
  - random.randint(a, b) and random.seed(): the wait is different every time.
  - Measuring a duration with time.ticks_ms(): time.ticks_diff(stop, start).
  - Waiting for a button inside a while loop (wait_for_press), and starting
    the next round of the while True loop early with continue.

PARTS AND PINS
  - Button 1 (A) ....... D6  (BUTTON_1) START
  - Button 2 (B) ....... D7  (BUTTON_2) REACT
  - 7-segment .......... DATA D12, LATCH D11, CLOCK D10
  - Buzzer ............. D8  (BUZZER)
  - Red LED ............ A1  (LED_RED)
  - Green LED .......... A2  (LED_GREEN)

EXPECTED BEHAVIOUR
  1. print() shows "Press Button 1 to start..." and the display is blank.
  2. Press Button 1: the display counts 3, 2, 1 (one per second, short beep each).
  3. The display goes blank for a random time between 1 and 3 s.
     If you press Button 2 during that time: the red LED lights for 1.5 s, a
     low tone sounds, print() shows "Too early! You lose this round." and
     the game returns to step 1.
  4. GO: the display shows 8, the green LED lights and a beep sounds.
     Press Button 2 as fast as you can.
  5. print() shows "Your reaction time: 312 ms" (your value), "New record!"
     when it is the best so far, and "Best time: ... ms". The display shows
     the tenths of a second (3 for 312 ms; 9 means 900 ms or more) for 3 s,
     then the game returns to step 1.

TRY THIS
  - Show the reaction time on the LCD.
  - Give the red LED to a second player and make it a duel.
"""
from machine import Pin
from zero1 import BUTTON_1, BUTTON_2, LED_RED, LED_GREEN, Buzzer, SevenSegment
import random
import time

BLANK = 0b00000000         # all segments off

start_button = Pin(BUTTON_1, Pin.IN)
react_button = Pin(BUTTON_2, Pin.IN)
red = Pin(LED_RED, Pin.OUT)
green = Pin(LED_GREEN, Pin.OUT)
buzzer = Buzzer()
display = SevenSegment()

best_time = 0              # best reaction time so far (0 = none yet)


def wait_for_press(button):
    """Does nothing until this button is pressed."""
    while not button.value():
        pass               # keep checking


display.segments(BLANK)
print("REACTION GAME")
print("When the display shows 8 and the green LED lights, press Button 2 as fast as you can!")

while True:
    print("Press Button 1 to start...")
    wait_for_press(start_button)
    random.seed(time.ticks_ms())   # nobody presses at the same millisecond twice: a good random seed

    # Countdown 3, 2, 1 with a short beep at each number
    for n in range(3, 0, -1):
        display.show(n)
        buzzer.tone(800, 100)
        time.sleep(1)
    display.segments(BLANK)

    # Wait a random time between 1 and 3 s. Pressing during this time = too early!
    wait_time = random.randint(1000, 2999)
    wait_start = time.ticks_ms()
    too_early = False
    while time.ticks_diff(time.ticks_ms(), wait_start) < wait_time:
        if react_button.value():
            too_early = True
            break

    if too_early:
        print("Too early! You lose this round.")
        red.on()
        buzzer.tone(200, 500)
        time.sleep(1.5)
        red.off()
        # back to the start of the while True loop
        continue

    # GO! Show 8, light the green LED, beep, and start the stopwatch
    display.show(8)
    green.on()
    buzzer.tone(1500, 150)
    go_time = time.ticks_ms()

    wait_for_press(react_button)
    reaction = time.ticks_diff(time.ticks_ms(), go_time)   # the stopwatch stops here
    green.off()

    print("Your reaction time:", reaction, "ms")
    if best_time == 0 or reaction < best_time:
        best_time = reaction
        print("New record!")
    print("Best time:", best_time, "ms")

    # Score on the display: tenths of a second (0 = under 100 ms, 9 = 900 ms or more)
    score = reaction // 100
    if score > 9:
        score = 9
    display.show(score)
    time.sleep(3)
    display.segments(BLANK)
