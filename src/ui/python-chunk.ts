/**
 * The Python chunk (docs/PYTHON.md §7.16): everything Python mode needs at run time — the
 * translator, the New template, example 01 (the other examples are python-examples-chunk.ts,
 * fetched at the same time), the runtime-message rewording, the message texts,
 * the "What works" content and dialog, and the editor's language support, completions and
 * paste clean-up. It is reached only through `import('./python-chunk')` in
 * modes/python-mode.ts, so neither src/python nor @codemirror/lang-python is in the initial
 * bundle (tests/bundle-boundary.test.ts, scripts/check-bundle.mjs). Code outside the chunk
 * imports types from it only.
 */
// message(): the §5 texts the app shows around the sketch (X-sketch-error, W-sketch).
export { API_COMPLETIONS, BLANK_PYTHON, PYTHON_FIRST_EXAMPLE, WHAT_WORKS, message, pythonToArduino, pythonizeRuntimeMessage } from '../python';
export type { PythonDiagnostic, PythonExample, PythonTranslation } from '../python';
export { pythonLanguageSupport, showNonBreakingSpaces } from './python-language';
export { pasteToast, pythonPasteCleanup } from './python-paste';
export { createPythonHelpDialog, type PythonHelpDialog } from './python-help-dialog';
