"""
ZERO1 Smart Board - 06 Servo sweep
----------------------------------
WHAT IT TEACHES
  - A servo motor turns to the angle you ask for (0 to 180 degrees).
  - Servo() prepares the servo once; servo.angle(a) turns it whenever you want.
  - Two for loops: range(0, 181) counts up, range(180, -1, -1) counts down.

PARTS AND PINS
  - Servo (SG90) ....... D4  (SERVO_PIN, external "SERVO" header; make sure it is plugged in)

EXPECTED BEHAVIOUR
  - The servo horn moves from 0 to 180 degrees in about 2.7 s
    (181 steps of 15 ms), then back from 180 to 0 in the same time.
  - print() shows "Sweeping 0 -> 180" and "Sweeping 180 -> 0" at each turn.

TRY THIS
  - Change time.sleep_ms(15) to time.sleep_ms(5) to move faster.
  - Sweep only between 45 and 135 degrees.
"""
from zero1 import Servo
import time

servo = Servo()   # the servo on SERVO_PIN (D4)

while True:
    print("Sweeping 0 -> 180")
    for angle in range(0, 181):
        servo.angle(angle)       # go to this angle
        time.sleep_ms(15)        # give the servo time to get there

    print("Sweeping 180 -> 0")
    for angle in range(180, -1, -1):
        servo.angle(angle)
        time.sleep_ms(15)
