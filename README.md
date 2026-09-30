# ZERO1 Smart Board Simulator

A browser simulator for the **ZERO1 Smart Board**, the Arduino UNO based
educational board used in the *ICT & Robotics for STEAM education* course.
Students write ordinary Arduino C++ sketches, press **Run**, and watch a
virtual board react: LEDs, NeoPixel RGB LED, buzzer, 7-segment display,
DC motor, servo, 16x2 I2C LCD, push buttons, potentiometer / LDR, DHT22,
HC-SR04 ultrasonic sensor and the Serial Monitor.

No installation is needed for students: the simulator is a static web page.

## Features

- **Real Arduino C++** — the sketch you test in the simulator is the sketch you
  upload to the real board (same pins, same libraries: `Servo`,
  `LiquidCrystal_I2C`, `DHT`, `Adafruit_NeoPixel`, `NewPing`, `Wire`).
- **Faithful maths** — the simulator computes like the board's ATmega328P, in
  every mode: `int` is 16-bit and overflows like on the board (`int a = 60 *
  1000;` gives `-5536`, `long b = 50000; b * b` gives `-1794967296`), `byte`
  wraps at 255, `float` and `double` are 32-bit (`0.1 + 0.2 == 0.3` is true),
  `7 / 2` is `3`, `map()` truncates, `Serial.print(3.0)` prints `3.00`, and
  `abort()` stops the program. A sketch that overflows now shows the board's
  surprising result instead of the mathematically right one.
- **Interactive board** — click the buttons, turn the potentiometer, flip the
  POT/LDR switch, set the light level, temperature, humidity and distance,
  unplug the servo / ultrasonic / DHT22 modules.
- **Serial Monitor**, **Pin Map** (the lesson table with live pin states),
  **console** with error messages a student can understand, and a
  **Generated JS** tab for the curious.
- **New** starts from the same blank sketch as the Arduino IDE's
  *File > New* (or an empty blocks program), asking first if work would be
  lost (an example that was not changed never asks, even after a reload).
- **41 example sketches**, each with its expected behaviour written in the
  header comment: 21 lesson sketches grouped by Outputs, Inputs, Display and
  Projects, then 20 short part-by-part sketches grouped by LED, Buzzer, Push
  Button, RGB LED, LDR, Seven-Segment, Ultrasonic, Servo Motor, DHT Sensor
  and DC Motor (the same groups exist as block programs in Blocks mode).
- **Share ▾** — a menu: copy a link to the work, download it as an `.ino`
  file, or hand it in to the teacher (when classes are set up).
- **Classes** — teachers create a class on the teacher page and share the
  class code or link. Students choose *Share ▾ → Hand in to my teacher*, type
  the code and their first and last name, and their sketch or blocks are
  handed in. The teacher sees who handed in, runs each hand-in
  safely in the simulator and downloads the `.ino`. See
  [docs/CLASSROOM.md](docs/CLASSROOM.md) (set up once by the site maintainer,
  free Firebase plan).
- **Arduino IDE** — get the sketch (in Blocks mode, the one made from the
  blocks) into the desktop Arduino IDE to upload it to the real board:
  download it as an `.ino` file with a new name each time (the IDE opens it
  and offers to put it in a sketch folder), save it straight into the
  *Documents › Arduino* sketchbook (Chrome and Edge), or copy the code to
  paste into *File › New Sketch*. Without the IDE (Chromebooks), the Arduino
  Cloud Editor can import the downloaded file.
- **Settings ▾** — a menu with *Reset the board* (all pins and peripherals
  back to their power-on state) and *Board settings…* for the few hardware
  details that differ between board revisions (button wiring, 7-segment
  polarity and bit order, LCD address, buzzer type, LDR direction).
- **Blocks or code.** A *Blocks* mode (Google Blockly) lets beginners snap
  together board blocks such as "turn red LED on", "wait 1 second", "button 1
  is pressed?" or "LCD show … on line 1". The blocks are turned into a normal
  Arduino sketch, shown next to them and run on the same virtual board. When
  students are ready, one click switches to *Code* mode with that sketch in
  the editor to continue by hand.
