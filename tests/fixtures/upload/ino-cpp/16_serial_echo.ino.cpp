#include <Arduino.h>
#line 1 "16_serial_echo.ino"
/*
  ZERO1 Smart Board - 16 Serial echo and commands
  -----------------------------------------------
  WHAT IT TEACHES
    - The Serial Monitor works in both directions: the board can also READ
      what you type.
    - Serial.available() tells if something arrived; readStringUntil('\n')
      reads one whole line into a String.
    - String helpers: trim() removes spaces and end-of-line characters,
      toLowerCase() so that "ON" and "on" mean the same thing.
    - Comparing Strings with == and choosing with if / else if / else.

  PARTS AND PINS
    - Serial Monitor ..... USB (9600 baud). Keep the line ending on "Newline".
    - Red LED ............ A1

  EXPECTED BEHAVIOUR
    - At start Serial prints: Type 'on' or 'off' and press Send
    - Type on   -> prints "You typed: on"  then "Red LED is ON",  the red LED lights.
    - Type off  -> prints "You typed: off" then "Red LED is OFF", the LED goes off.
    - Type hello -> prints "You typed: hello" then "Unknown command. Try 'on' or 'off'."

  TRY THIS
    - Add a "blink" command that blinks the LED 3 times.
    - Add "green on" / "green off" for the green LED (A2).
*/

const int LED_RED = A1;

#line 30 "16_serial_echo.ino"
void setup();
#line 36 "16_serial_echo.ino"
void loop();
#line 30 "16_serial_echo.ino"
void setup() {
  pinMode(LED_RED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Type 'on' or 'off' and press Send");
}

void loop() {
  // Is there something to read?
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');   // read up to the end of the line
    command.trim();          // remove spaces, \r and \n around the text
    command.toLowerCase();   // "ON" becomes "on"

    Serial.print("You typed: ");
    Serial.println(command);

    if (command == "on") {
      digitalWrite(LED_RED, HIGH);
      Serial.println("Red LED is ON");
    } else if (command == "off") {
      digitalWrite(LED_RED, LOW);
      Serial.println("Red LED is OFF");
    } else {
      Serial.println("Unknown command. Try 'on' or 'off'.");
    }
  }
}

