# Operators and webs (§2.5, §2.9): a name that changes kind, int + bool, compound assignments, min / max / abs.
import time
x = 5
print(x)
x = 2.5
print(x)
state = 0
count = 0
while count < 3:
    state = not state
    count += 1
    print(state)
t = abs(int(input("t? ")) - 3)
print(max(t, 3, 4), min(t, int("7")), abs(-t), round(-2.5), round(0.5), round(1.5))
s = str(3.0) + str(True) + str(12)
print(s, len(s), s[1], "3" in s)
v = 10
v -= 3
v *= 2
v <<= 1
v >>= 1
v &= 0xFF
v |= 1
v ^= 2
print(v, ~v, -v, +v, v ** 2, 7 // -2, -7 % 3)
flag = True
flag &= False
print(flag, 1 < v < 100, v in [1, 2, 3], v not in [5])
print(10 if v > 3 else 2.5)
