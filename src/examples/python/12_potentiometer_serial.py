"""
ZERO1 Smart Board - 12 Potentiometer to Serial
----------------------------------------------
WHAT IT TEACHES
  - adc.read() measures a voltage between 0 and 5 V and gives a whole number
    between 0 and 1023 (the UNO has a 10-bit converter: 2 ** 10 = 1024 steps).
  - Converting that number into a voltage with decimal numbers: value * 5.0 / 1023.
  - map_range() converts a number from one range (0..1023) to another (0..100).
  - Printing several values on one line with an f-string; {voltage:.2f}
    shows 2 digits after the point.

PARTS AND PINS
  - Potentiometer ...... A3  (POT_LDR)
    IMPORTANT: the potentiometer and the LDR share pin A3. Put the small
    POT / LDR slide switch on POT, otherwise you read the light sensor.

EXPECTED BEHAVIOUR
  - Every 200 ms print() shows a line such as:
      Value: 512  Voltage: 2.50 V  Percent: 50 %
    (with the knob in the middle). Turning the knob changes all three numbers:
    fully left 0 / 0.00 V / 0 %, fully right 1023 / 5.00 V / 100 %.

TRY THIS
  - Print only the percent value.
  - Use map_range(value, 0, 1023, 0, 180) to compute a servo angle.
"""
from machine import ADC
from zero1 import POT_LDR, map_range
import time

pot = ADC(POT_LDR)         # an analog input needs no Pin.IN

while True:
    value = pot.read()                             # 0 .. 1023
    voltage = value * 5.0 / 1023                   # 0.00 .. 5.00 volts
    percent = map_range(value, 0, 1023, 0, 100)    # 0 .. 100 %

    print(f"Value: {value}  Voltage: {voltage:.2f} V  Percent: {percent} %")

    time.sleep_ms(200)
