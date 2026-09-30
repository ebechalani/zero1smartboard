"""
ZERO1 Smart Board - 49 Show the light level on the Serial Monitor
-----------------------------------------------------------------
WHAT IT TEACHES
  - An LDR (light sensor) changes its resistance with the light.
  - ldr.read() turns it into a number from 0 to 1023.
  - Printing a measurement so that you can see it change: print() puts a
    space between its values.

PARTS AND PINS
  - LDR ................ A3  (POT_LDR)
    IMPORTANT: the LDR and the potentiometer share pin A3. Flip the small
    POT / LDR slide switch to LDR, otherwise you read the knob instead.
    More light = a bigger number (about 40 in the dark, about 940 in
    full light).

EXPECTED BEHAVIOUR
  - Every 500 ms the Serial Monitor shows the light value, for example
    "Light: 580".
  - In the simulator, move the light slider: the number follows it.
    Cover the sensor on the real board: the number drops.

TRY THIS
  - Print the value as a percentage with map_range(light, 0, 1023, 0, 100)
    (import map_range from zero1).
  - Print "dark" or "bright" next to the number.
"""
from machine import ADC
from zero1 import POT_LDR
import time

ldr = ADC(POT_LDR)             # an analog input needs no Pin.IN

while True:
    light = ldr.read()         # 0 (dark) .. 1023 (very bright)
    print("Light:", light)
    time.sleep_ms(500)
