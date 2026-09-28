/*
  ZERO1 Smart Board - 52 Show the distance on the Serial Monitor
  --------------------------------------------------------------
  WHAT IT TEACHES
    - The HC-SR04 measures a distance with sound: a 10 us pulse on TRIG,
      then ECHO stays HIGH for the time the sound needs to go and come back.
    - pulseIn() measures that time in microseconds.
    - distance (cm) = time * 0.0343 / 2  (sound: 0.0343 cm per microsecond,
      and it travels the distance twice).

  PARTS AND PINS
    - Ultrasonic TRIG .... D3  (external "ULTRASONIC" header, keep it plugged in)
    - Ultrasonic ECHO .... D2

  EXPECTED BEHAVIOUR
    - Every 500 ms Serial prints, for example, "Distance: 49.7 cm" when the
      object is 50 cm away (the sensor counts whole microseconds, so the
      last digit is not exact).
    - In the simulator, move the distance slider and watch the number follow.

  TRY THIS
    - Print the distance in millimetres.
    - Print "too close!" when the distance is under 10 cm.
*/

const int TRIG_PIN = 3;
const int ECHO_PIN = 2;

// Measures the distance once, in centimetres
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);       // the 10 us "go" pulse
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);   // microseconds (0 = no echo)
  return duration * 0.0343 / 2;
}

void setup() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  Serial.begin(9600);
}

void loop() {
  float distance = readDistanceCm();
  Serial.print("Distance: ");
  Serial.print(distance, 1);   // one digit after the point
  Serial.println(" cm");
  delay(500);
}
