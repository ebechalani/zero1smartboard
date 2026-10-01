# Statements after an endless loop that is not the last one: W-unreachable (§2.1 rule 4).
import time

while True:
    print("tick")
    time.sleep(1)
print("never")
while True:
    pass
