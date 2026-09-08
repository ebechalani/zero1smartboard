/**
 * Static SVG drawing of the ZERO1 Smart Board.
 *
 * The drawing follows docs/PINOUT.md "Physical layout": a purple PCB with the
 * UNO section top-left, the 16x2 LCD bottom-left, the ZERO1 logo top-right,
 * two rows of on-board modules in a grid, and the right edge carrying the
 * MOTOR screw terminal and the SERVO / ULTRASONIC / DHT22 plug-in headers.
 * The external parts that plug into those headers (SG90 servo, HC-SR04,
 * DHT22 module, DC motor) are drawn in a row under the logo so that they can
 * be animated.
 *
 * Everything the board view animates carries a stable id from BOARD_IDS. The
 * markup is produced by small helpers so coordinates stay easy to adjust.
 */

/** Size of the drawing's viewBox (user units). */
export const BOARD_VIEWBOX = { width: 1000, height: 500 } as const;

/** Geometry of the LCD glass, shared with the view for cursor / custom-glyph placement. */
export const LCD_GEOMETRY = {
  cols: 16,
  rows: 2,
  /** Left edge of column 0. */
  x0: 60,
  /** Top edge of each row. */
  rowY: [327, 369],
  /** Distance between two columns. */
  pitch: 20,
  cellW: 18,
  cellH: 34,
  /** Baseline offset of the glyph inside its cell. */
  baseline: 27,
  fontSize: 26,
  /** Custom 5x8 glyphs: pixel size and pitch inside a cell, and the offset of the first pixel. */
  pixel: { w: 3, h: 3.5, pitchX: 3.4, pitchY: 4, x0: 0.5, y0: 1 },
} as const;

/** Ids of every dynamic element in BOARD_SVG. */
export const BOARD_IDS = {
  root: 'z1-board',
  // UNO indicator LEDs (each has a matching '-glow' element)
  ledOn: 'z1-led-on',
  ledOnGlow: 'z1-led-on-glow',
  ledL: 'z1-led-l',
  ledLGlow: 'z1-led-l-glow',
  ledTx: 'z1-led-tx',
  ledTxGlow: 'z1-led-tx-glow',
  ledRx: 'z1-led-rx',
  ledRxGlow: 'z1-led-rx-glow',
  // LED row
  ledRed: 'z1-led-red',
  ledRedGlow: 'z1-led-red-glow',
  ledGreen: 'z1-led-green',
  ledGreenGlow: 'z1-led-green-glow',
  rgb: 'z1-rgb',
  rgbGlow: 'z1-rgb-glow',
  // 7 segment (a, b, c, d, e, f, g, dp)
  segments: ['z1-seg-a', 'z1-seg-b', 'z1-seg-c', 'z1-seg-d', 'z1-seg-e', 'z1-seg-f', 'z1-seg-g', 'z1-seg-dp'],
  // buzzer
  buzzerWaves: 'z1-buzzer-waves',
  buzzerFreq: 'z1-buzzer-freq',
  // motor
  motorRotor: 'z1-motor-rotor',
  motorLabel: 'z1-motor-label',
  // plug-in modules (the module cell and its right-edge header both toggle "plugged")
  servo: 'z1-servo',
  servoHeader: 'z1-servo-header',
  servoModule: 'z1-servo-module',
  servoHorn: 'z1-servo-horn',
  servoAngle: 'z1-servo-angle',
  servoStatus: 'z1-servo-status',
  ultrasonic: 'z1-ultrasonic',
  ultrasonicHeader: 'z1-ultrasonic-header',
  ultrasonicModule: 'z1-ultrasonic-module',
  ultrasonicPing: 'z1-ultrasonic-ping',
  ultrasonicDistance: 'z1-ultrasonic-distance',
  ultrasonicObstacle: 'z1-ultrasonic-obstacle',
  ultrasonicStatus: 'z1-ultrasonic-status',
  dht: 'z1-dht',
  dhtHeader: 'z1-dht-header',
  dhtModule: 'z1-dht-module',
  dhtTemp: 'z1-dht-temp',
  dhtHum: 'z1-dht-hum',
  dhtStatus: 'z1-dht-status',
  // potentiometer / LDR
  pot: 'z1-pot',
  potKnob: 'z1-pot-knob',
  potLdrSwitch: 'z1-potldr-switch',
  potLdrKnob: 'z1-potldr-knob',
  potLdrLabelPot: 'z1-potldr-label-pot',
  potLdrLabelLdr: 'z1-potldr-label-ldr',
  potLdrValue: 'z1-potldr-value',
  ldrRing: 'z1-ldr-ring',
  // buttons
  buttonA: 'z1-button-a',
  buttonACap: 'z1-button-a-cap',
  buttonB: 'z1-button-b',
  buttonBCap: 'z1-button-b-cap',
  // LCD
  lcdGlass: 'z1-lcd-glass',
  lcdCells: 'z1-lcd-cells',
  lcdCursor: 'z1-lcd-cursor',
  lcdBlink: 'z1-lcd-blink',
  backlightSwitch: 'z1-backlight-switch',
  backlightKnob: 'z1-backlight-knob',
} as const;

/** Id of the `<text>` element showing LCD cell (row, col). */
export function lcdCellId(row: number, col: number): string {
  return `z1-lcd-cell-${row}-${col}`;
}

/** Id of the `<path>` element that draws a custom 5x8 glyph in LCD cell (row, col). */
export function lcdGlyphId(row: number, col: number): string {
  return `z1-lcd-glyph-${row}-${col}`;
}

