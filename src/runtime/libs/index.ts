/**
 * Library emulations (docs/ARCHITECTURE.md §6): everything a sketch reaches
 * after an `#include` — `Serial`, `String` and the C string functions,
 * `Servo`, `LiquidCrystal_I2C`, `DHT`, `Adafruit_NeoPixel`, `NewPing` and
 * `Wire` — built fresh for each sketch run and merged into `__rt`.
 */
import type { RuntimeContext } from '../../types';
import { createDht } from './dht';
import { createLcdClasses } from './lcd';
import { createNeoPixel } from './neopixel';
import { createNewPingClass } from './newping';
import { createLibContext } from './print';
import { createSerial } from './serial';
import { createServoClass } from './servo';
import { createStrings } from './strings';
import { createWire } from './wire';

/** Build every library object, class, constant and string helper for one sketch run. */
export function createLibs(ctx: RuntimeContext): Record<string, unknown> {
  const lib = createLibContext(ctx);
  return {
    Serial: createSerial(lib),
    ...createStrings(lib),
    Servo: createServoClass(lib),
    ...createLcdClasses(lib),
    ...createDht(lib),
    ...createNeoPixel(lib),
    NewPing: createNewPingClass(lib),
    Wire: createWire(lib),
  };
}
