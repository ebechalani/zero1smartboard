# math, random and micropython (§3.9).
import math
import random
from micropython import const

LIMIT = const(10)
SCALE = const(2.5)
random.seed(42)
x = random.uniform(1, 2)
print(math.sqrt(2), math.sin(math.pi / 2), math.atan2(1, 1), math.fabs(-x), math.log10(1000))
print(math.floor(2.7), math.ceil(2.1), math.trunc(-2.7), math.pow(2, 8), math.radians(180), math.degrees(math.pi))
print(math.isnan(x), math.isinf(x), math.e, LIMIT * SCALE)
print(random.randint(1, 6), random.randint(1, LIMIT), random.randrange(10), random.randrange(5, 10), random.random())
print(abs(-3), abs(x - 3), abs(random.randint(-5, 5)), min(3, 7, x), max(3, 7), min(random.randint(1, 9), 5))
print(round(2.5), round(3.5), round(x, 2), round(7), int(3.9), int(-3.9), float(7), bool(0), bool("a"))
random.seed()
