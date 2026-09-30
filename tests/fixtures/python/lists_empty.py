# Lists that stay empty: C++ arrays still get one item (§2.10).
EMPTY = []
items = []
names = []
for x in items:
    print(x)
for n in EMPTY:
    print(n + 1)
print(len(items), items, len(EMPTY), EMPTY, 3 in items)
while True:
    if len(names) > 3:
        names.pop()
    print(names)
