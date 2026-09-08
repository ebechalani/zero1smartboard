/*
  ZERO1 Smart Board - 12 Potentiometer to Serial
  ----------------------------------------------
  WHAT IT TEACHES
    - analogRead() measures a voltage between 0 and 5 V and gives a number
      between 0 and 1023 (the UNO has a 10-bit converter: 2^10 = 1024 steps).
    - Converting that number into a voltage with float arithmetic.
    - map() converts a number from one range (0..1023) to another (0..100).
    - Printing several things on one line with print() and println().

  PARTS AND PINS
    - Potentiometer ...... A3
      IMPORTANT: the potentiometer and the LDR share pin A3. Put the small
      POT / LDR slide switch on POT, otherwise you read the light sensor.

  EXPECTED BEHAVIOUR
    - Every 200 ms Serial prints a line such as:
        Value: 512  Voltage: 2.50 V  Percent: 50 %
      (with the knob in the middle). Turning the knob changes all three numbers:
      fully left 0 / 0.00 V / 0 %, fully right 1023 / 5.00 V / 100 %.

  TRY THIS
    - Print only the percent value.
    - Use map(value, 0, 1023, 0, 180) to compute a servo angle (see 33_dimmer).
*/

const int POT_PIN = A3;

void setup() {
  Serial.begin(9600);
  // No pinMode() is needed to read an analog pin.
}

void loop() {
  int value = analogRead(POT_PIN);                 // 0 .. 1023
  float voltage = value * 5.0 / 1023.0;            // 0.00 .. 5.00 volts
  int percent = map(value, 0, 1023, 0, 100);       // 0 .. 100 %

  Serial.print("Value: ");
  Serial.print(value);
  Serial.print("  Voltage: ");
  Serial.print(voltage, 2);                        // 2 digits after the point
  Serial.print(" V");
  Serial.print("  Percent: ");
  Serial.print(percent);
  Serial.println(" %");                            // println() ends the line

  delay(200);
}
