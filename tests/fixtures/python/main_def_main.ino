// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// def main(): with its own while True:, called at the end: it stays where it is (§2.1 rule 4).

const int BUTTON_1 = 6;        // button 1

const int button = BUTTON_1;

void main_() {
  long presses = 0;
  while (true) {
    if (digitalRead(button) == HIGH) {
      presses += 1;
      Serial.print("Pressed ");
      Serial.print(presses);
      Serial.println(" times");
      delay(300);
    }
  }
}

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  pinMode(button, INPUT);

  main_();
}

// The Python program has no "while True:": it has ended.
void loop() {
}
