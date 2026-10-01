// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// machine and time (§3.2, §3.3).

const int POT_LDR = A3;        // potentiometer / light sensor
const int TRIG_PIN = 3;        // ultrasonic trigger
const int ECHO_PIN = 2;        // ultrasonic echo

const float WAIT = 0.25;
const long STEPS = 3;
const int led = LED_BUILTIN;
const int trig = TRIG_PIN;
const int adc = POT_LDR;
const int fade = 3;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(led, OUTPUT);
  pinMode(trig, OUTPUT);
  pinMode(fade, OUTPUT);
}

// Runs forever: the body of "while True:" (line 14)
void loop() {
  digitalWrite(led, HIGH);
  delay(round(WAIT * 1000));
  digitalWrite(led, LOW);
  delay(STEPS * 1000L);
  delay(250);
  delayMicroseconds(10);
  analogWrite(fade, 128);
  analogWrite(fade, 255);
  analogWrite(fade, 0);
  float pause = analogRead(adc) / 1000.0;
  pySleep(pause, 25);
  pySleepMs(analogRead(adc), 26);
  digitalWrite(trig, 1);
  pinMode(ECHO_PIN, INPUT);
  long width = (long)pulseIn(ECHO_PIN, 1, 30000);
  Serial.print(width);
  Serial.print(" ");
  Serial.print(map(analogRead(adc), 0, 1023, 0, 65535));
  Serial.print(" ");
  Serial.print((long)micros());
  Serial.print(" ");
  Serial.print((long)millis());
  Serial.print(" ");
  Serial.println((long)(millis() / 1000));
}

// ---- Helpers that make C++ behave like Python ----

// Stops the program like a Python error: the message goes to the Serial Monitor, then the board halts
void pyFail(int line, String text) {
  Serial.print("Line ");
  Serial.print(line);
  Serial.print(": ");
  Serial.println(text);
  Serial.flush();
  abort();
}

// Python's time.sleep(seconds) for a value that is not a fixed number
void pySleep(float seconds, int line) {
  if (seconds < 0) pyFail(line, "ValueError: sleep length must be non-negative");
  delay((unsigned long)(seconds * 1000 + 0.5));
}

// Python's time.sleep_ms(ms) for a value that is not a fixed number
void pySleepMs(long ms, int line) {
  if (ms < 0) pyFail(line, "ValueError: sleep length must be non-negative");
  delay(ms);
}