/** Geometry the view needs to animate interactive parts (kept next to the drawing). */
export const BOARD_GEOMETRY = {
  potCenter: { x: 483, y: 285 },
  servoShaft: { x: 508, y: 160 },
  motorHub: { x: 950, y: 190 },
  /** Obstacle marker travel on the ultrasonic distance bar. */
  ultrasonicBar: { x0: 612, x1: 767 },
  /** Knob x positions of the two slide switches. */
  potLdrKnobX: { pot: 492, ldr: 512 },
  backlightKnobX: { on: 374, off: 354 },
} as const;

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const C = {
  pad: '#d4af37',
  plastic: '#141414',
  ic: '#1c1c1c',
  icText: '#d1d5db',
  metal: '#c9ced6',
  lcdPcb: '#2f7d4a',
  lcdBezel: '#0f0f0f',
  lcdGlassOff: '#7c8a6c',
  lcdInk: '#1b3d1a',
  segBg: '#2a0a0a',
  red: '#ff3b30',
  green: '#34c759',
  amber: '#fbbf24',
  blue: '#2563eb',
  blueDark: '#1e3a8a',
} as const;

// ---------------------------------------------------------------------------
// Markup helpers
// ---------------------------------------------------------------------------

type Attrs = Record<string, string | number | undefined>;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(v: string | number): string {
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : v;
}

function el(tag: string, attrs: Attrs = {}, children = ''): string {
  let out = '<' + tag;
  for (const key of Object.keys(attrs)) {
    const v = attrs[key];
    if (v !== undefined) out += ` ${key}="${esc(fmt(v))}"`;
  }
  return `${out}>${children}</${tag}>`;
}

const rect = (x: number, y: number, w: number, h: number, a: Attrs = {}): string =>
  el('rect', { x, y, width: w, height: h, ...a });
const circle = (cx: number, cy: number, r: number, a: Attrs = {}): string => el('circle', { cx, cy, r, ...a });
const line = (x1: number, y1: number, x2: number, y2: number, a: Attrs = {}): string =>
  el('line', { x1, y1, x2, y2, ...a });
const path = (d: string, a: Attrs = {}): string => el('path', { d, ...a });
const text = (x: number, y: number, content: string, a: Attrs = {}): string =>
  el('text', { x, y, class: 'z1-label', ...a }, esc(content));
const g = (a: Attrs, ...children: string[]): string => el('g', a, children.join(''));
const title = (s: string): string => el('title', {}, esc(s));

/** Attributes that make a group reachable with the keyboard and announced by screen readers. */
function interactive(role: 'button' | 'switch' | 'slider', label: string): Attrs {
  return { class: 'z1-click', role, tabindex: 0, 'aria-label': label };
}

/** An invisible rectangle that still receives pointer events (enlarges a group's hit area). */
const hitArea = (x: number, y: number, w: number, h: number): string =>
  rect(x, y, w, h, { rx: 4, fill: '#000', 'fill-opacity': 0 });

/** White silkscreen box with a bold label top-left and an optional pin note top-right. */
function silkBox(x: number, y: number, w: number, h: number, label: string, pinNote = ''): string {
  return (
    rect(x, y, w, h, { rx: 6, class: 'z1-silk' }) +
    (label ? text(x + 8, y + 14, label, { 'font-size': 9, 'font-weight': 700 }) : '') +
    (pinNote ? text(x + w - 8, y + 14, pinNote, { 'font-size': 7, 'text-anchor': 'end', 'fill-opacity': 0.85 }) : '')
  );
}

/** A female header strip (UNO style): black bar with a row of pads and a label below. */
function pinStrip(x: number, y: number, n: number, label: string): string {
  const pitch = 12;
  const w = n * pitch + 4;
  const pads: string[] = [];
  for (let i = 0; i < n; i++) pads.push(circle(x + 8 + i * pitch, y + 5, 1.8, { fill: C.pad }));
  return (
    rect(x, y, w, 10, { rx: 1, fill: C.plastic }) +
    pads.join('') +
    text(x + w / 2, y + 18, label, { 'font-size': 6, 'text-anchor': 'middle', 'fill-opacity': 0.8 })
  );
}

/** A DIP integrated circuit with `pinsPerSide` pins on the top and bottom edges. */
function dip(x: number, y: number, w: number, h: number, pinsPerSide: number, label: string, sub = ''): string {
  const parts = [rect(x, y, w, h, { rx: 3, fill: C.ic, stroke: '#000' })];
  const pitch = (w - 12) / (pinsPerSide - 1);
  for (let i = 0; i < pinsPerSide; i++) {
    const px = x + 6 + i * pitch - 2;
    parts.push(rect(px, y - 6, 4, 6, { fill: C.metal }));
    parts.push(rect(px, y + h, 4, 6, { fill: C.metal }));
  }
  parts.push(circle(x + 6, y + h / 2, 4, { fill: '#333' })); // notch
  parts.push(circle(x + 10, y + h - 6, 2, { fill: '#999' })); // pin 1 mark
  parts.push(
    text(x + w / 2, y + h / 2 + (sub ? 0 : 3), label, { 'font-size': 9, 'text-anchor': 'middle', fill: C.icText }),
  );
  if (sub) {
    parts.push(text(x + w / 2, y + h / 2 + 11, sub, { 'font-size': 6.5, 'text-anchor': 'middle', fill: C.icText }));
  }
  return parts.join('');
}

/** A tiny rectangular indicator LED (TX / RX / L / ON) with its glow element. */
function indicatorLed(id: string, glowId: string, x: number, y: number, color: string, label: string): string {
  return (
    rect(x - 4, y - 4, 18, 14, { id: glowId, rx: 4, fill: color, opacity: 0, filter: 'url(#z1-glow)' }) +
    rect(x, y, 10, 6, { id, rx: 1, fill: color, opacity: 0.22, stroke: '#000', 'stroke-opacity': 0.4 }) +
    text(x + 15, y + 6, label, { 'font-size': 7, 'font-weight': 700 })
  );
}

