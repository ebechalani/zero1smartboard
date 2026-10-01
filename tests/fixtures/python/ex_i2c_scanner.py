"""I2C scanner: the address of every part on the bus."""
from machine import I2C
import time

i2c = I2C(0)

while True:
    print("Scanning...")
    found = 0
    for address in i2c.scan():
        print(f"Found a part at 0x{address:02X}")
        found += 1
    print(found, "part(s) found")
    time.sleep(5)
