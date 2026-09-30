"""
ZERO1 Smart Board - 16 Serial echo and commands
-----------------------------------------------
WHAT IT TEACHES
  - The Serial Monitor works in both directions: the board can also READ
    what you type.
  - input() waits until you send one whole line and gives it as text; the
    Serial Monitor also shows the line you typed.
  - Text methods: strip() removes spaces around the text, lower() so that
    "ON" and "on" mean the same thing.
  - Comparing texts with == and choosing with if / elif / else.
  - try / except ValueError: int(text) reads a whole number, and the except
    part runs when the text is not one.

PARTS AND PINS
  - Serial Monitor ..... USB (9600 baud). Python mode sends "Newline" at the
    end of every line.
  - Red LED ............ A1  (LED_RED)

EXPECTED BEHAVIOUR
  - At start print() shows: Type 'on' or 'off' and press Send
  - Type on   -> shows "on", "You typed: on", then "Red LED is ON", the red LED lights.
  - Type off  -> shows "off", "You typed: off", then "Red LED is OFF", the LED goes off.
  - Type hello -> shows "hello", "You typed: hello", then
    "Unknown command. Try 'on' or 'off'."
  - Type a whole number such as 3 -> the red LED blinks 3 times (200 ms on,
    200 ms off), then "Blinked 3 times" and the LED is off.

TRY THIS
  - Add a "toggle" command that switches the LED to the other state.
  - Add "green on" / "green off" for the green LED (LED_GREEN).
"""
from machine import Pin
from zero1 import LED_RED
import time

led = Pin(LED_RED, Pin.OUT)
print("Type 'on' or 'off' and press Send")

while True:
    command = input().strip().lower()    # waits for one line; "ON " becomes "on"
    print("You typed:", command)

    if command == "on":
        led.on()
        print("Red LED is ON")
    elif command == "off":
        led.off()
        print("Red LED is OFF")
    else:
        try:
            times = int(command)         # a whole number: blink that many times
        except ValueError:
            print("Unknown command. Try 'on' or 'off'.")
        else:
            for _ in range(times):
                led.on()
                time.sleep(0.2)
                led.off()
                time.sleep(0.2)
            print(f"Blinked {times} times")