/** A slide switch body with a movable knob. */
function slideSwitch(x: number, y: number, knobId: string, knobX: number): string {
  return (
    rect(x, y, 40, 14, { rx: 3, fill: C.plastic, stroke: '#333' }) +
    rect(knobX, y + 2, 16, 10, { id: knobId, rx: 2, fill: '#d1d5db', stroke: '#6b7280' })
  );
}

/** A 7-segment horizontal bar polygon centred on (cx, cy). */
function hSeg(cx: number, cy: number, len: number, t: number): string {
  const h = len / 2;
  const k = t / 2;
  return `${cx - h},${cy} ${cx - h + k},${cy - k} ${cx + h - k},${cy - k} ${cx + h},${cy} ${cx + h - k},${cy + k} ${cx - h + k},${cy + k}`;
}

/** A 7-segment vertical bar polygon centred on (cx, cy). */
function vSeg(cx: number, cy: number, len: number, t: number): string {
  const h = len / 2;
  const k = t / 2;
  return `${cx},${cy - h} ${cx + k},${cy - h + k} ${cx + k},${cy + h - k} ${cx},${cy + h} ${cx - k},${cy + h - k} ${cx - k},${cy - h + k}`;
}

/** Corner mounting hole with a copper ring. */
function mountingHole(cx: number, cy: number): string {
  return circle(cx, cy, 8, { fill: C.pad }) + circle(cx, cy, 5, { fill: '#17112a' });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function defs(): string {
  const stop = (offset: number, color: string): string => el('stop', { offset, 'stop-color': color });
  return el(
    'defs',
    {},
    el('linearGradient', { id: 'z1-pcb', x1: 0, y1: 0, x2: 1, y2: 1 }, stop(0, '#553291') + stop(1, '#41246c')) +
      el('radialGradient', { id: 'z1-knob' }, stop(0, '#4b5563') + stop(1, '#111827')) +
      el('radialGradient', { id: 'z1-cap' }, stop(0, '#f3f4f6') + stop(1, '#9ca3af')) +
      el('radialGradient', { id: 'z1-cap-pressed' }, stop(0, '#cbd5e1') + stop(1, '#6b7280')) +
      el('radialGradient', { id: 'z1-buzzer' }, stop(0, '#3a3a3a') + stop(1, '#000000')) +
      el(
        'linearGradient',
        { id: 'z1-metal', x1: 0, y1: 0, x2: 1, y2: 0 },
        stop(0, '#9ca3af') + stop(0.5, '#e5e7eb') + stop(1, '#6b7280'),
      ) +
      el(
        'filter',
        { id: 'z1-glow', x: '-60%', y: '-60%', width: '220%', height: '220%' },
        el('feGaussianBlur', { stdDeviation: 4 }),
      ),
  );
}

function style(): string {
  return el(
    'style',
    {},
    [
      `#${BOARD_IDS.root}{user-select:none;-webkit-user-select:none;touch-action:none;display:block}`,
      '.z1-label{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;fill:#fff}',
      '.z1-lcd-text{font-family:ui-monospace,Menlo,Consolas,"Courier New",monospace;fill:#1b3d1a;font-weight:600}',
      '.z1-lcd-glyph{fill:#1b3d1a}',
      '.z1-silk{fill:none;stroke:#fff;stroke-opacity:.8;stroke-width:1.2}',
      '.z1-seg{fill:#3d1414}',
      '.z1-seg.z1-on{fill:#ff3b30}',
      '.z1-click{cursor:pointer;outline:none}',
      '.z1-click:hover{filter:brightness(1.18)}',
      '.z1-click:focus-visible{outline:2px solid #c4b5fd;outline-offset:2px}',
      '.z1-button-cap.z1-pressed circle{fill:url(#z1-cap-pressed)}',
      '.z1-unplugged{opacity:.32}',
      '@keyframes z1-wave{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}',
      '.z1-sounding{animation:z1-wave .4s linear infinite}',
    ].join(''),
  );
}

function pcb(): string {
  return (
    rect(3, 3, 994, 494, { rx: 20, fill: 'url(#z1-pcb)', stroke: '#2b1747', 'stroke-width': 2 }) +
    mountingHole(22, 22) +
    mountingHole(978, 22) +
    mountingHole(22, 478) +
    mountingHole(978, 478)
  );
}

function unoSection(): string {
  return g(
    { class: 'z1-uno' },
    title('Arduino UNO (ATmega328P)'),
    rect(40, 24, 380, 212, { rx: 10, class: 'z1-silk' }),
    text(52, 40, 'ARDUINO UNO', { 'font-size': 9, 'font-weight': 700, 'letter-spacing': 1.5 }),
    pinStrip(176, 28, 18, 'DIGITAL (PWM ~)'),
    pinStrip(176, 220, 8, 'POWER'),
    pinStrip(330, 220, 6, 'ANALOG IN'),
    // USB-B jack
    rect(44, 52, 42, 40, { rx: 2, fill: C.metal, stroke: '#8a9099' }),
    rect(52, 60, 28, 24, { rx: 1, fill: '#6b7280' }),
    text(65, 102, 'USB', { 'font-size': 7, 'text-anchor': 'middle' }),
    // reset button
    rect(100, 54, 18, 18, { rx: 2, fill: '#222' }),
    circle(109, 63, 5, { fill: '#d1d5db' }),
    text(109, 82, 'RESET', { 'font-size': 6.5, 'text-anchor': 'middle' }),
    // USB-serial chip
    rect(92, 96, 26, 18, { rx: 1, fill: C.ic }),
    text(105, 108, 'CH340', { 'font-size': 6, 'text-anchor': 'middle', fill: C.icText }),
    // crystal
    rect(128, 56, 28, 12, { rx: 6, fill: '#c0c4c8', stroke: '#888' }),
    text(142, 78, '16 MHz', { 'font-size': 6, 'text-anchor': 'middle' }),
    // L / TX / RX LEDs
    g(
      {},
      title('Built-in LED L — D13 · TX/RX — Serial Monitor (D0/D1)'),
      indicatorLed(BOARD_IDS.ledL, BOARD_IDS.ledLGlow, 128, 96, C.amber, 'L'),
      indicatorLed(BOARD_IDS.ledTx, BOARD_IDS.ledTxGlow, 128, 110, C.amber, 'TX'),
      indicatorLed(BOARD_IDS.ledRx, BOARD_IDS.ledRxGlow, 128, 124, C.amber, 'RX'),
    ),
    // microcontroller
    dip(160, 100, 136, 46, 14, 'ATmega328P', '-PU'),
    // ICSP header
    rect(304, 94, 22, 32, { rx: 2, fill: C.plastic }),
    ...[100, 110, 120].flatMap((y) => [circle(310, y, 3, { fill: C.pad }), circle(320, y, 3, { fill: C.pad })]),
    text(315, 136, 'ICSP', { 'font-size': 6.5, 'text-anchor': 'middle' }),
    // ON/OFF switch + ON LED
    slideSwitch(248, 162, 'z1-power-knob', 270),
    text(247, 188, 'OFF', { 'font-size': 6, 'text-anchor': 'start' }),
    text(289, 188, 'ON', { 'font-size': 6, 'text-anchor': 'end' }),
    g(
      {},
      title('Power LED — lit while a sketch is running'),
      indicatorLed(BOARD_IDS.ledOn, BOARD_IDS.ledOnGlow, 258, 198, C.green, 'ON'),
    ),
    // power sub-section: DC jack, bulk capacitor, regulator
    rect(300, 150, 114, 62, { rx: 4, class: 'z1-silk' }),
    text(306, 161, '9V DC IN', { 'font-size': 6.5, 'font-weight': 700 }),
    rect(306, 168, 38, 30, { rx: 2, fill: C.plastic }),
    circle(325, 183, 7, { fill: '#2a2a2a', stroke: '#444' }),
    circle(365, 182, 13, { fill: '#1f2937', stroke: '#111' }),
    line(357, 172, 357, 192, { stroke: '#9ca3af', 'stroke-width': 3, 'stroke-opacity': 0.7 }),
    rect(386, 164, 22, 6, { fill: '#9ca3af' }),
    rect(386, 168, 22, 24, { rx: 1, fill: '#222' }),
    text(397, 205, '5V', { 'font-size': 6, 'text-anchor': 'middle' }),
  );
}

function lcdControls(): string {
  return g(
    {},
    // contrast trimmer
    rect(300, 244, 18, 18, { rx: 2, fill: C.blue, stroke: C.blueDark }),
    circle(309, 253, 5, { fill: '#cbd5e1' }),
    line(305, 253, 313, 253, { stroke: '#475569', 'stroke-width': 1.2 }),
    line(309, 249, 309, 257, { stroke: '#475569', 'stroke-width': 1.2 }),
    text(309, 271, 'LCD CONTRAST', { 'font-size': 6.5, 'text-anchor': 'middle' }),
    // backlight switch (interactive)
    g(
      { id: BOARD_IDS.backlightSwitch, ...interactive('switch', 'LCD backlight switch'), 'aria-checked': 'true' },
      title('Backlight switch — turns the LCD backlight on/off (works together with lcd.backlight())'),
      hitArea(340, 240, 66, 34),
      slideSwitch(352, 246, BOARD_IDS.backlightKnob, BOARD_GEOMETRY.backlightKnobX.on),
      text(349, 256, 'OFF', { 'font-size': 6, 'text-anchor': 'end' }),
      text(395, 256, 'ON', { 'font-size': 6 }),
      text(372, 271, 'Backlight', { 'font-size': 7, 'text-anchor': 'middle', 'font-weight': 700 }),
    ),
  );
}

function lcdSection(): string {
  const { x0, rowY, pitch, cellW, cellH, cols, rows, baseline, fontSize } = LCD_GEOMETRY;
  const pads: string[] = [];
  for (let i = 0; i < 16; i++) pads.push(circle(67.5 + i * 15, 284, 1.8, { fill: C.pad }));
  const cells: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        text(x0 + c * pitch + cellW / 2, rowY[r] + baseline, '', {
          id: lcdCellId(r, c),
          class: 'z1-lcd-text',
          'font-size': fontSize,
          'text-anchor': 'middle',
        }),
      );
      cells.push(path('', { id: lcdGlyphId(r, c), class: 'z1-lcd-glyph', visibility: 'hidden' }));
    }
  }
  const holes = [
    [30, 286],
    [410, 286],
    [30, 456],
    [410, 456],
  ].map(([x, y]) => circle(x, y, 4, { fill: C.pad }) + circle(x, y, 2.5, { fill: '#17112a' }));
  return g(
    { class: 'z1-lcd' },
    title('LCD 16x2 (I2C 0x27) — SDA A4, SCL A5'),
    rect(20, 276, 400, 190, { rx: 6, fill: C.lcdPcb, stroke: '#1e5a34' }),
    ...holes,
    rect(60, 280, 240, 8, { rx: 1, fill: C.plastic }),
    pads.join(''),
    text(350, 287, 'I2C 0x27', { 'font-size': 7, 'text-anchor': 'middle', 'fill-opacity': 0.9 }),
    text(220, 455, 'LCD 16x2 · SDA A4 · SCL A5', { 'font-size': 7.5, 'text-anchor': 'middle', 'fill-opacity': 0.85 }),
    rect(44, 294, 352, 142, { rx: 4, fill: C.lcdBezel }),
    rect(56, 304, 328, 122, { id: BOARD_IDS.lcdGlass, rx: 2, fill: C.lcdGlassOff }),
    g({ id: BOARD_IDS.lcdCells }, ...cells),
    rect(x0, rowY[0] + cellH - 3, cellW, 3, { id: BOARD_IDS.lcdCursor, fill: C.lcdInk, visibility: 'hidden' }),
    rect(x0, rowY[0], cellW, cellH, { id: BOARD_IDS.lcdBlink, fill: C.lcdInk, opacity: 0.8, visibility: 'hidden' }),
  );
}

