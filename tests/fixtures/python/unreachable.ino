// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

// Code that never runs is left out of the sketch: after return, continue and break.
long sign(long x) {
  if (x < 0) {
    return -1;
    // Python line 5 is never reached, so it is left out.
  }
  return 1;
}

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  while (true) {
    for (long n = 0; n < 3; n++) {
      if (n == 1) {
        continue;
        // Python line 13 is never reached, so it is left out.
      }
      Serial.println(sign(n - 1L));
    }
    break;
    // Python line 16 is never reached, so it is left out.
  }
}

// The Python program has no "while True:": it has ended.
void loop() {
}
