#!/usr/bin/env node
// run-hex.mjs - behavioural test harness for ZERO1 Smart Board firmware on avr8js.
//
// Runs an Intel HEX on an emulated ATmega328P @ 16 MHz (avr8js 0.21.1) wired like the
// ZERO1 board, and records a TRACE of every pin-state change with the simulated time,
// the Serial (USART0) output with timestamps, and decoded bus traffic (74HC595, WS2812,
// servo pulses, buzzer tones, I2C LCD 16x2 via PCF8574 @0x27). Output: JSON.
//
//   node run-hex.mjs <file.hex> --ms <simulated ms> [options]
//
// Options
//   --ms <n>                 simulated time in milliseconds (default 1000)
//   --serial-in <text>       bytes typed into the Serial Monitor (escapes: \n \r \t \\ \xNN)
//   --serial-in-at <ms>      when to start sending them (default 0 = as soon as RX is enabled)
//   --analog A3=512          ADC raw value 0..1023 (default A3=512); repeatable
//   --pin D6=1               external level driven on an input pin (0|1|z); repeatable
//   --at <ms>:<what>         timed input change. <what> = D6=1 | A3=100 | serial=text |
//                            distance=30 | dht=21.5,40 ; repeatable
//   --distance <cm>          plug an HC-SR04 on D3/D2 and put an object at <cm>
//   --dht <T>,<H>            plug a DHT22 on D5 answering T degC and H %RH
//   --echo-delay-us <n>      HC-SR04 trigger-to-echo delay (default 250)
//   --lcd-addr <hex>         I2C address of the LCD backpack (default 0x27; 'none' = no LCD)
//   --lcd-quiet-ms <n>       an LCD 'frame' is recorded once the text is stable this long (default 20)
//   --pins all|zero1|D3,A1   which pins to record in the trace (default all = D2..D13, A0..A5)
//   --max-trace <n>          cap on trace events (default 500000); decoders are not capped
//   --out <file>             write JSON there instead of stdout
//   --summary                human-readable summary on stderr
//   --no-stop-on-halt        keep simulating after the program halted (cli + rjmp .); default: stop there
//
// Programmatic use:  import { simulate } from './run-hex.mjs'; simulate(hexText, opts)

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config,
  AVRUSART, usart0Config, AVRIOPort, portBConfig, portCConfig, portDConfig,
  AVRADC, adcConfig, AVRTWI, twiConfig, AVRSPI, spiConfig, AVREEPROM, EEPROMMemoryBackend,
  eepromConfig, AVRClock, clockConfig, AVRWatchdog, watchdogConfig, PinState,
} from 'avr8js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const F_CPU = 16_000_000;
const CYC_PER_US = F_CPU / 1e6; // 16
const AVR8JS_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules/avr8js/package.json'), 'utf8')).version; }
  catch { return 'unknown'; }
})();

// ---------------------------------------------------------------------------------------
// ZERO1 board wiring
// ---------------------------------------------------------------------------------------
// Arduino pin -> [port letter, bit]
export const PIN_MAP = {
  D0: ['D', 0], D1: ['D', 1], D2: ['D', 2], D3: ['D', 3], D4: ['D', 4], D5: ['D', 5], D6: ['D', 6], D7: ['D', 7],
  D8: ['B', 0], D9: ['B', 1], D10: ['B', 2], D11: ['B', 3], D12: ['B', 4], D13: ['B', 5],
  A0: ['C', 0], A1: ['C', 1], A2: ['C', 2], A3: ['C', 3], A4: ['C', 4], A5: ['C', 5],
};
export const ZERO1_PARTS = {
  D0: 'UART RX (from CH340)', D1: 'UART TX (to CH340)',
  D2: 'ultrasonic ECHO', D3: 'ultrasonic TRIG', D4: 'servo signal', D5: 'DHT22 data',
  D6: 'button 1', D7: 'button 2', D8: 'buzzer (active)', D9: 'NeoPixel WS2812 data',
  D10: '74HC595 CLK (7-seg)', D11: '74HC595 LATCH (7-seg)', D12: '74HC595 DATA (7-seg)',
  D13: 'built-in L LED',
  A0: 'motor driver IN1', A1: 'red LED', A2: 'green LED', A3: 'POT / LDR (analog)',
  A4: 'LCD I2C SDA', A5: 'LCD I2C SCL',
};
const ZERO1_OUTPUTS = ['A1', 'A2', 'D8', 'D4', 'D9', 'D3', 'D12', 'D11', 'D10', 'A0', 'D13'];
const ALL_TRACE_PINS = ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
const PORT_PINS = { B: [], C: [], D: [] }; // bit -> pin name
for (const [name, [p, b]] of Object.entries(PIN_MAP)) PORT_PINS[p][b] = name;

// value encoding in the trace: 0 / 1 = driven low/high (DDR=1), 'z' = input, 'pu' = input + internal pull-up
const stateCode = (s) => (s === PinState.Low ? 0 : s === PinState.High ? 1 : s === PinState.Input ? 'z' : 'pu');

