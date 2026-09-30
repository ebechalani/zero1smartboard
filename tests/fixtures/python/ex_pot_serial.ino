// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
Potentiometer to Serial: the value, the voltage and a percentage.
*/

const int POT_LDR = A3;        // potentiometer / light sensor

const int adc = POT_LDR;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
}

// Runs forever: the body of "while True:" (line 8)
void loop() {
  long value = analogRead(adc);
  float voltage = value * 5.0 / 1023;
  long percent = map(value, 0, 1023, 0, 100);
  Serial.print("Value: ");
  Serial.print(value);
  Serial.print("  Voltage: ");
  Serial.print(voltage, 2);
  Serial.print(" V  (");
  Serial.print(percent);
  Serial.println(" %)");
  delay(500);
}
