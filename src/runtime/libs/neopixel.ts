/**
 * `Adafruit_NeoPixel` (docs/ARCHITECTURE.md §6.7) for the WS2812 RGB LED on
 * D9. Colours are kept per pixel at full intensity; the global brightness is
 * applied when `show()` sends the frame to the board (`c * (b + 1) >> 8` per
 * channel, exactly like the library scales its buffer).
 */
import { assertPin } from '../board';
import type { LibContext } from './print';
import { intArg, toNumber } from './print';

/** Colour-order and speed constants from Adafruit_NeoPixel.h (their bit layouts). */
export const NEOPIXEL_CONSTANTS: Readonly<Record<string, number>> = {
  NEO_RGB: 0x06,
  NEO_RBG: 0x09,
  NEO_GRB: 0x52,
  NEO_GBR: 0xa1,
  NEO_BRG: 0x58,
  NEO_BGR: 0xa4,
  NEO_RGBW: 0x1b,
  NEO_GRBW: 0x63,
  NEO_KHZ800: 0x0000,
  NEO_KHZ400: 0x0100,
};

const DEFAULT_PIXELS = 1;
const DEFAULT_PIN = 6;
const HUE_RANGE = 65536;
const SHOW_BEFORE_BEGIN = 'pixels.show() called before pixels.begin(): call pixels.begin() in setup()';

/** Adafruit's 2.6 gamma table (`_NeoPixelGammaTable`). */
const GAMMA_TABLE: number[] = Array.from({ length: 256 }, (_, i) => Math.floor(Math.pow(i / 255, 2.6) * 255 + 0.5));
/** Adafruit's 8-bit sine table (`_NeoPixelSineTable`). */
const SINE_TABLE: number[] = Array.from({ length: 256 }, (_, i) => Math.min(255, Math.floor((Math.sin((i * Math.PI) / 128) + 1) * 127.5 + 0.5)));

/** An `Adafruit_NeoPixel` instance as the sketch sees it. */
export interface ArduinoNeoPixel {
  begin(): void;
  show(): void;
  setPixelColor(index: unknown, rOrColor: unknown, g?: unknown, b?: unknown, w?: unknown): void;
  getPixelColor(index: unknown): number;
  Color(r: unknown, g: unknown, b: unknown, w?: unknown): number;
  ColorHSV(hue: unknown, sat?: unknown, val?: unknown): number;
  gamma8(x: unknown): number;
  gamma32(color: unknown): number;
  sine8(x: unknown): number;
  setBrightness(b: unknown): void;
  getBrightness(): number;
  clear(): void;
  fill(color?: unknown, first?: unknown, count?: unknown): void;
  numPixels(): number;
  setPin(pin: unknown): void;
  getPin(): number;
  updateLength(n: unknown): void;
  updateType(type: unknown): void;
  rainbow(firstHue?: unknown, reps?: unknown, sat?: unknown, bri?: unknown, gammify?: unknown): void;
  canShow(): boolean;
}

