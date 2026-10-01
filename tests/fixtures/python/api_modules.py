# The modules by their own names (§3): machine.…, neopixel.…, dht.…, hcsr04.…, utime.
import machine
import neopixel
import dht
import hcsr04
import utime as t
from machine import Pin, SoftI2C
from zero1 import *

sonar = hcsr04.HCSR04(trigger_pin=TRIG_PIN, echo_pin=ECHO_PIN)
sensor = dht.DHT11(machine.Pin(DHT_PIN))
np = neopixel.NeoPixel(machine.Pin(RGB_PIN), 1)
i2c = SoftI2C(scl=Pin(A5), sda=Pin(A4))
fade = machine.PWM(machine.Pin(11))
motor = Pin(MOTOR, Pin.OUT, value=0)
led = machine.Pin("D13", machine.Pin.OUT)

while True:
    sensor.measure()
    d = sonar.distance_cm()
    mm = sonar.distance_mm()
    level = int(sensor.humidity())
    np.fill((level, 0, 0))
    np[len(np) - 1] = (0, level, 0)
    np.write()
    fade.duty_u16(32768)
    motor.value(d < 20)
    led.value(True)
    print(d, mm, sensor.temperature(), t.ticks_diff(t.ticks_ms(), 0))
    t.sleep_ms(500)
