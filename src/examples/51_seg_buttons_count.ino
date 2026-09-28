/*
  ZERO1 Smart Board - 51 Count up and down with the buttons
  ---------------------------------------------------------
  WHAT IT TEACHES
    - The 7-segment display is driven by a 74HC595 shift register:
      shiftOut() sends 8 bits, then the LATCH pin shows them all at once.
    - A lookup table: DIGITS[3] is the pattern of the digit 3.
    - A for loop that counts UP (n++) and one that counts DOWN (n--), each
      started by its own button.

  PARTS AND PINS
    - Button 1 (A) ....... D6
    - Button 2 (B) ....... D7
    - 7-segment DATA ..... D12  (74HC595 DS)
    - 7-segment LATCH .... D11  (74HC595 ST_CP)
    - 7-segment CLOCK .... D10  (74HC595 SH_CP)

  EXPECTED BEHAVIOUR
    - At the start the display is blank.
    - Press Button 1: the display shows 1, 2, 3, 4 (one digit per second),
      then goes blank again.
    - Press Button 2: the display shows 7, 6, 5, 4, 3, 2, 1 (one digit per
      second), then goes blank again.
    - Serial prints each digit as it is shown.

  TRY THIS
    - Count from 1 to 9, or down from 9 to 0 with a beep at 0 (a launch
      countdown!).
    - Show the digits faster (delay(300)).
*/

const int BUTTON_A = 6;
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

// Shows one digit (0..9) for a second and prints it
void showDigit(int n) {
  showPattern(DIGITS[n]);
  Serial.println(n);
  delay(1000);
}

void setup() {
  pinMode(BUTTON_A, INPUT);
  pinMode(BUTTON_B, INPUT);
  pinMode(DATA_PIN, OUTPUT);
  pinMode(LATCH_PIN, OUTPUT);
  pinMode(CLOCK_PIN, OUTPUT);
  Serial.begin(9600);
  showPattern(0);   // blank display
}

void loop() {
  if (digitalRead(BUTTON_A) == HIGH) {
    for (int n = 1; n <= 4; n++) {      // 1, 2, 3, 4
      showDigit(n);
    }
    showPattern(0);                     // blank again
  }

  if (digitalRead(BUTTON_B) == HIGH) {
    for (int n = 7; n >= 1; n--) {      // 7, 6, 5, 4, 3, 2, 1
      showDigit(n);
    }
    showPattern(0);                     // blank again
  }
}