/** `Adafruit_NeoPixel::Color(r, g, b, w)`: packed `0xWWRRGGBB`. */
export function packColor(r: number, g: number, b: number, w = 0): number {
  return (((w & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;
}

/** `Adafruit_NeoPixel::ColorHSV`: hue 0..65535 around the wheel, saturation and value 0..255. */
export function colorHSV(hue: number, sat = 255, val = 255): number {
  hue &= 0xffff;
  sat &= 0xff;
  val &= 0xff;
  let r: number;
  let g: number;
  let b: number;
  // Remap 0-65535 to 0-1529 (six 255-step sections of the wheel), rounding at the midpoint like the library.
  const h = Math.floor((hue * 1530 + 32768) / 65536);
  if (h < 510) {
    b = 0;
    if (h < 255) {
      r = 255;
      g = h;
    } else {
      r = 510 - h;
      g = 255;
    }
  } else if (h < 1020) {
    r = 0;
    if (h < 765) {
      g = 255;
      b = h - 510;
    } else {
      g = 1020 - h;
      b = 255;
    }
  } else if (h < 1530) {
    g = 0;
    if (h < 1275) {
      r = h - 1020;
      b = 255;
    } else {
      r = 255;
      b = 1530 - h;
    }
  } else {
    r = 255;
    g = 0;
    b = 0;
  }
  const v1 = 1 + val;
  const s1 = 1 + sat;
  const s2 = 255 - sat;
  const scale = (c: number): number => ((((c * s1) >> 8) + s2) * v1) >> 8;
  return packColor(scale(r), scale(g), scale(b));
}

/** `Adafruit_NeoPixel::gamma8`. */
export function gamma8(x: number): number {
  return GAMMA_TABLE[x & 0xff] as number;
}

/** `Adafruit_NeoPixel::gamma32`: gamma-correct every byte of a packed colour. */
export function gamma32(color: number): number {
  const c = color >>> 0;
  return packColor(gamma8((c >>> 16) & 0xff), gamma8((c >>> 8) & 0xff), gamma8(c & 0xff), gamma8((c >>> 24) & 0xff));
}

/** Build the `Adafruit_NeoPixel` class plus the `NEO_*` constants for one sketch run. */
export function createNeoPixel(lib: LibContext): Record<string, unknown> {
  const { board } = lib.ctx;

  class Adafruit_NeoPixel implements ArduinoNeoPixel {
    private pin: number;
    private type: number;
    /** Packed `0xWWRRGGBB` per pixel at full brightness. */
    private pixels: number[];
    /** Stored like the library: 0 = full brightness, otherwise `brightness + 1`. */
    private brightness = 0;
    private begun = false;

    constructor(n?: unknown, pin?: unknown, type?: unknown) {
      this.pixels = new Array<number>(Math.max(0, n === undefined ? DEFAULT_PIXELS : intArg(n))).fill(0);
      this.pin = pin === undefined ? DEFAULT_PIN : intArg(pin);
      this.type = type === undefined ? NEOPIXEL_CONSTANTS.NEO_GRB! : intArg(type);
    }

    begin(): void {
      this.begun = true;
      board.pinMode(assertPin(this.pin), 'OUTPUT');
    }

    /** Send the frame to the LED: every channel scaled by the brightness, W dropped (the board LED has no white channel). */
    show(): void {
      if (!this.begun) {
        lib.warnOnce(SHOW_BEFORE_BEGIN);
        return;
      }
      const colors = this.pixels.map((c) => {
        if (this.brightness === 0) return c & 0xffffff;
        const scale = (v: number): number => (v * this.brightness) >> 8;
        return packColor(scale((c >>> 16) & 0xff), scale((c >>> 8) & 0xff), scale(c & 0xff)) & 0xffffff;
      });
      board.pixelsWrite(assertPin(this.pin), colors);
    }

    setPixelColor(index: unknown, rOrColor: unknown, g?: unknown, b?: unknown, w?: unknown): void {
      const i = intArg(index);
      if (i < 0 || i >= this.pixels.length) return;
      if (g === undefined) {
        this.pixels[i] = intArg(rOrColor) >>> 0;
        return;
      }
      this.pixels[i] = packColor(intArg(rOrColor), intArg(g), intArg(b), w === undefined ? 0 : intArg(w));
    }

    getPixelColor(index: unknown): number {
      const i = intArg(index);
      return i >= 0 && i < this.pixels.length ? (this.pixels[i] as number) : 0;
    }

    Color(r: unknown, g: unknown, b: unknown, w?: unknown): number {
      return packColor(intArg(r), intArg(g), intArg(b), w === undefined ? 0 : intArg(w));
    }

    ColorHSV(hue: unknown, sat?: unknown, val?: unknown): number {
      return colorHSV(intArg(hue), sat === undefined ? 255 : intArg(sat), val === undefined ? 255 : intArg(val));
    }

    gamma8(x: unknown): number {
      return gamma8(intArg(x));
    }

    gamma32(color: unknown): number {
      return gamma32(intArg(color));
    }

    sine8(x: unknown): number {
      return SINE_TABLE[intArg(x) & 0xff] as number;
    }

    setBrightness(b: unknown): void {
      this.brightness = (intArg(b) & 0xff) + 1;
    }

    getBrightness(): number {
      return (this.brightness - 1) & 0xff;
    }

    clear(): void {
      this.pixels.fill(0);
    }

    fill(color?: unknown, first?: unknown, count?: unknown): void {
      const c = color === undefined ? 0 : intArg(color) >>> 0;
      const start = first === undefined ? 0 : intArg(first);
      if (start < 0 || start >= this.pixels.length) return;
      const n = count === undefined ? 0 : intArg(count);
      const end = n > 0 ? Math.min(this.pixels.length, start + n) : this.pixels.length;
      for (let i = start; i < end; i++) this.pixels[i] = c;
    }

    numPixels(): number {
      return this.pixels.length;
    }

    setPin(pin: unknown): void {
      this.pin = intArg(pin);
      if (this.begun) board.pinMode(assertPin(this.pin), 'OUTPUT');
    }

    getPin(): number {
      return this.pin;
    }

    updateLength(n: unknown): void {
      this.pixels = new Array<number>(Math.max(0, intArg(n))).fill(0);
    }

    updateType(type: unknown): void {
      this.type = intArg(type);
    }

    /** Fill the strip with `reps` rainbows starting at `firstHue`, like `Adafruit_NeoPixel::rainbow`. */
    rainbow(firstHue?: unknown, reps?: unknown, sat?: unknown, bri?: unknown, gammify?: unknown): void {
      const start = firstHue === undefined ? 0 : intArg(firstHue);
      const repetitions = reps === undefined ? 1 : intArg(reps);
      const saturation = sat === undefined ? 255 : intArg(sat);
      const value = bri === undefined ? 255 : intArg(bri);
      const gamma = gammify === undefined ? true : toNumber(gammify) !== 0;
      const n = this.pixels.length;
      for (let i = 0; i < n; i++) {
        const hue = (start + Math.trunc((i * repetitions * HUE_RANGE) / n)) & 0xffff;
        let color = colorHSV(hue, saturation, value);
        if (gamma) color = gamma32(color);
        this.pixels[i] = color;
      }
    }

    canShow(): boolean {
      return true;
    }

    /** The colour order/speed flags this strip was declared with (not part of the library API). */
    get stripType(): number {
      return this.type;
    }
  }

  return { Adafruit_NeoPixel, ...NEOPIXEL_CONSTANTS };
}
