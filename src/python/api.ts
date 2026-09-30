/**
 * The board API of ZERO1 Python (docs/PYTHON.md §3) as one table: the modules a program may
 * import, their members, the parts (objects) they make and the methods of those parts. For each
 * function and method: its Python parameters (positional and keyword, the kind each accepts,
 * which may be left out), its result kind, a one-line doc (completion and hover) and, for the
 * MicroPython members ZERO1 Python does not have, the hint of NA-api.
 *
 * The checker (check.ts) reads it for imports, attributes, argument counts and kinds; the editor
 * gets `API_COMPLETIONS` (never an NA name, §7.4). How each member becomes C++ (§3's C++ column)
 * is the emitter's: it keys its lowering on the stable `id` of each entry (`machine.Pin`,
 * `Pin.on`, `time.sleep_ms`, …).
 */

/** A module a program may import (§3); `utime` is another name for `time`. */
export type ModuleName = 'machine' | 'time' | 'utime' | 'neopixel' | 'dht' | 'hcsr04' | 'math' | 'random' | 'micropython' | 'zero1';

/** The modules E-module lists, in its order (`utime` is not listed: it is `time`). */
export const MODULE_NAMES: readonly ModuleName[] = ['machine', 'time', 'neopixel', 'dht', 'hcsr04', 'math', 'random', 'micropython', 'zero1'];

/** The kinds of board object (§2.9 "board objects", §3.8). */
export type PartName = 'Pin' | 'PWM' | 'ADC' | 'I2C' | 'NeoPixel' | 'DHT' | 'HCSR04' | 'Servo' | 'LCD' | 'Buzzer' | 'SevenSegment';

/**
 * What an API parameter accepts (E-api-kind names it in words: `API_KIND_WORDS`).
 * `int`: a whole number or True/False · `number`: also a decimal number · `truth`: a number or
 * True/False (a pin level) · `text` · `pin`: a pin (§3 "Pins") · `colour`: an (r, g, b) tuple or a
 * colour variable · `list`: a list of any kind · `intList`: a list of whole numbers · `pinMode`:
 * Pin.IN / Pin.OUT · `pull`: Pin.PULL_UP / Pin.PULL_DOWN · `i2cPin`: a pin given to I2C.
 */
export type ApiParamKind = 'int' | 'number' | 'truth' | 'text' | 'pin' | 'colour' | 'list' | 'intList' | 'pinMode' | 'pull';

/** How E-api-kind says what a parameter needs, and how to get there (`{f}` is the call). */
export const API_KIND_WORDS: Readonly<Record<ApiParamKind, { need: string; fix: string }>> = {
  int: { need: 'a whole number', fix: '{f}(int(x))' },
  number: { need: 'a number', fix: '{f}(int(x))' },
  truth: { need: 'a number or True / False', fix: '{f}(1)' },
  text: { need: 'text', fix: '{f}(str(x))' },
  pin: { need: 'a pin', fix: '{f}(LED_RED)' },
  colour: { need: 'a colour (r, g, b)', fix: '{f}((255, 0, 0))' },
  list: { need: 'a list', fix: '{f}(items)' },
  intList: { need: 'a list of whole numbers', fix: '{f}([0, 1, 2])' },
  pinMode: { need: 'Pin.IN or Pin.OUT', fix: 'Pin(LED_RED, Pin.OUT)' },
  pull: { need: 'Pin.PULL_UP', fix: 'Pin(BUTTON_1, Pin.IN, Pin.PULL_UP)' },
};

export interface ApiParam {
  name: string;
  kind: ApiParamKind;
  /** Has a default value: may be left out. */
  optional?: boolean;
  /** Only as `name=value` (after `*` in MicroPython's signature). */
  keywordOnly?: boolean;
  /** Only by position (MicroPython does not take it as a keyword). */
  positionalOnly?: boolean;
  /** ZERO1 Python refuses this parameter when it is given: NA-api with this hint. */
  refused?: string;
}

/**
 * The kind of a call's value: `none` (a statement only; using it is NA-none-value), a scalar kind,
 * `item` (an element of the list argument: `random.choice`) or `same` (the kind of the argument:
 * `micropython.const`).
 */
export type ApiResult = 'none' | 'int' | 'float' | 'bool' | 'str' | 'item' | 'same';

interface MemberBase {
  /** Stable id: `module.name` for module members, `Part.name` for part members. */
  id: string;
  name: string;
  /** One line for completion and hover. */
  doc: string;
}

/** A function of a module, or a method of a part. */
export interface ApiFunction extends MemberBase {
  kind: 'function' | 'method';
  params: readonly ApiParam[];
  result: ApiResult;
  /**
   * A method whose first parameter is optional and that *reads* when it is left out
   * (`p.value()`, `servo.angle()`): the result of that reading form, or `{ refused }` when ZERO1
   * Python does not have it (`pwm.duty_u16()`: NA-api).
   */
  read?: ApiResult | { refused: string };
  /** `sleep_ms(ms)`: the completion detail. */
  signature: string;
}

/** A class that makes a part: `Pin(…)`, `Servo()`. */
export interface ApiClass extends MemberBase {
  kind: 'class';
  part: PartName;
  params: readonly ApiParam[];
  signature: string;
}

/** A named value: a pin name, `math.pi`, `Pin.OUT`. */
export interface ApiConstant extends MemberBase {
  kind: 'constant';
  valueKind: 'int' | 'float';
  value: number;
  /** A pin number (the zero1 pin names, A0…A5): E-attr-int-pin names its part (`the red LED`). */
  pin?: string;
  /** Pin.OUT / Pin.IN are `pinMode`, Pin.PULL_UP / PULL_DOWN are `pull`. */
  tag?: 'pinMode' | 'pull';
}

