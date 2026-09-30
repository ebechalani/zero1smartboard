"""Potentiometer to Serial: the value, the voltage and a percentage."""
from machine import ADC
from zero1 import POT_LDR, map_range
import time

adc = ADC(POT_LDR)

while True:
    value = adc.read()
    voltage = value * 5.0 / 1023
    percent = map_range(value, 0, 1023, 0, 100)
    print(f"Value: {value}  Voltage: {voltage:.2f} V  ({percent} %)")
    time.sleep(0.5)
