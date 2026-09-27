/*
  ZERO1 Smart Board - 60 Button A -> move servo to 0 degrees
  ----------------------------------------------------------
  WHAT IT TEACHES
    - A servo turns to the angle you ask for, from 0 to 180 degrees.
    - The Servo library: attach(pin) once in setup(), then write(angle).
    - A button press sends the servo to a position.

  PARTS AND PINS
    - Button A (Button 1)  D6
    - Servo (SG90) ....... D4  (external "SERVO" header, keep it plugged in)

  EXPECTED BEHAVIOUR
    - At the start the servo goes to 90 degrees (the middle).
    - Press Button A: the servo moves to 0 degrees and Serial prints
      "Servo -> 0". It stays there until the program is restarted.

  TRY THIS
    - Send the servo back to 90 degrees when the button is released.
    - Use 45 degrees instead of 0.
*/

#include <Servo.h>

const int BUTTON_A = 6;
const int SERVO_PIN = 4;

Servo myServo;

void setup() {
  pinMode(BUTTON_A, INPUT);
  myServo.attach(SERVO_PIN);
  myServo.write(90);            // start in the middle
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {
    myServo.write(0);           // go to 0 degrees
    Serial.println("Servo -> 0");
    delay(300);                 // give the servo time to move
  }
}
