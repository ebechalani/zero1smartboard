#include <Arduino.h>
#line 1 "03_buzzer_melody.ino"
/*
  ZERO1 Smart Board - 03 Buzzer melody
  ------------------------------------
  WHAT IT TEACHES
    - tone(pin, frequency) makes the buzzer sing a note; noTone(pin) stops it.
    - Storing a melody in two arrays: the notes and how long each one lasts.
    - #define gives a name to a number, like const int does.
    - sizeof(array) / sizeof(array[0]) counts the elements of an array.

  PARTS AND PINS
    - Buzzer ............. D8
      The ZERO1 buzzer is an ACTIVE buzzer: it also sounds when the pin is
      simply HIGH. With tone() you choose the frequency (the pitch) yourself.

  EXPECTED BEHAVIOUR
    - Serial prints "Playing Frere Jacques", then the buzzer plays the 32 notes
      of "Frere Jacques" (each note is followed by 50 ms of silence).
    - The song lasts about 14.4 s, then there is a 2 s pause, and it starts again.

  TRY THIS
    - Change the durations to play faster or slower.
    - Write your own melody: add notes to the tables (both tables must have the
      same number of entries).
*/

// Frequencies of the musical notes we need, in hertz (Hz)
#define NOTE_G3 196
#define NOTE_C4 262
#define NOTE_D4 294
#define NOTE_E4 330
#define NOTE_F4 349
#define NOTE_G4 392
#define NOTE_A4 440

const int BUZZER_PIN = 8;

// The song "Frere Jacques": one entry per note
int melody[] = {
  NOTE_C4, NOTE_D4, NOTE_E4, NOTE_C4,   // Fre-re Jac-ques
  NOTE_C4, NOTE_D4, NOTE_E4, NOTE_C4,   // Fre-re Jac-ques
  NOTE_E4, NOTE_F4, NOTE_G4,            // Dor-mez vous?
  NOTE_E4, NOTE_F4, NOTE_G4,            // Dor-mez vous?
  NOTE_G4, NOTE_A4, NOTE_G4, NOTE_F4, NOTE_E4, NOTE_C4,   // Son-nez les ma-ti-nes
  NOTE_G4, NOTE_A4, NOTE_G4, NOTE_F4, NOTE_E4, NOTE_C4,   // Son-nez les ma-ti-nes
  NOTE_C4, NOTE_G3, NOTE_C4,            // Ding dang dong
  NOTE_C4, NOTE_G3, NOTE_C4             // Ding dang dong
};

// How long each note lasts, in milliseconds (same order as the melody)
int durations[] = {
  400, 400, 400, 400,
  400, 400, 400, 400,
  400, 400, 800,
  400, 400, 800,
  200, 200, 200, 200, 400, 400,
  200, 200, 200, 200, 400, 400,
  400, 400, 800,
  400, 400, 800
};

// Number of notes = size of the whole array / size of one element
const int NOTE_COUNT = sizeof(melody) / sizeof(melody[0]);

#line 64 "03_buzzer_melody.ino"
void setup();
#line 69 "03_buzzer_melody.ino"
void loop();
#line 64 "03_buzzer_melody.ino"
void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  Serial.println("Playing Frere Jacques");

  for (int i = 0; i < NOTE_COUNT; i++) {
    tone(BUZZER_PIN, melody[i]);   // start the note
    delay(durations[i]);           // let it sound
    noTone(BUZZER_PIN);            // stop it
    delay(50);                     // a short silence separates two notes
  }

  delay(2000);                     // pause before playing again
}

