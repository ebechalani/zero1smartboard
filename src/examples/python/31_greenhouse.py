"""
ZERO1 Smart Board - 31 Smart greenhouse
---------------------------------------
WHAT IT TEACHES
  - An automatic system: measure (DHT22), decide (thresholds), act (fan and
    alarm), inform (LCD and Serial Monitor).
  - Two timers with time.ticks_ms() and time.ticks_diff(): the sensor is read
    every 2 s while the alarm LED blinks every 300 ms, without any
    time.sleep() in the while True loop.
  - Splitting the program into small functions (check_climate). "global
    too_hot" lets the function change a variable of the whole program.
  - try / except OSError around sensor.measure(): a sensor that does not
    answer is not a crash.

PARTS AND PINS
  - DHT22 .............. D5  (DHT_PIN, external header; plug it in)
  - LCD 16x2 ........... SDA = A4, SCL = A5 (I2C address 0x27)
  - Motor driver IN1 ... A0  (MOTOR; the DC motor plays the role of the fan)
  - Red LED ............ A1  (LED_RED, alarm)

EXPECTED BEHAVIOUR
  (move the DHT temperature slider in the simulator)
  - At start the LCD shows "Smart greenhouse" for 1 s.
  - LCD row 1:  T:24.0C H:55%      (temperature and humidity, refreshed every 2 s)
  - Temperature 28 C or less:   row 2 "OK: fan OFF",     motor stopped, LED off.
  - Above 28 C:                 row 2 "Warm: fan ON",    motor running.
  - Above 35 C:                 row 2 "TOO HOT! Fan ON", motor running and
                                the red LED blinks (300 ms on, 300 ms off).
  - Sensor unplugged:           "Sensor error!" / "Check the DHT22", motor stopped.
  - Every 2 s print() shows a line such as  T=24.0C  H=55%  fan=OFF

TRY THIS
  - Add a "too dry" alarm when the humidity is below 30 %.
  - Sound the buzzer (Buzzer()) during the alarm.
"""
import dht
from machine import Pin
from zero1 import DHT_PIN, MOTOR, LED_RED, LCD
import time

FAN_ON_TEMP = 28.0         # above this temperature the fan runs
ALARM_TEMP = 35.0          # above this the red LED blinks
READ_INTERVAL = 2000       # ms between two sensor readings
BLINK_INTERVAL = 300       # ms for the alarm blink

sensor = dht.DHT22(Pin(DHT_PIN))
fan = Pin(MOTOR, Pin.OUT)            # the motor driver input
alarm = Pin(LED_RED, Pin.OUT)
lcd = LCD()

last_read = 0
last_blink = 0
too_hot = False
led_on = False


def check_climate():
    """Reads the sensor, drives the fan and updates the LCD and the Serial Monitor."""
    global too_hot
    lcd.clear()
    try:
        sensor.measure()
    except OSError:
        lcd.putstr("Sensor error!")
        lcd.move_to(0, 1)
        lcd.putstr("Check the DHT22")
        fan.off()
        too_hot = False
        print("Sensor error: no answer from the DHT22")
        return

    t = sensor.temperature()
    h = sensor.humidity()
    fan_on = t > FAN_ON_TEMP
    too_hot = t > ALARM_TEMP
    fan.value(fan_on)

    # Row 1: T:24.0C H:55%
    lcd.putstr(f"T:{t:.1f}C H:{h:.0f}%")

    # Row 2: what the greenhouse is doing
    lcd.move_to(0, 1)
    if too_hot:
        lcd.putstr("TOO HOT! Fan ON")
    elif fan_on:
        lcd.putstr("Warm: fan ON")
    else:
        lcd.putstr("OK: fan OFF")

    print(f"T={t:.1f}C  H={h:.0f}%  fan={'ON' if fan_on else 'OFF'}{'  ALARM' if too_hot else ''}")


lcd.putstr("Smart greenhouse")
time.sleep(1)              # show the title for a second
check_climate()            # first measurement right away

while True:
    # Timer 1: read the sensor every 2 s
    if time.ticks_diff(time.ticks_ms(), last_read) >= READ_INTERVAL:
        last_read = time.ticks_ms()
        check_climate()

    # Timer 2: blink the red LED while it is too hot
    if too_hot:
        if time.ticks_diff(time.ticks_ms(), last_blink) >= BLINK_INTERVAL:
            last_blink = time.ticks_ms()
            led_on = not led_on
            alarm.value(led_on)
    elif led_on:
        led_on = False     # alarm over: make sure the LED is off
        alarm.off()
