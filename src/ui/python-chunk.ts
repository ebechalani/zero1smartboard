/**
 * The Python chunk (docs/PYTHON.md §7.16): everything Python mode needs at run time — the
 * translator, the New template, the examples, the runtime-message rewording, the message texts,
 * the "What works" content and dialog, and the editor's language support, completions and
 * paste clean-up. It is reached only through `import('./python-chunk')` in
 * modes/python-mode.ts, so neither src/python nor @codemirror/lang-python is in the initial
 * bundle (tests/bundle-boundary.test.ts, scripts/check-bundle.mjs). Code outside the chunk
 * imports types from it only.
 */
export { API_COMPLETIONS, BLANK_PYTHON, PYTHON_EXAMPLES, WHAT_WORKS, pythonToArduino, pythonizeRuntimeMessage } from '../python';
export type { PythonDiagnostic, PythonExample, PythonTranslation } from '../python';
// The §5 texts the app shows around the sketch (X-sketch-error, W-sketch); src/python/index.ts does not list message().
export { message } from '../python/messages';
export { pythonLanguageSupport, showNonBreakingSpaces } from './python-language';
export { pasteToast, pythonPasteCleanup } from './python-paste';
export { createPythonHelpDialog, type PythonHelpDialog } from './python-help-dialog';
