/**
 * Uploader behaviour (src/upload/serial/uploader.ts + stk500.ts) against a
 * protocol-level fake Optiboot (virtual time, no hardware): the happy path and
 * every failure path the dialog must explain. From the feasibility spike.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { uploadHex } from '../src/upload/serial/uploader';
import type { UploadOptions, UploadProgress } from '../src/upload/serial/uploader';
import { UploadError } from '../src/upload/serial/errors';
import { parseIntelHex, hexToImage, toIntelHex } from '../src/upload/serial/intelhex';
import { FakeOptibootPort } from './fakes/upload/fake-bootloader';
import type { FakeOptions } from './fakes/upload/fake-bootloader';
import { fixture, readText } from './fakes/upload/scenario';

const BLINK = readText(fixture('blink.hex'));
const FULL = readText(fixture('full32256.hex'));

async function upload(fake: FakeOptions, hex = BLINK, opts: UploadOptions = {}) {
  const port = new FakeOptibootPort(fake);
  const progress: UploadProgress[] = [];
  const log: string[] = [];
  let error: UploadError | undefined;
  let result;
  try {
    result = await uploadHex(port, hex, { clock: port.clock, onProgress: (p) => progress.push(p), log: (l) => log.push(l), ...opts });
  } catch (e) {
    if (!(e instanceof UploadError)) throw e;
    error = e;
  }
  return { port, progress, log, error, result };
}

test('happy path: reset sequence, sync, signature, pages, verify, leave', async () => {
  const { port, result, error, progress } = await upload({});
  assert.equal(error, undefined);
  assert.ok(result);
  assert.equal(result.baud, 115200);
  assert.deepEqual(result.signature, [0x1e, 0x95, 0x0f]);
  assert.deepEqual(result.bootloaderVersion, { major: 4, minor: 4 });
  assert.equal(result.pagesWritten, 3);
  assert.equal(result.bytesVerified, 384);
  // DTR/RTS: off then on (avrdude arduino_open)
  assert.deepEqual(port.signals, [
    { dataTerminalReady: false, requestToSend: false },
    { dataTerminalReady: true, requestToSend: true },
  ]);
  const first = Array.from(port.writes[0]);
  assert.deepEqual(first, [0x30, 0x20]);
  const cmds = port.writes.map((w) => w[0]);
  assert.deepEqual(cmds.slice(0, 6), [0x30, 0x30, 0x41, 0x41, 0x75, 0x50]);
  assert.equal(cmds.at(-1), 0x51);
  // Every PROG_PAGE is a full 128-byte page, length big-endian, memtype 'F'.
  for (const w of port.writes.filter((w) => w[0] === 0x64)) {
    assert.equal(w.length, 4 + 128 + 1);
    assert.deepEqual(Array.from(w.subarray(1, 4)), [0x00, 0x80, 0x46]);
    assert.equal(w.at(-1), 0x20);
  }
  // LOAD_ADDRESS carries WORD addresses, little-endian: 0x0000, 0x0040, 0x0080
  const addrs = port.writes.filter((w) => w[0] === 0x55).map((w) => w[1] | (w[2] << 8));
  assert.deepEqual(addrs, [0x00, 0x40, 0x80, 0x00, 0x40, 0x80]);
  const img = hexToImage(parseIntelHex(BLINK), 384);
  assert.deepEqual(port.flash.subarray(0, 384), img);
  // progress is monotonic and ends at 100
  const pct = progress.map((p) => p.percent);
  assert.ok(pct.every((v, i) => i === 0 || v >= pct[i - 1]), 'monotonic');
  assert.equal(pct.at(-1), 100);
  assert.equal(progress.at(-1)!.phase, 'done');
});

test('full 32256-byte image: 252 pages, address 0x7D80 is the last page', async () => {
  const { port, result, error } = await upload({}, FULL);
  assert.equal(error, undefined);
  assert.equal(result!.pagesWritten, 252);
  const addrs = port.writes.filter((w) => w[0] === 0x55).map((w) => (w[1] | (w[2] << 8)) * 2);
  assert.equal(Math.max(...addrs), 0x7d80);
});

test('no answer at all → NO_ANSWER, mentions the Serial Monitor, tries both bauds twice', async () => {
  const { port, error } = await upload({ silent: true });
  assert.equal(error?.code, 'NO_ANSWER');
  assert.match(error!.message, /No answer from the board — is the Arduino IDE Serial Monitor/);
  assert.equal(port.resets, 4); // 2 rounds × [115200, 57600]
  assert.deepEqual(port.bauds, [57600, 115200, 57600]);
  assert.equal(error!.details.syncAttempts, 8);
  // virtual time spent before giving up
  assert.ok(port.now > 5000 && port.now < 6000, `gave up after ${port.now} ms`);
});

test('board answers with sketch output (reset did not happen) → NOT_IN_SYNC with the text', async () => {
  const { error } = await upload({ chatter: 'Temp: 21.5 C\r\n' });
  assert.equal(error?.code, 'NOT_IN_SYNC');
  assert.match(error!.message, /text "Temp: 21\.5 C⏎/);
  assert.match(error!.message, /press the RESET button/);
});

test('wrong sync reply (14 11) → NOT_IN_SYNC with the bytes', async () => {
  const { error } = await upload({ syncReply: [0x14, 0x11] });
  assert.equal(error?.code, 'NOT_IN_SYNC');
  assert.match(error!.message, /bytes 14 11/);
});

test('verify mismatch → VERIFY_FAILED with address and both values', async () => {
  const img = hexToImage(parseIntelHex(BLINK));
  const { error } = await upload({ corruptAt: 0x105 });
  assert.equal(error?.code, 'VERIFY_FAILED');
  assert.equal(error!.details.address, 0x105);
  assert.equal(error!.details.wrote, img[0x105]);
  assert.equal(error!.details.read, img[0x105] ^ 1);
  assert.match(error!.message, /0x0105/);
});

test('checksum error in the hex → HEX_CHECKSUM, board untouched', async () => {
  const bad = BLINK.replace(/^(:10001000)(.)/m, (_m, a, c) => a + (c === '0' ? '1' : '0'));
  const { port, error } = await upload({}, bad);
  assert.equal(error?.code, 'HEX_CHECKSUM');
  assert.match(error!.message, /line 2/);
  assert.equal(port.writes.length, 0);
  assert.equal(port.signals.length, 0);
});

test('program too large (32257 bytes) → TOO_LARGE, board untouched', async () => {
  const { port, error } = await upload({}, readText(fixture('toolarge32257.hex')));
  assert.equal(error?.code, 'TOO_LARGE');
  assert.match(error!.message, /32257 bytes.*32256/);
  assert.equal(port.writes.length + port.signals.length, 0);
});

test('abort during page writes → ABORTED promptly, nothing sent afterwards', async () => {
  const ac = new AbortController();
  const port = new FakeOptibootPort({});
  let writesAtAbort = -1;
  const err = await uploadHex(port, FULL, {
    clock: port.clock,
    signal: ac.signal,
    onProgress: (p) => {
      if (p.phase === 'write' && p.done >= 5 * 128 && !ac.signal.aborted) {
        ac.abort();
        writesAtAbort = port.writes.length;
      }
    },
  }).catch((e) => e);
  assert.ok(err instanceof UploadError);
  assert.equal(err.code, 'ABORTED');
  assert.match(err.message, /incomplete program/);
  assert.equal(port.pagesProgrammed, 5);
  assert.equal(port.writes.length, writesAtAbort, 'no bytes written after abort');
});

test('abort while waiting for the sync reply → ABORTED', async () => {
  const ac = new AbortController();
  const port = new FakeOptibootPort({ silent: true });
  port.onRead = (p) => {
    if (p.now > 1000) ac.abort();
  };
  const err = await uploadHex(port, BLINK, { clock: port.clock, signal: ac.signal }).catch((e) => e);
  assert.equal(err?.code, 'ABORTED');
  assert.ok(port.now < 2500, `stopped at ${port.now} ms`);
});

test('old bootloader at 57600 → falls back and uses the 30720-byte limit', async () => {
  const { port, result, error } = await upload({ baud: 57600, version: [1, 16] });
  assert.equal(error, undefined);
  assert.equal(result!.baud, 57600);
  assert.deepEqual(port.bauds, [57600]);
  // a 31000-byte program fits Optiboot but not the 2 KiB ATmegaBOOT
  const big = toIntelHex(new Uint8Array(31000).fill(0x11));
  const r2 = await upload({ baud: 57600, version: [1, 16] }, big);
  assert.equal(r2.error?.code, 'TOO_LARGE');
  assert.match(r2.error!.message, /30720/);
  assert.equal(r2.port.pagesProgrammed, 0);
});

test('signature mismatch → SIGNATURE_MISMATCH before writing', async () => {
  const { port, error } = await upload({ signature: [0x1e, 0x98, 0x01] });
  assert.equal(error?.code, 'SIGNATURE_MISMATCH');
  assert.match(error!.message, /1E 98 01.*1E 95 0F/);
  assert.equal(port.pagesProgrammed, 0);
});

test('bootloader stops answering mid-upload → PROTOCOL', async () => {
  const { error } = await upload({ dieAfterPages: 2 });
  assert.equal(error?.code, 'PROTOCOL');
  assert.match(error!.message, /no reply to PROG_PAGE 0x100/);
});

test('bootloader answers FAILED → PROTOCOL naming the response', async () => {
  const { error } = await upload({ failProgPage: true });
  assert.equal(error?.code, 'PROTOCOL');
  assert.match(error!.message, /expected OK 0x10, got 0x11 FAILED/);
});

test('port write failure (cable pulled) → PORT', async () => {
  const port = new FakeOptibootPort({});
  let n = 0;
  const orig = port.write.bind(port);
  port.write = async (b) => {
    if (++n > 10) throw new DOMException('The device has been lost.', 'NetworkError');
    return orig(b);
  };
  const err = await uploadHex(port, BLINK, { clock: port.clock }).catch((e) => e);
  assert.equal(err?.code, 'PORT');
  assert.match(err.message, /device has been lost/);
});
