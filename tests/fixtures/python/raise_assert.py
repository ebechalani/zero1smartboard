# raise and assert stop the program like an uncaught Python exception (§2.12).
level = int(input("Level? "))
assert level >= 0, "the level cannot be negative"
assert level < 100
if level == 42:
    raise ValueError(f"no {level}, please")
if level == 43:
    raise RuntimeError
if level == 44:
    raise KeyError("forty-four")
print("Level", level)