// ---------------------------------------------------------------------------------------
// Intel HEX
// ---------------------------------------------------------------------------------------
export function parseIntelHex(text, flashBytes = 0x8000) {
  const bytes = new Uint8Array(flashBytes).fill(0xff);
  let base = 0, maxAddr = 0, minAddr = Infinity, count = 0, sawEof = false;
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].trim();
    if (!line) continue;
    if (line[0] !== ':') throw new Error(`hex line ${ln + 1}: missing ':'`);
    const raw = Buffer.from(line.slice(1), 'hex');
    const n = raw[0], addr = (raw[1] << 8) | raw[2], type = raw[3];
    if (raw.length !== n + 5) throw new Error(`hex line ${ln + 1}: bad length`);
    let sum = 0; for (const b of raw) sum = (sum + b) & 0xff;
    if (sum !== 0) throw new Error(`hex line ${ln + 1}: bad checksum`);
    if (type === 0) {
      const a = base + addr;
      if (a + n > flashBytes) throw new Error(`hex line ${ln + 1}: address 0x${a.toString(16)} beyond flash`);
      bytes.set(raw.subarray(4, 4 + n), a);
      minAddr = Math.min(minAddr, a); maxAddr = Math.max(maxAddr, a + n); count += n;
    } else if (type === 1) { sawEof = true; break; }
    else if (type === 2) base = ((raw[4] << 8) | raw[5]) << 4;
    else if (type === 4) base = ((raw[4] << 8) | raw[5]) << 16;
    // types 3/5 (start address) ignored: execution starts at the reset vector 0x0000
  }
  return { bytes, dataBytes: count, minAddr: count ? minAddr : 0, maxAddr, sawEof };
}

// ---------------------------------------------------------------------------------------
// Decoders (online, fed with every pin change; independent of the trace cap)
// ---------------------------------------------------------------------------------------
const us = (cyc) => cyc / CYC_PER_US; // exact: multiples of 1/16 are exact doubles

class ShiftRegister595 { // DATA D12, CLK D10, LATCH D11
  constructor() { this.sr = 0; this.nbits = 0; this.data = 0; this.clk = 0; this.latch = 0; this.events = []; }
  onChange(pin, v, cyc) {
    const lvl = v === 1 ? 1 : 0; // inputs/unconfigured read as 0 on the 595 side
    if (pin === 'D12') this.data = lvl;
    else if (pin === 'D10') {
      if (lvl && !this.clk) { this.sr = ((this.sr << 1) | this.data) >>> 0; this.nbits++; }
      this.clk = lvl;
    } else if (pin === 'D11') {
      if (lvl && !this.latch) {
        this.events.push({ t: us(cyc), q: this.sr & 0xff, bin: (this.sr & 0xff).toString(2).padStart(8, '0'), bitsShifted: this.nbits });
        this.nbits = 0;
      }
      this.latch = lvl;
    }
  }
}

