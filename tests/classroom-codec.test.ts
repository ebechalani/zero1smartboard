/**
 * src/classroom/codec.ts (docs/CLASSROOM.md §4.5, §7.2): gzip or plain encoding of hand-in
 * content, and capped decoding (Node 22 has CompressionStream / DecompressionStream).
 */
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeContent, encodeContent } from '../src/classroom/codec';

const TINY = 'void setup() {}\nvoid loop() {}\n';
const SKETCH = `// Traffic light\n${'void loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  digitalWrite(13, LOW);\n  delay(500);\n}\n'.repeat(20)}`;
const WORKSPACE = JSON.stringify({ blocks: { blocks: Array.from({ length: 30 }, (_, i) => ({ type: 'z1_led', id: `b${i}`, x: i, y: i })) } });

afterEach(() => vi.unstubAllGlobals());

describe('encodeContent', () => {
  it('round-trips plain content', async () => {
    const encoded = await encodeContent(SKETCH, WORKSPACE, { compress: false });
    expect(encoded).toEqual({ enc: 'plain', code: SKETCH, workspace: WORKSPACE });
    expect(await decodeContent(encoded)).toEqual({ ok: true, code: SKETCH, workspaceJson: WORKSPACE });
  });
  it('round-trips gzip content (smaller than the text)', async () => {
    const encoded = await encodeContent(SKETCH, WORKSPACE);
    expect(encoded.enc).toBe('gzip');
    expect(encoded.code).toBeInstanceOf(Uint8Array);
    expect(encoded.workspace).toBeInstanceOf(Uint8Array);
    expect((encoded.code as Uint8Array).length + (encoded.workspace as Uint8Array).length).toBeLessThan(SKETCH.length + WORKSPACE.length);
    expect(await decodeContent(encoded)).toEqual({ ok: true, code: SKETCH, workspaceJson: WORKSPACE });
  });
  it('keeps a tiny sketch plain because gzip is not smaller', async () => {
    expect(await encodeContent(TINY, '')).toEqual({ enc: 'plain', code: TINY, workspace: '' });
  });
  it('a Code hand-in has an empty workspace: empty bytes under gzip', async () => {
    const encoded = await encodeContent(SKETCH, '');
    expect(encoded.enc).toBe('gzip');
    expect(encoded.workspace).toEqual(new Uint8Array(0));
    expect(await decodeContent(encoded)).toEqual({ ok: true, code: SKETCH, workspaceJson: '' });
  });
  it('stays plain without CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    expect((await encodeContent(SKETCH, WORKSPACE)).enc).toBe('plain');
  });
  it('keeps non-ASCII text intact', async () => {
    const text = 'Serial.println("héllo 🙂 مرحبا");\n'.repeat(50);
    const encoded = await encodeContent(text, '');
    expect(encoded.enc).toBe('gzip');
    expect(await decodeContent(encoded)).toEqual({ ok: true, code: text, workspaceJson: '' });
  });
});

describe('decodeContent', () => {
  it('refuses a gzip bomb at the cap', async () => {
    const bomb = new Uint8Array(gzipSync(Buffer.from('x'.repeat(5_000_000))));
    expect(bomb.length).toBeLessThan(50_000);
    expect(await decodeContent({ enc: 'gzip', code: bomb, workspace: new Uint8Array(0) })).toEqual({ ok: false, problem: 'too_large' });
    expect(await decodeContent({ enc: 'gzip', code: new Uint8Array(gzipSync(Buffer.from('ok'))), workspace: bomb })).toEqual({ ok: false, problem: 'too_large' });
  });
  it('accepts content just under the caps and refuses plain text over them', async () => {
    const big = new Uint8Array(gzipSync(Buffer.from('y'.repeat(100_000))));
    expect((await decodeContent({ enc: 'gzip', code: big, workspace: new Uint8Array(0) })).ok).toBe(true);
    expect(await decodeContent({ enc: 'plain', code: 'z'.repeat(100_001), workspace: '' })).toEqual({ ok: false, problem: 'too_large' });
  });
  it('reports corrupt bytes and mismatched types', async () => {
    expect(await decodeContent({ enc: 'gzip', code: new Uint8Array([1, 2, 3, 4]), workspace: new Uint8Array(0) })).toEqual({ ok: false, problem: 'corrupt' });
    expect(await decodeContent({ enc: 'gzip', code: 'text', workspace: '' })).toEqual({ ok: false, problem: 'corrupt' });
    expect(await decodeContent({ enc: 'plain', code: new Uint8Array(2), workspace: '' })).toEqual({ ok: false, problem: 'corrupt' });
    const invalidUtf8 = new Uint8Array(gzipSync(Buffer.from([0xff, 0xfe, 0x41])));
    expect(await decodeContent({ enc: 'gzip', code: invalidUtf8, workspace: new Uint8Array(0) })).toEqual({ ok: false, problem: 'corrupt' });
  });
  it('reports unsupported without DecompressionStream', async () => {
    const encoded = await encodeContent(SKETCH, '');
    vi.stubGlobal('DecompressionStream', undefined);
    expect(await decodeContent(encoded)).toEqual({ ok: false, problem: 'unsupported' });
  });
});
