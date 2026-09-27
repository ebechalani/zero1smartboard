/**
 * Intel HEX parser (src/upload/serial/intelhex.ts): the official Optiboot
 * file, round trips against `avr-objcopy -O binary` images, and every
 * malformed-record path with its line number. From the feasibility spike.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseIntelHex, hexToImage, toIntelHex, HexParseError } from '../src/upload/serial/intelhex';
import { OPTIBOOT_HEX_PATH, fixture, readText } from './fakes/upload/scenario';

function expectHexError(text: string, code: string, line?: number, re?: RegExp) {
  assert.throws(
    () => parseIntelHex(text),
    (e: unknown) => {
      assert.ok(e instanceof HexParseError, 'HexParseError');
      assert.equal(e.code, code);
      if (line !== undefined) assert.equal(e.line, line);
      if (re) assert.match(e.message, re);
      return true;
    },
  );
}

test('parses the official Optiboot hex (type 00/03/01 records, 0x7E00 + version word at 0x7FFE)', () => {
  const h = parseIntelHex(readText(OPTIBOOT_HEX_PATH));
  assert.equal(h.segments.length, 2);
  assert.equal(h.segments[0].address, 0x7e00);
  assert.equal(h.segments[0].data.length, 0x1f4); // 500 bytes of code
  assert.equal(h.segments[1].address, 0x7ffe);
  assert.deepEqual(Array.from(h.segments[1].data), [0x04, 0x04]); // optiboot_version 4.4
  assert.equal(h.startAddress, 0x7e00); // :0400000300007E007B
  assert.equal(h.maxAddress, 0x8000);
});

test('image equals avr-objcopy -O binary output for the native-gcc blink', () => {
  const h = parseIntelHex(readText(fixture('blink.hex')));
  const bin = fs.readFileSync(fixture('blink.bin'));
  assert.deepEqual(Buffer.from(hexToImage(h)), bin);
});

test('CRLF files and 32256-byte image round-trip', () => {
  const h = parseIntelHex(readText(fixture('full32256.hex')));
  const bin = fs.readFileSync(fixture('full32256.bin'));
  assert.equal(h.dataBytes, 32256);
  assert.deepEqual(Buffer.from(hexToImage(h)), bin);
  const again = parseIntelHex(toIntelHex(hexToImage(h)));
  assert.deepEqual(Buffer.from(hexToImage(again)), bin);
});

test('checksum error is reported with its line number', () => {
  const lines = readText(fixture('blink.hex')).split('\n');
  // Flip one data digit on line 3 without fixing the checksum.
  const l = lines[2];
  lines[2] = l.slice(0, 12) + (l[12] === '0' ? '1' : '0') + l.slice(13);
  expectHexError(lines.join('\n'), 'HEX_CHECKSUM', 3, /checksum/);
});

test('malformed records', () => {
  expectHexError(':00000001FF\n:0100000000FF\n', 'HEX_PARSE', 2, /after the end-of-file/);
  expectHexError(':10000000\n:00000001FF\n', 'HEX_PARSE', 1);
  expectHexError('garbage\n', 'HEX_PARSE', 1, /start with ':'/);
  expectHexError(':0200000011ZZ00\n:00000001FF\n', 'HEX_PARSE', 1, /non-hexadecimal/);
  expectHexError(':020000000011ED\n', 'HEX_PARSE', undefined, /truncated/); // no EOF
  expectHexError(':0300000000112DC\n:00000001FF\n', 'HEX_PARSE', 1); // odd length
  expectHexError(':00000006FA\n:00000001FF\n', 'HEX_PARSE', 1, /unknown record type 0x06/);
});

test('extended linear (04) and segment (02) addresses', () => {
  const lin = parseIntelHex(':020000040001F9\n:02000000AABB99\n:00000001FF\n');
  assert.equal(lin.segments[0].address, 0x10000);
  const seg = parseIntelHex(':020000021000EC\n:02000000AABB99\n:00000001FF\n');
  assert.equal(seg.segments[0].address, 0x10000);
});

test('overlapping records: identical is fine, conflicting is an error', () => {
  const ok = parseIntelHex(':02000000AABB99\n:02000000AABB99\n:00000001FF\n');
  assert.equal(ok.dataBytes, 2);
  expectHexError(':02000000AABB99\n:02000000AACC88\n:00000001FF\n', 'HEX_PARSE', 2, /conflicting/);
});
