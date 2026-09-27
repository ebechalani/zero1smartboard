/*
  ZERO1 Smart Board - 59 Speed up the buzzer as the distance decreases
  --------------------------------------------------------------------
  WHAT IT TEACHES
    - A measurement used as a NUMBER, not only as a yes/no: the distance
      becomes the pause between two beeps.
    - constrain() keeps a value inside limits, map() converts a range into
      another one (here 5..100 cm -> 50..1000 ms).
    - This is how a car parking sensor works.

  PARTS AND PINS
    - Ultrasonic TRIG .... D3  (keep the sensor plugged in)
    - Ultrasonic ECHO .... D2
    - Buzzer ............. D8

  EXPECTED BEHAVIOUR
    - The buzzer beeps (50 ms) with a pause that depends on the distance:
      1000 ms at 100 cm or more, about 500 ms at 50 cm, 50 ms at 5 cm or less.
      The closer the object, the faster the beeps.
    - Serial prints, e.g., "Distance: 49.7 cm -> pause 490 ms".
    - No echo (sensor unplugged): no beep, "No echo" is printed.

  TRY THIS
    - Make the beeps stop above 60 cm.
    - Make the sound higher when closer with tone(BUZZER, frequency).
*/

const int TRIG_PIN = 3;
const int ECHO_PIN = 2;
const int BUZZER = 8;
const int BEEP_TIME = 50;   // milliseconds of sound

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
  pinMode(BUZZER, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  float distance = readDistanceCm();

  if (distance <= 0) {
    Serial.println("No echo (is the sensor plugged in?)");
    delay(500);
    return;
  }

  // 5 cm (or less) -> 50 ms pause ... 100 cm (or more) -> 1000 ms pause
  int cm = constrain((int) distance, 5, 100);
  int pause = map(cm, 5, 100, 50, 1000);

  Serial.print("Distance: ");
  Serial.print(distance, 1);
  Serial.print(" cm -> pause ");
  Serial.print(pause);
  Serial.println(" ms");

  digitalWrite(BUZZER, HIGH);
  delay(BEEP_TIME);
  digitalWrite(BUZZER, LOW);
  delay(pause);
}
