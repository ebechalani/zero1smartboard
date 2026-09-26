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
- **Faithful integer maths** — `int` is 16-bit, `byte` wraps at 255, `7 / 2`
  is `3`, `map()` truncates, `Serial.print(3.0)` prints `3.00`.
- **Interactive board** — click the buttons, turn the potentiometer, flip the
  POT/LDR switch, set the light level, temperature, humidity and distance,
  unplug the servo / ultrasonic / DHT22 modules.
- **Serial Monitor**, **Pin Map** (the lesson table with live pin states),
  **console** with error messages a student can understand, and a
  **Generated JS** tab for the curious.
- **New** starts from the same blank sketch as the Arduino IDE's
  *File > New* (or an empty blocks program), asking first if work would be
  lost.
- **21 example sketches** grouped by Outputs, Inputs, Display and Projects,
  each with its expected behaviour written in the header comment.
- **Share** — copy a link that opens the work in the simulator, send it to
  the teacher by email (type the teacher's address once; Gmail, Outlook or
  the computer's email app opens a ready-to-send email with the link and the
  Arduino code — nothing is sent until the student presses Send), or
  download the sketch as an `.ino` file for the Arduino IDE.
- **Settings** for the few hardware details that differ between board
  revisions (button wiring, 7-segment polarity and bit order, LCD address,
  buzzer type, LDR direction).
- **Blocks or code.** A *Blocks* mode (Google Blockly) lets beginners snap
  together board blocks such as "turn red LED on", "wait 1 second", "button 1
  is pressed?" or "LCD show … on line 1". The blocks are turned into a normal
  Arduino sketch, shown next to them and run on the same virtual board. When
  students are ready, one click switches to *Code* mode with that sketch in
  the editor to continue by hand.

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

Then open the printed URL (usually http://localhost:5173).

Other commands:

```bash
npm test            # unit tests (Vitest)
npm run typecheck   # TypeScript
npm run build       # static site in dist/
npm run preview     # serve dist/ locally
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
