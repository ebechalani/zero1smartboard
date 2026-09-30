"""Buzzer melody: Frere Jacques."""
from zero1 import Buzzer
import time

NOTE_G3 = 196
NOTE_C4 = 262
NOTE_D4 = 294
NOTE_E4 = 330
NOTE_F4 = 349
NOTE_G4 = 392
NOTE_A4 = 440

# The song: one entry per note, and how long each lasts in milliseconds
MELODY = [NOTE_C4, NOTE_D4, NOTE_E4, NOTE_C4, NOTE_C4, NOTE_D4, NOTE_E4, NOTE_C4,
          NOTE_E4, NOTE_F4, NOTE_G4, NOTE_E4, NOTE_F4, NOTE_G4,
          NOTE_C4, NOTE_G3, NOTE_C4, NOTE_C4, NOTE_G3, NOTE_C4]
DURATIONS = [400, 400, 400, 400, 400, 400, 400, 400,
             400, 400, 800, 400, 400, 800,
             400, 400, 800, 400, 400, 800]

buzzer = Buzzer()

while True:
    print("Playing Frere Jacques")
    for i in range(len(MELODY)):
        buzzer.tone(MELODY[i])       # start the note
        time.sleep_ms(DURATIONS[i])  # let it sound
        buzzer.no_tone()
        time.sleep_ms(50)            # a short silence between two notes
    time.sleep(2)
