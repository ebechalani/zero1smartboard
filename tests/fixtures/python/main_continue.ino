// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// continue directly in the main loop is return; (§2.1 rule 1); in a nested loop it stays continue.

const int POT_LDR = A3;        // potentiometer / light sensor

const int adc = POT_LDR;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
}

// Runs forever: the body of "while True:" (line 8)
void loop() {
  long value = analogRead(adc);
  delay(200);
  if (value < 100) {
    return;                    // continue: start the next round of the loop  too dark: try again
  }
  for (long step = 0; step < 5; step++) {
    if (step % 2L == 1) {
      continue;
    }
    Serial.print(step);
    Serial.print(" ");
    Serial.println(value);
  }
}
