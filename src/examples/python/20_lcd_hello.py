"""
ZERO1 Smart Board - 20 LCD hello
--------------------------------
WHAT IT TEACHES
  - The 16x2 LCD talks over I2C (two wires: SDA and SCL) at address 0x27.
  - LCD() prepares it and switches the backlight on; lcd.move_to(column, row)
    chooses where the next text goes (both start at 0); lcd.putstr(text)
    writes the text there.
  - The screen has 2 rows of 16 characters.
  - A counter that runs with time.ticks_ms(): the loop is never blocked by
    time.sleep(). str() turns the number of seconds into text.

PARTS AND PINS
  - LCD 16x2 ........... SDA = A4, SCL = A5 (I2C address 0x27)
    The board also has a physical "Backlight" switch: keep it on.

EXPECTED BEHAVIOUR
  - Row 1 shows:  Hello, ZERO1!
  - Row 2 shows:  Time: 0 s   and the number grows by 1 every second
    (Time: 1 s, Time: 2 s, ...). The backlight is on.

TRY THIS
  - Write your name on the first row.
  - Show minutes and seconds (use // and %).
  - Call lcd.backlight_off() to see what the screen looks like without light.
"""
from zero1 import LCD
import time

lcd = LCD()                # I2C address 0x27, 16 columns, 2 rows; the backlight goes on

lcd.move_to(0, 0)          # column 0, row 0 = top left corner
lcd.putstr("Hello, ZERO1!")

lcd.move_to(0, 1)          # column 0, row 1 = second row
lcd.putstr("Time: 0 s")

last_update = 0            # when we last refreshed the counter

while True:
    # Refresh the counter once per second, without time.sleep() (see 07_dc_motor)
    if time.ticks_diff(time.ticks_ms(), last_update) >= 1000:
        last_update = time.ticks_ms()
        lcd.move_to(6, 1)                                  # just after "Time: "
        lcd.putstr(str(time.ticks_ms() // 1000) + " s")    # whole seconds