function logo(): string {
  const stroke = { fill: 'none', stroke: '#fff', 'stroke-width': 2 };
  return g(
    { class: 'z1-logo' },
    text(572, 70, 'ZERO1', { 'font-size': 50, 'font-weight': 800, 'letter-spacing': 3 }),
    text(572, 96, 'THE BOARD FOR INSPIRATION', { 'font-size': 10.5, 'font-weight': 600, 'letter-spacing': 3 }),
    text(760, 44, 'ICT & ROBOTICS FOR STEAM EDUCATION', { 'font-size': 9.5, 'font-weight': 700, 'letter-spacing': 0.5 }),
    text(760, 60, 'Shaping Tomorrow with IoT, AI & ML', { 'font-size': 9, 'font-style': 'italic' }),
    text(760, 76, 'zero1.education', { 'font-size': 8, 'fill-opacity': 0.75 }),
    // light bulb
    circle(945, 48, 13, stroke),
    path('M938,58 q7,-4 14,0', stroke),
    rect(939, 62, 12, 8, { rx: 2, fill: '#fff' }),
    line(945, 26, 945, 31, stroke),
    line(925, 34, 929, 38, stroke),
    line(965, 34, 961, 38, stroke),
  );
}

// --- external parts row (what plugs into the right-edge headers / MOTOR terminal) ---

