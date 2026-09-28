# ZERO1 Smart Board — example sketches (lesson index)

Every sketch in this folder is a complete Arduino program for the ZERO1 Smart
Board. They are written for students aged 13–16: one idea per sketch, named
constants for the pins at the top, short comments, and a header block that
states exactly what should happen (the **expected behaviour**) so that a
teacher — or an automated test — can check it.

All sketches use the fixed ZERO1 pin map (see `docs/PINOUT.md`):

| Part | Pin | Notes |
|------|-----|-------|
| Red LED / Green LED | A1 / A2 | on/off only (no PWM on A1/A2) |
| RGB LED | D9 | NeoPixel (WS2812), `Adafruit_NeoPixel pixels(1, 9, NEO_GRB + NEO_KHZ800)` |
| Buzzer | D8 | **active** buzzer: sounds on HIGH, `tone()` also works |
| 7-segment | DATA D12, LATCH D11, CLOCK D10 | 74HC595, `shiftOut(12, 10, MSBFIRST, pattern)` then latch D11; common cathode, bit0 = a … bit6 = g, bit7 = dp; digits `0x3F 0x06 0x5B 0x4F 0x66 0x6D 0x7D 0x07 0x7F 0x6F` |
| DC motor (driver IN1) | A0 | on/off only |
| Servo | D4 | external header, `Servo.h` |
| Potentiometer / LDR | A3 | shared: the **POT / LDR slide switch** selects which one is read |
| Buttons 1 / 2 | D6 / D7 | pressed = HIGH (pull-down wiring, changeable in Settings) |
| DHT22 | D5 | external header, `DHT dht(5, DHT22)` |
| Ultrasonic HC-SR04 | TRIG D3, ECHO D2 | external header |
| LCD 16x2 | SDA A4, SCL A5 | I2C address **0x27**, `lcd.init()` then `lcd.backlight()` |
| Built-in L LED | D13 | `LED_BUILTIN` |

Suggested order: Outputs → Inputs → Display → Projects. The sketches marked
*millis()* introduce non-blocking timing ("blink without delay"). The
part-by-part groups that follow (40–59) are shorter one-idea sketches, one
or two per part of the board, that can be used in any order.

## Outputs

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 01 | `01_blink_red.ino` | `setup()` / `loop()`, `pinMode`, `digitalWrite`, `delay` | Red LED on 500 ms / off 500 ms (1 Hz); Serial prints `ON` / `OFF` at each change. |
| 02 | `02_traffic_lights.ino` | Several outputs, a function with parameters, `for` loop, `LED_BUILTIN` | Red ON + L ON for 2 s (`RED`), green ON + L OFF for 2 s (`GREEN`), then green blinks 3× (200 ms off / 200 ms on). Cycle = 5.2 s. |
| 03 | `03_buzzer_melody.ino` | `tone()` / `noTone()`, arrays, `#define`, `sizeof` | Plays the 32 notes of "Frère Jacques" (≈ 14.4 s, 50 ms silence between notes), pauses 2 s, repeats; Serial prints `Playing Frere Jacques`. |
| 04 | `04_rgb_rainbow.ino` | NeoPixel library, hue, `ColorHSV()`, `gamma32()` | RGB LED cycles red → yellow → green → cyan → blue → magenta → red in ≈ 2.6 s (256 steps of 10 ms), brightness 80. |
| 05 | `05_seven_segment_counter.ino` | 74HC595, `shiftOut()`, lookup table, hex | Display counts 0…9, one digit per second, then restarts; Serial prints each digit. |
| 06 | `06_servo_sweep.ino` | Servo library, `attach()` / `write()`, counting up and down | Servo sweeps 0 → 180° in ≈ 2.7 s (181 × 15 ms) then 180 → 0°; Serial prints `Sweeping 0 -> 180` / `Sweeping 180 -> 0`. |
| 07 | `07_dc_motor.ino` *millis()* | Motor is on/off via A0; "blink without delay" | Motor ON 2 s / OFF 2 s (starts ON), Serial prints `Motor ON` / `Motor OFF`; meanwhile the L LED toggles every 250 ms without interruption. |

