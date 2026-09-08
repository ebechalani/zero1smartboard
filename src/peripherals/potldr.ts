import type { IBoard, PotLdrPeripheral as PotLdrContract, PotLdrState } from '../types';
import { PERIPHERAL_IDS } from '../types';

const ADC_MAX = 1023;
/** ADC value of the LDR divider at its darkest and brightest (it never reaches the rails). */
const LDR_ADC_MIN = 40;
const LDR_ADC_MAX = 940;

/**
 * The potentiometer and the LDR (light sensor), which share one analog pin
 * through the POT/LDR slide switch.
 *
 * Whatever the switch selects is presented to the board as the pin's ADC
 * value: the knob position directly, or the light level mapped through the
 * LDR divider in the direction given by `config.ldrDirection`. The knob, the
 * light and the switch are physical, so `reset()` keeps them.
 */
export class PotLdrPeripheral implements PotLdrContract {
  readonly id = PERIPHERAL_IDS.POT_LDR;
  readonly state: PotLdrState = { source: 'pot', pot: 512, light: 60, adc: 512 };
  private board: IBoard | null = null;

  constructor(readonly pin: number) {}

  attach(board: IBoard): void {
    this.board = board;
    // A board reset clears every pin, so present the value again once it is done.
    board.on((e) => {
      if (e.type === 'reset') this.refresh();
    });
    this.refresh();
  }

  reset(): void {
    this.refresh();
  }

  setSource(source: 'pot' | 'ldr'): void {
    this.state.source = source;
    this.refresh();
  }

  setPot(value: number): void {
    if (Number.isFinite(value)) this.state.pot = Math.round(Math.min(ADC_MAX, Math.max(0, value)));
    this.refresh();
  }

  setLight(percent: number): void {
    if (Number.isFinite(percent)) this.state.light = Math.min(100, Math.max(0, percent));
    this.refresh();
  }

  /** Recompute the ADC value (after a setter or a `config.ldrDirection` change) and present it to the board. */
  refresh(): void {
    this.state.adc = this.state.source === 'pot' ? this.state.pot : this.ldrAdc();
    this.board?.setAnalogInput(this.pin, this.state.adc);
  }

  private ldrAdc(): number {
    const span = (this.state.light / 100) * (LDR_ADC_MAX - LDR_ADC_MIN);
    const brighterHigher = (this.board?.config.ldrDirection ?? 'brighter-higher') === 'brighter-higher';
    return Math.round(brighterHigher ? LDR_ADC_MIN + span : LDR_ADC_MAX - span);
  }
}
