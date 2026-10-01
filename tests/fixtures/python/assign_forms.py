# Assignment forms (§2.4): a chain, a subscript first, values worked out before any target changes.
lst = [0, 0, 0]
lst[0] = x = 5
a = b = c = 7
count = 0

def bump():
    global count
    count += 1
    return count

p, q = bump(), count
print(lst, x, a, b, c, p, q)
