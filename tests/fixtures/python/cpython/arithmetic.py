# Whole numbers: + - * / // % ** and the built-ins that work on numbers.
a = 17
b = 5
c = -17
print(a + b, a - b, a * b, a / b)
print(a // b, c // b, a // -b, c // -b)
print(a % b, c % b, a % -b, c % -b)
print(2 ** 10, (-3) ** 3, b ** 0, -2 ** 2)
print(abs(c), abs(-2.5), min(a, b, 3), max(a, b, 3))
print(round(2.5), round(3.5), round(-2.5), round(2.4), round(2.6))
print(round(3.14159, 2), round(-1.25, 1), round(2.0, 3))
print(int(2.9), int(-2.9), int(True), float(3), bool(0), bool(-4))
print(pow(2, 8), pow(2.0, 0.5))
print(7 & 3, 7 | 8, 7 ^ 2, 1 << 4, 256 >> 3, ~5)
print(a > b, a == 17, a != b, 1 < 2 < 3, 3 > 2 > 2)
print(not a, a > 0 and b > 2, a < 0 or b < 0)
x = 10
x += 5
x -= 3
x *= 2
x //= 5
x %= 3
print(x)
y = 7
y /= 2
print(y)
big = 50000
print(big * big)
limit = 2147483647
print(limit + 1)
print(1 / 3, 2 / 3, 10 / 4)
print(0.1 + 0.2)
print(0.1 + 0.2 == 0.3)
print(round(2.675, 2), round(1.005, 2))
print(min(2, 2.5), max(1, 0.5))
print(5.5 // 2, -5.5 % 2, 7.5 % 2)
whole = [1, 2, 3, 4]
halves = [0.5, 0.25]
print(sum(whole), sum(halves))
