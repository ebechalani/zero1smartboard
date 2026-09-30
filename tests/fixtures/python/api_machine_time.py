# machine and time (§3.2, §3.3).
from machine import Pin, PWM, ADC, time_pulse_us
import time
import utime
from zero1 import LED_BUILTIN, ECHO_PIN, TRIG_PIN, POT_LDR

WAIT = 0.25
STEPS = 3
led = Pin(LED_BUILTIN, Pin.OUT)
trig = Pin(TRIG_PIN, Pin.OUT)
adc = ADC(POT_LDR)
fade = PWM(Pin(3))

while True:
    led.on()
    time.sleep(WAIT)
    led.off()
    time.sleep(STEPS)
    time.sleep_ms(250)
    time.sleep_us(10)
    fade.duty(512)
    fade.duty_u16(65535)
    fade.deinit()
    pause = adc.read() / 1000
    time.sleep(pause)
    time.sleep_ms(adc.read())
    trig.value(1)
    width = time_pulse_us(Pin(ECHO_PIN, Pin.IN), 1, 30000)
    print(width, adc.read_u16(), time.ticks_us(), utime.ticks_ms(), time.time())
