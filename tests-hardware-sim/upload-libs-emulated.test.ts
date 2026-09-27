/**
 * Our MIT replacements for LiquidCrystal_I2C and NewPing, verified on an
 * emulated ATmega328P: the LCD / DHT / ultrasonic example sketches are compiled
 * with the WebAssembly toolchain against the prebuilt bundle and run on avr8js
 * wired like the ZERO1 board (tools/emulator/run-hex.mjs). The LCD screens and
 * the printed distances must equal the traces recorded in the feasibility
 * spike with the original libraries (validation/out/corpus-ref of the spike).
 * Skips cleanly when the toolchain or the bundle is not built.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WasmToolchain } from '../src/upload/toolchain/wasm-toolchain';
import { buildSketch, loadBundle, type Bundle } from '../src/upload/toolchain/arduino-build';
import { toolchainPaths } from '../tests/fakes/upload/toolchain-paths';
// @ts-expect-error plain JavaScript harness (avr8js), no types
import { simulate } from '../tools/emulator/run-hex.mjs';

interface LcdFrame {
  t: number;
  display: number;
  backlight: number;
  lines: [string, string];
}
interface SimResult {
  serial: { text: string };
  decoded: { lcd: { frames: LcdFrame[]; cgram: string }; ultrasonic: unknown[] };
  timing: { halted: unknown };
  warnings: string[];
}

const paths = toolchainPaths();
let tc: WasmToolchain;
let bundle: Bundle;

const example = (id: string): string => readFileSync(new URL(`../src/examples/${id}.ino`, import.meta.url), 'utf8');

async function compile(source: string, fileName: string): Promise<string> {
  const r = await buildSketch(tc, bundle, { source, fileName });
  if (!r.ok) throw new Error(`build failed at ${r.stage}:\n${r.stderr.join('\n')}`);
  return r.hex;
}

/** The screens shown, without the timestamps and without repeats of the same screen. */
const screens = (r: SimResult): string[] => r.decoded.lcd.frames.map((f) => `${f.display}${f.backlight}|${f.lines[0]}|${f.lines[1]}`).filter((s, i, a) => i === 0 || s !== a[i - 1]);