/** A MicroPython member ZERO1 Python does not have (NA-api, §5.4). */
export interface ApiRefused extends MemberBase {
  kind: 'refused';
  /** `Pin.irq()` / `machine.Timer()` in the message (with the `()` of a callable). */
  display: string;
  hint: string;
}

export type ApiMember = ApiFunction | ApiClass | ApiConstant | ApiRefused;

export interface ApiModule {
  name: ModuleName;
  doc: string;
  /** Every member by name (refused ones too). */
  members: Readonly<Record<string, ApiMember>>;
}

export interface ApiPart {
  name: PartName;
  /** What the part is, for E-attr-object ("A Pin has: on, off, …"). */
  doc: string;
  /** Library-backed parts must be made at the top of the program (NA-object-here, §2.9). */
  library: boolean;
  /** Class-level names: `Pin.OUT` (and refused ones: `Pin.OPEN_DRAIN`). */
  statics: Readonly<Record<string, ApiConstant | ApiRefused>>;
  /** Methods of a part variable: `led.on()` (and refused ones: `led.irq()`). */
  methods: Readonly<Record<string, ApiFunction | ApiRefused>>;
  /** `len(np)` works on it. */
  hasLen?: boolean;
  /** `np[i] = colour` works on it (reading `np[i]` is NA-api). */
  itemAssign?: boolean;
  /** `p()` / `p(x)` work like `p.value()` / `p.value(x)`. */
  callable?: boolean;
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

const p = (name: string, kind: ApiParamKind, more: Partial<ApiParam> = {}): ApiParam => ({ name, kind, ...more });
const opt = (name: string, kind: ApiParamKind, more: Partial<ApiParam> = {}): ApiParam => ({ name, kind, optional: true, ...more });
const kw = (name: string, kind: ApiParamKind, more: Partial<ApiParam> = {}): ApiParam => ({ name, kind, optional: true, keywordOnly: true, ...more });

function fn(owner: string, name: string, params: ApiParam[], result: ApiResult, doc: string, more: Partial<ApiFunction> = {}): ApiFunction {
  const shown = params.filter((q) => !q.refused).map((q) => (q.keywordOnly ? `${q.name}=…` : q.optional ? `[${q.name}]` : q.name));
  return { id: `${owner}.${name}`, name, kind: 'function', params, result, doc, signature: `${name}(${shown.join(', ')})`, ...more };
}

function method(part: PartName, name: string, params: ApiParam[], result: ApiResult, doc: string, more: Partial<ApiFunction> = {}): ApiFunction {
  return { ...fn(part, name, params, result, doc, more), kind: 'method' };
}

function cls(owner: string, name: string, part: PartName, params: ApiParam[], doc: string): ApiClass {
  const shown = params.filter((q) => !q.refused).map((q) => (q.keywordOnly ? `${q.name}=…` : q.optional ? `[${q.name}]` : q.name));
  return { id: `${owner}.${name}`, name, kind: 'class', part, params, doc, signature: `${name}(${shown.join(', ')})` };
}

function constant(owner: string, name: string, valueKind: 'int' | 'float', value: number, doc: string, more: Partial<ApiConstant> = {}): ApiConstant {
  return { id: `${owner}.${name}`, name, kind: 'constant', valueKind, value, doc, ...more };
}

function refused(owner: string, name: string, hint: string, callable = true): ApiRefused {
  return { id: `${owner}.${name}`, name, kind: 'refused', display: `${owner}.${name}${callable ? '()' : ''}`, hint, doc: '' };
}

function byName<T extends { name: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.name] = item;
  return out;
}

// ---------------------------------------------------------------------------
// pins (§3 "Pins", §3.1)
// ---------------------------------------------------------------------------

/** Arduino pin numbers of the analog pins: A0 = 14 … A5 = 19. */
const ANALOG_BASE = 14;

/** The zero1 pin names (§3.1): value, and the part in words for E-attr-int-pin / W-pwm-pin. */
export const ZERO1_PINS: Readonly<Record<string, { value: number; part: string }>> = {
  LED_RED: { value: 15, part: 'red LED' },
  LED_GREEN: { value: 16, part: 'green LED' },
  LED_BUILTIN: { value: 13, part: 'built-in LED' },
  BUTTON_1: { value: 6, part: 'push button 1' },
  BUTTON_2: { value: 7, part: 'push button 2' },
  POT_LDR: { value: 17, part: 'potentiometer or light sensor' },
  MOTOR: { value: 14, part: 'DC motor' },
  SERVO_PIN: { value: 4, part: 'servo' },
  BUZZER: { value: 8, part: 'buzzer' },
  DHT_PIN: { value: 5, part: 'DHT22 sensor' },
  TRIG_PIN: { value: 3, part: 'ultrasonic trigger' },
  ECHO_PIN: { value: 2, part: 'ultrasonic echo' },
  RGB_PIN: { value: 9, part: 'RGB LED' },
  SEG_DATA: { value: 12, part: '7-segment data line' },
  SEG_LATCH: { value: 11, part: '7-segment latch line' },
  SEG_CLOCK: { value: 10, part: '7-segment clock line' },
};

/**
 * The pin number of a pin written as text (§3 "Pins"): a ZERO1 name (`"LED_RED"`), an Arduino
 * name (`"D13"`, `"A3"`) or `"LED"` (D13, MicroPython's usual built-in LED name); null when
 * there is no such pin on the UNO.
 */
export function pinOfText(text: string): number | null {
  if (Object.prototype.hasOwnProperty.call(ZERO1_PINS, text)) return ZERO1_PINS[text].value;
  if (text === 'LED') return 13;
  let m = /^D(\d{1,2})$/.exec(text);
  if (m && Number(m[1]) <= 13) return Number(m[1]);
  m = /^A([0-5])$/.exec(text);
  if (m) return ANALOG_BASE + Number(m[1]);
  return null;
}

