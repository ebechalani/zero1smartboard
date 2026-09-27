#include <Arduino.h>
#line 1 "32_reaction_game.ino"
/*
  ZERO1 Smart Board - 32 Reaction game (project)
  ----------------------------------------------
  WHAT IT TEACHES
    - A small game with a clear sequence: wait for START, count down, wait a
      random time, GO, measure the reaction time.
    - random(min, max) and randomSeed(): the wait is different every time.
    - Measuring a duration with millis(): stop - start.
    - Waiting for a button inside a while loop, and leaving loop() early with return.

  PARTS AND PINS
    - Button 1 (A) ....... D6  START
    - Button 2 (B) ....... D7  REACT
    - 7-segment .......... DATA D12, LATCH D11, CLOCK D10
    - Buzzer ............. D8
    - Red LED ............ A1
    - Green LED .......... A2

  EXPECTED BEHAVIOUR
    1. Serial prints "Press Button 1 to start..." and the display is blank.
    2. Press Button 1: the display counts 3, 2, 1 (one per second, short beep each).
    3. The display goes blank for a random time between 1 and 3 s.
       If you press Button 2 during that time: the red LED lights for 1.5 s, a
       low tone sounds, Serial prints "Too early! You lose this round." and
       the game returns to step 1.
    4. GO: the display shows 8, the green LED lights and a beep sounds.
       Press Button 2 as fast as you can.
    5. Serial prints "Your reaction time: 312 ms" (your value), "New record!"
       when it is the best so far, and "Best time: ... ms". The display shows
       the tenths of a second (3 for 312 ms; 9 means 900 ms or more) for 3 s,
       then the game returns to step 1.

  TRY THIS
    - Show the reaction time on the LCD.
    - Give the red LED to a second player and make it a duel.
*/

const int BUTTON_A = 6;      // START button
const int BUTTON_B = 7;      // REACT button
const int BUZZER_PIN = 8;
const int LED_RED = A1;
const int LED_GREEN = A2;
const int DATA_PIN = 12;
const int LATCH_PIN = 11;
const int CLOCK_PIN = 10;

// Segment patterns for the digits 0..9 (see 05_seven_segment_counter)
const byte DIGITS[10] = { 0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F };
const byte BLANK = 0x00;     // all segments off

unsigned long bestTime = 0;  // best reaction time so far (0 = none yet)

// Sends one 8-bit pattern to the 7-segment display
#line 54 "32_reaction_game.ino"
void showPattern(byte pattern);
#line 60 "32_reaction_game.ino"
void showDigit(int n);
#line 65 "32_reaction_game.ino"
void waitForPress(int pin);
#line 71 "32_reaction_game.ino"
void setup();
#line 86 "32_reaction_game.ino"
void loop();
#line 54 "32_reaction_game.ino"
void showPattern(byte pattern) {
  digitalWrite(LATCH_PIN, LOW);
  shiftOut(DATA_PIN, CLOCK_PIN, MSBFIRST, pattern);
  digitalWrite(LATCH_PIN, HIGH);
}

void showDigit(int n) {
  showPattern(DIGITS[n]);
}

// Does nothing until the button on this pin is pressed
void waitForPress(int pin) {
  while (digitalRead(pin) == LOW) {
    // keep checking
  }
}

void setup() {
  pinMode(BUTTON_A, INPUT);
  pinMode(BUTTON_B, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(DATA_PIN, OUTPUT);
  pinMode(LATCH_PIN, OUTPUT);
  pinMode(CLOCK_PIN, OUTPUT);
  Serial.begin(9600);
  showPattern(BLANK);
  Serial.println("REACTION GAME");
  Serial.println("When the display shows 8 and the green LED lights, press Button 2 as fast as you can!");
}

void loop() {
  Serial.println("Press Button 1 to start...");
  waitForPress(BUTTON_A);
  randomSeed(millis());   // nobody presses at the same millisecond twice: a good random seed

  // Countdown 3, 2, 1 with a short beep at each number
  for (int n = 3; n >= 1; n--) {
    showDigit(n);
    tone(BUZZER_PIN, 800, 100);
    delay(1000);
  }
  showPattern(BLANK);

  // Wait a random time between 1 and 3 s. Pressing during this time = too early!
  unsigned long waitTime = random(1000, 3000);
  unsigned long waitStart = millis();
  bool tooEarly = false;
  while (millis() - waitStart < waitTime) {
    if (digitalRead(BUTTON_B) == HIGH) {
      tooEarly = true;
      break;
    }
  }

  if (tooEarly) {
    Serial.println("Too early! You lose this round.");
    digitalWrite(LED_RED, HIGH);
    tone(BUZZER_PIN, 200, 500);
    delay(1500);
    digitalWrite(LED_RED, LOW);
    return;   // back to the start of loop()
  }

  // GO! Show 8, light the green LED, beep, and start the stopwatch
  showDigit(8);
  digitalWrite(LED_GREEN, HIGH);
  tone(BUZZER_PIN, 1500, 150);
  unsigned long goTime = millis();

  waitForPress(BUTTON_B);
  unsigned long reaction = millis() - goTime;   // the stopwatch stops here
  digitalWrite(LED_GREEN, LOW);

  Serial.print("Your reaction time: ");
  Serial.print(reaction);
  Serial.println(" ms");
  if (bestTime == 0 || reaction < bestTime) {
    bestTime = reaction;
    Serial.println("New record!");
  }
  Serial.print("Best time: ");
  Serial.print(bestTime);
  Serial.println(" ms");

  // Score on the display: tenths of a second (0 = under 100 ms, 9 = 900 ms or more)
  int score = reaction / 100;
  if (score > 9) {
    score = 9;
  }
  showDigit(score);
  delay(3000);
  showPattern(BLANK);
}

