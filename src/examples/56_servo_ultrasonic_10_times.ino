/*
  ZERO1 Smart Board - 62 Object closer than 10 cm -> servo 180, else 0 (10 times)
  -------------------------------------------------------------------------------
  WHAT IT TEACHES
    - A sensor decides what an actuator does: an automatic barrier.
    - A for loop repeats "measure, decide, move" exactly 10 times, then stops.

  PARTS AND PINS
    - Ultrasonic TRIG .... D3  (keep the sensor plugged in)
    - Ultrasonic ECHO .... D2
    - Servo (SG90) ....... D4  (keep the servo plugged in)

  EXPECTED BEHAVIOUR
    - 10 times, once every 500 ms: the distance is measured; if an object is
      closer than 10 cm the servo goes to 180 degrees, otherwise to 0 degrees.
      Serial prints e.g. "Check 3: 49.7 cm -> servo 0".
    - After the 10 checks Serial prints "Done" and the servo stays where it is.
    - In the simulator, move the distance slider under 10 cm while it runs.

  TRY THIS
    - Check forever: move the for loop into loop().
    - Open the barrier slowly (see sketch 64).
*/

#include <Servo.h>

const int TRIG_PIN = 3;
const int ECHO_PIN = 2;
const int SERVO_PIN = 4;
const int LIMIT_CM = 10;

Servo myServo;

float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  return duration * 0.0343 / 2;
}

void setup() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  myServo.attach(SERVO_PIN);
  myServo.write(0);
  Serial.begin(9600);

  for (int i = 1; i <= 10; i++) {
    float distance = readDistanceCm();
    int angle = 0;
    if (distance > 0 && distance < LIMIT_CM) {   // > 0: ignore "no echo"
      angle = 180;
    }
    myServo.write(angle);

    Serial.print("Check ");
    Serial.print(i);
    Serial.print(": ");
    Serial.print(distance, 1);
    Serial.print(" cm -> servo ");
    Serial.println(angle);
    delay(500);
  }
  Serial.println("Done");
}

void loop() {
  // The 10 checks were done in setup(); nothing more happens.
}
