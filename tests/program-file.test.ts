/**
 * Header "📂 Load" (src/ui/program-file.ts): what kind of program a file holds, from its name
 * and text, and the words for a file that cannot be loaded. The app side (the file chooser,
 * the question before replacing work, the mode switch) is in tests/app-header.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { LOAD_ACCEPT, LOAD_HELP, MAX_PROGRAM_FILE_BYTES, fileToLink, isWorkspaceJson, loadProblem } from '../src/ui/program-file';
import { blocksFileName } from '../src/ui/sketch-file';

const SKETCH = 'void setup() {\n}\n\nvoid loop() {\n}\n';
const WORKSPACE = { blocks: { languageVersion: 0, blocks: [{ type: 'z1_setup_hat', id: 's', x: 20, y: 20 }] }, variables: [] };

describe('fileToLink', () => {
  it('reads a sketch file into Code mode, whatever its sketch extension (or none)', () => {
    for (const name of ['blink.ino', 'blink.INO', 'blink.pde', 'notes.txt', 'main.cpp', 'main.c', 'pins.h', 'sketch']) {
      expect(fileToLink(name, SKETCH), name).toEqual({ kind: 'code', code: SKETCH, source: name });
    }
  });

  it('reads a .py file into Python mode', () => {
    const python = 'from zero1 import *\nprint("hi")\n';
    expect(fileToLink('game.py', python)).toEqual({ kind: 'python', python, source: 'game.py' });
    expect(fileToLink('GAME.PY', python)).toEqual({ kind: 'python', python, source: 'GAME.PY' });
  });

  it('reads a Blockly workspace into Blocks mode, by its content (also with another name), pretty-printed or not', () => {
    const text = JSON.stringify(WORKSPACE, null, 2) + '\n';
    expect(fileToLink('zero1_ali_1030_101500.blocks.json', text)).toEqual({ kind: 'blocks', workspace: WORKSPACE, source: 'zero1_ali_1030_101500.blocks.json' });
    expect(fileToLink('mine.txt', JSON.stringify(WORKSPACE))).toMatchObject({ kind: 'blocks', workspace: WORKSPACE });
    expect(fileToLink('empty.json', '{}')).toMatchObject({ kind: 'blocks', workspace: {} }); // an empty workspace, as Blockly saves it
  });

  it('refuses a .json file that is not a workspace, naming where one comes from', () => {
    expect(fileToLink('data.json', '{"a": 1}')).toEqual({ error: 'data.json is not a ZERO1 blocks file. Share ▾ → Download blocks saves one.' });
    expect(fileToLink('list.json', '[1, 2]')).toEqual({ error: 'list.json is not a ZERO1 blocks file. Share ▾ → Download blocks saves one.' });
    expect(fileToLink('broken.json', '{"blocks": ')).toEqual({ error: 'broken.json is not a ZERO1 blocks file. Share ▾ → Download blocks saves one.' });
  });

  it('a sketch that happens to start with "{" is still a sketch', () => {
    expect(fileToLink('odd.ino', '{\n}\nvoid setup() {}')).toMatchObject({ kind: 'code' });
    expect(fileToLink('odd.ino', '{"a": 1}')).toMatchObject({ kind: 'code' }); // JSON, but not a workspace, and not a .json file
  });

  it('refuses binary files, empty files and other extensions, with the same help line', () => {
    expect(fileToLink('photo.png', 'PNG\0\0')).toEqual({ error: `photo.png is not a text file. ${LOAD_HELP}` });
    expect(fileToLink('blink.ino', '  \n')).toEqual({ error: 'blink.ino is empty.' });
    expect(fileToLink('notes.docx', 'hello')).toEqual({ error: `notes.docx is not a file the simulator can load. ${LOAD_HELP}` });
    expect(LOAD_HELP).toBe('Choose a .ino sketch, a .py program or a .json blocks file.');
  });

  it('the chooser offers the same kinds of files', () => {
    expect(LOAD_ACCEPT).toBe('.ino,.pde,.txt,.c,.cpp,.h,.py,.json');
    expect(MAX_PROGRAM_FILE_BYTES).toBe(1_000_000);
    expect(loadProblem('big.ino', 'too_big')).toBe('big.ino is too big to be a program (more than 1 MB).');
    expect(loadProblem('x.ino', 'unreadable')).toBe('x.ino could not be read. Try again, or choose another file.');
  });
});

describe('isWorkspaceJson', () => {
  it('accepts what Blockly.serialization.workspaces.save() writes', () => {
    expect(isWorkspaceJson({})).toBe(true);
    expect(isWorkspaceJson(WORKSPACE)).toBe(true);
    expect(isWorkspaceJson({ blocks: { languageVersion: 0, blocks: [] }, variables: [], procedures: [] })).toBe(true);
  });

  it('refuses other objects', () => {
    expect(isWorkspaceJson({ blocks: [] })).toBe(false);
    expect(isWorkspaceJson({ blocks: 'x' })).toBe(false);
    expect(isWorkspaceJson({ blocks: {}, code: 'x' })).toBe(false);
    expect(isWorkspaceJson({ kind: 'blocks' })).toBe(false);
  });
});

describe('blocksFileName', () => {
  it('is the sketch name in lower case with .blocks.json', () => {
    expect(blocksFileName('Ali Khoury', new Date(2026, 9, 30, 14, 32, 10))).toBe('zero1_ali_khoury_1030_143210.blocks.json');
    expect(blocksFileName('', new Date(2026, 0, 5, 9, 5, 7))).toBe('zero1_0105_090507.blocks.json');
  });
});
