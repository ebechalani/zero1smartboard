"""Reaction game: wait for the 8, then press button 2 as fast as you can."""
from machine import Pin
from zero1 import BUTTON_1, BUTTON_2, LED_RED, LED_GREEN, Buzzer, SevenSegment
import random
import time

start_button = Pin(BUTTON_1, Pin.IN)
react_button = Pin(BUTTON_2, Pin.IN)
red = Pin(LED_RED, Pin.OUT)
green = Pin(LED_GREEN, Pin.OUT)
buzzer = Buzzer()
display = SevenSegment()
best = 0
display.clear()
print("REACTION GAME")


def wait_for_press(pin):
    while not pin.value():
        pass


while True:
    print("Press Button 1 to start...")
    wait_for_press(start_button)
    random.seed(time.ticks_ms())
    for n in range(3, 0, -1):
        display.show(n)
        buzzer.tone(800, 100)
        time.sleep(1)
    display.clear()
    wait_ms = random.randint(1000, 2999)
    wait_start = time.ticks_ms()
    too_early = False
    while time.ticks_diff(time.ticks_ms(), wait_start) < wait_ms:
        if react_button.value():
            too_early = True
            break
    if too_early:
        print("Too early! You lose this round.")
        red.on()
        buzzer.tone(200, 500)
        time.sleep(1.5)
        red.off()
        continue
    display.show(8)
    green.on()
    buzzer.tone(1500, 150)
    go = time.ticks_ms()
    wait_for_press(react_button)
    reaction = time.ticks_diff(time.ticks_ms(), go)
    green.off()
    print("Your reaction time:", reaction, "ms")
    if best == 0 or reaction < best:
        best = reaction
        print("New record!")
    print("Best time:", best, "ms")
    display.show(min(reaction // 100, 9))
    time.sleep(3)
    display.clear()
