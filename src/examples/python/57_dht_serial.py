"""
ZERO1 Smart Board - 57 Show temperature and humidity on the Serial Monitor
--------------------------------------------------------------------------
WHAT IT TEACHES
  - The DHT22 sends the temperature and the humidity as numbers on one
    wire: sensor.measure() reads them, then sensor.temperature() and
    sensor.humidity() give them.
  - Decimal numbers: f"{temperature:.1f}" shows one digit after the point.
  - try / except OSError: measure() raises OSError when the sensor does not
    answer; the except part prints a message and "continue" starts the next
    round of the loop.

PARTS AND PINS
  - DHT22 .............. D5  (DHT_PIN; external "DHT22" header, keep it
                              plugged in)

EXPECTED BEHAVIOUR
  - Every 2 s the Serial Monitor shows one line, for example:
      Temperature: 24.0 C  Humidity: 55.0 %
  - In the simulator, change the temperature and humidity sliders.
  - If the sensor is unplugged: "DHT22 error (is it plugged in?)".

TRY THIS
  - Print the two values on two lines.
  - Print the temperature in Fahrenheit: temperature * 9 / 5 + 32.
"""
import dht
from machine import Pin
from zero1 import DHT_PIN
import time

sensor = dht.DHT22(Pin(DHT_PIN))

while True:
    time.sleep(2)              # the DHT22 measures at most every 2 s
    try:
        sensor.measure()
    except OSError:            # the sensor did not answer
        print("DHT22 error (is it plugged in?)")
        continue

    temperature = sensor.temperature()   # degrees Celsius
    humidity = sensor.humidity()         # percent
    print(f"Temperature: {temperature:.1f} C  Humidity: {humidity:.1f} %")
