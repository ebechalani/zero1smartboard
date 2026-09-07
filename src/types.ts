/**
 * Shared contracts for the ZERO1 Smart Board simulator.
 *
 * Every module (transpiler, runtime, peripherals, UI) imports from this file and
 * MUST NOT change these interfaces without updating docs/ARCHITECTURE.md.
 *
 * Pin numbering follows the Arduino UNO: 0..13 are digital pins D0..D13,
 * 14..19 are the analog pins A0..A5 (which can also be used as digital I/O).
 */

// ---------------------------------------------------------------------------
// Board constants
// ---------------------------------------------------------------------------

export const PIN_COUNT = 20;

/** Arduino analog pin aliases. */
export const A = { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19 } as const;

/** ZERO1 Smart Board pin map (from the "Create the bridge" lesson table). */
export const Z1 = {
  POT_LDR: 17, // A3  - potentiometer OR LDR, selected by the POT/LDR jumper
  BTN_A: 6, //   D6  - push button A ("Button 1")
  BTN_B: 7, //   D7  - push button B ("Button 2")
  MOTOR_IN1: 14, // A0 - motor driver IN1 (DC motor on/off)
  SERVO: 4, //   D4  - servo signal (external servo header)
  LCD_SDA: 18, // A4 - I2C SDA (LCD 16x2)
  LCD_SCL: 19, // A5 - I2C SCL (LCD 16x2)
  LED_RED: 15, // A1
  LED_GREEN: 16, // A2
  RGB: 9, //     D9  - single-wire addressable RGB LED (WS2812 / NeoPixel)
  DHT22: 5, //   D5  - DHT22 data (external header)
  BUZZER: 8, //  D8
  US_ECHO: 2, // D2  - HC-SR04 echo (external header)
  US_TRIG: 3, // D3  - HC-SR04 trig
  SEG_DATA: 12, // D12 - 74HC595 DS (serial data)
  SEG_LATCH: 11, // D11 - 74HC595 ST_CP (latch)
  SEG_CLK: 10, // D10 - 74HC595 SH_CP (clock)
  TX: 0, //      D0
  RX: 1, //      D1
  LED_BUILTIN: 13,
} as const;

/** Pins that support hardware PWM (analogWrite) on the UNO. */
export const PWM_PINS: readonly number[] = [3, 5, 6, 9, 10, 11];

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/**
 * Time source for the runtime. RealClock wraps performance.now()/setTimeout;
 * VirtualClock advances instantly (for deterministic tests).
 */
export interface Clock {
  /** Milliseconds since the clock was created/reset (fractional). */
  now(): number;
  /** Microseconds since the clock was created/reset (integer). */
  micros(): number;
  /**
   * Resolve after `ms` milliseconds (fractional allowed; values < 1 may busy-wait
   * in a RealClock). If `signal` aborts, resolve early (never reject).
   * VirtualClock advances its time by `ms` immediately.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /**
   * Give the host event loop a turn (macrotask yield in RealClock; in a
   * VirtualClock this resolves immediately but advances time by a tiny amount so
   * that busy loops still make virtual time progress).
   */
  yield(): Promise<void>;
  /** Reset the epoch so that now() === 0. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Pins & board
// ---------------------------------------------------------------------------

export type PinMode = 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP';

export interface PinState {
  /** null until pinMode() is called (power-on default is a floating input). */
  mode: PinMode | null;
  /** Last level written with digitalWrite() (or 1 while INPUT_PULLUP). */
  level: 0 | 1;
  /** Duty 0..255 when analogWrite() was used on a PWM-capable pin, else null. */
  pwm: number | null;
  /** Frequency in Hz while tone() is active on this pin, else null. */
  tone: number | null;
  /** Servo angle (0..180) while a Servo is attached and written, else null. */
  servo: number | null;
  /** Level driven by an external device (button etc.), null = nothing driving. */
  inputLevel: 0 | 1 | null;
  /** ADC value 0..1023 driven by an external device, null = nothing connected. */
  analogInput: number | null;
}

