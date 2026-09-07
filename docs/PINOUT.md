# ZERO1 Smart Board — pinout and physical layout

The ZERO1 Smart Board ("The board for inspiration", zero1.education) is an
educational board built around an **Arduino UNO** (ATmega328P, DIP, 16 MHz).
All peripherals are hard-wired to fixed UNO pins. This file is the reference
used by the simulator; it comes from the lesson sheet "Create the bridge" and
photos of the physical board.

## Pin table (from the lesson sheet)

| Sr.No | Part            | Description | Pin  | Arduino pin number |
|------:|-----------------|-------------|------|--------------------|
| 1     | Potentiometer   | POT         | A3   | 17                 |
| 2     | LDR sensor      | LDR         | A3   | 17                 |
| 3     | Push button     | A (Button 1)| D6   | 6                  |
| 4     | Push button     | B (Button 2)| D7   | 7                  |
| 5     | Driver          | IN1         | A0   | 14                 |
| 6     | Servo motor     | Servo       | D4   | 4                  |
| 7     | LCD             | SDA         | A4   | 18                 |
| 8     | LCD             | SCL         | A5   | 19                 |
| 9     | LEDs            | LED RED     | A1   | 15                 |
| 10    | LEDs            | LED GREEN   | A2   | 16                 |
| 11    | LEDs            | RGB         | D9   | 9                  |
| 12    | Humidity sensor | DHT22       | D5   | 5                  |
| 13    | Buzzer          | BUZ         | D8   | 8                  |
| 14    | Ultrasonic      | Echo        | D2   | 2                  |
| 15    | Ultrasonic      | Trig        | D3   | 3                  |
| 16    | 7 Segment       | DATA        | D12  | 12                 |
| 17    | 7 Segment       | LATCH       | D11  | 11                 |
| 18    | 7 Segment       | CLK         | D10  | 10                 |
| 19    | UART            | TX          | D0   | 0                  |
| 20    | UART            | RX          | D1   | 1                  |

Pin 13 is the UNO's built-in "L" LED (LED_BUILTIN) and is also simulated.

## What each part really is (deduced from the board photos)

- **Potentiometer / LDR share A3.** A slide switch labelled `POT` / `LDR`
  (silkscreen next to the potentiometer) selects which one feeds A3. Only one
  can be read at a time.
- **Buttons** are 12 mm tactile switches with an SMD resistor next to each.
  Pull-up vs pull-down is not documented; the simulator defaults to
  *pull-down (pressed = HIGH)* and lets the teacher switch this in Settings.
- **Motor driver** is a 16-pin H-bridge IC (L293D class) with a bulk capacitor;
  only `IN1` is exposed (A0). A 2-pin green screw terminal labelled `MOTOR`
  takes an external DC motor. A0 is not PWM capable on the UNO, so the motor is
  on/off only (`analogWrite(A0, x)` behaves like the real UNO: HIGH if x > 127).
- **Servo, Ultrasonic, DHT22** are 3/4/3-pin male headers along the top edge
  for plug-in modules (SG90 servo, HC-SR04, DHT22). They can be "unplugged" in
  the simulator.
- **LCD 16x2** with an on-board **PCF8574T** I2C expander → address **0x27**.
  There is a `LCD CONTRAST` trimmer and a physical `Backlight` slide switch in
  series with the software backlight.
- **RGB** is a single 4-pad 5050 LED on ONE data pin (D9) → a **WS2812B
  (NeoPixel)** addressable LED. It is driven with the Adafruit_NeoPixel API.
- **RED / GREEN** are single SMD LEDs with series resistors on A1 / A2 (used as
  digital outputs; `analogWrite` on them gives on/off only).
- **Buzzer** is a 12 mm cylindrical part with a `+` marking and the usual
  "remove after washing" sticker → an **active** buzzer. It sounds when D8 is
  HIGH, and `tone()` also works (you hear the tone's frequency).
- **7 Segment** is one common-cathode-style digit driven by a **74HC595**
  shift register (DATA = D12, CLK = D10, LATCH = D11), i.e. `shiftOut()`.
  Bit order assumed: Q0..Q6 = segments a..g, Q7 = decimal point, 1 = lit.
  Both assumptions are switchable in Settings.
- **UART** D0/D1 go to the USB-serial chip → the Serial Monitor.

## Physical layout (landscape, as printed on the lesson sheet)

The PCB is a purple rectangle, roughly 2:1 landscape, white silkscreen.
Coordinates below are fractions of the board width (x) and height (y),
origin top-left, so the SVG can reproduce the arrangement.

```
+------------------------------------------------------------------------------+
| (UNO section, rounded outline)              ZERO1 logo + slogan       (bulb) |
|  ATmega328P DIP, crystal, reset button,     "ICT & ROBOTICS FOR STEAM EDUC." |
|  USB-B jack, CH340, 6-pin header            "Shaping Tomorrow with IoT,AI&ML"|
|                                             THE BOARD FOR INSPIRATION        |
|  power: 9V DC jack, regulator, caps,   +----------+-------+------+--------+ |
|  ON-OFF switch, LCD CONTRAST trimmer,  | POT/LDR  | 7 Seg | BUZZ | Motor  |M|
|  Backlight switch                      | switch   |  [8]  | (o)  | Driver |O|
|                                        | pot  LDR |  IC   |      |  IC    |T|
|  +----------------------------------+  +----------+-------+------+--------+O|
|  | LCD 16x2 (green, 16 pin header)  |  | RGB  RED  GREEN  | Button1 Button2 |S|
|  |                                  |  | (*)  (*)  (*)    |  (O)     (O)    |E|
|  +----------------------------------+  +------------------+-----------------+R|
|                                        SERVO  ULTRASONIC  DHT22 headers  → |
+------------------------------------------------------------------------------+
```

Approximate placements (x, y, w, h as fractions):

| Element                  | x    | y    | w    | h    |
|--------------------------|------|------|------|------|
| UNO section outline      | 0.02 | 0.05 | 0.40 | 0.42 |
| LCD 16x2                 | 0.02 | 0.55 | 0.40 | 0.38 |
| Power/contrast/backlight | 0.30 | 0.30 | 0.12 | 0.22 |
| ZERO1 logo               | 0.55 | 0.05 | 0.30 | 0.25 |
| Module grid row 1        | 0.44 | 0.42 | 0.48 | 0.24 |
| Module grid row 2        | 0.44 | 0.68 | 0.48 | 0.24 |
| Right edge headers       | 0.94 | 0.42 | 0.05 | 0.50 |

Row 1 cells (left→right): POT/LDR (with `POT`/`LDR` slide switch at the top,
potentiometer knob left, LDR right), `7 Segment` (digit + 16-pin IC below),
`BUZZER` (round), `Motor Driver` (IC + capacitor). Right edge, top: green
2-pin `MOTOR` screw terminal.
Row 2 cells: `RGB` `RED` `GREEN` LEDs (small squares in a row), then
`Button 1` and `Button 2` (large round tactile buttons).
Right edge column (vertical labels, top→bottom): `SERVO` (3 pins),
`ULTRASONIC` (4 pins), `DHT22` (3 pins).

Colours: PCB `#4b2a7b` (purple), silkscreen `#ffffff`, LCD glass
`#8fbf3f`/`#a4d65e` (yellow-green backlight) with dark `#1b3d1a` characters,
copper pads `#d4af37`, 7-segment digit red `#ff3b30` on `#2a0a0a`.