- **Python mode.** A third mode (*Code | Blocks | Python*) where students write
  and run Python in MicroPython style (`Pin(LED_RED, Pin.OUT)`, `led.on()`,
  `time.sleep(0.5)`, `print()`, `input()`) on the same virtual board. The
  Python program is translated in the browser into an Arduino sketch, shown
  read-only in the Code tab: that sketch is what runs, what is handed in with
  the Python, and what goes to the Arduino IDE or the board (the UNO cannot
  run Python itself). Errors appear on the Python lines while typing, in
  Python's own words, with a hint; a *What works* dialog lists the part of
  Python that ZERO1 Python has (no classes or dictionaries yet), and the
  Examples menu has 33 Python twins of the example sketches (13 lessons and
  the 20 part-by-part worksheets), with the same behaviour. Numbers behave like on the board: whole numbers are 32-bit and
  decimal numbers print with 7 digits, like MicroPython. See
  [docs/PYTHON.md](docs/PYTHON.md).

## Pin map

| Part            | Signal      | Pin |
|-----------------|-------------|-----|
| Potentiometer / LDR (slide switch) | POT / LDR | A3 |
| Push buttons    | Button 1 / Button 2 | D6 / D7 |
| Motor driver    | IN1         | A0  |
| Servo           | signal      | D4  |
| LCD 16x2 (I2C 0x27) | SDA / SCL | A4 / A5 |
| LEDs            | RED / GREEN | A1 / A2 |
| RGB (WS2812)    | data        | D9  |
| DHT22           | data        | D5  |
| Buzzer (active) | BUZ         | D8  |
| Ultrasonic      | Echo / Trig | D2 / D3 |
| 7 segment (74HC595) | DATA / LATCH / CLK | D12 / D11 / D10 |
| UART            | TX / RX     | D0 / D1 |

See [docs/PINOUT.md](docs/PINOUT.md) for the details deduced from the board
photos, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the
simulator is built.

## Running it locally

```bash
npm install
npm run dev
```

Then open the printed URL (usually http://localhost:5173). The teacher
dashboard is `teacher.html` and the sandboxed review page `review.html` on
the same server (for example http://localhost:5173/teacher.html).

Other commands:

```bash
npm test               # unit tests (Vitest)
npm run typecheck      # TypeScript
npm run build          # static site in dist/ (with the bundle checks)
npm run preview        # serve dist/ locally
npm run test:emulator  # class platform tests on the Firebase emulators (Java 21)
npm run dev:emulator   # the site against the local emulators (npm run emulators first)
```

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys `dist/` on
every push to `main`. One-time setup in the GitHub repository:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

## How it works

1. The sketch is parsed by a small C++ parser (`src/transpiler`) that
   understands the Arduino subset students use.
2. The AST is compiled to JavaScript with the C integer semantics preserved
   (`src/transpiler/codegen.ts`), and every user function becomes `async` so
   that `delay()` and busy loops never freeze the page.
3. The generated code runs against a runtime (`src/runtime`) that emulates the
   Arduino core API and the libraries, driving a `Board` model with 20 pins.
4. Peripheral models (`src/peripherals`) listen to the board and expose their
   state; the SVG board (`src/ui/board-view.ts`) redraws from that state on
   every animation frame.
5. In Blocks mode, `src/blocks` defines the ZERO1 blocks and an Arduino code
   generator; the generated sketch enters the same pipeline at step 1. See
   [docs/BLOCKS.md](docs/BLOCKS.md).
6. In Python mode, `src/python` translates the Python program (tokenizer,
   parser, data-flow analysis, checks, emitter) into an Arduino sketch and a
   line map; the sketch enters the same pipeline at step 1, and run-time
   messages are shown on the Python lines. See [docs/PYTHON.md](docs/PYTHON.md).

## Hardware assumptions you can change in Settings

| Setting | Default | Why |
|---------|---------|-----|
| Button wiring | pull-down (pressed = HIGH) | Each button has a series resistor on the board, but the schematic is not published. |
| 7-segment | common cathode, Q0 = a | Standard 74HC595 wiring used in the lesson digit table. |
| LCD address | 0x27 | The board carries a PCF8574T expander. |
| Buzzer | active | The on-board part has a `+` marking. |
| LDR | brighter = higher reading | Usual LDR-on-top voltage divider. |

## Licence

MIT.
