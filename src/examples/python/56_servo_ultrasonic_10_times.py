"""
ZERO1 Smart Board - 56 Servo reacts to the ultrasonic sensor, 10 times
----------------------------------------------------------------------
WHAT IT TEACHES
  - A sensor decides what an actuator does: an automatic barrier.
  - A for loop repeats "measure, decide, move" exactly 10 times; without
    "while True:" the program then ends.

PARTS AND PINS
  - Ultrasonic TRIG .... D3  (TRIG_PIN; keep the sensor plugged in)
  - Ultrasonic ECHO .... D2  (ECHO_PIN)
  - Servo (SG90) ....... D4  (SERVO_PIN; keep the servo plugged in)

EXPECTED BEHAVIOUR
  - 10 rounds, one every second: the distance is measured; if an object is
    closer than 10 cm the servo goes to 180 degrees, otherwise to 0 degrees.
    The Serial Monitor shows e.g. "Round 3: 49.7 cm -> servo 0".
  - No echo (sensor unplugged): the servo stays at 0 degrees and the line
    reads "Round 3: no echo -> servo 0".
  - After the 10 rounds the servo goes back to 0 degrees and the Serial
    Monitor shows "Done".
  - In the simulator, move the distance slider under 10 cm while it runs.

TRY THIS
  - Check forever: put the for loop inside a "while True:" loop.
  - Open the barrier slowly (see example 58).
"""
from zero1 import HCSR04, Servo
import time

LIMIT_CM = 10

sonar = HCSR04()
servo = Servo()
servo.angle(0)                 # start closed

for round_number in range(1, 11):      # 1, 2, ... 10
    angle = 0                          # closed, unless something is close
    try:
        distance = sonar.distance_cm()
        if distance < LIMIT_CM:
            angle = 180                # something is close: open
        seen = f"{distance:.1f} cm"     # what the sensor saw
    except OSError:
        seen = "no echo"
    servo.angle(angle)
    print(f"Round {round_number}: {seen} -> servo {angle}")
    time.sleep(1)

servo.angle(0)                 # back to the rest position
print("Done")                  # no "while True:": the program ends here
