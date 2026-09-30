// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// D2 / D3: locals of loop() and of functions, at their first definition or at the top.

const int POT_LDR = A3;        // potentiometer / light sensor

const int adc = POT_LDR;
long seen = 0;                 // read before it is written in the loop: a global

String describe(long value) {
  String word_ = "";
  if (value > 500) {
    word_ = "bright";          // assigned in both branches: declared at the top
  } else {
    word_ = "dark";
  }
  return word_;
}

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  for (long i = 0; i < 3; i++) {  // setup(): its own local
    long first = analogRead(adc);
    Serial.print("warm-up ");
    Serial.print(i);
    Serial.print(" ");
    Serial.println(first);
  }
}

// Runs forever: the body of "while True:" (line 22)
void loop() {
  long highest = 0;
  long value = analogRead(adc);   // first definition, dominates every use: declared here
  if (value > seen) {
    highest = value;           // assigned inside the if, used after it: the top of loop()
  } else {
    highest = seen;
  }
  seen = value;
  Serial.print(describe(value));
  Serial.print(" ");
  Serial.println(highest);
  delay(1000);
}
