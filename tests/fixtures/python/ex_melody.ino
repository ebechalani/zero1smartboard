// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
Buzzer melody: Frere Jacques.
*/

const int BUZZER = 8;          // buzzer

const long NOTE_G3 = 196;
const long NOTE_C4 = 262;
const long NOTE_D4 = 294;
const long NOTE_E4 = 330;
const long NOTE_F4 = 349;
const long NOTE_G4 = 392;
const long NOTE_A4 = 440;
// The song: one entry per note, and how long each lasts in milliseconds
const long MELODY[20] = {NOTE_C4, NOTE_D4, NOTE_E4, NOTE_C4, NOTE_C4, NOTE_D4, NOTE_E4, NOTE_C4, NOTE_E4, NOTE_F4, NOTE_G4, NOTE_E4, NOTE_F4, NOTE_G4, NOTE_C4, NOTE_G3, NOTE_C4, NOTE_C4, NOTE_G3, NOTE_C4};
const long DURATIONS[20] = {400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 800, 400, 400, 800, 400, 400, 800, 400, 400, 800};

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(BUZZER, OUTPUT);
}

// Runs forever: the body of "while True:" (line 23)
void loop() {
  Serial.println("Playing Frere Jacques");
  for (long i = 0; i < 20; i++) {
    tone(BUZZER, MELODY[i]);   // start the note
    pySleepMs(DURATIONS[i], 27);  // let it sound
    noTone(BUZZER);
    delay(50);                 // a short silence between two notes
  }
  delay(2000);
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

// Python's time.sleep_ms(ms) for a value that is not a fixed number
void pySleepMs(long ms, int line) {
  if (ms < 0) pyFail(line, "ValueError: sleep length must be non-negative");
  delay(ms);
}