export interface BoardConfig {
  /**
   * How the on-board push buttons are wired.
   *  - 'pulldown': external pull-down resistor, pressed reads HIGH (default).
   *  - 'pullup':   external pull-up resistor, pressed reads LOW.
   *  - 'none':     button to GND only; needs INPUT_PULLUP, pressed reads LOW.
   */
  buttonWiring: 'pulldown' | 'pullup' | 'none';
  /** 'cathode': a 1 bit lights a segment (default). 'anode': a 0 bit lights it. */
  sevenSegCommon: 'cathode' | 'anode';
  /** Which 74HC595 output drives segment a. 'Q0=a' means Q0..Q6 = a..g, Q7 = dp. */
  sevenSegOrder: 'Q0=a' | 'Q7=a';
  /** I2C address of the on-board LCD backpack. */
  lcdAddress: 0x27 | 0x3f;
  /** 'active' (default, the on-board part has a '+' marking) sounds whenever the pin is HIGH and also follows tone(); 'passive' needs tone(). */
  buzzerType: 'passive' | 'active';
  /** ADC value rises with light ('brighter-higher', default) or falls. */
  ldrDirection: 'brighter-higher' | 'brighter-lower';
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  buttonWiring: 'pulldown',
  sevenSegCommon: 'cathode',
  sevenSegOrder: 'Q0=a',
  lcdAddress: 0x27,
  buzzerType: 'active',
  ldrDirection: 'brighter-higher',
};

/** Events emitted synchronously by the board whenever the sketch drives it. */
export type BoardEvent =
  | { type: 'pinMode'; pin: number; mode: PinMode }
  | { type: 'digitalWrite'; pin: number; level: 0 | 1; prev: 0 | 1 }
  | { type: 'analogWrite'; pin: number; value: number }
  | { type: 'tone'; pin: number; freq: number | null }
  | { type: 'servo'; pin: number; angle: number | null }
  | { type: 'pixels'; pin: number; colors: number[] }
  | { type: 'serialTx'; text: string }
  | { type: 'reset' };

export type BoardListener = (e: BoardEvent) => void;

/** Source of an echo pulse for pulseIn() (implemented by the ultrasonic peripheral). */
export interface PulseSource {
  /**
   * Return the pulse width in microseconds that pulseIn(pin, level) would
   * measure right now, or 0 if no pulse will arrive (caller then waits the timeout).
   */
  measure(level: 0 | 1): number;
}

export interface DhtReading {
  temperature: number; // °C
  humidity: number; // %
}

/** High-level model of an HD44780 LCD behind an I2C backpack. */
export interface LcdDevice {
  readonly kind: 'lcd';
  readonly cols: number;
  readonly rows: number;
  clear(): void;
  home(): void;
  setCursor(col: number, row: number): void;
  /** Write one character code (0..255) at the cursor and advance it. Codes 0..7 are custom chars. */
  writeChar(code: number): void;
  backlight(on: boolean): void;
  display(on: boolean): void;
  cursor(on: boolean): void;
  blink(on: boolean): void;
  createChar(index: number, bitmap: number[]): void;
  scrollDisplayLeft(): void;
  scrollDisplayRight(): void;
  autoscroll(on: boolean): void;
  leftToRight(): void;
  rightToLeft(): void;
}

export type I2CDevice = LcdDevice;

/** A simulated hardware part attached to the board. */
export interface Peripheral {
  /** Stable id, e.g. 'led-red'. */
  readonly id: string;
  /** Called once when added to a board. Subscribe to events / register sources here. */
  attach(board: IBoard): void;
  /** Return to power-on state (called by board.reset()). */
  reset(): void;
  /** Optional animation step (servo slew, motor spin). Called by the UI frame loop and tests. */
  tick?(nowMs: number): void;
}

export interface SerialPort {
  /** Called by the runtime when the sketch prints. */
  write(text: string): void;
  /** Called by the UI (serial monitor input). Appends to the RX buffer. */
  inject(text: string): void;
  /** Bytes waiting in the RX buffer. */
  available(): number;
  /** Pop one byte (0..255) from the RX buffer, or -1 if empty. */
  read(): number;
  /** Look at the next byte without removing it, or -1. */
  peek(): number;
  /** Clear both buffers. */
  clear(): void;
  /** Subscribe to text written by the sketch. Returns an unsubscribe function. */
  onTx(listener: (text: string) => void): () => void;
}

export interface IBoard {
  readonly clock: Clock;
  readonly pins: readonly PinState[]; // length PIN_COUNT
  readonly config: BoardConfig;
  readonly serial: SerialPort;
  readonly peripherals: readonly Peripheral[];

  // --- called by the Arduino core runtime ---
  pinMode(pin: number, mode: PinMode): void;
  digitalWrite(pin: number, level: 0 | 1): void;
  /** Applies pull-ups, external wiring and driven levels; floating pins read pseudo-random garbage. */
  digitalRead(pin: number): 0 | 1;
  /** value 0..255. On non-PWM pins behaves like the real UNO: HIGH if value > 127 else LOW. */
  analogWrite(pin: number, value: number): void;
  /** pin may be 0..5 (meaning A0..A5) or 14..19. Returns 0..1023. Unconnected pins read noise. */
  analogRead(pin: number): number;
  tone(pin: number, freq: number): void;
  noTone(pin: number): void;
  /** Width in µs from the registered PulseSource, or 0 after waiting `timeoutUs` (via clock.sleep). */
  pulseIn(pin: number, level: 0 | 1, timeoutUs: number): Promise<number>;

