# N1: every whole number is a long (§4.7, §2.13).
from machine import ADC
from zero1 import POT_LDR, LED_RED
import time

adc = ADC(POT_LDR)
big = 60 * 1000
shifted = 1 << 20
start = time.ticks_ms()

while True:
    percent = adc.read() * 100 // 1023
    square = percent * percent
    mixed = LED_RED + 1 + True
    print(percent, square, big, shifted, mixed, -percent * -2)
    print(time.ticks_ms() - start, time.ticks_add(start, 500))
    time.sleep(0.5)
