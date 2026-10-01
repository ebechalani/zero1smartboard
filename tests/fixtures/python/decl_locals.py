# D2 / D3: locals of loop() and of functions, at their first definition or at the top.
from machine import ADC
from zero1 import POT_LDR
import time

adc = ADC(POT_LDR)
seen = 0                        # read before it is written in the loop: a global


def describe(value):
    if value > 500:
        word = "bright"         # assigned in both branches: declared at the top
    else:
        word = "dark"
    return word


for i in range(3):              # setup(): its own local
    first = adc.read()
    print("warm-up", i, first)

while True:
    value = adc.read()          # first definition, dominates every use: declared here
    if value > seen:
        highest = value         # assigned inside the if, used after it: the top of loop()
    else:
        highest = seen
    seen = value
    print(describe(value), highest)
    time.sleep(1)
