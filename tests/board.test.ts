import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardEvent, LcdDevice, Peripheral } from '../src/types';
import { A, DEFAULT_BOARD_CONFIG } from '../src/types';
import { Board, assertPin, pinName } from '../src/runtime/board';
import { VirtualClock } from '../src/runtime/clock';
import { SketchError } from '../src/runtime/values';

function makeBoard(config?: ConstructorParameters<typeof Board>[1]): { board: Board; clock: VirtualClock; events: BoardEvent[] } {
  const clock = new VirtualClock();
  const board = new Board(clock, config);
  const events: BoardEvent[] = [];
  board.on((e) => events.push(e));
  return { board, clock, events };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pin helpers', () => {
  it('names analog pins the way students write them', () => {
    expect(pinName(13)).toBe('13');
    expect(pinName(A.A3)).toBe('A3');
    expect(pinName(19)).toBe('A5');
  });

  it('accepts UNO pins (truncating fractions) and rejects the rest with a readable message', () => {
    expect(assertPin(0)).toBe(0);
    expect(assertPin(19)).toBe(19);
    expect(assertPin(13.9)).toBe(13);
    expect(() => assertPin(20)).toThrow(SketchError);
    expect(() => assertPin(-1)).toThrow('pin -1 does not exist on the UNO (use 0-13 or A0-A5)');
    expect(() => assertPin(Number.NaN)).toThrow(SketchError);
  });
});

describe('Board construction', () => {
  it('starts with every pin floating and default settings', () => {
    const { board } = makeBoard();
    expect(board.pins).toHaveLength(20);
    for (const pin of board.pins) {
      expect(pin).toEqual({ mode: null, level: 0, pwm: null, tone: null, servo: null, inputLevel: null, analogInput: null });
    }
    expect(board.config).toEqual(DEFAULT_BOARD_CONFIG);
    expect(board.config).not.toBe(DEFAULT_BOARD_CONFIG);
  });

  it('merges partial settings and ignores undefined values', () => {
    const { board } = makeBoard({ buttonWiring: 'pullup', lcdAddress: undefined });
    expect(board.config.buttonWiring).toBe('pullup');
    expect(board.config.lcdAddress).toBe(0x27);
  });
});

describe('pinMode', () => {
  it('sets the mode, pulls up INPUT_PULLUP pins and emits an event', () => {
    const { board, events } = makeBoard();
    board.pinMode(6, 'INPUT_PULLUP');
    expect(board.pins[6]).toMatchObject({ mode: 'INPUT_PULLUP', level: 1 });
    board.pinMode(13, 'OUTPUT');
    expect(board.pins[13]?.mode).toBe('OUTPUT');
    expect(events).toEqual([
      { type: 'pinMode', pin: 6, mode: 'INPUT_PULLUP' },
      { type: 'pinMode', pin: 13, mode: 'OUTPUT' },
    ]);
  });

  it('keeps the level of an OUTPUT pin and drops the pull-up of an INPUT pin', () => {
    const { board } = makeBoard();
    board.pinMode(13, 'OUTPUT');
    board.digitalWrite(13, 1);
    board.pinMode(13, 'OUTPUT');
    expect(board.pins[13]?.level).toBe(1);
    board.pinMode(13, 'INPUT');
    expect(board.pins[13]?.level).toBe(0);
  });

  it('rejects pins that do not exist and modes that do not exist', () => {
    const { board } = makeBoard();
    expect(() => board.pinMode(20, 'OUTPUT')).toThrow('pin 20 does not exist on the UNO (use 0-13 or A0-A5)');
    expect(() => board.pinMode(13, 'SIDEWAYS' as never)).toThrow('the mode must be INPUT, OUTPUT or INPUT_PULLUP');
  });
});

describe('digitalWrite', () => {
  it('emits an event on every write, even when the level does not change', () => {
    const { board, events } = makeBoard();
    board.pinMode(13, 'OUTPUT');
    board.digitalWrite(13, 1);
    board.digitalWrite(13, 1);
    board.digitalWrite(13, 0);
    expect(events.filter((e) => e.type === 'digitalWrite')).toEqual([
      { type: 'digitalWrite', pin: 13, level: 1, prev: 0 },
      { type: 'digitalWrite', pin: 13, level: 1, prev: 1 },
      { type: 'digitalWrite', pin: 13, level: 0, prev: 1 },
    ]);
  });

  it('clears PWM on the pin and coerces the level to 0/1', () => {
    const { board } = makeBoard();
    board.analogWrite(9, 100);
    expect(board.pins[9]?.pwm).toBe(100);
    board.digitalWrite(9, 5 as never);
    expect(board.pins[9]).toMatchObject({ level: 1, pwm: null });
  });

  it('updates the pin state before listeners are called', () => {
    const { board } = makeBoard();
    let seen: number | null = null;
    board.on((e) => {
      if (e.type === 'digitalWrite') seen = board.pins[e.pin]?.level ?? null;
    });
    board.digitalWrite(13, 1);
    expect(seen).toBe(1);
  });
});

