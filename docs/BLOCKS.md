# Block programming (`src/blocks`, `src/ui/blocks-panel.ts`)

Section 11 of the architecture. Students can program with **blocks** (Google
Blockly 12, `npm: blockly`) instead of text. The blocks generate an **Arduino
C++ sketch** which then goes through the very same `transpile()` → `Executor`
path as hand-written code. The generated sketch is shown to the student and
must read like a sketch a teacher would write (named pin constants, comments,
2-space indentation), because it is what they will later copy into the
Arduino IDE.

## 11.1 Public API of `src/blocks` (owner: blocks)

```ts
// src/blocks/index.ts
export function registerZero1Blocks(): void;               // defines every z1_* block; idempotent
export class ArduinoGenerator extends Blockly.CodeGenerator {}
export const arduinoGenerator: ArduinoGenerator;           // workspaceToCode(ws) → full sketch text
export function workspaceToArduino(ws: Blockly.Workspace): string; // registerZero1Blocks() + generate
export const TOOLBOX: Blockly.utils.toolbox.ToolboxDefinition;     // category toolbox (§11.2 order)
export const ZERO1_THEME: Blockly.Theme;                   // light theme matching the app
export const DEFAULT_WORKSPACE: object;                    // serialization JSON: one setup hat + one loop hat
export interface BlockExample { id: string; title: string; group: string; description: string; workspace: object; }
export const BLOCK_EXAMPLES: BlockExample[];               // §11.6
```

