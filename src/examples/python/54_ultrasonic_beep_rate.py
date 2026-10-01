"""
ZERO1 Smart Board - 54 Parking beeper: faster beeps when closer
---------------------------------------------------------------
WHAT IT TEACHES
  - A measurement used as a NUMBER, not only as a yes/no: the distance
    becomes the pause between two beeps (10 ms per centimetre).
  - int() drops the decimals, and min(max(x, low), high) keeps a value
    inside limits (here 50 ... 1000 ms).
  - This is how a car parking sensor works.

PARTS AND PINS
  - Ultrasonic TRIG .... D3  (TRIG_PIN; keep the sensor plugged in)
  - Ultrasonic ECHO .... D2  (ECHO_PIN)
  - Buzzer ............. D8  (BUZZER)

EXPECTED BEHAVIOUR
  - The buzzer beeps (50 ms), then waits 10 ms per centimetre: about 500 ms
    at 50 cm, 200 ms at 20 cm, never less than 50 ms and never more than
    1000 ms. The closer the object, the faster the beeps.
  - The Serial Monitor shows, e.g., "Distance: 49.7 cm -> pause 497 ms".
  - No echo (sensor unplugged): no beep, "No echo" is printed.

TRY THIS
  - Make the beeps stop above 60 cm.
  - Make the sound higher when closer with Buzzer().tone(frequency).
"""
from machine import Pin
from zero1 import BUZZER, HCSR04
import time

BEEP_TIME = 50                 # milliseconds of sound
MIN_PAUSE = 50                 # milliseconds: the fastest beeps
MAX_PAUSE = 1000               # milliseconds: the slowest beeps

sonar = HCSR04()
buzzer = Pin(BUZZER, Pin.OUT)

while True:
    try:
        distance = sonar.distance_cm()
    except OSError:
        print("No echo (is the sensor plugged in?)")
        time.sleep_ms(500)
        continue

    # 10 ms per centimetre (49.7 cm -> 497 ms), kept between 50 and 1000 ms
    pause = min(max(int(distance * 10), MIN_PAUSE), MAX_PAUSE)
    print(f"Distance: {distance:.1f} cm -> pause {pause} ms")

    buzzer.on()
    time.sleep_ms(BEEP_TIME)
    buzzer.off()
    time.sleep_ms(pause)
