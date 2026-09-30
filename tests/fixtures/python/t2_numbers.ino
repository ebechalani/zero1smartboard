// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

const int POT_LDR = A3;        // potentiometer / light sensor

const int adc = POT_LDR;
long total = 0;
long count = 0;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
}

// Runs forever: the body of "while True:" (line 9)
void loop() {
  long value = analogRead(adc);
  long percent = value * 100L / 1023L;
  total += value;
  count += 1;
  float average = (float)total / pyNonZero(count, 14);
  Serial.print(pyPad(String(percent), 3, '>'));
  Serial.print(" %  average ");
  Serial.print(average, 1);
  Serial.print("  ");
  Serial.println(count % 60L);
  delay(500);
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

// Python stops with ZeroDivisionError instead of dividing by 0
long pyNonZero(long divisor, int line) {
  if (divisor == 0) pyFail(line, "ZeroDivisionError: division by zero");
  return divisor;
}

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
