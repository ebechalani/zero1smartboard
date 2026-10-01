from machine import ADC
from zero1 import POT_LDR
import time

adc = ADC(POT_LDR)
readings = []

while True:
    readings.append(adc.read())
    if len(readings) > 10:
        readings.pop(0)
    print(readings, sum(readings) // len(readings))
    time.sleep(1)
