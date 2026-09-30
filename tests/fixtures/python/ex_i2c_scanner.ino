// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
I2C scanner: the address of every part on the bus.
*/

#include <Wire.h>

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  Wire.begin();
}

// Runs forever: the body of "while True:" (line 7)
void loop() {
  Serial.println("Scanning...");
  long found = 0;
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.print("Found a part at 0x");
      Serial.println(pyPad(pyHex(address, true), 2, '0'));
      found += 1;
    }
  }
  Serial.print(found);
  Serial.println(" part(s) found");
  delay(5000);
}

// ---- Helpers that make C++ behave like Python ----

// f-string widths: '>' spaces on the left (numbers), '<' spaces on the right (text), '0' zeros after the sign
String pyPad(String text, int width, char how) {
  while ((int)text.length() < width) {
    if (how == '<') {
      text += " ";
    } else if (how == '0' && text.startsWith("-")) {
      text = "-0" + text.substring(1);
    } else if (how == '0') {
      text = "0" + text;
    } else {
      text = " " + text;
    }
  }
  return text;
}

// f"{n:x}" and f"{n:X}": hexadecimal, with "-" in front of negative numbers
String pyHex(long n, bool upper) {
  String text = String(n < 0 ? -n : n, HEX);
  if (upper) text.toUpperCase();
  else text.toLowerCase();
  return n < 0 ? "-" + text : text;
}
