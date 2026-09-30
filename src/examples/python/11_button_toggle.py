"""
ZERO1 Smart Board - 11 Button toggle (debounce)
-----------------------------------------------
WHAT IT TEACHES
  - Reacting to the MOMENT a button is pressed (an "edge"), not to the
    button being held down. Each press toggles the LED: on, off, on, ...
  - Debouncing: a real button "bounces" (it flickers between 1 and 0 for a
    few milliseconds when you press it). We only trust a reading that has
    stayed the same for DEBOUNCE_TIME ms, measured with time.ticks_ms() and
    time.ticks_diff(). This is the same method as the official Arduino
    "Debounce" example.
  - Remembering things between two rounds of the while True loop in variables.
  - A choice inside an f-string: {'ON' if led_on else 'OFF'}.

PARTS AND PINS
  - Button 1 (A) ....... D6  (BUTTON_1; pressed = 1 on the ZERO1 board)
  - Red LED ............ A1  (LED_RED)

EXPECTED BEHAVIOUR
  - Press Button 1: the red LED turns on and stays on after you release it.
    Press again: it turns off. And so on.
  - print() shows one line per press, for example:
      Press #1 -> LED ON
      Press #2 -> LED OFF
  - Holding the button down does not toggle again; only a new press does.

TRY THIS
  - Set DEBOUNCE_TIME to 0 and press a real button quickly: sometimes the
    LED toggles twice for one press. That is the bounce.
  - Use Button 2 to reset press_count to 0.
"""
from machine import Pin
from zero1 import BUTTON_1, LED_RED
import time

DEBOUNCE_TIME = 50         # ms during which the reading must stay stable

button = Pin(BUTTON_1, Pin.IN)
led = Pin(LED_RED, Pin.OUT)

button_state = 0           # the stable (debounced) state of the button
last_reading = 0           # what we read the last time round the loop
last_change_time = 0       # when the raw reading last changed
led_on = False
press_count = 0

print("Press Button 1 to toggle the red LED")

while True:
    reading = button.value()

    if reading != last_reading:
        last_change_time = time.ticks_ms()   # the signal moved: restart the timer

    if time.ticks_diff(time.ticks_ms(), last_change_time) > DEBOUNCE_TIME:
        # The reading has been steady for 50 ms: we can trust it.
        if reading != button_state:
            button_state = reading           # the button really changed

            if button_state == 1:            # this is the moment the button goes DOWN
                led_on = not led_on          # flip: True becomes False, False becomes True
                press_count += 1
                led.value(led_on)
                print(f"Press #{press_count} -> LED {'ON' if led_on else 'OFF'}")

    last_reading = reading                   # remember for the next round
