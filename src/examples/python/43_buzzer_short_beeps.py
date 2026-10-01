"""
ZERO1 Smart Board - 43 Short beeps forever
------------------------------------------
WHAT IT TEACHES
  - The board has an ACTIVE buzzer: it sounds as long as its pin is on,
    exactly like an LED lights as long as its pin is on.
  - A short "on" followed by a longer "off" makes a "beep ... beep ... beep".
  - time.sleep_ms() waits a number of milliseconds (1000 ms = 1 s).

PARTS AND PINS
  - Buzzer ............. D8  (BUZZER)

EXPECTED BEHAVIOUR
  - A 100 ms beep followed by 400 ms of silence, forever: two beeps per
    second (one every 500 ms).

TRY THIS
  - Change PAUSE_TIME to 100 for an alarm sound.
  - Choose the pitch yourself: make buzzer = Buzzer() (from zero1) and use
    buzzer.tone(1000) and buzzer.no_tone() instead of on() and off().
"""
from machine import Pin
from zero1 import BUZZER
import time

BEEP_TIME = 100                # milliseconds of sound
PAUSE_TIME = 400               # milliseconds of silence

buzzer = Pin(BUZZER, Pin.OUT)

while True:
    buzzer.on()                # the buzzer sounds
    time.sleep_ms(BEEP_TIME)
    buzzer.off()               # silence
    time.sleep_ms(PAUSE_TIME)