/** Top edge and height of the external parts row. */
const PARTS_ROW = { y: 108, h: 98 } as const;

/** Italic "plugged / unplugged" note next to a cell label. */
function statusText(id: string, x: number): string {
  return text(x, PARTS_ROW.y + 14, 'plugged', { id, 'font-size': 7, 'font-style': 'italic', 'fill-opacity': 0.85 });
}

function servoCell(): string {
  const s = BOARD_GEOMETRY.servoShaft;
  const wire = (y: number, color: string): string => line(454, y, 486, y, { stroke: color, 'stroke-width': 2 });
  return g(
    { id: BOARD_IDS.servo, ...interactive('switch', 'Servo module (D4) — plugged'), 'aria-checked': 'true' },
    title('Servo — D4 (click to plug / unplug)'),
    silkBox(440, PARTS_ROW.y, 152, PARTS_ROW.h, 'SERVO', 'D4'),
    statusText(BOARD_IDS.servoStatus, 484),
    g(
      { id: BOARD_IDS.servoModule },
      wire(156, '#92400e'),
      wire(160, '#dc2626'),
      wire(164, '#f97316'),
      rect(476, 153, 80, 10, { rx: 2, fill: '#1d4ed8' }),
      rect(486, 142, 60, 32, { rx: 3, fill: C.blue, stroke: C.blueDark }),
      circle(s.x, s.y, 8, { fill: '#e5e7eb', stroke: '#9ca3af' }),
      g(
        { id: BOARD_IDS.servoHorn, transform: `rotate(0 ${s.x} ${s.y})` },
        rect(s.x - 3, s.y - 26, 6, 28, { rx: 3, fill: '#f3f4f6', stroke: '#9ca3af' }),
        circle(s.x, s.y - 20, 1, { fill: '#9ca3af' }),
        circle(s.x, s.y - 14, 1, { fill: '#9ca3af' }),
        circle(s.x, s.y - 8, 1, { fill: '#9ca3af' }),
        circle(s.x, s.y, 3.5, { fill: '#d1d5db' }),
      ),
      text(568, 164, '90°', { id: BOARD_IDS.servoAngle, 'font-size': 10, 'font-weight': 700, 'text-anchor': 'middle' }),
      text(516, 198, 'SG90', { 'font-size': 6, 'text-anchor': 'middle', 'fill-opacity': 0.8 }),
    ),
  );
}

function ultrasonicCell(): string {
  const bar = BOARD_GEOMETRY.ultrasonicBar;
  const eye = (cx: number): string =>
    circle(cx, 156, 14, { fill: C.metal, stroke: '#6b7280' }) +
    circle(cx, 156, 9, { fill: '#374151' }) +
    circle(cx, 156, 5, { fill: '#111' });
  return g(
    {
      id: BOARD_IDS.ultrasonic,
      ...interactive('switch', 'Ultrasonic module (TRIG D3, ECHO D2) — plugged'),
      'aria-checked': 'true',
    },
    title('Ultrasonic HC-SR04 — TRIG D3, ECHO D2 (click to plug / unplug)'),
    silkBox(600, PARTS_ROW.y, 184, PARTS_ROW.h, 'ULTRASONIC', 'TRIG D3 · ECHO D2'),
    statusText(BOARD_IDS.ultrasonicStatus, 668),
    g(
      { id: BOARD_IDS.ultrasonicModule },
      rect(612, 134, 96, 44, { rx: 2, fill: '#1e40af', stroke: C.blueDark }),
      rect(654, 144, 12, 6, { rx: 1, fill: C.metal }),
      eye(636),
      eye(684),
      g(
        { id: BOARD_IDS.ultrasonicPing, opacity: 0 },
        circle(636, 156, 17, { fill: 'none', stroke: '#93c5fd', 'stroke-width': 2 }),
        circle(684, 156, 17, { fill: 'none', stroke: '#93c5fd', 'stroke-width': 2 }),
      ),
      text(746, 160, '50 cm', {
        id: BOARD_IDS.ultrasonicDistance,
        'font-size': 10,
        'font-weight': 700,
        'text-anchor': 'middle',
      }),
      rect(bar.x0 - 2, 188, bar.x1 - bar.x0 + 9, 6, { rx: 3, fill: '#2b1747', stroke: '#fff', 'stroke-opacity': 0.5 }),
      rect(bar.x0, 184, 5, 14, { id: BOARD_IDS.ultrasonicObstacle, rx: 1, fill: '#f59e0b' }),
      text(660, 202, 'HC-SR04 · obstacle distance', { 'font-size': 6, 'text-anchor': 'middle', 'fill-opacity': 0.8 }),
    ),
  );
}

