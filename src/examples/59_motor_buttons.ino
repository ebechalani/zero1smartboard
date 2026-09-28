/*
  ZERO1 Smart Board - 65 Button A -> turn forward 5 times
  -------------------------------------------------------
  WHAT IT TEACHES
    - The DC motor is switched by the motor driver: pin A0 HIGH = the motor
      runs, LOW = it stops. It is ON or OFF only (no speed, no direction:
      only the driver input IN1 is wired on the board).
    - A button starts a sequence of 5 short runs made with a for loop.

  PARTS AND PINS
    - Button A (Button 1)  D6
    - Motor driver IN1 ... A0  (motor on the green "MOTOR" screw terminal)

  EXPECTED BEHAVIOUR
    - Press Button A: the motor runs 5 times for 500 ms with a 500 ms stop in
      between (about 5 s in total), then stays stopped until the next press.
    - Serial prints "Run 1" ... "Run 5" and "Done".

  TRY THIS
    - Run 10 times, or make each run longer.
    - Light the red LED while the motor runs.
*/

const int BUTTON_A = 6;
const int MOTOR_PIN = A0;
const int RUN_TIME = 500;    // milliseconds the motor runs
const int STOP_TIME = 500;   // milliseconds it rests

void setup() {
  pinMode(BUTTON_A, INPUT);
  pinMode(MOTOR_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {
    for (int i = 1; i <= 5; i++) {
      Serial.print("Run ");
      Serial.println(i);
      digitalWrite(MOTOR_PIN, HIGH);   // motor runs
      delay(RUN_TIME);
      digitalWrite(MOTOR_PIN, LOW);    // motor stops
      delay(STOP_TIME);
    }
    Serial.println("Done");
  }
}
