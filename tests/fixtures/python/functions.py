# Functions (§2.4, §2.9): defaults and keywords, recursion, a missing return, list parameters, return without a value.
DATA = [1, 2, 3]
def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

def maybe(x):
    if x > 0:
        return x * 2

def greet(name, times=1, loud=False):
    for _ in range(times):
        if loud:
            print(name.upper())
        else:
            print(name)

def average(values):
    return sum(values) / len(values)

def nothing():
    return

def half(x):
    return x / 2

greet("ann")
greet("bob", loud=True, times=2)
print(fact(5), maybe(3), average(DATA), half(3), half(2.5))
nothing()
