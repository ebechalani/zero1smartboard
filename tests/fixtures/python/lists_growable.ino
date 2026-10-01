// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
// Growable lists (§2.10): capacity proved in for range(K), 20 otherwise; append / pop / clear / len.

long squares[5];               // the list 'squares' has room for 5 items
long squaresCount = 0;
long log_[20];                 // the list 'log' has room for 20 items  W-list-capacity: the board keeps 20 items
long log_Count = 0;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  for (long k = 0; k < 5; k++) {
    squaresCount = pyAppendL(squares, squaresCount, 5, k * k, 6);
  }
}

// Runs forever: the body of "while True:" (line 9)
void loop() {
  log_Count = pyAppendL(log_, log_Count, 20, random(0, 10), 10);
  if (log_Count > 3) {
    long first = pyPopL(log_, log_Count, 0, 12);
    log_Count--;
    pyPopL(log_, log_Count, -1, 13);
    log_Count--;
    Serial.print(first);
    Serial.print(" ");
    Serial.print(pyListTextL(log_, log_Count));
    Serial.print(" ");
    Serial.print(log_Count);
    Serial.print(" ");
    Serial.print(pySumL(log_, log_Count));
    Serial.print(" ");
    Serial.println(pyMaxListL(log_, log_Count, 14));
  }
  if (log_Count == 0) {
    log_Count = 0;
  }
  Serial.print(pyListTextL(squares, squaresCount));
  Serial.print(" ");
  Serial.print(squares[pyIndex(random(0, squaresCount), squaresCount, 17)]);
  Serial.print(" ");
  Serial.println(pyBool(pyInListL(squares, squaresCount, 4)));
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

// list[i] with Python's negative indexes and IndexError
long pyIndex(long index, long size, int line) {
  if (index < 0) index += size;
  if (index < 0 || index >= size) pyFail(line, "IndexError: list index out of range");
  return index;
}

// list.append(value) for a list with room for `capacity` items; gives the new length
long pyAppendL(long list[], long count, long capacity, long value, int line) {
  if (count >= capacity) pyFail(line, "MemoryError: the list is full (" + String(capacity) + " items on the board)");
  list[count] = value;
  return count + 1;
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

long pySumL(long list[], long count) {
  long total = 0;
  for (long i = 0; i < count; i++) total += list[i];
  return total;
}

long pyMaxListL(long list[], long count, int line) {
  if (count == 0) pyFail(line, "ValueError: max() arg is an empty sequence");
  long largest = list[0];
  for (long i = 1; i < count; i++) {
    if (list[i] > largest) largest = list[i];
  }
  return largest;
}

bool pyInListL(long list[], long count, long value) {
  for (long i = 0; i < count; i++) {
    if (list[i] == value) return true;
  }
  return false;
}