describe('digitalRead', () => {
  it('returns the level a peripheral drives on the pin', () => {
    const { board } = makeBoard();
    board.pinMode(6, 'INPUT');
    board.setDigitalInput(6, 1);
    expect(board.digitalRead(6)).toBe(1);
    board.setDigitalInput(6, 0);
    expect(board.digitalRead(6)).toBe(0);
  });

  it('reads 1 on INPUT_PULLUP pins and on input pins written HIGH', () => {
    const { board } = makeBoard();
    board.pinMode(6, 'INPUT_PULLUP');
    expect(board.digitalRead(6)).toBe(1);
    board.pinMode(7, 'INPUT');
    board.digitalWrite(7, 1);
    expect(board.digitalRead(7)).toBe(1);
  });

  it('reads back the level of an OUTPUT pin', () => {
    const { board } = makeBoard();
    board.pinMode(13, 'OUTPUT');
    board.digitalWrite(13, 1);
    expect(board.digitalRead(13)).toBe(1);
    board.digitalWrite(13, 0);
    expect(board.digitalRead(13)).toBe(0);
  });

  it('reads garbage that changes over time on a floating pin', () => {
    const { board, clock } = makeBoard();
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      seen.add(board.digitalRead(2));
      clock.advance(0.037);
    }
    expect(seen).toEqual(new Set([0, 1]));
  });

  it('a driven level wins over the pull-up', () => {
    const { board } = makeBoard();
    board.pinMode(6, 'INPUT_PULLUP');
    board.setDigitalInput(6, 0);
    expect(board.digitalRead(6)).toBe(0);
    board.setDigitalInput(6, null);
    expect(board.digitalRead(6)).toBe(1);
  });
});

describe('analogWrite', () => {
  it('sets a duty cycle on PWM pins and emits only an analogWrite event', () => {
    const { board, events } = makeBoard();
    board.analogWrite(9, 128);
    expect(board.pins[9]).toMatchObject({ mode: 'OUTPUT', pwm: 128, level: 1 });
    board.analogWrite(9, 30.9);
    expect(board.pins[9]).toMatchObject({ pwm: 30, level: 0 });
    expect(events).toEqual([
      { type: 'analogWrite', pin: 9, value: 128 },
      { type: 'analogWrite', pin: 9, value: 30 },
    ]);
  });

  it('behaves like digitalWrite on non-PWM pins (HIGH above 127) with pwm null', () => {
    const { board, events } = makeBoard();
    board.analogWrite(A.A1, 200);
    expect(board.pins[A.A1]).toMatchObject({ pwm: null, level: 1 });
    board.analogWrite(A.A1, 100);
    expect(board.pins[A.A1]).toMatchObject({ pwm: null, level: 0 });
    expect(events).toEqual([
      { type: 'analogWrite', pin: A.A1, value: 200 },
      { type: 'digitalWrite', pin: A.A1, level: 1, prev: 0 },
      { type: 'analogWrite', pin: A.A1, value: 100 },
      { type: 'digitalWrite', pin: A.A1, level: 0, prev: 1 },
    ]);
  });

  it('clamps the value to 0..255', () => {
    const { board } = makeBoard();
    board.analogWrite(3, 999);
    expect(board.pins[3]?.pwm).toBe(255);
    board.analogWrite(3, -4);
    expect(board.pins[3]?.pwm).toBe(0);
  });
});

