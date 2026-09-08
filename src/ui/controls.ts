/**
 * Inputs panel under the board: sliders for the sensors a student cannot
 * touch through the SVG (light, temperature, humidity, distance), the
 * potentiometer (mirrored with the knob on the board), module plugs and mute.
 */
import type { Zero1Board } from '../zero1';

export interface ControlsOptions {
  /** Called when the "Mute buzzer" checkbox changes. */
  onMuteChange(muted: boolean): void;
  initialMuted: boolean;
}

export interface Controls {
  /** Copy the board state into the sliders/checkboxes (call ~10 times per second). */
  refresh(): void;
}

/** Slider definitions: id → how to read/write the board. */
interface SliderDef {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  read(board: Zero1Board): number;
  write(board: Zero1Board, value: number): void;
  /** Optional icons shown left/right of the slider. */
  icons?: [string, string];
  /** Optional per-slider hint (e.g. "switch is on POT"). */
  hint?: string;
}

const SLIDERS: readonly SliderDef[] = [
  {
    id: 'pot',
    label: 'Potentiometer (A3)',
    min: 0,
    max: 1023,
    step: 1,
    format: (v) => String(v),
    read: (b) => b.potLdr.state.pot,
    write: (b, v) => b.potLdr.setPot(v),
    hint: 'Same as turning the knob on the board.',
  },
  {
    id: 'light',
    label: 'LDR light (A3)',
    min: 0,
    max: 100,
    step: 1,
    format: (v) => `${v} %`,
    read: (b) => b.potLdr.state.light,
    write: (b, v) => b.potLdr.setLight(v),
    icons: ['🌙', '☀️'],
    hint: 'Only read when the POT/LDR switch is on LDR.',
  },
  {
    id: 'temperature',
    label: 'DHT22 temperature (D5)',
    min: -40,
    max: 80,
    step: 0.5,
    format: (v) => `${v.toFixed(1)} °C`,
    read: (b) => b.dht.state.temperature,
    write: (b, v) => b.dht.set(v, b.dht.state.humidity),
  },
  {
    id: 'humidity',
    label: 'DHT22 humidity (D5)',
    min: 0,
    max: 100,
    step: 1,
    format: (v) => `${Math.round(v)} %`,
    read: (b) => b.dht.state.humidity,
    write: (b, v) => b.dht.set(b.dht.state.temperature, v),
  },
  {
    id: 'distance',
    label: 'Ultrasonic distance (D2/D3)',
    min: 2,
    max: 400,
    step: 1,
    format: (v) => `${Math.round(v)} cm`,
    read: (b) => b.ultrasonic.state.distanceCm,
    write: (b, v) => b.ultrasonic.setDistance(v),
  },
];

interface CheckDef {
  id: string;
  label: string;
  read(board: Zero1Board): boolean;
  write(board: Zero1Board, on: boolean): void;
}

const PLUG_CHECKS: readonly CheckDef[] = [
  {
    id: 'servo-plugged',
    label: 'Servo plugged',
    read: (b) => b.servo.state.connected,
    write: (b, on) => b.servo.setConnected(on),
  },
  {
    id: 'ultrasonic-plugged',
    label: 'Ultrasonic plugged',
    read: (b) => b.ultrasonic.state.connected,
    write: (b, on) => b.ultrasonic.setConnected(on),
  },
  {
    id: 'dht-plugged',
    label: 'DHT22 plugged',
    read: (b) => b.dht.state.connected,
    write: (b, on) => b.dht.setConnected(on),
  },
];

/**
 * Mount the inputs panel into `container`.
 */
