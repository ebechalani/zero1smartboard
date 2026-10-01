// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

// Lists that stay empty: C++ arrays still get one item (§2.10).
long EMPTY[1];
long names[1];                 // the list 'names' has room for 0 items
long namesCount = 0;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  long items[1] = {0};
  for (long xIndex = 0; xIndex < 0; xIndex++) {
    long x = items[xIndex];
    Serial.println(x);
  }
  for (long nIndex = 0; nIndex < 0; nIndex++) {
    long n = EMPTY[nIndex];
    Serial.println(n + 1L);
  }
  Serial.print(0);
  Serial.print(" ");
  Serial.print(pyListTextL(items, 0));
  Serial.print(" ");
  Serial.print(0);
  Serial.print(" ");
  Serial.print(pyListTextL(EMPTY, 0));
  Serial.print(" ");
  Serial.println(pyBool(pyInListL(items, 0, 3)));
}

// Runs forever: the body of "while True:" (line 10)
void loop() {
  if (namesCount > 3) {
    pyPopL(names, namesCount, -1, 12);
    namesCount--;
  }
  Serial.println(pyListTextL(names, namesCount));
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

// list.pop(index): takes the item out and moves the ones after it; the caller then shortens the list by 1
long pyPopL(long list[], long count, long index, int line) {
  if (count == 0) pyFail(line, "IndexError: pop from empty list");
  if (index < 0) index += count;
  if (index < 0 || index >= count) pyFail(line, "IndexError: pop index out of range");
  long value = list[index];
  for (long i = index; i < count - 1; i++) list[i] = list[i + 1];
  return value;
}

// str(list) / print(list): [1, 2, 3]
String pyListTextL(long list[], long count) {
  String text = "[";
  for (long i = 0; i < count; i++) {
    if (i > 0) text += ", ";
    text += String(list[i]);
  }
  return text + "]";
}

bool pyInListL(long list[], long count, long value) {
  for (long i = 0; i < count; i++) {
    if (list[i] == value) return true;
  }
  return false;
}
