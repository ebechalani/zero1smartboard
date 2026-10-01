import dht
from machine import Pin
from zero1 import DHT_PIN
import time

sensor = dht.DHT22(Pin(DHT_PIN))

while True:
    time.sleep(2)             # the DHT22 needs 2 s between two readings
    try:
        sensor.measure()
    except OSError:
        print("DHT22 error (is it plugged in?)")
        continue
    t = sensor.temperature()
    h = sensor.humidity()
    print(f"Temperature: {t:.1f} C  Humidity: {h:.1f} %")
