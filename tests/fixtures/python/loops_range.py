# for loops (§2.4): range forms, the stop worked out once, a hidden counter, _ loops, parallel and chained assignment.
from machine import Pin
from zero1 import LED_RED, LED_GREEN
import time

leds = [Pin(LED_RED, Pin.OUT), Pin(LED_GREEN, Pin.OUT)]
n = int(input("n? "))
for i in range(n):
    print(i)
print("last", i)
for j in range(0, n * 2, 2):
    if j == 4:
        j = 100
    print(j)
for k in range(n, 0, -3):
    print(k)
for _ in range(2):
    for _ in range(3):
        print("x")
for idx in range(len(leds)):
    leds[idx].on()
a = b = 0
a, b = b + 1, a + 2
nums = [3, 1, 2]
nums[0], nums[2] = nums[2], nums[0]
print(a, b, nums)
