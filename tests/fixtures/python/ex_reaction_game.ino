// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
Reaction game: wait for the 8, then press button 2 as fast as you can.
*/

const int LED_RED = A1;        // red LED
const int LED_GREEN = A2;      // green LED
const int BUTTON_1 = 6;        // button 1
const int BUTTON_2 = 7;        // button 2
const int BUZZER = 8;          // buzzer
const int SEG_DATA = 12;       // 7-segment: 74HC595 data
const int SEG_LATCH = 11;      // 7-segment: 74HC595 latch
const int SEG_CLOCK = 10;      // 7-segment: 74HC595 clock

const int start_button = BUTTON_1;
const int react_button = BUTTON_2;
const int red = LED_RED;
const int green = LED_GREEN;
long best = 0;

void wait_for_press(int pin) {
  while (digitalRead(pin) == LOW) {
  }
}

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(start_button, INPUT);
  pinMode(react_button, INPUT);
  pinMode(red, OUTPUT);
  pinMode(green, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  pinMode(SEG_DATA, OUTPUT);
  pinMode(SEG_LATCH, OUTPUT);
  pinMode(SEG_CLOCK, OUTPUT);
  showSegments(0);
  Serial.println("REACTION GAME");
}

// Runs forever: the body of "while True:" (line 23)
void loop() {
  Serial.println("Press Button 1 to start...");
  wait_for_press(start_button);
  randomSeed((long)millis());
  for (long n = 3; n > 0; n--) {
    showDigit(n);
    tone(BUZZER, 800, 100);
    delay(1000);
  }
  showSegments(0);
  long wait_ms = random(1000, 3000);
  long wait_start = (long)millis();
  bool too_early = false;
  while ((long)millis() - wait_start < wait_ms) {
    if (digitalRead(react_button) == HIGH) {
      too_early = true;
      break;
    }
  }
  if (too_early) {
    Serial.println("Too early! You lose this round.");
    digitalWrite(red, HIGH);
    tone(BUZZER, 200, 500);
    delay(1500);
    digitalWrite(red, LOW);
    return;                    // continue: start the next round of the loop
  }
  showDigit(8);
  digitalWrite(green, HIGH);
  tone(BUZZER, 1500, 150);
  long go = (long)millis();
  wait_for_press(react_button);
  long reaction = (long)millis() - go;
  digitalWrite(green, LOW);
  Serial.print("Your reaction time: ");
  Serial.print(reaction);
  Serial.println(" ms");
  if (best == 0 || reaction < best) {
    best = reaction;
    Serial.println("New record!");
  }
  Serial.print("Best time: ");
  Serial.print(best);
  Serial.println(" ms");
  showDigit(pyMinL(pyFloorDiv(reaction, 100L), 9));
  delay(3000);
  showSegments(0);
}

// ---- Helpers that make C++ behave like Python ----

// Python's // for whole numbers: rounds down (C++'s / rounds toward zero)
long pyFloorDiv(long a, long b) {
  long q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
  return q;
}

// Python's abs(), min() and max(): each value is worked out once (Arduino's abs/min/max are macros)
long pyMinL(long a, long b) {
  return a < b ? a : b;
}

void showSegments(byte pattern) {          // 74HC595: a = bit 0 … g = bit 6, dp = bit 7
  digitalWrite(SEG_LATCH, LOW);
  shiftOut(SEG_DATA, SEG_CLOCK, MSBFIRST, pattern);
  digitalWrite(SEG_LATCH, HIGH);
}

void showDigit(int digit) {
  const byte DIGITS[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
  if (digit < 0 || digit > 9) { showSegments(0); return; }
  showSegments(DIGITS[digit]);
}
