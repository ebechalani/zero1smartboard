#include <Arduino.h>
#line 1 "13_ldr_night_light.ino"
/*
  ZERO1 Smart Board - 13 LDR night light
  --------------------------------------
  WHAT IT TEACHES
    - An LDR (light dependent resistor) is a light sensor: its resistance
      changes with the light, and analogRead() turns that into a number.
    - A threshold: compare the measurement with a fixed value to decide.
    - Automatic street lights work exactly like this.

  PARTS AND PINS
    - LDR ................ A3
      IMPORTANT: the LDR and the potentiometer share pin A3. Put the small
      POT / LDR slide switch on LDR, otherwise you read the knob.
      On the ZERO1 board more light = a bigger number (about 40 in the dark,
      about 940 in full light).
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - Every 200 ms Serial prints the light value, for example "Light: 580".
    - When the value is below DARK_THRESHOLD (400) the red LED turns on and the
      line ends with "-> dark, light ON"; otherwise the LED is off and the line
      ends with "-> bright, light OFF".
    - In the simulator: with the switch on LDR, move the light slider below
      40 % to turn the LED on.

  TRY THIS
    - Change DARK_THRESHOLD to make the lamp more or less sensitive.
    - Turn on the green LED when it is bright and the red one when it is dark.
*/

const int LDR_PIN = A3;
const int LED_RED = A1;
const int DARK_THRESHOLD = 400;   // below this value we consider it is night

#line 35 "13_ldr_night_light.ino"
void setup();
#line 40 "13_ldr_night_light.ino"
void loop();
#line 35 "13_ldr_night_light.ino"
void setup() {
  pinMode(LED_RED, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(LDR_PIN);   // 0 (dark) .. 1023 (very bright)

  Serial.print("Light: ");
  Serial.print(light);

  if (light < DARK_THRESHOLD) {
    digitalWrite(LED_RED, HIGH);
    Serial.println("  -> dark, light ON");
  } else {
    digitalWrite(LED_RED, LOW);
    Serial.println("  -> bright, light OFF");
  }

  delay(200);
}

