/**
 * The Python editor's language support (docs/PYTHON.md §7.4): the Lezer Python grammar for
 * highlighting, indentation and folding, with two completion sources: the names the program
 * itself defines (`localCompletionSource`) and `zero1Completions`, ZERO1 Python's own list. Not
 * `python()` from @codemirror/lang-python: its completion list offers every CPython built-in,
 * exception name and `try`/`class` snippet, most of which ZERO1 Python refuses.
 *
 * `zero1Completions` offers the §2.6 built-ins and the §2.3 keywords ZERO1 Python has, a few
 * snippets, the §3 modules after `import ` / `from `, a module's names after `from m import `
 * and `m.`, a class's names after `Pin.`, and a part's methods after `x.` when the program says
 * `x = Pin(…)` / `x = ADC(…)` / … (a light scan of the document), each with its one-line doc.
 * The items come from the translator's `API_COMPLETIONS` (src/python/api.ts), so a name the
 * translator refuses is never offered.
 *
 * Loaded only with the Python chunk (src/ui/python-chunk.ts).
 */
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { LanguageSupport, syntaxTree } from '@codemirror/language';
import { localCompletionSource, pythonLanguage } from '@codemirror/lang-python';
import type { Extension } from '@codemirror/state';
import { highlightSpecialChars } from '@codemirror/view';

/** One completion item as the translator's table has it (CodeMirror's `Completion` shape). */
export interface Zero1CompletionItem {
  label: string;
  type: string;
  /** The signature (`sleep_ms(ms)`) or where the name comes from. */
  detail: string;
  /** The one-line doc ('' = none). */
  info: string;
}

/** What the completion source offers; `API_COMPLETIONS` of src/python/api.ts has this shape. */
export interface Zero1CompletionTable {
  builtins: readonly Zero1CompletionItem[];
  keywords: readonly Zero1CompletionItem[];
  modules: readonly Zero1CompletionItem[];
  /** By module name: after `from m import ` and after `m.`. */
  moduleMembers: Readonly<Record<string, readonly Zero1CompletionItem[]>>;
  /** By class name: after `Pin.` (`Pin.OUT`, …). */
  classMembers: Readonly<Record<string, readonly Zero1CompletionItem[]>>;
  /** By part name: after `x.` where `x = Pin(…)`. */
  partMembers: Readonly<Record<string, readonly Zero1CompletionItem[]>>;
  /** Class name → part name (`DHT22` → `DHT`). */
  constructors: Readonly<Record<string, string>>;
}

/** The snippets of §7.4 (a tab after a newline is one indent unit: 4 spaces). */
const SNIPPETS: readonly Completion[] = [
  snippetCompletion('while True:\n\t${}', { label: 'while True:', type: 'keyword', detail: 'snippet', info: 'Repeat forever: the main loop of a board program.' }),
  snippetCompletion('for ${i} in range(${10}):\n\t${}', { label: 'for i in range():', type: 'keyword', detail: 'snippet', info: 'Repeat for i = 0, 1, 2, … up to (not including) the number.' }),
  snippetCompletion('def ${name}(${}):\n\t${pass}', { label: 'def', type: 'keyword', detail: 'snippet', info: 'Make a function.' }),
  snippetCompletion('if ${condition}:\n\t${pass}\nelse:\n\t${pass}', { label: 'if … else', type: 'keyword', detail: 'snippet', info: 'Do one thing or the other.' }),
];

const IDENTIFIER = /^[A-Za-z_]\w*$/;
/** Inside these nodes nothing is completed (text, comments). */
const NO_COMPLETION = new Set(['String', 'FormatString', 'Comment']);

/** What the document's imports and assignments say about its names (a light scan, no parse). */
interface DocumentNames {
  /** Name → module: `import time`, `import utime as t`, `import dht`. */
  modules: Map<string, string>;
  /** Modules imported with `from m import *`. */
  starModules: string[];
  /** Variable → part: `led = Pin(…)`, `sensor = dht.DHT22(…)`. */
  parts: Map<string, string>;
}

