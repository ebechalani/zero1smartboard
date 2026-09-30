/**
 * Python mode's translator (docs/PYTHON.md §4): a MicroPython-style program becomes an Arduino
 * sketch that the simulator runs and the board receives. This file is the public surface:
 * nothing else under src/python is imported from outside it. The UI reaches it only through the
 * lazy Python chunk (§7.16).
 */
import type { Diagnostic } from '../types';
import type { MessageCode } from './messages';
import type { SourceMap } from './sourcemap';

export interface PythonDiagnostic extends Diagnostic {
  /** Stable id from messages.ts; tests assert on it. */
  code: MessageCode;
}

export interface PythonTranslation {
  /** No errors (warnings allowed): only then may the sketch be run, downloaded, handed in as a sketch or uploaded. */
  ok: boolean;
  /** The Arduino sketch; when !ok the placeholder of src/sketch/placeholder.ts. */
  sketch: string;
  map: SourceMap;
  /** Errors first, then warnings; each group sorted by position; at most 20 errors (+ X-too-many). */
  diagnostics: PythonDiagnostic[];
  /** No main loop (§2.1 rule 2): the app finishes the run after setup() (§7.8). */
  endsAfterSetup: boolean;
  /** The program calls input(): Run shows the Serial Monitor (§7.9). */
  usesInput: boolean;
}

export { pythonToArduino } from './translate';
export { BLANK_PYTHON } from './blank';
export { SourceMap } from './sourcemap';
export { API_COMPLETIONS, type ApiCompletion, type ApiCompletionTable } from './api';
export { WHAT_WORKS, type HelpBlock, type HelpPage, type HelpSection } from './help';
export { pythonizeRuntimeMessage, type MessageCode } from './messages';
export { PYTHON_EXAMPLES, type PythonExample } from '../examples/python';
