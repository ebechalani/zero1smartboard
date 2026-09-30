"""
ZERO1 Smart Board - 34 I2C scanner
----------------------------------
WHAT IT TEACHES
  - I2C is a bus: several devices share the same two wires (SDA and SCL)
    and each one has an address between 1 and 127.
  - How to find the address of a device: try to talk to every address and
    note which ones answer. "for address in i2c.scan():" does exactly that.
  - Printing a number in hexadecimal with an f-string: f"0x{address:02X}"
    (02 = at least 2 digits, X = hexadecimal in capitals).
  - This is the classic tool to run when an LCD "does not work": it tells
    you whether the address is 0x27 or 0x3F.

PARTS AND PINS
  - LCD 16x2 backpack .. SDA = A4, SCL = A5 (the only I2C device on the board)

EXPECTED BEHAVIOUR
  - print() shows "I2C scanner", then every 5 s:
      Scanning...
      I2C device found at address 0x27
      Done: 1 device(s)
  - If nothing answers it shows "No I2C devices found".

TRY THIS
  - Print the address in decimal too (print(address) gives 39).
  - Change the time.sleep() to scan more often.
"""
from machine import I2C
import time

i2c = I2C(0)               # the I2C bus: SDA = A4, SCL = A5
print("I2C scanner")

while True:
    found = 0
    print("Scanning...")

    for address in i2c.scan():
        # Only the addresses where a device answered come here
        print(f"I2C device found at address 0x{address:02X}")
        found += 1

    if found == 0:
        print("No I2C devices found")
    else:
        print(f"Done: {found} device(s)")

    time.sleep(5)          # scan again in 5 s
