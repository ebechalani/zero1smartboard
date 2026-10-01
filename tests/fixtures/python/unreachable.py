# Code that never runs is left out of the sketch: after return, continue and break.
def sign(x):
    if x < 0:
        return -1
        print("never")
    return 1


while True:
    for n in range(3):
        if n == 1:
            continue
            print("skipped")
        print(sign(n - 1))
    break
    print("after the break")
