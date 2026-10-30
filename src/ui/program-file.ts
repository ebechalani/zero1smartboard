/**
 * Header "📂 Load": a program saved earlier as a file, back into the simulator. The file
 * decides the mode, as a share link does (`ModeLink`, docs/ARCHITECTURE.md §8):
 * - a blocks file (the JSON that Share ▾ → Download blocks saves) → Blocks mode;
 * - a `.py` file → Python mode;
 * - a sketch (`.ino`, `.txt`, `.cpp`, …) → Code mode.
 * Pure: no DOM, no file reading (the app reads the file and hands its text here).
 */
import { parseWorkspaceJson } from '../share-link';
import type { ModeLink } from './modes/types';

/** What the file chooser offers (every browser still lets the student pick "All files"). */
export const LOAD_ACCEPT = '.ino,.pde,.txt,.c,.cpp,.h,.py,.json';

/** A program is a few KB; anything bigger is not one (the limit also keeps a wrong pick harmless). */
export const MAX_PROGRAM_FILE_BYTES = 1_000_000;

/** The file extensions read as an Arduino sketch (Code mode). */
const SKETCH_EXTENSIONS: ReadonlySet<string> = new Set(['ino', 'pde', 'txt', 'c', 'cpp', 'h', 'hpp', 'cc']);

export const LOAD_HELP = 'Choose a .ino sketch, a .py program or a .json blocks file.';

/** Why a file cannot be loaded, in the student's words. */
export function loadProblem(name: string, problem: 'too_big' | 'unreadable' | 'binary' | 'empty' | 'not_blocks' | 'extension'): string {
  switch (problem) {
    case 'too_big':
      return `${name} is too big to be a program (more than 1 MB).`;
    case 'unreadable':
      return `${name} could not be read. Try again, or choose another file.`;
    case 'binary':
      return `${name} is not a text file. ${LOAD_HELP}`;
    case 'empty':
      return `${name} is empty.`;
    case 'not_blocks':
      return `${name} is not a ZERO1 blocks file. Share ▾ → Download blocks saves one.`;
    case 'extension':
      return `${name} is not a file the simulator can load. ${LOAD_HELP}`;
  }
}

/** A Blockly workspace as `Blockly.serialization.workspaces.save()` writes it (`{}` for an empty one). */
export function isWorkspaceJson(value: object): boolean {
  const keys = Object.keys(value);
  const known = new Set(['blocks', 'variables', 'procedures']);
  if (!keys.every((k) => known.has(k))) return false;
  const blocks = (value as { blocks?: unknown }).blocks;
  return blocks === undefined || (typeof blocks === 'object' && blocks !== null && !Array.isArray(blocks));
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * The program in `text` (the contents of the file `name`) as the link that opens it, or why it
 * cannot be loaded. The extension says what the file is; a JSON workspace is Blocks whatever
 * its name.
 */
export function fileToLink(name: string, text: string): ModeLink | { error: string } {
  if (/\0/.test(text)) return { error: loadProblem(name, 'binary') };
  if (text.trim() === '') return { error: loadProblem(name, 'empty') };
  const ext = extensionOf(name);
  const json = /^\s*\{/.test(text) ? parseWorkspaceJson(text) : null;
  if (json && isWorkspaceJson(json)) return { kind: 'blocks', workspace: json, source: name };
  if (ext === 'json') return { error: loadProblem(name, 'not_blocks') };
  if (ext === 'py') return { kind: 'python', python: text, source: name };
  if (ext === '' || SKETCH_EXTENSIONS.has(ext)) return { kind: 'code', code: text, source: name };
  return { error: loadProblem(name, 'extension') };
}
