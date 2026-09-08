/**
 * Code editor panel: CodeMirror 6 configured for Arduino C++, with transpiler
 * diagnostics, Ctrl/Cmd+Enter to run, Esc to stop, and persistence of the
 * sketch to localStorage. Also hosts the `#code=` share-link encoding.
 *
 * The editor can be switched to read-only (Blocks mode shows the generated
 * sketch here); `setCode()` keeps working in that state so the app can update
 * the document programmatically.
 */
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';
import { indentUnit } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Diagnostic } from '../types';

/** localStorage key under which the current sketch is saved. */
export const CODE_STORAGE_KEY = 'z1.code';

/** Delay before an edit is written to localStorage. */
const SAVE_DEBOUNCE_MS = 400;

export interface EditorOptions {
  /** Sketch shown when the editor is created. */
  initialCode: string;
  /** Ctrl/Cmd+Enter inside the editor. */
  onRun(): void;
  /** Esc inside the editor. */
  onStop(): void;
  /** Called (not debounced) after every document change. */
  onChange?(code: string): void;
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
  focus(): void;
  destroy(): void;
}

/** Colours that blend the one-dark theme into the purple board palette. */
const purpleOverrides = EditorView.theme(
  {
    '&': { backgroundColor: '#1a1330', height: '100%' },
    '.cm-gutters': { backgroundColor: '#1a1330', borderRight: '1px solid #2f2350' },
    '.cm-activeLineGutter': { backgroundColor: '#2a1f4a' },
    '.cm-activeLine': { backgroundColor: '#2a1f4a66' },
    '.cm-scroller': { fontFamily: '"JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace' },
  },
  { dark: true },
);

/**
 * Mount a CodeMirror editor into `container`.
 */
export function createEditor(container: HTMLElement, options: EditorOptions): Editor {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const readOnlyCompartment = new Compartment();

  const flushSave = (): void => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveCode(view.state.doc.toString());
  };

  const scheduleSave = (): void => {
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
  const stopShortcut = keymap.of([
    {
      key: 'Escape',
      run: () => {
        options.onStop();
        return true;
      },
    },
  ]);

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: options.initialCode,
      extensions: [
        runShortcut,
        basicSetup,
        stopShortcut,
        cpp(),
        oneDark,
        purpleOverrides,
        lintGutter(),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        readOnlyCompartment.of([]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          scheduleSave();
          options.onChange?.(update.state.doc.toString());
        }),
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
      if (view.state.readOnly === readOnly) return;
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(
          readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        ),
      });
    },
    isReadOnly: () => view.state.readOnly,
    focus: () => view.focus(),
    destroy() {
      window.removeEventListener('pagehide', onPageHide);
      if (saveTimer !== null) clearTimeout(saveTimer);
      view.destroy();
    },
  };
}

/** Convert a transpiler diagnostic (1-based line/column) into a CodeMirror range. */
function toCmDiagnostic(state: EditorState, d: Diagnostic): CmDiagnostic {
  const doc = state.doc;
  const line = doc.line(clamp(d.line, 1, doc.lines));
  const from = Math.min(line.from + Math.max(0, d.column - 1), line.to);
  // Underline the identifier/token at the position, or the rest of the line.
  const rest = doc.sliceString(from, line.to);
  const token = /^[A-Za-z0-9_]+/.exec(rest);
  const to = token ? from + token[0].length : Math.max(from + 1, line.to);
  return { from, to: Math.min(to, doc.length), severity: d.severity, message: d.message };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Read the sketch saved by a previous visit, or null when there is none. */
export function loadSavedCode(): string | null {
  try {
    return localStorage.getItem(CODE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Save the sketch for the next visit (silently ignores storage errors). */
export function saveCode(code: string): void {
  try {
    localStorage.setItem(CODE_STORAGE_KEY, code);
  } catch {
    // Private mode or quota exceeded: the sketch simply is not remembered.
  }
}

// ---------------------------------------------------------------------------
// Share links (#code=<base64url>)
// ---------------------------------------------------------------------------

/** Encode a sketch as URL-safe base64 (UTF-8, no padding) for a `#code=` link. */
export function encodeShareCode(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a `#code=` payload; returns null when it is not valid base64url. */
export function decodeShareCode(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Extract the sketch from a URL hash such as `#code=...`, or null. */
export function codeFromHash(hash: string): string | null {
  const match = /^#code=([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? decodeShareCode(match[1]) : null;
}
