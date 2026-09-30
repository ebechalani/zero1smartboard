from machine import Pin

led = Pin(LED_RED, Pin.OUT)
while True:
    led.on()
    time.sleep(0.5)
