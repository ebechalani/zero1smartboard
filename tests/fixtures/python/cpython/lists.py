# Lists: fixed and growable, items, loops, sum / min / max, in, printing.
numbers = [4, 8, 15, 16, 23, 42]
print(numbers)
print(len(numbers), numbers[0], numbers[-1], numbers[2])
numbers[1] = 9
print(numbers)
print(sum(numbers), min(numbers), max(numbers))
print(15 in numbers, 7 in numbers)
names = ["Ada", "Alan", "Grace"]
print(names)
for n in names:
    print(n)
temps = [21.5, 22.0, 19.75]
print(temps, sum(temps) / len(temps))
flags = [True, False]
print(flags)
zeros = [0] * 5
print(zeros)
growing = []
for i in range(6):
    growing.append(i * i)
print(growing, len(growing))
last = growing.pop()
first = growing.pop(0)
print(last, first, growing)
growing.clear()
print(growing, len(growing))
total = 0
for i in range(len(numbers)):
    total += numbers[i]
print(total)


def average(values):
    return sum(values) / len(values)


print(sum(numbers) / len(numbers), average(temps))
