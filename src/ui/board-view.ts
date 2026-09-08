/**
 * Interactive view of the ZERO1 Smart Board.
 *
 * `createBoardView()` injects the SVG drawing from `board-svg.ts` into a
 * container, caches every dynamic element by id, and on each `update()` reads
 * the board's pins and peripheral states and patches only the attributes
 * whose value changed (the app calls `update()` every animation frame).
 *
 * Interactions: the two push buttons (pointer, or keys 1 / 2 when nothing is
 * being typed), the potentiometer knob (drag, wheel, arrow keys), the POT/LDR
 * and Backlight slide switches, and the plug-in module headers (click toggles
 * "plugged"). This module never imports the transpiler or the executor.
 */
import type {
  ButtonPeripheral,
  DhtPeripheral,
  LedState,
  ServoPeripheral,
  UltrasonicPeripheral,
} from '../types';
import type { Zero1Board } from '../zero1';
import { BOARD_GEOMETRY, BOARD_IDS, BOARD_SVG, BOARD_VIEWBOX, LCD_GEOMETRY, lcdCellId, lcdGlyphId } from './board-svg';

/** The mounted board drawing. */
export interface BoardView {
  /** Redraw what changed since the last call. Call once per animation frame. */
  update(): void;
  /** Flash the RX LED for a moment (the app calls this when the Serial Monitor sends text to the sketch). */
  pulseRx(): void;
  /** Remove all listeners and the drawing. */
  destroy(): void;
}

/**
 * Mount the board drawing into `container` and wire it to `board`.
 */
export function createBoardView(container: HTMLElement, board: Zero1Board): BoardView {
  return new BoardViewImpl(container, board);
}

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** How long the TX / RX LEDs stay lit after a serial byte. */
const SERIAL_PULSE_MS = 80;
/** LCD cursor blink: 2 Hz, i.e. 250 ms on, 250 ms off. */
const LCD_BLINK_PERIOD_MS = 500;
/** How long the ultrasonic "ping" rings stay visible after a trigger pulse. */
const PING_FADE_MS = 250;
/** Columns of display memory per row on the HD44780 (only 16 are visible). */
const LCD_MEMORY_COLS = 40;

const POT_MAX = 1023;
/** The knob turns through 270 degrees, from -135 (value 0) to +135 (value 1023). */
const POT_SWEEP_DEG = 270;
/** Dragging the pointer this many viewBox units turns the knob from 0 to 1023. */
const POT_DRAG_TRAVEL_UNITS = 300;
const POT_WHEEL_STEP = 16;
const POT_KEY_STEP = 8;
const POT_KEY_PAGE_STEP = 128;

const DISTANCE_MIN_CM = 2;
const DISTANCE_MAX_CM = 400;

/** Opacity of an LED body while off (the coloured plastic is still visible). */
const SMD_LED_OFF_OPACITY = 0.45;
const INDICATOR_LED_OFF_OPACITY = 0.22;
const GLOW_MAX_OPACITY = 0.85;

const LCD_GLASS_ON = '#a4d65e';
const LCD_GLASS_OFF = '#7c8a6c';
const RGB_OFF_FILL = '#e5e7eb';

/**
 * Characters of the HD44780 A00 character ROM that differ from ASCII, plus the
 * few non-ASCII glyphs sketches commonly use (0xDF is the degree sign).
 * Codes without an entry that are outside 32..126 are shown as '?'.
 */
const LCD_GLYPHS: Readonly<Record<number, string>> = {
  0x5c: '¥',
  0x7e: '→',
  0x7f: '←',
  0xdf: '°',
  0xe0: 'α',
  0xe1: 'ä',
  0xe2: 'β',
  0xe3: 'ε',
  0xe4: 'μ',
  0xe5: 'σ',
  0xe6: 'ρ',
  0xe8: '√',
  0xee: 'ñ',
  0xef: 'ö',
  0xf2: 'Θ',
  0xf3: '∞',
  0xf4: 'Ω',
  0xf5: 'ü',
  0xf6: 'Σ',
  0xf7: 'π',
  0xfd: '÷',
  0xff: '█',
};

