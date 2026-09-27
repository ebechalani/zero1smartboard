#include <Arduino.h>
#line 1 "06_servo_sweep.ino"
/*
  ZERO1 Smart Board - 06 Servo sweep
  ----------------------------------
  WHAT IT TEACHES
    - A servo motor turns to the angle you ask for (0 to 180 degrees).
    - The Servo library: attach(pin) once, then write(angle) whenever you want.
    - Two for loops: one counting up, one counting down.

  PARTS AND PINS
    - Servo (SG90) ....... D4  (external "SERVO" header; make sure it is plugged in)

  EXPECTED BEHAVIOUR
    - The servo horn moves from 0 to 180 degrees in about 2.7 s
      (181 steps of 15 ms), then back from 180 to 0 in the same time.
    - Serial prints "Sweeping 0 -> 180" and "Sweeping 180 -> 0" at each turn.

  TRY THIS
    - Change delay(15) to delay(5) to move faster.
    - Sweep only between 45 and 135 degrees.
*/

#include <Servo.h>

const int SERVO_PIN = 4;

Servo myServo;   // the object that controls the servo

#line 28 "06_servo_sweep.ino"
void setup();
#line 33 "06_servo_sweep.ino"
void loop();
#line 28 "06_servo_sweep.ino"
void setup() {
  myServo.attach(SERVO_PIN);   // connect the object to the pin
  Serial.begin(9600);
}

void loop() {
  Serial.println("Sweeping 0 -> 180");
  for (int angle = 0; angle <= 180; angle++) {
    myServo.write(angle);      // go to this angle
    delay(15);                 // give the servo time to get there
  }

  Serial.println("Sweeping 180 -> 0");
  for (int angle = 180; angle >= 0; angle--) {
    myServo.write(angle);
    delay(15);
  }
}

