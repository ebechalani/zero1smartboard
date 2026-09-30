"""
ZERO1 Smart Board - 21 LCD custom characters
--------------------------------------------
WHAT IT TEACHES
  - Each LCD character is a grid of 5 x 8 dots. We can draw our own
    characters (up to 8 of them) with lcd.custom_char() and show them with
    lcd.putchar(chr(number)).
  - A drawing is a list of 8 numbers: one per row, one bit per dot
    (0b01110 = dots off, on, on, on, off).
  - The LCD's built-in font already has a degree symbol at code 223: chr(223).
  - The temperature comes from the DHT22 sensor, shown with one decimal.
    sensor.measure() reads the sensor; try / except OSError catches a sensor
    that does not answer.

PARTS AND PINS
  - LCD 16x2 ........... SDA = A4, SCL = A5 (I2C address 0x27)
  - DHT22 .............. D5  (DHT_PIN, external header; make sure it is plugged in)

EXPECTED BEHAVIOUR
  - Row 1 shows the temperature with the degree symbol:  Temp: 24.0<deg>C
    (or "Temp: --.-<deg>C" if the sensor is unplugged). It is refreshed every 2 s.
  - Row 2 shows:  I <heart> ZERO1   and the heart beats: it is small for
    500 ms, then big for 500 ms, and so on.

TRY THIS
  - Draw a smiley: change the bits of heart_big.
  - Show the humidity on the second row instead of the text.
"""
import dht
from machine import Pin
from zero1 import LCD, DHT_PIN
import time

HEART_SMALL = 0            # slot numbers of our custom characters (0..7)
HEART_BIG = 1
DEGREE = 223               # code of the degree symbol in the LCD font
HEART_COL = 2              # column where the heart is drawn on row 2

lcd = LCD()
sensor = dht.DHT22(Pin(DHT_PIN))

# A custom character is 8 rows of 5 dots: 1 = dot on, 0 = dot off
heart_small = [
    0b00000,
    0b00000,
    0b01010,
    0b01110,
    0b00100,
    0b00000,
    0b00000,
    0b00000,
]

heart_big = [
    0b00000,
    0b01010,
    0b11111,
    0b11111,
    0b01110,
    0b00100,
    0b00000,
    0b00000,
]

lcd.custom_char(HEART_SMALL, heart_small)   # store our drawings in the LCD
lcd.custom_char(HEART_BIG, heart_big)

lcd.move_to(0, 1)
lcd.putstr("I ")
lcd.putchar(chr(HEART_BIG))  # shows custom character number 1
lcd.putstr(" ZERO1")


def show_temperature():
    """Draws the temperature on the first row, for example "Temp: 24.0<deg>C"."""
    lcd.move_to(0, 0)
    lcd.putstr("Temp: ")
    try:
        sensor.measure()
    except OSError:
        lcd.putstr("--.-")                          # the sensor did not answer
    else:
        lcd.putstr(f"{sensor.temperature():.1f}")   # one digit after the point
    lcd.putchar(chr(DEGREE))                        # the degree symbol
    lcd.putstr("C  ")                               # the spaces erase leftovers of a longer number


def draw_heart(which):
    """Draws one heart (HEART_SMALL or HEART_BIG) on the second row."""
    lcd.move_to(HEART_COL, 1)
    lcd.putchar(chr(which))


while True:
    show_temperature()

    # Two heartbeats take 2 s; then the temperature is refreshed
    for _ in range(2):
        draw_heart(HEART_SMALL)
        time.sleep(0.5)
        draw_heart(HEART_BIG)
        time.sleep(0.5)
