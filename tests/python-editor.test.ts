// @vitest-environment happy-dom
/**
 * The Python editor (docs/PYTHON.md §7.4, §10.7): ZERO1 Python's completions (never a name the
 * translator refuses; `Pin.OUT` after `Pin.`, `sleep_ms` after `time.`, a part's methods after
 * `x.` for `x = ADC(…)`, the snippets), the paste clean-up (curly quotes, invisible spaces,
 * leading tabs; the toast text; Ctrl+Z takes back the clean-up only), visible non-breaking
 * spaces, and Esc then Tab leaving both kinds of editor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionContext, type Completion, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { API_COMPLETIONS, WHAT_WORKS } from '../src/python';
import { API_MODULES, API_PARTS, REFUSED_BUILTINS } from '../src/python/api';
import { createEditor, type Editor } from '../src/ui/editor';
import { pythonLanguageSupport, showNonBreakingSpaces, zero1Completions } from '../src/ui/python-language';
import { cleanPastedText, pasteIntoPython, pasteToast, pythonPasteCleanup, type PasteFixes } from '../src/ui/python-paste';
import { createPythonHelpDialog } from '../src/ui/python-help-dialog';

let editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/** A Python editor state with the cursor at `|` in `doc`. */
function stateAt(doc: string): { state: EditorState; pos: number } {
  const pos = doc.indexOf('|');
  expect(pos, 'the document marks the cursor with |').toBeGreaterThanOrEqual(0);
  return { state: EditorState.create({ doc: doc.replace('|', ''), extensions: [pythonLanguageSupport(API_COMPLETIONS)] }), pos };
}

/** What every completion source of the language offers at `|` (explicit: as after Ctrl+Space). */
async function offered(doc: string, explicit = true): Promise<Completion[]> {
  const { state, pos } = stateAt(doc);
  const sources = state.languageDataAt<CompletionSource>('autocomplete', pos);
  expect(sources.length).toBe(2); // zero1Completions + localCompletionSource, nothing of CPython's
  const results = await Promise.all(sources.map((source) => source(new CompletionContext(state, pos, explicit))));
  return results.filter((r): r is CompletionResult => r !== null).flatMap((r) => [...r.options]);
}

