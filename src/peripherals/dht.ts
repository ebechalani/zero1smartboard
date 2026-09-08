import type { DhtPeripheral as DhtContract, DhtReading, DhtState, IBoard } from '../types';
import { PERIPHERAL_IDS } from '../types';

const DEFAULT_TEMPERATURE_C = 24;
const DEFAULT_HUMIDITY = 55;
/** Measuring range of a DHT22. */
const MIN_TEMPERATURE_C = -40;
const MAX_TEMPERATURE_C = 80;
const MIN_HUMIDITY = 0;
const MAX_HUMIDITY = 100;

/**
 * The DHT22 temperature/humidity module plugged into the DHT22 header.
 *
 * Answers the DHT library's reads with the values set from the inputs panel,
 * rounded to the sensor's 0.1 resolution and clamped to its range. When the
 * module is unplugged the reads fail (`null`), so the sketch sees `NaN` just
 * like on real hardware. The room does not change on `reset()`.
 */
export class DhtPeripheral implements DhtContract {
  readonly id = PERIPHERAL_IDS.DHT;
  readonly state: DhtState = {
    temperature: DEFAULT_TEMPERATURE_C,
    humidity: DEFAULT_HUMIDITY,
    connected: true,
  };

  constructor(readonly pin: number) {}

  attach(board: IBoard): void {
    board.registerDht(this.pin, () => this.read());
  }

  reset(): void {
    // Temperature, humidity and the plug are physical: nothing to return to.
  }

  set(temperature: number, humidity: number): void {
    if (Number.isFinite(temperature)) {
      this.state.temperature = roundToTenth(Math.min(MAX_TEMPERATURE_C, Math.max(MIN_TEMPERATURE_C, temperature)));
    }
    if (Number.isFinite(humidity)) {
      this.state.humidity = roundToTenth(Math.min(MAX_HUMIDITY, Math.max(MIN_HUMIDITY, humidity)));
    }
  }

  setConnected(on: boolean): void {
    this.state.connected = on;
  }

  private read(): DhtReading | null {
    if (!this.state.connected) return null;
    return { temperature: this.state.temperature, humidity: this.state.humidity };
  }
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