/** How a pin number is written for students: 15 → "A1", 8 → "D8". */
export function pinLabel(pin: number): string {
  return pin >= ANALOG_BASE ? `A${pin - ANALOG_BASE}` : `D${pin}`;
}

/** Pins with PWM on the UNO (W-pwm-pin). */
export const PWM_PINS: ReadonlySet<number> = new Set([3, 5, 6, 9, 10, 11]);

// ---------------------------------------------------------------------------
// the parts (§3.2–§3.8)
// ---------------------------------------------------------------------------

const IRQ_HINT = 'Check the pin in your while True loop instead.';
const VOLTS_HINT = 'Use read() * 5.0 / 1023 for volts.';

const PIN: ApiPart = {
  name: 'Pin',
  doc: 'A pin of the board, as an output (Pin.OUT) or an input (Pin.IN).',
  library: false,
  callable: true,
  statics: byName<ApiConstant | ApiRefused>([
    constant('Pin', 'OUT', 'int', 1, 'Output mode: the program switches the pin on and off.', { tag: 'pinMode' }),
    constant('Pin', 'IN', 'int', 0, 'Input mode: the program reads the pin.', { tag: 'pinMode' }),
    constant('Pin', 'PULL_UP', 'int', 1, 'Input with the built-in pull-up resistor: reads 1 until the pin is pulled to 0 V.', { tag: 'pull' }),
    constant('Pin', 'PULL_DOWN', 'int', 2, 'Pull-down resistor (the UNO has none: ignored).', { tag: 'pull' }),
    refused('Pin', 'OPEN_DRAIN', 'Use Pin.OUT.', false),
    refused('Pin', 'ALT', 'Use Pin.OUT or Pin.IN.', false),
    refused('Pin', 'ALT_OPEN_DRAIN', 'Use Pin.OUT.', false),
    refused('Pin', 'ANALOG', 'Use ADC(pin) to read an analog pin.', false),
    refused('Pin', 'IRQ_RISING', IRQ_HINT, false),
    refused('Pin', 'IRQ_FALLING', IRQ_HINT, false),
  ]),
  methods: byName<ApiFunction | ApiRefused>([
    method('Pin', 'on', [], 'none', 'Switch the pin on (5 V).'),
    method('Pin', 'off', [], 'none', 'Switch the pin off (0 V).'),
    method('Pin', 'value', [opt('x', 'truth')], 'none', 'value() reads the pin (0 or 1); value(x) switches it on (1) or off (0).', { read: 'int' }),
    method('Pin', 'toggle', [], 'none', 'Switch the pin to the other state.'),
    refused('Pin', 'init', 'Make a new Pin instead: Pin(LED_RED, Pin.OUT).'),
    refused('Pin', 'irq', IRQ_HINT),
    refused('Pin', 'mode', 'Give the mode when you make the Pin: Pin(LED_RED, Pin.OUT).'),
    refused('Pin', 'pull', 'Give the pull when you make the Pin: Pin(BUTTON_1, Pin.IN, Pin.PULL_UP).'),
    refused('Pin', 'drive', 'The UNO pins have one drive strength.'),
    refused('Pin', 'high', 'Use on().'),
    refused('Pin', 'low', 'Use off().'),
  ]),
};

const PWM: ApiPart = {
  name: 'PWM',
  doc: 'A pin that dims (pulse-width modulation).',
  library: false,
  statics: {},
  methods: byName<ApiFunction | ApiRefused>([
    method('PWM', 'duty_u16', [opt('value', 'int')], 'none', 'Set the brightness: 0 (off) to 65535 (fully on).', {
      read: { refused: 'Keep the value you set in a variable.' },
    }),
    method('PWM', 'duty', [opt('value', 'int')], 'none', 'Set the brightness: 0 (off) to 1023 (fully on), like the ESP32.', {
      read: { refused: 'Keep the value you set in a variable.' },
    }),
    method('PWM', 'freq', [opt('f', 'int')], 'none', 'The UNO has a fixed PWM frequency: ignored.', { read: { refused: 'The PWM frequency of the UNO is fixed (490 Hz).' } }),
    method('PWM', 'deinit', [], 'none', 'Stop the PWM signal (the pin goes to 0 V).'),
    refused('PWM', 'duty_ns', 'Use duty_u16().'),
    refused('PWM', 'init', 'Make a new PWM instead.'),
  ]),
};

const ADC: ApiPart = {
  name: 'ADC',
  doc: 'An analog input (A0-A5).',
  library: false,
  statics: byName<ApiConstant | ApiRefused>([
    refused('ADC', 'ATTN_0DB', 'The UNO measures 0 to 5 V.', false),
    refused('ADC', 'ATTN_11DB', 'The UNO measures 0 to 5 V.', false),
    refused('ADC', 'WIDTH_10BIT', 'The UNO measures with 10 bits: read() gives 0-1023.', false),
  ]),
  methods: byName<ApiFunction | ApiRefused>([
    method('ADC', 'read', [], 'int', '0-1023 on the ZERO1; on other boards use read_u16().'),
    method('ADC', 'read_u16', [], 'int', '0-65535, like every MicroPython board.'),
    refused('ADC', 'read_uv', VOLTS_HINT),
    refused('ADC', 'atten', VOLTS_HINT),
    refused('ADC', 'width', VOLTS_HINT),
    refused('ADC', 'init', 'Make a new ADC instead.'),
    refused('ADC', 'block', VOLTS_HINT),
  ]),
};