describe('analogRead', () => {
  it('maps channel numbers 0..5 onto A0..A5 and returns the connected value', () => {
    const { board } = makeBoard();
    board.setAnalogInput(A.A3, 700);
    expect(board.analogRead(3)).toBe(700);
    expect(board.analogRead(A.A3)).toBe(700);
    board.setAnalogInput(A.A3, 5000);
    expect(board.analogRead(3)).toBe(1023);
    board.setAnalogInput(A.A3, -3);
    expect(board.analogRead(3)).toBe(0);
  });

  it('reads slowly drifting noise on an unconnected input', () => {
    const { board, clock } = makeBoard();
    const values: number[] = [];
    for (let i = 0; i < 100; i++) {
      values.push(board.analogRead(0));
      clock.advance(10);
    }
    for (const v of values) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(250);
      expect(v).toBeLessThanOrEqual(750);
    }
    expect(new Set(values).size).toBeGreaterThan(5);
  });

  it('rejects digital pins with a message that names the analog pins', () => {
    const { board } = makeBoard();
    expect(() => board.analogRead(6)).toThrow('analogRead(6): that is not an analog pin (use A0-A5)');
    expect(() => board.analogRead(20)).toThrow(SketchError);
  });
});

describe('tone', () => {
  it('plays one tone at a time, like the single UNO timer', () => {
    const { board, events } = makeBoard();
    board.tone(8, 440);
    board.tone(9, 880);
    expect(board.pins[8]?.tone).toBe(440);
    expect(board.pins[9]?.tone).toBeNull();
    board.noTone(8);
    expect(board.pins[8]?.tone).toBeNull();
    board.tone(9, 880);
    expect(board.pins[9]?.tone).toBe(880);
    expect(events).toEqual([
      { type: 'tone', pin: 8, freq: 440 },
      { type: 'tone', pin: 8, freq: null },
      { type: 'tone', pin: 9, freq: 880 },
    ]);
  });

  it('changes frequency on the same pin and treats freq <= 0 as noTone', () => {
    const { board } = makeBoard();
    board.tone(8, 440);
    board.tone(8, 523.9);
    expect(board.pins[8]?.tone).toBe(523);
    board.tone(8, 0);
    expect(board.pins[8]?.tone).toBeNull();
  });

  it('is left alone by digitalWrite on the same pin', () => {
    const { board } = makeBoard();
    board.tone(8, 440);
    board.digitalWrite(8, 1);
    expect(board.pins[8]?.tone).toBe(440);
  });
});

describe('pulseIn', () => {
  it('returns the width from a registered source after waiting that long', async () => {
    const { board, clock } = makeBoard();
    board.registerPulseSource(2, { measure: (level) => (level === 1 ? 2900 : 0) });
    expect(await board.pulseIn(2, 1, 30_000)).toBe(2900);
    expect(clock.now()).toBeCloseTo(2.9, 9);
  });

  it('waits the full timeout and returns 0 when nothing answers', async () => {
    const { board, clock } = makeBoard();
    expect(await board.pulseIn(2, 1, 30_000)).toBe(0);
    expect(clock.now()).toBe(30);
    board.registerPulseSource(2, { measure: () => 0 });
    expect(await board.pulseIn(2, 0, 1_000_000)).toBe(0);
    expect(clock.now()).toBe(1030);
  });

  it('rejects pins that do not exist', async () => {
    const { board } = makeBoard();
    await expect(board.pulseIn(42, 1, 10)).rejects.toThrow(SketchError);
  });
});

describe('library hooks', () => {
  it('records servo angles and pixel colours as events', () => {
    const { board, events } = makeBoard();
    board.servoWrite(4, 90);
    board.servoWrite(4, null);
    const colors = [0xff0000];
    board.pixelsWrite(9, colors);
    colors[0] = 0;
    expect(board.pins[4]?.servo).toBeNull();
    expect(events).toEqual([
      { type: 'servo', pin: 4, angle: 90 },
      { type: 'servo', pin: 4, angle: null },
      { type: 'pixels', pin: 9, colors: [0xff0000] },
    ]);
  });

  it('looks up I2C devices and DHT readings registered by peripherals', () => {
    const { board } = makeBoard();
    const lcd = { kind: 'lcd', cols: 16, rows: 2 } as LcdDevice;
    board.registerI2CDevice(0x27, lcd);
    expect(board.i2cDevice(0x27)).toBe(lcd);
    expect(board.i2cDevice(0x3f)).toBeUndefined();
    board.unregisterI2CDevice(0x27);
    expect(board.i2cDevice(0x27)).toBeUndefined();

    board.registerDht(5, () => ({ temperature: 24, humidity: 55 }));
    expect(board.dhtRead(5)).toEqual({ temperature: 24, humidity: 55 });
    expect(board.dhtRead(6)).toBeNull();
  });
});

