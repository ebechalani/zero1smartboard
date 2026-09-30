/**
 * The Python examples other than 01 (docs/PYTHON.md §7.16): a lazy chunk of their own, fetched by
 * modes/python-mode.ts together with the Python chunk (which carries example 01 only,
 * PYTHON_FIRST_EXAMPLE). Kept apart so the Python chunk stays within its budget
 * (scripts/check-bundle.mjs); nothing imports it statically.
 */
export { PYTHON_EXAMPLES, type PythonExample } from '../examples/python';
