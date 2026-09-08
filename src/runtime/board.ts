/**
 * Software model of the Arduino UNO the ZERO1 Smart Board is built on
 * (docs/ARCHITECTURE.md §5.2): 20 pins, a serial port and the peripherals
 * attached to it. The Arduino core functions drive the pins, peripherals
 * subscribe to the events this emits, and the UI reads `pins` every frame.
 */
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
} from '../types';
import { DEFAULT_BOARD_CONFIG, PIN_COUNT, PWM_PINS } from '../types';
import { SketchError } from './values';

const PIN_MODES: ReadonlySet<string> = new Set<PinMode>(['INPUT', 'OUTPUT', 'INPUT_PULLUP']);
const ADC_MAX = 1023;
const FIRST_ANALOG_PIN = 14;
const ANALOG_PIN_COUNT = 6;
/** Bytes the RX buffer may hold before the oldest are dropped (the UNO has 64; this is roomier). */
const RX_CAPACITY = 4096;
/** Characters of sketch output kept in `transmitted` (oldest dropped first). */
const TX_CAPACITY = 65536;

/** Human name of a pin as students write it: `13`, `A3`. */
export function pinName(pin: number): string {
  if (Number.isInteger(pin) && pin >= FIRST_ANALOG_PIN && pin < PIN_COUNT) return `A${pin - FIRST_ANALOG_PIN}`;
  return String(pin);
}

/**
 * Validate a pin number the way every core call does: returns the integer
 * pin index (fractions are truncated like a C cast) or throws a `SketchError`
 * telling the student which pins exist.
 */
export function assertPin(pin: number): number {
  const index = Math.trunc(pin);
  if (Number.isInteger(index) && index >= 0 && index < PIN_COUNT) return index;
  throw new SketchError(`pin ${String(pin)} does not exist on the UNO (use 0-13 or A0-A5)`);
}

/** Power-on state of a pin: a floating input. */
function freshPin(): PinState {
  return { mode: null, level: 0, pwm: null, tone: null, servo: null, inputLevel: null, analogInput: null };
}

