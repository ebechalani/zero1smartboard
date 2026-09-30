/**
 * The store-only zip writer (docs/CLASSROOM.md §7.3, C): CRC-32 of known strings, a two-file
 * archive parsed back by a minimal reader (local headers and the central directory), the UTF-8
 * name flag, and the unique-name helper. Plus the dashboard's zip entries (src/teacher/handins.ts):
 * `.ino` for every hand-in, `.blocks.json` for Blocks and `.py` for Python (docs/PYTHON.md §8.5).
 */
import { describe, expect, it } from 'vitest';
import { pythonPlaceholder } from '../src/sketch/placeholder';
import { DecodeCache, zipEntries, zipOf } from '../src/teacher/handins';
import { crc32, makeZip, uniqueName } from '../src/teacher/zip';
import { makeHandin } from './fakes/fake-teacher-api';

const bytesOf = (text: string) => new TextEncoder().encode(text);

interface Entry {
  name: string;
  data: string;
  crc: number;
  flags: number;
  method: number;
}

/** A minimal zip reader: walks the local headers, then checks the central directory. */
async function readZip(blob: Blob): Promise<{ entries: Entry[]; central: { name: string; offset: number; crc: number }[]; count: number }> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  const entries: Entry[] = [];
  let pos = 0;
  while (view.getUint32(pos, true) === 0x04034b50) {
    const flags = view.getUint16(pos + 6, true);
    const method = view.getUint16(pos + 8, true);
    const crc = view.getUint32(pos + 14, true);
    const size = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const name = new TextDecoder().decode(buf.slice(pos + 30, pos + 30 + nameLen));
    const start = pos + 30 + nameLen + extraLen;
    const data = new TextDecoder().decode(buf.slice(start, start + size));
    entries.push({ name, data, crc, flags, method });
    pos = start + size;
  }
  const central: { name: string; offset: number; crc: number }[] = [];
  while (view.getUint32(pos, true) === 0x02014b50) {
    const crc = view.getUint32(pos + 16, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const offset = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(buf.slice(pos + 46, pos + 46 + nameLen));
    central.push({ name, offset, crc });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  expect(view.getUint32(pos, true)).toBe(0x06054b50);
  const count = view.getUint16(pos + 10, true);
  expect(view.getUint32(pos + 12, true)).toBe(pos - view.getUint32(pos + 16, true)); // central size
  expect(view.getUint32(pos + 16, true)).toBe(centralOffset(entries));
  return { entries, central, count };
}

function centralOffset(entries: Entry[]): number {
  return entries.reduce((n, e) => n + 30 + bytesOf(e.name).length + bytesOf(e.data).length, 0);
}

describe('crc32', () => {
  it('matches the known values', () => {
    expect(crc32(bytesOf(''))).toBe(0);
    expect(crc32(bytesOf('a'))).toBe(0xe8b7be43);
    expect(crc32(bytesOf('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytesOf('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('makeZip', () => {
  it('writes two stored entries that a reader gets back, with matching central directory', async () => {
    const date = new Date(2026, 8, 26, 10, 42, 8);
    const zip = makeZip([
      { name: 'ali.k.ino', data: 'void setup() {}\n', date },
      { name: 'sara.m.ino', data: bytesOf('void loop() {}\n'), date },
    ]);
    expect(zip.type).toBe('application/zip');
    const { entries, central, count } = await readZip(zip);
    expect(count).toBe(2);
    expect(entries.map((e) => [e.name, e.data])).toEqual([
      ['ali.k.ino', 'void setup() {}\n'],
      ['sara.m.ino', 'void loop() {}\n'],
    ]);
    for (const e of entries) {
      expect(e.method).toBe(0);
      expect(e.crc).toBe(crc32(bytesOf(e.data)));
    }
    expect(central.map((c) => c.name)).toEqual(['ali.k.ino', 'sara.m.ino']);
    expect(central[0].offset).toBe(0);
    expect(central[1].offset).toBe(30 + bytesOf('ali.k.ino').length + bytesOf('void setup() {}\n').length);
    expect(central.map((c) => c.crc)).toEqual(entries.map((e) => e.crc));
  });

  it('sets the UTF-8 name flag (bit 11) and keeps non-ASCII names', async () => {
    const { entries } = await readZip(makeZip([{ name: 'élise-2026-09-26-1042.ino', data: 'x' }]));
    expect(entries[0].name).toBe('élise-2026-09-26-1042.ino');
    expect(entries[0].flags & 0x0800).toBe(0x0800);
  });

  it('writes a valid empty archive', async () => {
    const { entries, count } = await readZip(makeZip([]));
    expect(entries).toEqual([]);
    expect(count).toBe(0);
  });
});

describe('uniqueName', () => {
  it('appends -2, -3 before the extension', () => {
    const taken = new Set<string>();
    expect(uniqueName('ali.k.ino', taken)).toBe('ali.k.ino');
    expect(uniqueName('ali.k.ino', taken)).toBe('ali.k-2.ino');
    expect(uniqueName('ali.k.ino', taken)).toBe('ali.k-3.ino');
    expect(uniqueName('README', taken)).toBe('README');
    expect(uniqueName('README', taken)).toBe('README-2');
  });
});

describe('zipEntries (the dashboard downloads)', () => {
  const NOW = new Date(2026, 8, 26, 14, 0);
  const at = (h: number, m: number) => new Date(2026, 8, 26, h, m);
  const PY = 'from machine import Pin\nled = Pin(13, Pin.OUT)\n';
  const SKETCH = 'void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n}\n';

  it('puts <First_Last>.py next to the .ino of a Python hand-in, older versions stamped', async () => {
    const items = [
      makeHandin({ id: 'p1', kind: 'python', createdAt: at(10, 0), code: pythonPlaceholder(2), workspaceJson: 'x = (\n' }),
      makeHandin({ id: 'p2', kind: 'python', createdAt: at(11, 0), code: SKETCH, workspaceJson: PY }),
      makeHandin({ id: 'b1', firstName: 'Sara', lastName: 'Mansour', kind: 'blocks', createdAt: at(10, 30), workspaceJson: '{"blocks":{}}' }),
      makeHandin({ id: 'c1', firstName: 'Omar', lastName: 'Haddad', createdAt: at(9, 0), code: 'int a;' }),
    ];
    const cache = new DecodeCache();
    await cache.decodeAll(items);
    const entries = zipEntries(items, cache, NOW);
    expect(entries.map((e) => [e.name, e.data])).toEqual([
      ['Ali_Khoury.ino', SKETCH],
      ['Ali_Khoury.py', PY],
      ['Sara_Mansour.ino', 'void setup() {}\nvoid loop() {}\n'],
      ['Sara_Mansour.blocks.json', '{"blocks":{}}'],
      ['Ali_Khoury-2026-09-26-1000.ino', pythonPlaceholder(2)],
      ['Ali_Khoury-2026-09-26-1000.py', 'x = (\n'],
      ['Omar_Haddad.ino', 'int a;'],
    ]);
    expect(entries.every((e) => e.date instanceof Date)).toBe(true);
    const { entries: read } = await readZip(zipOf(items, cache, NOW));
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    expect(read[1].data).toBe(PY);
  });

  it('never writes a .py for Code or Blocks, leaves out undecoded records and keeps names unique', async () => {
    const items = [
      makeHandin({ id: 'c1', createdAt: at(10, 0), code: 'int a;', workspaceJson: '' }),
      makeHandin({ id: 'p1', firstName: 'Ali', lastName: 'Khoury!', kind: 'python', createdAt: at(9, 0), workspaceJson: PY }), // the same file stem, another student
      makeHandin({ id: 'bad', firstName: 'Sara', lastName: 'Mansour', kind: 'python', createdAt: at(8, 0) }),
    ];
    items[2].content = { enc: 'gzip', code: 'not bytes', workspace: '' };
    const cache = new DecodeCache();
    await cache.decodeAll(items);
    // The second student's .py keeps the name of its .ino.
    expect(zipEntries(items, cache, NOW).map((e) => e.name)).toEqual(['Ali_Khoury.ino', 'Ali_Khoury-2.ino', 'Ali_Khoury-2.py']);
  });
});
