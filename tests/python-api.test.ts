/**
 * The board API table of Python mode (docs/PYTHON.md §3, src/python/api.ts), its completion
 * items (§7.4: never a name ZERO1 Python refuses) and the "What works" content (§2.15,
 * src/python/help.ts).
 */
import { describe, expect, it } from 'vitest';
import { API_COMPLETIONS, WHAT_WORKS } from '../src/python';
import { API_MODULES, API_PARTS, BUILTINS, MODULE_NAMES, REFUSED_BUILTINS, lookupMember, pinLabel, pinOfText, type ApiMember } from '../src/python/api';

const labels = (items: ReadonlyArray<{ label: string }>) => items.map((i) => i.label);
const allMembers = (): ApiMember[] => [
  ...Object.values(API_MODULES).flatMap((m) => Object.values(m.members)),
  ...Object.values(API_PARTS).flatMap((p) => [...Object.values(p.methods), ...Object.values(p.statics)]),
];

describe('the API table (§3)', () => {
  it('has the modules of §3 (utime is time)', () => {
    expect(MODULE_NAMES).toEqual(['machine', 'time', 'neopixel', 'dht', 'hcsr04', 'math', 'random', 'micropython', 'zero1']);
    expect(Object.keys(API_MODULES.utime.members)).toEqual(Object.keys(API_MODULES.time.members));
  });
  it('looks members up in modules and parts', () => {
    expect(lookupMember('time', 'sleep_ms')?.id).toBe('time.sleep_ms');
    expect(lookupMember('machine', 'Pin')).toMatchObject({ kind: 'class', part: 'Pin' });
    expect(lookupMember('Pin', 'on')).toMatchObject({ kind: 'method', result: 'none' });
    expect(lookupMember('Pin', 'OUT')).toMatchObject({ kind: 'constant', tag: 'pinMode' });
    expect(lookupMember('Pin', 'irq')).toMatchObject({ kind: 'refused', display: 'Pin.irq()' });
    expect(lookupMember('zero1', 'LED_RED')).toMatchObject({ kind: 'constant', value: 15, pin: 'red LED' });
    expect(lookupMember('zero1', 'nope')).toBeUndefined();
    expect(lookupMember('math', 'pi')).toMatchObject({ kind: 'constant', valueKind: 'float' });
  });
  it('every member has its doc; every refused one its hint; the §3 parts take a pin, the ZERO1 parts none', () => {
    for (const m of allMembers()) {
      if (m.kind === 'refused') expect(m.hint, m.id).not.toBe('');
      else expect(m.doc, m.id).not.toBe('');
    }
    const params = (module: 'machine' | 'neopixel' | 'dht' | 'zero1', name: string) => {
      const m = lookupMember(module, name);
      return m && m.kind === 'class' ? m.params.filter((p) => !p.optional).map((p) => p.name) : null;
    };
    expect([params('machine', 'Pin'), params('machine', 'ADC'), params('neopixel', 'NeoPixel'), params('dht', 'DHT22')]).toEqual([['id'], ['pin'], ['pin', 'n'], ['pin']]);
    expect([params('zero1', 'Servo'), params('zero1', 'LCD'), params('zero1', 'Buzzer'), params('zero1', 'SevenSegment'), params('zero1', 'HCSR04')]).toEqual([[], [], [], [], []]);
    expect(lookupMember('ADC', 'read')?.doc).toBe('0-1023 on the ZERO1; on other boards use read_u16().');
  });
  it('reads pins written as text (§3 "Pins")', () => {
    expect(['LED_RED', 'D13', 'A3', 'LED', 'A0', 'D0', 'BUZZER'].map(pinOfText)).toEqual([15, 13, 17, 13, 14, 0, 8]);
    expect(['D14', 'A6', 'X', '13', ''].map(pinOfText)).toEqual([null, null, null, null, null]);
    expect([pinLabel(15), pinLabel(8)]).toEqual(['A1', 'D8']);
  });
});

