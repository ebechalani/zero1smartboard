"""Button toggle with debounce: every press of button 1 switches the red LED."""
from machine import Pin
from zero1 import BUTTON_1, LED_RED
import time

DEBOUNCE_MS = 50                 # the reading must stay stable this long

button = Pin(BUTTON_1, Pin.IN)
led = Pin(LED_RED, Pin.OUT)
button_state = 0
last_reading = 0
last_change = time.ticks_ms()
led_on = False
presses = 0
print("Press Button 1 to toggle the red LED")

while True:
    reading = button.value()
    if reading != last_reading:
        last_change = time.ticks_ms()   # the signal moved: restart the timer
    if time.ticks_diff(time.ticks_ms(), last_change) > DEBOUNCE_MS:
        # The reading has been steady: we can trust it.
        if reading != button_state:
            button_state = reading
            if button_state == 1:
                led_on = not led_on
                presses += 1
                led.value(led_on)
                print(f"Press #{presses} -> LED {'ON' if led_on else 'OFF'}")
    last_reading = reading
