# A while True: with a break out of it is not the main loop: the program ends (§2.1 rule 4).
import time

count = 0
while True:
    count += 1
    print("Round", count)
    if count == 3:
        break
    time.sleep(0.5)
print("Finished after", count, "rounds")
