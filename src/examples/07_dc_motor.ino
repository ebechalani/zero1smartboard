/*
  ZERO1 Smart Board - 07 DC motor, without delay()
  ------------------------------------------------
  WHAT IT TEACHES
    - The DC motor is switched by the motor driver: pin A0 HIGH = motor runs,
      LOW = motor stops. On this board it is ON or OFF only (A0 has no PWM),
      so analogWrite() cannot change its speed.
    - "Blink without delay": millis() tells us how long the program has been
      running. By comparing times we can do TWO things at once. With
      delay(2000) the board would be frozen for 2 s and could not blink the
      L LED at the same time.

  PARTS AND PINS
    - Motor driver IN1 ... A0  (motor on the green "MOTOR" screw terminal)
    - Built-in L LED ..... D13 (LED_BUILTIN), our "the program is alive" light

  EXPECTED BEHAVIOUR
    - The motor runs for 2 s, stops for 2 s, runs for 2 s, ... starting with ON.
    - Serial prints "Motor ON" / "Motor OFF" at every change.
    - At the same time, the L LED blinks fast (toggles every 250 ms) and never
      stops blinking, even when the motor changes state.

  TRY THIS
    - Change MOTOR_PERIOD to 500 for a "shaking" motor.
    - Replace the millis() logic by delay(2000): the L LED stops blinking.
*/

const int MOTOR_PIN = A0;
const unsigned long MOTOR_PERIOD = 2000;     // ms ON, then ms OFF
const unsigned long HEARTBEAT_PERIOD = 250;  // ms between two L LED toggles

unsigned long lastMotorChange = 0;   // when we last switched the motor
unsigned long lastHeartbeat = 0;     // when we last toggled the L LED
bool motorOn = false;
bool heartbeatOn = false;

// Switches the motor and tells the Serial Monitor
void setMotor(bool on) {
  motorOn = on;
  digitalWrite(MOTOR_PIN, on ? HIGH : LOW);
  Serial.println(on ? "Motor ON" : "Motor OFF");
}

void setup() {
  pinMode(MOTOR_PIN, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
  setMotor(true);              // start with the motor running
}

void loop() {
  unsigned long now = millis();   // time since the program started, in ms

  // Job 1: every MOTOR_PERIOD ms, switch the motor
  if (now - lastMotorChange >= MOTOR_PERIOD) {
    lastMotorChange = now;
    setMotor(!motorOn);          // ON becomes OFF, OFF becomes ON
  }

  // Job 2: every HEARTBEAT_PERIOD ms, toggle the L LED
  if (now - lastHeartbeat >= HEARTBEAT_PERIOD) {
    lastHeartbeat = now;
    heartbeatOn = !heartbeatOn;
    digitalWrite(LED_BUILTIN, heartbeatOn ? HIGH : LOW);
  }

  // No delay() here: loop() runs again immediately and checks the clock
}
