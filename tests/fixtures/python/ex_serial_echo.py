"""Serial echo and commands: on, off, blink <n>."""
from machine import Pin
from zero1 import LED_RED
import time

led = Pin(LED_RED, Pin.OUT)
print("Type on, off or a number of blinks")

while True:
    command = input("> ").strip().lower()
    if command == "on":
        led.on()
        print("LED on")
    elif command == "off":
        led.off()
        print("LED off")
    else:
        try:
            times = int(command)
        except ValueError:
            print("Unknown command:", command)
        else:
            for _ in range(times):
                led.on()
                time.sleep(0.2)
                led.off()
                time.sleep(0.2)
            print("Blinked", times, "times")