function dhtCell(): string {
  return g(
    { id: BOARD_IDS.dht, ...interactive('switch', 'DHT22 module (D5) — plugged'), 'aria-checked': 'true' },
    title('DHT22 temperature & humidity — D5 (click to plug / unplug)'),
    silkBox(792, PARTS_ROW.y, 120, PARTS_ROW.h, 'DHT22', 'D5'),
    statusText(BOARD_IDS.dhtStatus, 836),
    g(
      { id: BOARD_IDS.dhtModule },
      rect(804, 136, 26, 46, { rx: 3, fill: '#f3f4f6', stroke: '#9ca3af' }),
      ...[144, 151, 158, 165, 172].map((y) => line(809, y, 825, y, { stroke: '#9ca3af', 'stroke-width': 1.5 })),
      text(838, 156, '24.0 °C', { id: BOARD_IDS.dhtTemp, 'font-size': 11, 'font-weight': 700 }),
      text(838, 176, '55.0 %', { id: BOARD_IDS.dhtHum, 'font-size': 11, 'font-weight': 700 }),
      text(852, 198, 'AM2302', { 'font-size': 6, 'text-anchor': 'middle', 'fill-opacity': 0.8 }),
    ),
  );
}

function motorCell(): string {
  const hub = BOARD_GEOMETRY.motorHub;
  const blade = (angle: number): string =>
    el('ellipse', {
      cx: hub.x,
      cy: hub.y - 12,
      rx: 4,
      ry: 12,
      fill: '#a78bfa',
      transform: `rotate(${angle} ${hub.x} ${hub.y})`,
    });
  return g(
    { class: 'z1-motor' },
    title('DC motor — wired to the MOTOR terminal, driven by IN1 (A0)'),
    silkBox(920, PARTS_ROW.y, 70, PARTS_ROW.h, 'MOTOR', 'A0'),
    text(982, 132, 'OFF', {
      id: BOARD_IDS.motorLabel,
      'font-size': 7,
      'font-weight': 700,
      'text-anchor': 'end',
      'fill-opacity': 0.7,
    }),
    rect(936, 128, 28, 40, { rx: 6, fill: 'url(#z1-metal)', stroke: '#4b5563' }),
    rect(940, 166, 20, 8, { rx: 2, fill: '#374151' }),
    rect(948, 174, 4, 8, { fill: '#9ca3af' }),
    g(
      { id: BOARD_IDS.motorRotor, transform: `rotate(0 ${hub.x} ${hub.y})` },
      blade(0),
      blade(120),
      blade(240),
      circle(hub.x, hub.y, 4, { fill: '#e5e7eb' }),
    ),
  );
}

// --- right edge: MOTOR screw terminal and the plug-in headers ---

/** A right-edge plug-in header: a vertical pad strip with a rotated label on its left and pin names on its right. */
function edgeHeader(id: string, y: number, label: string, pins: string[], tip: string, ariaLabel: string): string {
  const pitch = 10;
  const h = pins.length * pitch + 4;
  const cx = 968;
  const mid = y + h / 2;
  return g(
    { id, ...interactive('switch', ariaLabel), 'aria-checked': 'true' },
    title(tip),
    hitArea(930, y - 3, 60, h + 6),
    rect(cx - 6, y, 12, h, { rx: 2, fill: C.plastic }),
    ...pins.map(
      (name, i) =>
        circle(cx, y + 7 + i * pitch, 2.5, { fill: C.pad }) +
        text(cx + 9, y + 9 + i * pitch, name, { 'font-size': 5.5, 'fill-opacity': 0.9 }),
    ),
    text(948, mid, label, {
      'font-size': 6.5,
      'font-weight': 700,
      'text-anchor': 'middle',
      transform: `rotate(-90 948 ${mid})`,
    }),
  );
}

function rightEdge(): string {
  return g(
    { class: 'z1-edge' },
    rect(928, 212, 64, 250, { rx: 6, class: 'z1-silk' }),
    g(
      {},
      title('MOTOR screw terminal — connect a DC motor here; driven by IN1 (A0)'),
      text(960, 226, 'MOTOR', { 'font-size': 8, 'font-weight': 700, 'text-anchor': 'middle' }),
      rect(938, 232, 44, 34, { rx: 3, fill: '#16a34a', stroke: '#14532d' }),
      circle(949, 249, 6, { fill: '#d1d5db', stroke: '#6b7280' }),
      line(945, 249, 953, 249, { stroke: '#4b5563', 'stroke-width': 1.5 }),
      circle(971, 249, 6, { fill: '#d1d5db', stroke: '#6b7280' }),
      line(967, 249, 975, 249, { stroke: '#4b5563', 'stroke-width': 1.5 }),
      text(960, 276, 'IN1 · A0', { 'font-size': 6, 'text-anchor': 'middle', 'fill-opacity': 0.85 }),
    ),
    edgeHeader(
      BOARD_IDS.servoHeader,
      288,
      'SERVO',
      ['S', '+', '−'],
      'SERVO header — D4 (click to plug / unplug the servo)',
      'Servo header (D4) — plugged',
    ),
    edgeHeader(
      BOARD_IDS.ultrasonicHeader,
      334,
      'ULTRASONIC',
      ['V', 'T', 'E', 'G'],
      'ULTRASONIC header — TRIG D3, ECHO D2 (click to plug / unplug the HC-SR04)',
      'Ultrasonic header (TRIG D3, ECHO D2) — plugged',
    ),
    edgeHeader(
      BOARD_IDS.dhtHeader,
      392,
      'DHT22',
      ['+', 'D', '−'],
      'DHT22 header — D5 (click to plug / unplug the sensor)',
      'DHT22 header (D5) — plugged',
    ),
  );
}

