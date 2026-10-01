# N2-N5: division, floor division and modulo (with the non-negative facts), guards, powers.
x = 7
y = -2
f = 2.5
zero = 0
print(x / 2, x / y, 1 / x, f / 2, x / f)
print(x // 2, x % 3, y // 2, y % 3, x // y, x % y)
print(f // 2, f % 2, x // f, -f % 3)
print(x ** 2, 2 ** 10, -2 ** 2, 2 ** -1, f ** 2, -x ** 2)
print(pow(x, 3), pow(2.0, 0.5))
total = 10
total //= 3
total %= 4
total **= 2
ratio = 10
ratio /= 4
print(total, ratio, x / zero if zero else 0)