const I2C_HINT = 'Use the ZERO1 parts: LCD() talks to the display for you.';
const I2C: ApiPart = {
  name: 'I2C',
  doc: 'The I2C bus (SDA = A4, SCL = A5).',
  library: false,
  statics: {},
  methods: byName<ApiFunction | ApiRefused>([
    method('I2C', 'scan', [], 'none', 'The addresses of the parts on the bus: for address in i2c.scan():'),
    ...['writeto', 'readfrom', 'readfrom_into', 'writeto_mem', 'readfrom_mem', 'readfrom_mem_into', 'start', 'stop', 'readinto', 'write', 'init', 'deinit'].map((n) =>
      refused('I2C', n, I2C_HINT),
    ),
  ]),
};

const NEOPIXEL: ApiPart = {
  name: 'NeoPixel',
  doc: 'The RGB LED (WS2812) on RGB_PIN.',
  library: true,
  hasLen: true,
  itemAssign: true,
  statics: {},
  methods: byName<ApiFunction | ApiRefused>([
    method('NeoPixel', 'fill', [p('colour', 'colour')], 'none', 'Give every pixel this colour (r, g, b); np.write() shows it.'),
    method('NeoPixel', 'write', [], 'none', 'Show the colours you set.'),
  ]),
};

const DHT: ApiPart = {
  name: 'DHT',
  doc: 'The DHT22 (or DHT11) temperature and humidity sensor.',
  library: true,
  statics: {},
  methods: byName<ApiFunction | ApiRefused>([
    method('DHT', 'measure', [], 'none', 'Read the sensor (OSError when it does not answer); then temperature() and humidity().'),
    method('DHT', 'temperature', [], 'float', 'The temperature of the last measure(), in °C.'),
    method('DHT', 'humidity', [], 'float', 'The humidity of the last measure(), in %.'),
  ]),
};

const HCSR04: ApiPart = {
  name: 'HCSR04',
  doc: 'The HC-SR04 ultrasonic distance sensor (TRIG_PIN, ECHO_PIN).',
  library: false,
  statics: {},
  methods: byName<ApiFunction | ApiRefused>([
    method('HCSR04', 'distance_cm', [], 'float', 'The distance in cm (OSError: Out of range when there is no echo).'),
    method('HCSR04', 'distance_mm', [], 'int', 'The distance in mm, a whole number.'),
  ]),
};

const SERVO: ApiPart = {
  name: 'Servo',
  doc: 'The servo motor (SERVO_PIN).',
  library: true,
  statics: {},
  methods: byName<ApiFunction | ApiRefused>([
    method('Servo', 'angle', [opt('degrees', 'int')], 'none', 'angle(a) turns the servo to a degrees (0-180); angle() gives the last angle.', { read: 'int' }),
    method('Servo', 'detach', [], 'none', 'Stop driving the servo.'),
  ]),
};

const LCD: ApiPart = {
  name: 'LCD',
  doc: 'The 16x2 LCD display (I2C address 0x27).',
  library: true,
  statics: {},
  methods: byName<ApiFunction | ApiRefused>([
    method('LCD', 'clear', [], 'none', 'Clear the display; the cursor goes to the top left.'),
    method('LCD', 'move_to', [p('col', 'int'), p('row', 'int')], 'none', 'Move the cursor: column 0-15, row 0-1.'),
    method('LCD', 'putstr', [p('text', 'text')], 'none', 'Show text at the cursor.'),
    method('LCD', 'putchar', [p('char', 'text')], 'none', 'Show one character: putchar("A") or putchar(chr(0)) for a custom character.'),
    method('LCD', 'custom_char', [p('slot', 'int'), p('bitmap', 'intList')], 'none', 'Make character 0-7 from 8 rows of 5 dots: a list of 8 numbers 0-31.'),
    method('LCD', 'backlight_on', [], 'none', 'Switch the backlight on.'),
    method('LCD', 'backlight_off', [], 'none', 'Switch the backlight off.'),
    method('LCD', 'display_on', [], 'none', 'Show the text again.'),
    method('LCD', 'display_off', [], 'none', 'Hide the text (it is kept).'),
    method('LCD', 'show_cursor', [], 'none', 'Show the cursor as a line.'),
    method('LCD', 'hide_cursor', [], 'none', 'Hide the cursor.'),
    method('LCD', 'blink_cursor_on', [], 'none', 'Show the cursor as a blinking block.'),
    method('LCD', 'blink_cursor_off', [], 'none', 'Stop the blinking cursor.'),
  ]),
};

const BUZZER: ApiPart = {
  name: 'Buzzer',
  doc: 'The buzzer (BUZZER, pin 8).',
  library: false,
  statics: {},
  methods: byName<ApiFunction | ApiRefused>([
    method('Buzzer', 'tone', [p('freq', 'int'), opt('ms', 'int')], 'none', 'Play a note of freq Hz (for ms milliseconds, without waiting).'),
    method('Buzzer', 'no_tone', [], 'none', 'Stop the note.'),
    refused('Buzzer', 'on', 'For a click, use a Pin: Pin(BUZZER, Pin.OUT).'),
    refused('Buzzer', 'off', 'For a click, use a Pin: Pin(BUZZER, Pin.OUT).'),
  ]),
};

const SEVEN_SEGMENT: ApiPart = {
  name: 'SevenSegment',
  doc: 'The 7-segment display.',
  library: false,
  statics: {},
  methods: byName<ApiFunction | ApiRefused>([
    method('SevenSegment', 'show', [p('digit', 'int')], 'none', 'Show a digit 0-9 (other numbers: blank).'),
    method('SevenSegment', 'segments', [p('bits', 'int')], 'none', 'Light the segments whose bits are 1 (bit 0 = a … bit 6 = g, bit 7 = dot).'),
    method('SevenSegment', 'clear', [], 'none', 'Switch every segment off.'),
  ]),
};

/** Every part by name. */
export const API_PARTS: Readonly<Record<PartName, ApiPart>> = {
  Pin: PIN,
  PWM,
  ADC,
  I2C,
  NeoPixel: NEOPIXEL,
  DHT,
  HCSR04,
  Servo: SERVO,
  LCD,
  Buzzer: BUZZER,
  SevenSegment: SEVEN_SEGMENT,
};

