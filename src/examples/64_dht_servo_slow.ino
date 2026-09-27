/*
  ZERO1 Smart Board - 64 If temperature > 28 C -> move servo to 180 slowly
  ------------------------------------------------------------------------
  WHAT IT TEACHES
    - A sensor value decides what an actuator does (an automatic window).
    - Moving a servo SLOWLY: a for loop that adds one degree at a time with a
      small delay, instead of jumping straight to 180.

  PARTS AND PINS
    - DHT22 .............. D5  (keep the sensor plugged in)
    - Servo (SG90) ....... D4  (keep the servo plugged in)

  EXPECTED BEHAVIOUR
    - Every 2 s the temperature is read and printed, e.g. "Temperature: 24.0 C".
    - Above 28 C the servo turns slowly from 0 to 180 degrees (one degree every
      20 ms, about 3.6 s) and Serial prints "Too warm: opening". It then stays
      at 180 while it is warm.
    - At 28 C or below the servo is at 0 degrees ("OK: closed").
    - In the simulator, drag the temperature slider above 28 C.

  TRY THIS
    - Close slowly too when it gets cool again (count down from 180 to 0).
    - Change 28 to another limit, or use the humidity instead.
*/

#include <Servo.h>
#include <DHT.h>

const int DHT_PIN = 5;
const int SERVO_PIN = 4;
const float LIMIT_C = 28.0;
const int STEP_TIME = 20;   // milliseconds per degree: the speed of the move

DHT dht(DHT_PIN, DHT22);
Servo myServo;

int position = 0;   // where the servo is now

// Moves the servo one degree at a time up to `target`
void moveSlowlyTo(int target) {
  while (position < target) {
    position++;
    myServo.write(position);
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
    moveSlowlyTo(180);           // does nothing if already at 180
  } else {
    Serial.println("OK: closed");
    position = 0;
    myServo.write(0);            // back to closed at once
  }
}