## Inputs

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 10 | `10_button_led.ino` | `digitalRead()`, `if / else`, pressed = HIGH | Red LED on while Button 1 is held; green LED on while Button 2 is held. |
| 11 | `11_button_toggle.ino` *millis()* | Edge detection, debouncing (official Arduino method), global state | Each press of Button 1 toggles the red LED; Serial prints `Press #1 -> LED ON`, `Press #2 -> LED OFF`, … Holding does not re-toggle. |
| 12 | `12_potentiometer_serial.ino` | `analogRead()` (0..1023), float voltage, `map()` | Every 200 ms: `Value: 512  Voltage: 2.50 V  Percent: 50 %` (knob centred). Switch on **POT**. |
| 13 | `13_ldr_night_light.ino` | Light sensor, threshold | Every 200 ms prints `Light: <adc>`; red LED ON with `-> dark, light ON` when adc < 400 (light slider < 40 %), else OFF with `-> bright, light OFF`. Switch on **LDR**. |
| 14 | `14_dht22_serial.ino` | DHT library, `float`, `isnan()` | Every 2 s: `Temperature: 24.0 C   Humidity: 55.0 %`; if unplugged: `Error: no answer from the DHT22 (is it plugged in?)`. |
| 15 | `15_ultrasonic_distance.ino` | Trig pulse, `pulseIn()`, speed of sound, a function returning `float` | Every 500 ms: `Distance: 49.7 cm` for a 50 cm obstacle (58 µs/cm × 0.0343 / 2); `No echo (is the sensor plugged in?)` when unplugged. |
| 16 | `16_serial_echo.ino` | `Serial.available()`, `readStringUntil('\n')`, `String` helpers, `==` | Prints `Type 'on' or 'off' and press Send`; typing `on` → `You typed: on`, `Red LED is ON` (LED lights); `off` → LED off; anything else → `Unknown command. Try 'on' or 'off'.` |

## Display

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 20 | `20_lcd_hello.ino` *millis()* | `LiquidCrystal_I2C` at 0x27: `init()`, `backlight()`, `setCursor()`, `print()` | Row 1 `Hello, ZERO1!`; row 2 `Time: N s` where N grows by 1 every second; backlight on. |
| 21 | `21_lcd_custom_char.ino` | `createChar()`, `write()`, 5×8 bitmaps, degree symbol (code 223), DHT22 | Row 1 `Temp: 24.0°C` (refreshed every 2 s, `--.-` if unplugged); row 2 `I ♥ ZERO1` with the heart alternating small / big every 500 ms. |

## Projects

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 30 | `30_parking_sensor.ino` *millis()* | Sensor + two outputs, zones, `map()` → beep interval, `tone(pin, f, duration)` | > 100 cm: green, silent. 30–100 cm: orange, 60 ms beeps at 2000 Hz every 1000 ms (100 cm) … 380 ms (50 cm) … 150 ms (30 cm). < 30 cm: red, continuous 2000 Hz. No echo: dim blue, silent. Serial every 500 ms: `Distance: 49.7 cm -> beep every 380 ms`. |
| 31 | `31_greenhouse.ino` *millis()* | Measure / decide / act / inform; two independent timers | LCD `T:24.0C H:55%` + `OK: fan OFF` (≤ 28 °C); `Warm: fan ON` + motor running (> 28 °C); `TOO HOT! Fan ON` + motor + red LED blinking 300 ms (> 35 °C); `Sensor error!` / `Check the DHT22` when unplugged. Serial every 2 s: `T=24.0C  H=55%  fan=OFF`. |
| 32 | `32_reaction_game.ino` *millis()* | Game sequence, `random()` / `randomSeed()`, measuring a duration, `while`, early `return` | `Press Button 1 to start...`; press 1 → display counts 3, 2, 1 (beeps); blank for 1–3 s (pressing Button 2 now: red LED 1.5 s, low tone, `Too early! You lose this round.`); then display `8` + green LED + beep; press Button 2 → `Your reaction time: <ms> ms`, `New record!`, `Best time: <ms> ms`; display shows tenths of a second (max 9) for 3 s. |
| 33 | `33_dimmer.ino` | One input → three outputs, `map()` to several ranges, print on change | Knob → servo 0–180°, warm-orange RGB brightness 0–255, 7-segment level 0–9. Knob centred (512): `Pot: 512  Servo: 90 deg  Brightness: 127  Level: 4`; a new line whenever the level changes. Switch on **POT**. |
| 34 | `34_i2c_scanner.ino` | I2C bus, addresses, `Wire.endTransmission()`, printing in HEX | `I2C scanner`, then every 5 s: `Scanning...`, `I2C device found at address 0x27`, `Done: 1 device(s)`; `No I2C devices found` if nothing answers. |

## LED

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 40 | `40_led_blink_red.ino` | The simplest program: HIGH, wait, LOW, wait | Red LED 500 ms on / 500 ms off, forever. |
| 41 | `41_led_red_green.ino` | Two outputs; switch the old one off before the new one on | Red 500 ms, then green 500 ms, forever; never both on. |
| 42 | `42_led_blink_10_times.ino` | `for` loop; code in `setup()` runs once | Red LED blinks exactly 10× (300 ms / 300 ms) then stays off; Serial `Blink 1` … `Blink 10`, `Done`. |

## Buzzer

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 43 | `43_buzzer_short_beeps.ino` | Active buzzer = HIGH sounds, like an LED | 100 ms beep, 400 ms silence, forever (two beeps per second). |
| 44 | `44_buzzer_led_10_times.ino` | Counting with a `for` loop; two outputs together; a small function | Exactly 10× red LED + buzzer on 200 ms, off 300 ms; then both off; Serial `Done`. |

