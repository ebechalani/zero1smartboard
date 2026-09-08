/**
 * Behaviour tests for the ZERO1 peripheral models (docs/ARCHITECTURE.md §7).
 *
 * The runtime `Board` is replaced by a small fake that stores pin state,
 * broadcasts events and keeps the registered sources, so these tests only
 * exercise the peripherals and the `createZero1Peripherals` /
 * `applyZero1Config` factory logic.
 */
import { describe, expect, it } from 'vitest';
import type {
  BoardConfig,
  BoardEvent,
  BoardListener,
  Clock,
  DhtReading,
  I2CDevice,
  IBoard,
  Peripheral,
  PinMode,
  PinState,
  PulseSource,
  SerialPort,
} from '../src/types';
import { DEFAULT_BOARD_CONFIG, PERIPHERAL_IDS, PIN_COUNT, PWM_PINS, Z1 } from '../src/types';
import {
  ButtonPeripheral,
  BuzzerPeripheral,
  DhtPeripheral,
  LcdPeripheral,
  LedPeripheral,
  MotorPeripheral,
  PotLdrPeripheral,
  RgbPeripheral,
  ServoPeripheral,
  SevenSegPeripheral,
  UltrasonicPeripheral,
  applyZero1Config,
  createZero1Peripherals,
} from '../src/peripherals';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeClock implements Clock {
  private ms = 0;
  now(): number {
    return this.ms;
  }
  micros(): number {
    return Math.floor(this.ms * 1000);
  }
  /** Move virtual time forward by `ms` (fractions allowed: 0.01 ms = 10 µs). */
  advance(ms: number): void {
    this.ms += ms;
  }
  async sleep(ms: number): Promise<void> {
    this.ms += Math.max(0, ms);
  }
  async yield(): Promise<void> {
    this.ms += 0.005;
  }
  reset(): void {
    this.ms = 0;
  }
}

function freshPin(): PinState {
  return { mode: null, level: 0, pwm: null, tone: null, servo: null, inputLevel: null, analogInput: null };
}

const silentSerial: SerialPort = {
  write: () => {},
  inject: () => {},
  available: () => 0,
  read: () => -1,
  peek: () => -1,
  clear: () => {},
  onTx: () => () => {},
};

class FakeBoard implements IBoard {
  readonly clock = new FakeClock();
  readonly pins: PinState[] = Array.from({ length: PIN_COUNT }, freshPin);
  readonly config: BoardConfig;
  readonly serial = silentSerial;
  readonly peripherals: Peripheral[] = [];
  readonly pulseSources = new Map<number, PulseSource>();
  readonly dhtReaders = new Map<number, () => DhtReading | null>();
  readonly i2cDevices = new Map<number, I2CDevice>();
  private readonly listeners: BoardListener[] = [];

  constructor(config?: Partial<BoardConfig>) {
    this.config = { ...DEFAULT_BOARD_CONFIG, ...config };
  }

  private emit(e: BoardEvent): void {
    for (const listener of [...this.listeners]) listener(e);
  }

  pinMode(pin: number, mode: PinMode): void {
    this.pins[pin].mode = mode;
    if (mode === 'INPUT_PULLUP') this.pins[pin].level = 1;
    this.emit({ type: 'pinMode', pin, mode });
  }

  digitalWrite(pin: number, level: 0 | 1): void {
    const p = this.pins[pin];
    const prev = p.level;
    p.level = level;
    p.pwm = null;
    this.emit({ type: 'digitalWrite', pin, level, prev });
  }

  digitalRead(pin: number): 0 | 1 {
    const p = this.pins[pin];
    return p.inputLevel ?? p.level;
  }

  analogWrite(pin: number, value: number): void {
    value = Math.round(Math.min(255, Math.max(0, value)));
    const p = this.pins[pin];
    if (PWM_PINS.includes(pin)) {
      p.pwm = value;
      p.level = value > 127 ? 1 : 0;
      this.emit({ type: 'analogWrite', pin, value });
    } else {
      p.pwm = null;
      this.emit({ type: 'analogWrite', pin, value });
      this.digitalWrite(pin, value > 127 ? 1 : 0);
    }
  }

  analogRead(pin: number): number {
    const index = pin < 14 ? pin + 14 : pin;
    return this.pins[index].analogInput ?? 0;
  }

  tone(pin: number, freq: number): void {
    this.pins[pin].tone = freq;
    this.emit({ type: 'tone', pin, freq });
  }

  noTone(pin: number): void {
    this.pins[pin].tone = null;
    this.emit({ type: 'tone', pin, freq: null });
  }

  async pulseIn(pin: number, level: 0 | 1, timeoutUs: number): Promise<number> {
    const width = this.pulseSources.get(pin)?.measure(level) ?? 0;
    if (width > 0) {
      await this.clock.sleep(width / 1000);
      return width;
    }
    await this.clock.sleep(timeoutUs / 1000);
    return 0;
  }

  servoWrite(pin: number, angle: number | null): void {
    this.pins[pin].servo = angle;
    this.emit({ type: 'servo', pin, angle });
  }

  pixelsWrite(pin: number, colors: number[]): void {
    this.emit({ type: 'pixels', pin, colors });
  }

  i2cDevice(addr: number): I2CDevice | undefined {
    return this.i2cDevices.get(addr);
  }

  dhtRead(pin: number): DhtReading | null {
    return this.dhtReaders.get(pin)?.() ?? null;
  }

  setDigitalInput(pin: number, level: 0 | 1 | null): void {
    this.pins[pin].inputLevel = level;
  }

  setAnalogInput(pin: number, value: number | null): void {
    this.pins[pin].analogInput = value === null ? null : Math.min(1023, Math.max(0, Math.round(value)));
  }

  registerPulseSource(pin: number, src: PulseSource): void {
    this.pulseSources.set(pin, src);
  }

