// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

long count = 0;

long bump() {
  count += 1;
  return count;
}

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  // Assignment forms (§2.4): a chain, a subscript first, values worked out before any target changes.
  long lst[3] = {0};
  long t = 5;
  lst[0] = t;
  long x = t;
  long a = 7;
  long b = a;
  long c = a;

  long p = 0;
  long q = 0;
  { long t1 = bump(); long t2 = count; p = t1; q = t2; }
  Serial.print(pyListTextL(lst, 3));
  Serial.print(" ");
  Serial.print(x);
  Serial.print(" ");
  Serial.print(a);
  Serial.print(" ");
  Serial.print(b);
  Serial.print(" ");
  Serial.print(c);
  Serial.print(" ");
  Serial.print(p);
  Serial.print(" ");
  Serial.println(q);
}

// The Python program has no "while True:": it has ended.
void loop() {
}

// ---- Helpers that make C++ behave like Python ----

// str(list) / print(list): [1, 2, 3]
String pyListTextL(long list[], long count) {
  String text = "[";
  for (long i = 0; i < count; i++) {
    if (i > 0) text += ", ";
    text += String(list[i]);
  }
  return text + "]";
}
