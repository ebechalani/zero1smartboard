/*
  ZERO1 Smart Board - 05 Seven-segment counter
  --------------------------------------------
  WHAT IT TEACHES
    - The 7-segment display is driven by a 74HC595 "shift register" chip:
      we send 8 bits one after the other with shiftOut(), then we "latch"
      them so they all appear at the same time.
    - A lookup table: DIGITS[3] is the pattern that draws the digit 3.
    - Hexadecimal numbers (0x3F) are a compact way to write 8 bits.

  PARTS AND PINS
    - 7-segment DATA ..... D12  (74HC595 DS)
    - 7-segment LATCH .... D11  (74HC595 ST_CP)
    - 7-segment CLOCK .... D10  (74HC595 SH_CP)

  HOW THE BITS MAP TO THE SEGMENTS (common cathode, 1 = segment lit)
          a
         ---
      f |   | b        bit:   7   6   5   4   3   2   1   0
         -g-        segment:  dp  g   f   e   d   c   b   a
      e |   | c
         ---  . dp     Example: digit 0 lights a,b,c,d,e,f = 0b00111111 = 0x3F
          d

  EXPECTED BEHAVIOUR
    - The display counts 0, 1, 2, ... 9, one digit per second, then starts
      again at 0. Serial prints the same digit at each step.

  TRY THIS
    - Count down instead of up.
    - Light the decimal point too: shiftOut(..., DIGITS[n] | 0x80).
*/

const int DATA_PIN = 12;
const int LATCH_PIN = 11;
const int CLOCK_PIN = 10;

// One 8-bit pattern per digit 0..9 (see the drawing above)
const byte DIGITS[10] = {
  0x3F,  // 0
  0x06,  // 1
  0x5B,  // 2
  0x4F,  // 3
  0x66,  // 4
  0x6D,  // 5
  0x7D,  // 6
  0x07,  // 7
  0x7F,  // 8
  0x6F   // 9
};

// Shows one digit (0..9) on the display
void showDigit(int n) {
  digitalWrite(LATCH_PIN, LOW);                          // freeze the outputs
  shiftOut(DATA_PIN, CLOCK_PIN, MSBFIRST, DIGITS[n]);    // send the 8 bits, bit 7 first
  digitalWrite(LATCH_PIN, HIGH);                         // show the new pattern
}

void setup() {
  pinMode(DATA_PIN, OUTPUT);
  pinMode(LATCH_PIN, OUTPUT);
  pinMode(CLOCK_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  for (int i = 0; i <= 9; i++) {
    showDigit(i);
    Serial.println(i);
    delay(1000);
  }
}
