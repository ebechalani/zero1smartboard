"""LCD custom characters: a beating heart and the temperature of the DHT22."""
import dht
from machine import Pin
from zero1 import LCD, DHT_PIN
import time

HEART_SMALL = [0b00000, 0b00000, 0b01010, 0b01110, 0b00100, 0b00000, 0b00000, 0b00000]
HEART_BIG = [0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000]

lcd = LCD()
sensor = dht.DHT22(Pin(DHT_PIN))
lcd.custom_char(0, HEART_SMALL)
lcd.custom_char(1, HEART_BIG)
lcd.move_to(0, 1)
lcd.putstr("I ")
lcd.putchar(chr(1))
lcd.putstr(" ZERO1")


def show_temperature():
    lcd.move_to(0, 0)
    lcd.putstr("Temp: ")
    try:
        sensor.measure()
    except OSError:
        lcd.putstr("--.-")
    else:
        lcd.putstr(f"{sensor.temperature():.1f}")
    lcd.putchar(chr(223))
    lcd.putstr("C  ")


while True:
    show_temperature()
    for _ in range(2):
        lcd.move_to(2, 1)
        lcd.putchar(chr(0))
        time.sleep(0.5)
        lcd.move_to(2, 1)
        lcd.putchar(chr(1))
        time.sleep(0.5)