/** What zero1Completions alone offers at `|`. */
function zero1(doc: string, explicit = false): CompletionResult | null {
  const { state, pos } = stateAt(doc);
  return zero1Completions(API_COMPLETIONS)(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
}

const labels = (options: readonly Completion[]) => options.map((o) => o.label);

/** Names ZERO1 Python refuses anywhere: CPython keywords and built-ins it does not have. */
const REFUSED_WORDS = new Set([
  'try', 'except', 'finally', 'class', 'lambda', 'with', 'yield', 'nonlocal', 'del', 'async', 'await', 'match', 'case', 'is', 'None',
  ...Object.keys(REFUSED_BUILTINS),
]);

/** The members of a module or part that ZERO1 Python refuses (NA-api): `Pin.irq`, `machine.Timer`, … */
function refusedMembers(owner: { members?: object; methods?: object; statics?: object }): Set<string> {
  const all = [owner.members, owner.methods, owner.statics].flatMap((m) => (m ? Object.values(m) : [])) as { kind: string; name: string }[];
  return new Set(all.filter((m) => m.kind === 'refused').map((m) => m.name));
}

const PROGRAM = [
  'from machine import Pin, ADC',
  'from zero1 import *',
  'import time',
  'import dht',
  '',
  'led = Pin(LED_RED, Pin.OUT)',
  'pot = ADC(POT_LDR)',
  'sensor = dht.DHT22(Pin(DHT_PIN))',
  '',
  'def blink(n):',
  '    for i in range(n):',
  '        led.on()',
  '',
].join('\n');

describe('ZERO1 completions (§7.4)', () => {
  it('never offers a name ZERO1 Python refuses, wherever the cursor is', async () => {
    for (const name of ['sorted', 'dict', 'try', 'class', 'lambda', 'enumerate']) expect(REFUSED_WORDS.has(name), name).toBe(true);
    const none = new Set<string>();
    const places: [string, Set<string>][] = [
      [`${PROGRAM}|`, none],
      [`${PROGRAM}x = s|`, none],
      [`${PROGRAM}e|`, none],
      [`${PROGRAM}t|`, none],
      [`${PROGRAM}c|`, none],
      [`${PROGRAM}l|`, none],
      ['import |', none],
      ['from |', none],
      ['from machine import |', refusedMembers(API_MODULES.machine)],
      ['from time import s|', refusedMembers(API_MODULES.time)],
      [`${PROGRAM}time.|`, refusedMembers(API_MODULES.time)],
      [`${PROGRAM}Pin.|`, refusedMembers(API_PARTS.Pin)],
      [`${PROGRAM}led.|`, refusedMembers(API_PARTS.Pin)],
      [`${PROGRAM}pot.|`, refusedMembers(API_PARTS.ADC)],
      [`${PROGRAM}sensor.|`, refusedMembers(API_PARTS.DHT)],
      ['import math\nmath.|', refusedMembers(API_MODULES.math)],
      ['import random\nrandom.|', refusedMembers(API_MODULES.random)],
      ['import machine\nmachine.|', refusedMembers(API_MODULES.machine)],
    ];
    expect(refusedMembers(API_PARTS.Pin).has('irq')).toBe(true);
    expect(refusedMembers(API_MODULES.machine).has('Timer')).toBe(true);
    for (const [place, members] of places) {
      const found = labels(await offered(place)).filter((label) => REFUSED_WORDS.has(label) || members.has(label));
      expect(found, place).toEqual([]);
    }
  });

  it('offers Pin.OUT after Pin., sleep_ms after time. and a part’s methods after x. for x = ADC(…)', () => {
    const pin = zero1(`${PROGRAM}Pin.|`)!;
    expect(labels(pin.options)).toEqual(expect.arrayContaining(['OUT', 'IN', 'PULL_UP']));
    expect(labels(zero1(`${PROGRAM}Pin.O|`)!.options)).toContain('OUT');
    expect(zero1(`${PROGRAM}Pin.O|`)!.from).toBe(`${PROGRAM}Pin.`.length);

    const time = zero1(`${PROGRAM}time.|`)!;
    expect(labels(time.options)).toEqual(expect.arrayContaining(['sleep', 'sleep_ms', 'ticks_ms', 'ticks_diff']));
    expect(time.options.find((o) => o.label === 'sleep_ms')!.info).toBeTruthy();
    expect(labels(zero1('import utime as t\nt.|')!.options)).toContain('sleep_ms');

    const led = labels(zero1(`${PROGRAM}led.|`)!.options);
    expect(led).toEqual(expect.arrayContaining(['on', 'off', 'value', 'toggle']));
    expect(led).not.toContain('irq');

    const pot = zero1(`${PROGRAM}pot.|`)!.options;
    expect(labels(pot)).toEqual(expect.arrayContaining(['read', 'read_u16']));
    expect(pot.find((o) => o.label === 'read')!.info).toContain('0-1023 on the ZERO1; on other boards use read_u16()');
    expect(labels(zero1(`${PROGRAM}sensor.|`)!.options)).toEqual(expect.arrayContaining(['measure', 'temperature', 'humidity']));
    expect(zero1(`${PROGRAM}unknown.|`)).toBeNull();
  });

  it('offers the modules after import / from, and a module’s names after from m import', () => {
    const modules = labels(zero1('import |', true)!.options);
    expect(modules).toEqual(expect.arrayContaining(['machine', 'time', 'neopixel', 'dht', 'hcsr04', 'math', 'random', 'micropython', 'zero1']));
    expect(modules).not.toContain('os');
    expect(labels(zero1('from ma|')!.options)).toContain('machine');
    expect(labels(zero1('import time, ma|')!.options)).toContain('machine');
    const machine = labels(zero1('from machine import Pin, |', true)!.options);
    expect(machine).toEqual(expect.arrayContaining(['Pin', 'ADC', 'PWM', 'I2C']));
    expect(machine).not.toContain('Timer');
    expect(labels(zero1('from zero1 import L|')!.options)).toEqual(expect.arrayContaining(['LED_RED', 'LED_GREEN', 'LCD']));
  });

  it('never offers the half-typed word itself (Enter would take it and swallow the new line)', async () => {
    // localCompletionSource counts `Pi` in `from machine import Pi` as a name the program defines.
    const pin = labels(await offered('from machine import Pi|'));
    expect(pin).toContain('Pin');
    expect(pin).not.toContain('Pi');
    expect(labels(await offered('import ti|'))).not.toContain('ti');
    expect(labels(await offered('from zero1 import LED_R|'))).not.toContain('LED_R');
    // the program's own names are still offered elsewhere, but not the word being typed
    const own = labels(await offered('counter = 0\ntotal = 1\ncou|'));
    expect(own).toContain('counter');
    expect(own).not.toContain('cou');
  });

  it('offers the built-ins, keywords, snippets and the names of from m import *, and nothing inside text or comments', () => {
    const all = labels(zero1(`${PROGRAM}pr|`)!.options);
    expect(all).toEqual(expect.arrayContaining(['print', 'input', 'range', 'while', 'def', 'True', 'while True:', 'for i in range():', 'def', 'if … else']));
    expect(all).toEqual(expect.arrayContaining(['LED_RED', 'BUTTON_1', 'Servo'])); // from zero1 import *
    expect(labels(zero1('pr|')!.options)).not.toContain('LED_RED'); // no star import: no zero1 names
    expect(zero1(`${PROGRAM}|`)).toBeNull(); // nothing typed, not asked for
    expect(zero1(`${PROGRAM}|`, true)).not.toBeNull(); // Ctrl+Space
    expect(zero1(`${PROGRAM}print("pr|")`)).toBeNull();
    expect(zero1(`${PROGRAM}# pr|`)).toBeNull();
    expect(zero1(`${PROGRAM}x = 12|`)).toBeNull();
  });

  it('the while True: snippet indents its body by 4 spaces', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const editor = createEditor(parent, {
      initialCode: '',
      ariaLabel: 'Python program',
      language: pythonLanguageSupport(API_COMPLETIONS),
      indent: 4,
      persist: false,
      onRun: () => undefined,
      onStop: () => undefined,
    });
    editors.push(editor);
    const view = EditorView.findFromDOM(parent.querySelector('.cm-editor')!)!;
    const snippet = zero1('wh|')!.options.find((o) => o.label === 'while True:')!;
    (snippet.apply as (view: EditorView, completion: Completion, from: number, to: number) => void)(view, snippet, 0, 0);
    expect(view.state.doc.toString()).toBe('while True:\n    ');
  });
});