/** Input types that do not take typed text, so the board keys stay active while they have focus. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

// ---------------------------------------------------------------------------
// DOM patching with change detection
// ---------------------------------------------------------------------------

/** Writes attributes, text and classes only when the value differs from what was last written. */
class DomPatcher {
  private readonly attrs = new WeakMap<Element, Map<string, string>>();
  private readonly texts = new WeakMap<Element, string>();

  attr(el: Element, name: string, value: string | number): void {
    const text = typeof value === 'number' ? formatNumber(value) : value;
    let known = this.attrs.get(el);
    if (!known) {
      known = new Map();
      this.attrs.set(el, known);
    }
    if (known.get(name) === text) return;
    known.set(name, text);
    el.setAttribute(name, text);
  }

  text(el: Element, value: string): void {
    if (this.texts.get(el) === value) return;
    this.texts.set(el, value);
    el.textContent = value;
  }

  cls(el: Element, name: string, on: boolean): void {
    if (el.classList.contains(name) === on) return;
    el.classList.toggle(name, on);
  }

  visible(el: Element, on: boolean): void {
    this.attr(el, 'visibility', on ? 'visible' : 'hidden');
  }
}

/** Numbers are rounded to two decimals so sub-pixel jitter does not cause DOM writes. */
function formatNumber(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function rotate(angle: number, cx: number, cy: number): string {
  return `rotate(${formatNumber(angle)} ${cx} ${cy})`;
}

/** True when the focused element takes typed text (so keys 1 / 2 must not press the board buttons). */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  if ((el as HTMLElement).isContentEditable) return true;
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

interface LedRefs {
  body: Element;
  glow: Element;
  offOpacity: number;
}

interface LcdCellRefs {
  text: Element;
  glyph: Element;
  /** The custom-glyph bitmap last drawn in this cell (to skip rebuilding the path). */
  glyphKey: string;
}

interface PotDrag {
  pointerId: number;
  startX: number;
  startY: number;
  startPot: number;
  /** Rendered pixels per viewBox unit. */
  scale: number;
}

class BoardViewImpl implements BoardView {
  private readonly svg: SVGSVGElement;
  private readonly patch = new DomPatcher();
  private readonly cleanups: (() => void)[] = [];

  private readonly ledOn: LedRefs;
  private readonly ledL: LedRefs;
  private readonly ledTx: LedRefs;
  private readonly ledRx: LedRefs;
  private readonly ledRed: LedRefs;
  private readonly ledGreen: LedRefs;
  private readonly rgb: Element;
  private readonly rgbGlow: Element;
  private readonly segments: Element[];
  private readonly buzzerWaves: Element;
  private readonly buzzerFreq: Element;
  private readonly motorRotor: Element;
  private readonly motorLabel: Element;
  private readonly servoModule: Element;
  private readonly servoHorn: Element;
  private readonly servoAngle: Element;
  private readonly servoStatus: Element;
  private readonly ultrasonicModule: Element;
  private readonly ultrasonicPing: Element;
  private readonly ultrasonicDistance: Element;
  private readonly ultrasonicObstacle: Element;
  private readonly ultrasonicStatus: Element;
  private readonly dhtModule: Element;
  private readonly dhtTemp: Element;
  private readonly dhtHum: Element;
  private readonly dhtStatus: Element;
  private readonly pot: SVGElement;
  private readonly potKnob: Element;
  private readonly potLdrSwitch: Element;
  private readonly potLdrKnob: Element;
  private readonly potLdrLabelPot: Element;
  private readonly potLdrLabelLdr: Element;
  private readonly potLdrValue: Element;
  private readonly ldrRing: Element;
  private readonly buttonA: Element;
  private readonly buttonACap: Element;
  private readonly buttonB: Element;
  private readonly buttonBCap: Element;
  private readonly lcdGlass: Element;
  private readonly lcdCells: Element;
  private readonly lcdCursor: Element;
  private readonly lcdBlink: Element;
  private readonly lcdCellRefs: LcdCellRefs[][];
  private readonly backlightSwitch: Element;
  private readonly backlightKnob: Element;
  /** Plug-in modules: the module cell and the right-edge header both show and toggle "plugged". */
  private readonly plugToggles: { cell: Element; header: Element }[];

  private txUntil = 0;
  private rxUntil = 0;
  /** Buttons currently held through the keyboard (key → peripheral). */
  private readonly keysHeld = new Map<string, ButtonPeripheral>();
  private potDrag: PotDrag | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly board: Zero1Board,
  ) {
    container.innerHTML = BOARD_SVG;
    const svg = container.querySelector<SVGSVGElement>(`#${BOARD_IDS.root}`);
    if (!svg) throw new Error('board view: the board drawing could not be created');
    this.svg = svg;

    const ids = BOARD_IDS;
    this.ledOn = this.led(ids.ledOn, ids.ledOnGlow, INDICATOR_LED_OFF_OPACITY);
    this.ledL = this.led(ids.ledL, ids.ledLGlow, INDICATOR_LED_OFF_OPACITY);
    this.ledTx = this.led(ids.ledTx, ids.ledTxGlow, INDICATOR_LED_OFF_OPACITY);
    this.ledRx = this.led(ids.ledRx, ids.ledRxGlow, INDICATOR_LED_OFF_OPACITY);
    this.ledRed = this.led(ids.ledRed, ids.ledRedGlow, SMD_LED_OFF_OPACITY);
    this.ledGreen = this.led(ids.ledGreen, ids.ledGreenGlow, SMD_LED_OFF_OPACITY);
    this.rgb = this.el(ids.rgb);
    this.rgbGlow = this.el(ids.rgbGlow);
    this.segments = ids.segments.map((id) => this.el(id));
    this.buzzerWaves = this.el(ids.buzzerWaves);
    this.buzzerFreq = this.el(ids.buzzerFreq);
    this.motorRotor = this.el(ids.motorRotor);
    this.motorLabel = this.el(ids.motorLabel);
    this.servoModule = this.el(ids.servoModule);
    this.servoHorn = this.el(ids.servoHorn);
    this.servoAngle = this.el(ids.servoAngle);
    this.servoStatus = this.el(ids.servoStatus);
    this.ultrasonicModule = this.el(ids.ultrasonicModule);
    this.ultrasonicPing = this.el(ids.ultrasonicPing);
    this.ultrasonicDistance = this.el(ids.ultrasonicDistance);
    this.ultrasonicObstacle = this.el(ids.ultrasonicObstacle);
    this.ultrasonicStatus = this.el(ids.ultrasonicStatus);
    this.dhtModule = this.el(ids.dhtModule);
    this.dhtTemp = this.el(ids.dhtTemp);
    this.dhtHum = this.el(ids.dhtHum);
    this.dhtStatus = this.el(ids.dhtStatus);
    this.pot = this.el<SVGElement>(ids.pot);
    this.potKnob = this.el(ids.potKnob);
    this.potLdrSwitch = this.el(ids.potLdrSwitch);
    this.potLdrKnob = this.el(ids.potLdrKnob);
    this.potLdrLabelPot = this.el(ids.potLdrLabelPot);
    this.potLdrLabelLdr = this.el(ids.potLdrLabelLdr);
    this.potLdrValue = this.el(ids.potLdrValue);
    this.ldrRing = this.el(ids.ldrRing);
    this.buttonA = this.el(ids.buttonA);
    this.buttonACap = this.el(ids.buttonACap);
    this.buttonB = this.el(ids.buttonB);
    this.buttonBCap = this.el(ids.buttonBCap);
    this.lcdGlass = this.el(ids.lcdGlass);
    this.lcdCells = this.el(ids.lcdCells);
    this.lcdCursor = this.el(ids.lcdCursor);
    this.lcdBlink = this.el(ids.lcdBlink);
    this.backlightSwitch = this.el(ids.backlightSwitch);
    this.backlightKnob = this.el(ids.backlightKnob);
    this.lcdCellRefs = [];
    for (let row = 0; row < LCD_GEOMETRY.rows; row++) {
      const cells: LcdCellRefs[] = [];
      for (let col = 0; col < LCD_GEOMETRY.cols; col++) {
        cells.push({ text: this.el(lcdCellId(row, col)), glyph: this.el(lcdGlyphId(row, col)), glyphKey: '' });
      }
      this.lcdCellRefs.push(cells);
    }
    this.plugToggles = [
      { cell: this.el(ids.servo), header: this.el(ids.servoHeader) },
      { cell: this.el(ids.ultrasonic), header: this.el(ids.ultrasonicHeader) },
      { cell: this.el(ids.dht), header: this.el(ids.dhtHeader) },
    ];

    this.bindButton(this.buttonA, board.buttonA);
    this.bindButton(this.buttonB, board.buttonB);
    this.bindKeyboardButtons();
    this.bindPot();
    this.bindToggle(this.potLdrSwitch, () => board.potLdr.setSource(board.potLdr.state.source === 'pot' ? 'ldr' : 'pot'));
    this.bindToggle(this.backlightSwitch, () => board.lcd.setBacklightSwitch(!board.lcd.state.backlightSwitch));
    this.bindPlug(this.plugToggles[0], board.servo);
    this.bindPlug(this.plugToggles[1], board.ultrasonic);
    this.bindPlug(this.plugToggles[2], board.dht);

    this.cleanups.push(
      board.on((e) => {
        if (e.type === 'serialTx') this.txUntil = performance.now() + SERIAL_PULSE_MS;
      }),
    );

    this.update();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  update(): void {
    const now = performance.now();
    this.updateUno(now);
    this.updateLeds();
    this.updateRgb();
    this.updateBuzzer();
    this.updateSevenSeg();
    this.updateMotor();
    this.updateServo();
    this.updatePotLdr();
    this.updateButtons();
    this.updateLcd(now);
    this.updateUltrasonic();
    this.updateDht();
  }

  pulseRx(): void {
    this.rxUntil = performance.now() + SERIAL_PULSE_MS;
  }

  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.releaseKeyboardButtons();
    this.container.replaceChildren();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private updateUno(now: number): void {
    this.setLed(this.ledOn, document.body.dataset.running === 'true' ? 1 : 0);
    this.setLedState(this.ledL, this.board.ledBuiltin.state);
    this.setLed(this.ledTx, now < this.txUntil ? 1 : 0);
    this.setLed(this.ledRx, now < this.rxUntil ? 1 : 0);
  }

  private updateLeds(): void {
    this.setLedState(this.ledRed, this.board.ledRed.state);
    this.setLedState(this.ledGreen, this.board.ledGreen.state);
  }

  private setLedState(led: LedRefs, state: LedState): void {
    this.setLed(led, state.on ? clamp(state.brightness, 0, 1) : 0);
  }

  /** `brightness` 0..1: the body fades from its off tint to full colour and the glow follows. */
  private setLed(led: LedRefs, brightness: number): void {
    this.patch.attr(led.body, 'opacity', led.offOpacity + (1 - led.offOpacity) * brightness);
    this.patch.attr(led.glow, 'opacity', GLOW_MAX_OPACITY * brightness);
  }

  private updateRgb(): void {
    const { r, g, b } = this.board.rgb.state;
    const peak = Math.max(r, g, b);
    if (peak === 0) {
      this.patch.attr(this.rgb, 'fill', RGB_OFF_FILL);
      this.patch.attr(this.rgbGlow, 'opacity', 0);
      return;
    }
    const color = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    this.patch.attr(this.rgb, 'fill', color);
    this.patch.attr(this.rgbGlow, 'fill', color);
    this.patch.attr(this.rgbGlow, 'opacity', (GLOW_MAX_OPACITY * peak) / 255);
  }

  private updateBuzzer(): void {
    const freq = this.board.buzzer.state.freq;
    const sounding = freq !== null && freq > 0;
    this.patch.cls(this.buzzerWaves, 'z1-sounding', sounding);
    this.patch.attr(this.buzzerWaves, 'opacity', sounding ? 1 : 0);
    this.patch.text(this.buzzerFreq, sounding ? `${Math.round(freq)} Hz` : '');
  }

  private updateSevenSeg(): void {
    const lit = this.board.sevenSeg.state.segments;
    for (let i = 0; i < this.segments.length; i++) {
      this.patch.cls(this.segments[i], 'z1-on', lit[i] === true);
    }
  }

  private updateMotor(): void {
    const { angle, running } = this.board.motor.state;
    const hub = BOARD_GEOMETRY.motorHub;
    this.patch.attr(this.motorRotor, 'transform', rotate(angle, hub.x, hub.y));
    this.patch.text(this.motorLabel, running ? 'ON' : 'OFF');
    this.patch.attr(this.motorLabel, 'fill-opacity', running ? 1 : 0.7);
  }

  private updateServo(): void {
    const st = this.board.servo.state;
    const shaft = BOARD_GEOMETRY.servoShaft;
    // The horn points straight up at 90°; 0° is to the left and 180° to the right.
    this.patch.attr(this.servoHorn, 'transform', rotate(st.angle - 90, shaft.x, shaft.y));
    this.patch.text(this.servoAngle, `${Math.round(st.angle)}°`);
    const status = !st.connected ? 'unplugged' : st.attached ? 'plugged' : 'plugged · no signal';
    this.setPlugged(this.plugToggles[0], this.servoModule, this.servoStatus, st.connected, status);
  }

  private updatePotLdr(): void {
    const st = this.board.potLdr.state;
    const center = BOARD_GEOMETRY.potCenter;
    const knobAngle = (clamp(st.pot, 0, POT_MAX) / POT_MAX - 0.5) * POT_SWEEP_DEG;
    this.patch.attr(this.potKnob, 'transform', rotate(knobAngle, center.x, center.y));
    this.patch.attr(this.pot, 'aria-valuenow', Math.round(st.pot));

    const isPot = st.source === 'pot';
    this.patch.attr(this.potLdrKnob, 'x', BOARD_GEOMETRY.potLdrKnobX[st.source]);
    this.patch.attr(this.potLdrLabelPot, 'fill-opacity', isPot ? 1 : 0.5);
    this.patch.attr(this.potLdrLabelLdr, 'fill-opacity', isPot ? 0.5 : 1);
    this.patch.attr(
      this.potLdrSwitch,
      'aria-label',
      isPot ? 'POT / LDR switch — A3 reads the potentiometer' : 'POT / LDR switch — A3 reads the light sensor',
    );
    this.patch.text(this.potLdrValue, `A3 = ${Math.round(st.adc)}`);
    this.patch.attr(this.ldrRing, 'opacity', 0.05 + 0.85 * (clamp(st.light, 0, 100) / 100));
  }

  private updateButtons(): void {
    this.setButton(this.buttonA, this.buttonACap, this.board.buttonA.state.pressed);
    this.setButton(this.buttonB, this.buttonBCap, this.board.buttonB.state.pressed);
  }

  private setButton(group: Element, cap: Element, pressed: boolean): void {
    this.patch.cls(cap, 'z1-pressed', pressed);
    this.patch.attr(cap, 'transform', pressed ? 'translate(0 2)' : 'translate(0 0)');
    this.patch.attr(group, 'aria-pressed', pressed ? 'true' : 'false');
  }

  private updateLcd(now: number): void {
    const st = this.board.lcd.state;
    const geo = LCD_GEOMETRY;
    const backlit = st.backlight && st.backlightSwitch;
    this.patch.attr(this.lcdGlass, 'fill', backlit ? LCD_GLASS_ON : LCD_GLASS_OFF);
    this.patch.attr(this.backlightKnob, 'x', BOARD_GEOMETRY.backlightKnobX[st.backlightSwitch ? 'on' : 'off']);
    this.patch.attr(this.backlightSwitch, 'aria-checked', st.backlightSwitch ? 'true' : 'false');

    this.patch.visible(this.lcdCells, st.displayOn);
    if (st.displayOn) {
      const rows = Math.min(geo.rows, st.chars.length);
      for (let row = 0; row < rows; row++) {
        const line = st.chars[row];
        const cols = Math.min(geo.cols, line.length);
        for (let col = 0; col < cols; col++) this.renderLcdCell(row, col, line[col], st.customChars);
      }
    }

    // The cursor lives in display memory; it is only drawn when its column is inside the visible window.
    const visibleCol = (((st.cursorCol - st.scroll) % LCD_MEMORY_COLS) + LCD_MEMORY_COLS) % LCD_MEMORY_COLS;
    const cursorOnScreen = st.displayOn && visibleCol < geo.cols && st.cursorRow >= 0 && st.cursorRow < geo.rows;
    const showUnderline = cursorOnScreen && st.cursorVisible;
    const blinkPhaseOn = Math.floor(now / (LCD_BLINK_PERIOD_MS / 2)) % 2 === 0;
    const showBlock = cursorOnScreen && st.blink && blinkPhaseOn;
    if (showUnderline || showBlock) {
      const x = geo.x0 + visibleCol * geo.pitch;
      const y = geo.rowY[st.cursorRow];
      if (showUnderline) {
        this.patch.attr(this.lcdCursor, 'x', x);
        this.patch.attr(this.lcdCursor, 'y', y + geo.cellH - 3);
      }
      if (showBlock) {
        this.patch.attr(this.lcdBlink, 'x', x);
        this.patch.attr(this.lcdBlink, 'y', y);
      }
    }
    this.patch.visible(this.lcdCursor, showUnderline);
    this.patch.visible(this.lcdBlink, showBlock);
  }

  private renderLcdCell(row: number, col: number, code: number, customChars: number[][]): void {
    const cell = this.lcdCellRefs[row][col];
    // The HD44780 shows its 8 custom glyphs for codes 0..7 and again for 8..15.
    if (code >= 0 && code < 16) {
      const bitmap = customChars[code & 7] ?? [];
      const key = bitmap.join(',');
      if (cell.glyphKey !== key) {
        cell.glyphKey = key;
        this.patch.attr(cell.glyph, 'd', glyphPath(row, col, bitmap));
      }
      this.patch.text(cell.text, '');
      this.patch.visible(cell.glyph, true);
      return;
    }
    this.patch.visible(cell.glyph, false);
    this.patch.text(cell.text, lcdChar(code));
  }

  private updateUltrasonic(): void {
    const st = this.board.ultrasonic.state;
    const bar = BOARD_GEOMETRY.ultrasonicBar;
    const cm = clamp(st.distanceCm, DISTANCE_MIN_CM, DISTANCE_MAX_CM);
    const fraction = (cm - DISTANCE_MIN_CM) / (DISTANCE_MAX_CM - DISTANCE_MIN_CM);
    this.patch.attr(this.ultrasonicObstacle, 'x', bar.x0 + fraction * (bar.x1 - bar.x0));
    this.patch.text(this.ultrasonicDistance, st.connected ? `${Math.round(cm)} cm` : '—');

    let ping = 0;
    if (st.connected && st.lastPingAt !== null) {
      const age = this.board.clock.now() - st.lastPingAt;
      ping = age >= 0 && age < PING_FADE_MS ? 1 - age / PING_FADE_MS : 0;
    }
    this.patch.attr(this.ultrasonicPing, 'opacity', ping);
    this.setPlugged(this.plugToggles[1], this.ultrasonicModule, this.ultrasonicStatus, st.connected);
  }

  private updateDht(): void {
    const st = this.board.dht.state;
    this.patch.text(this.dhtTemp, st.connected ? `${st.temperature.toFixed(1)} °C` : '— °C');
    this.patch.text(this.dhtHum, st.connected ? `${st.humidity.toFixed(1)} %` : '— %');
    this.setPlugged(this.plugToggles[2], this.dhtModule, this.dhtStatus, st.connected);
  }

  private setPlugged(
    toggle: { cell: Element; header: Element },
    module: Element,
    status: Element,
    connected: boolean,
    statusText = connected ? 'plugged' : 'unplugged',
  ): void {
    this.patch.cls(module, 'z1-unplugged', !connected);
    this.patch.text(status, statusText);
    const checked = connected ? 'true' : 'false';
    this.patch.attr(toggle.cell, 'aria-checked', checked);
    this.patch.attr(toggle.header, 'aria-checked', checked);
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  /** Pointer and keyboard (Enter / Space while focused) handling of one push button. */
  private bindButton(group: Element, button: ButtonPeripheral): void {
    const release = (): void => button.release();
    this.listen(group, 'pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      capturePointer(group, e.pointerId);
      button.press();
    });
    this.listen(group, 'pointerup', release);
    this.listen(group, 'pointercancel', release);
    this.listen(group, 'pointerleave', release);
    this.listen(group, 'lostpointercapture', release);
    this.listen(group, 'keydown', (e: KeyboardEvent) => {
      if (!isActivationKey(e) || e.repeat) return;
      e.preventDefault();
      button.press();
    });
    this.listen(group, 'keyup', (e: KeyboardEvent) => {
      if (isActivationKey(e)) button.release();
    });
  }

  /** Keys 1 / 2 hold Button 1 / 2 whenever the student is not typing somewhere. */
  private bindKeyboardButtons(): void {
    const byKey: Record<string, ButtonPeripheral> = { '1': this.board.buttonA, '2': this.board.buttonB };
    this.listen(document, 'keydown', (e: KeyboardEvent) => {
      const button = byKey[e.key];
      if (!button || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      if (this.keysHeld.has(e.key)) return;
      this.keysHeld.set(e.key, button);
      button.press();
    });
    this.listen(document, 'keyup', (e: KeyboardEvent) => {
      const button = this.keysHeld.get(e.key);
      if (!button) return;
      this.keysHeld.delete(e.key);
      button.release();
    });
    // Losing the window (alt-tab) never leaves a button stuck down.
    this.listen(window, 'blur', () => this.releaseKeyboardButtons());
  }

  private releaseKeyboardButtons(): void {
    for (const button of this.keysHeld.values()) button.release();
    this.keysHeld.clear();
  }

  /** Potentiometer knob: drag (right or up increases), mouse wheel and arrow keys. */
  private bindPot(): void {
    const potLdr = this.board.potLdr;
    const el = this.pot;
    const turnTo = (value: number): void => potLdr.setPot(clamp(Math.round(value), 0, POT_MAX));
    const endDrag = (e: PointerEvent): void => {
      if (this.potDrag && this.potDrag.pointerId === e.pointerId) this.potDrag = null;
    };

    this.listen(el, 'pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      capturePointer(el, e.pointerId);
      this.potDrag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPot: potLdr.state.pot,
        scale: this.pixelsPerUnit(),
      };
      if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    });
    this.listen(el, 'pointermove', (e: PointerEvent) => {
      const drag = this.potDrag;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const units = (e.clientX - drag.startX - (e.clientY - drag.startY)) / drag.scale;
      turnTo(drag.startPot + (units / POT_DRAG_TRAVEL_UNITS) * POT_MAX);
    });
    this.listen(el, 'pointerup', endDrag);
    this.listen(el, 'pointercancel', endDrag);
    this.listen(el, 'lostpointercapture', endDrag);
    this.listen(
      el,
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        if (e.deltaY === 0) return;
        turnTo(potLdr.state.pot - Math.sign(e.deltaY) * POT_WHEEL_STEP);
      },
      { passive: false },
    );
    this.listen(el, 'keydown', (e: KeyboardEvent) => {
      const step = potKeyStep(e.key);
      if (step === null) return;
      e.preventDefault();
      if (e.key === 'Home') turnTo(0);
      else if (e.key === 'End') turnTo(POT_MAX);
      else turnTo(potLdr.state.pot + step);
    });
  }

  /** A clickable group that runs `action` on click or on Enter / Space while focused. */
  private bindToggle(el: Element, action: () => void): void {
    this.listen(el, 'click', () => action());
    this.listen(el, 'keydown', (e: KeyboardEvent) => {
      if (!isActivationKey(e) || e.repeat) return;
      e.preventDefault();
      action();
    });
  }

  private bindPlug(
    toggle: { cell: Element; header: Element },
    module: ServoPeripheral | UltrasonicPeripheral | DhtPeripheral,
  ): void {
    const flip = (): void => module.setConnected(!module.state.connected);
    this.bindToggle(toggle.cell, flip);
    this.bindToggle(toggle.header, flip);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private el<T extends Element = Element>(id: string): T {
    const found = this.svg.querySelector<T>(`#${id}`);
    if (!found) throw new Error(`board view: the drawing has no element with id "${id}"`);
    return found;
  }

  private led(bodyId: string, glowId: string, offOpacity: number): LedRefs {
    return { body: this.el(bodyId), glow: this.el(glowId), offOpacity };
  }

  /** Rendered pixels per viewBox unit (1 when the drawing has no layout yet, e.g. in tests). */
  private pixelsPerUnit(): number {
    const width = this.svg.getBoundingClientRect().width;
    return width > 0 ? width / BOARD_VIEWBOX.width : 1;
  }

  private listen<E extends Event>(
    target: EventTarget,
    type: string,
    handler: (e: E) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.cleanups.push(() => target.removeEventListener(type, listener, options));
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function isActivationKey(e: KeyboardEvent): boolean {
  return e.key === 'Enter' || e.key === ' ';
}

/** Knob change for a key while the potentiometer has focus, or null for keys it ignores. */
function potKeyStep(key: string): number | null {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return POT_KEY_STEP;
    case 'ArrowDown':
    case 'ArrowLeft':
      return -POT_KEY_STEP;
    case 'PageUp':
      return POT_KEY_PAGE_STEP;
    case 'PageDown':
      return -POT_KEY_PAGE_STEP;
    case 'Home':
    case 'End':
      return 0;
    default:
      return null;
  }
}

/** Keep receiving pointer events until release, even when the pointer leaves the element. */
function capturePointer(el: Element, pointerId: number): void {
  if (typeof el.setPointerCapture !== 'function') return;
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // The pointer may already be gone (e.g. synthetic events); dragging still works without capture.
  }
}

/** The character an HD44780 shows for a code (blank for control codes, '?' for unknown ones). */
function lcdChar(code: number): string {
  const glyph = LCD_GLYPHS[code];
  if (glyph !== undefined) return glyph;
  if (code >= 32 && code <= 126) return String.fromCharCode(code);
  if (code < 32) return '';
  return '?';
}

/** SVG path drawing a 5x8 custom glyph (rows of 5-bit masks, MSB left) inside LCD cell (row, col). */
function glyphPath(row: number, col: number, bitmap: number[]): string {
  const geo = LCD_GEOMETRY;
  const px = geo.pixel;
  const originX = geo.x0 + col * geo.pitch + px.x0;
  const originY = geo.rowY[row] + px.y0;
  const parts: string[] = [];
  for (let r = 0; r < 8; r++) {
    const bits = bitmap[r] ?? 0;
    for (let c = 0; c < 5; c++) {
      if ((bits >> (4 - c)) & 1) {
        const x = formatNumber(originX + c * px.pitchX);
        const y = formatNumber(originY + r * px.pitchY);
        parts.push(`M${x} ${y}h${px.w}v${px.h}h-${px.w}z`);
      }
    }
  }
  return parts.join('');
}
