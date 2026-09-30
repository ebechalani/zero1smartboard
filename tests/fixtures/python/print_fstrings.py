# print() and f-strings (§2.11): pieces, sep / end, every accepted format spec.
n = -5
x = 3.14159
name = "ab"
ok = True
print()
print("one", 2, 3.5, ok, name)
print("a", "b", sep="-", end="!\n")
print("no newline", end="")
print(" then", n, sep="")
print(f"{n:03d}|{-1:x}|{n:b}|{name:5}|{512:.2f}|{x:f}|{n:>6}|{name:>4}|{name:.1}|{x:08.3f}|{ok}|{255:X}|{n:d}|{name:s}|{ok:d}")
text = f"T = {x:.1f} C, n = {n}, ok = {ok}"
print(text, str(n) + str(x), str(ok))
