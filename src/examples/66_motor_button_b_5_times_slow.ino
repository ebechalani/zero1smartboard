/*
  ZERO1 Smart Board - 66 Button B -> turn 5 times, slower rhythm
  --------------------------------------------------------------
  WHAT IT TEACHES
    - The same 5-runs idea started by the OTHER button, with longer runs and
      longer stops: the rhythm changes, the code stays the same.
    - Why not "backward"? Turning a DC motor the other way needs the driver's
      second input (IN2) driven in the opposite way. On the ZERO1 board only
      IN1 is wired (to A0), so the motor can only run in ONE direction:
      forward or stopped. That is why Button B changes the rhythm, not the
      direction.

  PARTS AND PINS
    - Button B (Button 2)  D7
    - Motor driver IN1 ... A0  (motor on the green "MOTOR" screw terminal)

  EXPECTED BEHAVIOUR
    - Press Button B: the motor runs 5 times for 1 s with a 1 s stop in
      between (about 10 s in total), then stays stopped until the next press.
    - Serial prints "Slow run 1" ... "Slow run 5" and "Done".

  TRY THIS
    - Combine with sketch 65: Button A fast rhythm, Button B slow rhythm.
    - Make the runs shorter and shorter: delay(RUN_TIME - i * 100).
*/

const int BUTTON_B = 7;
const int MOTOR_PIN = A0;
const int RUN_TIME = 1000;    // milliseconds the motor runs (twice sketch 65)
const int STOP_TIME = 1000;   // milliseconds it rests

void setup() {
  pinMode(BUTTON_B, INPUT);
  pinMode(MOTOR_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(BUTTON_B) == HIGH) {
    for (int i = 1; i <= 5; i++) {
      Serial.print("Slow run ");
      Serial.println(i);
      digitalWrite(MOTOR_PIN, HIGH);   // motor runs
      delay(RUN_TIME);
      digitalWrite(MOTOR_PIN, LOW);    // motor stops
      delay(STOP_TIME);
    }
    Serial.println("Done");
  }
}
