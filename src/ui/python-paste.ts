/**
 * Paste clean-up for the Python editor (docs/PYTHON.md §7.4): code copied from a worksheet, a
 * web page or a chat carries curly quotes, non-breaking and zero-width spaces and tab indents
 * that Python refuses (or reads differently). A paste that contains any of them is inserted as
 * it was, then fixed in a second step with the toast "Fixed 3 curly quotes and 12 invisible
 * spaces (Ctrl+Z undoes it)": Ctrl+Z takes back the fix only (a curly quote inside a text may
 * have been meant), a second Ctrl+Z the paste.
 *
 * Python editor only; loaded with the Python chunk (src/ui/python-chunk.ts).
 */
import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, type ChangeSpec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** What the clean-up changed in a pasted text. */
export interface PasteFixes {
  /** `“ ” „ ‟` → `"` and `‘ ’ ‚ ‛` → `'`. */
  quotes: number;
  /** U+00A0, U+2007, U+202F → a space; U+200B, U+FEFF removed. */
  spaces: number;
  /** Tabs at the start of a line → 4 spaces each. */
  tabs: number;
}

const DOUBLE_QUOTES = /[“”„‟]/g;
const SINGLE_QUOTES = /[‘’‚‛]/g;
const WIDE_SPACES = /[   ]/g;
const ZERO_WIDTH = /[​﻿]/g;
const LEADING_TABS = /^\t+/gm;

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

/** The pasted text with curly quotes, invisible spaces and leading tabs replaced, and what was changed. */
export function cleanPastedText(text: string): { text: string; fixes: PasteFixes } {
  const fixes: PasteFixes = {
    quotes: count(text, DOUBLE_QUOTES) + count(text, SINGLE_QUOTES),
    spaces: count(text, WIDE_SPACES) + count(text, ZERO_WIDTH),
    tabs: 0,
  };
  let clean = text.replace(DOUBLE_QUOTES, '"').replace(SINGLE_QUOTES, "'").replace(WIDE_SPACES, ' ').replace(ZERO_WIDTH, '');
  clean = clean.replace(LEADING_TABS, (tabs) => {
    fixes.tabs += tabs.length;
    return '    '.repeat(tabs.length);
  });
  return { text: clean, fixes };
}

/** True when the clean-up changed something. */
export function anyFixes(fixes: PasteFixes): boolean {
  return fixes.quotes + fixes.spaces + fixes.tabs > 0;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Fixed 3 curly quotes and 12 invisible spaces (Ctrl+Z undoes it)"; only the kinds that were found are named. */
export function pasteToast(fixes: PasteFixes): string {
  const parts = [
    fixes.quotes ? plural(fixes.quotes, 'curly quote', 'curly quotes') : '',
    fixes.spaces ? plural(fixes.spaces, 'invisible space', 'invisible spaces') : '',
    fixes.tabs ? plural(fixes.tabs, 'tab', 'tabs') : '',
  ].filter((p) => p !== '');
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `Fixed ${list} (Ctrl+Z undoes it)`;
}

/**
 * Paste `text` into `view` as the student would, then clean it up as a separate undo step.
 * Returns what was fixed (nothing fixed: the paste is the only change).
 */
export function pasteIntoPython(view: EditorView, text: string): PasteFixes {
  const pasted = view.state.update(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
  view.dispatch(pasted);
  const { fixes } = cleanPastedText(text);
  if (!anyFixes(fixes)) return fixes;

  const doc = view.state.doc;
  const changes: ChangeSpec[] = [];
  let cursor = -1;
  pasted.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const clean = cleanPastedText(doc.sliceString(fromB, toB)).text;
    changes.push({ from: fromB, to: toB, insert: clean });
    cursor = fromB + clean.length; // single cursor: it ends after the cleaned text
  }, true);
  const single = view.state.selection.ranges.length === 1 && changes.length === 1;
  view.dispatch({
    changes,
    ...(single ? { selection: EditorSelection.cursor(cursor) } : {}),
    annotations: isolateHistory.of('before'),
    userEvent: 'input.paste',
    scrollIntoView: true,
  });
  return fixes;
}

/**
 * The Python editor's paste handler: plain-text pastes that need a clean-up go through
 * `pasteIntoPython()` and `onFixed` gets what was fixed (for the toast); anything else is left
 * to CodeMirror. A read-only editor (the review frame) never changes.
 */
export function pythonPasteCleanup(onFixed: (fixes: PasteFixes) => void): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (view.state.readOnly) return false;
      const text = event.clipboardData?.getData('text/plain');
      if (!text || !anyFixes(cleanPastedText(text).fixes)) return false;
      event.preventDefault();
      onFixed(pasteIntoPython(view, text));
      return true;
    },
  });
}
