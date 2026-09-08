/**
 * Pin Map tab: the lesson-sheet pin table with live Mode and Value columns.
 */
import type { IBoard, PinState } from '../types';

export interface PinMapRow {
  no: number;
  part: string;
  description: string;
  /** Silkscreen label, e.g. "A3" or "D6". */
  pinLabel: string;
  /** Arduino pin number 0..19. */
  pin: number;
}

/** Rows of the "Create the bridge" lesson table, plus the UNO's built-in L LED. */
export const PIN_MAP_ROWS: readonly PinMapRow[] = [
  { no: 1, part: 'Potentiometer', description: 'POT', pinLabel: 'A3', pin: 17 },
  { no: 2, part: 'LDR sensor', description: 'LDR', pinLabel: 'A3', pin: 17 },
  { no: 3, part: 'Push button', description: 'A (Button 1)', pinLabel: 'D6', pin: 6 },
  { no: 4, part: 'Push button', description: 'B (Button 2)', pinLabel: 'D7', pin: 7 },
  { no: 5, part: 'Driver', description: 'IN1 (DC motor)', pinLabel: 'A0', pin: 14 },
  { no: 6, part: 'Servo motor', description: 'Servo', pinLabel: 'D4', pin: 4 },
  { no: 7, part: 'LCD', description: 'SDA', pinLabel: 'A4', pin: 18 },
  { no: 8, part: 'LCD', description: 'SCL', pinLabel: 'A5', pin: 19 },
  { no: 9, part: 'LEDs', description: 'LED RED', pinLabel: 'A1', pin: 15 },
  { no: 10, part: 'LEDs', description: 'LED GREEN', pinLabel: 'A2', pin: 16 },
  { no: 11, part: 'LEDs', description: 'RGB (NeoPixel)', pinLabel: 'D9', pin: 9 },
  { no: 12, part: 'Humidity sensor', description: 'DHT22', pinLabel: 'D5', pin: 5 },
  { no: 13, part: 'Buzzer', description: 'BUZ', pinLabel: 'D8', pin: 8 },
  { no: 14, part: 'Ultrasonic', description: 'Echo', pinLabel: 'D2', pin: 2 },
  { no: 15, part: 'Ultrasonic', description: 'Trig', pinLabel: 'D3', pin: 3 },
  { no: 16, part: '7 Segment', description: 'DATA', pinLabel: 'D12', pin: 12 },
  { no: 17, part: '7 Segment', description: 'LATCH', pinLabel: 'D11', pin: 11 },
  { no: 18, part: '7 Segment', description: 'CLK', pinLabel: 'D10', pin: 10 },
  { no: 19, part: 'UART', description: 'TX', pinLabel: 'D0', pin: 0 },
  { no: 20, part: 'UART', description: 'RX', pinLabel: 'D1', pin: 1 },
  { no: 21, part: 'UNO', description: 'L LED (LED_BUILTIN)', pinLabel: 'D13', pin: 13 },
];

export interface PinMap {
  /** Re-read the board pins and update the Mode/Value cells that changed. */
  refresh(): void;
}

/** Human-readable mode column text. */
export function describePinMode(p: PinState): string {
  return p.mode ?? '—';
}

/**
 * Human-readable value column text: servo angle, tone frequency, PWM duty,
 * digital level or analog reading, whichever applies to the pin right now.
 */
export function describePinValue(p: PinState, pin: number): string {
  if (p.servo !== null) return `${Math.round(p.servo)}°`;
  if (p.tone !== null) return `${p.tone} Hz`;
  if (p.pwm !== null) return `PWM ${p.pwm}/255 (${Math.round((p.pwm / 255) * 100)} %)`;
  if (p.mode === 'OUTPUT') return p.level ? 'HIGH' : 'LOW';
  if (pin >= 14 && p.analogInput !== null && p.mode !== 'INPUT_PULLUP') {
    return `${p.analogInput} (analog)`;
  }
  if (p.inputLevel !== null) return p.inputLevel ? 'HIGH' : 'LOW';
  if (p.mode === 'INPUT_PULLUP') return 'HIGH (pull-up)';
  if (p.mode === 'INPUT') return 'floating';
  return '—';
}

/**
 * Mount the pin table into `container`. Call `refresh()` periodically.
 */
export function createPinMap(container: HTMLElement, board: IBoard): PinMap {
  container.classList.add('z1-pinmap');
  const table = document.createElement('table');
  table.className = 'z1-table';
  table.innerHTML = `
    <caption class="z1-visually-hidden">ZERO1 Smart Board pin map with live values</caption>
    <thead>
      <tr><th scope="col">Sr.No</th><th scope="col">Part</th><th scope="col">Description</th><th scope="col">Pin</th><th scope="col">Mode</th><th scope="col">Value</th></tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  const cells: { pin: number; mode: HTMLTableCellElement; value: HTMLTableCellElement }[] = [];

  for (const row of PIN_MAP_ROWS) {
    const tr = document.createElement('tr');
    for (const text of [String(row.no), row.part, row.description]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    const pinCell = document.createElement('td');
    pinCell.className = 'z1-mono';
    pinCell.textContent = `${row.pinLabel} (${row.pin})`;
    const modeCell = document.createElement('td');
    modeCell.className = 'z1-mono';
    const valueCell = document.createElement('td');
    valueCell.className = 'z1-mono';
    tr.append(pinCell, modeCell, valueCell);
    tbody.appendChild(tr);
    cells.push({ pin: row.pin, mode: modeCell, value: valueCell });
  }
  table.appendChild(tbody);
  container.appendChild(table);

  const note = document.createElement('p');
  note.className = 'z1-muted';
  note.textContent =
    'Value shows what the pin is doing right now: HIGH/LOW, PWM duty, tone frequency, servo angle or the analog reading.';
  container.appendChild(note);

  const refresh = (): void => {
    for (const c of cells) {
      const p = board.pins[c.pin];
      if (!p) continue;
      setText(c.mode, describePinMode(p));
      setText(c.value, describePinValue(p, c.pin));
    }
  };
  refresh();
  return { refresh };
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
