# input() echoes the line (§2.6); int() / float() of text stop with ValueError like Python.
while True:
    age = int(input("Age? "))
    height = float(input("Height in m? "))
    print("In ten years:", age + 10, "Height:", height)
