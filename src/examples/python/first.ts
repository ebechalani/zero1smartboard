/**
 * Example 01 on its own (docs/PYTHON.md §7.7, §7.16): the program Python mode opens on a first
 * visit. Kept apart from the other 32 examples (./index.ts, ./parts.ts) so that the Python chunk
 * can carry this one and leave the rest to a lazy chunk of their own.
 */
import type { PythonExample } from './index';
import blinkRed from './01_blink_red.py?raw';

/** 01_blink_red: the first program (T1), also the first entry of PYTHON_EXAMPLES. */
export const PYTHON_FIRST_EXAMPLE: PythonExample = {
  id: '01_blink_red',
  title: 'Blink the red LED',
  group: 'Outputs',
  description: 'The first program: the red LED (A1) blinks once per second and print() shows ON / OFF.',
  python: blinkRed,
};
