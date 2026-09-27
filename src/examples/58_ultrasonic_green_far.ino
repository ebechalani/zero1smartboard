/*
  ZERO1 Smart Board - 58 Green LED ON if distance > 10 cm
  -------------------------------------------------------
  WHAT IT TEACHES
    - The opposite comparison of sketch 57: the LED shows that the way is FREE.
    - Reading a sensor, deciding, acting: the pattern of every robot.

  PARTS AND PINS
    - Ultrasonic TRIG .... D3  (keep the sensor plugged in)
    - Ultrasonic ECHO .... D2
    - Green LED .......... A2

  EXPECTED BEHAVIOUR
    - Every 200 ms the distance is measured and printed, e.g. "Distance: 49.7 cm".
    - When the object is farther than 10 cm the green LED is ON and the line
      ends with " -> free"; otherwise the green LED is OFF.

  TRY THIS
    - Combine 57 and 58: red under 10 cm, green above.
    - Add an "orange" zone between 10 and 20 cm with both LEDs on.
*/

const int TRIG_PIN = 3;
const int ECHO_PIN = 2;
const int LED_GREEN = A2;
const int LIMIT_CM = 10;

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
  pinMode(LED_GREEN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  float distance = readDistanceCm();
  Serial.print("Distance: ");
  Serial.print(distance, 1);
  Serial.print(" cm");

  if (distance > LIMIT_CM) {
    digitalWrite(LED_GREEN, HIGH);
    Serial.println(" -> free");
  } else {
    digitalWrite(LED_GREEN, LOW);
    Serial.println("");
  }
  delay(200);
}