class NeoPixelDecoder { // WS2812B on D9: high pulse > ~0.55 us = 1
  constructor() { this.level = 0; this.rise = 0; this.lastFall = -1e18; this.bits = []; this.frameStart = 0; this.frames = []; this.widths = new Map(); }
  closeFrame() {
    if (!this.bits.length) return;
    const pixels = [];
    for (let i = 0; i + 24 <= this.bits.length; i += 24) {
      let g = 0, r = 0, b = 0;
      for (let k = 0; k < 8; k++) { g = (g << 1) | this.bits[i + k]; r = (r << 1) | this.bits[i + 8 + k]; b = (b << 1) | this.bits[i + 16 + k]; }
      pixels.push('#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join(''));
    }
    this.frames.push({ t: us(this.frameStart), tEnd: us(this.lastFall), bits: this.bits.length, pixels });
    this.bits = [];
  }
  onChange(v, cyc) {
    const lvl = v === 1 ? 1 : 0;
    if (lvl === this.level) return;
    if (lvl) {
      if (cyc - this.lastFall >= 50 * CYC_PER_US) { this.closeFrame(); this.frameStart = cyc; }
      this.rise = cyc;
    } else {
      const w = cyc - this.rise;
      this.widths.set(w, (this.widths.get(w) || 0) + 1);
      this.bits.push(w >= 9 ? 1 : 0); // 9 cycles = 0.5625 us, between T0H (0.4) and T1H (0.8)
      this.lastFall = cyc;
    }
    this.level = lvl;
  }
  finish() { this.closeFrame(); }
}

class PulseDecoder { // servo (D4): report pulse width when it changes by > tolUs
  constructor(tolUs) { this.tol = tolUs; this.level = 0; this.rise = null; this.lastRise = null; this.events = []; this.lastW = null; this.count = 0; this.min = Infinity; this.max = -Infinity; }
  onChange(v, cyc) {
    const lvl = v === 1 ? 1 : 0;
    if (lvl === this.level) return;
    this.level = lvl;
    if (lvl) { this.period = this.lastRise === null ? null : us(cyc - this.lastRise); this.lastRise = cyc; this.rise = cyc; return; }
    if (this.rise === null) return;
    const w = us(cyc - this.rise);
    this.count++; this.min = Math.min(this.min, w); this.max = Math.max(this.max, w);
    if (this.lastW === null || Math.abs(w - this.lastW) > this.tol) {
      this.events.push({ t: us(this.rise), widthUs: w, periodUs: this.period, angleDeg: Math.round(((w - 544) / (2400 - 544)) * 180) });
      this.lastW = w;
    }
  }
}

class ToneDecoder { // buzzer (D8): group rising edges with a stable period into tone segments
  constructor() { this.level = 0; this.lastRise = null; this.seg = null; this.segments = []; }
  onChange(v, cyc) {
    const lvl = v === 1 ? 1 : 0;
    if (lvl === this.level) return;
    this.level = lvl;
    if (!lvl) return;
    if (this.lastRise !== null) {
      const p = cyc - this.lastRise;
      if (p < 50 * 1000 * CYC_PER_US) { // < 50 ms => audible periodic signal (>20 Hz)
        if (this.seg && Math.abs(p - this.seg.p) <= Math.max(2 * CYC_PER_US, this.seg.p * 0.02) && this.lastRise === this.seg.end) {
          this.seg.end = cyc; this.seg.n++; this.seg.sum += p;
        } else {
          this.flush();
          this.seg = { start: this.lastRise, end: cyc, p, n: 1, sum: p };
        }
      } else this.flush();
    }
    this.lastRise = cyc;
  }
  flush() {
    const g = this.seg; this.seg = null;
    if (!g || g.n < 4) return; // >= 4 equal periods: filters note-to-note transition artefacts
    const meanP = g.sum / g.n, last = this.segments.at(-1);
    // tone() called again while already sounding (e.g. every loop) restarts Timer2 and leaves a short glitch:
    // same frequency (1%) and a gap < 3 periods -> one continuous tone, glitches counted
    if (last && last._end !== undefined && Math.abs(last._p - meanP) <= 0.01 * meanP && g.start - last._end <= 3 * meanP) {
      last._sum += g.sum; last._n += g.n; last._end = g.end; last._p = last._sum / last._n; // frequency from clean periods only
      last.tEnd = us(g.end); last.periods = last._n; last.glitches = (last.glitches || 0) + 1; last.hz = Math.round((F_CPU / last._p) * 10) / 10;
      return;
    }
    const seg = { t: us(g.start), tEnd: us(g.end), hz: Math.round((F_CPU / meanP) * 10) / 10, periods: g.n };
    Object.defineProperties(seg, { _end: { value: g.end, writable: true }, _p: { value: meanP, writable: true }, _sum: { value: g.sum, writable: true }, _n: { value: g.n, writable: true } });
    this.segments.push(seg);
  }
}

// HD44780 character ROM A00 (the usual one): ASCII except a few glyphs; 0..7 (and 8..15) = CGRAM custom chars
const LCD_ROM_A00 = (c) => (c < 16 ? String.fromCharCode(c & 7) : c === 0x7e ? '\u2192' : c === 0x7f ? '\u2190' : c === 0xdf ? '\u00b0' : c === 0x5c ? '\u00a5' : String.fromCharCode(c));

// HD44780 behind a PCF8574 backpack (LiquidCrystal_I2C wiring: P0=RS P1=RW P2=EN P3=BL P4..7=D4..7)
class Lcd1602 {
  constructor(quietMs = 20) {
    this.quiet = quietMs * 1000 * CYC_PER_US; this.dirtySince = 0;
    this.ddram = new Uint8Array(128).fill(0x20); this.cgram = new Uint8Array(64);
    this.addr = 0; this.cg = false; this.cgAddr = 0; this.id = 1; this.s = 0; this.shift = 0;
    this.eightBit = true; this.hi = null; this.lines2 = false; this.displayOn = false; this.cursor = false; this.blink = false;
    this.backlight = 0; this.lastPcf = 0; this.frames = []; this.dirty = false; this.lastChange = 0; this.lastKey = '';
    this.i2cBytes = 0; this.commands = 0; this.dataWrites = 0;
  }
  pcfWrite(v, cyc) {
    this.i2cBytes++;
    const en = v & 4, wasEn = this.lastPcf & 4;
    this.backlight = (v >> 3) & 1;
    if (wasEn && !en) this.nibble((this.lastPcf >> 4) & 0xf, this.lastPcf & 1, (this.lastPcf >> 1) & 1);
    this.lastPcf = v;
    this.touch(cyc);
  }
  nibble(n, rs, rw) {
    if (rw) return; // reads of busy flag: ignore
    if (this.eightBit) { this.exec((n << 4), rs); return; }
    if (this.hi === null) { this.hi = n; return; }
    const b = (this.hi << 4) | n; this.hi = null; this.exec(b, rs);
  }
  exec(b, rs) {
    if (rs) {
      this.dataWrites++;
      if (this.cg) { this.cgram[this.cgAddr] = b & 0x1f; this.cgAddr = (this.cgAddr + (this.id ? 1 : 63)) & 63; return; }
      this.ddram[this.addr] = b; this.moveAddr(this.id ? 1 : -1); if (this.s) this.shift += this.id ? 1 : -1; return;
    }
    this.commands++;
    if (b & 0x80) { this.cg = false; this.addr = b & 0x7f; }
    else if (b & 0x40) { this.cg = true; this.cgAddr = b & 0x3f; }
    else if (b & 0x20) { this.eightBit = !!(b & 0x10); this.lines2 = !!(b & 0x08); this.hi = null; }
    else if (b & 0x10) { if (b & 0x08) this.shift += (b & 4) ? 1 : -1; else this.moveAddr((b & 4) ? 1 : -1); }
    else if (b & 0x08) { this.displayOn = !!(b & 4); this.cursor = !!(b & 2); this.blink = !!(b & 1); }
    else if (b & 0x04) { this.id = (b >> 1) & 1; this.s = b & 1; }
    else if (b & 0x02) { this.addr = 0; this.shift = 0; this.cg = false; }
    else if (b & 0x01) { this.ddram.fill(0x20); this.addr = 0; this.shift = 0; this.id = 1; this.cg = false; }
  }
  moveAddr(d) {
    if (!this.lines2) { this.addr = (this.addr + d + 80) % 80; return; }
    const line = this.addr >= 0x40 ? 0x40 : 0; let off = (this.addr & 0x3f) + d;
    if (off >= 40) { off = 0; this.addr = line ^ 0x40; return; } // wraps to the other line
    if (off < 0) { off = 39; this.addr = (line ^ 0x40) + off; return; }
    this.addr = line + off;
  }
  visible() {
    const sh = ((this.shift % 40) + 40) % 40, row = (base) => {
      let s = ''; for (let i = 0; i < 16; i++) s += LCD_ROM_A00(this.ddram[base + ((i + sh) % 40)]); return s;
    };
    return [row(0x00), row(0x40)];
  }
  touch(cyc) {
    const lines = this.visible();
    const key = `${this.displayOn ? 1 : 0}${this.backlight}|${lines[0]}|${lines[1]}`;
    if (key !== this.lastKey) { this.lastKey = key; if (!this.dirty) this.dirtySince = cyc; this.dirty = true; this.lastChange = cyc; }
  }
  // a frame = what the display shows once it has been stable for `quiet` (default 20 ms), or after
  // 10 x quiet of continuous changes (so a display rewritten non-stop still produces frames)
  maybeEmit(cyc, force = false) {
    if (!this.dirty) return;
    if (!force && cyc - this.lastChange < this.quiet && cyc - this.dirtySince < 10 * this.quiet) return;
    this.dirty = false;
    const lines = this.visible();
    this.frames.push({ t: us(this.lastChange), display: this.displayOn ? 1 : 0, backlight: this.backlight, lines });
  }
}

// TWI (I2C) bus with the LCD backpack; completes bus events after realistic SCL bit times.
class Zero1TwiBus {
  constructor(cpu, twi, lcdAddr, lcd, log) {
    this.cpu = cpu; this.twi = twi; this.lcdAddr = lcdAddr; this.lcd = lcd; this.log = log; this.target = null;
    this.transactions = 0; this.addressesProbed = new Map();
  }
  bit() { return Math.max(1, Math.round(F_CPU / this.twi.sclFrequency)); }
  later(n, fn) { this.cpu.addClockEvent(fn, n * this.bit()); }
  start() { this.later(1, () => this.twi.completeStart()); }
  stop() { this.target = null; this.later(1, () => this.twi.completeStop()); }
  connectToSlave(addr, write) {
    this.transactions++;
    this.addressesProbed.set(addr, (this.addressesProbed.get(addr) || 0) + 1);
    const ack = this.lcdAddr !== null && addr === this.lcdAddr;
    this.target = ack ? addr : null;
    this.later(9, () => this.twi.completeConnect(ack));
  }
  writeByte(v) {
    const ack = this.target !== null;
    if (ack) this.lcd.pcfWrite(v, this.cpu.cycles);
    this.later(9, () => this.twi.completeWrite(ack));
  }
  readByte() { this.later(9, () => this.twi.completeRead(this.target !== null ? this.lcd.lastPcf : 0xff)); }
}

// ---------------------------------------------------------------------------------------
// Input parsing helpers
// ---------------------------------------------------------------------------------------
export function unescapeText(s) {
  return s.replace(/\\(x[0-9a-fA-F]{2}|n|r|t|\\|0)/g, (_, e) =>
    e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e === '\\' ? '\\' : e === '0' ? '\0' : String.fromCharCode(parseInt(e.slice(1), 16)));
}
function normPin(p) {
  p = String(p).trim().toUpperCase();
  if (/^\d+$/.test(p)) { const n = +p; p = n >= 14 && n <= 19 ? `A${n - 14}` : `D${n}`; }
  if (!PIN_MAP[p]) throw new Error(`unknown pin ${p}`);
  return p;
}
function parseAction(what) { // "D6=1" | "A3=100" | "serial=..." | "distance=30" | "dht=21.5,40"
  const i = what.indexOf('=');
  if (i < 0) throw new Error(`bad input spec '${what}'`);
  const k = what.slice(0, i).trim(), v = what.slice(i + 1);
  const kl = k.toLowerCase();
  if (kl === 'serial') return { kind: 'serial', text: unescapeText(v) };
  if (kl === 'distance') return { kind: 'distance', cm: v === 'none' ? null : Number(v) };
  if (kl === 'dht') { if (v === 'none') return { kind: 'dht', value: null }; const [t, h] = v.split(',').map(Number); return { kind: 'dht', value: { t, h } }; }
  const pin = normPin(k);
  if (/^A[0-7]$/.test(pin) && v.trim() !== '' && !Number.isNaN(Number(v))) // A-pins: number = ADC raw 0..1023
    return { kind: 'analog', pin, raw: Math.max(0, Math.min(1023, Math.round(Number(v)))) };
  const lv = v.trim().toLowerCase();
  return { kind: 'pin', pin, level: lv === 'z' ? null : lv === '1' || lv === 'high' ? 1 : 0 };
}

// ---------------------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------------------
export function simulate(hexText, opts = {}) {
  const tLoad0 = performance.now();
  const o = {
    ms: 1000, serialIn: null, serialInAt: 0, analog: { A3: 512 }, pins: {}, at: [], distance: null, dht: null,
    echoDelayUs: 250, lcdAddr: 0x27, lcdQuietMs: 20, tracePins: 'all', maxTrace: 500_000, stopOnHalt: true, chunkCycles: 16_000, ...opts,
  };
  const img = parseIntelHex(hexText);
  const warnings = [];
  if (!img.sawEof) warnings.push('hex has no EOF record');
  if (img.maxAddr > 0x7e00) warnings.push(`program ends at 0x${img.maxAddr.toString(16)}: overlaps the Optiboot bootloader area (0x7E00..0x7FFF)`);
  const progMem = new Uint16Array(img.bytes.buffer);

  // ---- MCU: ATmega328P, 2 KB SRAM (RAMEND 0x8FF), 1 KB EEPROM
  const cpu = new CPU(progMem, 2048);
  const ports = { B: new AVRIOPort(cpu, portBConfig), C: new AVRIOPort(cpu, portCConfig), D: new AVRIOPort(cpu, portDConfig) };
  const timers = [new AVRTimer(cpu, timer0Config), new AVRTimer(cpu, timer1Config), new AVRTimer(cpu, timer2Config)];
  const usart = new AVRUSART(cpu, usart0Config, F_CPU);
  const adc = new AVRADC(cpu, adcConfig);
  const twi = new AVRTWI(cpu, twiConfig, F_CPU);
  const spi = new AVRSPI(cpu, spiConfig, F_CPU);
  const eeprom = new AVREEPROM(cpu, new EEPROMMemoryBackend(1024), eepromConfig);
  const clock = new AVRClock(cpu, F_CPU, clockConfig);
  const watchdog = new AVRWatchdog(cpu, watchdogConfig, clock);
  void timers; void spi; void eeprom; void watchdog;

  const events = []; // misc notes: resets, halts, input changes
  const lcd = new Lcd1602(o.lcdQuietMs);
  const lcdAddr = o.lcdAddr === null || o.lcdAddr === 'none' ? null : Number(o.lcdAddr);
  const bus = new Zero1TwiBus(cpu, twi, lcdAddr, lcd);
  twi.eventHandler = bus;

  // ---- external world: what drives each input pin (0 / 1 / null = nothing / 'pull' = external pull-up)
  const ext = {};
  for (const p of Object.keys(PIN_MAP)) ext[p] = null;
  ext.D0 = 1;          // CH340 TX idles high
  ext.D6 = 0; ext.D7 = 0; // buttons: pull-down resistor, released (simulator default "pressed = HIGH")
  ext.A4 = 'pull'; ext.A5 = 'pull'; // I2C pull-ups on the LCD backpack
  const analogRaw = { A0: 0, A1: 0, A2: 0, A3: 0, A4: 0, A5: 0, A6: 0, A7: 0 };
  let distanceCm = null, dhtValue = null;

  const applyLevel = (p) => {
    const [pl, bit] = PIN_MAP[p]; const port = ports[pl];
    const e = ext[p];
    let lvl;
    if (e === 0 || e === 1) lvl = e;
    else if (e === 'pull') lvl = 1;
    else lvl = (cpu.data[port.portConfig.PORT] >> bit) & 1; // floating: internal pull-up or (assumed) low
    port.setPin(bit, lvl);
  };
  const setAnalog = (p, raw) => {
    const ch = Number(p.slice(1));
    analogRaw[p] = raw;
    adc.channelValues[ch] = (raw * 5) / 1024; // exact dyadic value -> ADC returns exactly raw
    if (ch <= 5) { ext[p] = raw >= 614 ? 1 : raw <= 307 ? 0 : ext[p] ?? (raw >= 512 ? 1 : 0); applyLevel(p); }
  };

  // ---- trace
  const traceSet = new Set(o.tracePins === 'all' ? ALL_TRACE_PINS : o.tracePins === 'zero1' ? ZERO1_OUTPUTS : String(o.tracePins).split(',').map(normPin));
  const trace = [];
  let traceDropped = 0;
  const pinInfo = {};
  for (const p of Object.keys(PIN_MAP)) pinInfo[p] = { state: 'z', changes: 0, first: null, last: null, highCycles: 0, highSince: null, rises: 0 };
  let firstHigh = null, firstTrace = null, firstSerial = null, wallFirstHigh = null, wallFirstSerial = null, wallRun0 = 0;

  const sr595 = new ShiftRegister595(), neo = new NeoPixelDecoder(), servo = new PulseDecoder(5), tone = new ToneDecoder();
  // HC-SR04 responder state
  let trigRise = null, echoBusyUntil = 0; const echoes = [];
  // DHT22 responder state
  let dhtLowSince = null; const dhtReads = [];

  const schedule = (atCycle, fn) => cpu.addClockEvent(fn, Math.max(1, atCycle - cpu.cycles));

  const onPinChange = (p, v, cyc) => {
    const info = pinInfo[p];
    const prev = info.state;
    info.state = v; info.changes++; if (info.first === null) info.first = cyc; info.last = cyc;
    if (v === 1) { info.highSince = cyc; info.rises++; } else if (prev === 1 && info.highSince !== null) { info.highCycles += cyc - info.highSince; info.highSince = null; }
    if (traceSet.has(p)) {
      if (firstTrace === null) firstTrace = cyc;
      if (trace.length < o.maxTrace) trace.push([us(cyc), p, v]); else traceDropped++;
    }
    if (v === 1 && ZERO1_OUTPUTS.includes(p) && firstHigh === null) { firstHigh = { t: us(cyc), pin: p }; wallFirstHigh = performance.now() - wallRun0; }
    // decoders
    if (p === 'D10' || p === 'D11' || p === 'D12') sr595.onChange(p, v, cyc);
    else if (p === 'D9') neo.onChange(v, cyc);
    else if (p === 'D4') servo.onChange(v, cyc);
    else if (p === 'D8') tone.onChange(v, cyc);
    // HC-SR04: a TRIG high pulse >= 5 us, on its falling edge the sensor answers
    if (p === 'D3') {
      if (v === 1) trigRise = cyc;
      else if (prev === 1 && trigRise !== null) {
        const w = us(cyc - trigRise);
        if (distanceCm !== null && w >= 5 && cyc >= echoBusyUntil) {
          const d = distanceCm; const echoUs = d > 400 || d <= 0 ? 38000 : (d * 2) / 0.0343;
          const tUp = cyc + Math.round(o.echoDelayUs * CYC_PER_US), tDown = tUp + Math.round(echoUs * CYC_PER_US);
          echoBusyUntil = tDown;
          schedule(tUp, () => { ext.D2 = 1; applyLevel('D2'); });
          schedule(tDown, () => { ext.D2 = 0; applyLevel('D2'); });
          if (echoes.length < 1000) echoes.push({ t: us(cyc), trigUs: w, echoUs: Math.round(echoUs * 1000) / 1000, cm: d });
        }
        trigRise = null;
      }
    }
    // DHT22: host holds D5 low >= 500 us then releases -> sensor sends 40 bits
    if (p === 'D5') {
      if (v === 0) dhtLowSince = cyc;
      else if (prev === 0 && dhtLowSince !== null && (v === 'z' || v === 'pu')) {
        const held = us(cyc - dhtLowSince);
        dhtLowSince = null;
        if (dhtValue !== null && held >= 500) {
          const h = Math.round(dhtValue.h * 10) & 0xffff; const tt = Math.round(dhtValue.t * 10);
          const tw = tt < 0 ? (0x8000 | (-tt & 0x7fff)) : tt & 0x7fff;
          const bytes = [h >> 8, h & 0xff, tw >> 8, tw & 0xff]; bytes.push((bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 0xff);
          let t = cyc + 30 * CYC_PER_US; // Tgo: 20..40 us
          const drive = (at, lvl) => schedule(at, () => { ext.D5 = lvl; applyLevel('D5'); });
          drive(t, 0); t += 80 * CYC_PER_US; drive(t, 1); t += 80 * CYC_PER_US;
          for (let i = 0; i < 40; i++) {
            const bit = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
            drive(t, 0); t += 50 * CYC_PER_US; drive(t, 1); t += (bit ? 70 : 27) * CYC_PER_US;
          }
          drive(t, 0); t += 50 * CYC_PER_US; drive(t, 'pull');
          if (dhtReads.length < 1000) dhtReads.push({ t: us(cyc), startLowUs: held, bytes: bytes.map((b) => b.toString(16).padStart(2, '0')).join(' '), tempC: dhtValue.t, humidity: dhtValue.h });
        }
      }
    }
  };

  for (const [pl, port] of Object.entries(ports)) {
    const last = new Array(8).fill('z');
    port.addListener(() => {
      const cyc = cpu.cycles;
      for (let bit = 0; bit < 8; bit++) {
        const p = PORT_PINS[pl][bit]; if (!p) continue;
        const v = stateCode(port.pinState(bit));
        if (v !== last[bit]) {
          last[bit] = v;
          if (ext[p] === null) applyLevel(p); // floating input follows the internal pull-up
          onPinChange(p, v, cyc);
        }
      }
    });
  }

  // ---- serial
  const serialBytes = []; let serialText = ''; let baudSeen = null;
  usart.onByteTransmit = (b) => {
    const cyc = cpu.cycles;
    if (firstSerial === null) { firstSerial = us(cyc); wallFirstSerial = performance.now() - wallRun0; }
    if (baudSeen === null) baudSeen = usart.baudRate;
    serialBytes.push([us(cyc), b]);
    serialText += String.fromCharCode(b);
  };
  const rxQueue = []; let rxDelivered = 0, rxQueued = 0;
  const pumpRx = () => {
    while (rxQueue.length && rxQueue[0].at <= cpu.cycles && usart.rxEnable && !usart.rxBusy) {
      const item = rxQueue[0];
      usart.writeByte(item.bytes[item.i++]); rxDelivered++;
      if (item.i >= item.bytes.length) rxQueue.shift();
      return; // one byte in flight at a time; onRxComplete pumps the next
    }
  };
  usart.onRxComplete = () => pumpRx();

  // ---- initial inputs
  for (const [p, raw] of Object.entries(o.analog || {})) setAnalog(normPin(p), Number(raw));
  for (const [p, lv] of Object.entries(o.pins || {})) { const q = normPin(p); ext[q] = lv; applyLevel(q); }
  const applyAction = (a) => {
    if (a.kind === 'pin') { ext[a.pin] = a.level; applyLevel(a.pin); }
    else if (a.kind === 'analog') setAnalog(a.pin, a.raw);
    else if (a.kind === 'serial') { const bytes = Buffer.from(a.text, 'latin1'); rxQueued += bytes.length; rxQueue.push({ at: cpu.cycles, bytes, i: 0 }); pumpRx(); }
    else if (a.kind === 'distance') { distanceCm = a.cm; ext.D2 = a.cm === null ? null : 0; applyLevel('D2'); }
    else if (a.kind === 'dht') { dhtValue = a.value; ext.D5 = a.value === null ? null : 'pull'; applyLevel('D5'); }
  };
  if (o.distance !== null && o.distance !== undefined) applyAction({ kind: 'distance', cm: Number(o.distance) });
  if (o.dht) applyAction({ kind: 'dht', value: o.dht });
  for (const p of Object.keys(PIN_MAP)) applyLevel(p);

  const timed = [];
  for (const spec of o.at || []) {
    if (typeof spec === 'string') {
      const m = /^([0-9.]+):(.*)$/s.exec(spec); if (!m) throw new Error(`bad --at '${spec}'`);
      timed.push({ cyc: Math.round(Number(m[1]) * 1000 * CYC_PER_US), action: parseAction(m[2]), spec });
    } else timed.push(spec);
  }
  if (o.serialIn !== null && o.serialIn !== undefined) timed.push({ cyc: Math.round(o.serialInAt * 1000 * CYC_PER_US), action: { kind: 'serial', text: o.serialIn }, spec: `serial-in@${o.serialInAt}ms` });
  timed.sort((a, b) => a.cyc - b.cyc);

  // ---- run
  const endCycle = Math.round(o.ms * 1000 * CYC_PER_US);
  let halted = null, instructions = 0, resets = 0;
  cpu.onWatchdogReset = cpu.onWatchdogReset; // (kept: watchdog peripheral installs its own)
  const origReset = cpu.reset.bind(cpu);
  cpu.reset = () => { resets++; events.push({ t: us(cpu.cycles), event: 'reset (watchdog)' }); origReset(); };
  const tLoad1 = performance.now();
  wallRun0 = performance.now();
  let ti = 0;
  while (cpu.cycles < endCycle) {
    while (ti < timed.length && timed[ti].cyc <= cpu.cycles) {
      applyAction(timed[ti].action); events.push({ t: us(cpu.cycles), event: `input ${timed[ti].spec}` }); ti++;
    }
    let stop = Math.min(endCycle, cpu.cycles + o.chunkCycles);
    if (ti < timed.length) stop = Math.min(stop, timed[ti].cyc);
    let n = 0;
    while (cpu.cycles < stop) { avrInstruction(cpu); cpu.tick(); n++; }
    instructions += n;
    pumpRx();
    lcd.maybeEmit(cpu.cycles);
    if (o.stopOnHalt && !cpu.interruptsEnabled && progMem[cpu.pc] === 0xcfff) { // cli; rjmp .-2  (avr-libc _exit)
      halted = { detectedAtUs: us(cpu.cycles), pc: `0x${(cpu.pc * 2).toString(16)}`, note: 'checked at 1 ms chunk ends: the real halt is up to 1 ms earlier' };
      events.push({ t: halted.detectedAtUs, event: `halted at byte address ${halted.pc} (interrupts off, rjmp .-2)` });
      break;
    }
  }
  const wallRun = performance.now() - wallRun0;
  const simCycles = cpu.cycles;
  // close open high intervals
  for (const info of Object.values(pinInfo)) if (info.highSince !== null) { info.highCycles += simCycles - info.highSince; }
  neo.finish(); tone.flush(); lcd.maybeEmit(simCycles, true);

  const pins = {};
  for (const p of Object.keys(PIN_MAP)) {
    const i = pinInfo[p];
    if (!i.changes) continue;
    pins[p] = {
      part: ZERO1_PARTS[p], changes: i.changes, rises: i.rises, final: i.state,
      firstChangeUs: us(i.first), lastChangeUs: us(i.last),
      highPercent: Math.round((i.highCycles / simCycles) * 1e5) / 1e3,
    };
  }

  return {
    tool: 'run-hex.mjs', avr8js: AVR8JS_VERSION, node: process.version,
    mcu: { name: 'ATmega328P', clockHz: F_CPU, sramBytes: 2048, flashBytes: 32768, eepromBytes: 1024 },
    firmware: {
      sha256: crypto.createHash('sha256').update(hexText).digest('hex'),
      bytes: img.dataBytes, lowAddr: img.minAddr, highAddr: img.maxAddr,
    },
    options: {
      ms: o.ms, analog: Object.fromEntries(Object.entries(analogRaw).filter(([, v]) => v)), pins: o.pins, at: (o.at || []).map(String),
      serialIn: o.serialIn, serialInAt: o.serialInAt, distanceCm: o.distance ?? null, dht: o.dht ?? null, lcdAddr: lcdAddr === null ? 'none' : `0x${lcdAddr.toString(16)}`,
      tracePins: [...traceSet],
    },
    timing: {
      simulatedCycles: simCycles, simulatedUs: us(simCycles), requestedUs: o.ms * 1000, instructions,
      avgCyclesPerInstruction: Math.round((simCycles / Math.max(1, instructions)) * 1000) / 1000,
      wallLoadMs: Math.round((tLoad1 - tLoad0) * 10) / 10, wallRunMs: Math.round(wallRun * 10) / 10,
      speedVsRealTime: Math.round((us(simCycles) / 1000 / wallRun) * 100) / 100,
      simulatedMHz: Math.round((simCycles / wallRun / 1000) * 10) / 10,
      halted, resets,
    },
    firstOutput: {
      note: 'simulated time from the reset vector (no bootloader); wall = host time after load',
      firstTraceEventUs: firstTrace === null ? null : us(firstTrace),
      firstOutputHigh: firstHigh, wallMsToFirstOutputHigh: wallFirstHigh === null ? null : Math.round(wallFirstHigh * 100) / 100,
      firstSerialByteUs: firstSerial, wallMsToFirstSerialByte: wallFirstSerial === null ? null : Math.round(wallFirstSerial * 100) / 100,
    },
    accuracy: {
      timeBase: 'cpu.cycles of avr8js; 1 cycle = 62.5 ns; timestamps are exact multiples of 0.0625 us',
      pinTimestamp: 'cycle count at the START of the instruction that wrote PORT/DDR/PIN (OUT/SBI/ST...)',
      serialTimestamp: 'cycle of the UDR write (start of the frame); avr8js has no TX double buffer: UDRE comes back one frame time later',
      knownDeviations: [
        'interrupt entry costs 2 cycles in avr8js vs 4 (+3 for the vector JMP is counted as a normal instruction) on silicon; no extra instruction after RETI',
        'SLEEP and SPM are no-ops; no brown-out/reset pin; fuses/bootloader not modelled (starts at 0x0000)',
        'I2C byte timing is modelled here as 9 SCL bit-times per byte (clock stretching, rise times not modelled)',
        'ADC conversion time follows avr8js (25/13 ADC clocks) - value exact for the raw count requested',
      ],
    },
    trace, traceDropped,
    serial: {
      baud: baudSeen, bytes: serialBytes.length, text: serialText, timeline: serialBytes,
      input: { queued: rxQueued, delivered: rxDelivered },
    },
    decoded: {
      shift595: sr595.events,
      neopixel: { frames: neo.frames, highPulseWidthsCycles: Object.fromEntries([...neo.widths.entries()].sort((a, b) => a[0] - b[0])) },
      servo: { pulses: servo.count, minWidthUs: servo.count ? servo.min : null, maxWidthUs: servo.count ? servo.max : null, changes: servo.events },
      tone: tone.segments,
      lcd: {
        address: lcdAddr === null ? 'none' : `0x${lcdAddr.toString(16)}`, i2cTransactions: bus.transactions,
        addressesProbed: Object.fromEntries([...bus.addressesProbed.entries()].map(([a, n]) => [`0x${a.toString(16).padStart(2, '0')}`, n])),
        pcfBytes: lcd.i2cBytes, commands: lcd.commands, dataWrites: lcd.dataWrites, frames: lcd.frames,
        cgram: Buffer.from(lcd.cgram).toString('hex'),
      },
      ultrasonic: echoes, dht22: dhtReads,
    },
    pins, events, warnings,
  };
}

// ---------------------------------------------------------------------------------------
// JSON pretty printer: nested objects indented, arrays of primitives / small arrays on one line
// ---------------------------------------------------------------------------------------
export function toJson(v, ind = '') {
  const flat = (x) => x === null || typeof x !== 'object' || (Array.isArray(x) && x.every((e) => e === null || typeof e !== 'object'));
  if (flat(v)) return JSON.stringify(v);
  const ni = ind + ' ';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '[\n' + v.map((e) => ni + (flat(e) || (typeof e === 'object' && Object.values(e).every(flat) && JSON.stringify(e).length < 160) ? JSON.stringify(e) : toJson(e, ni))).join(',\n') + '\n' + ind + ']';
  }
  const ks = Object.keys(v);
  if (!ks.length) return '{}';
  return '{\n' + ks.map((k) => `${ni}${JSON.stringify(k)}: ${toJson(v[k], ni)}`).join(',\n') + '\n' + ind + '}';
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { at: [], analog: {}, pins: {} }; let file = null, out = null, summary = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], nx = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--ms') o.ms = Number(nx());
    else if (a === '--serial-in') o.serialIn = unescapeText(nx());
    else if (a === '--serial-in-at') o.serialInAt = Number(nx());
    else if (a === '--analog') { const [p, v] = nx().split('='); o.analog[normPin(p)] = Number(v); }
    else if (a === '--pin') { const [p, v] = nx().split('='); o.pins[normPin(p)] = v === 'z' ? null : Number(v) ? 1 : 0; }
    else if (a === '--at') o.at.push(nx());
    else if (a === '--distance') o.distance = Number(nx());
    else if (a === '--dht') { const [t, h] = nx().split(',').map(Number); o.dht = { t, h }; }
    else if (a === '--echo-delay-us') o.echoDelayUs = Number(nx());
    else if (a === '--lcd-addr') { const v = nx(); o.lcdAddr = v === 'none' ? null : parseInt(v, 16); }
    else if (a === '--pins') o.tracePins = nx();
    else if (a === '--lcd-quiet-ms') o.lcdQuietMs = Number(nx());
    else if (a === '--max-trace') o.maxTrace = Number(nx());
    else if (a === '--no-stop-on-halt') o.stopOnHalt = false;
    else if (a === '--out') out = nx();
    else if (a === '--summary') summary = true;
    else if (a === '-h' || a === '--help') { process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 30).map((l) => l.slice(3)).join('\n') + '\n'); process.exit(0); }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else file = a;
  }
  if (!Object.keys(o.analog).length) delete o.analog;
  return { file, out, summary, o };
}

