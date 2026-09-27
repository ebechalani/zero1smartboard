# tools/arduino-libs — the ZERO1 replacements for two Arduino libraries

Two of the libraries the ZERO1 lessons use cannot be redistributed from our
web site: **LiquidCrystal I2C 1.1.2** (Frank de Brabander) has no licence at
all, and **NewPing 1.9.7** (Tim Eckel) forbids derivative works. The simulator's
"Upload to board" feature ships precompiled libraries with the site, so both are
replaced here by MIT-licensed libraries **with the same class and method names**
(written from the HD44780 / PCF8574 / HC-SR04 datasheets, not from the
original code). A sketch that compiles against the originals in the Arduino IDE
compiles against these and behaves the same on the board.

| Folder | Replaces | API kept | Not provided |
|---|---|---|---|
| `LiquidCrystal_I2C/` | LiquidCrystal I2C 1.1.2 | constructor, `init`, `begin`, `clear`, `home`, `setCursor`, `print`/`write`, `backlight`/`noBacklight`/`setBacklight`, `display`/`noDisplay`, `cursor`/`noCursor`, `blink`/`noBlink`, `createChar` (RAM and PROGMEM), scroll/autoscroll/direction, `command`, the `*_on`/`*_off` aliases, `printstr`, and the no-op stubs the original declared | nothing |
| `NewPing/` | NewPing 1.9.7 | constructor, `ping`, `ping_cm`, `ping_in`, `ping_median`, `convert_cm`, `convert_in`, the constants | the timer-interrupt API (`ping_timer`, `check_timer`, `timer_us`, `timer_ms`, `timer_stop`) |

`tools/build-toolchain-bundle.mjs` compiles them (with the official Arduino
flags) into `public/toolchain/bundle/libs/*.a`; the tests in
`tests-hardware-sim/` compile the LCD and ultrasonic example sketches with
them and run the result on an emulated ATmega328P (avr8js), checking the LCD
screens and the printed distances against the traces recorded with the
original libraries.
