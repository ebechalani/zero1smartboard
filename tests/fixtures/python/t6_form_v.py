while True:
    try:
        age = int(input("Age? "))
    except ValueError:
        print("Please type a whole number")
    else:
        print("In ten years:", age + 10)
