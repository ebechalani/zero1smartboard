/**
 * The Arduino `Servo` library (docs/ARCHITECTURE.md §6.4) for the servo
 * header on D4. Follows Servo.cpp closely: the pulse width in microseconds is
 * the stored state, `write()` converts angles to it and `read()` back.
 */
import { assertPin } from '../board';
import { getServoAttachedCount, setServoAttachedCount } from '../core';
import type { LibContext } from './print';
import { intArg, toNumber } from './print';

/** Servo.h defaults: the pulse widths for 0° and 180° and the width pulsed before the first `write()`. */
const MIN_PULSE_WIDTH = 544;
const MAX_PULSE_WIDTH = 2400;
const DEFAULT_PULSE_WIDTH = 1500;
/** `write(value)` treats values below this as an angle in degrees, like Servo.cpp. */
const ANGLE_LIMIT = MIN_PULSE_WIDTH;
const MAX_ANGLE = 180;

const WRITE_BEFORE_ATTACH = 'Servo.write() called before attach(): call myServo.attach(4) in setup()';

/** A `Servo` instance as the sketch sees it. */
export interface ArduinoServo {
  attach(pin: unknown, min?: unknown, max?: unknown): number;
  detach(): void;
  write(value: unknown): void;
  writeMicroseconds(us: unknown): void;
  read(): number;
  readMicroseconds(): number;
  attached(): boolean;
}

/** Arduino's integer `map()`. */
function map(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return Math.trunc(((x - inMin) * (outMax - outMin)) / (inMax - inMin)) + outMin;
}

/** Build the `Servo` class for one sketch run (`new __rt.Servo()`). */
export function createServoClass(lib: LibContext): new () => ArduinoServo {
  const { board } = lib.ctx;
  let nextIndex = 0;

  return class Servo implements ArduinoServo {
    private readonly index = nextIndex++;
    private pin: number | null = null;
    private minUs = MIN_PULSE_WIDTH;
    private maxUs = MAX_PULSE_WIDTH;
    private pulseUs = DEFAULT_PULSE_WIDTH;

    /** Start driving `pin`; returns this servo's channel number like the library does. */
    attach(pin: unknown, min?: unknown, max?: unknown): number {
      const index = assertPin(toNumber(pin));
      if (this.pin !== null && this.pin !== index) board.servoWrite(this.pin, null);
      const wasAttached = this.pin !== null;
      this.pin = index;
      this.minUs = min === undefined ? MIN_PULSE_WIDTH : intArg(min);
      this.maxUs = max === undefined ? MAX_PULSE_WIDTH : intArg(max);
      if (!(this.minUs < this.maxUs)) {
        this.minUs = MIN_PULSE_WIDTH;
        this.maxUs = MAX_PULSE_WIDTH;
      }
      board.pinMode(index, 'OUTPUT');
      if (!wasAttached) setServoAttachedCount(board, getServoAttachedCount(board) + 1);
      // The library pulses the last written width (1500 µs before any write) as soon as it attaches.
      board.servoWrite(index, this.read());
      return this.index;
    }

    detach(): void {
      if (this.pin === null) return;
      board.servoWrite(this.pin, null);
      this.pin = null;
      setServoAttachedCount(board, getServoAttachedCount(board) - 1);
    }

    /** Angle in degrees (0..180); values of 544 and above are taken as microseconds, like Servo.cpp. */
    write(value: unknown): void {
      let v = intArg(value);
      if (v < ANGLE_LIMIT) {
        v = Math.min(MAX_ANGLE, Math.max(0, v));
        v = map(v, 0, MAX_ANGLE, this.minUs, this.maxUs);
      }
      this.writeMicroseconds(v);
    }

    writeMicroseconds(us: unknown): void {
      this.pulseUs = Math.min(this.maxUs, Math.max(this.minUs, intArg(us)));
      if (this.pin === null) {
        lib.warnOnce(WRITE_BEFORE_ATTACH);
        return;
      }
      board.servoWrite(this.pin, this.read());
    }

    /** The commanded angle (Servo.cpp maps the pulse width back, +1 so that written angles round-trip exactly). */
    read(): number {
      const angle = map(this.pulseUs + 1, this.minUs, this.maxUs, 0, MAX_ANGLE);
      return Math.min(MAX_ANGLE, Math.max(0, angle));
    }

    readMicroseconds(): number {
      return this.pulseUs;
    }

    attached(): boolean {
      return this.pin !== null;
    }
  };
}