// ---------------------------------------------------------------------------
// the modules (§3.2–§3.9)
// ---------------------------------------------------------------------------

const HCSR04_CLASS = (owner: string) =>
  cls(owner, 'HCSR04', 'HCSR04', [opt('trigger_pin', 'pin'), opt('echo_pin', 'pin'), opt('echo_timeout_us', 'int')], 'The ultrasonic distance sensor: HCSR04() (TRIG_PIN, ECHO_PIN).');

const MACHINE_ONLY = 'The ZERO1 does not have it: the board is an Arduino UNO.';

const MACHINE: ApiModule = {
  name: 'machine',
  doc: 'Pins, PWM, analog inputs and I2C.',
  members: byName<ApiMember>([
    cls('machine', 'Pin', 'Pin', [p('id', 'pin'), opt('mode', 'pinMode'), opt('pull', 'pull'), kw('value', 'truth'), kw('drive', 'int', { refused: 'The UNO pins have one drive strength.' }), kw('alt', 'int', { refused: 'Use Pin.OUT or Pin.IN.' })], 'A pin: Pin(LED_RED, Pin.OUT) or Pin(BUTTON_1, Pin.IN).'),
    cls('machine', 'PWM', 'PWM', [p('pin', 'pin'), kw('freq', 'int'), kw('duty_u16', 'int'), kw('duty', 'int'), kw('duty_ns', 'int', { refused: 'Use duty_u16=.' }), kw('invert', 'truth', { refused: 'Use 65535 - value.' })], 'A pin that dims: PWM(Pin(RGB_PIN)) on pins 3, 5, 6, 9, 10, 11.'),
    cls('machine', 'ADC', 'ADC', [p('pin', 'pin'), kw('atten', 'int', { refused: VOLTS_HINT })], 'An analog input: ADC(POT_LDR); read() gives 0-1023 on the ZERO1.'),
    cls('machine', 'I2C', 'I2C', [opt('id', 'int'), kw('scl', 'pin'), kw('sda', 'pin'), kw('freq', 'int')], 'The I2C bus: I2C(0) (SDA = A4, SCL = A5).'),
    cls('machine', 'SoftI2C', 'I2C', [kw('scl', 'pin'), kw('sda', 'pin'), kw('freq', 'int')], 'The I2C bus: SoftI2C(scl=Pin(A5), sda=Pin(A4)).'),
    fn('machine', 'time_pulse_us', [p('pin', 'pin'), p('pulse_level', 'truth'), opt('timeout_us', 'int')], 'int', 'How long a pulse on the pin lasts, in µs (0 when none comes).'),
    ...['reset', 'soft_reset', 'freq', 'Timer', 'UART', 'SPI', 'SoftSPI', 'RTC', 'WDT', 'deepsleep', 'lightsleep', 'idle', 'unique_id', 'disable_irq', 'enable_irq', 'Signal', 'SDCard', 'bootloader', 'reset_cause', 'wake_reason'].map((n) =>
      refused('machine', n, MACHINE_ONLY),
    ),
  ]),
};

const TICKS_HINT = 'Use time.ticks_ms() and time.ticks_diff().';

const TIME: ApiModule = {
  name: 'time',
  doc: 'Waiting and measuring time.',
  members: byName<ApiMember>([
    fn('time', 'sleep', [p('seconds', 'number')], 'none', 'Wait this many seconds (0.5 = half a second).'),
    fn('time', 'sleep_ms', [p('ms', 'int')], 'none', 'Wait this many milliseconds (1000 = 1 second).'),
    fn('time', 'sleep_us', [p('us', 'int')], 'none', 'Wait this many microseconds.'),
    fn('time', 'ticks_ms', [], 'int', 'Milliseconds since the board started (use ticks_diff to subtract).'),
    fn('time', 'ticks_us', [], 'int', 'Microseconds since the board started (use ticks_diff to subtract).'),
    fn('time', 'ticks_diff', [p('new', 'int'), p('old', 'int')], 'int', 'new - old for two tick values: ticks_diff(time.ticks_ms(), start).'),
    fn('time', 'ticks_add', [p('ticks', 'int'), p('delta', 'int')], 'int', 'A tick value plus a number of ticks.'),
    fn('time', 'time', [], 'int', 'Seconds since the board started (the UNO has no clock).'),
    ...['ticks_cpu', 'localtime', 'gmtime', 'mktime', 'time_ns'].map((n) => refused('time', n, TICKS_HINT)),
  ]),
};

const NEOPIXEL_MODULE: ApiModule = {
  name: 'neopixel',
  doc: 'The RGB LED.',
  members: byName<ApiMember>([
    cls('neopixel', 'NeoPixel', 'NeoPixel', [p('pin', 'pin'), p('n', 'int'), kw('bpp', 'int', { refused: 'The ZERO1 RGB LED has 3 colours.' }), kw('timing', 'int', { refused: 'The ZERO1 RGB LED has one timing.' })], 'The RGB LED: NeoPixel(Pin(RGB_PIN), 1).'),
  ]),
};

const DHT_MODULE: ApiModule = {
  name: 'dht',
  doc: 'Temperature and humidity sensors.',
  members: byName<ApiMember>([
    cls('dht', 'DHT22', 'DHT', [p('pin', 'pin')], 'The DHT22 sensor: dht.DHT22(Pin(DHT_PIN)).'),
    cls('dht', 'DHT11', 'DHT', [p('pin', 'pin')], 'The DHT11 sensor: dht.DHT11(Pin(DHT_PIN)).'),
  ]),
};

const HCSR04_MODULE: ApiModule = {
  name: 'hcsr04',
  doc: 'The ultrasonic distance sensor.',
  members: byName<ApiMember>([HCSR04_CLASS('hcsr04')]),
};

