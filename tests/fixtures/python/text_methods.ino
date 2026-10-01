// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  // Text (§2.7): methods, in, comparisons, +, repetition, text[i], for ch in text, len / ord / chr.
  String command = pyLower(pyStrip(pyInput("Command? ")));
  String line = "----------------";
  if (command.startsWith("go") || (command.endsWith("!") && (long)command.indexOf("x") >= 0)) {
    Serial.print(pyUpper(command));
    Serial.print(" ");
    Serial.print(pyReplace(command, "o", "0"));
    Serial.print(" ");
    Serial.println(pyBool(pyIsDigit(command)));
  } else if (command == "" || String("M") > command) {
    Serial.println(line);
  }
  Serial.print(pyCharAt(command, 0, 8));
  Serial.print(" ");
  Serial.print(pyCharAt(command, -1, 8));
  Serial.print(" ");
  Serial.print((long)command.length());
  Serial.print(" ");
  Serial.print((long)(byte)pyCharAt(command, 0, 8).charAt(0));
  Serial.print(" ");
  Serial.print(String((char)65));
  Serial.print(" ");
  Serial.print(pyBool(command.indexOf("a") >= 0));
  Serial.print(" ");
  Serial.println(pyBool(command.indexOf("z") < 0));
  for (long chIndex = 0; chIndex < (long)command.length(); chIndex++) {
    String ch = String(command.charAt(chIndex));
    Serial.print(ch);
    Serial.print(" ");
  }
  Serial.println();
  String greeting = String("Hello, ") + command + "!";
  greeting += " Bye.";
  Serial.print(greeting);
  Serial.print(" ");
  Serial.println(pyBool(false));
}

// The Python program has no "while True:": it has ended.
void loop() {
}

// ---- Helpers that make C++ behave like Python ----

// Stops the program like a Python error: the message goes to the Serial Monitor, then the board halts
void pyFail(int line, String text) {
  Serial.print("Line ");
  Serial.print(line);
  Serial.print(": ");
  Serial.println(text);
  Serial.flush();
  abort();
}

// How Python shows True and False
String pyBool(bool b) {
  return b ? "True" : "False";
}

// Python's input(): waits for one line typed in the Serial Monitor and shows it, like a terminal
String pyInput(String prompt) {
  Serial.print(prompt);
  while (Serial.available() == 0) {
  }
  String line = Serial.readStringUntil('\n');
  if (line.endsWith("\r")) line.remove(line.length() - 1);
  Serial.println(line);
  return line;
}

// Python's str.isdigit()
bool pyIsDigit(String text) {
  if (text.length() == 0) return false;
  for (unsigned int i = 0; i < text.length(); i++) {
    if (text.charAt(i) < '0' || text.charAt(i) > '9') return false;
  }
  return true;
}

String pyUpper(String text) {
  text.toUpperCase();
  return text;
}

String pyLower(String text) {
  text.toLowerCase();
  return text;
}

String pyStrip(String text) {
  text.trim();
  return text;
}

String pyReplace(String text, String from, String to) {
  text.replace(from, to);
  return text;
}

// text[i] with Python's negative indexes and IndexError
String pyCharAt(String text, long index, int line) {
  if (index < 0) index += text.length();
  if (index < 0 || index >= (long)text.length()) pyFail(line, "IndexError: string index out of range");
  return String(text.charAt(index));
}
