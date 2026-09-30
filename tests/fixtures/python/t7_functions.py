from machine import Pin
from zero1 import BUTTON_1, Buzzer
import time

buzzer = Buzzer()
button = Pin(BUTTON_1, Pin.IN)
presses = 0

def beep(ms=100):
    buzzer.tone(1000)
    time.sleep_ms(ms)
    buzzer.no_tone()

def count_press():
    global presses
    presses += 1
    return presses

while True:
    if button.value():
        n = count_press()
        beep()
        if n % 5 == 0:
            beep(ms=400)
        time.sleep_ms(300)
