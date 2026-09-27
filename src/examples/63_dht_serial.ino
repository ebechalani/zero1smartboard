/*
  ZERO1 Smart Board - 63 Display temperature and humidity on the Serial Monitor
  -----------------------------------------------------------------------------
  WHAT IT TEACHES
    - The DHT22 sends the temperature and the humidity as numbers on one wire;
      the DHT library reads them for us.
    - float variables hold numbers with a decimal point.

  PARTS AND PINS
    - DHT22 .............. D5  (external "DHT22" header, keep it plugged in)

  EXPECTED BEHAVIOUR
    - Every 2 s Serial prints two lines, for example:
        Temperature: 24.0 C
        Humidity: 55.0 %
    - In the simulator, change the temperature and humidity sliders.
    - If the sensor is unplugged: "DHT22 error (is it plugged in?)".

  TRY THIS
    - Print both values on one line.
    - Print the temperature in Fahrenheit: dht.readTemperature(true).
*/

#include <DHT.h>

const int DHT_PIN = 5;

DHT dht(DHT_PIN, DHT22);

void setup() {
  Serial.begin(9600);
  dht.begin();
}

void loop() {
  delay(2000);   // the DHT22 measures at most every 2 s

  float temperature = dht.readTemperature();   // degrees Celsius
  float humidity = dht.readHumidity();         // percent

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT22 error (is it plugged in?)");
    return;
  }

  Serial.print("Temperature: ");
  Serial.print(temperature, 1);
  Serial.println(" C");
  Serial.print("Humidity: ");
  Serial.print(humidity, 1);
  Serial.println(" %");
}
