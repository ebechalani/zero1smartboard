/**
 * The Python chunk (docs/PYTHON.md §7.16): everything Python mode needs at run time — the
 * translator, the New template, the examples, the runtime-message rewording and the editor's
 * language support. It is reached only through `import('./python-chunk')` in
 * modes/python-mode.ts, so neither src/python nor @codemirror/lang-python is in the initial
 * bundle (tests/bundle-boundary.test.ts, scripts/check-bundle.mjs). Code outside the chunk
 * imports types from it only.
 */
export { BLANK_PYTHON, PYTHON_EXAMPLES, pythonToArduino, pythonizeRuntimeMessage } from '../python';
export type { PythonDiagnostic, PythonExample, PythonTranslation } from '../python';
export { pythonLanguageSupport } from './python-language';
