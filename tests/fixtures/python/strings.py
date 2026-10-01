# Text in the sketch (S1): UTF-8, escapes, split literals, the LCD's degree sign.
from zero1 import LCD

lcd = LCD()
print("\x41BC", "tab\there", 'quote " and \\ backslash', "What??", "Lumière allumée")
print("\x01" + "A", "bell\a")
print("\x01A", "a\x7fb")      # an escape before a hex digit: the literal is split
lcd.putstr("Temp: 23°C")
lcd.putstr(f"{21.5:.1f}°C")
