"""
ZERO1 Smart Board - 07 DC motor on / off
----------------------------------------
WHAT IT TEACHES
  - The DC motor is switched by the motor driver: Pin(MOTOR, Pin.OUT) on =
    motor runs, off = motor stops. On this board it is ON or OFF only (A0 has
    no PWM), so its speed cannot change.
  - "Blink without sleep": time.ticks_ms() tells us how long the program has
    been running. By comparing times with time.ticks_diff() we can do TWO
    things at once. With time.sleep(2) the board would be frozen for 2 s and
    could not blink the L LED at the same time.

PARTS AND PINS
  - Motor driver IN1 ... A0  (MOTOR; motor on the green "MOTOR" screw terminal)
  - Built-in L LED ..... D13 (LED_BUILTIN), our "the program is alive" light

EXPECTED BEHAVIOUR
  - The motor runs for 2 s, stops for 2 s, runs for 2 s, ... starting with ON.
  - print() shows "Motor ON" / "Motor OFF" at every change.
  - At the same time, the L LED blinks fast (toggles every 250 ms) and never
    stops blinking, even when the motor changes state.

TRY THIS
  - Change MOTOR_PERIOD to 500 for a "shaking" motor.
  - Replace the ticks_diff() checks by time.sleep(2): the L LED stops blinking.
"""
from machine import Pin
from zero1 import MOTOR, LED_BUILTIN
import time

MOTOR_PERIOD = 2000        # ms ON, then ms OFF
HEARTBEAT_PERIOD = 250     # ms between two L LED toggles

motor = Pin(MOTOR, Pin.OUT)
heartbeat = Pin(LED_BUILTIN, Pin.OUT)

last_motor_change = 0      # when we last switched the motor
last_heartbeat = 0         # when we last toggled the L LED
motor_on = False


def set_motor(on):
    """Switches the motor and tells the Serial Monitor."""
    global motor_on
    motor_on = on
    if on:
        motor.on()
        print("Motor ON")
    else:
        motor.off()
        print("Motor OFF")


set_motor(True)            # start with the motor running

while True:
    now = time.ticks_ms()  # time since the program started, in ms

    # Job 1: every MOTOR_PERIOD ms, switch the motor
    if time.ticks_diff(now, last_motor_change) >= MOTOR_PERIOD:
        last_motor_change = now
        set_motor(not motor_on)      # ON becomes OFF, OFF becomes ON

    # Job 2: every HEARTBEAT_PERIOD ms, toggle the L LED
    if time.ticks_diff(now, last_heartbeat) >= HEARTBEAT_PERIOD:
        last_heartbeat = now
        heartbeat.toggle()

    # No time.sleep() here: the loop runs again immediately and checks the clock
