# Loops: range() in every form, while, break and continue, nested loops.
for i in range(5):
    print(i, end=" ")
print()
for i in range(2, 6):
    print(i, end=" ")
print()
for i in range(10, 0, -3):
    print(i, end=" ")
print()
for i in range(0, 20, 5):
    print(i, end=" ")
print()
n = 0
while n < 5:
    n += 1
    if n == 2:
        continue
    if n == 4:
        break
    print("n =", n)
for row in range(1, 4):
    line = ""
    for col in range(1, 4):
        line += str(row * col) + " "
    print(line)
countdown = 3
while countdown > 0:
    print(countdown)
    countdown -= 1
print("Go!")
for _ in range(2):
    print("again")
