# Text: methods, comparisons, in, len, indexes, loops over characters, str(), chr() and ord().
s = "  Hello, ZERO1!  "
t = s.strip()
print(t)
print(t.upper(), t.lower())
print(t.startswith("Hello"), t.endswith("?"), t.find("ZERO"), t.find("x"))
print(t.replace("ZERO1", "board"))
print("123".isdigit(), "12a".isdigit(), "".isdigit())
print("ell" in t, "xyz" in t, "Z" not in t)
print(len(t), t[0], t[-1], t[7])
word = "abc"
for ch in word:
    print(ch, ord(ch))
print(chr(65) + chr(66))
print("a" < "b", "abc" == "abc", "B" > "a")
print(str(42) + "!", str(2.5), str(True))
greeting = "Hi " + "there"
greeting += "!"
print(greeting)
print("-" * 10)
count = 3
print("Count: " + str(count))
