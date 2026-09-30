# def main(): with its own while True:, called at the end: it stays where it is (§2.1 rule 4).
from machine import Pin
from zero1 import BUTTON_1
import time

button = Pin(BUTTON_1, Pin.IN)


def main():
    presses = 0
    while True:
        if button.value():
            presses += 1
            print("Pressed", presses, "times")
            time.sleep_ms(300)


main()
