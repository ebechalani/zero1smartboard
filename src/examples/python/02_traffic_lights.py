"""
ZERO1 Smart Board - 02 Traffic lights
-------------------------------------
WHAT IT TEACHES
  - Driving several LEDs together.
  - Writing your own function with parameters: set_lights(red, green).
  - Repeating something a fixed number of times with a for loop.
  - LED_BUILTIN is the small "L" LED of the Arduino UNO (pin 13).

PARTS AND PINS
  - Red LED ............ A1  (LED_RED)
  - Green LED .......... A2  (LED_GREEN)
  - Built-in L LED ..... D13 (LED_BUILTIN)

EXPECTED BEHAVIOUR
  One cycle lasts 5.2 s and repeats forever:
  - RED:   red ON, green OFF, L LED ON, for 2 s. print() shows "RED".
  - GREEN: red OFF, green ON, L LED OFF, for 2 s. print() shows "GREEN".
  - GET READY: green blinks 3 times (200 ms off, 200 ms on), then back to RED.

TRY THIS
  - Make the green phase longer than the red one.
  - Blink the green LED 5 times instead of 3.
"""
from machine import Pin
from zero1 import LED_RED, LED_GREEN, LED_BUILTIN
import time

red_led = Pin(LED_RED, Pin.OUT)
green_led = Pin(LED_GREEN, Pin.OUT)
l_led = Pin(LED_BUILTIN, Pin.OUT)


def set_lights(red, green):
    """Switches both LEDs at once. Each parameter is 1 (on) or 0 (off)."""
    red_led.value(red)
    green_led.value(green)


while True:
    # --- STOP ---
    set_lights(1, 0)
    l_led.on()
    print("RED")
    time.sleep(2)

    # --- GO ---
    set_lights(0, 1)
    l_led.off()
    print("GREEN")
    time.sleep(2)

    # --- GET READY: the green light blinks 3 times before it turns red ---
    for _ in range(3):
        green_led.off()
        time.sleep(0.2)
        green_led.on()
        time.sleep(0.2)
