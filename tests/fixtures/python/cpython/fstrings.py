# f-strings: widths, alignment, zero padding, decimals, hexadecimal and binary.
n = 42
neg = -5
x = 3.14159
name = "Ada"
print(f"n = {n}")
print(f"[{n:5}] [{n:<5}] [{n:>5}] [{n:05}]")
print(f"[{name:6}] [{name:>6}] [{name:<6}]")
print(f"{neg:03d} {n:03d} {n:d}")
print(f"{x:.2f} {x:.0f} {x:f} {x:8.3f} {x:08.3f}")
print(f"{n:x} {n:X} {n:b} {255:x} {-1:x} {neg:b}")
print(f"{name:.2} {name:s}")
print(f"{n} + {neg} = {n + neg}")
print(f"{True} {False} {n > 40}")
print(f"{{braces}} {n}")
print(f"{2.5:.0f} {3.5:.0f}")
print(f"{0.1 + 0.2}")
ok = n > 10
print(f"{'big' if ok else 'small'} number")
print("a", "b", "c", sep="-")
print("no newline", end="")
print(" then more")
print("x", end="!\n")
print()
print("done")
