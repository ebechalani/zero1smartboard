// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

const int BUTTON_1 = 6;        // button 1
const int BUZZER = 8;          // buzzer

const int button = BUTTON_1;
long presses = 0;

void beep(long ms) {
  tone(BUZZER, 1000);
  pySleepMs(ms, 11);
  noTone(BUZZER);
}

long count_press() {
  presses += 1;
  return presses;
}

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(BUZZER, OUTPUT);
  pinMode(button, INPUT);
}

// Runs forever: the body of "while True:" (line 19)
void loop() {
  if (digitalRead(button) == HIGH) {
    long n = count_press();
    beep(100);
    if (pyMod(n, 5L) == 0) {
      beep(400);
    }
    delay(300);
  }
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

// Python's % for whole numbers: the result has the sign of the divisor
long pyMod(long a, long b) {
  long r = a % b;
  if (r != 0 && ((r < 0) != (b < 0))) r += b;
  return r;
}

// Python's time.sleep_ms(ms) for a value that is not a fixed number
void pySleepMs(long ms, int line) {
  if (ms < 0) pyFail(line, "ValueError: sleep length must be non-negative");
  delay(ms);
}
