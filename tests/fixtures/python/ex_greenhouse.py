"""Smart greenhouse: the fan runs above 28 °C, the red LED warns of dry air."""
import dht
from machine import Pin
from zero1 import DHT_PIN, MOTOR, LED_RED, LCD
import time

TOO_HOT = 28.0
TOO_DRY = 30.0

sensor = dht.DHT22(Pin(DHT_PIN))
fan = Pin(MOTOR, Pin.OUT)
alarm = Pin(LED_RED, Pin.OUT)
lcd = LCD()
fan_on = False


def check_climate(t, h):
    global fan_on
    fan_on = t > TOO_HOT
    fan.value(fan_on)
    alarm.value(h < TOO_DRY)


while True:
    try:
        sensor.measure()
    except OSError:
        lcd.move_to(0, 0)
        lcd.putstr("Sensor error    ")
        time.sleep(2)
        continue
    t = sensor.temperature()
    h = sensor.humidity()
    check_climate(t, h)
    lcd.move_to(0, 0)
    lcd.putstr(f"T {t:.1f}°C H {h:.0f}%")
    lcd.move_to(0, 1)
    lcd.putstr("Fan on    " if fan_on else "Fan off   ")
    print(f"{t:.1f} C, {h:.1f} %, fan {fan_on}")
    time.sleep(2)
