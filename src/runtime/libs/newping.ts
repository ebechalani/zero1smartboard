/**
 * The `NewPing` ultrasonic library (docs/ARCHITECTURE.md §6.8) for the
 * HC-SR04 header (trig D3, echo D2). A ping is the real trigger sequence on
 * the trig pin followed by a `pulseIn()` on the echo pin, so the ultrasonic
 * peripheral sees exactly what it would on hardware.
 */
import { assertPin } from '../board';
import type { LibContext } from './print';
import { intArg, toNumber } from './print';

/** NewPing.h constants. */
const MAX_SENSOR_DISTANCE_CM = 500;
const US_ROUNDTRIP_CM = 57;
const US_ROUNDTRIP_IN = 146;
/** Microseconds the trigger pulse is held high. */
const TRIGGER_WIDTH_US = 10;
/** Microseconds of LOW before the trigger pulse. */
const TRIGGER_SETTLE_US = 4;
/** Minimum time between two pings of `ping_median()`. */
const PING_MEDIAN_DELAY_MS = 29;
const NO_ECHO = 0;

/** A `NewPing` instance as the sketch sees it. */
export interface ArduinoNewPing {
  ping(maxCm?: unknown): Promise<number>;
  ping_cm(maxCm?: unknown): Promise<number>;
  ping_in(maxCm?: unknown): Promise<number>;
  ping_median(iterations?: unknown, maxCm?: unknown): Promise<number>;
  convert_cm(us: unknown): number;
  convert_in(us: unknown): number;
}

/** `echoTime / US_ROUNDTRIP_x`: the library truncates (its `ROUNDING_ENABLED` switch is off by default). */
function convert(us: number, factor: number): number {
  if (us <= 0) return 0;
  return Math.trunc(us / factor);
}

/** Build the `NewPing` class (`new __rt.NewPing(trig, echo, maxCm)`) for one sketch run. */
export function createNewPingClass(lib: LibContext): new (trig: unknown, echo: unknown, maxCm?: unknown) => ArduinoNewPing {
  const { board, clock } = lib.ctx;

  return class NewPing implements ArduinoNewPing {
    private readonly trig: number;
    private readonly echo: number;
    private readonly maxCm: number;

    constructor(trig: unknown, echo: unknown, maxCm?: unknown) {
      this.trig = assertPin(toNumber(trig));
      this.echo = assertPin(toNumber(echo));
      this.maxCm = maxCm === undefined ? MAX_SENSOR_DISTANCE_CM : Math.max(1, intArg(maxCm));
      board.pinMode(this.trig, 'OUTPUT');
      board.pinMode(this.echo, 'INPUT');
    }

    /** Echo time in microseconds, or 0 when nothing came back within the maximum distance. */
    async ping(maxCm?: unknown): Promise<number> {
      const limitCm = maxCm === undefined ? this.maxCm : Math.max(1, intArg(maxCm));
      // NewPing::set_max_distance: one extra centimetre of margin, capped at the sensor's range.
      const maxEchoUs = (Math.min(limitCm, MAX_SENSOR_DISTANCE_CM) + 1) * US_ROUNDTRIP_CM;
      board.digitalWrite(this.trig, 0);
      await clock.sleep(TRIGGER_SETTLE_US / 1000, lib.ctx.signal);
      board.digitalWrite(this.trig, 1);
      await clock.sleep(TRIGGER_WIDTH_US / 1000, lib.ctx.signal);
      board.digitalWrite(this.trig, 0);
      const width = await board.pulseIn(this.echo, 1, maxEchoUs);
      lib.ctx.throwIfStopped();
      return width > 0 && width <= maxEchoUs ? Math.trunc(width) : NO_ECHO;
    }

    async ping_cm(maxCm?: unknown): Promise<number> {
      return convert(await this.ping(maxCm), US_ROUNDTRIP_CM);
    }

    async ping_in(maxCm?: unknown): Promise<number> {
      return convert(await this.ping(maxCm), US_ROUNDTRIP_IN);
    }

    /**
     * Median echo time of `iterations` pings (default 5) taken ~29 ms apart,
     * ignoring the ones that got no echo. Like the library, the samples are
     * kept in descending order and the middle one is returned.
     */
    async ping_median(iterations?: unknown, maxCm?: unknown): Promise<number> {
      const wanted = iterations === undefined ? 5 : Math.max(1, intArg(iterations));
      const samples: number[] = [];
      for (let i = 0; i < wanted; i++) {
        const start = clock.now();
        const us = await this.ping(maxCm);
        if (us > 0) samples.push(us);
        if (i < wanted - 1) {
          const remaining = PING_MEDIAN_DELAY_MS - (clock.now() - start);
          if (remaining > 0) await clock.sleep(remaining, lib.ctx.signal);
          lib.ctx.throwIfStopped();
        }
      }
      if (samples.length === 0) return NO_ECHO;
      samples.sort((a, b) => b - a);
      return samples[samples.length >> 1] as number;
    }

    convert_cm(us: unknown): number {
      return convert(intArg(us), US_ROUNDTRIP_CM);
    }

    convert_in(us: unknown): number {
      return convert(intArg(us), US_ROUNDTRIP_IN);
    }
  };
}
