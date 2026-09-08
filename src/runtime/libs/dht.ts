/**
 * The Adafruit `DHT` sensor library (docs/ARCHITECTURE.md §6.6) for the
 * DHT22 header on D5. Readings come from the board's registered DHT source;
 * like the real library, a fresh reading is taken at most every 2 seconds
 * unless `force` is passed, and a missing sensor reads `NaN`.
 */
import type { DhtReading } from '../../types';
import { assertPin } from '../board';
import type { LibContext } from './print';
import { intArg, toNumber } from './print';

/** Sensor type constants from DHT.h (`AM2301` is the same part as `DHT21`). */
export const DHT_CONSTANTS: Readonly<Record<string, number>> = {
  DHT11: 11,
  DHT12: 12,
  DHT21: 21,
  DHT22: 22,
  AM2301: 21,
};

/** DHT.h `MIN_INTERVAL`: the sensor cannot be polled faster than this. */
const MIN_INTERVAL_MS = 2000;

/** A `DHT` instance as the sketch sees it. */
export interface ArduinoDht {
  begin(pullTimeUs?: unknown): void;
  read(force?: unknown): boolean;
  readTemperature(isFahrenheit?: unknown, force?: unknown): number;
  readHumidity(force?: unknown): number;
  computeHeatIndex(temperature: unknown, humidity: unknown, isFahrenheit?: unknown): number;
  convertCtoF(c: unknown): number;
  convertFtoC(f: unknown): number;
}

/** `DHT::convertCtoF`. */
export function convertCtoF(c: number): number {
  return c * 1.8 + 32;
}

/** `DHT::convertFtoC`. */
export function convertFtoC(f: number): number {
  return (f - 32) * 0.55555;
}

/** `DHT::computeHeatIndex`: Rothfusz regression with the NOAA adjustments, as in DHT.cpp. */
export function computeHeatIndex(temperature: number, humidity: number, isFahrenheit = true): number {
  let t = isFahrenheit ? temperature : convertCtoF(temperature);
  let hi = 0.5 * (t + 61.0 + (t - 68.0) * 1.2 + humidity * 0.094);
  if (hi > 79) {
    hi =
      -42.379 +
      2.04901523 * t +
      10.14333127 * humidity +
      -0.22475541 * t * humidity +
      -0.00683783 * t * t +
      -0.05481717 * humidity * humidity +
      0.00122874 * t * t * humidity +
      0.00085282 * t * humidity * humidity +
      -0.00000199 * t * t * humidity * humidity;
    if (humidity < 13 && t >= 80.0 && t <= 112.0) {
      hi -= ((13.0 - humidity) * 0.25) * Math.sqrt((17.0 - Math.abs(t - 95.0)) * 0.05882);
    } else if (humidity > 85.0 && t >= 80.0 && t <= 87.0) {
      hi += ((humidity - 85.0) * 0.1) * ((87.0 - t) * 0.2);
    }
  }
  t = hi;
  return isFahrenheit ? t : convertFtoC(t);
}

/** Build the `DHT` class (`new __rt.DHT(pin, type)`) plus the sensor type constants for one run. */
export function createDht(lib: LibContext): Record<string, unknown> {
  const { board, clock } = lib.ctx;

  class DHT implements ArduinoDht {
    private readonly pin: number;
    private readonly type: number;
    private lastReadAt: number | null = null;
    private lastReading: DhtReading | null = null;

    constructor(pin: unknown, type?: unknown) {
      this.pin = assertPin(toNumber(pin));
      this.type = type === undefined ? DHT_CONSTANTS.DHT22! : intArg(type);
    }

    begin(): void {
      board.pinMode(this.pin, 'INPUT_PULLUP');
      this.lastReadAt = null;
    }

    /** Poll the sensor (at most every 2 s unless forced); true when a reading was obtained. */
    read(force?: unknown): boolean {
      const now = clock.now();
      if (!toNumber(force) && this.lastReadAt !== null && now - this.lastReadAt < MIN_INTERVAL_MS) {
        return this.lastReading !== null;
      }
      this.lastReadAt = now;
      this.lastReading = board.dhtRead(this.pin);
      return this.lastReading !== null;
    }

    readTemperature(isFahrenheit?: unknown, force?: unknown): number {
      if (!this.read(force) || !this.lastReading) return Number.NaN;
      const c = this.lastReading.temperature;
      return toNumber(isFahrenheit) !== 0 ? convertCtoF(c) : c;
    }

    readHumidity(force?: unknown): number {
      if (!this.read(force) || !this.lastReading) return Number.NaN;
      return this.lastReading.humidity;
    }

    computeHeatIndex(temperature: unknown, humidity: unknown, isFahrenheit?: unknown): number {
      return computeHeatIndex(toNumber(temperature), toNumber(humidity), isFahrenheit === undefined ? true : toNumber(isFahrenheit) !== 0);
    }

    convertCtoF(c: unknown): number {
      return convertCtoF(toNumber(c));
    }

    convertFtoC(f: unknown): number {
      return convertFtoC(toNumber(f));
    }

    /** The sensor type this object was declared with (not part of the library API; handy for tests). */
    get sensorType(): number {
      return this.type;
    }
  }

  return { DHT, ...DHT_CONSTANTS };
}
