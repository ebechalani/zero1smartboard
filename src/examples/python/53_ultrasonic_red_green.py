"""
ZERO1 Smart Board - 53 Distance alarm: red LED near, green LED far
------------------------------------------------------------------
WHAT IT TEACHES
  - A sensor measurement compared with a threshold drives two outputs:
    red = danger (too close), green = the way is free.
  - try / except / else: the else part runs only when the measurement
    worked.
  - Reading a sensor, deciding, acting: the pattern of every robot.

PARTS AND PINS
  - Ultrasonic TRIG .... D3  (TRIG_PIN; keep the sensor plugged in)
  - Ultrasonic ECHO .... D2  (ECHO_PIN)
  - Red LED ............ A1  (LED_RED)
  - Green LED .......... A2  (LED_GREEN)

EXPECTED BEHAVIOUR
  - Every 500 ms the distance is measured and printed, e.g.
    "Distance: 49.7 cm -> free".
  - Closer than 10 cm: red LED ON, green OFF, and the line ends with
    " -> too close!".
  - 10 cm or more: green LED ON, red OFF, and the line ends with " -> free".
  - No echo (sensor unplugged): both LEDs OFF, "No echo" is printed.
  - In the simulator, drag the distance slider under 10 cm.

TRY THIS
  - Change LIMIT_CM to 30.
  - Add a beep on the buzzer (BUZZER, D8) when the red LED is on.
"""
from machine import Pin
from zero1 import LED_RED, LED_GREEN, HCSR04
import time

LIMIT_CM = 10

sonar = HCSR04()
red = Pin(LED_RED, Pin.OUT)
green = Pin(LED_GREEN, Pin.OUT)

while True:
    try:
        distance = sonar.distance_cm()
    except OSError:
        red.off()              # no measurement, no decision
        green.off()
        print("No echo (is the sensor plugged in?)")
    else:
        if distance < LIMIT_CM:
            red.on()           # too close: red
            green.off()
            print(f"Distance: {distance:.1f} cm -> too close!")
        else:
            red.off()          # far enough: green
            green.on()
            print(f"Distance: {distance:.1f} cm -> free")
    time.sleep_ms(500)