describe('API_COMPLETIONS (§7.4)', () => {
  it('never offers a name ZERO1 Python refuses', () => {
    const offered = new Set([
      ...labels(API_COMPLETIONS.builtins),
      ...labels(API_COMPLETIONS.keywords),
      ...Object.values(API_COMPLETIONS.moduleMembers).flatMap(labels),
      ...Object.values(API_COMPLETIONS.classMembers).flatMap(labels),
      ...Object.values(API_COMPLETIONS.partMembers).flatMap(labels),
    ]);
    for (const name of ['sorted', 'dict', 'try', 'except', 'class', 'lambda', 'enumerate', 'with', 'yield', 'None', 'is', 'irq', 'Timer', 'OPEN_DRAIN', 'read_uv', 'Motor']) {
      expect(offered.has(name), name).toBe(false);
    }
    for (const name of Object.keys(REFUSED_BUILTINS)) expect(offered.has(name), name).toBe(false);
  });
  it('offers the §2.6 built-ins, the keywords, the modules and their members', () => {
    expect(labels(API_COMPLETIONS.builtins)).toEqual(Object.keys(BUILTINS));
    expect(labels(API_COMPLETIONS.keywords)).toEqual(expect.arrayContaining(['if', 'elif', 'else', 'while', 'for', 'def', 'return', 'global', 'import', 'from', 'True', 'False']));
    expect(labels(API_COMPLETIONS.modules)).toEqual(['machine', 'time', 'neopixel', 'dht', 'hcsr04', 'math', 'random', 'micropython', 'zero1']);
    expect(labels(API_COMPLETIONS.moduleMembers.time)).toEqual(expect.arrayContaining(['sleep', 'sleep_ms', 'ticks_ms', 'ticks_diff']));
    expect(labels(API_COMPLETIONS.moduleMembers.utime)).toContain('sleep_ms');
    expect(labels(API_COMPLETIONS.classMembers.Pin)).toEqual(['OUT', 'IN', 'PULL_UP', 'PULL_DOWN']);
    expect(labels(API_COMPLETIONS.partMembers.Pin)).toEqual(['on', 'off', 'value', 'toggle']);
    expect(API_COMPLETIONS.partMembers.ADC.find((c) => c.label === 'read')).toMatchObject({ type: 'method', detail: 'read()', info: '0-1023 on the ZERO1; on other boards use read_u16().' });
    expect(API_COMPLETIONS.moduleMembers.time.find((c) => c.label === 'sleep_ms')).toMatchObject({ type: 'function', detail: 'sleep_ms(ms)' });
    expect(API_COMPLETIONS.moduleMembers.zero1.find((c) => c.label === 'LED_RED')).toMatchObject({ type: 'constant', info: 'Pin A1: the red LED.' });
  });
  it('maps each class to its part for the scan of x = Pin(…) assignments', () => {
    expect(API_COMPLETIONS.constructors).toMatchObject({ Pin: 'Pin', ADC: 'ADC', PWM: 'PWM', SoftI2C: 'I2C', DHT22: 'DHT', DHT11: 'DHT', NeoPixel: 'NeoPixel', Servo: 'Servo', LCD: 'LCD', HCSR04: 'HCSR04' });
  });
});

describe('WHAT_WORKS (§2.15)', () => {
  it('is plain text in sections: the program shape, what works, the modules, what is missing, the numbers', () => {
    expect(WHAT_WORKS.title).toBe('What works in ZERO1 Python');
    expect(WHAT_WORKS.sections.map((s) => s.heading)).toEqual(['The shape of a program', 'The Python you can use', 'Modules', 'Not in ZERO1 Python yet', 'Numbers on the board']);
    const text = JSON.stringify(WHAT_WORKS);
    expect(text).not.toMatch(/<[a-z]/i);
    for (const s of ['while True:', 'the Code tab shows the Arduino sketch made from your Python', 'classes, dictionaries', 'slices', 'lambda', '0.3333333', '-1794967296', 'MemoryError']) {
      expect(text.toLowerCase(), s).toContain(s.toLowerCase());
    }
    for (const m of MODULE_NAMES) expect(text, m).toContain(m);
  });
  it('every table row has as many cells as its head', () => {
    for (const section of WHAT_WORKS.sections) {
      for (const block of section.blocks) {
        if (block.type === 'table') for (const row of block.rows) expect(row).toHaveLength(block.head.length);
      }
    }
  });
});
