# Functions: parameters, defaults, keyword arguments, return values, global, recursion.
def add(a, b):
    return a + b


def greet(name, greeting="Hello"):
    print(greeting + ", " + name + "!")


def area(width, height=2):
    return width * height


def sign(x):
    if x > 0:
        return 1
    elif x < 0:
        return -1
    return 0


total = 0


def remember(value):
    global total
    total += value
    return total


def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)


print(add(2, 3), add(2.5, 1))
greet("Ada")
greet("Alan", greeting="Hi")
print(area(3), area(3, 4), area(height=5, width=2))
print(sign(-7), sign(0), sign(12))
remember(5)
remember(10)
print(total, remember(1))
print(factorial(5), factorial(10))
