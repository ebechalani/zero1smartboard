# try / except (§2.12): form S (the DHT22, the ultrasonic sensor) and form V (int() / float() of text).
import dht
from machine import Pin
from zero1 import DHT_PIN, HCSR04
import time

sensor = dht.DHT22(Pin(DHT_PIN))
sonar = HCSR04()


def read_number(prompt):
    while True:
        try:
            value = float(input(prompt))
        except ValueError as e:
            print("Not a number:", e)
        else:
            return value


while True:
    time.sleep(2)
    try:
        sensor.measure()
        t = sensor.temperature()
    except OSError as e:
        print("DHT22:", e)
        continue
    else:
        print("T =", t)
    try:
        d = sonar.distance_cm()
    except OSError:
        print("No echo")
        continue
    try:
        mm = sonar.distance_mm()
        print(mm, "mm")
    except:
        pass
    text = input("Number? ")
    try:
        n = int(text)
        print(n * 2)
    except Exception:
        n = 0
    print(n, d, read_number("x? "))