describe.skipIf(!paths)('LiquidCrystal_I2C (ZERO1 edition) on the emulated board', () => {
  beforeAll(async () => {
    const fetchBytes = async (u: string) => new Uint8Array(readFileSync(u.startsWith('file:') ? new URL(u) : u));
    tc = new WasmToolchain({ toolsBase: pathToFileURL(paths!.toolsDir + '/').href, fetchBytes, importGlue: async (url) => (await import(url)).default });
    bundle = await loadBundle(paths!.bundleDir + '/', fetchBytes);
  });

  it('20_lcd_hello shows the same screens as the reference build (text, backlight, one update per second)', async () => {
    const hex = await compile(example('20_lcd_hello'), '20_lcd_hello.ino');
    const r = simulate(hex, { ms: 3500, tracePins: 'zero1' }) as SimResult;
    expect(r.warnings).toEqual([]);
    expect(r.timing.halted).toBeNull();
    // reference (spike validation/out/corpus-ref/20_lcd_hello.json): blank+dark, then the text with the light on, counting seconds
    expect(screens(r)).toEqual(['00|                |                ', '11|Hello, ZERO1!   |Time: 1 s       ', '11|Hello, ZERO1!   |Time: 2 s       ', '11|Hello, ZERO1!   |Time: 3 s       ']);
    const times = r.decoded.lcd.frames.slice(1).map((f) => f.t / 1000);
    expect(Math.abs(times[0] - 1114.5)).toBeLessThan(60); // init sequence + first update, as with the original library
    expect(Math.abs(times[1] - times[0] - 1000)).toBeLessThan(5);
  });

  it('21_lcd_custom_char: createChar() glyphs, write(0/1), the degree sign and the DHT22 reading', async () => {
    const hex = await compile(example('21_lcd_custom_char'), '21_lcd_custom_char.ino');
    const r = simulate(hex, { ms: 5000, dht: { t: 23.4, h: 51.2 }, tracePins: 'zero1' }) as SimResult;
    expect(r.decoded.lcd.cgram).toBe('00000a0e04000000000a1f1f0e04000000000000000000000000000000000000'.padEnd(128, '0'));
    const s = screens(r);
    expect(s[0]).toBe('00|                |                ');
    expect(s).toContain('11|Temp: 23.4°C    |I \u0000 ZERO1       ');
    expect(s).toContain('11|Temp: 23.4°C    |I \u0001 ZERO1       ');
    // the heart alternates every 500 ms
    const hearts = r.decoded.lcd.frames.filter((f) => /ZERO1/.test(f.lines[1])).map((f) => f.lines[1][2]);
    expect(hearts.length).toBeGreaterThanOrEqual(7);
    for (let i = 1; i < hearts.length; i++) expect(hearts[i]).not.toBe(hearts[i - 1]);
  });

  it('31_greenhouse: the LCD and Serial follow the temperature (reference screens)', async () => {
    const hex = await compile(example('31_greenhouse'), '31_greenhouse.ino');
    const r = simulate(hex, { ms: 9000, dht: { t: 24, h: 55 }, at: ['3000:dht=30,50', '6000:dht=36.5,40'], tracePins: 'zero1' }) as SimResult;
    expect(screens(r)).toEqual([
      '00|                |                ',
      '11|Smart greenhouse|                ',
      '11|T:24.0C H:55%   |OK: fan OFF     ',
      '11|T:30.0C H:50%   |Warm: fan ON    ',
      '11|T:36.5C H:40%   |TOO HOT! Fan ON ',
    ]);
    expect(r.serial.text).toMatch(/^T=24\.0C {2}H=55% {2}fan=OFF\r\nT=24\.0C {2}H=55% {2}fan=OFF\r\nT=30\.0C {2}H=50% {2}fan=ON\r\nT=36\.5C {2}H=40% {2}fan=ON {2}ALARM\r\n/);
  });

  it('the other LiquidCrystal_I2C methods compile and behave: cursor, blink, scroll, noBacklight, PROGMEM createChar', async () => {
    const src = `#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
const char bell[8] PROGMEM = {B00100, B01110, B01110, B01110, B11111, B00000, B00100, B00000};
void setup() {
  lcd.init();
  lcd.backlight();
  lcd.createChar(2, bell);
  lcd.setCursor(0, 0); // createChar leaves the address counter in CGRAM (as on the real controller)
  lcd.print("abc");
  lcd.write(2);
  lcd.setCursor(0, 1);
  lcd.printstr("row2");
  lcd.cursor(); lcd.blink(); lcd.noCursor(); lcd.noBlink(); lcd.blink_on(); lcd.cursor_on();
  delay(100);
  lcd.scrollDisplayLeft();
  delay(100);
  lcd.home();
  lcd.print("X");
  delay(100);
  lcd.noBacklight();
  delay(100);
  lcd.setBacklight(1);
  lcd.clear();
  lcd.print(12.5, 1);
}
void loop() {}
`;
    const hex = await compile(src, 'lcd_api.ino');
    const r = simulate(hex, { ms: 2000, tracePins: 'zero1' }) as SimResult;
    const s = screens(r);
    expect(s).toContain('11|abc\u0002            |row2            ');
    expect(s).toContain('11| abc\u0002           | row2           '); // the display window shifted by one column
    expect(s).toContain('11|Xbc\u0002            |row2            '); // home() undoes the shift, X overwrites a
    expect(s).toContain('10|Xbc\u0002            |row2            '); // backlight off
    expect(s.at(-1)).toBe('11|12.5            |                ');
    expect(r.decoded.lcd.cgram.slice(32, 48)).toBe('040e0e0e1f000400');
  });
});

