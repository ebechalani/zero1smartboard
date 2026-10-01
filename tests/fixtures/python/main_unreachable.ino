// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// Statements after an endless loop that is not the last one: W-unreachable (§2.1 rule 4).

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  while (true) {
    Serial.println("tick");
    delay(1000);
  }
  // Python line 7 is never reached, so it is left out.
}

// Runs forever: the body of "while True:" (line 8)
void loop() {
  // Python line 9 is never reached, so it is left out.
}