// ---------------------------------------------------------------------------
// Paste clean-up
// ---------------------------------------------------------------------------

/** A Python editor with the clean-up; `fixes` records every toast-worthy paste. */
function pythonEditor(doc = ''): { view: EditorView; fixes: PasteFixes[] } {
  const parent = document.body.appendChild(document.createElement('div'));
  const fixes: PasteFixes[] = [];
  const editor = createEditor(parent, {
    initialCode: doc,
    ariaLabel: 'Python program',
    language: pythonLanguageSupport(API_COMPLETIONS),
    indent: 4,
    persist: false,
    onRun: () => undefined,
    onStop: () => undefined,
    extraExtensions: [showNonBreakingSpaces, pythonPasteCleanup((f) => fixes.push(f))],
  });
  editors.push(editor);
  return { view: EditorView.findFromDOM(parent.querySelector('.cm-editor')!)!, fixes };
}

function paste(view: EditorView, text: string): ClipboardEvent {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  return event;
}

const WORKSHEET = 'print(“Hello”)\n\tif x > 1:\n\t\tprint(‘big’)​\n';
const CLEAN = 'print("Hello")\n    if x > 1:\n        print(\'big\')\n';

describe('paste clean-up (§7.4)', () => {
  it('replaces curly quotes, invisible spaces and leading tabs, and counts them', () => {
    expect(cleanPastedText(WORKSHEET)).toEqual({ text: CLEAN, fixes: { quotes: 4, spaces: 2, tabs: 3 } });
    expect(cleanPastedText('„‟‚‛   ﻿').text).toBe(`""'' ${'  '}`);
    expect(cleanPastedText('a\tb = 1').text).toBe('a\tb = 1'); // a tab inside a line stays
    expect(cleanPastedText('x = 1\n').fixes).toEqual({ quotes: 0, spaces: 0, tabs: 0 });
  });

  it('says what it fixed in the toast', () => {
    expect(pasteToast({ quotes: 3, spaces: 12, tabs: 0 })).toBe('Fixed 3 curly quotes and 12 invisible spaces (Ctrl+Z undoes it)');
    expect(pasteToast({ quotes: 1, spaces: 0, tabs: 0 })).toBe('Fixed 1 curly quote (Ctrl+Z undoes it)');
    expect(pasteToast({ quotes: 0, spaces: 1, tabs: 2 })).toBe('Fixed 1 invisible space and 2 tabs (Ctrl+Z undoes it)');
    expect(pasteToast({ quotes: 2, spaces: 1, tabs: 1 })).toBe('Fixed 2 curly quotes, 1 invisible space and 1 tab (Ctrl+Z undoes it)');
  });

  it('a paste from a worksheet arrives clean; Ctrl+Z takes back the clean-up, a second Ctrl+Z the paste', () => {
    const { view, fixes } = pythonEditor('x = 2\n');
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    const event = paste(view, WORKSHEET);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(`x = 2\n${CLEAN}`);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(fixes).toEqual([{ quotes: 4, spaces: 2, tabs: 3 }]);
    undo(view);
    expect(view.state.doc.toString()).toBe(`x = 2\n${WORKSHEET}`);
    undo(view);
    expect(view.state.doc.toString()).toBe('x = 2\n');
  });

  it('leaves a clean paste to CodeMirror (no toast) and replaces the selection', () => {
    const { view, fixes } = pythonEditor('led.on()\n');
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(pasteIntoPython(view, 'lamp')).toEqual({ quotes: 0, spaces: 0, tabs: 0 });
    expect(view.state.doc.toString()).toBe('lamp.on()\n');
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    paste(view, 'x = 1'); // CodeMirror's own paste
    expect(view.state.doc.toString()).toBe('lamp.on()\nx = 1');
    expect(fixes).toEqual([]);
  });

  it('shows a pasted non-breaking space', () => {
    const { view } = pythonEditor('x = 1\n');
    expect(view.contentDOM.querySelector('.cm-specialChar')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

describe('Esc then Tab (§7.4, WCAG 2.1.2)', () => {
  const press = (target: EditorView, key: string, keyCode: number): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit);
    target.contentDOM.dispatchEvent(event);
    return event;
  };

  it('leaves the Arduino and the Python editor: Esc stops, the next Tab moves the focus on', () => {
    for (const python of [false, true]) {
      const parent = document.body.appendChild(document.createElement('div'));
      const onStop = vi.fn();
      editors.push(
        createEditor(parent, {
          initialCode: 'x',
          ariaLabel: python ? 'Python program' : 'Arduino sketch',
          ...(python ? { language: pythonLanguageSupport(API_COMPLETIONS), indent: 4 as const } : {}),
          persist: false,
          onRun: () => undefined,
          onStop,
        }),
      );
      const view = EditorView.findFromDOM(parent.querySelector('.cm-editor')!)!;
      expect(press(view, 'Tab', 9).defaultPrevented).toBe(true); // Tab indents
      expect(press(view, 'Escape', 27).defaultPrevented).toBe(true);
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(press(view, 'Tab', 9).defaultPrevented).toBe(false); // right after Esc the browser moves the focus
    }
  });
});

// ---------------------------------------------------------------------------
// "What works" (§7.3)
// ---------------------------------------------------------------------------

describe('the What works dialog (§7.3)', () => {
  it('lays out every section of the translator’s text: paragraphs, code, lists and tables', () => {
    const dialog = createPythonHelpDialog(document.body, WHAT_WORKS);
    dialog.open();
    const el = dialog.element;
    expect(el.open).toBe(true);
    expect(el.getAttribute('aria-labelledby')).toBe('z1-python-help-title');
    expect(el.querySelector('h2')!.textContent).toBe('What works in ZERO1 Python');
    expect(Array.from(el.querySelectorAll('h3'), (h) => h.textContent)).toEqual(WHAT_WORKS.sections.map((s) => s.heading));
    const blocks = WHAT_WORKS.sections.flatMap((s) => s.blocks);
    expect(el.querySelectorAll('.z1-help-code')).toHaveLength(blocks.filter((b) => b.type === 'code').length);
    expect(el.querySelectorAll('.z1-help-list')).toHaveLength(blocks.filter((b) => b.type === 'list').length);
    expect(el.querySelectorAll('.z1-help-table table')).toHaveLength(blocks.filter((b) => b.type === 'table').length);
    const code = blocks.find((b) => b.type === 'code');
    if (code?.type === 'code') expect(el.querySelector('.z1-help-code code')!.textContent).toBe(code.code);
    for (const block of blocks) if (block.type === 'text') expect(el.textContent).toContain(block.text);
    const table = blocks.find((b) => b.type === 'table');
    if (table?.type === 'table') {
      const first = el.querySelector('.z1-help-table table')!;
      expect(Array.from(first.querySelectorAll('thead th'), (th) => th.textContent)).toEqual(table.head);
      expect(first.querySelectorAll('tbody tr')).toHaveLength(table.rows.length);
    }
    expect(el.innerHTML).not.toContain('<script');
    expect(document.activeElement).toBe(el.querySelector('.z1-help-body'));
    el.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    expect(el.open).toBe(false);
  });
});