describe.skipIf(!paths)('NewPing (ZERO1 edition) on the emulated board', () => {
  beforeAll(async () => {
    const fetchBytes = async (u: string) => new Uint8Array(readFileSync(u.startsWith('file:') ? new URL(u) : u));
    tc = new WasmToolchain({ toolsBase: pathToFileURL(paths!.toolsDir + '/').href, fetchBytes, importGlue: async (url) => (await import(url)).default });
    bundle = await loadBundle(paths!.bundleDir + '/', fetchBytes);
  });

  const SRC = `#include <NewPing.h>
NewPing sonar(3, 2, 200);
void setup() { Serial.begin(9600); }
void loop() {
  unsigned int us = sonar.ping();
  Serial.print("us="); Serial.print(us);
  Serial.print(" cm="); Serial.print(sonar.ping_cm());
  Serial.print(" in="); Serial.print(sonar.ping_in());
  Serial.print(" med="); Serial.print(sonar.convert_cm(sonar.ping_median(3)));
  Serial.print(" conv="); Serial.println(NewPing::convert_cm(us));
  delay(200);
}
`;

  it('ping_cm / ping_in / ping_median / convert_cm give the distances of the simulator model (42 cm, then 12.5 cm)', async () => {
    const hex = await compile(SRC, 'sonar.ino');
    // the harness answers a 10 us TRIG pulse with an echo of 2·d/0.0343 us (250 us later)
    const r = simulate(hex, { ms: 2500, distance: 42, at: ['1200:distance=12.5'], tracePins: 'zero1' }) as SimResult;
    const lines = r.serial.text.trim().split('\r\n');
    expect(lines.length).toBeGreaterThanOrEqual(6);
    const parse = (l: string) => Object.fromEntries([...l.matchAll(/(\w+)=(\d+)/g)].map((m) => [m[1], +m[2]]));
    const first = parse(lines[0]);
    // 42 cm → echo 2449 us → 2449 / 57 = 42 (truncated like the original), 2449 / 146 = 16 in
    expect(first.us).toBeGreaterThan(2440);
    expect(first.us).toBeLessThan(2470);
    expect(first.cm).toBe(42);
    expect(first.in).toBe(16);
    expect(first.med).toBe(42);
    expect(first.conv).toBe(42);
    const last = parse(lines[lines.length - 1]);
    // 12.5 cm → 729 us → 12 cm, 4 in
    expect(last.cm).toBe(12);
    expect(last.in).toBe(4);
    expect(last.med).toBe(12);
    // the 15_ultrasonic_distance reference prints 41.8/41.7 cm and 12.5/12.4 cm with pulseIn(): same physics
    expect(r.decoded.ultrasonic.length).toBeGreaterThanOrEqual(lines.length * 3);
  });

  it('with the sensor unplugged every method returns 0 (NO_ECHO) without hanging', async () => {
    const hex = await compile(SRC, 'sonar.ino');
    const r = simulate(hex, { ms: 1500, tracePins: 'zero1' }) as SimResult;
    const lines = r.serial.text.trim().split('\r\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) expect(l).toBe('us=0 cm=0 in=0 med=0 conv=0');
  });

  it('an object beyond the maximum distance gives NO_ECHO, and a wider limit passed to ping_cm() applies', async () => {
    const src = `#include <NewPing.h>
NewPing sonar(3, 2, 30);
void setup() { Serial.begin(9600); }
void loop() { Serial.print(sonar.ping_cm()); Serial.print(' '); Serial.println(sonar.ping_cm(100)); delay(100); }
`;
    const hex = await compile(src, 'sonar2.ino');
    const r = simulate(hex, { ms: 800, distance: 60, tracePins: 'zero1' }) as SimResult;
    const lines = r.serial.text.trim().split('\r\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toBe('0 61'); // 60 cm → 3499 us → 3499 / 57 = 61 (truncated), beyond the 30 cm limit of the first call
  });
});
