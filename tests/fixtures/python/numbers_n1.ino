// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// N1: every whole number is a long (§4.7, §2.13).

const int LED_RED = A1;        // red LED
const int POT_LDR = A3;        // potentiometer / light sensor

const int adc = POT_LDR;
long big = 60L * 1000L;
long shifted = 1L << 20L;
long start = 0;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  start = (long)millis();
}

// Runs forever: the body of "while True:" (line 11)
void loop() {
  long percent = (long)analogRead(adc) * 100L / 1023L;
  long square_ = percent * percent;
  long mixed = (long)LED_RED + 1L + (long)true;
  Serial.print(percent);
  Serial.print(" ");
  Serial.print(square_);
  Serial.print(" ");
  Serial.print(big);
  Serial.print(" ");
  Serial.print(shifted);
  Serial.print(" ");
  Serial.print(mixed);
  Serial.print(" ");
  Serial.println(-percent * -2L);
  Serial.print((long)millis() - start);
  Serial.print(" ");
  Serial.println(start + 500L);
  delay(500);
}