  // --- called by library emulations ---
  servoWrite(pin: number, angle: number | null): void;
  pixelsWrite(pin: number, colors: number[]): void;
  i2cDevice(addr: number): I2CDevice | undefined;
  dhtRead(pin: number): DhtReading | null;

  // --- called by peripherals ---
  setDigitalInput(pin: number, level: 0 | 1 | null): void;
  setAnalogInput(pin: number, value: number | null): void;
  registerPulseSource(pin: number, src: PulseSource): void;
  registerDht(pin: number, read: () => DhtReading | null): void;
  registerI2CDevice(addr: number, dev: I2CDevice): void;
  addPeripheral(p: Peripheral): void;
  getPeripheral<T extends Peripheral = Peripheral>(id: string): T | undefined;

  /** Subscribe to board events. Returns an unsubscribe function. */
  on(listener: BoardListener): () => void;
  /** Reset pins, serial buffers and all peripherals; emits {type:'reset'}. Does not reset the clock. */
  reset(): void;
  /** Convenience: run tick() on every peripheral that has one. */
  tick(nowMs: number): void;
}

// ---------------------------------------------------------------------------
// Peripheral state shapes (read by the UI every animation frame)
// ---------------------------------------------------------------------------

export interface LedState {
  on: boolean;
  /** 0..1 (PWM duty / 255, or 1 when driven HIGH). */
  brightness: number;
}
export interface LedPeripheral extends Peripheral {
  readonly pin: number;
  readonly state: LedState;
}

export interface RgbState {
  /** Displayed colour after brightness scaling, 0..255 each. */
  r: number;
  g: number;
  b: number;
  /** Number of pixels the sketch declared (the board has 1; extra pixels are ignored). */
  count: number;
}
export interface RgbPeripheral extends Peripheral {
  readonly pin: number;
  readonly state: RgbState;
}

export interface BuzzerState {
  /** Frequency being sounded, or null when silent. */
  freq: number | null;
  /** Raw pin level (for active buzzer mode / manual toggling). */
  level: 0 | 1;
}
export interface BuzzerPeripheral extends Peripheral {
  readonly pin: number;
  readonly state: BuzzerState;
}

export interface SevenSegState {
  /** Lit segments in order a,b,c,d,e,f,g,dp. */
  segments: boolean[];
  /** Byte currently in the 74HC595 output (latched) register. */
  latched: number;
  /** Byte currently in the 74HC595 shift register (not yet latched). */
  shift: number;
}
export interface SevenSegPeripheral extends Peripheral {
  readonly dataPin: number;
  readonly latchPin: number;
  readonly clockPin: number;
  readonly state: SevenSegState;
}

export interface MotorState {
  running: boolean;
  /** 0..1 */
  speed: number;
  /** Rotor angle in degrees for the animation (advanced by tick()). */
  angle: number;
}
export interface MotorPeripheral extends Peripheral {
  readonly pin: number;
  readonly state: MotorState;
}

export interface ServoState {
  attached: boolean;
  /** Angle commanded by the sketch. */
  target: number;
  /** Current horn angle (slews towards target in tick()). */
  angle: number;
  /** Whether the external servo module is plugged into the header. */
  connected: boolean;
}
export interface ServoPeripheral extends Peripheral {
  readonly pin: number;
  readonly state: ServoState;
  setConnected(on: boolean): void;
}

export interface PotLdrState {
  /** Jumper position. */
  source: 'pot' | 'ldr';
  /** Potentiometer position 0..1023. */
  pot: number;
  /** Ambient light 0..100 (%). */
  light: number;
  /** The ADC value currently presented on A3. */
  adc: number;
}
export interface PotLdrPeripheral extends Peripheral {
  readonly pin: number;
  readonly state: PotLdrState;
  setSource(source: 'pot' | 'ldr'): void;
  setPot(value: number): void; // 0..1023
  setLight(percent: number): void; // 0..100
}

export interface ButtonState {
  pressed: boolean;
}
export interface ButtonPeripheral extends Peripheral {
  readonly pin: number;
  readonly state: ButtonState;
  press(): void;
  release(): void;
  /** Press then release after `ms` (uses board clock). */
  click(ms?: number): Promise<void>;
}

export interface DhtState {
  temperature: number; // °C
  humidity: number; // %
  connected: boolean;
}
export interface DhtPeripheral extends Peripheral {
  readonly pin: number;
  readonly state: DhtState;
  set(temperature: number, humidity: number): void;
  setConnected(on: boolean): void;
}

