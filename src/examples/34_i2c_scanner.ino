/*
  ZERO1 Smart Board - 34 I2C scanner (project)
  --------------------------------------------
  WHAT IT TEACHES
    - I2C is a bus: several devices share the same two wires (SDA and SCL)
      and each one has an address between 1 and 127.
    - How to find the address of a device: try to talk to every address and
      note which ones answer. Wire.endTransmission() returns 0 when a device
      acknowledged.
    - Printing a number in hexadecimal: Serial.println(address, HEX).
    - This is the classic tool to run when an LCD "does not work": it tells
      you whether the address is 0x27 or 0x3F.

  PARTS AND PINS
    - LCD 16x2 backpack .. SDA = A4, SCL = A5 (the only I2C device on the board)

  EXPECTED BEHAVIOUR
    - Serial prints "I2C scanner", then every 5 s:
        Scanning...
        I2C device found at address 0x27
        Done: 1 device(s)
    - If nothing answers it prints "No I2C devices found".

  TRY THIS
    - Print the address in decimal too (Serial.println(address) gives 39).
    - Change the delay to scan more often.
*/

#include <Wire.h>

void setup() {
  Wire.begin();
  Serial.begin(9600);
  Serial.println("I2C scanner");
}

void loop() {
  int found = 0;
  Serial.println("Scanning...");

  for (byte address = 1; address < 127; address++) {
    // Try to talk to this address. endTransmission() returns 0 if a device answered.
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("I2C device found at address 0x");
      if (address < 16) {
        Serial.print("0");   // keep two digits: 0x07, not 0x7
      }
      Serial.println(address, HEX);
      found++;
    }
  }

  if (found == 0) {
    Serial.println("No I2C devices found");
  } else {
    Serial.print("Done: ");
    Serial.print(found);
    Serial.println(" device(s)");
  }

  delay(5000);   // scan again in 5 s
}