/** Cheap 32-bit integer hash so floating pins read convincing noise. */
function hash32(x: number): number {
  let h = (x | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The serial port behind D0/D1: what the sketch prints goes to the TX
 * listeners (the Serial Monitor); what the user types is queued in the RX
 * buffer until the sketch reads it.
 */
export class BoardSerial implements SerialPort {
  private rx: number[] = [];
  private rxHead = 0;
  private tx = '';
  private readonly listeners = new Set<(text: string) => void>();

  constructor(private readonly emit: (e: BoardEvent) => void) {}

  /** Everything the sketch wrote since the last `clear()` (capped to the most recent 64 KB). */
  get transmitted(): string {
    return this.tx;
  }

  write(text: string): void {
    if (text.length === 0) return;
    this.tx += text;
    if (this.tx.length > TX_CAPACITY) this.tx = this.tx.slice(this.tx.length - TX_CAPACITY);
    this.emit({ type: 'serialTx', text });
    for (const listener of [...this.listeners]) {
      try {
        listener(text);
      } catch (err) {
        console.error('serial listener failed', err);
      }
    }
  }

  inject(text: string): void {
    for (let i = 0; i < text.length; i++) this.rx.push(text.charCodeAt(i) & 0xff);
    const overflow = this.rx.length - this.rxHead - RX_CAPACITY;
    if (overflow > 0) this.rxHead += overflow;
    this.compact();
  }

  available(): number {
    return this.rx.length - this.rxHead;
  }

  read(): number {
    if (this.available() === 0) return -1;
    const byte = this.rx[this.rxHead++] as number;
    this.compact();
    return byte;
  }

  peek(): number {
    return this.available() === 0 ? -1 : (this.rx[this.rxHead] as number);
  }

  clear(): void {
    this.rx = [];
    this.rxHead = 0;
    this.tx = '';
  }

  onTx(listener: (text: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private compact(): void {
    if (this.rxHead === 0) return;
    if (this.rxHead >= this.rx.length) {
      this.rx = [];
      this.rxHead = 0;
    } else if (this.rxHead > 1024) {
      this.rx = this.rx.slice(this.rxHead);
      this.rxHead = 0;
    }
  }
}

/**
 * An Arduino UNO: pin states, the rules that make reads and writes behave
 * like the real chip (pull-ups, PWM-capable pins, one tone timer, floating
 * inputs reading garbage), the serial port and the attached peripherals.
 * Every change is announced synchronously to the listeners registered with `on()`.
 */
export class Board implements IBoard {
  readonly clock: Clock;
  readonly pins: PinState[];
  readonly config: BoardConfig;
  readonly serial: BoardSerial;
  readonly peripherals: Peripheral[] = [];
  private readonly listeners = new Set<BoardListener>();
  private readonly pulseSources = new Map<number, PulseSource>();
  private readonly dhtReaders = new Map<number, () => DhtReading | null>();
  private readonly i2cDevices = new Map<number, I2CDevice>();

  constructor(clock: Clock, config?: Partial<BoardConfig>) {
    this.clock = clock;
    this.config = { ...DEFAULT_BOARD_CONFIG };
    if (config) {
      for (const [key, value] of Object.entries(config)) {
        if (value !== undefined && key in DEFAULT_BOARD_CONFIG) {
          (this.config as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }
    this.pins = Array.from({ length: PIN_COUNT }, freshPin);
    this.serial = new BoardSerial((e) => this.emit(e));
  }

  // --- called by the Arduino core runtime ---------------------------------

  pinMode(pin: number, mode: PinMode): void {
    const index = assertPin(pin);
    if (!PIN_MODES.has(mode)) {
      throw new SketchError(`pinMode(${pinName(index)}, ...): the mode must be INPUT, OUTPUT or INPUT_PULLUP`);
    }
    const p = this.pin(index);
    p.mode = mode;
    if (mode === 'INPUT_PULLUP') p.level = 1;
    else if (mode === 'INPUT') p.level = 0;
    this.emit({ type: 'pinMode', pin: index, mode });
  }

  digitalWrite(pin: number, level: 0 | 1): void {
    const index = assertPin(pin);
    const p = this.pin(index);
    const next: 0 | 1 = level ? 1 : 0;
    const prev = p.level;
    p.level = next;
    p.pwm = null;
    this.emit({ type: 'digitalWrite', pin: index, level: next, prev });
  }

  digitalRead(pin: number): 0 | 1 {
    const p = this.pin(assertPin(pin));
    if (p.inputLevel !== null) return p.inputLevel;
    if (p.mode === 'OUTPUT') return p.level;
    if (p.mode === 'INPUT_PULLUP' || p.level === 1) return 1;
    return (hash32(this.clock.micros() >> 4) & 1) as 0 | 1;
  }

  analogWrite(pin: number, value: number): void {
    const index = assertPin(pin);
    const p = this.pin(index);
    const duty = Math.min(255, Math.max(0, Math.trunc(value) || 0));
    p.mode = 'OUTPUT';
    if (PWM_PINS.includes(index)) {
      p.pwm = duty;
      p.level = duty > 127 ? 1 : 0;
      this.emit({ type: 'analogWrite', pin: index, value: duty });
      return;
    }
    p.pwm = null;
    this.emit({ type: 'analogWrite', pin: index, value: duty });
    this.digitalWrite(index, duty > 127 ? 1 : 0);
  }

  analogRead(pin: number): number {
    const p = this.pin(analogPinIndex(pin));
    return p.analogInput !== null ? p.analogInput : this.floatingAdc();
  }

  tone(pin: number, freq: number): void {
    const index = assertPin(pin);
    const hz = Math.trunc(freq) || 0;
    if (hz <= 0) {
      this.noTone(index);
      return;
    }
    const busy = this.pins.some((other, i) => i !== index && other.tone !== null);
    if (busy) return;
    this.pin(index).tone = hz;
    this.emit({ type: 'tone', pin: index, freq: hz });
  }

  noTone(pin: number): void {
    const index = assertPin(pin);
    this.pin(index).tone = null;
    this.emit({ type: 'tone', pin: index, freq: null });
  }

  async pulseIn(pin: number, level: 0 | 1, timeoutUs: number): Promise<number> {
    const source = this.pulseSources.get(assertPin(pin));
    if (source) {
      const width = source.measure(level ? 1 : 0);
      if (width > 0) {
        await this.clock.sleep(width / 1000);
        return width;
      }
    }
    await this.clock.sleep(Math.max(0, timeoutUs) / 1000);
    return 0;
  }

  // --- called by library emulations ----------------------------------------

  servoWrite(pin: number, angle: number | null): void {
    const index = assertPin(pin);
    this.pin(index).servo = angle;
    this.emit({ type: 'servo', pin: index, angle });
  }

  pixelsWrite(pin: number, colors: number[]): void {
    this.emit({ type: 'pixels', pin: assertPin(pin), colors: [...colors] });
  }

  i2cDevice(addr: number): I2CDevice | undefined {
    return this.i2cDevices.get(addr);
  }

  dhtRead(pin: number): DhtReading | null {
    const read = this.dhtReaders.get(assertPin(pin));
    return read ? read() : null;
  }

  // --- called by peripherals ------------------------------------------------

  setDigitalInput(pin: number, level: 0 | 1 | null): void {
    this.pin(assertPin(pin)).inputLevel = level === null ? null : level ? 1 : 0;
  }

  setAnalogInput(pin: number, value: number | null): void {
    const p = this.pin(assertPin(pin));
    p.analogInput = value === null ? null : Math.min(ADC_MAX, Math.max(0, Math.round(value) || 0));
  }

  registerPulseSource(pin: number, src: PulseSource): void {
    this.pulseSources.set(assertPin(pin), src);
  }

  registerDht(pin: number, read: () => DhtReading | null): void {
    this.dhtReaders.set(assertPin(pin), read);
  }

  registerI2CDevice(addr: number, dev: I2CDevice): void {
    this.i2cDevices.set(addr, dev);
  }

  /** Remove the device at `addr` (used when the LCD address changes in Settings). */
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
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reset(): void {
    for (const p of this.pins) Object.assign(p, freshPin());
    this.serial.clear();
    for (const p of this.peripherals) {
      try {
        p.reset();
      } catch (err) {
        console.error(`peripheral '${p.id}' failed to reset`, err);
      }
    }
    this.emit({ type: 'reset' });
  }

  tick(nowMs: number): void {
    for (const p of this.peripherals) p.tick?.(nowMs);
  }

  // --- internals -------------------------------------------------------------

  private emit(e: BoardEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(e);
      } catch (err) {
        console.error('board listener failed', err);
      }
    }
  }

  /** State of an already validated pin index. */
  private pin(index: number): PinState {
    return this.pins[index] as PinState;
  }

  /** What an unconnected ADC input reads: a slowly drifting value around mid-scale with a little noise. */
  private floatingAdc(): number {
    const micros = this.clock.micros();
    const seconds = micros / 1e6;
    const drift = 150 * Math.sin(seconds * 0.7) + 60 * Math.sin(seconds * 3.1 + 1);
    const noise = (hash32(micros >> 4) % 17) - 8;
    return Math.min(ADC_MAX, Math.max(0, Math.round(500 + drift + noise)));
  }
}

/** `analogRead` accepts channel numbers 0..5 as well as A0..A5 (14..19). */
function analogPinIndex(pin: number): number {
  const index = Math.trunc(pin);
  if (Number.isInteger(index) && index >= 0 && index < ANALOG_PIN_COUNT) return index + FIRST_ANALOG_PIN;
  if (Number.isInteger(index) && index >= FIRST_ANALOG_PIN && index < PIN_COUNT) return index;
  throw new SketchError(`analogRead(${String(pin)}): that is not an analog pin (use A0-A5)`);
}
