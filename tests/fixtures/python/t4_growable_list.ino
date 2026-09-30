// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

const int POT_LDR = A3;        // potentiometer / light sensor

const int adc = POT_LDR;
long readings[20];             // the list 'readings' has room for 20 items
long readingsCount = 0;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
}

// Runs forever: the body of "while True:" (line 8)
void loop() {
  readingsCount = pyAppendL(readings, readingsCount, 20, analogRead(adc), 9);
  if (readingsCount > 10) {
    pyPopL(readings, readingsCount, 0, 11);
    readingsCount--;
  }
  Serial.print(pyListTextL(readings, readingsCount));
  Serial.print(" ");
  Serial.println(pyFloorDiv(pySumL(readings, readingsCount), pyNonZero(readingsCount, 12)));
  delay(1000);
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

// Python's // for whole numbers: rounds down (C++'s / rounds toward zero)
long pyFloorDiv(long a, long b) {
  long q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
  return q;
}

// Python stops with ZeroDivisionError instead of dividing by 0
long pyNonZero(long divisor, int line) {
  if (divisor == 0) pyFail(line, "ZeroDivisionError: division by zero");
  return divisor;
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
