"""
ZERO1 Smart Board - 03 Buzzer melody
------------------------------------
WHAT IT TEACHES
  - buzzer.tone(frequency) makes the buzzer sing a note; buzzer.no_tone()
    stops it.
  - Storing a melody in two lists: the notes and how long each one lasts.
  - A name in capitals (NOTE_C4 = 262) is a constant: a name for a number.
  - len(MELODY) counts the items of a list; MELODY[i] is item number i.

PARTS AND PINS
  - Buzzer ............. D8  (BUZZER)
    The ZERO1 buzzer is an ACTIVE buzzer: it also sounds when the pin is
    simply on. With buzzer.tone() you choose the frequency (the pitch) yourself.

EXPECTED BEHAVIOUR
  - print() shows "Playing Frere Jacques", then the buzzer plays the 32 notes
    of "Frere Jacques" (each note is followed by 50 ms of silence).
  - The song lasts about 14.4 s, then there is a 2 s pause, and it starts again.

TRY THIS
  - Change the durations to play faster or slower.
  - Write your own melody: add notes to the lists (both lists must have the
    same number of items).
"""
from zero1 import Buzzer
import time

# Frequencies of the musical notes we need, in hertz (Hz)
NOTE_G3 = 196
NOTE_C4 = 262
NOTE_D4 = 294
NOTE_E4 = 330
NOTE_F4 = 349
NOTE_G4 = 392
NOTE_A4 = 440

# The song "Frere Jacques": one item per note
MELODY = [
    NOTE_C4, NOTE_D4, NOTE_E4, NOTE_C4,
    NOTE_C4, NOTE_D4, NOTE_E4, NOTE_C4,
    NOTE_E4, NOTE_F4, NOTE_G4,
    NOTE_E4, NOTE_F4, NOTE_G4,
    NOTE_G4, NOTE_A4, NOTE_G4, NOTE_F4, NOTE_E4, NOTE_C4,
    NOTE_G4, NOTE_A4, NOTE_G4, NOTE_F4, NOTE_E4, NOTE_C4,
    NOTE_C4, NOTE_G3, NOTE_C4,
    NOTE_C4, NOTE_G3, NOTE_C4,
]

# How long each note lasts, in milliseconds (same order as the melody)
DURATIONS = [
    400, 400, 400, 400,
    400, 400, 400, 400,
    400, 400, 800,
    400, 400, 800,
    200, 200, 200, 200, 400, 400,
    200, 200, 200, 200, 400, 400,
    400, 400, 800,
    400, 400, 800,
]

buzzer = Buzzer()

while True:
    print("Playing Frere Jacques")

    for i in range(len(MELODY)):
        buzzer.tone(MELODY[i])         # start the note
        time.sleep_ms(DURATIONS[i])    # let it sound
        buzzer.no_tone()               # stop it
        time.sleep_ms(50)              # a short silence separates two notes

    time.sleep(2)                      # pause before playing again