export function summarize(r) {
  const L = [];
  const t = r.timing;
  L.push(`firmware sha256 ${r.firmware.sha256.slice(0, 16)}...  ${r.firmware.bytes} bytes`);
  L.push(`simulated ${(t.simulatedUs / 1000).toFixed(3)} ms = ${t.simulatedCycles} cycles, ${t.instructions} instr, in ${t.wallRunMs} ms wall (x${t.speedVsRealTime} real time, ${t.simulatedMHz} MHz)${t.halted ? `, HALTED (detected at ${t.halted.detectedAtUs} us)` : ''}`);
  L.push(`first output HIGH: ${r.firstOutput.firstOutputHigh ? `${r.firstOutput.firstOutputHigh.pin} @ ${r.firstOutput.firstOutputHigh.t} us` : 'none'}; first serial byte: ${r.firstOutput.firstSerialByteUs ?? 'none'} us`);
  for (const [p, i] of Object.entries(r.pins)) L.push(`  ${p.padEnd(4)} ${i.part.padEnd(24)} changes=${i.changes} final=${i.final} high=${i.highPercent}%`);
  if (r.serial.bytes) L.push(`serial @${r.serial.baud} baud, ${r.serial.bytes} bytes: ${JSON.stringify(r.serial.text.length > 300 ? r.serial.text.slice(0, 300) + '...' : r.serial.text)}`);
  const d = r.decoded;
  if (d.shift595.length) L.push(`74HC595 latches: ${d.shift595.length}, first: ${d.shift595.slice(0, 6).map((e) => e.bin).join(' ')}`);
  if (d.neopixel.frames.length) L.push(`NeoPixel frames: ${d.neopixel.frames.length}, first: ${d.neopixel.frames.slice(0, 4).map((f) => f.pixels.join(',')).join(' ')}`);
  if (d.servo.pulses) L.push(`servo pulses: ${d.servo.pulses}, width ${d.servo.minWidthUs}..${d.servo.maxWidthUs} us`);
  if (d.tone.length) L.push(`tones: ${d.tone.slice(0, 8).map((s) => `${s.hz}Hz@${(s.t / 1000).toFixed(0)}ms`).join(' ')}${d.tone.length > 8 ? ' ...' : ''}`);
  if (d.lcd.frames.length) L.push(`LCD frames: ${d.lcd.frames.length}, last: ${JSON.stringify(d.lcd.frames.at(-1).lines)}`);
  if (d.ultrasonic.length) L.push(`HC-SR04 pings answered: ${d.ultrasonic.length}`);
  if (d.dht22.length) L.push(`DHT22 reads answered: ${d.dht22.length}`);
  if (r.traceDropped) L.push(`TRACE TRUNCATED: ${r.traceDropped} events dropped`);
  for (const w of r.warnings) L.push(`warning: ${w}`);
  return L.join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (isMain) {
  try {
    const { file, out, summary, o } = parseArgs(process.argv.slice(2));
    if (!file) throw new Error('usage: node run-hex.mjs <file.hex> --ms <n> [--serial-in text] [--analog A3=512] ... (see --help)');
    const r = simulate(fs.readFileSync(file, 'utf8'), o);
    r.firmware.file = path.resolve(file);
    const json = toJson(r) + '\n';
    if (out) fs.writeFileSync(out, json); else process.stdout.write(json);
    if (summary) process.stderr.write(summarize(r) + '\n');
  } catch (e) {
    process.stderr.write(`run-hex: ${e.message}\n`);
    process.exit(2);
  }
}