// --- module grid ---

function potLdrCell(): string {
  const p = BOARD_GEOMETRY.potCenter;
  const kx = BOARD_GEOMETRY.potLdrKnobX;
  return g(
    { class: 'z1-potldr' },
    silkBox(440, 212, 152, 120, 'POT / LDR'),
    text(584, 226, 'A3 = 512', { id: BOARD_IDS.potLdrValue, 'font-size': 8, 'text-anchor': 'end', 'font-weight': 700 }),
    // POT / LDR slide switch
    g(
      { id: BOARD_IDS.potLdrSwitch, ...interactive('button', 'POT / LDR switch — A3 reads the potentiometer') },
      title('POT / LDR switch — chooses what A3 reads (click to toggle)'),
      hitArea(470, 230, 80, 18),
      slideSwitch(490, 232, BOARD_IDS.potLdrKnob, kx.pot),
      text(486, 243, 'POT', { id: BOARD_IDS.potLdrLabelPot, 'font-size': 7, 'font-weight': 700, 'text-anchor': 'end' }),
      text(534, 243, 'LDR', { id: BOARD_IDS.potLdrLabelLdr, 'font-size': 7, 'font-weight': 700, 'fill-opacity': 0.5 }),
    ),
    // potentiometer
    g(
      {
        id: BOARD_IDS.pot,
        ...interactive('slider', 'Potentiometer (A3)'),
        'aria-valuemin': 0,
        'aria-valuemax': 1023,
        'aria-valuenow': 512,
      },
      title('Potentiometer — A3 (drag or scroll to turn the knob)'),
      rect(p.x - 27, p.y - 27, 54, 54, { rx: 4, fill: '#1f2937', stroke: '#111' }),
      circle(p.x, p.y, 22, { fill: 'url(#z1-knob)', stroke: '#111' }),
      g(
        { id: BOARD_IDS.potKnob, transform: `rotate(0 ${p.x} ${p.y})` },
        line(p.x, p.y - 6, p.x, p.y - 19, { stroke: '#fff', 'stroke-width': 3, 'stroke-linecap': 'round' }),
        circle(p.x, p.y - 15, 2.5, { fill: '#c4b5fd' }),
      ),
      text(p.x, 322, 'POT', { 'font-size': 7, 'text-anchor': 'middle' }),
    ),
    // LDR with its serpentine track and a light halo
    g(
      { class: 'z1-ldr' },
      title('LDR light sensor — A3 (the light level is set in the inputs panel)'),
      circle(552, 285, 24, { id: BOARD_IDS.ldrRing, fill: '#fde047', opacity: 0.3, filter: 'url(#z1-glow)' }),
      line(546, 298, 546, 310, { stroke: '#9ca3af', 'stroke-width': 2 }),
      line(558, 298, 558, 310, { stroke: '#9ca3af', 'stroke-width': 2 }),
      circle(552, 285, 15, { fill: '#f5d0a9', stroke: '#b45309' }),
      path('M541,277 H563 V281 H541 V285 H563 V289 H541 V293 H563', {
        fill: 'none',
        stroke: '#b91c1c',
        'stroke-width': 1.8,
      }),
      text(552, 322, 'LDR', { 'font-size': 7, 'text-anchor': 'middle' }),
    ),
  );
}

function sevenSegCell(): string {
  const ids = BOARD_IDS.segments;
  const cx = 645;
  const t = 5;
  const segs = [
    hSeg(cx, 241, 26, t),
    vSeg(cx + 13, 253.5, 24, t),
    vSeg(cx + 13, 278.5, 24, t),
    hSeg(cx, 291, 26, t),
    vSeg(cx - 13, 278.5, 24, t),
    vSeg(cx - 13, 253.5, 24, t),
    hSeg(cx, 266, 26, t),
  ];
  return g(
    { class: 'z1-sevenseg' },
    title('7 Segment (74HC595) — DATA D12, LATCH D11, CLK D10'),
    silkBox(596, 212, 108, 120, '7 Segment', 'D12 D11 D10'),
    rect(624, 234, 52, 62, { rx: 3, fill: C.segBg, stroke: '#1a0505' }),
    ...segs.map((points, i) => el('polygon', { id: ids[i], class: 'z1-seg', points })),
    circle(669, 291, 3, { id: ids[7], class: 'z1-seg' }),
    dip(606, 304, 88, 20, 8, '74HC595'),
  );
}

function buzzerCell(): string {
  const arc = (r: number): string => {
    const x = 758 + r * Math.cos((40 * Math.PI) / 180);
    const dy = r * Math.sin((40 * Math.PI) / 180);
    return path(`M${fmt(x)},${fmt(282 - dy)} A${r},${r} 0 0 1 ${fmt(x)},${fmt(282 + dy)}`, {
      fill: 'none',
      stroke: '#fff',
      'stroke-width': 2,
      'stroke-linecap': 'round',
    });
  };
  return g(
    { class: 'z1-buzzer' },
    title('Buzzer — D8 (active buzzer: sounds when HIGH, also follows tone())'),
    silkBox(708, 212, 100, 120, 'BUZZER', 'D8'),
    circle(758, 282, 30, { fill: 'url(#z1-buzzer)', stroke: '#000' }),
    circle(758, 282, 4, { fill: '#333', stroke: '#000' }),
    text(736, 264, '+', { 'font-size': 11, 'font-weight': 700 }),
    g({ id: BOARD_IDS.buzzerWaves, opacity: 0 }, arc(36), arc(42), arc(48)),
    text(758, 326, '', { id: BOARD_IDS.buzzerFreq, 'font-size': 7, 'text-anchor': 'middle' }),
  );
}

