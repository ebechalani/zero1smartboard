# No print(), no input(), nothing that can stop the program: no Serial.begin (§3.4).
from machine import Pin
from zero1 import LED_RED, BUTTON_1

led = Pin(LED_RED, Pin.OUT)
button = Pin(BUTTON_1, Pin.IN)

while True:
    if button.value():
        led.on()
    else:
        led.off()
