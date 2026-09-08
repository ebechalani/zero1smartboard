/**
 * Settings dialog: the BoardConfig options (how the real board is wired),
 * each with a plain-language explanation, persisted to localStorage.
 */
import { DEFAULT_BOARD_CONFIG, type BoardConfig } from '../types';

/** localStorage key under which the board configuration is saved. */
export const CONFIG_STORAGE_KEY = 'z1.config';

interface SettingOption<V> {
  value: V;
  label: string;
}

interface SettingDef<K extends keyof BoardConfig> {
  key: K;
  label: string;
  help: string;
  options: readonly SettingOption<BoardConfig[K]>[];
}

type AnySettingDef = { [K in keyof BoardConfig]: SettingDef<K> }[keyof BoardConfig];

/** Every BoardConfig option with the wording shown to students and teachers. */
export const SETTING_DEFS: readonly AnySettingDef[] = [
  {
    key: 'buttonWiring',
    label: 'Push buttons (D6, D7)',
    help: 'How the two buttons are connected. This decides whether digitalRead() gives HIGH or LOW while a button is pressed.',
    options: [
      { value: 'pulldown', label: 'Pull-down resistor: pressed reads HIGH (default)' },
      { value: 'pullup', label: 'Pull-up resistor: pressed reads LOW' },
      { value: 'none', label: 'No resistor: use pinMode(pin, INPUT_PULLUP), pressed reads LOW' },
    ],
  },
  {
    key: 'sevenSegCommon',
    label: '7-segment display type',
    help: 'Common cathode: a 1 bit lights a segment. Common anode: a 0 bit lights it (the digit patterns are inverted).',
    options: [
      { value: 'cathode', label: 'Common cathode: 1 = segment on (default)' },
      { value: 'anode', label: 'Common anode: 0 = segment on' },
    ],
  },
  {
    key: 'sevenSegOrder',
    label: '74HC595 output order',
    help: 'Which shift-register output drives segment "a". With Q0=a, the bits of your shiftOut() byte are a,b,c,d,e,f,g,dp from the lowest bit.',
    options: [
      { value: 'Q0=a', label: 'Q0 = a … Q6 = g, Q7 = dp (default)' },
      { value: 'Q7=a', label: 'Q7 = a … Q1 = g, Q0 = dp' },
    ],
  },
  {
    key: 'lcdAddress',
    label: 'LCD I2C address',
    help: 'The address of the I2C backpack behind the LCD. The ZERO1 uses a PCF8574T at 0x27; boards with a PCF8574AT use 0x3F.',
    options: [
      { value: 0x27, label: '0x27 (default)' },
      { value: 0x3f, label: '0x3F' },
    ],
  },
  {
    key: 'buzzerType',
    label: 'Buzzer type',
    help: 'An active buzzer sounds whenever D8 is HIGH and also follows tone(). A passive buzzer only makes sound with tone().',
    options: [
      { value: 'active', label: 'Active: digitalWrite(8, HIGH) beeps, tone() works too (default)' },
      { value: 'passive', label: 'Passive: only tone() makes sound' },
    ],
  },
  {
    key: 'ldrDirection',
    label: 'LDR reading direction',
    help: 'Whether analogRead(A3) gets bigger or smaller when there is more light. It depends on which side of the divider the LDR is on.',
    options: [
      { value: 'brighter-higher', label: 'More light = higher value (default)' },
      { value: 'brighter-lower', label: 'More light = lower value' },
    ],
  },
];

/** Keep only the keys whose values are valid BoardConfig choices. */
export function sanitizeConfig(raw: unknown): Partial<BoardConfig> {
  const out: Partial<BoardConfig> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const record = raw as Record<string, unknown>;
  for (const def of SETTING_DEFS) {
    const value = record[def.key];
    if ((def.options as readonly SettingOption<unknown>[]).some((o) => o.value === value)) {
      (out as Record<string, unknown>)[def.key] = value;
    }
  }
  return out;
}

