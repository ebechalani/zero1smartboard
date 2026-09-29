/**
 * Code editor panel: CodeMirror 6 with transpiler diagnostics, Ctrl/Cmd+Enter
 * to run, Esc to stop (then Tab leaves the editor), and persistence of the
 * text to localStorage. Arduino C++ by default; the Python editor passes its
 * language, storage key and indent (docs/PYTHON.md §7.4). The `#code=`
 * share-link encoding is re-exported from src/share-link.ts.
 *
 * The editor can be switched to read-only; `setCode()` keeps working in that
 * state so the app can update the document programmatically. A
 * `readOnlyMirror` editor (the Code tab in Blocks and Python mode, §7.5) is
 * read-only for good, still focusable and selectable, and never saves.
 */
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { indentWithTab } from '@codemirror/commands';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Diagnostic } from '../types';

/** localStorage key under which the current sketch is saved. */
export const CODE_STORAGE_KEY = 'z1.code';

/** Delay before an edit is written to localStorage. */
const SAVE_DEBOUNCE_MS = 400;

/** After Esc, how long Tab / Shift+Tab move the focus out of the editor instead of indenting (WCAG 2.1.2). */
const TAB_ESCAPE_MS = 2000;

export interface EditorOptions {
  /** Text shown when the editor is created. */
  initialCode: string;
  /** Ctrl/Cmd+Enter inside the editor. */
  onRun(): void;
  /** Esc inside the editor. */
  onStop(): void;
  /** Called (not debounced) after every document change. */
  onChange?(code: string): void;
  /** Save the text to localStorage (default true; false in the sandboxed review frame, which has no storage). */
  persist?: boolean;
  /** The language support (default Arduino C++, `cpp()`). */
  language?: Extension;
  /** localStorage key of the text (default `z1.code`). */
  storageKey?: string;
  /** Spaces per indent level, also the tab size (default 2). */
  indent?: 2 | 4;
  /** `aria-label` of the editable area, e.g. "Arduino sketch". */
  ariaLabel: string;
  /**
   * Read-only for good but focusable, selectable and copyable (no `EditorView.editable.of(false)`);
   * saves nothing (`persist` is ignored, `flush()` does nothing).
   */
  readOnlyMirror?: boolean;
  /** A read-only mirror: the student tried to type, paste or drop into it. */
  onReadOnlyInput?(): void;
  /** Further extensions (after the defaults). */
  extraExtensions?: Extension[];
}

export interface Editor {
  getCode(): string;
  /** Replace the whole document (also persists it). Works in read-only mode too. */
  setCode(code: string): void;
  /** Show transpiler errors/warnings as squiggles and gutter markers. */
  setDiagnostics(diagnostics: readonly Diagnostic[]): void;
  /** Move the cursor to a 1-based line (and optional column) and scroll it into view. */
  goToLine(line: number, column?: number): void;
  /** Forbid (or allow again) typing; the text stays selectable and copyable. */
  setReadOnly(readOnly: boolean): void;
  isReadOnly(): boolean;
  /** Change the `aria-label` of the editable area. */
  setLabel(ariaLabel: string): void;
  focus(): void;
  /** Write a pending autosave now (before a reload prompt). */
  flush(): void;
  destroy(): void;
}

/**
 * Light editor chrome matching the app palette (src/ui/style.css): white
 * page, lavender gutter, purple caret/selection. Selectors mirror the ones of
 * CodeMirror's base theme so that these rules win over its light defaults.
 */
