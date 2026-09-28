/*
  ZERO1 Smart Board - 58 Servo turns slowly when it is hot (above 28 C)
  ---------------------------------------------------------------------
  WHAT IT TEACHES
    - A sensor value decides what an actuator does (an automatic window).
    - Moving a servo SLOWLY: a for loop that adds one degree at a time with a
      small delay, instead of jumping straight to 180.

  PARTS AND PINS
    - DHT22 .............. D5  (keep the sensor plugged in)
    - Servo (SG90) ....... D4  (keep the servo plugged in)

  EXPECTED BEHAVIOUR
    - Every 2 s the temperature is read and printed, e.g. "Temperature: 24.0 C".
    - Above 28 C: Serial prints "Too warm: opening" and the servo turns slowly
      from 0 to 180 degrees (one degree every 15 ms, about 2.7 s). As long as
      it stays warm this repeats after every reading: back to 0, then slowly
      up to 180 again.
    - At 28 C or below the servo goes to 0 degrees ("OK: closed").
    - In the simulator, drag the temperature slider above 28 C.

  TRY THIS
    - Close slowly too (count down from 180 to 0 with a second for loop).
    - Change 28 to another limit, or use the humidity instead.
*/

#include <Servo.h>
#include <DHT.h>

const int DHT_PIN = 5;
const int SERVO_PIN = 4;
const float LIMIT_C = 28.0;
const int STEP_TIME = 15;   // milliseconds per degree: the speed of the move

DHT dht(DHT_PIN, DHT22);
Servo myServo;

// Turns the servo slowly from 0 to 180 degrees, one degree at a time
void turnSlowly() {
  for (int angle = 0; angle <= 180; angle++) {
    myServo.write(angle);
    delay(STEP_TIME);
  }
}

void setup() {
  Serial.begin(9600);
  dht.begin();
  myServo.attach(SERVO_PIN);
  myServo.write(0);
}

void loop() {
  delay(2000);
  float temperature = dht.readTemperature();

  if (isnan(temperature)) {
    Serial.println("DHT22 error (is it plugged in?)");
    return;
  }

  Serial.print("Temperature: ");
  Serial.print(temperature, 1);
  Serial.println(" C");

  if (temperature > LIMIT_C) {
    Serial.println("Too warm: opening");
    turnSlowly();                // 0 -> 180, one degree every 15 ms
  } else {
    Serial.println("OK: closed");
    myServo.write(0);            // back to closed at once
  }
}
