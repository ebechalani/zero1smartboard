# Growable lists (§2.10): capacity proved in for range(K), 20 otherwise; append / pop / clear / len.
import random

squares = []
for k in range(5):
    squares.append(k * k)
log = []                        # W-list-capacity: the board keeps 20 items

while True:
    log.append(random.randint(0, 9))
    if len(log) > 3:
        first = log.pop(0)
        log.pop()
        print(first, log, len(log), sum(log), max(log))
    if not log:
        log.clear()
    print(squares, random.choice(squares), 4 in squares)
