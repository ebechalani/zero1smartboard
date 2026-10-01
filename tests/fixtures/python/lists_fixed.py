# Fixed lists (§2.10): items, constant lists, indexes, loops, helpers, list parameters.
from machine import Pin
from zero1 import LED_RED, LED_GREEN
import random

NOTES = [262, 294, 330]
names = ["ann", "bob"]
temps = [0.0] * 4
leds = [Pin(LED_RED, Pin.OUT), Pin(LED_GREEN, Pin.OUT)]


def average(values):
    total = 0
    for v in values:
        total += v
    return total / len(values)


for i in range(len(NOTES)):
    print(NOTES[i], NOTES[-1], names[i % 2])
for led in leds:
    led.on()
for x in [1, 2, 3]:
    print(x)
temps[1] = 2.5
temps[0] += 1
k = random.randint(0, 3)
temps[k] = 1.5
print(temps, sum(temps), min(temps), max(temps), 2.5 in temps, len(temps))
print(average(temps), random.choice(NOTES), random.choice(names), 5 in [1, 5], "bob" not in names)
if temps:
    print("not empty")