const lightTheme = EditorView.theme({
  '&': { backgroundColor: '#ffffff', color: '#1e1633', height: '100%' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace' },
  '.cm-content': { caretColor: '#5b21b6' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid #5b21b6', marginLeft: '-1px' },
  '.cm-gutters': { backgroundColor: '#f7f5fc', color: '#6b6385', borderRight: '1px solid #e2dcee' },
  '.cm-activeLineGutter': { backgroundColor: '#ebe5fb', color: '#1e1633' },
  // Translucent, or it would hide the selection drawn underneath the text.
  '.cm-activeLine': { backgroundColor: '#7c3aed0d' },
  '.cm-selectionBackground': { backgroundColor: '#e4def3' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#d6c8fb',
  },
  '.cm-selectionMatch': { backgroundColor: '#fbefc0' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: '#e6dcfe', outline: '1px solid #8b5cf6' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#fde0e2', outline: '1px solid #e0707e' },
  '.cm-foldPlaceholder': { backgroundColor: '#ede8fd', border: '1px solid #d6cdf3', color: '#5b21b6' },
  '.cm-panels': { backgroundColor: '#f7f5fc', color: '#1e1633' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid #e2dcee' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid #e2dcee' },
  '.cm-tooltip': {
    backgroundColor: '#ffffff',
    border: '1px solid #e2dcee',
    borderRadius: '6px',
    boxShadow: '0 8px 24px rgba(46, 26, 92, 0.14)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#7c3aed', color: '#ffffff' },
});

/**
 * Syntax colours for Arduino C++ on the white editor (every colour is at least
 * 4.5:1 on the background and on the active line). Replaces basicSetup's
 * fallback style, whose brown comments look dated and which leaves function
 * calls such as pinMode() uncoloured.
 */
const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.modifier, t.operatorKeyword, t.self], color: '#7c3aed' },
  { tag: [t.typeName, t.namespace, t.className], color: '#0e7490' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#1d4ed8' },
  { tag: t.function(t.definition(t.variableName)), color: '#1d4ed8', fontWeight: '600' },
  { tag: [t.special(t.name), t.macroName, t.bool, t.null, t.atom], color: '#be185d' },
  { tag: [t.number, t.escape], color: '#a55200' },
  { tag: [t.string, t.character, t.special(t.string)], color: '#047857' },
  { tag: t.processingInstruction, color: '#a21caf' },
  { tag: [t.comment, t.meta], color: '#6b6385' },
  { tag: t.invalid, color: '#c0262d' },
]);

/**
 * Mount a CodeMirror editor into `container`.
 */
export function createEditor(container: HTMLElement, options: EditorOptions): Editor {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const readOnlyCompartment = new Compartment();
  const labelCompartment = new Compartment();
  const mirror = options.readOnlyMirror === true;
  const persist = !mirror && options.persist !== false;
  const storageKey = options.storageKey ?? CODE_STORAGE_KEY;
  const indent = options.indent ?? 2;

  const flushSave = (): void => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (persist) saveText(storageKey, view.state.doc.toString());
  };

  const scheduleSave = (): void => {
    if (!persist) return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };

  // Run must win over the default "insert blank line" binding of Mod-Enter.
  const runShortcut = Prec.highest(
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          options.onRun();
          return true;
        },
      },
      indentWithTab,
    ]),
  );
  // Stop is bound at normal precedence, after basicSetup, so that Escape
  // first closes an open autocomplete or search panel (as students expect).
  // It also arms CodeMirror's tab-focus mode: Esc then Tab leaves the editor
  // (the key binding returns true, so CodeMirror's own Esc handling never runs).
  const stopShortcut = keymap.of([
    {
      key: 'Escape',
      run: (target) => {
        options.onStop();
        target.setTabFocusMode(TAB_ESCAPE_MS);
        return true;
      },
    },
  ]);

  const labelled = (label: string): Extension => EditorView.contentAttributes.of({ 'aria-label': label });

  const mirrorExtensions: Extension[] = mirror
    ? [
        EditorState.readOnly.of(true),
        // Typing into the read-only sketch explains where to change it (docs/PYTHON.md §7.5).
        EditorView.domEventHandlers({
          keydown(event) {
            const typing = event.key.length === 1 || event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete';
            if (typing && !event.ctrlKey && !event.metaKey && !event.altKey) options.onReadOnlyInput?.();
            return false;
          },
          paste() {
            options.onReadOnlyInput?.();
            return false;
          },
          drop() {
            options.onReadOnlyInput?.();
            return false;
          },
        }),
      ]
    : [];

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: options.initialCode,
      extensions: [
        runShortcut,
        basicSetup,
        stopShortcut,
        options.language ?? cpp(),
        lightTheme,
        syntaxHighlighting(lightHighlight),
        lintGutter(),
        indentUnit.of(' '.repeat(indent)),
        EditorState.tabSize.of(indent),
        labelCompartment.of(labelled(options.ariaLabel)),
        readOnlyCompartment.of([]),
        mirrorExtensions,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          scheduleSave();
          options.onChange?.(update.state.doc.toString());
        }),
        options.extraExtensions ?? [],
      ],
    }),
  });

  // Make sure the latest edits survive a tab close or reload.
  const onPageHide = (): void => {
    if (saveTimer !== null) flushSave();
  };
  window.addEventListener('pagehide', onPageHide);

  return {
    getCode: () => view.state.doc.toString(),
    flush: flushSave,
    setCode(code) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
      flushSave();
    },
    setDiagnostics(diagnostics) {
      view.dispatch(setDiagnostics(view.state, diagnostics.map((d) => toCmDiagnostic(view.state, d))));
    },
    goToLine(line, column = 1) {
      const doc = view.state.doc;
      const target = doc.line(clamp(line, 1, doc.lines));
      const pos = Math.min(target.from + Math.max(0, column - 1), target.to);
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      });
      view.focus();
    },
    setReadOnly(readOnly) {
      if (mirror || view.state.readOnly === readOnly) return;
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(
          readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        ),
      });
    },
    isReadOnly: () => view.state.readOnly,
    setLabel(ariaLabel) {
      view.dispatch({ effects: labelCompartment.reconfigure(labelled(ariaLabel)) });
    },
    focus: () => view.focus(),
    destroy() {
      window.removeEventListener('pagehide', onPageHide);
      if (saveTimer !== null) clearTimeout(saveTimer);
      view.destroy();
    },
  };
}

