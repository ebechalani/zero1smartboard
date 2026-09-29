/**
 * The Python editor's language support (docs/PYTHON.md §7.4): the Lezer Python grammar for
 * highlighting, indentation and folding, with completion of the names the program itself
 * defines. Not `python()` from @codemirror/lang-python: its completion list offers every CPython
 * built-in, exception name and `try`/`class` snippet, most of which ZERO1 Python refuses.
 *
 * Loaded only with the Python chunk (src/ui/python-chunk.ts). The ZERO1 completions (the §2.6
 * built-ins, the §3 modules and their members, from `API_COMPLETIONS`) join `localCompletionSource`
 * here once the translator exports them.
 */
import { LanguageSupport } from '@codemirror/language';
import { localCompletionSource, pythonLanguage } from '@codemirror/lang-python';

export function pythonLanguageSupport(): LanguageSupport {
  return new LanguageSupport(pythonLanguage, [pythonLanguage.data.of({ autocomplete: localCompletionSource })]);
}
