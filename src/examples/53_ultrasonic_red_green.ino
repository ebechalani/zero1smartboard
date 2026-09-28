/*
  ZERO1 Smart Board - 53 Distance alarm: red LED near, green LED far
  ------------------------------------------------------------------
  WHAT IT TEACHES
    - A sensor measurement compared with a threshold drives two outputs:
      red = danger (too close), green = the way is free.
    - The same readDistanceCm() function as in sketch 52, reused as is.
    - Reading a sensor, deciding, acting: the pattern of every robot.

  PARTS AND PINS
    - Ultrasonic TRIG .... D3  (keep the sensor plugged in)
    - Ultrasonic ECHO .... D2
    - Red LED ............ A1
    - Green LED .......... A2

  EXPECTED BEHAVIOUR
    - Every 500 ms the distance is measured and printed, e.g. "Distance: 49.7 cm".
    - Closer than 10 cm: red LED ON, green OFF, and the line ends with
      " -> too close!".
    - 10 cm or more: green LED ON, red OFF, and the line ends with " -> free".
    - In the simulator, drag the distance slider under 10 cm.

  TRY THIS
    - Change LIMIT_CM to 30.
    - Add a beep on the buzzer (D8) when the red LED is on.
*/

const int TRIG_PIN = 3;
const int ECHO_PIN = 2;
const int LED_RED = A1;
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
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  float distance = readDistanceCm();
  Serial.print("Distance: ");
  Serial.print(distance, 1);
  Serial.print(" cm");

  if (distance < LIMIT_CM) {
    digitalWrite(LED_RED, HIGH);     // too close: red
    digitalWrite(LED_GREEN, LOW);
    Serial.println(" -> too close!");
  } else {
    digitalWrite(LED_RED, LOW);      // far enough: green
    digitalWrite(LED_GREEN, HIGH);
    Serial.println(" -> free");
  }
  delay(500);
}