/**
 * Convert a diagnostic (1-based line/column) into a CodeMirror range: up to
 * `endLine`/`endColumn` (exclusive) when the diagnostic has them, else the
 * identifier/token at the position, or the rest of the line.
 */
export function toCmDiagnostic(state: EditorState, d: Diagnostic): CmDiagnostic {
  const doc = state.doc;
  const line = doc.line(clamp(d.line, 1, doc.lines));
  const from = Math.min(line.from + Math.max(0, d.column - 1), line.to);
  const severity = d.severity;
  if (d.endLine !== undefined && d.endColumn !== undefined && d.endLine >= 1) {
    const end = doc.line(clamp(d.endLine, 1, doc.lines));
    const to = Math.min(end.from + Math.max(0, d.endColumn - 1), end.to);
    if (to > from) return { from, to, severity, message: d.message };
  }
  const rest = doc.sliceString(from, line.to);
  const token = /^[A-Za-z0-9_]+/.exec(rest);
  const to = token ? from + token[0].length : Math.max(from + 1, line.to);
  return { from, to: Math.min(to, doc.length), severity, message: d.message };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Read the sketch saved by a previous visit, or null when there is none. */
export function loadSavedCode(): string | null {
  return loadText(CODE_STORAGE_KEY);
}

/** Save the sketch for the next visit (silently ignores storage errors). */
export function saveCode(code: string): void {
  saveText(CODE_STORAGE_KEY, code);
}

/** The text saved under `key` by a previous visit, or null when there is none (or no storage). */
export function loadText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Save `text` under `key` for the next visit (silently ignores storage errors). */
export function saveText(key: string, text: string): void {
  try {
    localStorage.setItem(key, text);
  } catch {
    // Private mode or quota exceeded: the text simply is not remembered.
  }
}

// ---------------------------------------------------------------------------
// Share links (#code=<base64url>)
// ---------------------------------------------------------------------------

// The encoding lives in src/share-link.ts (docs/CLASSROOM.md §4.9); re-exported so that
// existing imports keep working.
export { codeFromHash, decodeShareCode, encodeShareCode } from '../share-link';
