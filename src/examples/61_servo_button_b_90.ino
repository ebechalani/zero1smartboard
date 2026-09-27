/*
  ZERO1 Smart Board - 61 Button B -> move servo to 90 degrees
  -----------------------------------------------------------
  WHAT IT TEACHES
    - The same as sketch 60 with the other button and another angle.
    - write(90) is the middle position of a servo.

  PARTS AND PINS
    - Button B (Button 2)  D7
    - Servo (SG90) ....... D4  (external "SERVO" header, keep it plugged in)

  EXPECTED BEHAVIOUR
    - At the start the servo goes to 0 degrees.
    - Press Button B: the servo moves to 90 degrees and Serial prints
      "Servo -> 90". It stays there until the program is restarted.

  TRY THIS
    - Combine 60 and 61: Button A -> 0 degrees, Button B -> 90 degrees.
    - Add 180 degrees when both buttons are pressed together.
*/

#include <Servo.h>

const int BUTTON_B = 7;
const int SERVO_PIN = 4;

Servo myServo;

void setup() {
  pinMode(BUTTON_B, INPUT);
  myServo.attach(SERVO_PIN);
  myServo.write(0);             // start at 0 degrees
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(BUTTON_B) == HIGH) {
    myServo.write(90);          // go to the middle
    Serial.println("Servo -> 90");
    delay(300);                 // give the servo time to move
  }
}