function motorDriverCell(): string {
  return g(
    { class: 'z1-motor-driver' },
    title('Motor driver IN1 — A0 (on/off only)'),
    silkBox(812, 212, 108, 120, 'Motor Driver', 'IN1 A0'),
    dip(826, 240, 80, 26, 8, 'L293D'),
    circle(866, 300, 15, { fill: '#1f2937', stroke: '#111' }),
    line(857, 290, 857, 310, { stroke: '#d1d5db', 'stroke-width': 3, 'stroke-opacity': 0.8 }),
  );
}

function ledRow(): string {
  const smdLed = (id: string, glowId: string, cx: number, color: string, label: string, pin: string, tip: string) =>
    g(
      {},
      title(tip),
      circle(cx, 400, 20, { id: glowId, fill: color, opacity: 0, filter: 'url(#z1-glow)' }),
      rect(cx - 12, 392, 24, 16, { rx: 2, fill: '#f1f5f9', stroke: '#cbd5e1' }),
      rect(cx - 8, 395, 16, 10, { id, rx: 2, fill: color, opacity: 0.45 }),
      text(cx, 432, label, { 'font-size': 9, 'font-weight': 700, 'text-anchor': 'middle' }),
      text(cx, 444, pin, { 'font-size': 7, 'text-anchor': 'middle', 'fill-opacity': 0.85 }),
    );
  const rgbPads = [
    [468, 388],
    [488, 388],
    [468, 408],
    [488, 408],
  ].map(([x, y]) => rect(x, y, 4, 4, { fill: C.pad }));
  return g(
    { class: 'z1-leds' },
    silkBox(440, 342, 240, 120, ''),
    g(
      {},
      title('RGB (WS2812) — D9'),
      circle(480, 400, 22, { id: BOARD_IDS.rgbGlow, fill: '#ffffff', opacity: 0, filter: 'url(#z1-glow)' }),
      rect(466, 386, 28, 28, { rx: 2, fill: '#f8fafc', stroke: '#cbd5e1' }),
      ...rgbPads,
      rect(472, 392, 16, 16, { id: BOARD_IDS.rgb, rx: 3, fill: '#e5e7eb', stroke: '#cbd5e1' }),
      text(480, 432, 'RGB', { 'font-size': 9, 'font-weight': 700, 'text-anchor': 'middle' }),
      text(480, 444, 'D9', { 'font-size': 7, 'text-anchor': 'middle', 'fill-opacity': 0.85 }),
    ),
    smdLed(BOARD_IDS.ledRed, BOARD_IDS.ledRedGlow, 560, C.red, 'RED', 'A1', 'Red LED — A1'),
    smdLed(BOARD_IDS.ledGreen, BOARD_IDS.ledGreenGlow, 640, C.green, 'GREEN', 'A2', 'Green LED — A2'),
  );
}

function buttonRow(): string {
  const button = (id: string, capId: string, cx: number, label: string, sub: string, tip: string): string => {
    const pins = [
      [cx - 18, 382],
      [cx + 18, 382],
      [cx - 18, 418],
      [cx + 18, 418],
    ].map(([x, y]) => circle(x, y, 2.5, { fill: '#d1d5db' }));
    return g(
      { id, ...interactive('button', tip), class: 'z1-click z1-button', 'aria-pressed': 'false' },
      title(tip),
      rect(cx - 22, 378, 44, 44, { rx: 3, fill: '#1f2937', stroke: '#111' }),
      ...pins,
      rect(cx + 27, 396, 12, 8, { rx: 1, fill: '#111' }),
      rect(cx + 31, 396, 4, 8, { fill: '#6b7280' }),
      g({ id: capId, class: 'z1-button-cap' }, circle(cx, 400, 15, { fill: 'url(#z1-cap)', stroke: '#111' })),
      text(cx, 440, label, { 'font-size': 9, 'font-weight': 700, 'text-anchor': 'middle' }),
      text(cx, 452, sub, { 'font-size': 7, 'text-anchor': 'middle', 'fill-opacity': 0.85 }),
    );
  };
  return g(
    { class: 'z1-buttons' },
    silkBox(684, 342, 236, 120, ''),
    button(BOARD_IDS.buttonA, BOARD_IDS.buttonACap, 743, 'Button 1', 'D6 · key 1', 'Button 1 — D6 (hold, or press key 1)'),
    button(BOARD_IDS.buttonB, BOARD_IDS.buttonBCap, 861, 'Button 2', 'D7 · key 2', 'Button 2 — D7 (hold, or press key 2)'),
  );
}

/** The complete board drawing (a single `<svg>` element, viewBox 0 0 1000 500). */
export const BOARD_SVG: string = el(
  'svg',
  {
    id: BOARD_IDS.root,
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `0 0 ${BOARD_VIEWBOX.width} ${BOARD_VIEWBOX.height}`,
    role: 'group',
    'aria-label': 'ZERO1 Smart Board',
    class: 'z1-board-svg',
  },
  [
    title('ZERO1 Smart Board'),
    defs(),
    style(),
    pcb(),
    unoSection(),
    lcdControls(),
    lcdSection(),
    logo(),
    servoCell(),
    ultrasonicCell(),
    dhtCell(),
    motorCell(),
    rightEdge(),
    potLdrCell(),
    sevenSegCell(),
    buzzerCell(),
    motorDriverCell(),
    ledRow(),
    buttonRow(),
  ].join(''),
);
