"""
ZERO1 Smart Board - 52 Show the distance on the Serial Monitor
--------------------------------------------------------------
WHAT IT TEACHES
  - The HC-SR04 measures a distance with sound: a 10 us pulse on TRIG,
    then ECHO stays on for the time the sound needs to go and come back.
    sonar.distance_cm() does all of this and works out
    distance (cm) = time * 0.0343 / 2  (sound: 0.0343 cm per microsecond,
    and it travels the distance twice).
  - try / except OSError: when no echo comes back, distance_cm() raises
    OSError and the except part runs instead of stopping the program.
  - f"{distance:.1f}" shows one digit after the point.

PARTS AND PINS
  - Ultrasonic TRIG .... D3  (TRIG_PIN; external "ULTRASONIC" header, keep
                              it plugged in)
  - Ultrasonic ECHO .... D2  (ECHO_PIN)

EXPECTED BEHAVIOUR
  - Every 500 ms the Serial Monitor shows, for example, "Distance: 49.7 cm"
    when the object is 50 cm away (the sensor counts whole microseconds, so
    the last digit is not exact).
  - In the simulator, move the distance slider and watch the number follow.
  - No echo (sensor unplugged): "No echo (is the sensor plugged in?)".

TRY THIS
  - Print the distance in millimetres: sonar.distance_mm().
  - Print "too close!" when the distance is under 10 cm.
"""
from zero1 import HCSR04
import time

sonar = HCSR04()               # TRIG on D3, ECHO on D2

while True:
    try:
        distance = sonar.distance_cm()
        print(f"Distance: {distance:.1f} cm")
    except OSError:            # no echo came back
        print("No echo (is the sensor plugged in?)")
    time.sleep_ms(500)