## Push Button

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 45 | `45_buttons_leds.ino` | `digitalRead()`, `if / else`, two inputs in one `loop()` | Red LED on while Button 1 (D6) is held; green LED on while Button 2 (D7) is held. |
| 46 | `46_buttons_beeps.ino` | Input triggers output; a function parameter sets the length; waiting for the release | Button 1 → one 100 ms beep, Button 2 → one 1 s beep; holding a button does not repeat. |

## RGB LED

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 47 | `47_rgb_red_green_blue.ino` | NeoPixel, `Color(r, g, b)`, `setPixelColor()` + `show()` | Red 1 s → green 1 s → blue 1 s, forever (brightness 80). |
| 48 | `48_rgb_buttons.ino` | `if / else if / else` | Button 1 held → red, Button 2 held → green, none → off; Button 1 wins when both are pressed. |

## LDR

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 49 | `49_ldr_serial.ino` | `analogRead()` on a light sensor | Every 500 ms `Light: 580` (light 60 %). Switch on **LDR**. |
| 50 | `50_ldr_red_green.ino` | Threshold, two LEDs | Every 500 ms: `Light: 220 -> dark` + red LED below 500; `Light: 580 -> bright` + green LED at 500 or above. Switch on **LDR**. |

## Seven-Segment

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 51 | `51_seg_buttons_count.ino` | 74HC595 + `shiftOut()`, digit table, `for` loops counting up (`n++`) and down (`n--`) | Blank; Button 1 → 1, 2, 3, 4 (one per second) then blank; Button 2 → 7, 6, 5, 4, 3, 2, 1 then blank; Serial prints each digit. |

## Ultrasonic

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 52 | `52_ultrasonic_serial.ino` | TRIG pulse, `pulseIn()`, cm formula | Every 500 ms `Distance: 49.7 cm` (50 cm obstacle). |
| 53 | `53_ultrasonic_red_green.ino` | Threshold on a measurement, two LEDs | Every 500 ms `Distance: 49.7 cm -> free` + green LED at 10 cm or more; `-> too close!` + red LED under 10 cm. |
| 54 | `54_ultrasonic_beep_rate.ino` | Measurement as a number: 10 ms per cm, `constrain()` | 50 ms beeps; pause = distance × 10 ms kept between 50 and 1000 ms: `Distance: 49.7 cm -> pause 497 ms`; `No echo` when unplugged. |

## Servo Motor

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 55 | `55_servo_buttons.ino` | Servo library, button → position, a small function, waiting for the release | Starts at 0°; Button 1 → 0° (`Servo -> 0`), Button 2 → 90° (`Servo -> 90`); one move and one line per press, holding does not repeat. |
| 56 | `56_servo_ultrasonic_10_times.ino` | Sensor decides for an actuator, `for` loop of 10 rounds | 10× one per second: `Round i: 49.7 cm -> servo 0` (or `servo 180` under 10 cm), then back to 0° and `Done`. |

## DHT Sensor

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 57 | `57_dht_serial.ino` | DHT library, `float`, `isnan()` | Every 2 s `Temperature: 24.0 C  Humidity: 55.0 %`; `DHT22 error (is it plugged in?)` when unplugged. |
| 58 | `58_dht_servo_slow.ino` | Moving a servo slowly (one degree per step) with a `for` loop | Every 2 s the temperature; > 28 °C → `Too warm: opening` and the servo turns 0 → 180° at 15 ms/degree (≈ 2.7 s), again after each warm reading; otherwise `OK: closed`, servo 0°. |

## DC Motor

| # | File | What it teaches | Expected behaviour |
|---|------|-----------------|--------------------|
| 59 | `59_motor_buttons.ino` | Motor on/off via A0, `for` loops started by the buttons, a function with a parameter; why the board cannot reverse the motor (only IN1 is wired) | Button 1 → 5 runs of 500 ms with 500 ms stops (`Short run 1` … `Short run 5`); Button 2 → 5 runs of 1 s with 1 s stops (`Long run 1` … `Long run 5`); then `Done`. |

## Conventions used in every sketch

- Header comment: title, **WHAT IT TEACHES**, **PARTS AND PINS**, **EXPECTED
  BEHAVIOUR**, **TRY THIS**.
- Pins are `const int` constants at the top (`const int LED_RED = A1;`).
- Only the language subset supported by the simulator (`docs/ARCHITECTURE.md`
  §4.2): no structs, pointers, templates, function-like macros or `#ifdef`.
- Braces on every `if` / `for` / `while`, even for one line.
- Serial always at 9600 baud.
- `src/examples/index.ts` lists the sketches for the Examples menu
  (`EXAMPLES`, `EXAMPLE_GROUPS`, `findExample(id)`); the id is the file name
  without extension.