  registerDht(pin: number, read: () => DhtReading | null): void {
    this.dhtReaders.set(pin, read);
  }

  registerI2CDevice(addr: number, dev: I2CDevice): void {
    this.i2cDevices.set(addr, dev);
  }

  unregisterI2CDevice(addr: number): void {
    this.i2cDevices.delete(addr);
  }

  addPeripheral(p: Peripheral): void {
    this.peripherals.push(p);
    p.attach(this);
  }

  getPeripheral<T extends Peripheral = Peripheral>(id: string): T | undefined {
    return this.peripherals.find((p) => p.id === id) as T | undefined;
  }

  on(listener: BoardListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  reset(): void {
    for (let i = 0; i < PIN_COUNT; i++) this.pins[i] = freshPin();
    for (const p of this.peripherals) p.reset();
    this.emit({ type: 'reset' });
  }

  tick(nowMs: number): void {
    for (const p of this.peripherals) p.tick?.(nowMs);
  }
}

/** Exactly the pin writes Arduino's shiftOut() performs. */
function shiftOut(board: FakeBoard, dataPin: number, clockPin: number, order: 'MSBFIRST' | 'LSBFIRST', value: number): void {
  for (let i = 0; i < 8; i++) {
    const bit = order === 'MSBFIRST' ? (value >> (7 - i)) & 1 : (value >> i) & 1;
    board.digitalWrite(dataPin, bit === 1 ? 1 : 0);
    board.digitalWrite(clockPin, 1);
    board.digitalWrite(clockPin, 0);
  }
}

/** The classic `digitalWrite(latch, LOW); shiftOut(...); digitalWrite(latch, HIGH);` sequence. */
function sendDigit(board: FakeBoard, seg: SevenSegPeripheral, order: 'MSBFIRST' | 'LSBFIRST', value: number): void {
  board.digitalWrite(seg.latchPin, 0);
  shiftOut(board, seg.dataPin, seg.clockPin, order, value);
  board.digitalWrite(seg.latchPin, 1);
}

/** Send a 10 µs trigger pulse the way an ultrasonic sketch does. */
function triggerPing(board: FakeBoard, trigPin: number, highUs = 10): void {
  board.digitalWrite(trigPin, 0);
  board.digitalWrite(trigPin, 1);
  board.clock.advance(highUs / 1000);
  board.digitalWrite(trigPin, 0);
}

function print(lcd: LcdPeripheral, text: string): void {
  for (const ch of text) lcd.writeChar(ch.charCodeAt(0));
}

function rowText(lcd: LcdPeripheral, row: number): string {
  return String.fromCharCode(...lcd.state.chars[row]);
}

const BLANK_ROW = ' '.repeat(16);

// ---------------------------------------------------------------------------
// LED
// ---------------------------------------------------------------------------

describe('LedPeripheral', () => {
  function setup() {
    const board = new FakeBoard();
    const led = new LedPeripheral(PERIPHERAL_IDS.LED_RED, Z1.LED_RED);
    board.addPeripheral(led);
    return { board, led };
  }

  it('follows digitalWrite on its pin', () => {
    const { board, led } = setup();
    expect(led.state).toEqual({ on: false, brightness: 0 });
    board.pinMode(Z1.LED_RED, 'OUTPUT');
    board.digitalWrite(Z1.LED_RED, 1);
    expect(led.state).toEqual({ on: true, brightness: 1 });
    board.digitalWrite(Z1.LED_RED, 0);
    expect(led.state).toEqual({ on: false, brightness: 0 });
  });

  it('ignores other pins', () => {
    const { board, led } = setup();
    board.digitalWrite(Z1.LED_GREEN, 1);
    expect(led.state.on).toBe(false);
  });

  it('dims with PWM on a PWM pin', () => {
    const board = new FakeBoard();
    const led = new LedPeripheral('led-test', 9);
    board.addPeripheral(led);
    board.analogWrite(9, 64);
    expect(led.state.on).toBe(true);
    expect(led.state.brightness).toBeCloseTo(64 / 255);
    board.analogWrite(9, 0);
    expect(led.state).toEqual({ on: false, brightness: 0 });
  });

  it('is on/off only with analogWrite on a non-PWM pin (A1)', () => {
    const { board, led } = setup();
    board.analogWrite(Z1.LED_RED, 200);
    expect(led.state).toEqual({ on: true, brightness: 1 });
    board.analogWrite(Z1.LED_RED, 100);
    expect(led.state).toEqual({ on: false, brightness: 0 });
  });

  it('glows faintly with INPUT_PULLUP', () => {
    const { board, led } = setup();
    board.pinMode(Z1.LED_RED, 'INPUT_PULLUP');
    expect(led.state).toEqual({ on: true, brightness: 0.15 });
  });

  it('turns off on reset', () => {
    const { board, led } = setup();
    board.digitalWrite(Z1.LED_RED, 1);
    board.reset();
    expect(led.state).toEqual({ on: false, brightness: 0 });
  });
});

// ---------------------------------------------------------------------------
// RGB
// ---------------------------------------------------------------------------

describe('RgbPeripheral', () => {
  it('shows the first pixel of a pixels frame on its pin', () => {
    const board = new FakeBoard();
    const rgb = new RgbPeripheral(Z1.RGB);
    board.addPeripheral(rgb);
    board.pixelsWrite(Z1.RGB, [0x112233, 0x445566]);
    expect(rgb.state).toEqual({ r: 0x11, g: 0x22, b: 0x33, count: 2 });
    board.pixelsWrite(Z1.RGB, []);
    expect(rgb.state).toEqual({ r: 0, g: 0, b: 0, count: 0 });
  });

  it('ignores other pins and goes black on reset', () => {
    const board = new FakeBoard();
    const rgb = new RgbPeripheral(Z1.RGB);
    board.addPeripheral(rgb);
    board.pixelsWrite(6, [0xffffff]);
    expect(rgb.state.r).toBe(0);
    board.pixelsWrite(Z1.RGB, [0xff8000]);
    board.reset();
    expect(rgb.state).toEqual({ r: 0, g: 0, b: 0, count: 0 });
  });
});

// ---------------------------------------------------------------------------
// Buzzer
// ---------------------------------------------------------------------------

describe('BuzzerPeripheral', () => {
  function setup(config?: Partial<BoardConfig>) {
    const board = new FakeBoard(config);
    const buzzer = new BuzzerPeripheral(Z1.BUZZER);
    board.addPeripheral(buzzer);
    return { board, buzzer };
  }

  it('active buzzer sounds at 2500 Hz when the pin is HIGH', () => {
    const { board, buzzer } = setup({ buzzerType: 'active' });
    board.digitalWrite(Z1.BUZZER, 1);
    expect(buzzer.state).toEqual({ freq: 2500, level: 1 });
    board.digitalWrite(Z1.BUZZER, 0);
    expect(buzzer.state).toEqual({ freq: null, level: 0 });
  });

  it('passive buzzer stays silent without tone()', () => {
    const { board, buzzer } = setup({ buzzerType: 'passive' });
    board.digitalWrite(Z1.BUZZER, 1);
    expect(buzzer.state).toEqual({ freq: null, level: 1 });
  });

  it('follows tone() and noTone() with either buzzer type', () => {
    for (const buzzerType of ['active', 'passive'] as const) {
      const { board, buzzer } = setup({ buzzerType });
      board.tone(Z1.BUZZER, 440);
      expect(buzzer.state.freq).toBe(440);
      board.noTone(Z1.BUZZER);
      expect(buzzer.state.freq).toBeNull();
    }
  });

  it('tone wins over the active self-sound and refresh() re-reads the setting', () => {
    const { board, buzzer } = setup({ buzzerType: 'active' });
    board.digitalWrite(Z1.BUZZER, 1);
    board.tone(Z1.BUZZER, 880);
    expect(buzzer.state.freq).toBe(880);
    board.noTone(Z1.BUZZER);
    expect(buzzer.state.freq).toBe(2500);
    board.config.buzzerType = 'passive';
    buzzer.refresh();
    expect(buzzer.state.freq).toBeNull();
    expect(buzzer.state.level).toBe(1);
  });

  it('is silent after reset', () => {
    const { board, buzzer } = setup();
    board.tone(Z1.BUZZER, 1000);
    board.reset();
    expect(buzzer.state).toEqual({ freq: null, level: 0 });
  });
});

// ---------------------------------------------------------------------------
// 7-segment / 74HC595
// ---------------------------------------------------------------------------

describe('SevenSegPeripheral', () => {
  const T = true;
  const F = false;

  function setup(config?: Partial<BoardConfig>) {
    const board = new FakeBoard(config);
    const seg = new SevenSegPeripheral(Z1.SEG_DATA, Z1.SEG_LATCH, Z1.SEG_CLK);
    board.addPeripheral(seg);
    return { board, seg };
  }

  it('starts dark', () => {
    const { seg } = setup();
    expect(seg.state).toEqual({ segments: [F, F, F, F, F, F, F, F], latched: 0, shift: 0 });
  });

  it('shifts on clock rising edges and shows the byte on the latch rising edge (Q0=a, cathode)', () => {
    const { board, seg } = setup({ sevenSegOrder: 'Q0=a', sevenSegCommon: 'cathode' });
    board.digitalWrite(seg.latchPin, 0);
    shiftOut(board, seg.dataPin, seg.clockPin, 'MSBFIRST', 0b01011011);
    expect(seg.state.shift).toBe(0x5b);
    expect(seg.state.latched).toBe(0);
    expect(seg.state.segments).toEqual([F, F, F, F, F, F, F, F]);
    board.digitalWrite(seg.latchPin, 1);
    expect(seg.state.latched).toBe(0x5b);
    expect(seg.state.segments).toEqual([T, T, F, T, T, F, T, F]);
  });

  it('maps Q7 to segment a when configured', () => {
    const { board, seg } = setup({ sevenSegOrder: 'Q7=a', sevenSegCommon: 'cathode' });
    sendDigit(board, seg, 'MSBFIRST', 0b01011011);
    expect(seg.state.segments).toEqual([F, T, F, T, T, F, T, T]);
  });

  it('inverts for a common-anode digit', () => {
    const { board, seg } = setup({ sevenSegOrder: 'Q0=a', sevenSegCommon: 'anode' });
    sendDigit(board, seg, 'MSBFIRST', 0b01011011);
    expect(seg.state.segments).toEqual([F, F, T, F, F, T, F, T]);
  });

  it('combines Q7=a with common anode', () => {
    const { board, seg } = setup({ sevenSegOrder: 'Q7=a', sevenSegCommon: 'anode' });
    sendDigit(board, seg, 'MSBFIRST', 0b01011011);
    expect(seg.state.segments).toEqual([T, F, T, F, F, T, F, F]);
  });

  it('LSBFIRST arrives bit-reversed, like the real chip', () => {
    const { board, seg } = setup();
    sendDigit(board, seg, 'LSBFIRST', 0b01011011);
    expect(seg.state.latched).toBe(0b11011010);
  });

  it('only counts edges: writing HIGH twice shifts once', () => {
    const { board, seg } = setup();
    board.digitalWrite(seg.dataPin, 1);
    board.digitalWrite(seg.clockPin, 1);
    board.digitalWrite(seg.clockPin, 1);
    expect(seg.state.shift).toBe(1);
    board.digitalWrite(seg.clockPin, 0);
    board.digitalWrite(seg.clockPin, 1);
    expect(seg.state.shift).toBe(0b11);
  });

  it('refresh() re-applies changed settings to the latched byte', () => {
    const { board, seg } = setup();
    sendDigit(board, seg, 'MSBFIRST', 0b00000001);
    expect(seg.state.segments).toEqual([T, F, F, F, F, F, F, F]);
    board.config.sevenSegOrder = 'Q7=a';
    seg.refresh();
    expect(seg.state.segments).toEqual([F, F, F, F, F, F, F, T]);
  });

  it('clears everything on reset', () => {
    const { board, seg } = setup();
    sendDigit(board, seg, 'MSBFIRST', 0xff);
    board.reset();
    expect(seg.state).toEqual({ segments: [F, F, F, F, F, F, F, F], latched: 0, shift: 0 });
  });
});

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

describe('MotorPeripheral', () => {
  function setup() {
    const board = new FakeBoard();
    const motor = new MotorPeripheral(Z1.MOTOR_IN1);
    board.addPeripheral(motor);
    return { board, motor };
  }

  it('runs while the pin is HIGH and spins at 720 °/s in tick()', () => {
    const { board, motor } = setup();
    expect(motor.state).toEqual({ running: false, speed: 0, angle: 0 });
    board.digitalWrite(Z1.MOTOR_IN1, 1);
    expect(motor.state.running).toBe(true);
    expect(motor.state.speed).toBe(1);
    board.tick(0);
    board.tick(250);
    expect(motor.state.angle).toBeCloseTo(180);
    board.tick(500);
    expect(motor.state.angle).toBeCloseTo(0); // 360 wraps
    board.tick(600);
    expect(motor.state.angle).toBeCloseTo(72);
  });

  it('stops when the pin goes LOW', () => {
    const { board, motor } = setup();
    board.digitalWrite(Z1.MOTOR_IN1, 1);
    board.tick(0);
    board.tick(100);
    const angle = motor.state.angle;
    board.digitalWrite(Z1.MOTOR_IN1, 0);
    expect(motor.state).toMatchObject({ running: false, speed: 0 });
    board.tick(1000);
    expect(motor.state.angle).toBe(angle);
  });

  it('analogWrite on A0 is on/off like the real UNO', () => {
    const { board, motor } = setup();
    board.analogWrite(Z1.MOTOR_IN1, 200);
    expect(motor.state).toMatchObject({ running: true, speed: 1 });
    board.analogWrite(Z1.MOTOR_IN1, 50);
    expect(motor.state).toMatchObject({ running: false, speed: 0 });
  });

  it('stops on reset', () => {
    const { board, motor } = setup();
    board.digitalWrite(Z1.MOTOR_IN1, 1);
    board.reset();
    expect(motor.state.running).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Servo
// ---------------------------------------------------------------------------

describe('ServoPeripheral', () => {
  function setup() {
    const board = new FakeBoard();
    const servo = new ServoPeripheral(Z1.SERVO);
    board.addPeripheral(servo);
    return { board, servo };
  }

  it('attaches on a servo event and slews toward the target at 500 °/s', () => {
    const { board, servo } = setup();
    expect(servo.state).toEqual({ attached: false, target: 90, angle: 90, connected: true });
    board.servoWrite(Z1.SERVO, 180);
    expect(servo.state.attached).toBe(true);
    expect(servo.state.target).toBe(180);
    expect(servo.state.angle).toBe(90);
    board.tick(0);
    board.tick(100);
    expect(servo.state.angle).toBeCloseTo(140);
    board.tick(1000);
    expect(servo.state.angle).toBe(180);
    board.servoWrite(Z1.SERVO, 0);
    board.tick(1100);
    expect(servo.state.angle).toBeCloseTo(130);
  });

  it('clamps the target to 0..180', () => {
    const { board, servo } = setup();
    board.servoWrite(Z1.SERVO, 250);
    expect(servo.state.target).toBe(180);
    board.servoWrite(Z1.SERVO, -10);
    expect(servo.state.target).toBe(0);
  });

  it('records the target but does not move while unplugged', () => {
    const { board, servo } = setup();
    servo.setConnected(false);
    board.servoWrite(Z1.SERVO, 0);
    board.tick(0);
    board.tick(2000);
    expect(servo.state).toMatchObject({ connected: false, target: 0, angle: 90 });
    servo.setConnected(true);
    board.tick(3000);
    expect(servo.state.angle).toBe(0);
  });

  it('detaches on a null angle and stops moving', () => {
    const { board, servo } = setup();
    board.servoWrite(Z1.SERVO, 180);
    board.tick(0);
    board.tick(50);
    board.servoWrite(Z1.SERVO, null);
    expect(servo.state.attached).toBe(false);
    const angle = servo.state.angle;
    board.tick(1000);
    expect(servo.state.angle).toBe(angle);
  });

  it('ignores other pins and detaches on reset', () => {
    const { board, servo } = setup();
    board.servoWrite(6, 0);
    expect(servo.state.attached).toBe(false);
    board.servoWrite(Z1.SERVO, 0);
    board.reset();
    expect(servo.state.attached).toBe(false);
    expect(servo.state.connected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Potentiometer / LDR
// ---------------------------------------------------------------------------

describe('PotLdrPeripheral', () => {
  function setup(config?: Partial<BoardConfig>) {
    const board = new FakeBoard(config);
    const pot = new PotLdrPeripheral(Z1.POT_LDR);
    board.addPeripheral(pot);
    return { board, pot };
  }

  it('presents the potentiometer on A3 by default', () => {
    const { board, pot } = setup();
    expect(pot.state).toEqual({ source: 'pot', pot: 512, light: 60, adc: 512 });
    expect(board.analogRead(3)).toBe(512);
    expect(board.analogRead(Z1.POT_LDR)).toBe(512);
    pot.setPot(300);
    expect(pot.state.adc).toBe(300);
    expect(board.analogRead(3)).toBe(300);
  });

  it('clamps and rounds the knob', () => {
    const { pot } = setup();
    pot.setPot(2000);
    expect(pot.state.pot).toBe(1023);
    pot.setPot(-5);
    expect(pot.state.pot).toBe(0);
    pot.setPot(10.6);
    expect(pot.state.pot).toBe(11);
  });

  it('LDR: brighter-higher maps light 0..100 % to 40..940', () => {
    const { board, pot } = setup({ ldrDirection: 'brighter-higher' });
    pot.setSource('ldr');
    expect(pot.state.adc).toBe(580); // 40 + 0.6 * 900
    pot.setLight(0);
    expect(pot.state.adc).toBe(40);
    pot.setLight(100);
    expect(pot.state.adc).toBe(940);
    expect(board.analogRead(3)).toBe(940);
  });

  it('LDR: brighter-lower maps light 0..100 % to 940..40', () => {
    const { pot } = setup({ ldrDirection: 'brighter-lower' });
    pot.setSource('ldr');
    expect(pot.state.adc).toBe(400); // 940 - 0.6 * 900
    pot.setLight(0);
    expect(pot.state.adc).toBe(940);
    pot.setLight(100);
    expect(pot.state.adc).toBe(40);
  });

  it('the knob is not read while the switch is on LDR, and vice versa', () => {
    const { pot } = setup();
    pot.setSource('ldr');
    pot.setPot(100);
    expect(pot.state.adc).toBe(580);
    pot.setSource('pot');
    expect(pot.state.adc).toBe(100);
  });

  it('refresh() applies a changed ldrDirection', () => {
    const { board, pot } = setup();
    pot.setSource('ldr');
    board.config.ldrDirection = 'brighter-lower';
    pot.refresh();
    expect(pot.state.adc).toBe(400);
  });

  it('presents the value again after a board reset', () => {
    const { board, pot } = setup();
    pot.setPot(700);
    board.reset();
    expect(board.pins[Z1.POT_LDR].analogInput).toBe(700);
    expect(pot.state.pot).toBe(700);
  });
});

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

describe('ButtonPeripheral', () => {
  function setup(config?: Partial<BoardConfig>) {
    const board = new FakeBoard(config);
    const button = new ButtonPeripheral(PERIPHERAL_IDS.BTN_A, Z1.BTN_A);
    board.addPeripheral(button);
    return { board, button, level: () => board.pins[Z1.BTN_A].inputLevel };
  }

  it('pull-down wiring: pressed reads HIGH', () => {
    const { button, level } = setup({ buttonWiring: 'pulldown' });
    expect(level()).toBe(0);
    button.press();
    expect(button.state.pressed).toBe(true);
    expect(level()).toBe(1);
    button.release();
    expect(button.state.pressed).toBe(false);
    expect(level()).toBe(0);
  });

  it('pull-up wiring: pressed reads LOW', () => {
    const { button, level } = setup({ buttonWiring: 'pullup' });
    expect(level()).toBe(1);
    button.press();
    expect(level()).toBe(0);
    button.release();
    expect(level()).toBe(1);
  });

  it('no resistor: released is floating (null), pressed reads LOW', () => {
    const { button, level } = setup({ buttonWiring: 'none' });
    expect(level()).toBeNull();
    button.press();
    expect(level()).toBe(0);
    button.release();
    expect(level()).toBeNull();
  });

  it('click() presses for the given time on the board clock', async () => {
    const { board, button, level } = setup();
    const seen: Array<0 | 1 | null> = [];
    const clicked = button.click(120).then(() => seen.push(level()));
    seen.push(level());
    await clicked;
    expect(seen).toEqual([1, 0]);
    expect(board.clock.now()).toBe(120);
    expect(button.state.pressed).toBe(false);
  });

  it('click() defaults to 80 ms', async () => {
    const { board, button } = setup();
    await button.click();
    expect(board.clock.now()).toBe(80);
  });

  it('refresh() re-drives the pin after the wiring setting changes', () => {
    const { board, button, level } = setup({ buttonWiring: 'pulldown' });
    button.press();
    expect(level()).toBe(1);
    board.config.buttonWiring = 'pullup';
    button.refresh();
    expect(level()).toBe(0);
  });

  it('re-applies the pressed state after a board reset', () => {
    const { board, button, level } = setup();
    button.press();
    board.reset();
    expect(button.state.pressed).toBe(true);
    expect(level()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DHT22
// ---------------------------------------------------------------------------

describe('DhtPeripheral', () => {
  function setup() {
    const board = new FakeBoard();
    const dht = new DhtPeripheral(Z1.DHT22);
    board.addPeripheral(dht);
    return { board, dht };
  }

  it('answers reads with 24.0 °C / 55 % by default', () => {
    const { board, dht } = setup();
    expect(dht.state).toEqual({ temperature: 24, humidity: 55, connected: true });
    expect(board.dhtRead(Z1.DHT22)).toEqual({ temperature: 24, humidity: 55 });
    expect(board.dhtRead(6)).toBeNull();
  });

  it('set() rounds to one decimal and clamps to the sensor range', () => {
    const { board, dht } = setup();
    dht.set(25.678, 42.04);
    expect(board.dhtRead(Z1.DHT22)).toEqual({ temperature: 25.7, humidity: 42 });
    dht.set(-50, 120);
    expect(dht.state).toMatchObject({ temperature: -40, humidity: 100 });
    dht.set(95, -3);
    expect(dht.state).toMatchObject({ temperature: 80, humidity: 0 });
    dht.set(Number.NaN, 30);
    expect(dht.state).toMatchObject({ temperature: 80, humidity: 30 });
  });

  it('fails the read while unplugged', () => {
    const { board, dht } = setup();
    dht.setConnected(false);
    expect(dht.state.connected).toBe(false);
    expect(board.dhtRead(Z1.DHT22)).toBeNull();
    dht.setConnected(true);
    expect(board.dhtRead(Z1.DHT22)).toEqual({ temperature: 24, humidity: 55 });
  });

  it('keeps the room conditions across a reset', () => {
    const { board, dht } = setup();
    dht.set(30, 70);
    board.reset();
    expect(board.dhtRead(Z1.DHT22)).toEqual({ temperature: 30, humidity: 70 });
  });
});

// ---------------------------------------------------------------------------
// Ultrasonic
// ---------------------------------------------------------------------------

describe('UltrasonicPeripheral', () => {
  function setup() {
    const board = new FakeBoard();
    const us = new UltrasonicPeripheral(Z1.US_TRIG, Z1.US_ECHO);
    board.addPeripheral(us);
    const measure = (level: 0 | 1 = 1) => board.pulseSources.get(Z1.US_ECHO)!.measure(level);
    return { board, us, measure };
  }

  it('measures nothing before a trigger', async () => {
    const { board, us, measure } = setup();
    expect(us.state).toEqual({ distanceCm: 50, connected: true, lastPingAt: null });
    expect(measure()).toBe(0);
    const width = await board.pulseIn(Z1.US_ECHO, 1, 30000);
    expect(width).toBe(0);
    expect(board.clock.now()).toBe(30);
  });

  it('a trigger pulse of at least 2 µs produces an echo of distance × 58 µs', async () => {
    const { board, us, measure } = setup();
    board.clock.advance(5);
    triggerPing(board, Z1.US_TRIG, 10);
    expect(us.state.lastPingAt).toBe(board.clock.now());
    expect(measure()).toBe(50 * 58);
    const before = board.clock.now();
    const width = await board.pulseIn(Z1.US_ECHO, 1, 30000);
    expect(width).toBe(2900);
    expect(board.clock.now() - before).toBeCloseTo(2.9);
  });

  it('exactly 2 µs is enough, 1 µs is not', () => {
    const { board, us, measure } = setup();
    triggerPing(board, Z1.US_TRIG, 1);
    expect(us.state.lastPingAt).toBeNull();
    expect(measure()).toBe(0);
    triggerPing(board, Z1.US_TRIG, 2);
    expect(us.state.lastPingAt).not.toBeNull();
    expect(measure()).toBe(2900);
  });

  it('only measures a HIGH pulse', () => {
    const { board, measure } = setup();
    triggerPing(board, Z1.US_TRIG);
    expect(measure(0)).toBe(0);
  });

  it('the echo goes stale 60 ms after the trigger', () => {
    const { board, measure } = setup();
    triggerPing(board, Z1.US_TRIG);
    board.clock.advance(60);
    expect(measure()).toBe(2900);
    board.clock.advance(0.5);
    expect(measure()).toBe(0);
    triggerPing(board, Z1.US_TRIG);
    expect(measure()).toBe(2900);
  });

  it('setDistance() clamps to 2..400 cm', () => {
    const { board, us, measure } = setup();
    triggerPing(board, Z1.US_TRIG);
    us.setDistance(100);
    expect(measure()).toBe(5800);
    us.setDistance(1);
    expect(us.state.distanceCm).toBe(2);
    expect(measure()).toBe(116);
    us.setDistance(1000);
    expect(us.state.distanceCm).toBe(400);
    expect(measure()).toBe(23200);
    us.setDistance(12.5);
    expect(measure()).toBe(725);
  });

  it('records the trigger but returns no echo while unplugged', () => {
    const { board, us, measure } = setup();
    us.setConnected(false);
    triggerPing(board, Z1.US_TRIG);
    expect(us.state.lastPingAt).not.toBeNull();
    expect(measure()).toBe(0);
    us.setConnected(true);
    expect(measure()).toBe(2900);
  });

  it('forgets the trigger on reset but keeps the distance', () => {
    const { board, us, measure } = setup();
    us.setDistance(75);
    triggerPing(board, Z1.US_TRIG);
    board.reset();
    expect(us.state.lastPingAt).toBeNull();
    expect(measure()).toBe(0);
    expect(us.state.distanceCm).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// LCD
// ---------------------------------------------------------------------------

describe('LcdPeripheral', () => {
  function setup(config?: Partial<BoardConfig>) {
    const board = new FakeBoard(config);
    const lcd = new LcdPeripheral(board.config.lcdAddress);
    board.addPeripheral(lcd);
    return { board, lcd };
  }

  it('registers as the I2C device at its address', () => {
    const { board, lcd } = setup();
    expect(lcd.address).toBe(0x27);
    expect(board.i2cDevice(0x27)).toBe(lcd);
    expect(lcd.kind).toBe('lcd');
    expect(lcd.cols).toBe(16);
    expect(lcd.rows).toBe(2);
    expect(lcd.state).toMatchObject({ cols: 16, rows: 2, backlight: false, backlightSwitch: true, displayOn: true });
    expect(rowText(lcd, 0)).toBe(BLANK_ROW);
    expect(rowText(lcd, 1)).toBe(BLANK_ROW);
  });

  it('prints at the cursor and advances it', () => {
    const { lcd } = setup();
    print(lcd, 'Hello');
    expect(rowText(lcd, 0)).toBe('Hello' + ' '.repeat(11));
    expect(lcd.state.cursorCol).toBe(5);
    expect(lcd.state.cursorRow).toBe(0);
    lcd.setCursor(0, 1);
    print(lcd, 'Hi');
    expect(rowText(lcd, 1)).toBe('Hi' + ' '.repeat(14));
    expect(rowText(lcd, 0)).toBe('Hello' + ' '.repeat(11));
  });

  it('setCursor clamps to the 40-column memory and the row count', () => {
    const { lcd } = setup();
    lcd.setCursor(50, 5);
    expect(lcd.state).toMatchObject({ cursorCol: 39, cursorRow: 1 });
    lcd.setCursor(-3, -1);
    expect(lcd.state).toMatchObject({ cursorCol: 0, cursorRow: 0 });
  });

  it('clear() blanks everything and homes the cursor', () => {
    const { lcd } = setup();
    print(lcd, 'abc');
    lcd.setCursor(2, 1);
    print(lcd, 'def');
    lcd.scrollDisplayLeft();
    lcd.clear();
    expect(rowText(lcd, 0)).toBe(BLANK_ROW);
    expect(rowText(lcd, 1)).toBe(BLANK_ROW);
    expect(lcd.state).toMatchObject({ cursorCol: 0, cursorRow: 0, scroll: 0 });
  });

  it('writes past column 15 go into hidden memory and wrap to the next row after column 39', () => {
    const { lcd } = setup();
    lcd.setCursor(15, 0);
    print(lcd, 'XY');
    expect(rowText(lcd, 0)).toBe(' '.repeat(15) + 'X');
    expect(lcd.state.cursorCol).toBe(17);
    lcd.setCursor(39, 0);
    print(lcd, 'AB');
    expect(lcd.state).toMatchObject({ cursorCol: 1, cursorRow: 0 + 1 });
    expect(rowText(lcd, 1)).toBe('B' + ' '.repeat(15));
    expect(rowText(lcd, 0)).toBe(' '.repeat(15) + 'X');
  });

  it('scrollDisplayLeft/Right move the visible window over the memory', () => {
    const { lcd } = setup();
    print(lcd, 'Hello');
    lcd.setCursor(16, 0);
    print(lcd, '!');
    lcd.scrollDisplayLeft();
    expect(lcd.state.scroll).toBe(1);
    expect(rowText(lcd, 0)).toBe('ello' + ' '.repeat(11) + '!');
    lcd.scrollDisplayRight();
    expect(rowText(lcd, 0)).toBe('Hello' + ' '.repeat(11));
    lcd.scrollDisplayRight();
    expect(lcd.state.scroll).toBe(39);
    expect(rowText(lcd, 0)).toBe(' Hello' + ' '.repeat(10));
    lcd.home();
    expect(lcd.state.scroll).toBe(0);
    expect(rowText(lcd, 0)).toBe('Hello' + ' '.repeat(11));
  });

  it('both rows scroll together', () => {
    const { lcd } = setup();
    print(lcd, 'top');
    lcd.setCursor(0, 1);
    print(lcd, 'bottom');
    lcd.scrollDisplayLeft();
    expect(rowText(lcd, 0)).toBe('op' + ' '.repeat(14));
    expect(rowText(lcd, 1)).toBe('ottom' + ' '.repeat(11));
  });

  it('autoscroll pushes the text left as characters arrive at the right edge', () => {
    const { lcd } = setup();
    lcd.autoscroll(true);
    lcd.setCursor(16, 0);
    print(lcd, 'A');
    expect(lcd.state.scroll).toBe(1);
    expect(rowText(lcd, 0)).toBe(' '.repeat(15) + 'A');
    print(lcd, 'B');
    expect(rowText(lcd, 0)).toBe(' '.repeat(14) + 'AB');
    lcd.autoscroll(false);
    print(lcd, 'C');
    expect(lcd.state.scroll).toBe(2);
    expect(rowText(lcd, 0)).toBe(' '.repeat(14) + 'AB');
  });

  it('rightToLeft() writes backwards from the cursor', () => {
    const { lcd } = setup();
    lcd.setCursor(5, 0);
    lcd.rightToLeft();
    print(lcd, 'ab');
    expect(rowText(lcd, 0)).toBe('    ba' + ' '.repeat(10));
    expect(lcd.state.cursorCol).toBe(3);
    lcd.leftToRight();
    print(lcd, 'c');
    expect(rowText(lcd, 0)).toBe('   cba' + ' '.repeat(10));
  });

  it('createChar() stores 5x8 glyphs that print as codes 0..7', () => {
    const { lcd } = setup();
    const heart = [0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000];
    lcd.createChar(1, heart);
    expect(lcd.state.customChars[1]).toEqual(heart);
    lcd.createChar(0, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(lcd.state.customChars[0]).toEqual(new Array(8).fill(0x1f));
    lcd.writeChar(1);
    expect(lcd.state.chars[0][0]).toBe(1);
    lcd.writeChar(0xdf);
    expect(lcd.state.chars[0][1]).toBe(0xdf);
  });

  it('tracks the backlight, display, cursor and blink flags', () => {
    const { lcd } = setup();
    lcd.backlight(true);
    expect(lcd.state.backlight).toBe(true);
    lcd.backlight(false);
    expect(lcd.state.backlight).toBe(false);
    lcd.setBacklightSwitch(false);
    expect(lcd.state.backlightSwitch).toBe(false);
    lcd.display(false);
    expect(lcd.state.displayOn).toBe(false);
    lcd.cursor(true);
    lcd.blink(true);
    expect(lcd.state).toMatchObject({ cursorVisible: true, blink: true });
  });

  it('reset() returns to power-on state but keeps the physical switch', () => {
    const { board, lcd } = setup();
    print(lcd, 'Hello');
    lcd.backlight(true);
    lcd.cursor(true);
    lcd.blink(true);
    lcd.display(false);
    lcd.createChar(2, [1, 2, 3, 4, 5, 6, 7, 8]);
    lcd.scrollDisplayLeft();
    lcd.setBacklightSwitch(false);
    board.reset();
    expect(rowText(lcd, 0)).toBe(BLANK_ROW);
    expect(lcd.state).toMatchObject({
      backlight: false,
      displayOn: true,
      cursorVisible: false,
      blink: false,
      scroll: 0,
      cursorCol: 0,
      cursorRow: 0,
      backlightSwitch: false,
    });
    expect(lcd.state.customChars[2]).toEqual(new Array(8).fill(0));
    expect(board.i2cDevice(0x27)).toBe(lcd);
  });

  it('setAddress() registers the LCD at the new address', () => {
    const { board, lcd } = setup();
    lcd.setAddress(0x3f);
    expect(lcd.address).toBe(0x3f);
    expect(board.i2cDevice(0x3f)).toBe(lcd);
  });
});

// ---------------------------------------------------------------------------
// ZERO1 board factory
// ---------------------------------------------------------------------------

describe('createZero1Peripherals', () => {
  it('attaches every part on its fixed pin with its PERIPHERAL_IDS id', () => {
    const board = new FakeBoard();
    const parts = createZero1Peripherals(board);
    expect(board.peripherals).toHaveLength(14);
    const expected: Array<[Peripheral, string, number]> = [
      [parts.ledRed, PERIPHERAL_IDS.LED_RED, Z1.LED_RED],
      [parts.ledGreen, PERIPHERAL_IDS.LED_GREEN, Z1.LED_GREEN],
      [parts.ledBuiltin, PERIPHERAL_IDS.LED_BUILTIN, Z1.LED_BUILTIN],
      [parts.rgb, PERIPHERAL_IDS.RGB, Z1.RGB],
      [parts.buzzer, PERIPHERAL_IDS.BUZZER, Z1.BUZZER],
      [parts.motor, PERIPHERAL_IDS.MOTOR, Z1.MOTOR_IN1],
      [parts.servo, PERIPHERAL_IDS.SERVO, Z1.SERVO],
      [parts.potLdr, PERIPHERAL_IDS.POT_LDR, Z1.POT_LDR],
      [parts.buttonA, PERIPHERAL_IDS.BTN_A, Z1.BTN_A],
      [parts.buttonB, PERIPHERAL_IDS.BTN_B, Z1.BTN_B],
      [parts.dht, PERIPHERAL_IDS.DHT, Z1.DHT22],
    ];
    for (const [part, id, pin] of expected) {
      expect(part.id).toBe(id);
      expect((part as Peripheral & { pin: number }).pin).toBe(pin);
      expect(board.getPeripheral(id)).toBe(part);
    }
    expect(parts.sevenSeg).toMatchObject({
      id: PERIPHERAL_IDS.SEVEN_SEG,
      dataPin: Z1.SEG_DATA,
      latchPin: Z1.SEG_LATCH,
      clockPin: Z1.SEG_CLK,
    });
    expect(parts.ultrasonic).toMatchObject({ id: PERIPHERAL_IDS.ULTRASONIC, trigPin: Z1.US_TRIG, echoPin: Z1.US_ECHO });
    expect(parts.lcd.id).toBe(PERIPHERAL_IDS.LCD);
    expect(board.i2cDevice(0x27)).toBe(parts.lcd);
    expect(board.pulseSources.has(Z1.US_ECHO)).toBe(true);
    expect(board.dhtReaders.has(Z1.DHT22)).toBe(true);
    expect(board.pins[Z1.POT_LDR].analogInput).toBe(512);
    expect(board.pins[Z1.BTN_A].inputLevel).toBe(0);
  });

  it('uses the configured LCD address and wiring', () => {
    const board = new FakeBoard({ lcdAddress: 0x3f, buttonWiring: 'pullup' });
    const parts = createZero1Peripherals(board);
    expect(parts.lcd.address).toBe(0x3f);
    expect(board.i2cDevice(0x3f)).toBe(parts.lcd);
    expect(board.i2cDevice(0x27)).toBeUndefined();
    expect(board.pins[Z1.BTN_B].inputLevel).toBe(1);
  });
});

describe('applyZero1Config', () => {
  function setup(config?: Partial<BoardConfig>) {
    const board = new FakeBoard(config);
    const parts = createZero1Peripherals(board);
    return { board, parts };
  }

  it('updates config in place and refreshes the buttons and the POT/LDR', () => {
    const { board, parts } = setup();
    const config = board.config;
    parts.buttonA.press();
    parts.potLdr.setSource('ldr');
    applyZero1Config(board, parts, { buttonWiring: 'pullup', ldrDirection: 'brighter-lower' });
    expect(board.config).toBe(config);
    expect(board.config).toMatchObject({ buttonWiring: 'pullup', ldrDirection: 'brighter-lower' });
    expect(board.pins[Z1.BTN_A].inputLevel).toBe(0);
    expect(board.pins[Z1.BTN_B].inputLevel).toBe(1);
    expect(parts.potLdr.state.adc).toBe(400);
  });

  it('moves the LCD to the new I2C address', () => {
    const { board, parts } = setup();
    applyZero1Config(board, parts, { lcdAddress: 0x3f });
    expect(parts.lcd.address).toBe(0x3f);
    expect(board.i2cDevice(0x3f)).toBe(parts.lcd);
    expect(board.i2cDevice(0x27)).toBeUndefined();
    applyZero1Config(board, parts, { lcdAddress: 0x27 });
    expect(board.i2cDevice(0x27)).toBe(parts.lcd);
    expect(board.i2cDevice(0x3f)).toBeUndefined();
  });

  it('re-evaluates the buzzer and the 7-segment digit', () => {
    const { board, parts } = setup();
    board.digitalWrite(Z1.BUZZER, 1);
    sendDigit(board, parts.sevenSeg, 'MSBFIRST', 0b00000001);
    expect(parts.buzzer.state.freq).toBe(2500);
    expect(parts.sevenSeg.state.segments[0]).toBe(true);
    applyZero1Config(board, parts, { buzzerType: 'passive', sevenSegCommon: 'anode' });
    expect(parts.buzzer.state.freq).toBeNull();
    expect(parts.sevenSeg.state.segments[0]).toBe(false);
    expect(parts.sevenSeg.state.segments[1]).toBe(true);
  });

  it('ignores undefined values and unknown keys', () => {
    const { board, parts } = setup();
    const before = { ...board.config };
    applyZero1Config(board, parts, { buttonWiring: undefined, bogus: 'x' } as Partial<BoardConfig>);
    expect(board.config).toEqual(before);
    expect(board.i2cDevice(0x27)).toBe(parts.lcd);
  });
});