const FLOAT_FN = (name: string, doc: string) => fn('math', name, [p('x', 'number')], 'float', doc);

const MATH: ApiModule = {
  name: 'math',
  doc: 'Mathematics with decimal numbers.',
  members: byName<ApiMember>([
    constant('math', 'pi', 'float', Math.fround(Math.PI), 'π = 3.141593'),
    constant('math', 'e', 'float', Math.fround(Math.E), 'e = 2.718282'),
    FLOAT_FN('sqrt', 'The square root.'),
    FLOAT_FN('sin', 'The sine of an angle in radians.'),
    FLOAT_FN('cos', 'The cosine of an angle in radians.'),
    FLOAT_FN('tan', 'The tangent of an angle in radians.'),
    FLOAT_FN('asin', 'The arc sine, in radians.'),
    FLOAT_FN('acos', 'The arc cosine, in radians.'),
    FLOAT_FN('atan', 'The arc tangent, in radians.'),
    fn('math', 'atan2', [p('y', 'number'), p('x', 'number')], 'float', 'The angle of the point (x, y), in radians.'),
    FLOAT_FN('exp', 'e to the power x.'),
    FLOAT_FN('log', 'The natural logarithm.'),
    FLOAT_FN('log10', 'The base-10 logarithm.'),
    FLOAT_FN('fabs', 'The absolute value, as a decimal number.'),
    fn('math', 'floor', [p('x', 'number')], 'int', 'Round down to a whole number.'),
    fn('math', 'ceil', [p('x', 'number')], 'int', 'Round up to a whole number.'),
    fn('math', 'trunc', [p('x', 'number')], 'int', 'Drop the decimals (toward 0).'),
    fn('math', 'pow', [p('x', 'number'), p('y', 'number')], 'float', 'x to the power y, as a decimal number.'),
    FLOAT_FN('radians', 'Degrees to radians.'),
    FLOAT_FN('degrees', 'Radians to degrees.'),
    fn('math', 'isnan', [p('x', 'number')], 'bool', 'True when x is not a number (nan).'),
    fn('math', 'isinf', [p('x', 'number')], 'bool', 'True when x is infinite.'),
    ...['fmod', 'hypot', 'copysign', 'frexp', 'ldexp', 'modf', 'gamma', 'lgamma', 'erf', 'erfc', 'cosh', 'sinh', 'tanh', 'acosh', 'asinh', 'atanh', 'expm1', 'log1p', 'log2', 'factorial', 'gcd', 'lcm', 'isclose', 'isfinite', 'comb', 'perm', 'prod', 'dist', 'isqrt', 'fsum'].map((n) =>
      refused('math', n, 'Write it with + - * / and the math functions you can use: sqrt, sin, cos, pow, floor, …'),
    ),
    ...['inf', 'nan', 'tau'].map((n) => refused('math', n, 'Write the value itself, for example 2 * math.pi.', false)),
  ]),
};

const RANDOM: ApiModule = {
  name: 'random',
  doc: 'Random numbers.',
  members: byName<ApiMember>([
    fn('random', 'randint', [p('a', 'int'), p('b', 'int')], 'int', 'A random whole number from a to b (both included).'),
    fn('random', 'randrange', [p('start', 'int'), opt('stop', 'int'), opt('step', 'int', { refused: 'Use randint() and multiply: random.randint(0, 4) * 2.' })], 'int', 'randrange(stop): 0 to stop - 1; randrange(start, stop): start to stop - 1.'),
    fn('random', 'random', [], 'float', 'A random decimal number from 0.0 to just under 1.0.'),
    fn('random', 'uniform', [p('a', 'number'), p('b', 'number')], 'float', 'A random decimal number from a to b.'),
    fn('random', 'choice', [p('items', 'list')], 'item', 'A random item of a list.'),
    fn('random', 'seed', [opt('n', 'int')], 'none', 'Start the random numbers from n (seed() alone: from the time).'),
    ...['getrandbits', 'shuffle', 'sample', 'choices', 'gauss'].map((n) => refused('random', n, 'Use random.randint() or random.choice().')),
  ]),
};

const MICROPYTHON: ApiModule = {
  name: 'micropython',
  doc: 'MicroPython helpers.',
  members: byName<ApiMember>([
    fn('micropython', 'const', [p('value', 'number')], 'same', 'A value that never changes: LIMIT = const(100).'),
    ...['opt_level', 'mem_info', 'qstr_info', 'stack_use', 'heap_lock', 'heap_unlock', 'kbd_intr', 'schedule', 'alloc_emergency_exception_buf'].map((n) =>
      refused('micropython', n, MACHINE_ONLY),
    ),
  ]),
};

const ZERO1: ApiModule = {
  name: 'zero1',
  doc: 'The ZERO1 pin names and parts.',
  members: byName<ApiMember>([
    ...Object.entries(ZERO1_PINS).map(([name, info]) => constant('zero1', name, 'int', info.value, `Pin ${pinLabel(info.value)}: the ${info.part}.`, { pin: info.part })),
    ...[0, 1, 2, 3, 4, 5].map((k) => constant('zero1', `A${k}`, 'int', ANALOG_BASE + k, `Analog pin A${k} (${ANALOG_BASE + k}).`, { pin: `analog pin A${k}` })),
    constant('zero1', 'LCD_ADDRESS', 'int', 0x27, 'The I2C address of the LCD: 0x27.'),
    cls('zero1', 'Servo', 'Servo', [opt('pin', 'pin')], 'The servo motor: servo = Servo() (SERVO_PIN).'),
    cls('zero1', 'LCD', 'LCD', [opt('addr', 'int'), opt('cols', 'int'), opt('rows', 'int')], 'The 16x2 LCD: lcd = LCD().'),
    cls('zero1', 'Buzzer', 'Buzzer', [opt('pin', 'pin')], 'The buzzer: buzzer = Buzzer() (BUZZER, pin 8).'),
    cls('zero1', 'SevenSegment', 'SevenSegment', [], 'The 7-segment display: display = SevenSegment().'),
    HCSR04_CLASS('zero1'),
    fn('zero1', 'map_range', [p('x', 'int'), p('in_min', 'int'), p('in_max', 'int'), p('out_min', 'int'), p('out_max', 'int')], 'int', 'Scale x from in_min…in_max to out_min…out_max (whole numbers).'),
    fn('zero1', 'input_available', [], 'bool', 'True when a line typed in the Serial Monitor is waiting for input().'),
    refused('zero1', 'Motor', 'Use a Pin: motor = Pin(MOTOR, Pin.OUT).'),
  ]),
};

