from machine import Pin
from zero1 import LED_RED
import time

led = Pin(LED_RED, Pin.OUT)
for _ in range(10):
    led.on()
    time.sleep(0.2)
    led.off()
    time.sleep(0.2)
print("Done")
