"""
ZERO1 Smart Board - 59 Buttons run the motor
--------------------------------------------
WHAT IT TEACHES
  - The DC motor is switched by the motor driver: Pin(MOTOR, Pin.OUT) on =
    the motor runs, off = it stops.
  - Each button starts a sequence of 5 runs made with a for loop: short
    runs for Button 1, long runs for Button 2. The rhythm changes, the
    code stays the same (one function with a parameter).
  - Why not "backward"? Turning a DC motor the other way needs the driver's
    second input (IN2) driven in the opposite way. On the ZERO1 board only
    IN1 is wired (to A0), so the motor can only run in ONE direction:
    forward or stopped. That is why Button 2 changes the rhythm, not the
    direction.

PARTS AND PINS
  - Button 1 (A) ....... D6  (BUTTON_1)
  - Button 2 (B) ....... D7  (BUTTON_2)
  - Motor driver IN1 ... A0  (MOTOR; motor on the green "MOTOR" screw
                              terminal)

EXPECTED BEHAVIOUR
  - Press Button 1: the motor runs 5 times for 500 ms with a 500 ms stop in
    between (about 5 s in total). The Serial Monitor shows "Short run 1" ...
    "Short run 5".
  - Press Button 2: the motor runs 5 times for 1 s with a 1 s stop in
    between (about 10 s in total). The Serial Monitor shows "Long run 1" ...
    "Long run 5".
  - After the 5 runs the Serial Monitor shows "Done" and the motor stays
    stopped until the next press.

TRY THIS
  - Run 10 times, or make each run shorter than the previous one:
    run_motor(SHORT_TIME - n * 50).
  - Light the red LED while the motor runs.
"""
from machine import Pin
from zero1 import BUTTON_1, BUTTON_2, MOTOR
import time

SHORT_TIME = 500               # milliseconds: a short run, then a short stop
LONG_TIME = 1000               # milliseconds: a long run, then a long stop

button_1 = Pin(BUTTON_1, Pin.IN)
button_2 = Pin(BUTTON_2, Pin.IN)
motor = Pin(MOTOR, Pin.OUT)


def run_motor(ms):
    """One run of the motor followed by a stop of the same length."""
    motor.on()                 # the motor runs
    time.sleep_ms(ms)
    motor.off()                # the motor stops
    time.sleep_ms(ms)


while True:
    if button_1.value():
        for n in range(1, 6):          # 1, 2, 3, 4, 5
            print(f"Short run {n}")
            run_motor(SHORT_TIME)
        print("Done")

    if button_2.value():
        for n in range(1, 6):
            print(f"Long run {n}")
            run_motor(LONG_TIME)
        print("Done")
