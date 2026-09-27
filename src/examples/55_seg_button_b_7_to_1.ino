/*
  ZERO1 Smart Board - 55 On Button B -> display numbers from 7 to 1
  -----------------------------------------------------------------
  WHAT IT TEACHES
    - Counting DOWN with a for loop: start at 7, stop at 1, n-- each time.
    - The same digit table and shiftOut() as in the other 7-segment sketches.

  PARTS AND PINS
    - Button B (Button 2)  D7
    - 7-segment DATA ..... D12  (74HC595 DS)
    - 7-segment LATCH .... D11  (74HC595 ST_CP)
    - 7-segment CLOCK .... D10  (74HC595 SH_CP)

  EXPECTED BEHAVIOUR
    - At the start the display is blank.
    - Press Button B: the display shows 7, 6, 5, 4, 3, 2, 1 (one digit per
      second), then goes blank again. Serial prints each digit.

  TRY THIS
    - Count down from 9 to 0 and beep at 0 (a launch countdown!).
    - Combine with sketch 54: Button A counts up, Button B counts down.
*/

const int BUTTON_B = 7;
const int DATA_PIN = 12;
const int LATCH_PIN = 11;
const int CLOCK_PIN = 10;

// One 8-bit pattern per digit 0..9 (bit 0 = segment a ... bit 6 = segment g)
const byte DIGITS[10] = {
  0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F
};

// Sends one pattern of 8 bits to the display
void showPattern(byte pattern) {
  digitalWrite(LATCH_PIN, LOW);
  shiftOut(DATA_PIN, CLOCK_PIN, MSBFIRST, pattern);
  digitalWrite(LATCH_PIN, HIGH);
}

void setup() {
  pinMode(BUTTON_B, INPUT);
  pinMode(DATA_PIN, OUTPUT);
  pinMode(LATCH_PIN, OUTPUT);
  pinMode(CLOCK_PIN, OUTPUT);
  Serial.begin(9600);
  showPattern(0);   // blank display
}

void loop() {
  if (digitalRead(BUTTON_B) == HIGH) {
    for (int n = 7; n >= 1; n--) {      // 7, 6, 5, 4, 3, 2, 1
      showPattern(DIGITS[n]);
      Serial.println(n);
      delay(1000);
    }
    showPattern(0);                     // blank again
  }
}
