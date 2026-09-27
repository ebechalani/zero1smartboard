#include <Arduino.h>
#line 1 "02_traffic_lights.ino"
/*
  ZERO1 Smart Board - 02 Traffic lights
  -------------------------------------
  WHAT IT TEACHES
    - Driving several LEDs together.
    - Writing your own function with parameters: setLights(red, green).
    - Repeating something a fixed number of times with a for loop.
    - LED_BUILTIN is the small "L" LED of the Arduino UNO (pin 13).

  PARTS AND PINS
    - Red LED ............ A1
    - Green LED .......... A2
    - Built-in L LED ..... D13 (LED_BUILTIN)

  EXPECTED BEHAVIOUR
    One cycle lasts 5.2 s and repeats forever:
    - RED:   red ON, green OFF, L LED ON, for 2 s. Serial prints "RED".
    - GREEN: red OFF, green ON, L LED OFF, for 2 s. Serial prints "GREEN".
    - GET READY: green blinks 3 times (200 ms off, 200 ms on), then back to RED.

  TRY THIS
    - Make the green phase longer than the red one.
    - Blink the green LED 5 times instead of 3.
*/

const int LED_RED = A1;
const int LED_GREEN = A2;

#line 29 "02_traffic_lights.ino"
void setup();
#line 37 "02_traffic_lights.ino"
void setLights(int red, int green);
#line 42 "02_traffic_lights.ino"
void loop();
#line 29 "02_traffic_lights.ino"
void setup() {
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
}

// Switches both LEDs at once. Each parameter is HIGH or LOW.
void setLights(int red, int green) {
  digitalWrite(LED_RED, red);
  digitalWrite(LED_GREEN, green);
}

void loop() {
  // --- STOP ---
  setLights(HIGH, LOW);
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("RED");
  delay(2000);

  // --- GO ---
  setLights(LOW, HIGH);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("GREEN");
  delay(2000);

  // --- GET READY: the green light blinks 3 times before it turns red ---
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_GREEN, LOW);
    delay(200);
    digitalWrite(LED_GREEN, HIGH);
    delay(200);
  }
}