export function createControls(container: HTMLElement, board: Zero1Board, options: ControlsOptions): Controls {
  container.classList.add('z1-inputs');

  const title = document.createElement('h2');
  title.className = 'z1-panel-title';
  title.textContent = 'Inputs';
  container.appendChild(title);

  // --- A3 source badge (POT / LDR switch mirror) ---
  const sourceRow = document.createElement('div');
  sourceRow.className = 'z1-source-row';
  const sourceLabel = document.createElement('span');
  sourceLabel.textContent = 'A3 reads:';
  const sourceButton = document.createElement('button');
  sourceButton.type = 'button';
  sourceButton.className = 'z1-source-badge';
  sourceButton.setAttribute('aria-label', 'Flip the POT/LDR switch on the board');
  sourceButton.title = 'Flip the POT/LDR switch';
  sourceButton.addEventListener('click', () => {
    board.potLdr.setSource(board.potLdr.state.source === 'pot' ? 'ldr' : 'pot');
    refresh();
  });
  sourceRow.append(sourceLabel, sourceButton);
  container.appendChild(sourceRow);

  // --- Sliders ---
  const sliders = SLIDERS.map((def) => {
    const row = document.createElement('div');
    row.className = 'z1-control';
    row.dataset.control = def.id;

    const label = document.createElement('label');
    label.htmlFor = `z1-input-${def.id}`;
    label.textContent = def.label;

    const track = document.createElement('div');
    track.className = 'z1-control-track';
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `z1-input-${def.id}`;
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    if (def.icons) {
      const left = document.createElement('span');
      left.className = 'z1-control-icon';
      left.setAttribute('aria-hidden', 'true');
      left.textContent = def.icons[0];
      const right = document.createElement('span');
      right.className = 'z1-control-icon';
      right.setAttribute('aria-hidden', 'true');
      right.textContent = def.icons[1];
      track.append(left, input, right);
    } else {
      track.appendChild(input);
    }

    const value = document.createElement('output');
    value.className = 'z1-control-value';
    value.setAttribute('for', input.id);

    row.append(label, track, value);
    if (def.hint) {
      const hint = document.createElement('span');
      hint.className = 'z1-control-hint';
      hint.textContent = def.hint;
      row.appendChild(hint);
    }
    container.appendChild(row);

    // While the pointer drags the slider, refresh() must not push the board
    // value back into it (the board value can lag by a refresh interval).
    let dragging = false;
    input.addEventListener('pointerdown', () => (dragging = true));
    const endDrag = (): void => {
      dragging = false;
    };
    // The pointer may be released outside the slider, so listen on the window too.
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    input.addEventListener('blur', endDrag);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      def.write(board, v);
      value.value = def.format(v);
    });

    return {
      def,
      row,
      input,
      value,
      isDragging: () => dragging,
    };
  });

  // --- Checkboxes ---
  const checksRow = document.createElement('div');
  checksRow.className = 'z1-checks';
  const plugs = PLUG_CHECKS.map((def) => {
    const input = makeCheckbox(checksRow, `z1-input-${def.id}`, def.label);
    input.addEventListener('change', () => def.write(board, input.checked));
    return { def, input };
  });
  const mute = makeCheckbox(checksRow, 'z1-input-mute', 'Mute buzzer');
  mute.checked = options.initialMuted;
  mute.addEventListener('change', () => options.onMuteChange(mute.checked));
  container.appendChild(checksRow);

  const refresh = (): void => {
    const source = board.potLdr.state.source;
    const sourceText = source === 'pot' ? 'POT (potentiometer)' : 'LDR (light sensor)';
    if (sourceButton.textContent !== sourceText) sourceButton.textContent = sourceText;
    sourceButton.dataset.source = source;

    for (const s of sliders) {
      const v = s.def.read(board);
      if (!s.isDragging() && Number(s.input.value) !== v) s.input.value = String(v);
      const text = s.def.format(v);
      if (s.value.value !== text) s.value.value = text;
      if (s.def.id === 'pot' || s.def.id === 'light') {
        s.row.classList.toggle('is-inactive', (s.def.id === 'pot') !== (source === 'pot'));
      }
    }
    for (const p of plugs) {
      const on = p.def.read(board);
      if (p.input.checked !== on) p.input.checked = on;
    }
  };
  refresh();
  return { refresh };
}

function makeCheckbox(parent: HTMLElement, id: string, text: string): HTMLInputElement {
  const label = document.createElement('label');
  label.className = 'z1-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  label.append(input, document.createTextNode(` ${text}`));
  parent.appendChild(label);
  return input;
}
