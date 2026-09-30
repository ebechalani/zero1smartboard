from machine import ADC
from zero1 import POT_LDR
import time

adc = ADC(POT_LDR)
total = 0
count = 0

while True:
    value = adc.read()
    percent = value * 100 // 1023
    total += value
    count += 1
    average = total / count
    print(f"{percent:3d} %  average {average:.1f}  {count % 60}")
    time.sleep_ms(500)
