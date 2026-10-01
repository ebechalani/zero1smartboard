# D4: which parts make a variable, library objects, the lines each part needs (§3).
from machine import Pin, PWM, ADC, I2C
from neopixel import NeoPixel
import dht
from zero1 import *

led = Pin(LED_RED, Pin.OUT, value=1)
button = Pin(BUTTON_1, Pin.IN, Pin.PULL_UP)
green = Pin("LED_GREEN", Pin.OUT)
builtin = Pin("LED", Pin.OUT)
dimmer = PWM(Pin(RGB_PIN), freq=1000, duty_u16=32768)
adc = ADC(Pin(POT_LDR))
i2c = I2C(0)
servo = Servo()
lcd = LCD()
np = NeoPixel(Pin(RGB_PIN), 1)
sensor = dht.DHT22(Pin(DHT_PIN))
buzzer = Buzzer()
display = SevenSegment()
sonar = HCSR04()

while True:
    led.value(button.value())
    green.toggle()
    builtin(0)
    dimmer.duty_u16(adc.read() * 64)
    servo.angle(90)
    lcd.clear()
    np.fill((0, 0, 32))
    np.write()
    buzzer.no_tone()
    display.clear()
    print(sonar.distance_cm())
