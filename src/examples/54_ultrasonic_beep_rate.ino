/*
  ZERO1 Smart Board - 54 Parking beeper: faster beeps when closer
  ---------------------------------------------------------------
  WHAT IT TEACHES
    - A measurement used as a NUMBER, not only as a yes/no: the distance
      becomes the pause between two beeps (10 ms per centimetre).
    - constrain() keeps a value inside limits (here 50 ... 1000 ms).
    - This is how a car parking sensor works.

  PARTS AND PINS
    - Ultrasonic TRIG .... D3  (keep the sensor plugged in)
    - Ultrasonic ECHO .... D2
    - Buzzer ............. D8

  EXPECTED BEHAVIOUR
    - The buzzer beeps (50 ms), then waits 10 ms per centimetre: about 500 ms
      at 50 cm, 200 ms at 20 cm, never less than 50 ms and never more than
      1000 ms. The closer the object, the faster the beeps.
    - Serial prints, e.g., "Distance: 49.7 cm -> pause 497 ms".
    - No echo (sensor unplugged): no beep, "No echo" is printed.

  TRY THIS
    - Make the beeps stop above 60 cm.
    - Make the sound higher when closer with tone(BUZZER, frequency).
*/

const int TRIG_PIN = 3;
const int ECHO_PIN = 2;
const int BUZZER = 8;
const int BEEP_TIME = 50;     // milliseconds of sound
const int MIN_PAUSE = 50;     // milliseconds: the fastest beeps
const int MAX_PAUSE = 1000;   // milliseconds: the slowest beeps

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

  // 10 ms per centimetre, kept between 50 and 1000 ms
  int pause = distance * 10;                   // 49.7 cm -> 497 ms (the decimals are dropped)
  pause = constrain(pause, MIN_PAUSE, MAX_PAUSE);

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
