"""
ZERO1 Smart Board - 50 Night light: red when dark, green when bright
--------------------------------------------------------------------
WHAT IT TEACHES
  - A threshold: compare the measurement with a fixed number to decide.
  - Two LEDs show the decision: red = dark, green = bright.

PARTS AND PINS
  - LDR ................ A3  (POT_LDR; flip the POT / LDR slide switch to LDR!)
  - Red LED ............ A1  (LED_RED)
  - Green LED .......... A2  (LED_GREEN)

EXPECTED BEHAVIOUR
  - Every 500 ms the Serial Monitor shows the value, for example
    "Light: 580 -> bright".
  - Value below 500: red LED ON, green OFF, the line ends with "-> dark".
  - Value 500 or more: green LED ON, red OFF, the line ends with "-> bright".
  - In the simulator: switch on LDR, then drag the light slider below about
    50 % to see the red LED.

TRY THIS
  - Change THRESHOLD to make it more or less sensitive.
  - Add a beep when it becomes dark.
"""
from machine import ADC, Pin
from zero1 import POT_LDR, LED_RED, LED_GREEN
import time

THRESHOLD = 500

ldr = ADC(POT_LDR)
red = Pin(LED_RED, Pin.OUT)
green = Pin(LED_GREEN, Pin.OUT)

while True:
    light = ldr.read()
    if light < THRESHOLD:
        red.on()               # dark: red
        green.off()
        print(f"Light: {light} -> dark")
    else:
        red.off()              # bright: green
        green.on()
        print(f"Light: {light} -> bright")
    time.sleep_ms(500)