/** Every module a program may import, by the name it is imported with. */
export const API_MODULES: Readonly<Record<ModuleName, ApiModule>> = {
  machine: MACHINE,
  time: TIME,
  utime: { ...TIME, name: 'utime' },
  neopixel: NEOPIXEL_MODULE,
  dht: DHT_MODULE,
  hcsr04: HCSR04_MODULE,
  math: MATH,
  random: RANDOM,
  micropython: MICROPYTHON,
  zero1: ZERO1,
};

export function isModuleName(name: string): name is ModuleName {
  return Object.prototype.hasOwnProperty.call(API_MODULES, name);
}

export function isPartName(name: string): name is PartName {
  return Object.prototype.hasOwnProperty.call(API_PARTS, name);
}

/**
 * The member `name` of a module (`lookupMember('time', 'sleep_ms')`) or of a part
 * (`lookupMember('Pin', 'on')`, `lookupMember('Pin', 'OUT')`: methods first, then class-level
 * names); undefined when there is none.
 */
export function lookupMember(owner: ModuleName | PartName, name: string): ApiMember | undefined {
  const has = (o: object) => Object.prototype.hasOwnProperty.call(o, name);
  if (isModuleName(owner)) {
    const members = API_MODULES[owner].members;
    return has(members) ? members[name] : undefined;
  }
  const part = API_PARTS[owner];
  if (has(part.methods)) return part.methods[name];
  if (has(part.statics)) return part.statics[name];
  return undefined;
}

// ---------------------------------------------------------------------------
// built-in functions (§2.6)
// ---------------------------------------------------------------------------

/** The built-in functions ZERO1 Python has (§2.6), with their one-line docs. */
export const BUILTINS: Readonly<Record<string, { signature: string; doc: string }>> = {
  print: { signature: 'print(*values, sep=" ", end="\\n")', doc: 'Show values on the Serial Monitor.' },
  input: { signature: 'input(prompt="")', doc: 'Wait for a line typed in the Serial Monitor and give it as text.' },
  len: { signature: 'len(x)', doc: 'How many items a list has (or characters a text has).' },
  range: { signature: 'range(stop) / range(start, stop[, step])', doc: 'The numbers of a for loop: for i in range(10):' },
  int: { signature: 'int(x)', doc: 'A whole number from a decimal number (cut toward 0) or from text.' },
  float: { signature: 'float(x)', doc: 'A decimal number from a whole number or from text.' },
  str: { signature: 'str(x)', doc: 'The text of a value: str(42) is "42".' },
  bool: { signature: 'bool(x)', doc: 'True or False: 0, 0.0, "" and [] are False.' },
  abs: { signature: 'abs(x)', doc: 'The value without its sign: abs(-5) is 5.' },
  min: { signature: 'min(a, b, …) / min(list)', doc: 'The smallest value.' },
  max: { signature: 'max(a, b, …) / max(list)', doc: 'The largest value.' },
  round: { signature: 'round(x[, n])', doc: 'Round to a whole number (halves to even), or to n decimals.' },
  pow: { signature: 'pow(a, b)', doc: 'a to the power b, like a ** b.' },
  chr: { signature: 'chr(n)', doc: 'The character with code n: chr(65) is "A".' },
  ord: { signature: 'ord(c)', doc: 'The code of a character: ord("A") is 65.' },
  sum: { signature: 'sum(list)', doc: 'The sum of the items of a list.' },
};

/**
 * Built-ins ZERO1 Python does not have (NA-builtin), with the per-name hint where one helps
 * (§2.6). Any other name of Python's builtins module is also NA-builtin (without a hint).
 */
export const REFUSED_BUILTINS: Readonly<Record<string, string>> = {
  sorted: 'Write a bubble sort with a, b = b, a.',
  any: 'Use a for loop with a variable.',
  all: 'Use a for loop with a variable.',
  enumerate: 'Write for i in range(len(items)): and use items[i].',
  zip: 'Write for i in range(len(a)): and use a[i] and b[i].',
  map: 'Use a for loop.',
  filter: 'Use a for loop with an if.',
  reversed: 'Write for i in range(len(items) - 1, -1, -1):',
  list: 'Write the list with [ ]: items = [0] * 10',
  tuple: '',
  dict: '',
  set: '',
  frozenset: '',
  isinstance: '',
  type: '',
  id: '',
  open: 'The board has no files.',
  eval: '',
  exec: '',
  compile: '',
  divmod: 'Use // and %.',
  hex: 'Use an f-string: f"{n:x}"',
  bin: 'Use an f-string: f"{n:b}"',
  oct: '',
  repr: 'Use str().',
  format: 'Use an f-string: f"{x:.2f}"',
  iter: '',
  next: '',
  hash: '',
  callable: '',
  super: '',
  exit: 'The program ends at its last line (when it has no while True loop).',
  quit: 'The program ends at its last line (when it has no while True loop).',
  getattr: '',
  setattr: '',
  hasattr: '',
  delattr: '',
  globals: '',
  locals: '',
  vars: '',
  dir: '',
  help: '',
  object: '',
  property: '',
  staticmethod: '',
  classmethod: '',
  bytes: 'Use text.',
  bytearray: 'Use a list of whole numbers.',
  memoryview: '',
  complex: '',
  slice: '',
  ascii: 'Use str().',
  aiter: '',
  anext: '',
  breakpoint: '',
  __import__: 'Use import.',
};

