/**
 * Python example programs (docs/PYTHON.md §9): the Python twins of the `.ino` examples, with the
 * same `id`, `title` and `group` and in the same relative order as EXAMPLES.
 *
 * Each `.py` file is imported as raw text. Loaded only with the Python chunk (never from
 * src/main.ts statically).
 *
 * Day-1 contract (§11.2): example 01 only; stream A adds the other 32.
 */

import blinkRed from './01_blink_red.py?raw';

/** One Python example as shown in the Examples menu in Python mode. */
export interface PythonExample {
  /** The `.ino` twin's id, e.g. `01_blink_red`. */
  id: string;
  /** The twin's menu title. */
  title: string;
  /** The twin's menu group (one of EXAMPLE_GROUPS). */
  group: string;
  /** One sentence: what the program does / teaches. */
  description: string;
  /** The Python program. No `source` field: the Examples menu dispatches on the mode, never on 'source' in x. */
  python: string;
}

/** Every Python example, in lesson order. */
export const PYTHON_EXAMPLES: PythonExample[] = [
  // --- Outputs -------------------------------------------------------------
  {
    id: '01_blink_red',
    title: 'Blink the red LED',
    group: 'Outputs',
    description: 'The first program: the red LED (A1) blinks once per second and print() shows ON / OFF.',
    python: blinkRed,
  },
];
