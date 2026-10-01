# The zero1 parts (§3.8): Servo, LCD, Buzzer, SevenSegment, map_range, input_available.
from zero1 import Servo, LCD, Buzzer, SevenSegment, POT_LDR, map_range, input_available, LCD_ADDRESS
from machine import ADC
import time

servo = Servo()
lcd = LCD(addr=LCD_ADDRESS, cols=16, rows=2)
buzzer = Buzzer()
display = SevenSegment()
adc = ADC(POT_LDR)
HEART = [0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000]
lcd.custom_char(0, HEART)
lcd.custom_char(1, [0, 0, 0, 0, 0, 0, 0, 31])

while True:
    angle = map_range(adc.read(), 0, 1023, 0, 180)
    servo.angle(angle)
    lcd.move_to(0, 0)
    lcd.putstr(f"Angle: {servo.angle()}   ")
    lcd.move_to(0, 1)
    lcd.putstr("24.5°C ")
    lcd.putchar(chr(0))
    lcd.putchar(chr(223))
    lcd.putchar("!")
    lcd.backlight_on()
    lcd.display_on()
    lcd.hide_cursor()
    lcd.blink_cursor_off()
    display.show(angle // 20)
    display.segments(0b10000000)
    buzzer.tone(440, 50)
    if input_available():
        print("You typed", input())
        buzzer.no_tone()
        servo.detach()
    time.sleep_ms(100)
