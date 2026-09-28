/*
  ZERO1 Smart Board - 50 Night light: red when dark, green when bright
  --------------------------------------------------------------------
  WHAT IT TEACHES
    - A threshold: compare the measurement with a fixed number to decide.
    - Two LEDs show the decision: red = dark, green = bright.

  PARTS AND PINS
    - LDR ................ A3   (flip the POT / LDR slide switch to LDR!)
    - Red LED ............ A1
    - Green LED .......... A2

  EXPECTED BEHAVIOUR
    - Every 500 ms Serial prints the value, for example "Light: 580 -> bright".
    - Value below 500: red LED ON, green OFF, the line ends with "-> dark".
    - Value 500 or more: green LED ON, red OFF, the line ends with "-> bright".
    - In the simulator: switch on LDR, then drag the light slider below about
      50 % to see the red LED.

  TRY THIS
    - Change THRESHOLD to make it more or less sensitive.
    - Add a beep when it becomes dark.
*/

const int LDR_PIN = A3;
const int LED_RED = A1;
const int LED_GREEN = A2;
const int THRESHOLD = 500;

void setup() {
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(LDR_PIN);
  Serial.print("Light: ");
  Serial.print(light);

  if (light < THRESHOLD) {
    digitalWrite(LED_RED, HIGH);     // dark: red
    digitalWrite(LED_GREEN, LOW);
    Serial.println(" -> dark");
  } else {
    digitalWrite(LED_RED, LOW);      // bright: green
    digitalWrite(LED_GREEN, HIGH);
    Serial.println(" -> bright");
  }
  delay(500);
}