function scanDocument(text: string, table: Zero1CompletionTable): DocumentNames {
  const names: DocumentNames = { modules: new Map(), starModules: [], parts: new Map() };
  for (const m of text.matchAll(/^[ \t]*import[ \t]+([^\n#]+)/gm)) {
    for (const piece of m[1].split(',')) {
      const parts = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(piece);
      if (parts && table.moduleMembers[parts[1]]) names.modules.set(parts[2] ?? parts[1], parts[1]);
    }
  }
  for (const m of text.matchAll(/^[ \t]*from[ \t]+(\w+)[ \t]+import[ \t]+\*/gm)) {
    if (table.moduleMembers[m[1]]) names.starModules.push(m[1]);
  }
  for (const m of text.matchAll(/^[ \t]*(\w+)[ \t]*=[ \t]*(?:\w+[ \t]*\.[ \t]*)?(\w+)[ \t]*\(/gm)) {
    const part = own(table.constructors, m[2]);
    if (part) names.parts.set(m[1], part);
  }
  return names;
}

/** `record[key]` when `key` is its own property (never `constructor` & co. of Object.prototype). */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

const toCompletion = (item: Zero1CompletionItem): Completion => ({
  label: item.label,
  type: item.type,
  detail: item.detail,
  ...(item.info ? { info: item.info } : {}),
});

/**
 * The ZERO1 Python completion source over `table` (the translator's `API_COMPLETIONS`); see the
 * file comment for what it offers where.
 */
export function zero1Completions(table: Zero1CompletionTable): CompletionSource {
  const list = (items: readonly Zero1CompletionItem[] | undefined): Completion[] => (items ?? []).map(toCompletion);
  const general = [...list(table.builtins), ...list(table.keywords), ...SNIPPETS];

  return (context: CompletionContext): CompletionResult | null => {
    const node = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (NO_COMPLETION.has(node.name)) return null;
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const word = /\w*$/.exec(before)![0];
    const from = context.pos - word.length;
    const result = (options: Completion[]): CompletionResult | null =>
      options.length === 0 ? null : { from, options, validFor: /^\w*$/ };

    // from m import a, b|
    const fromImport = /^\s*from\s+(\w+)\s+import\s+(?:\(\s*)?(?:\w+(?:\s+as\s+\w+)?\s*,\s*)*\w*$/.exec(before);
    if (fromImport) return result(list(own(table.moduleMembers, fromImport[1])));
    // import a, b|   /   from m|
    if (/^\s*(?:import\s+(?:\w+(?:\s+as\s+\w+)?\s*,\s*)*|from\s+)\w*$/.test(before)) return result(list(table.modules));

    // x.name|
    const member = /([A-Za-z_]\w*)\s*\.\s*\w*$/.exec(before);
    if (member) {
      const owner = member[1];
      const names = scanDocument(context.state.doc.toString(), table);
      const part = names.parts.get(owner);
      if (part) return result(list(own(table.partMembers, part)));
      const statics = own(table.classMembers, owner);
      if (statics) return result(list(statics));
      const module = names.modules.get(owner) ?? (own(table.moduleMembers, owner) ? owner : undefined);
      return module ? result(list(own(table.moduleMembers, module))) : null;
    }

    // a name: the built-ins, keywords, snippets, and what `from m import *` brings in
    if (word === '' && !context.explicit) return null;
    if (word !== '' && !IDENTIFIER.test(word)) return null; // a number
    const star = scanDocument(context.state.doc.toString(), table).starModules.flatMap((m) => list(own(table.moduleMembers, m)));
    return result([...general, ...star]);
  };
}

/** Make pasted non-breaking spaces visible (the NBSP is not in CodeMirror's default special characters). */
export const showNonBreakingSpaces: Extension = highlightSpecialChars({ addSpecialChars: / /g });

/**
 * The program's own names (`localCompletionSource`) without the word being typed: in
 * `from machine import Pi` that half-typed name is a "definition" too, and offered first it would
 * take Enter (neither `Pin` nor a new line). Nothing in an import line: the ZERO1 list has them.
 */
const localNames: CompletionSource = (context) => {
  const line = context.state.doc.lineAt(context.pos);
  if (/^\s*(?:import|from)\s/.test(line.text.slice(0, context.pos - line.from))) return null;
  const result = localCompletionSource(context);
  if (!result) return result;
  const word = context.state.sliceDoc(result.from, context.pos);
  return { ...result, options: result.options.filter((o) => o.label !== word) };
};

/** The Python editor's language: Lezer Python, local names and ZERO1 Python's completions. */
export function pythonLanguageSupport(table?: Zero1CompletionTable): LanguageSupport {
  return new LanguageSupport(pythonLanguage, [
    ...(table ? [pythonLanguage.data.of({ autocomplete: zero1Completions(table) })] : []),
    pythonLanguage.data.of({ autocomplete: localNames }),
  ]);
}
