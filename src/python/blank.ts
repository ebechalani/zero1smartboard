/**
 * What "New" puts in the Python editor (docs/PYTHON.md §7.7): the imports every board program
 * starts with, a place for the lines that run once, and the main loop.
 */
export const BLANK_PYTHON = `from machine import Pin
from zero1 import *   # ZERO1 names: LED_RED, BUTTON_1, BUZZER, …
import time

# Code here runs once, when the board starts.


while True:
    # Code here runs again and again, forever.
    pass
`;
