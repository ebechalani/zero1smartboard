# Text (§2.7): methods, in, comparisons, +, repetition, text[i], for ch in text, len / ord / chr.
command = input("Command? ").strip().lower()
line = "-" * 16
if command.startswith("go") or command.endswith("!") and command.find("x") >= 0:
    print(command.upper(), command.replace("o", "0"), command.isdigit())
elif command == "" or "M" > command:
    print(line)
print(command[0], command[-1], len(command), ord(command[0]), chr(65), "a" in command, "z" not in command)
for ch in command:
    print(ch, end=" ")
print()
greeting = "Hello, " + command + "!"
greeting += " Bye."
print(greeting, command == 5)
