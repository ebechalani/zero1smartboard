// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
Button toggle with debounce: every press of button 1 switches the red LED.
*/

const int LED_RED = A1;        // red LED
const int BUTTON_1 = 6;        // button 1

const long DEBOUNCE_MS = 50;   // the reading must stay stable this long
const int button = BUTTON_1;
const int led = LED_RED;
long button_state = 0;
long last_reading = 0;
long last_change = 0;
bool led_on = false;
long presses = 0;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(button, INPUT);
  pinMode(led, OUTPUT);
  last_change = (long)millis();
  Serial.println("Press Button 1 to toggle the red LED");
}

// Runs forever: the body of "while True:" (line 17)
void loop() {
  long reading = digitalRead(button);
  if (reading != last_reading) {
    last_change = (long)millis();   // the signal moved: restart the timer
  }
  if ((long)millis() - last_change > DEBOUNCE_MS) {
    // The reading has been steady: we can trust it.
    if (reading != button_state) {
      button_state = reading;
      if (button_state == 1) {
        led_on = !led_on;
        presses += 1;
        digitalWrite(led, led_on);
        Serial.print("Press #");
        Serial.print(presses);
        Serial.print(" -> LED ");
        Serial.println(led_on ? String("ON") : String("OFF"));
      }
    }
  }
  last_reading = reading;
}
