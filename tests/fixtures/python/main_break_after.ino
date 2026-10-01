// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// A while True: with a break out of it is not the main loop: the program ends (§2.1 rule 4).

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  long count = 0;
  while (true) {
    count += 1;
    Serial.print("Round ");
    Serial.println(count);
    if (count == 3) {
      break;
    }
    delay(500);
  }
  Serial.print("Finished after ");
  Serial.print(count);
  Serial.println(" rounds");
}

// The Python program has no "while True:": it has ended.
void loop() {
}
