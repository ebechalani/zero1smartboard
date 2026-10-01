"""
ZERO1 Smart Board - 55 Buttons move the servo (0° and 90°)
----------------------------------------------------------
WHAT IT TEACHES
  - A servo turns to the angle you ask for, from 0 to 180 degrees.
  - Servo() prepares the servo once, then servo.angle(a) turns it.
  - Each button sends the servo to its own position; a small function
    turns the servo and tells the Serial Monitor about it.
  - Waiting for the button to be RELEASED: one press = one move (and one
    line on the Serial Monitor), even if you keep the button held down.

PARTS AND PINS
  - Button 1 (A) ....... D6  (BUTTON_1)
  - Button 2 (B) ....... D7  (BUTTON_2)
  - Servo (SG90) ....... D4  (SERVO_PIN; external "SERVO" header, keep it
                              plugged in)

EXPECTED BEHAVIOUR
  - At the start the servo goes to 0 degrees.
  - Press Button 2: the servo moves to 90 degrees (the middle) and the
    Serial Monitor shows "Servo -> 90".
  - Press Button 1: the servo moves back to 0 degrees and the Serial
    Monitor shows "Servo -> 0".
  - The servo stays where it is until the other button is pressed. Holding
    a button does not print again: release it and press again.

TRY THIS
  - Use 180 degrees for Button 2, or 45 degrees for Button 1.
  - Move to 180 degrees when both buttons are pressed together (use "and").
"""
from machine import Pin
from zero1 import BUTTON_1, BUTTON_2, Servo
import time

button_1 = Pin(BUTTON_1, Pin.IN)
button_2 = Pin(BUTTON_2, Pin.IN)
servo = Servo()                # the servo on SERVO_PIN (D4)


def turn_to(angle):
    """Turns the servo to angle degrees and prints it."""
    servo.angle(angle)
    print("Servo ->", angle)


def wait_for_release(button):
    """Waits until the button is not pressed any more."""
    while button.value():
        time.sleep_ms(10)      # still held: check again in a moment


servo.angle(0)                 # start at 0 degrees

while True:
    if button_1.value():
        turn_to(0)
        wait_for_release(button_1)

    if button_2.value():
        turn_to(90)
        wait_for_release(button_2)
