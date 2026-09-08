/*
  ZERO1 Smart Board - 15 Ultrasonic distance
  ------------------------------------------
  WHAT IT TEACHES
    - The HC-SR04 measures a distance with sound, like a bat:
      1. we send a short pulse on TRIG (10 microseconds HIGH),
      2. the sensor emits a "click" you cannot hear and waits for the echo,
      3. the ECHO pin stays HIGH for the time the sound needed to go and come back.
    - pulseIn() measures how long a pin stays HIGH, in microseconds.
    - Sound travels 0.0343 cm per microsecond. The sound goes there AND back,
      so distance = duration * 0.0343 / 2.
    - A function that returns a value: float readDistanceCm().

  PARTS AND PINS
    - Ultrasonic TRIG .... D3  (external "ULTRASONIC" header; make sure it is plugged in)
    - Ultrasonic ECHO .... D2

  EXPECTED BEHAVIOUR
    - Every 500 ms Serial prints the distance, for example "Distance: 49.7 cm"
      when the obstacle is 50 cm away (the sensor counts 58 us per cm, which
      gives 49.7 with our formula: that is normal).
    - If no echo comes back (sensor unplugged), it prints
      "No echo (is the sensor plugged in?)".

  TRY THIS
    - Print the distance in metres (divide by 100).
    - Turn the red LED on when something is closer than 20 cm.
*/

const int TRIG_PIN = 3;
const int ECHO_PIN = 2;

// Measures the distance once and returns it in centimetres (0 = no echo)
float readDistanceCm() {
  // 1. Send a clean 10 us pulse on TRIG
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // 2. Measure how long ECHO stays HIGH (give up after 30 ms = about 5 m)
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);   // microseconds

  // 3. Convert the time into a distance
  return duration * 0.0343 / 2;
}

void setup() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  Serial.begin(9600);
}

void loop() {
  float distance = readDistanceCm();

  if (distance <= 0) {
    Serial.println("No echo (is the sensor plugged in?)");
  } else {
    Serial.print("Distance: ");
    Serial.print(distance, 1);   // 1 digit after the point
    Serial.println(" cm");
  }

  delay(500);
}
