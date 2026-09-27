/*
  ZERO1 Smart Board - 57 Red LED ON if distance < 10 cm
  -----------------------------------------------------
  WHAT IT TEACHES
    - A sensor measurement compared with a threshold drives an output.
    - The same readDistanceCm() function as in sketch 56, reused as is.

  PARTS AND PINS
    - Ultrasonic TRIG .... D3  (keep the sensor plugged in)
    - Ultrasonic ECHO .... D2
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - Every 200 ms the distance is measured and printed, e.g. "Distance: 49.7 cm".
    - When the object is closer than 10 cm the red LED is ON and the line ends
      with " -> too close!"; otherwise the red LED is OFF.
    - In the simulator, drag the distance slider under 10 cm.

  TRY THIS
    - Change LIMIT_CM to 30.
    - Add a beep on the buzzer (D8) when the LED is on.
*/

const int TRIG_PIN = 3;
const int ECHO_PIN = 2;
const int LED_RED = A1;
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
  pinMode(LED_RED, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  float distance = readDistanceCm();
  Serial.print("Distance: ");
  Serial.print(distance, 1);
  Serial.print(" cm");

  if (distance < LIMIT_CM) {
    digitalWrite(LED_RED, HIGH);
    Serial.println(" -> too close!");
  } else {
    digitalWrite(LED_RED, LOW);
    Serial.println("");
  }
  delay(200);
}
