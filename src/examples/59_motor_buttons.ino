/*
  ZERO1 Smart Board - 59 Buttons run the motor
  --------------------------------------------
  WHAT IT TEACHES
    - The DC motor is switched by the motor driver: pin A0 HIGH = the motor
      runs, LOW = it stops.
    - Each button starts a sequence of 5 runs made with a for loop: short
      runs for Button 1, long runs for Button 2. The rhythm changes, the
      code stays the same (one function with a parameter).
    - Why not "backward"? Turning a DC motor the other way needs the driver's
      second input (IN2) driven in the opposite way. On the ZERO1 board only
      IN1 is wired (to A0), so the motor can only run in ONE direction:
      forward or stopped. That is why Button 2 changes the rhythm, not the
      direction.

  PARTS AND PINS
    - Button 1 (A) ....... D6
    - Button 2 (B) ....... D7
    - Motor driver IN1 ... A0  (motor on the green "MOTOR" screw terminal)

  EXPECTED BEHAVIOUR
    - Press Button 1: the motor runs 5 times for 500 ms with a 500 ms stop in
      between (about 5 s in total). Serial prints "Short run 1" ... "Short run 5".
    - Press Button 2: the motor runs 5 times for 1 s with a 1 s stop in
      between (about 10 s in total). Serial prints "Long run 1" ... "Long run 5".
    - After the 5 runs Serial prints "Done" and the motor stays stopped until
      the next press.

  TRY THIS
    - Run 10 times, or make each run shorter than the previous one:
      runMotor(SHORT_TIME - i * 50).
    - Light the red LED while the motor runs.
*/

const int BUTTON_A = 6;
const int BUTTON_B = 7;
const int MOTOR_PIN = A0;
const int SHORT_TIME = 500;   // milliseconds: a short run, then a short stop
const int LONG_TIME = 1000;   // milliseconds: a long run, then a long stop

// One run of the motor followed by a stop of the same length
void runMotor(int ms) {
  digitalWrite(MOTOR_PIN, HIGH);   // motor runs
  delay(ms);
  digitalWrite(MOTOR_PIN, LOW);    // motor stops
  delay(ms);
}

void setup() {
  pinMode(BUTTON_A, INPUT);
  pinMode(BUTTON_B, INPUT);
  pinMode(MOTOR_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {
    for (int i = 1; i <= 5; i++) {
      Serial.print("Short run ");
      Serial.println(i);
      runMotor(SHORT_TIME);
    }
    Serial.println("Done");
  }

  if (digitalRead(BUTTON_B) == HIGH) {
    for (int i = 1; i <= 5; i++) {
      Serial.print("Long run ");
      Serial.println(i);
      runMotor(LONG_TIME);
    }
    Serial.println("Done");
  }
}
