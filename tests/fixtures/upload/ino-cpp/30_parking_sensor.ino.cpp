#include <Arduino.h>
#line 1 "30_parking_sensor.ino"
/*
  ZERO1 Smart Board - 30 Parking sensor (project)
  -----------------------------------------------
  WHAT IT TEACHES
    - Combining a sensor and two outputs into a real product: the reversing
      radar of a car.
    - Zones with if / else if / else: far, near, very near.
    - map() turns a distance into a beep interval: the closer, the faster.
    - Non-blocking beeps with millis() and tone(pin, freq, duration).

  PARTS AND PINS
    - Ultrasonic TRIG .... D3  (external "ULTRASONIC" header; plug it in)
    - Ultrasonic ECHO .... D2
    - Buzzer ............. D8
    - RGB LED (NeoPixel) . D9

  EXPECTED BEHAVIOUR (move the distance slider in the simulator)
    - More than 100 cm: RGB green, silent.
    - Between 30 and 100 cm: RGB orange, short beeps (60 ms, 2000 Hz).
      The beeps get faster as the obstacle gets closer: one beep every
      1000 ms at 100 cm, every 380 ms at 50 cm, every 150 ms at 30 cm.
    - Less than 30 cm: RGB red and a continuous 2000 Hz tone: STOP!
    - No echo (sensor unplugged): RGB dim blue, silent.
    - Every 500 ms Serial prints the distance and the zone, for example
      "Distance: 49.7 cm -> beep every 380 ms".

  TRY THIS
    - Change FAR_CM and NEAR_CM.
    - Show the distance in tens of centimetres on the 7-segment display.
*/

#include <Adafruit_NeoPixel.h>

const int TRIG_PIN = 3;
const int ECHO_PIN = 2;
const int BUZZER_PIN = 8;
const int RGB_PIN = 9;

const int FAR_CM = 100;    // farther than this: all clear
const int NEAR_CM = 30;    // closer than this: stop!
const int BEEP_FREQ = 2000;

Adafruit_NeoPixel pixels(1, RGB_PIN, NEO_GRB + NEO_KHZ800);

unsigned long lastBeep = 0;    // when the last beep started
unsigned long lastPrint = 0;   // when we last wrote to Serial

// Measures the distance once and returns it in centimetres (0 = no echo)
#line 49 "30_parking_sensor.ino"
float readDistanceCm();
#line 60 "30_parking_sensor.ino"
void setColor(int r, int g, int b);
#line 65 "30_parking_sensor.ino"
void setup();
#line 74 "30_parking_sensor.ino"
void loop();
#line 49 "30_parking_sensor.ino"
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);   // microseconds, 0 if nothing
  return duration * 0.0343 / 2;
}

// Gives the RGB LED a colour (red, green, blue: 0..255 each)
void setColor(int r, int g, int b) {
  pixels.setPixelColor(0, pixels.Color(r, g, b));
  pixels.show();
}

void setup() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pixels.begin();
  pixels.setBrightness(100);
  Serial.begin(9600);
}

void loop() {
  float distance = readDistanceCm();
  int interval = 0;   // ms between two beeps (0 = no beeps)
  String zone = "";

  if (distance <= 0) {
    zone = "no echo";
    setColor(0, 0, 60);          // dim blue: the sensor is not answering
    noTone(BUZZER_PIN);
  } else if (distance > FAR_CM) {
    zone = "clear";
    setColor(0, 255, 0);         // green
    noTone(BUZZER_PIN);
  } else if (distance > NEAR_CM) {
    setColor(255, 120, 0);       // orange
    // 100 cm -> a beep every 1000 ms ... 30 cm -> a beep every 150 ms
    interval = map((int)distance, NEAR_CM, FAR_CM, 150, 1000);
    zone = "beep every " + String(interval) + " ms";
    if (millis() - lastBeep >= interval) {
      lastBeep = millis();
      tone(BUZZER_PIN, BEEP_FREQ, 60);   // a 60 ms beep; it stops by itself
    }
  } else {
    zone = "STOP";
    setColor(255, 0, 0);         // red
    tone(BUZZER_PIN, BEEP_FREQ); // continuous sound
  }

  // Report to Serial twice per second only, so that it stays readable
  if (millis() - lastPrint >= 500) {
    lastPrint = millis();
    Serial.print("Distance: ");
    Serial.print(distance, 1);
    Serial.print(" cm -> ");
    Serial.println(zone);
  }

  delay(50);   // the HC-SR04 needs a little rest between two measurements
}

