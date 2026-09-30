# D1: globals with an initialiser, without one (assigned where they are), shared with functions.
from machine import ADC
from zero1 import POT_LDR
import time

adc = ADC(POT_LDR)
total = 0                       # the sum of every reading
start = time.ticks_ms()         # not a fixed value: assigned in setup()
readings = 0


def add(value):
    global total, readings
    total += value
    readings += 1


def reset():
    global best
    best = 0


reset()
while True:
    add(adc.read())
    if readings % 10 == 0:
        print(total // readings, time.ticks_diff(time.ticks_ms(), start), best)
    time.sleep_ms(100)