/** Load the saved configuration (only valid entries; missing keys fall back to defaults later). */
export function loadConfig(): Partial<BoardConfig> {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!stored) return {};
    return sanitizeConfig(JSON.parse(stored));
  } catch {
    return {};
  }
}

/** Persist the configuration for the next visit. */
export function saveConfig(config: BoardConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage unavailable: settings only last for this session.
  }
}

export interface SettingsDialogOptions {
  /** Current configuration, shown when the dialog opens. */
  getConfig(): BoardConfig;
  /** Called with the full configuration when the user presses Save. */
  onApply(config: BoardConfig): void;
}

export interface SettingsDialog {
  open(): void;
  close(): void;
  /** Read the choices currently shown in the form. */
  readForm(): BoardConfig;
  readonly element: HTMLDialogElement;
}

/**
 * Create the settings `<dialog>` and append it to `parent`.
 */
export function createSettingsDialog(parent: HTMLElement, options: SettingsDialogOptions): SettingsDialog {
  const dialog = document.createElement('dialog');
  dialog.className = 'z1-dialog';
  dialog.setAttribute('aria-labelledby', 'z1-settings-title');
  dialog.innerHTML = `
    <form method="dialog" class="z1-dialog-form">
      <h2 id="z1-settings-title">Board settings</h2>
      <p class="z1-muted">These describe how the real ZERO1 board is wired. Change them only if your board behaves differently from the simulator.</p>
      <div data-role="fields"></div>
      <div class="z1-dialog-actions">
        <button type="button" class="z1-btn" data-action="defaults">Restore defaults</button>
        <span class="z1-spacer"></span>
        <button type="button" class="z1-btn" data-action="cancel">Cancel</button>
        <button type="submit" class="z1-btn z1-btn-primary" data-action="save">Save</button>
      </div>
    </form>
  `;
  const fields = dialog.querySelector<HTMLElement>('[data-role="fields"]')!;
  const selects = new Map<keyof BoardConfig, HTMLSelectElement>();

  for (const def of SETTING_DEFS) {
    const wrap = document.createElement('div');
    wrap.className = 'z1-setting';
    const label = document.createElement('label');
    label.htmlFor = `z1-setting-${def.key}`;
    label.textContent = def.label;
    const select = document.createElement('select');
    select.id = `z1-setting-${def.key}`;
    select.name = def.key;
    for (const opt of def.options) {
      const option = document.createElement('option');
      option.value = String(opt.value);
      option.textContent = opt.label;
      select.appendChild(option);
    }
    const help = document.createElement('p');
    help.className = 'z1-setting-help';
    help.id = `z1-setting-${def.key}-help`;
    help.textContent = def.help;
    select.setAttribute('aria-describedby', help.id);
    wrap.append(label, select, help);
    fields.appendChild(wrap);
    selects.set(def.key, select);
  }

  const fill = (config: BoardConfig): void => {
    for (const def of SETTING_DEFS) {
      selects.get(def.key)!.value = String(config[def.key]);
    }
  };

  const readForm = (): BoardConfig => {
    const out: Record<string, unknown> = { ...DEFAULT_BOARD_CONFIG };
    for (const def of SETTING_DEFS) {
      const raw = selects.get(def.key)!.value;
      const match = (def.options as readonly SettingOption<unknown>[]).find((o) => String(o.value) === raw);
      if (match) out[def.key] = match.value;
    }
    return out as unknown as BoardConfig;
  };

  dialog.querySelector('[data-action="defaults"]')!.addEventListener('click', () => fill(DEFAULT_BOARD_CONFIG));
  dialog.querySelector('[data-action="cancel"]')!.addEventListener('click', () => dialog.close());
  dialog.querySelector('form')!.addEventListener('submit', () => {
    const config = readForm();
    saveConfig(config);
    options.onApply(config);
  });

  parent.appendChild(dialog);

  return {
    open() {
      fill(options.getConfig());
      dialog.showModal();
    },
    close: () => dialog.close(),
    readForm,
    element: dialog,
  };
}