Files: `index.ts`, `blocks.ts` (definitions), `generator.ts` (class, layout,
helpers), `generator-builtin.ts` (Blockly's standard blocks),
`generator-zero1.ts` (z1_* blocks), `typing.ts` (variable/procedure type
inference), `toolbox.ts`, `theme.ts`, `examples.ts`. Everything is written for
Blockly 12 ESM (`import * as Blockly from 'blockly'`) and must also work
headless in Node (`new Blockly.Workspace()` +
`Blockly.serialization.workspaces.load`) for the tests.

## 11.2 Block set

Toolbox categories in this order (colour): **Board · outputs** (#7c3aed),
**Board · inputs** (#2563eb), **Time** (#f59e0b), **Serial** (#0ea5e9),
**Logic** (210), **Loops** (120), **Math** (230), **Text** (160),
**Variables** (330, dynamic), **Functions** (290, dynamic). Labels are short,
simple English; every block has a tooltip that names the pin(s) it uses.

Pin constants generated (only when used):

```
const int LED_RED = A1;   const int LED_GREEN = A2;   const int BUTTON_1 = 6;  const int BUTTON_2 = 7;
const int POT_LDR = A3;   const int MOTOR = A0;       const int SERVO_PIN = 4; const int BUZZER = 8;
const int DHT_PIN = 5;    const int TRIG_PIN = 3;     const int ECHO_PIN = 2;  const int RGB_PIN = 9;
const int SEG_DATA = 12;  const int SEG_LATCH = 11;   const int SEG_CLOCK = 10;
```

Custom blocks (`z1_*`) and the code each generates (statement blocks end with
`;\n`; value blocks list their output type):

| Block | Fields / inputs | Generated code |
|---|---|---|
| `z1_setup_hat` "when the board starts" | statement `DO` | contents go into `setup()` after the automatic init lines |
| `z1_loop_hat` "repeat forever" | statement `DO` | contents of `loop()` |
| `z1_led_set` "turn %1 LED %2" | `LED` ∈ RED/GREEN/BUILTIN, `STATE` ∈ ON/OFF | `digitalWrite(LED_RED, HIGH);` (BUILTIN → `LED_BUILTIN`) |
| `z1_led_toggle` "toggle %1 LED" | `LED` | `digitalWrite(LED_RED, !digitalRead(LED_RED));` |
| `z1_rgb_colour` "set RGB LED to %1" | `COLOUR` dropdown: red, green, blue, yellow, cyan, magenta, orange, purple, white, off | `pixels.setPixelColor(0, pixels.Color(255, 0, 0));\npixels.show();` |
| `z1_rgb_set` "set RGB LED red %1 green %2 blue %3" | number inputs `R G B` (0..255) | `pixels.setPixelColor(0, pixels.Color(r, g, b));\npixels.show();` |
| `z1_rgb_brightness` "set RGB brightness %1" | `VALUE` (0..255) | `pixels.setBrightness(v);\npixels.show();` |
| `z1_buzzer_tone` "play tone %1 Hz for %2 ms" | `FREQ`, `DURATION` | `tone(BUZZER, f);\ndelay(d);\nnoTone(BUZZER);` |
| `z1_buzzer_note` "play note %1 for %2 ms" | `NOTE` dropdown C4…C6 (262…1047 Hz, labels like "C4 (do)"), `DURATION` | same as above with the frequency literal |
| `z1_buzzer_set` "buzzer %1" | `STATE` ON/OFF | `digitalWrite(BUZZER, HIGH);` (active buzzer) |
| `z1_sevenseg_digit` "7-segment show digit %1" | `DIGIT` (0..9) | `showDigit(d);` + helper (§11.3) |
| `z1_sevenseg_clear` "7-segment clear" | – | `showSegments(0);` |
| `z1_motor_set` "motor %1" | `STATE` ON/OFF | `digitalWrite(MOTOR, HIGH);` |
| `z1_servo_angle` "servo turn to %1 degrees" | `ANGLE` | `servo.write(a);` |
| `z1_lcd_print` "LCD write %1 at row %2 column %3" | `TEXT`, `ROW` dropdown 1/2 (generates 0/1), `COL` number | `lcd.setCursor(c, r);\nlcd.print(t);` |
| `z1_lcd_line` "LCD show %1 on line %2" | `TEXT`, `ROW` 1/2 | `lcd.setCursor(0, r);\nlcd.print("                ");\nlcd.setCursor(0, r);\nlcd.print(t);` |
| `z1_lcd_clear` "LCD clear" | – | `lcd.clear();` |
| `z1_lcd_backlight` "LCD backlight %1" | `STATE` ON/OFF | `lcd.backlight();` / `lcd.noBacklight();` |
| `z1_button_pressed` "button %1 is pressed" (Boolean) | `BUTTON` 1/2 | `(digitalRead(BUTTON_1) == HIGH)` |
| `z1_pot_read` "potentiometer value (0-1023)" (Number) | – | `analogRead(POT_LDR)` |
| `z1_pot_percent` "potentiometer %" (Number) | – | `map(analogRead(POT_LDR), 0, 1023, 0, 100)` |
| `z1_ldr_read` "light level (0-1023)" (Number) | – | `analogRead(POT_LDR)` |
| `z1_ldr_dark` "it is dark (light below %1)" (Boolean) | `THRESHOLD` | `(analogRead(POT_LDR) < t)` |
| `z1_dht_read` "DHT22 %1" (Number, float) | `WHAT` TEMPERATURE ("temperature °C") / HUMIDITY ("humidity %") | `dht.readTemperature()` / `dht.readHumidity()` |
| `z1_ultrasonic_cm` "distance (cm)" (Number, float) | – | `readDistanceCm()` + helper |
| `z1_delay_ms` "wait %1 milliseconds" | `MS` | `delay(ms);` |
| `z1_delay_s` "wait %1 seconds" | `S` | `delay(s * 1000);` (literal → folded, e.g. `delay(2000);`) |
| `z1_millis` "time since start (ms)" (Number) | – | `millis()` |
| `z1_map` "map %1 from %2 … %3 to %4 … %5" (Number) | `VALUE FROM_LOW FROM_HIGH TO_LOW TO_HIGH` | `map(v, a, b, c, d)` |
| `z1_serial_print` "Serial print %1 %2" | `VALUE`, `NEWLINE` dropdown "and go to next line" / "on the same line" | `Serial.println(v);` / `Serial.print(v);` |
| `z1_serial_print_labeled` "Serial print %1 = %2" | `LABEL` text field, `VALUE` | `Serial.print("label: ");\nSerial.println(v);` |
| `z1_serial_available` "text received from Serial" (Boolean) | – | `(Serial.available() > 0)` |
| `z1_serial_read_line` "line received from Serial" (String) | – | `readLine()` + helper |

Standard Blockly blocks supported by the generator (all others are absent from
the toolbox): `controls_if` (if / else if / else, mutator), `logic_compare`,
`logic_operation`, `logic_negate`, `logic_boolean`, `logic_ternary`,
`controls_repeat_ext` (`for (int i = 0; i < n; i++)`; nested loops use `j`,
`k`, … then `i2`), `controls_whileUntil` (`while (c)` / `while (!(c))`),
`controls_for` (uses the global variable: `for (i = a; i <= b; i += step)`;
a negative literal step → `>=` / `-=`), `controls_flow_statements` (`break;`
/ `continue;`), `math_number`, `math_arithmetic` (`+ - * /`, POWER →
`pow(a, b)`), `math_single` (sqrt, abs, -, ln → `log`, log10, exp, 10^ →
`pow(10, x)`), `math_trig` (`sin(radians(x))` …, asin → `degrees(asin(x))`),
`math_constant` (PI, E → `EULER`, GOLDEN_RATIO literal, SQRT2, SQRT1_2,
INFINITY), `math_number_property` (even `x % 2 == 0`, odd, whole
`x == (long) x`, positive, negative, divisible by; prime → helper `isPrime`),
`math_round` (round/ceil/floor), `math_modulo` (`%`), `math_constrain`,
`math_random_int` (`random(a, b + 1)`), `math_random_float`
(`random(0, 1000) / 1000.0`), `text` (`"…"` escaped), `text_join`
(`String(a) + String(b)`; a single item → `String(a)`), `text_length`
(`s.length()`), `text_isEmpty`, `text_append` (`s += String(x);`),
`text_changeCase` (helper functions `toUpper` / `toLower` returning a copy),
`text_trim` (helper), `variables_get`, `variables_set`, `math_change`
(`x += n;`), `procedures_defnoreturn`, `procedures_defreturn`,
`procedures_callnoreturn`, `procedures_callreturn`, `procedures_ifreturn`.

## 11.3 Generator rules

Output layout (blank line between sections, omit empty sections):

```
// Generated from blocks — ZERO1 Smart Board Simulator
#include <…>                          only the libraries the blocks use
                                      (Servo.h; Wire.h + LiquidCrystal_I2C.h; DHT.h; Adafruit_NeoPixel.h)
const int LED_RED = A1; …             only the pins the blocks use, one per line
Servo servo; / LiquidCrystal_I2C lcd(0x27, 16, 2); / DHT dht(DHT_PIN, DHT22); / Adafruit_NeoPixel pixels(1, RGB_PIN, NEO_GRB + NEO_KHZ800);
int count = 0; …                      global variables (typing below), defaults 0 / 0.0 / "" / false
helper functions                      showSegments/showDigit, readDistanceCm, readLine, isPrime, toUpper…, each emitted once
user functions                        from procedures_def*, in workspace order
void setup() {
  Serial.begin(9600);                 if any Serial block or Serial-using helper is used
  pinMode(LED_RED, OUTPUT); …         every used output pin (LEDs, MOTOR, BUZZER, SEG_*, TRIG_PIN)
  pinMode(BUTTON_1, INPUT); …         every used input pin (buttons; ECHO_PIN)
  lcd.init();  lcd.backlight();       if lcd used
  pixels.begin();  pixels.show();     if pixels used
  dht.begin();                        if dht used
  servo.attach(SERVO_PIN);            if servo used
  <statements of every z1_setup_hat, top-to-bottom>
}
void loop() {
  <statements of every z1_loop_hat, top-to-bottom>
}
```

Helpers, verbatim:

```
void showSegments(byte pattern) {          // 74HC595: a = bit 0 … g = bit 6, dp = bit 7
  digitalWrite(SEG_LATCH, LOW);
  shiftOut(SEG_DATA, SEG_CLOCK, MSBFIRST, pattern);
  digitalWrite(SEG_LATCH, HIGH);
}
void showDigit(int digit) {
  const byte DIGITS[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
  if (digit < 0 || digit > 9) { showSegments(0); return; }
  showSegments(DIGITS[digit]);
}
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  return duration * 0.0343 / 2;
}
String readLine() {
  String line = Serial.readStringUntil('\n');
  line.trim();
  return line;
}
```

- Only `z1_setup_hat`, `z1_loop_hat` and procedure definitions produce code;
  any other top-level (orphan) block is ignored. No hat blocks at all → a
  sketch with the init lines and an empty `loop()`.
- Expressions use Blockly precedence constants (`ORDER_ATOMIC`,
  `ORDER_UNARY_PREFIX`, `ORDER_MULTIPLICATIVE`, `ORDER_ADDITIVE`,
  `ORDER_RELATIONAL`, `ORDER_EQUALITY`, `ORDER_LOGICAL_AND`,
  `ORDER_LOGICAL_OR`, `ORDER_CONDITIONAL`, `ORDER_NONE`) so parentheses are
  added only where needed. Empty value inputs default to `0`, `""` or `false`
  per the check type.
- **Variable typing** (`typing.ts`): run before generation. For each variable
  collect the kinds of every value assigned to it (`variables_set`,
  `math_change`, `controls_for` → int). Kind of a value block: its output
  check (`Number` / `String` / `Boolean`) plus a *float* hint for
  `math_number` with a fractional value, `math_arithmetic` DIVIDE/POWER,
  `math_single` (except ABS/NEG on ints), `math_trig`, `math_constant`,
  `math_random_float`, `z1_dht_read`, `z1_ultrasonic_cm`,
  `procedures_callreturn` of a float function, and `variables_get` of a float
  variable (iterate to a fixed point, at most 5 passes). Resulting C type: any
  String → `String`; else all Boolean → `bool`; else any float → `float`; else
  `int`. A variable that is never assigned → `int`. Procedure parameters: the
  same inference over the arguments at every call site (default `int`);
  return type of `procedures_defreturn`: kind of its RETURN value (default
  `int`); `procedures_defnoreturn` → `void`. Names are sanitised to C
  identifiers (`Blockly.Names`; reserved words: the C++ keywords plus every
  runtime name in `src/transpiler/signatures.ts` `KNOWN_RUNTIME_NAMES`).
- `controls_repeat_ext` counters are locals (`int i`), not Blockly variables.
- Values passed to `lcd.print` / `Serial.print` are generated as-is (the
  Arduino overloads handle numbers and text); `text_join` builds a `String`.

## 11.4 UI (owner: ui-blocks) — `src/ui/blocks-panel.ts` + changes to `app.ts`, `examples-menu.ts`, `style.css`

```ts
export interface BlocksPanel {
  getCode(): string;                 // current generated sketch
  getWorkspaceJson(): object;        // Blockly serialization
  loadWorkspace(json: object): void;
  clear(): void;                     // back to DEFAULT_WORKSPACE
  resize(): void;                    // call when the panel becomes visible / the layout changes
  destroy(): void;
}
export async function createBlocksPanel(
  container: HTMLElement,
  opts: { onChange: (code: string, workspace: object) => void },
): Promise<BlocksPanel>;
```

`createBlocksPanel` lazy-loads Blockly and `../blocks` with a dynamic
`import()` (keeps the initial bundle small; show "Loading blocks…" meanwhile),
calls `registerZero1Blocks()`, injects Blockly with `renderer: 'zelos'`,
`theme: ZERO1_THEME`, `toolbox: TOOLBOX`, `grid`, `zoom: { controls: true,
wheel: true, startScale: 0.85 }`, `trashcan: true`, `move: { scrollbars: true,
drag: true, wheel: false }`, and regenerates the code on every non-UI workspace
change (debounced 150 ms) → `onChange`.

App behaviour:

- Header gains a **mode switch** (segmented control "Code | Blocks",
  `aria-pressed`), persisted in `localStorage['z1.mode']` (default `code`).
- In **Blocks mode** the right column tabs are *Blocks · Code · Serial Monitor
  · Pin Map · Generated JS*; the Blocks tab is selected by default; the Code
  tab shows the generated sketch in the editor **read-only** with a banner
  "Generated from your blocks. Switch to Code mode to edit it by hand."
  **Run** transpiles `blocksPanel.getCode()`; diagnostics go to the console
  (an error there means a generator bug: prefix the message with "Block code
  error:"). The workspace is persisted to `localStorage['z1.blocks']`
  (debounced) and restored on load, else `DEFAULT_WORKSPACE`. The Examples
  menu lists `BLOCK_EXAMPLES` (grouped) and loads them into the workspace
  (confirm when the current workspace differs from the last loaded example;
  that example's `workspaceFingerprint` is kept in
  `localStorage['z1.blocksBaseline']`, so an unchanged example restored after
  a reload does not ask).
  Share opens the share dialog with a `#blocks=<base64url JSON>` link (Hand
  in sends the blocks and the sketch generated from them to the teacher's
  class, docs/CLASSROOM.md; "Download .ino" saves the
  same sketch); loading such a hash switches to Blocks mode. New resets
  the workspace to `DEFAULT_WORKSPACE` (same confirmation as an example).
- In **Code mode** the Blocks tab is hidden and everything works as today.
- Switching **Blocks → Code** puts the generated sketch into the editor,
  editable (the blocks stay saved). Switching **Code → Blocks** restores the
  saved workspace; if the editor text differs from the last generated sketch,
  confirm: "Your text changes stay in the Code editor but are not converted to
  blocks. Switch to Blocks?".
- When the Blocks tab becomes visible (tab click, mode switch, window resize)
  call `resize()`; the workspace must fill the tab area (toolbox on the left).
- Keyboard: `Ctrl/Cmd+Enter` runs in both modes; `Esc` stops. Blockly must not
  capture those while focus is outside the workspace.

## 11.5 Tests

`tests/blocks.test.ts` (node): for every `BLOCK_EXAMPLES` entry, load it into a
headless workspace, generate, `transpile()` must be ok, and `runSketch` for
1500 virtual ms must end without console errors. Generator checks: variable
typing (int / float / String / bool), includes and pin constants only when
used, setup init order, procedures with typed params and return, if / else if
/ else, nested repeat counters (`i`, `j`), text_join, `Serial.println`,
orphan blocks ignored, helpers emitted once, `z1_delay_s` folding, orders /
parentheses (`(a + b) * c`). `tests/ui-blocks.test.ts` (happy-dom, optional):
mode persistence and the Blocks → Code hand-off logic (without injecting
Blockly).

## 11.6 Block examples (`BLOCK_EXAMPLES`)

Groups as the text examples. Each is a workspace JSON with the two hats:

1. **Outputs** — `b01_blink` (red LED on/off with waits), `b02_rgb_party`
   (cycle 4 colours), `b03_melody` (a few notes), `b04_count_7seg` (variable
   0-9, show digit, wait 1 s, +1, if > 9 set 0), `b05_servo_wave` (0 → 180 → 0
   with waits).
2. **Inputs** — `b10_button_led` (if button 1 pressed → red on else off),
   `b11_pot_servo` (servo ← map(pot, 0, 1023, 0, 180)), `b12_night_light`
   (if dark → red on else off, print light), `b13_dht_serial` (print
   temperature and humidity every 2 s).
3. **Display** — `b20_lcd_hello` (line 1 "Hello, ZERO1!", line 2 seconds since
   start from millis / 1000).
4. **Projects** — `b30_parking` (distance → RGB green/orange/red + beep when
   < 30 cm, print distance), `b31_reaction` (wait for button 1, random wait
   1–3 s, green LED on, measure time until button 2 with millis, print it).

Then the part-by-part groups, one block program per text sketch 40–66 (same
ids with a `b` prefix, same titles; see docs/ARCHITECTURE.md §9): **LED**
(`b40`–`b42`, the 10-times one is a *repeat* in the setup hat), **Buzzer**
(`b43`–`b45`, *buzzer on/off* + waits), **Push Button** (`b46`–`b49`),
**RGB LED** (`b50`, `b51`), **LDR** (`b52`, `b53`, `LDR read` compared with
500), **Seven-Segment** (`b54`, `b55`, a *count with n from 1 to 4* / *from 7
to 1 by -1* feeding *show digit*), **Ultrasonic** (`b56`–`b59`, the beep pause
is *distance × 10* ms), **Servo Motor** (`b60`–`b62`), **DHT Sensor** (`b63`,
`b64`, a *count with angle from 1 to 180* with a 20 ms wait), **DC Motor**
(`b65`, `b66`, *repeat 5* of *motor on/off*). Every bullet of the list could
be expressed with the existing block set; no block was added.
