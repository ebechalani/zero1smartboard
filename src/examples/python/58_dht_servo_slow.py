"""
ZERO1 Smart Board - 58 Servo turns slowly when it is hot (above 28 °C)
----------------------------------------------------------------------
WHAT IT TEACHES
  - A sensor value decides what an actuator does (an automatic window).
  - Moving a servo SLOWLY: a for loop that adds one degree at a time with a
    small pause, instead of jumping straight to 180.

PARTS AND PINS
  - DHT22 .............. D5  (DHT_PIN; keep the sensor plugged in)
  - Servo (SG90) ....... D4  (SERVO_PIN; keep the servo plugged in)

EXPECTED BEHAVIOUR
  - Every 2 s the temperature is read and printed, e.g. "Temperature: 24.0 C".
  - Above 28 C: the Serial Monitor shows "Too warm: opening" and the servo
    turns slowly from 0 to 180 degrees (one degree every 15 ms, about
    2.7 s). As long as it stays warm this repeats after every reading: back
    to 0, then slowly up to 180 again.
  - At 28 C or below the servo goes to 0 degrees ("OK: closed").
  - If the sensor is unplugged: "DHT22 error (is it plugged in?)" and the
    servo does not move.
  - In the simulator, drag the temperature slider above 28 C.

TRY THIS
  - Close slowly too (count down from 180 to 0 with a second for loop:
    range(180, -1, -1)).
  - Change 28 to another limit, or use the humidity instead.
"""
import dht
from machine import Pin
from zero1 import DHT_PIN, Servo
import time

LIMIT_C = 28.0
STEP_TIME = 15                 # milliseconds per degree: the speed of the move

sensor = dht.DHT22(Pin(DHT_PIN))
servo = Servo()


def turn_slowly():
    """Turns the servo slowly from 0 to 180 degrees, one degree at a time."""
    for angle in range(0, 181):
        servo.angle(angle)
        time.sleep_ms(STEP_TIME)


servo.angle(0)                 # start closed

while True:
    time.sleep(2)
    try:
        sensor.measure()
    except OSError:
        print("DHT22 error (is it plugged in?)")
        continue

    temperature = sensor.temperature()
    print(f"Temperature: {temperature:.1f} C")

    if temperature > LIMIT_C:
        print("Too warm: opening")
        turn_slowly()          # 0 -> 180, one degree every 15 ms
    else:
        print("OK: closed")
        servo.angle(0)         # back to closed at once