export interface UltrasonicState {
  distanceCm: number; // 2..400
  connected: boolean;
  /** clock.now() of the last valid trigger pulse, or null. Used for the "ping" animation. */
  lastPingAt: number | null;
}
export interface UltrasonicPeripheral extends Peripheral {
  readonly trigPin: number;
  readonly echoPin: number;
  readonly state: UltrasonicState;
  setDistance(cm: number): void;
  setConnected(on: boolean): void;
}

export interface LcdState {
  cols: number;
  rows: number;
  backlight: boolean;
  displayOn: boolean;
  cursorCol: number;
  cursorRow: number;
  cursorVisible: boolean;
  blink: boolean;
  /** chars[row][col] = character code (32 = blank). Codes 0..7 index customChars. */
  chars: number[][];
  /** 8 custom glyphs, each 8 rows of 5-bit bitmaps. */
  customChars: number[][];
  /** Horizontal scroll offset applied by scrollDisplayLeft/Right. */
  scroll: number;
  /** Physical 'Backlight' slide switch on the board (default on). Backlight shows only if this AND backlight are true. */
  backlightSwitch: boolean;
}
export interface LcdPeripheral extends Peripheral, LcdDevice {
  readonly address: number;
  readonly state: LcdState;
  setBacklightSwitch(on: boolean): void;
}

/** ids used by createZero1Board(); the UI looks peripherals up by these. */
export const PERIPHERAL_IDS = {
  LED_RED: 'led-red',
  LED_GREEN: 'led-green',
  LED_BUILTIN: 'led-builtin',
  RGB: 'rgb',
  BUZZER: 'buzzer',
  SEVEN_SEG: 'sevenseg',
  MOTOR: 'motor',
  SERVO: 'servo',
  POT_LDR: 'potldr',
  BTN_A: 'button-a',
  BTN_B: 'button-b',
  DHT: 'dht22',
  ULTRASONIC: 'ultrasonic',
  LCD: 'lcd',
} as const;

// ---------------------------------------------------------------------------
// Transpiler
// ---------------------------------------------------------------------------

export interface Diagnostic {
  line: number; // 1-based
  column: number; // 1-based
  message: string;
  severity: 'error' | 'warning';
}

export type TranspileResult =
  | {
      ok: true;
      /**
       * JavaScript source to be used as the body of `new Function('__rt', js)`.
       * It must `return` a Promise resolving to a SketchModule.
       */
      js: string;
      /** lineMap[generatedLine - 1] = source line (1-based) or 0 if unknown. */
      lineMap: number[];
      warnings: Diagnostic[];
    }
  | { ok: false; errors: Diagnostic[]; warnings: Diagnostic[] };

export interface SketchModule {
  setup: () => Promise<void>;
  loop: () => Promise<void>;
  /** Optional Arduino serialEvent() hook, called after loop() when serial data is available. */
  serialEvent?: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface ConsoleMessage {
  level: 'info' | 'warn' | 'error';
  text: string;
  /** Source line (1-based) when known. */
  line?: number;
}

/** Shared services handed to every runtime library / core function. */
export interface RuntimeContext {
  board: IBoard;
  clock: Clock;
  /** Emit a message to the simulator console (not the serial monitor). */
  console(msg: ConsoleMessage): void;
  /** Aborted when the user stops the sketch. */
  signal: AbortSignal;
  /** Throw StopSignal if the sketch has been stopped. */
  throwIfStopped(): void;
  /** Cooperative yield point (used by delay(), blocking reads, loop back-edges). */
  tick(): Promise<void>;
  /** Wall/virtual-time deadline (ms, clock.now() based) after which the executor stops, or null. */
  deadline: number | null;
}

export interface ExecutorOptions {
  board: IBoard;
  onConsole?: (msg: ConsoleMessage) => void;
  /** Stop automatically after this many loop() iterations (tests). */
  maxLoops?: number;
  /** Stop automatically once clock.now() >= this many ms (tests). */
  stopAfterMs?: number;
  /** Source line map for error reporting (from TranspileResult). */
  lineMap?: number[];
}

export type ExecutorStatus = 'idle' | 'running' | 'stopped' | 'error';

export interface IExecutor {
  readonly status: ExecutorStatus;
  readonly loops: number;
  /**
   * Run transpiled JS. Resolves when the sketch stops (by stop(), maxLoops,
   * stopAfterMs, or a runtime error – which is reported through onConsole and
   * sets status to 'error'). Never rejects.
   */
  run(js: string): Promise<void>;
  /** Request a stop; resolves once run() has returned. */
  stop(): Promise<void>;
}