/** Python's exception names: `raise Name(...)` and `except Name:` may use them (they are names of the builtins module). */
export const EXCEPTION_NAMES: ReadonlySet<string> = new Set([
  'BaseException', 'Exception', 'ArithmeticError', 'AssertionError', 'AttributeError', 'EOFError', 'IndexError', 'KeyError',
  'KeyboardInterrupt', 'LookupError', 'MemoryError', 'NameError', 'NotImplementedError', 'OSError', 'OverflowError',
  'RuntimeError', 'StopIteration', 'SyntaxError', 'SystemExit', 'TypeError', 'ValueError', 'ZeroDivisionError',
  'RecursionError', 'TimeoutError', 'UnicodeError', 'IOError', 'EnvironmentError', 'ImportError', 'ModuleNotFoundError',
  'IndentationError', 'TabError', 'UnboundLocalError', 'FloatingPointError', 'ConnectionError', 'FileNotFoundError',
  'PermissionError', 'Warning', 'UserWarning', 'DeprecationWarning', 'RuntimeWarning',
]);

// ---------------------------------------------------------------------------
// completion items (§7.4)
// ---------------------------------------------------------------------------

/** One completion item, shaped like CodeMirror's `Completion` (label, type, detail, info). */
export interface ApiCompletion {
  label: string;
  type: 'namespace' | 'class' | 'function' | 'method' | 'constant' | 'keyword' | 'variable';
  /** The signature (`sleep_ms(ms)`) or the module a name comes from. */
  detail: string;
  /** The one-line doc. */
  info: string;
}

/** What the Python editor offers (§7.4). Refused (NA) names are never in it. */
export interface ApiCompletionTable {
  /** The §2.6 built-in functions. */
  builtins: readonly ApiCompletion[];
  /** The §2.3 keywords ZERO1 Python has (not `try`, `class`, `lambda`, …). */
  keywords: readonly ApiCompletion[];
  /** After `import ` / `from `: the §3 modules. */
  modules: readonly ApiCompletion[];
  /** After `from m import ` and after `m.`: the names of module `m` (`utime` too). */
  moduleMembers: Readonly<Record<string, readonly ApiCompletion[]>>;
  /** After `Pin.`: the class-level names of a part class (`Pin.OUT`, `Pin.IN`, …); `{}` entries for classes without any. */
  classMembers: Readonly<Record<string, readonly ApiCompletion[]>>;
  /** After `x.` where `x = <class>(…)`: the methods of that part, by part name (`Pin`, `ADC`, `DHT`, …). */
  partMembers: Readonly<Record<PartName, readonly ApiCompletion[]>>;
  /** Class name → part name for the scan of `x = Pin(…)` assignments (`DHT22` → `DHT`, `SoftI2C` → `I2C`). */
  constructors: Readonly<Record<string, PartName>>;
}

function memberCompletion(member: ApiMember, detailOwner: string): ApiCompletion | null {
  switch (member.kind) {
    case 'refused':
      return null;
    case 'constant':
      return { label: member.name, type: 'constant', detail: detailOwner, info: member.doc };
    case 'class':
      return { label: member.name, type: 'class', detail: member.signature, info: member.doc };
    default:
      return { label: member.name, type: member.kind, detail: member.signature, info: member.doc };
  }
}

function completions(members: Readonly<Record<string, ApiMember>>, owner: string): ApiCompletion[] {
  return Object.values(members)
    .map((m) => memberCompletion(m, owner))
    .filter((c): c is ApiCompletion => c !== null);
}

/** The ZERO1 Python keywords the editor offers (§2.3 minus what ZERO1 Python refuses, and minus `try`/`except`). */
const COMPLETION_KEYWORDS = ['if', 'elif', 'else', 'while', 'for', 'in', 'def', 'return', 'pass', 'break', 'continue', 'global', 'import', 'from', 'as', 'and', 'or', 'not', 'True', 'False', 'raise', 'assert'];

function buildCompletions(): ApiCompletionTable {
  const moduleMembers: Record<string, ApiCompletion[]> = {};
  for (const [name, module] of Object.entries(API_MODULES)) moduleMembers[name] = completions(module.members, name);
  const classMembers: Record<string, ApiCompletion[]> = {};
  const constructors: Record<string, PartName> = {};
  for (const module of Object.values(API_MODULES)) {
    for (const member of Object.values(module.members)) {
      if (member.kind !== 'class') continue;
      constructors[member.name] = member.part;
      classMembers[member.name] = completions(API_PARTS[member.part].statics, member.name);
    }
  }
  const partMembers = {} as Record<PartName, ApiCompletion[]>;
  for (const part of Object.values(API_PARTS)) partMembers[part.name] = completions(part.methods, part.name);
  return {
    builtins: Object.entries(BUILTINS).map(([label, b]) => ({ label, type: 'function', detail: b.signature, info: b.doc })),
    keywords: COMPLETION_KEYWORDS.map((label) => ({ label, type: 'keyword', detail: 'keyword', info: '' })),
    modules: MODULE_NAMES.map((name) => ({ label: name, type: 'namespace', detail: 'module', info: API_MODULES[name].doc })),
    moduleMembers,
    classMembers,
    partMembers,
    constructors,
  };
}

/** The completion items of the Python editor (§7.4): built-ins, keywords, modules and their members, parts and their methods. */
export const API_COMPLETIONS: ApiCompletionTable = buildCompletions();