describe('peripherals', () => {
  function fakePeripheral(id: string): Peripheral & { attached: Board | null; resets: number; ticks: number[] } {
    return {
      id,
      attached: null,
      resets: 0,
      ticks: [],
      attach(board) {
        this.attached = board as Board;
      },
      reset() {
        this.resets++;
      },
      tick(now) {
        this.ticks.push(now);
      },
    };
  }

  it('attaches added peripherals and finds them by id', () => {
    const { board } = makeBoard();
    const led = fakePeripheral('led-red');
    board.addPeripheral(led);
    expect(led.attached).toBe(board);
    expect(board.peripherals).toEqual([led]);
    expect(board.getPeripheral('led-red')).toBe(led);
    expect(board.getPeripheral('nope')).toBeUndefined();
    board.tick(16);
    expect(led.ticks).toEqual([16]);
  });

  it('resets pins, serial and peripherals but keeps registered sources', () => {
    const { board, events } = makeBoard();
    const led = fakePeripheral('led-red');
    board.addPeripheral(led);
    board.registerPulseSource(2, { measure: () => 1234 });
    board.pinMode(13, 'OUTPUT');
    board.digitalWrite(13, 1);
    board.tone(8, 440);
    board.serial.inject('abc');
    board.serial.write('hello');
    const pin13 = board.pins[13];

    board.reset();

    expect(board.pins[13]).toBe(pin13);
    expect(board.pins[13]).toEqual({ mode: null, level: 0, pwm: null, tone: null, servo: null, inputLevel: null, analogInput: null });
    expect(board.pins[8]?.tone).toBeNull();
    expect(board.serial.available()).toBe(0);
    expect(board.serial.transmitted).toBe('');
    expect(led.resets).toBe(1);
    expect(events.at(-1)).toEqual({ type: 'reset' });
    expect(board.peripherals).toEqual([led]);
    return expect(board.pulseIn(2, 1, 10)).resolves.toBe(1234);
  });
});

describe('listeners', () => {
  it('can unsubscribe', () => {
    const { board } = makeBoard();
    const seen: BoardEvent[] = [];
    const off = board.on((e) => seen.push(e));
    board.digitalWrite(13, 1);
    off();
    board.digitalWrite(13, 0);
    expect(seen).toHaveLength(1);
  });

  it('never let a failing listener break the sketch', () => {
    const { board } = makeBoard();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after: BoardEvent[] = [];
    board.on(() => {
      throw new Error('boom');
    });
    board.on((e) => after.push(e));
    expect(() => board.digitalWrite(13, 1)).not.toThrow();
    expect(after).toHaveLength(1);
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('serial port', () => {
  it('queues injected text as bytes for the sketch to read', () => {
    const { board } = makeBoard();
    board.serial.inject('ab');
    expect(board.serial.available()).toBe(2);
    expect(board.serial.peek()).toBe(97);
    expect(board.serial.read()).toBe(97);
    expect(board.serial.read()).toBe(98);
    expect(board.serial.read()).toBe(-1);
    expect(board.serial.peek()).toBe(-1);
    board.serial.inject('°Ā');
    expect(board.serial.read()).toBe(0xb0);
    expect(board.serial.read()).toBe(0x00);
  });

  it('delivers written text to TX listeners and as a serialTx event', () => {
    const { board, events } = makeBoard();
    const received: string[] = [];
    const off = board.serial.onTx((text) => received.push(text));
    board.serial.write('hi\r\n');
    board.serial.write('');
    off();
    board.serial.write('later');
    expect(received).toEqual(['hi\r\n']);
    expect(events).toEqual([
      { type: 'serialTx', text: 'hi\r\n' },
      { type: 'serialTx', text: 'later' },
    ]);
    expect(board.serial.transmitted).toBe('hi\r\nlater');
  });

  it('clears both buffers', () => {
    const { board } = makeBoard();
    board.serial.inject('xyz');
    board.serial.write('out');
    board.serial.clear();
    expect(board.serial.available()).toBe(0);
    expect(board.serial.transmitted).toBe('');
  });

  it('keeps working after many reads and writes', () => {
    const { board } = makeBoard();
    for (let round = 0; round < 50; round++) {
      board.serial.inject('0123456789'.repeat(30));
      let count = 0;
      while (board.serial.read() !== -1) count++;
      expect(count).toBe(300);
    }
    board.serial.inject('z');
    expect(board.serial.available()).toBe(1);
    expect(board.serial.read()).toBe(122);
  });

  it('isolates the sketch from a failing TX listener', () => {
    const { board } = makeBoard();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    board.serial.onTx(() => {
      throw new Error('monitor crashed');
    });
    expect(() => board.serial.write('x')).not.toThrow();
  });
});
