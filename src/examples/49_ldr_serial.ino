/*
  ZERO1 Smart Board - 52 Display LDR value on Serial Monitor
  ----------------------------------------------------------
  WHAT IT TEACHES
    - An LDR (light sensor) changes its resistance with the light.
    - analogRead() turns it into a number from 0 to 1023.
    - Printing a measurement so that you can see it change.

  PARTS AND PINS
    - LDR ................ A3
      IMPORTANT: the LDR and the potentiometer share pin A3. Flip the small
      POT / LDR slide switch to LDR, otherwise you read the knob instead.
      More light = a bigger number (about 40 in the dark, about 940 in
      full light).

  EXPECTED BEHAVIOUR
    - Every 200 ms Serial prints the light value, for example "LDR: 580".
    - In the simulator, move the light slider: the number follows it.
      Cover the sensor on the real board: the number drops.

  TRY THIS
    - Print the value as a percentage with map(value, 0, 1023, 0, 100).
    - Print "dark" or "bright" next to the number.
*/

const int LDR_PIN = A3;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(LDR_PIN);   // 0 (dark) .. 1023 (very bright)
  Serial.print("LDR: ");
  Serial.println(light);
  delay(200);
}
