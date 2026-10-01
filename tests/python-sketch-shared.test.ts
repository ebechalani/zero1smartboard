/**
 * The Blockly-free sketch code shared by the Blocks generator and the Python translator
 * (docs/PYTHON.md §4.2): src/sketch/pins.ts, order.ts, helpers.ts. Moving them out of
 * src/blocks/generator.ts is an extraction only: the sketch of every block example (and of the
 * default workspace) is byte for byte the one recorded before the move
 * (tests/fixtures/python/blocks-examples.golden.json). A deliberate change of the Blocks output
 * regenerates the file with UPDATE_GOLDEN=1 (like the Python goldens, docs/PYTHON.md §10.2).
 */
import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { BLOCK_EXAMPLES, DEFAULT_WORKSPACE, Order as BlocksOrder, registerZero1Blocks, workspaceToArduino } from '../src/blocks';
import { HELPERS } from '../src/blocks/generator';
import { SEGMENT_HELPERS } from '../src/sketch/helpers';
import { Order } from '../src/sketch/order';
import { PINS } from '../src/sketch/pins';

const GOLDEN_FILE = new URL('./fixtures/python/blocks-examples.golden.json', import.meta.url);

function generate(json: object): string {
  registerZero1Blocks();
  const ws = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(json, ws);
    return workspaceToArduino(ws);
  } finally {
    ws.dispose();
  }
}

if (process.env.UPDATE_GOLDEN) {
  const sketches: Record<string, string> = { default_workspace: generate(DEFAULT_WORKSPACE) };
  for (const example of BLOCK_EXAMPLES) sketches[example.id] = generate(example.workspace);
  writeFileSync(GOLDEN_FILE, JSON.stringify(sketches, null, 2) + '\n');
}
const GOLDEN: Record<string, string> = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));

describe('Blocks output is unchanged by the extraction', () => {
  it('the golden file covers the default workspace and every block example', () => {
    expect(Object.keys(GOLDEN)).toEqual(['default_workspace', ...BLOCK_EXAMPLES.map((e) => e.id)]);
  });
  it('the default workspace', () => {
    expect(generate(DEFAULT_WORKSPACE)).toBe(GOLDEN.default_workspace);
  });
  it.each(BLOCK_EXAMPLES.map((e) => [e.id, e] as const))('%s', (id, example) => {
    expect(generate(example.workspace)).toBe(GOLDEN[id]);
  });
  it('the goldens use the shared pin constants and 7-segment helpers', () => {
    const all = Object.values(GOLDEN).join('\n');
    expect(all).toContain(SEGMENT_HELPERS.showSegments);
    expect(all).toContain(SEGMENT_HELPERS.showDigit);
    expect(all).toContain('const int LED_RED = A1;  // red LED');
  });
});

describe('src/sketch', () => {
  it('the Blocks generator uses the shared tables', () => {
    expect(BlocksOrder).toBe(Order);
    expect(HELPERS.showSegments).toBe(SEGMENT_HELPERS.showSegments);
    expect(HELPERS.showDigit).toBe(SEGMENT_HELPERS.showDigit);
    expect(PINS.map((p) => p.name)).toEqual([
      'LED_RED', 'LED_GREEN', 'LED_BUILTIN', 'BUTTON_1', 'BUTTON_2', 'POT_LDR', 'MOTOR', 'SERVO_PIN', 'BUZZER', 'DHT_PIN', 'TRIG_PIN', 'ECHO_PIN', 'RGB_PIN', 'SEG_DATA', 'SEG_LATCH', 'SEG_CLOCK',
    ]);
  });
  it('neither src/sketch nor src/python imports Blockly or src/blocks', () => {
    for (const dir of ['sketch', 'python']) {
      const folder = new URL(`../src/${dir}/`, import.meta.url);
      for (const file of readdirSync(folder).filter((f) => f.endsWith('.ts'))) {
        const text = readFileSync(new URL(file, folder), 'utf8');
        const imports = [...text.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
        for (const spec of imports) expect(spec, `src/${dir}/${file}`).not.toMatch(/blockly|\/blocks(\/|$)/);
      }
    }
  });
});
