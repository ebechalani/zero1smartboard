/*
  ZERO1 Smart Board - 55 Buttons move the servo (0 and 90 degrees)
  ----------------------------------------------------------------
  WHAT IT TEACHES
    - A servo turns to the angle you ask for, from 0 to 180 degrees.
    - The Servo library: attach(pin) once in setup(), then write(angle).
    - Each button sends the servo to its own position; a small function
      moves the servo and tells Serial about it.
    - Waiting for the button to be RELEASED: one press = one move (and one
      line on Serial), even if you keep the button held down.

  PARTS AND PINS
    - Button 1 (A) ....... D6
    - Button 2 (B) ....... D7
    - Servo (SG90) ....... D4  (external "SERVO" header, keep it plugged in)

  EXPECTED BEHAVIOUR
    - At the start the servo goes to 0 degrees.
    - Press Button 2: the servo moves to 90 degrees (the middle) and Serial
      prints "Servo -> 90".
    - Press Button 1: the servo moves back to 0 degrees and Serial prints
      "Servo -> 0".
    - The servo stays where it is until the other button is pressed. Holding
      a button does not print again: release it and press again.

  TRY THIS
    - Use 180 degrees for Button 2, or 45 degrees for Button 1.
    - Move to 180 degrees when both buttons are pressed together (use &&).
*/

#include <Servo.h>

const int BUTTON_A = 6;
const int BUTTON_B = 7;
const int SERVO_PIN = 4;

Servo myServo;

// Turns the servo to `angle` and prints it
void moveTo(int angle) {
  myServo.write(angle);
  Serial.print("Servo -> ");
  Serial.println(angle);
}

// Waits until the button is not pressed any more
void waitForRelease(int button) {
  while (digitalRead(button) == HIGH) {
    delay(10);   // still held: check again in a moment
  }
}

void setup() {
  pinMode(BUTTON_A, INPUT);
  pinMode(BUTTON_B, INPUT);
  myServo.attach(SERVO_PIN);
  myServo.write(0);           // start at 0 degrees
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {
    moveTo(0);
    waitForRelease(BUTTON_A);
  }
  if (digitalRead(BUTTON_B) == HIGH) {
    moveTo(90);
    waitForRelease(BUTTON_B);
  }
}
