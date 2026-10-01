# continue directly in the main loop is return; (§2.1 rule 1); in a nested loop it stays continue.
from machine import ADC
from zero1 import POT_LDR
import time

adc = ADC(POT_LDR)

while True:
    value = adc.read()
    time.sleep_ms(200)
    if value < 100:
        continue            # too dark: try again
    for step in range(5):
        if step % 2 == 1:
            continue
        print(step, value)
