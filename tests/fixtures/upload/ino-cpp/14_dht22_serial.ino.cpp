#include <Arduino.h>
#line 1 "14_dht22_serial.ino"
/*
  ZERO1 Smart Board - 14 DHT22 temperature and humidity
  -----------------------------------------------------
  WHAT IT TEACHES
    - The DHT22 is a digital sensor: it sends the temperature and the humidity
      as numbers on one wire. The DHT library does the talking for us.
    - float variables hold numbers with a decimal point.
    - Checking that a measurement is valid with isnan() ("is Not a Number")
      before using it.

  PARTS AND PINS
    - DHT22 .............. D5  (external "DHT22" header; make sure it is plugged in)

  EXPECTED BEHAVIOUR
    - Every 2 s Serial prints one line, for example:
        Temperature: 24.0 C   Humidity: 55.0 %
      (the first line appears 2 s after the start).
    - If the sensor is unplugged, the line is instead:
        Error: no answer from the DHT22 (is it plugged in?)

  TRY THIS
    - Print the temperature in Fahrenheit: dht.readTemperature(true).
    - Print the "feels like" temperature: dht.computeHeatIndex(temperature, humidity, false).
*/

#include <DHT.h>

const int DHT_PIN = 5;

DHT dht(DHT_PIN, DHT22);   // the sensor object: pin and sensor model

#line 32 "14_dht22_serial.ino"
void setup();
#line 38 "14_dht22_serial.ino"
void loop();
#line 32 "14_dht22_serial.ino"
void setup() {
  Serial.begin(9600);
  dht.begin();
  Serial.println("DHT22 test");
}

void loop() {
  delay(2000);   // the DHT22 gives a new measurement at most every 2 s

  float humidity = dht.readHumidity();           // in %
  float temperature = dht.readTemperature();     // in degrees Celsius

  // When the sensor does not answer, the library returns NaN (Not a Number)
  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("Error: no answer from the DHT22 (is it plugged in?)");
    return;   // leave loop() now; it will be called again
  }

  Serial.print("Temperature: ");
  Serial.print(temperature, 1);   // 1 digit after the point
  Serial.print(" C   ");
  Serial.print("Humidity: ");
  Serial.print(humidity, 1);
  Serial.println(" %");
}

