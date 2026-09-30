// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

#include <DHT.h>

const int DHT_PIN = 5;         // DHT22 temperature / humidity sensor

DHT sensor(DHT_PIN, DHT22);

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  sensor.begin();
}

// Runs forever: the body of "while True:" (line 8)
void loop() {
  delay(2000);                 // the DHT22 needs 2 s between two readings
  if (!sensor.read()) {        // try: sensor.measure()  except OSError:
    Serial.println("DHT22 error (is it plugged in?)");
    return;                    // continue: start the next round of the loop
  }
  float t = sensor.readTemperature();
  float h = sensor.readHumidity();
  Serial.print("Temperature: ");
  Serial.print(t, 1);
  Serial.print(" C  Humidity: ");
  Serial.print(h, 1);
  Serial.println(" %");
}
