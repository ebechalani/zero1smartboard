/**
 * `Wire` (docs/ARCHITECTURE.md §6.9): just enough of the I2C master for the
 * classic address scanner. A transmission succeeds (0) when a device is
 * registered at the address and fails with 2 ("address NACK") otherwise;
 * nothing can be read back because the LCD backpack is write-only.
 */
import type { LibContext } from './print';
import { intArg } from './print';

/** `endTransmission()` results from Wire.h. */
const I2C_OK = 0;
const I2C_ADDRESS_NACK = 2;
const NO_DATA = -1;

/** The `Wire` object as the sketch sees it. */
export interface ArduinoWire {
  begin(address?: unknown): void;
  end(): void;
  setClock(hz: unknown): void;
  beginTransmission(address: unknown): void;
  write(value: unknown, length?: unknown): number;
  endTransmission(sendStop?: unknown): number;
  requestFrom(address: unknown, quantity: unknown, sendStop?: unknown): number;
  available(): number;
  read(): number;
  peek(): number;
  flush(): void;
  onReceive(handler: unknown): void;
  onRequest(handler: unknown): void;
}

/** Build the `Wire` object for one sketch run. */
export function createWire(lib: LibContext): ArduinoWire {
  const { board } = lib.ctx;
  let target: number | null = null;

  return {
    begin(): void {
      // The bus is always ready.
    },
    end(): void {
      target = null;
    },
    setClock(): void {
      // Bus speed does not matter in the simulator.
    },
    beginTransmission(address: unknown): void {
      target = intArg(address) & 0x7f;
    },
    write(value: unknown, length?: unknown): number {
      if (typeof value === 'string') return value.length;
      if (Array.isArray(value)) return length === undefined ? value.length : Math.min(value.length, Math.max(0, intArg(length)));
      return 1;
    },
    endTransmission(): number {
      const address = target;
      target = null;
      if (address === null) return I2C_ADDRESS_NACK;
      return board.i2cDevice(address) ? I2C_OK : I2C_ADDRESS_NACK;
    },
    requestFrom(): number {
      return 0;
    },
    available(): number {
      return 0;
    },
    read(): number {
      return NO_DATA;
    },
    peek(): number {
      return NO_DATA;
    },
    flush(): void {
      // Nothing is buffered.
    },
    onReceive(): void {
      // The UNO is never an I2C slave here.
    },
    onRequest(): void {
      // The UNO is never an I2C slave here.
    },
  };
}
