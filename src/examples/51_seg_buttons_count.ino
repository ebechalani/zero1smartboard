/*
  ZERO1 Smart Board - 54 On Button A -> display numbers from 1 to 4
  -----------------------------------------------------------------
  WHAT IT TEACHES
    - The 7-segment display is driven by a 74HC595 shift register:
      shiftOut() sends 8 bits, then the LATCH pin shows them all at once.
    - A lookup table: DIGITS[3] is the pattern of the digit 3.
    - A button starts a counting sequence made with a for loop.

  PARTS AND PINS
    - Button A (Button 1)  D6
    - 7-segment DATA ..... D12  (74HC595 DS)
    - 7-segment LATCH .... D11  (74HC595 ST_CP)
    - 7-segment CLOCK .... D10  (74HC595 SH_CP)

  EXPECTED BEHAVIOUR
    - At the start the display is blank.
    - Press Button A: the display shows 1, 2, 3, 4 (one digit per second),
      then goes blank again and waits for the next press.
    - Serial prints each digit.

  TRY THIS
    - Count from 1 to 9.
    - Show the digits faster (delay(300)).
*/

const int BUTTON_A = 6;
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
  pinMode(BUTTON_A, INPUT);
  pinMode(DATA_PIN, OUTPUT);
  pinMode(LATCH_PIN, OUTPUT);
  pinMode(CLOCK_PIN, OUTPUT);
  Serial.begin(9600);
  showPattern(0);   // blank display
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {
    for (int n = 1; n <= 4; n++) {      // 1, 2, 3, 4
      showPattern(DIGITS[n]);
      Serial.println(n);
      delay(1000);
    }
    showPattern(0);                     // blank again
  }
}
