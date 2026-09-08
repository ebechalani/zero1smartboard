// @vitest-environment happy-dom
/**
 * UI panel tests (happy-dom). These cover the pure logic of the panels that
 * do not need the board or the transpiler: serial monitor line endings and
 * buffering, share-link encoding, settings persistence, pin map wording,
 * console click-to-line and the examples menu grouping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardConfig, IBoard, PinState } from '../src/types';
import { DEFAULT_BOARD_CONFIG, PIN_COUNT } from '../src/types';
import type { Zero1Board } from '../src/zero1';
import { applyLineEnding, createSerialMonitor, detectBaud, type LineEnding } from '../src/ui/serial-monitor';
import { codeFromHash, decodeShareCode, encodeShareCode } from '../src/ui/editor';
import { CONFIG_STORAGE_KEY, createSettingsDialog, loadConfig, sanitizeConfig, saveConfig } from '../src/ui/settings';
import { PIN_MAP_ROWS, createPinMap, describePinValue } from '../src/ui/pinmap';
import { createConsolePanel } from '../src/ui/console-panel';
import { createControls } from '../src/ui/controls';
import { createExamplesMenu, groupExamples } from '../src/ui/examples-menu';

function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Serial monitor
// ---------------------------------------------------------------------------

describe('serial monitor line endings', () => {
  it('appends the selected line ending', () => {
    const cases: [LineEnding, string][] = [
      ['none', 'hi'],
      ['newline', 'hi\n'],
      ['cr', 'hi\r'],
      ['both', 'hi\r\n'],
    ];
    for (const [ending, expected] of cases) expect(applyLineEnding('hi', ending)).toBe(expected);
  });

  it('defaults to Newline and sends the input with Enter', () => {
    const sent: string[] = [];
    const monitor = createSerialMonitor(mount(), { onSend: (t) => sent.push(t) });
    expect(monitor.getLineEnding()).toBe('newline');

    const input = document.querySelector<HTMLInputElement>('.z1-serial input[type="text"]')!;
    const form = document.querySelector<HTMLFormElement>('.z1-serial form')!;
    input.value = 'on';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(sent).toEqual(['on\n']);
    expect(input.value).toBe('');

    monitor.setLineEnding('both');
    input.value = 'off';
    monitor.send();
    expect(sent).toEqual(['on\n', 'off\r\n']);
    // What was sent is echoed so students can see it.
    expect(monitor.getText()).toContain('› on');
  });

  it('detects the baud rate from Serial.begin', () => {
    expect(detectBaud('void setup() { Serial.begin(115200); }')).toBe(115200);
    expect(detectBaud('void setup() { Serial . begin ( 57600 ); }')).toBe(57600);
    expect(detectBaud('void setup() {}')).toBe(9600);
  });
});

describe('serial monitor output', () => {
  it('joins partial lines and splits on newlines, dropping carriage returns', () => {
    const monitor = createSerialMonitor(mount(), { onSend: () => {} });
    monitor.append('Temp: ');
    monitor.append('24.5\r\n');
    monitor.append('Hum: 55\r\nDone');
    expect(monitor.getText()).toBe('Temp: 24.5\nHum: 55\nDone');
  });

  it('hides the hint once something is printed and shows it again after clear', () => {
    const monitor = createSerialMonitor(mount(), { onSend: () => {} });
    const hint = document.querySelector<HTMLElement>('.z1-serial-hint')!;
    expect(hint.hidden).toBe(false);
    monitor.append('x');
    expect(hint.hidden).toBe(true);
    monitor.clear();
    expect(hint.hidden).toBe(false);
    expect(monitor.getText()).toBe('');
  });

  it('keeps at most maxLines lines', () => {
    const monitor = createSerialMonitor(mount(), { onSend: () => {}, maxLines: 50 });
    for (let i = 0; i < 200; i++) monitor.append(`line ${i}\n`);
    expect(monitor.lineCount()).toBeLessThanOrEqual(50);
    const text = monitor.getText();
    expect(text).toContain('line 199');
    expect(text).not.toContain('line 0\n');
  });

  it('updates the baud label', () => {
    const monitor = createSerialMonitor(mount(), { onSend: () => {} });
    monitor.setBaud(115200);
    expect(document.querySelector('.z1-serial-baud')!.textContent).toBe('115200 baud');
  });
});

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

describe('share link encoding', () => {
  it('round-trips ASCII and unicode sketches through base64url', () => {
    const samples = [
      '',
      'void setup() {}\nvoid loop() {}\n',
      'Serial.println("Température: 24°C ✓ 🌡");',
      '// odd bytes: ÿþ\x00\t\r\n',
    ];
    for (const s of samples) {
      const encoded = encodeShareCode(s);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(decodeShareCode(encoded)).toBe(s);
    }
  });

  it('parses #code= hashes and rejects garbage', () => {
    const code = 'int x = 1;';
    expect(codeFromHash(`#code=${encodeShareCode(code)}`)).toBe(code);
    expect(codeFromHash('#code=!!!not base64')).toBeNull();
    expect(codeFromHash('#other')).toBeNull();
    expect(codeFromHash('')).toBeNull();
    expect(decodeShareCode('%%%')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('settings persistence', () => {
  it('saves and loads the configuration', () => {
    const config: BoardConfig = { ...DEFAULT_BOARD_CONFIG, buttonWiring: 'pullup', lcdAddress: 0x3f };
    saveConfig(config);
    expect(loadConfig()).toEqual(config);
  });

  it('ignores unknown values and broken JSON', () => {
    localStorage.setItem(CONFIG_STORAGE_KEY, '{not json');
    expect(loadConfig()).toEqual({});
    localStorage.setItem(
      CONFIG_STORAGE_KEY,
      JSON.stringify({ buttonWiring: 'magic', buzzerType: 'passive', lcdAddress: 'x', extra: 1 }),
    );
    expect(loadConfig()).toEqual({ buzzerType: 'passive' });
    expect(sanitizeConfig(null)).toEqual({});
    expect(sanitizeConfig('str')).toEqual({});
  });

  it('applies and persists the form choices on save', () => {
    let applied: BoardConfig | null = null;
    const current: BoardConfig = { ...DEFAULT_BOARD_CONFIG };
    const dialog = createSettingsDialog(mount(), {
      getConfig: () => current,
      onApply: (c) => (applied = c),
    });
    const select = dialog.element.querySelector<HTMLSelectElement>('select[name="sevenSegCommon"]')!;
    select.value = 'anode';
    const lcd = dialog.element.querySelector<HTMLSelectElement>('select[name="lcdAddress"]')!;
    lcd.value = String(0x3f);
    expect(dialog.readForm()).toEqual({ ...DEFAULT_BOARD_CONFIG, sevenSegCommon: 'anode', lcdAddress: 0x3f });

    dialog.element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(applied).toEqual({ ...DEFAULT_BOARD_CONFIG, sevenSegCommon: 'anode', lcdAddress: 0x3f });
    expect(loadConfig()).toEqual({ ...DEFAULT_BOARD_CONFIG, sevenSegCommon: 'anode', lcdAddress: 0x3f });
  });

  it('restores defaults in the form', () => {
    const dialog = createSettingsDialog(mount(), {
      getConfig: () => ({ ...DEFAULT_BOARD_CONFIG, buzzerType: 'passive' }),
      onApply: () => {},
    });
    const select = dialog.element.querySelector<HTMLSelectElement>('select[name="buzzerType"]')!;
    select.value = 'passive';
    dialog.element.querySelector<HTMLButtonElement>('[data-action="defaults"]')!.click();
    expect(dialog.readForm()).toEqual(DEFAULT_BOARD_CONFIG);
  });
});

// ---------------------------------------------------------------------------
// Pin map
// ---------------------------------------------------------------------------

describe('pin map', () => {
  const pin = (over: Partial<PinState>): PinState => ({
    mode: null,
    level: 0,
    pwm: null,
    tone: null,
    servo: null,
    inputLevel: null,
    analogInput: null,
    ...over,
  });

  it('lists the 20 lesson rows plus the built-in LED', () => {
    expect(PIN_MAP_ROWS).toHaveLength(21);
    expect(PIN_MAP_ROWS[0]).toMatchObject({ no: 1, part: 'Potentiometer', pinLabel: 'A3', pin: 17 });
    expect(PIN_MAP_ROWS[20]).toMatchObject({ pinLabel: 'D13', pin: 13 });
  });

  it('describes what a pin is doing in plain words', () => {
    expect(describePinValue(pin({ mode: 'OUTPUT', level: 1 }), 15)).toBe('HIGH');
    expect(describePinValue(pin({ mode: 'OUTPUT', pwm: 128, level: 1 }), 9)).toBe('PWM 128/255 (50 %)');
    expect(describePinValue(pin({ mode: 'OUTPUT', tone: 440, level: 1 }), 8)).toBe('440 Hz');
    expect(describePinValue(pin({ servo: 90 }), 4)).toBe('90°');
    expect(describePinValue(pin({ analogInput: 512 }), 17)).toBe('512 (analog)');
    expect(describePinValue(pin({ mode: 'INPUT', inputLevel: 1 }), 6)).toBe('HIGH');
    expect(describePinValue(pin({ mode: 'INPUT_PULLUP', level: 1 }), 6)).toBe('HIGH (pull-up)');
    expect(describePinValue(pin({ mode: 'INPUT' }), 2)).toBe('floating');
    expect(describePinValue(pin({}), 2)).toBe('—');
  });

  it('renders one row per lesson entry and refreshes Mode/Value from the live board pins', () => {
    const pins: PinState[] = Array.from({ length: PIN_COUNT }, () => pin({}));
    const board = { pins } as unknown as IBoard;
    const map = createPinMap(mount(), board);
    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(PIN_MAP_ROWS.length);

    // Row 9 is "LED RED" on A1 (pin 15). Replacing the PinState object, as a
    // board reset may do, must still be picked up because pins are read live.
    pins[15] = pin({ mode: 'OUTPUT', level: 1 });
    map.refresh();
    const cells = rows[8].querySelectorAll('td');
    expect(cells[3].textContent).toBe('A1 (15)');
    expect(cells[4].textContent).toBe('OUTPUT');
    expect(cells[5].textContent).toBe('HIGH');
  });
});

// ---------------------------------------------------------------------------
// Inputs panel
// ---------------------------------------------------------------------------

describe('inputs panel', () => {
  /** The parts of a Zero1Board the inputs panel touches, with in-place state like the real peripherals. */
  function fakeBoard() {
    return {
      potLdr: {
        state: { source: 'pot' as 'pot' | 'ldr', pot: 512, light: 60, adc: 512 },
        setPot(v: number) {
          this.state.pot = v;
        },
        setLight(v: number) {
          this.state.light = v;
        },
        setSource(s: 'pot' | 'ldr') {
          this.state.source = s;
        },
      },
      dht: {
        state: { temperature: 24, humidity: 55, connected: true },
        set(t: number, h: number) {
          this.state.temperature = t;
          this.state.humidity = h;
        },
        setConnected(on: boolean) {
          this.state.connected = on;
        },
      },
      ultrasonic: {
        state: { distanceCm: 50, connected: true, lastPingAt: null as number | null },
        setDistance(cm: number) {
          this.state.distanceCm = cm;
        },
        setConnected(on: boolean) {
          this.state.connected = on;
        },
      },
      servo: {
        state: { attached: false, target: 90, angle: 90, connected: true },
        setConnected(on: boolean) {
          this.state.connected = on;
        },
      },
    };
  }

  it('writes slider and checkbox changes to the board and mirrors board changes back', () => {
    const fake = fakeBoard();
    const muted: boolean[] = [];
    const controls = createControls(mount(), fake as unknown as Zero1Board, {
      initialMuted: false,
      onMuteChange: (m) => muted.push(m),
    });

    const pot = document.querySelector<HTMLInputElement>('#z1-input-pot')!;
    expect(pot.value).toBe('512');
    pot.value = '900';
    pot.dispatchEvent(new Event('input', { bubbles: true }));
    expect(fake.potLdr.state.pot).toBe(900);

    // The knob on the board SVG moved: the slider follows on the next refresh.
    fake.potLdr.setPot(100);
    controls.refresh();
    expect(pot.value).toBe('100');

    const temperature = document.querySelector<HTMLInputElement>('#z1-input-temperature')!;
    temperature.value = '31.5';
    temperature.dispatchEvent(new Event('input'));
    expect(fake.dht.state).toMatchObject({ temperature: 31.5, humidity: 55 });

    const distance = document.querySelector<HTMLInputElement>('#z1-input-distance')!;
    distance.value = '120';
    distance.dispatchEvent(new Event('input'));
    expect(fake.ultrasonic.state.distanceCm).toBe(120);

    const servoPlug = document.querySelector<HTMLInputElement>('#z1-input-servo-plugged')!;
    expect(servoPlug.checked).toBe(true);
    servoPlug.checked = false;
    servoPlug.dispatchEvent(new Event('change'));
    expect(fake.servo.state.connected).toBe(false);

    const mute = document.querySelector<HTMLInputElement>('#z1-input-mute')!;
    mute.checked = true;
    mute.dispatchEvent(new Event('change'));
    expect(muted).toEqual([true]);
  });

  it('flips the POT/LDR switch from the badge and greys out the unused slider', () => {
    const fake = fakeBoard();
    createControls(mount(), fake as unknown as Zero1Board, { initialMuted: false, onMuteChange: () => {} });
    const badge = document.querySelector<HTMLButtonElement>('.z1-source-badge')!;
    expect(badge.textContent).toContain('POT');
    expect(document.querySelector('[data-control="light"]')!.classList.contains('is-inactive')).toBe(true);
    badge.click();
    expect(fake.potLdr.state.source).toBe('ldr');
    expect(badge.textContent).toContain('LDR');
    expect(document.querySelector('[data-control="pot"]')!.classList.contains('is-inactive')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Console panel
// ---------------------------------------------------------------------------

describe('console panel', () => {
  it('shows messages with their level and jumps to the line on click', () => {
    const jumps: number[] = [];
    const panel = createConsolePanel(mount(), { onJumpToLine: (l) => jumps.push(l), maxEntries: 3 });
    panel.push({ level: 'error', text: "'foo' was not declared in this scope", line: 12 });
    panel.push({ level: 'warn', text: 'careful' });
    const entries = document.querySelectorAll<HTMLElement>('.z1-console-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0].dataset.level).toBe('error');
    expect(entries[0].textContent).toContain('line 12');
    entries[0].querySelector<HTMLButtonElement>('.z1-console-line')!.click();
    expect(jumps).toEqual([12]);

    panel.push({ level: 'info', text: 'a' });
    panel.push({ level: 'info', text: 'b' });
    expect(panel.count()).toBe(3);
    panel.setStatus('Running');
    expect(document.querySelector('.z1-console-status')!.textContent).toBe('Running');
    panel.clear();
    expect(panel.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Examples menu
// ---------------------------------------------------------------------------

describe('examples menu', () => {
  const examples = [
    { id: 'a', title: 'Blink', group: 'Outputs', description: 'blinks', source: '// a' },
    { id: 'b', title: 'Button', group: 'Inputs', description: 'button', source: '// b' },
    { id: 'c', title: 'Melody', group: 'Outputs', description: 'melody', source: '// c' },
  ];

  it('groups examples keeping first-seen order', () => {
    expect(groupExamples(examples).map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ['Outputs', ['a', 'c']],
      ['Inputs', ['b']],
    ]);
  });

  it('opens, selects and closes', () => {
    const chosen: string[] = [];
    const menu = createExamplesMenu(mount(), examples, (ex) => chosen.push(ex.id));
    const trigger = document.querySelector<HTMLButtonElement>('.z1-menu > button')!;
    expect(menu.isOpen()).toBe(false);
    trigger.click();
    expect(menu.isOpen()).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // Items are laid out by group: Outputs (a, c) then Inputs (b).
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(items.map((i) => i.textContent)).toEqual(['Blink', 'Melody', 'Button']);
    items[1].click();
    expect(chosen).toEqual(['c']);
    expect(menu.isOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sanity: localStorage is isolated between tests
// ---------------------------------------------------------------------------

describe('test isolation', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('starts with empty storage', () => {
    expect(localStorage.getItem(CONFIG_STORAGE_KEY)).toBeNull();
  });
});
