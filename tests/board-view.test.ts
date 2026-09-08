// @vitest-environment happy-dom
/**
 * Board view tests (happy-dom): the SVG is mounted against a fake ZERO1 board
 * that only exposes what the view reads (pins, clock, peripheral states and
 * the setters the interactions call). Rendering is checked through the
 * attributes of the elements listed in BOARD_IDS; interactions through the
 * calls recorded on the fake peripherals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BoardEvent,
  BoardListener,
  ButtonState,
  BuzzerState,
  DhtState,
  LcdState,
  LedState,
  MotorState,
  PinState,
  PotLdrState,
  RgbState,
  ServoState,
  SevenSegState,
  UltrasonicState,
} from '../src/types';
import { PIN_COUNT } from '../src/types';
import type { Zero1Board } from '../src/zero1';
import { createBoardView, type BoardView } from '../src/ui/board-view';
import { BOARD_GEOMETRY, BOARD_IDS, BOARD_SVG, LCD_GEOMETRY, lcdCellId, lcdGlyphId } from '../src/ui/board-svg';

// ---------------------------------------------------------------------------
// Fake board
// ---------------------------------------------------------------------------

function makePin(): PinState {
  return { mode: null, level: 0, pwm: null, tone: null, servo: null, inputLevel: null, analogInput: null };
}

function makeFakeBoard() {
  const listeners = new Set<BoardListener>();
  const led = (id: string, pin: number) => ({ id, pin, state: { on: false, brightness: 0 } as LedState });
  const button = (id: string, pin: number) => ({
    id,
    pin,
    state: { pressed: false } as ButtonState,
    press: vi.fn(),
    release: vi.fn(),
  });
  const potLdr = {
    id: 'potldr',
    pin: 17,
    state: { source: 'pot', pot: 512, light: 60, adc: 512 } as PotLdrState,
    setSource: vi.fn((source: 'pot' | 'ldr') => {
      potLdr.state.source = source;
    }),
    setPot: vi.fn((value: number) => {
      potLdr.state.pot = value;
      potLdr.state.adc = value;
    }),
    setLight: vi.fn(),
  };
  const servo = {
    id: 'servo',
    pin: 4,
    state: { attached: false, target: 90, angle: 90, connected: true } as ServoState,
    setConnected: vi.fn((on: boolean) => {
      servo.state.connected = on;
    }),
  };
  const ultrasonic = {
    id: 'ultrasonic',
    trigPin: 3,
    echoPin: 2,
    state: { distanceCm: 50, connected: true, lastPingAt: null } as UltrasonicState,
    setConnected: vi.fn((on: boolean) => {
      ultrasonic.state.connected = on;
    }),
  };
  const dht = {
    id: 'dht22',
    pin: 5,
    state: { temperature: 24, humidity: 55, connected: true } as DhtState,
    setConnected: vi.fn((on: boolean) => {
      dht.state.connected = on;
    }),
  };
  const lcd = {
    id: 'lcd',
    state: {
      cols: 16,
      rows: 2,
      backlight: false,
      displayOn: true,
      cursorCol: 0,
      cursorRow: 0,
      cursorVisible: false,
      blink: false,
      chars: [new Array<number>(16).fill(32), new Array<number>(16).fill(32)],
      customChars: Array.from({ length: 8 }, () => new Array<number>(8).fill(0)),
      scroll: 0,
      backlightSwitch: true,
    } as LcdState,
    setBacklightSwitch: vi.fn((on: boolean) => {
      lcd.state.backlightSwitch = on;
    }),
  };
  let now = 0;
  const board = {
    clock: { now: () => now },
    pins: Array.from({ length: PIN_COUNT }, makePin),
    ledRed: led('led-red', 15),
    ledGreen: led('led-green', 16),
    ledBuiltin: led('led-builtin', 13),
    rgb: { id: 'rgb', pin: 9, state: { r: 0, g: 0, b: 0, count: 0 } as RgbState },
    buzzer: { id: 'buzzer', pin: 8, state: { freq: null, level: 0 } as BuzzerState },
    sevenSeg: {
      id: 'sevenseg',
      state: { segments: new Array<boolean>(8).fill(false), latched: 0, shift: 0 } as SevenSegState,
    },
    motor: { id: 'motor', pin: 14, state: { running: false, speed: 0, angle: 0 } as MotorState },
    servo,
    potLdr,
    buttonA: button('button-a', 6),
    buttonB: button('button-b', 7),
    dht,
    ultrasonic,
    lcd,
    on(listener: BoardListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(e: BoardEvent): void {
      for (const l of listeners) l(e);
    },
    setClock(ms: number): void {
      now = ms;
    },
    listenerCount: () => listeners.size,
  };
  return board;
}

type FakeBoard = ReturnType<typeof makeFakeBoard>;

function mount(): { board: FakeBoard; view: BoardView; root: HTMLElement } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const board = makeFakeBoard();
  const view = createBoardView(root, board as unknown as Zero1Board);
  return { board, view, root };
}

function byId(id: string): Element {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const opacity = (id: string): number => Number(byId(id).getAttribute('opacity'));

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...init });
}

function key(type: 'keydown' | 'keyup', k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, key: k, ...init });
}

const codes = (s: string): number[] => Array.from(s, (ch) => ch.charCodeAt(0));

let nowSpy: ReturnType<typeof vi.spyOn>;
let views: BoardView[] = [];

beforeEach(() => {
  nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000);
  document.body.dataset.running = 'false';
});

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  nowSpy.mockRestore();
  document.body.innerHTML = '';
});

function mountTracked() {
  const m = mount();
  views.push(m.view);
  return m;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

describe('board drawing', () => {
  it('has every dynamic id exactly once and a tooltip with the pin name on each module', () => {
    const ids = Object.values(BOARD_IDS).flat();
    for (const id of ids) {
      const matches = BOARD_SVG.split(`id="${id}"`).length - 1;
      expect(matches, id).toBe(1);
    }
    for (let r = 0; r < LCD_GEOMETRY.rows; r++) {
      for (let c = 0; c < LCD_GEOMETRY.cols; c++) {
        expect(BOARD_SVG).toContain(`id="${lcdCellId(r, c)}"`);
        expect(BOARD_SVG).toContain(`id="${lcdGlyphId(r, c)}"`);
      }
    }
    for (const tip of [
      'Button 1 — D6',
      'Button 2 — D7',
      'Servo — D4',
      'TRIG D3, ECHO D2',
      'DHT22 temperature &amp; humidity — D5',
      'Red LED — A1',
      'Green LED — A2',
      'RGB (WS2812) — D9',
      'Buzzer — D8',
      'DATA D12, LATCH D11, CLK D10',
      'IN1 — A0',
      'SDA A4, SCL A5',
      'MOTOR screw terminal',
      'SERVO header — D4',
      'ULTRASONIC header — TRIG D3, ECHO D2',
      'DHT22 header — D5',
    ]) {
      expect(BOARD_SVG, tip).toContain(tip);
    }
    expect(BOARD_SVG.startsWith('<svg')).toBe(true);
    expect(BOARD_SVG).toContain('viewBox="0 0 1000 500"');
  });

  it('mounts into the container and draws the initial state', () => {
    const { root } = mountTracked();
    expect(root.querySelector('svg')?.id).toBe(BOARD_IDS.root);
    expect(byId(BOARD_IDS.servoAngle).textContent).toBe('90°');
    expect(byId(BOARD_IDS.ultrasonicDistance).textContent).toBe('50 cm');
    expect(byId(BOARD_IDS.dhtTemp).textContent).toBe('24.0 °C');
    expect(byId(BOARD_IDS.dhtHum).textContent).toBe('55.0 %');
    expect(byId(BOARD_IDS.potLdrValue).textContent).toBe('A3 = 512');
    // 512 is a hair past the middle of 0..1023, so the knob sits just right of centre.
    expect(byId(BOARD_IDS.potKnob).getAttribute('transform')).toBe(
      `rotate(0.13 ${BOARD_GEOMETRY.potCenter.x} ${BOARD_GEOMETRY.potCenter.y})`,
    );
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('LEDs', () => {
  it('changes the LED opacity and glow with the peripheral state', () => {
    const { board, view } = mountTracked();
    const offBody = opacity(BOARD_IDS.ledRed);
    expect(opacity(BOARD_IDS.ledRedGlow)).toBe(0);

    board.ledRed.state.on = true;
    board.ledRed.state.brightness = 1;
    view.update();
    expect(opacity(BOARD_IDS.ledRed)).toBe(1);
    expect(opacity(BOARD_IDS.ledRedGlow)).toBeGreaterThan(0);

    board.ledRed.state.brightness = 0.5;
    view.update();
    const halfBody = opacity(BOARD_IDS.ledRed);
    expect(halfBody).toBeGreaterThan(offBody);
    expect(halfBody).toBeLessThan(1);

    board.ledRed.state.on = false;
    board.ledRed.state.brightness = 0;
    view.update();
    expect(opacity(BOARD_IDS.ledRed)).toBe(offBody);
    expect(opacity(BOARD_IDS.ledRedGlow)).toBe(0);
  });

  it('lights the built-in L LED from the pin 13 peripheral and the power LED while running', () => {
    const { board, view } = mountTracked();
    const offL = opacity(BOARD_IDS.ledL);
    const offOn = opacity(BOARD_IDS.ledOn);
    board.ledBuiltin.state.on = true;
    board.ledBuiltin.state.brightness = 1;
    document.body.dataset.running = 'true';
    view.update();
    expect(opacity(BOARD_IDS.ledL)).toBeGreaterThan(offL);
    expect(opacity(BOARD_IDS.ledOn)).toBeGreaterThan(offOn);
    document.body.dataset.running = 'false';
    view.update();
    expect(opacity(BOARD_IDS.ledOn)).toBe(offOn);
  });

  it('shows the RGB colour and hides the glow when black', () => {
    const { board, view } = mountTracked();
    board.rgb.state.r = 255;
    board.rgb.state.g = 128;
    board.rgb.state.b = 0;
    view.update();
    expect(byId(BOARD_IDS.rgb).getAttribute('fill')).toBe('rgb(255,128,0)');
    expect(byId(BOARD_IDS.rgbGlow).getAttribute('fill')).toBe('rgb(255,128,0)');
    expect(opacity(BOARD_IDS.rgbGlow)).toBeGreaterThan(0);
    board.rgb.state.r = 0;
    board.rgb.state.g = 0;
    view.update();
    expect(byId(BOARD_IDS.rgb).getAttribute('fill')).toBe('#e5e7eb');
    expect(opacity(BOARD_IDS.rgbGlow)).toBe(0);
  });
});

describe('7 segment, buzzer, motor, servo, pot/LDR, sensors', () => {
  it('toggles the z1-on class of each segment', () => {
    const { board, view } = mountTracked();
    const segB = byId(BOARD_IDS.segments[1]);
    expect(segB.classList.contains('z1-on')).toBe(false);
    board.sevenSeg.state.segments[1] = true;
    board.sevenSeg.state.segments[7] = true;
    view.update();
    expect(segB.classList.contains('z1-on')).toBe(true);
    expect(byId(BOARD_IDS.segments[7]).classList.contains('z1-on')).toBe(true);
    expect(byId(BOARD_IDS.segments[0]).classList.contains('z1-on')).toBe(false);
    board.sevenSeg.state.segments[1] = false;
    view.update();
    expect(segB.classList.contains('z1-on')).toBe(false);
  });

  it('shows the buzzer sound waves and frequency while sounding', () => {
    const { board, view } = mountTracked();
    expect(opacity(BOARD_IDS.buzzerWaves)).toBe(0);
    board.buzzer.state.freq = 440;
    view.update();
    expect(opacity(BOARD_IDS.buzzerWaves)).toBe(1);
    expect(byId(BOARD_IDS.buzzerWaves).classList.contains('z1-sounding')).toBe(true);
    expect(byId(BOARD_IDS.buzzerFreq).textContent).toBe('440 Hz');
    board.buzzer.state.freq = null;
    view.update();
    expect(opacity(BOARD_IDS.buzzerWaves)).toBe(0);
    expect(byId(BOARD_IDS.buzzerFreq).textContent).toBe('');
  });

  it('rotates the motor rotor and the servo horn', () => {
    const { board, view } = mountTracked();
    board.motor.state.angle = 123.456;
    board.motor.state.running = true;
    board.servo.state.angle = 45;
    view.update();
    const hub = BOARD_GEOMETRY.motorHub;
    expect(byId(BOARD_IDS.motorRotor).getAttribute('transform')).toBe(`rotate(123.46 ${hub.x} ${hub.y})`);
    expect(byId(BOARD_IDS.motorLabel).textContent).toBe('ON');
    const horn = byId(BOARD_IDS.servoHorn).getAttribute('transform') ?? '';
    expect(horn).toContain('rotate(');
    expect(horn).toBe(`rotate(-45 ${BOARD_GEOMETRY.servoShaft.x} ${BOARD_GEOMETRY.servoShaft.y})`);
    expect(byId(BOARD_IDS.servoAngle).textContent).toBe('45°');
    expect(byId(BOARD_IDS.servoStatus).textContent).toBe('plugged · no signal');
    board.servo.state.attached = true;
    view.update();
    expect(byId(BOARD_IDS.servoStatus).textContent).toBe('plugged');
  });

  it('turns the pot knob, moves the POT/LDR switch and dims the LDR ring with the light', () => {
    const { board, view } = mountTracked();
    board.potLdr.state.pot = 1023;
    board.potLdr.state.adc = 1023;
    view.update();
    const c = BOARD_GEOMETRY.potCenter;
    expect(byId(BOARD_IDS.potKnob).getAttribute('transform')).toBe(`rotate(135 ${c.x} ${c.y})`);
    expect(byId(BOARD_IDS.pot).getAttribute('aria-valuenow')).toBe('1023');
    expect(byId(BOARD_IDS.potLdrValue).textContent).toBe('A3 = 1023');
    expect(byId(BOARD_IDS.potLdrKnob).getAttribute('x')).toBe(String(BOARD_GEOMETRY.potLdrKnobX.pot));

    board.potLdr.state.source = 'ldr';
    board.potLdr.state.light = 100;
    view.update();
    expect(byId(BOARD_IDS.potLdrKnob).getAttribute('x')).toBe(String(BOARD_GEOMETRY.potLdrKnobX.ldr));
    expect(byId(BOARD_IDS.potLdrLabelLdr).getAttribute('fill-opacity')).toBe('1');
    expect(byId(BOARD_IDS.potLdrLabelPot).getAttribute('fill-opacity')).toBe('0.5');
    const bright = opacity(BOARD_IDS.ldrRing);
    board.potLdr.state.light = 0;
    view.update();
    expect(opacity(BOARD_IDS.ldrRing)).toBeLessThan(bright);
  });

  it('shows the ultrasonic distance, the obstacle position and a fading ping', () => {
    const { board, view } = mountTracked();
    const bar = BOARD_GEOMETRY.ultrasonicBar;
    board.ultrasonic.state.distanceCm = 400;
    view.update();
    expect(byId(BOARD_IDS.ultrasonicDistance).textContent).toBe('400 cm');
    expect(byId(BOARD_IDS.ultrasonicObstacle).getAttribute('x')).toBe(String(bar.x1));
    board.ultrasonic.state.distanceCm = 2;
    view.update();
    expect(byId(BOARD_IDS.ultrasonicObstacle).getAttribute('x')).toBe(String(bar.x0));

    board.setClock(5000);
    board.ultrasonic.state.lastPingAt = 5000;
    view.update();
    expect(opacity(BOARD_IDS.ultrasonicPing)).toBe(1);
    board.setClock(5125);
    view.update();
    expect(opacity(BOARD_IDS.ultrasonicPing)).toBeCloseTo(0.5, 2);
    board.setClock(6000);
    view.update();
    expect(opacity(BOARD_IDS.ultrasonicPing)).toBe(0);

    board.ultrasonic.state.connected = false;
    view.update();
    expect(byId(BOARD_IDS.ultrasonicDistance).textContent).toBe('—');
    expect(byId(BOARD_IDS.ultrasonicModule).classList.contains('z1-unplugged')).toBe(true);
    expect(byId(BOARD_IDS.ultrasonicStatus).textContent).toBe('unplugged');
  });

  it('shows the DHT readings with one decimal and dashes when unplugged', () => {
    const { board, view } = mountTracked();
    board.dht.state.temperature = -3.5;
    board.dht.state.humidity = 99;
    view.update();
    expect(byId(BOARD_IDS.dhtTemp).textContent).toBe('-3.5 °C');
    expect(byId(BOARD_IDS.dhtHum).textContent).toBe('99.0 %');
    board.dht.state.connected = false;
    view.update();
    expect(byId(BOARD_IDS.dhtTemp).textContent).toBe('— °C');
    expect(byId(BOARD_IDS.dhtModule).classList.contains('z1-unplugged')).toBe(true);
    expect(byId(BOARD_IDS.dhtStatus).textContent).toBe('unplugged');
  });
});

describe('LCD', () => {
  it('shows the printed characters, mapping HD44780 codes', () => {
    const { board, view } = mountTracked();
    const hello = codes('Hello, ZERO1!');
    board.lcd.state.chars[0].splice(0, hello.length, ...hello);
    board.lcd.state.chars[1][0] = 0xdf; // degree sign
    board.lcd.state.chars[1][1] = 0xff; // full block
    board.lcd.state.chars[1][2] = 0xb1; // katakana on the real ROM: unknown here
    view.update();
    const row0 = Array.from({ length: 16 }, (_, c) => byId(lcdCellId(0, c)).textContent).join('');
    expect(row0).toBe('Hello, ZERO1!   ');
    expect(byId(lcdCellId(1, 0)).textContent).toBe('°');
    expect(byId(lcdCellId(1, 1)).textContent).toBe('█');
    expect(byId(lcdCellId(1, 2)).textContent).toBe('?');
    expect(byId(lcdCellId(1, 3)).textContent).toBe(' ');
  });

  it('draws custom characters as 5x8 pixels and blanks them again', () => {
    const { board, view } = mountTracked();
    board.lcd.state.customChars[2] = [0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000];
    board.lcd.state.chars[0][4] = 2;
    view.update();
    const glyph = byId(lcdGlyphId(0, 4));
    expect(glyph.getAttribute('visibility')).toBe('visible');
    const pixels = (glyph.getAttribute('d') ?? '').split('M').length - 1;
    expect(pixels).toBe(2 + 5 + 5 + 3 + 1);
    expect(byId(lcdCellId(0, 4)).textContent).toBe('');
    // Code 10 shows glyph 2 again (the controller mirrors the 8 custom glyphs).
    board.lcd.state.chars[0][5] = 10;
    view.update();
    expect(byId(lcdGlyphId(0, 5)).getAttribute('d')).not.toBe('');
    board.lcd.state.chars[0][4] = 65;
    view.update();
    expect(glyph.getAttribute('visibility')).toBe('hidden');
    expect(byId(lcdCellId(0, 4)).textContent).toBe('A');
  });

  it('lights the backlight only when both the sketch and the switch turn it on, and blanks when the display is off', () => {
    const { board, view } = mountTracked();
    const glass = byId(BOARD_IDS.lcdGlass);
    const off = glass.getAttribute('fill');
    board.lcd.state.backlight = true;
    view.update();
    const on = glass.getAttribute('fill');
    expect(on).not.toBe(off);
    board.lcd.state.backlightSwitch = false;
    view.update();
    expect(glass.getAttribute('fill')).toBe(off);
    expect(byId(BOARD_IDS.backlightKnob).getAttribute('x')).toBe(String(BOARD_GEOMETRY.backlightKnobX.off));

    board.lcd.state.chars[0][0] = 65;
    board.lcd.state.cursorVisible = true;
    view.update();
    expect(byId(BOARD_IDS.lcdCells).getAttribute('visibility')).toBe('visible');
    expect(byId(BOARD_IDS.lcdCursor).getAttribute('visibility')).toBe('visible');
    board.lcd.state.displayOn = false;
    view.update();
    expect(byId(BOARD_IDS.lcdCells).getAttribute('visibility')).toBe('hidden');
    expect(byId(BOARD_IDS.lcdCursor).getAttribute('visibility')).toBe('hidden');
  });

  it('places the cursor underline in the visible window and blinks the block at 2 Hz', () => {
    const { board, view } = mountTracked();
    const geo = LCD_GEOMETRY;
    board.lcd.state.cursorVisible = true;
    board.lcd.state.cursorCol = 5;
    board.lcd.state.cursorRow = 1;
    board.lcd.state.scroll = 2;
    view.update();
    const cursor = byId(BOARD_IDS.lcdCursor);
    expect(cursor.getAttribute('visibility')).toBe('visible');
    expect(cursor.getAttribute('x')).toBe(String(geo.x0 + 3 * geo.pitch));
    expect(cursor.getAttribute('y')).toBe(String(geo.rowY[1] + geo.cellH - 3));

    // Scrolled out of the 16 visible columns: no cursor.
    board.lcd.state.cursorCol = 30;
    view.update();
    expect(cursor.getAttribute('visibility')).toBe('hidden');

    // Memory column 2 is the first visible column while scrolled by 2.
    board.lcd.state.cursorCol = 2;
    board.lcd.state.blink = true;
    nowSpy.mockReturnValue(0);
    view.update();
    expect(byId(BOARD_IDS.lcdBlink).getAttribute('visibility')).toBe('visible');
    nowSpy.mockReturnValue(260);
    view.update();
    expect(byId(BOARD_IDS.lcdBlink).getAttribute('visibility')).toBe('hidden');
    nowSpy.mockReturnValue(510);
    view.update();
    expect(byId(BOARD_IDS.lcdBlink).getAttribute('visibility')).toBe('visible');
  });
});

describe('serial activity LEDs', () => {
  it('pulses TX on serialTx events and RX on pulseRx() for 80 ms', () => {
    const { board, view } = mountTracked();
    const offTx = opacity(BOARD_IDS.ledTx);
    const offRx = opacity(BOARD_IDS.ledRx);

    board.emit({ type: 'serialTx', text: 'hi' });
    view.update();
    expect(opacity(BOARD_IDS.ledTx)).toBeGreaterThan(offTx);
    expect(opacity(BOARD_IDS.ledRx)).toBe(offRx);

    view.pulseRx();
    view.update();
    expect(opacity(BOARD_IDS.ledRx)).toBeGreaterThan(offRx);

    nowSpy.mockReturnValue(1079);
    view.update();
    expect(opacity(BOARD_IDS.ledRx)).toBeGreaterThan(offRx);
    nowSpy.mockReturnValue(1081);
    view.update();
    expect(opacity(BOARD_IDS.ledRx)).toBe(offRx);
    expect(opacity(BOARD_IDS.ledTx)).toBe(offTx);
  });
});

describe('change detection', () => {
  it('writes nothing to the DOM when the state did not change', () => {
    const { view } = mountTracked();
    view.update();
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
    view.update();
    view.update();
    expect(setAttribute).not.toHaveBeenCalled();
    setAttribute.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

describe('push buttons', () => {
  it('presses on pointerdown and releases on pointerup', () => {
    const { board } = mountTracked();
    const button1 = byId(BOARD_IDS.buttonA);
    button1.dispatchEvent(pointer('pointerdown'));
    expect(board.buttonA.press).toHaveBeenCalledTimes(1);
    expect(board.buttonA.release).not.toHaveBeenCalled();
    button1.dispatchEvent(pointer('pointerup'));
    expect(board.buttonA.release).toHaveBeenCalledTimes(1);
    expect(board.buttonB.press).not.toHaveBeenCalled();
  });

  it('releases when the pointer leaves or is cancelled', () => {
    const { board } = mountTracked();
    const button2 = byId(BOARD_IDS.buttonB);
    button2.dispatchEvent(pointer('pointerdown'));
    button2.dispatchEvent(pointer('pointerleave'));
    expect(board.buttonB.release).toHaveBeenCalledTimes(1);
    button2.dispatchEvent(pointer('pointerdown'));
    button2.dispatchEvent(pointer('pointercancel'));
    expect(board.buttonB.press).toHaveBeenCalledTimes(2);
    expect(board.buttonB.release).toHaveBeenCalledTimes(2);
  });

  it('shows the cap pressed down from the peripheral state', () => {
    const { board, view } = mountTracked();
    const cap = byId(BOARD_IDS.buttonACap);
    board.buttonA.state.pressed = true;
    view.update();
    expect(cap.classList.contains('z1-pressed')).toBe(true);
    expect(cap.getAttribute('transform')).toBe('translate(0 2)');
    expect(byId(BOARD_IDS.buttonA).getAttribute('aria-pressed')).toBe('true');
    board.buttonA.state.pressed = false;
    view.update();
    expect(cap.classList.contains('z1-pressed')).toBe(false);
  });

  it('holds Button 1 / 2 with keys 1 / 2 unless a text field is focused', () => {
    const { board } = mountTracked();
    document.dispatchEvent(key('keydown', '1'));
    document.dispatchEvent(key('keydown', '1', { repeat: true }));
    expect(board.buttonA.press).toHaveBeenCalledTimes(1);
    document.dispatchEvent(key('keyup', '1'));
    expect(board.buttonA.release).toHaveBeenCalledTimes(1);

    document.dispatchEvent(key('keydown', '2'));
    document.dispatchEvent(key('keyup', '2'));
    expect(board.buttonB.press).toHaveBeenCalledTimes(1);
    expect(board.buttonB.release).toHaveBeenCalledTimes(1);

    // Ctrl+1 is a browser shortcut, not a button.
    document.dispatchEvent(key('keydown', '1', { ctrlKey: true }));
    expect(board.buttonA.press).toHaveBeenCalledTimes(1);

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(key('keydown', '1'));
    expect(board.buttonA.press).toHaveBeenCalledTimes(1);
    input.blur();

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.tabIndex = 0;
    document.body.appendChild(editor);
    editor.focus();
    editor.dispatchEvent(key('keydown', '2'));
    expect(board.buttonB.press).toHaveBeenCalledTimes(1);
  });

  it('releases keyboard-held buttons when the window loses focus', () => {
    const { board } = mountTracked();
    document.dispatchEvent(key('keydown', '1'));
    window.dispatchEvent(new Event('blur'));
    expect(board.buttonA.release).toHaveBeenCalledTimes(1);
    document.dispatchEvent(key('keyup', '1'));
    expect(board.buttonA.release).toHaveBeenCalledTimes(1);
  });

  it('works with Enter / Space while a button has keyboard focus', () => {
    const { board } = mountTracked();
    const button1 = byId(BOARD_IDS.buttonA);
    button1.dispatchEvent(key('keydown', ' '));
    expect(board.buttonA.press).toHaveBeenCalledTimes(1);
    button1.dispatchEvent(key('keyup', ' '));
    expect(board.buttonA.release).toHaveBeenCalledTimes(1);
  });
});

describe('potentiometer', () => {
  it('turns with the mouse wheel', () => {
    const { board } = mountTracked();
    const pot = byId(BOARD_IDS.pot);
    const up = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    pot.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(board.potLdr.setPot).toHaveBeenLastCalledWith(512 + 16);
    pot.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }));
    pot.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }));
    expect(board.potLdr.state.pot).toBe(512 - 16);
  });

  it('turns when dragged right or up and clamps to 0..1023', () => {
    const { board } = mountTracked();
    const pot = byId(BOARD_IDS.pot);
    pot.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
    pot.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 100 }));
    // 30 units of a 300-unit travel = 10 % of the range.
    expect(board.potLdr.state.pot).toBe(Math.round(512 + 0.1 * 1023));
    pot.dispatchEvent(pointer('pointermove', { clientX: 100, clientY: 130 }));
    expect(board.potLdr.state.pot).toBe(Math.round(512 - 0.1 * 1023));
    pot.dispatchEvent(pointer('pointermove', { clientX: 100, clientY: 900 }));
    expect(board.potLdr.state.pot).toBe(0);
    pot.dispatchEvent(pointer('pointerup', { clientX: 100, clientY: 900 }));
    // After release, moving the pointer changes nothing.
    pot.dispatchEvent(pointer('pointermove', { clientX: 500, clientY: 100 }));
    expect(board.potLdr.state.pot).toBe(0);
  });

  it('turns with the arrow keys while focused', () => {
    const { board } = mountTracked();
    const pot = byId(BOARD_IDS.pot);
    pot.dispatchEvent(key('keydown', 'ArrowRight'));
    expect(board.potLdr.state.pot).toBe(520);
    pot.dispatchEvent(key('keydown', 'ArrowDown'));
    expect(board.potLdr.state.pot).toBe(512);
    pot.dispatchEvent(key('keydown', 'End'));
    expect(board.potLdr.state.pot).toBe(1023);
    pot.dispatchEvent(key('keydown', 'Home'));
    expect(board.potLdr.state.pot).toBe(0);
    pot.dispatchEvent(key('keydown', 'PageUp'));
    expect(board.potLdr.state.pot).toBe(128);
  });
});

describe('switches and plug-in headers', () => {
  it('flips the POT/LDR switch on click', () => {
    const { board } = mountTracked();
    const sw = byId(BOARD_IDS.potLdrSwitch);
    sw.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(board.potLdr.setSource).toHaveBeenLastCalledWith('ldr');
    sw.dispatchEvent(key('keydown', 'Enter'));
    expect(board.potLdr.setSource).toHaveBeenLastCalledWith('pot');
  });

  it('flips the Backlight switch on click', () => {
    const { board } = mountTracked();
    byId(BOARD_IDS.backlightSwitch).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(board.lcd.setBacklightSwitch).toHaveBeenLastCalledWith(false);
    byId(BOARD_IDS.backlightSwitch).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(board.lcd.setBacklightSwitch).toHaveBeenLastCalledWith(true);
  });

  it('plugs and unplugs the servo, ultrasonic and DHT22 from their cells and right-edge headers', () => {
    const { board, view } = mountTracked();
    const click = (id: string): void => {
      byId(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    click(BOARD_IDS.servo);
    expect(board.servo.setConnected).toHaveBeenLastCalledWith(false);
    view.update();
    expect(byId(BOARD_IDS.servoModule).classList.contains('z1-unplugged')).toBe(true);
    expect(byId(BOARD_IDS.servoStatus).textContent).toBe('unplugged');
    expect(byId(BOARD_IDS.servoHeader).getAttribute('aria-checked')).toBe('false');
    click(BOARD_IDS.servoHeader);
    expect(board.servo.setConnected).toHaveBeenLastCalledWith(true);

    click(BOARD_IDS.ultrasonicHeader);
    expect(board.ultrasonic.setConnected).toHaveBeenLastCalledWith(false);
    click(BOARD_IDS.ultrasonic);
    expect(board.ultrasonic.setConnected).toHaveBeenLastCalledWith(true);

    click(BOARD_IDS.dht);
    expect(board.dht.setConnected).toHaveBeenLastCalledWith(false);
    click(BOARD_IDS.dhtHeader);
    expect(board.dht.setConnected).toHaveBeenLastCalledWith(true);
  });
});

describe('destroy', () => {
  it('removes the drawing, the listeners and the board subscription', () => {
    const { board, view, root } = mount();
    expect(board.listenerCount()).toBe(1);
    view.destroy();
    expect(root.childNodes.length).toBe(0);
    expect(board.listenerCount()).toBe(0);
    document.dispatchEvent(key('keydown', '1'));
    expect(board.buttonA.press).not.toHaveBeenCalled();
  });
});
