/**
 * The Web Serial adapter (src/upload/serial/webserial.ts) with real timers and
 * WHATWG streams: end-to-end in real time against the real Optiboot 4.4 in the
 * avr8js emulator (fake SerialPort), plus open/unplug/framing-error/requestPort
 * error mapping. From the feasibility spike.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { uploadWithWebSerial, WebSerialUploadPort, requestBoardPort, UNO_USB_FILTERS } from '../src/upload/serial/webserial';
import type { WebSerialPortLike } from '../src/upload/serial/webserial';
import { UploadError } from '../src/upload/serial/errors';
import { UploadService } from '../src/upload/service';
import { RealtimeSimSerialPort } from './fakes/upload/realtime-webserial';
import { newOptibootUno, compareFlash, readText, fixture } from './fakes/upload/scenario';
import type { UploadProgress } from '../src/upload/serial/uploader';

// Real-time emulation of a whole upload (about 2-3 s alone, several times that under a full
// parallel test run): the first test bounds itself at 20 s, so give both well over the 5 s default.
const EMULATED_UPLOAD_TIMEOUT_MS = 60_000;

test('real-time upload through the Web Serial adapter to Optiboot in the emulator', async () => {
  const sim = newOptibootUno();
  sim.runForMs(200);
  const port = new RealtimeSimSerialPort(sim);
  const hex = readText(fixture('01_blink_red.hex'));
  const progress: UploadProgress[] = [];
  const log: string[] = [];
  const w0 = performance.now();
  try {
    const res = await uploadWithWebSerial(hex, { port, onProgress: (p) => progress.push(p), log: (l) => log.push(l) });
    const wall = performance.now() - w0;
    assert.equal(res.baud, 115200);
    assert.equal(compareFlash(sim, hex).mismatches, 0);
    assert.equal(port.readable, null, 'port closed afterwards');
    assert.ok(wall < 20_000, `took ${wall} ms`);
    assert.ok(log.some((l) => /in sync/.test(l)), log.join('\n'));
  } finally {
    port.stop();
  }
}, EMULATED_UPLOAD_TIMEOUT_MS);

test('port held by another program → PORT error naming the Serial Monitor', async () => {
  const sim = newOptibootUno();
  const port = new RealtimeSimSerialPort(sim);
  port.failOpenWith = new DOMException('Failed to open serial port.', 'NetworkError');
  try {
    const err = await uploadWithWebSerial(readText(fixture('blink.hex')), { port }).catch((e) => e);
    assert.ok(err instanceof UploadError);
    assert.equal(err.code, 'PORT');
    assert.match(err.message, /used by another program.*Serial Monitor/);
  } finally {
    port.stop();
  }
});

test('bad hex is rejected before the port is opened (opening resets the board)', async () => {
  const sim = newOptibootUno();
  const port = new RealtimeSimSerialPort(sim);
  try {
    const err = await uploadWithWebSerial(':10000000FFFF\n', { port }).catch((e) => e);
    assert.equal(err.code, 'HEX_PARSE');
    const err2 = await uploadWithWebSerial(readText(fixture('toolarge32257.hex')), { port }).catch((e) => e);
    assert.equal(err2.code, 'TOO_LARGE');
    assert.equal(port.opens, 0);
  } finally {
    port.stop();
  }
});

test('cable pulled mid-upload → PORT "Lost the connection"', async () => {
  const sim = newOptibootUno();
  sim.runForMs(200);
  const port = new RealtimeSimSerialPort(sim);
  try {
    const err = await uploadWithWebSerial(readText(fixture('full32256.hex')), {
      port,
      onProgress: (p) => {
        if (p.phase === 'write' && p.done === 10 * 128) port.unplug();
      },
    }).catch((e) => e);
    assert.ok(err instanceof UploadError, String(err));
    assert.equal(err.code, 'PORT');
    assert.match(err.message, /Lost the connection|disconnected/);
  } finally {
    port.stop();
  }
}, EMULATED_UPLOAD_TIMEOUT_MS);

/** Minimal scripted SerialPort for adapter-level behaviour. */
function scriptedPort(chunks: (Uint8Array | Error)[]): WebSerialPortLike & { closed: boolean } {
  let open = false;
  let cur: ReadableStream<Uint8Array> | null = null;
  const queue = [...chunks];
  const make = () =>
    new ReadableStream<Uint8Array>({
      pull(c) {
        const next = queue.shift();
        if (next === undefined) return new Promise(() => {}); // idle
        if (next instanceof Error) {
          cur = null;
          c.error(next);
        } else c.enqueue(next);
      },
      cancel() {
        cur = null;
      },
    });
  return {
    closed: false,
    async open() {
      open = true;
    },
    async close() {
      open = false;
      this.closed = true;
    },
    get readable() {
      if (!open) return null;
      return (cur ??= make());
    },
    get writable() {
      return open ? new WritableStream<Uint8Array>() : null;
    },
    async setSignals() {},
  };
}

test('non-fatal FramingError: adapter picks up the replacement readable and keeps reading', async () => {
  const sp = scriptedPort([Uint8Array.of(1, 2), Object.assign(new DOMException('Framing error', 'FramingError')), Uint8Array.of(3)]);
  const up = await WebSerialUploadPort.open(sp, 115200);
  const got: number[] = [];
  for (let i = 0; i < 5 && got.length < 3; i++) {
    const c = await up.read(100);
    if (c) got.push(...c);
  }
  assert.deepEqual(got, [1, 2, 3]);
  assert.equal(await up.read(20), null, 'timeout → null');
  await up.close();
  assert.ok(sp.closed);
});

test('read() honours AbortSignal', async () => {
  const up = await WebSerialUploadPort.open(scriptedPort([]), 115200);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 10);
  const t0 = performance.now();
  await assert.rejects(up.read(5000, ac.signal));
  assert.ok(performance.now() - t0 < 1000);
  await up.close();
});

test('requestBoardPort: unsupported browser / chooser cancelled / filters', async () => {
  await assert.rejects(requestBoardPort(null), (e: UploadError) => e.code === 'UNSUPPORTED');
  const cancelled = { requestPort: async () => Promise.reject(new DOMException('No port selected by the user.', 'NotFoundError')), getPorts: async () => [] };
  await assert.rejects(requestBoardPort(cancelled), (e: UploadError) => e.code === 'ABORTED' && /No board selected/.test(e.message));
  let seen: unknown;
  const ok = { requestPort: async (o?: unknown) => ((seen = o), scriptedPort([])), getPorts: async () => [] };
  await requestBoardPort(ok);
  assert.deepEqual(seen, { filters: UNO_USB_FILTERS });
  await requestBoardPort(ok, null); // "Show every serial port"
  assert.deepEqual(seen, {});
});

test('the chooser lists the ZERO1 CH340 and the other usual UNO-type USB chips', () => {
  const listed = (vid: number, pid: number) =>
    UNO_USB_FILTERS.some((f) => f.usbVendorId === vid && ('usbProductId' in f ? f.usbProductId === pid : true));
  for (const [vid, pid, chip] of [
    [0x1a86, 0x7523, 'CH340 (ZERO1)'],
    [0x1a86, 0x5523, 'CH341'],
    [0x1a86, 0x55d3, 'CH343'],
    [0x1a86, 0x55d4, 'CH9102'],
    [0x2341, 0x0043, 'Arduino UNO R3'],
    [0x2341, 0x0243, 'Arduino UNO R3 (newer)'],
    [0x0403, 0x6001, 'FTDI FT232R'],
    [0x10c4, 0xea60, 'CP2102'],
  ] as const) assert.ok(listed(vid, pid), chip);
});

test('UploadService.requestPort: the usual chips by default, every serial port with anyPort', async () => {
  const seen: unknown[] = [];
  const serial = { requestPort: async (o?: unknown) => (seen.push(o), scriptedPort([])), getPorts: async () => [] };
  const service = new UploadService({ serial, createWorker: () => ({}) as Worker });
  await service.requestPort();
  await service.requestPort({ anyPort: true });
  assert.deepEqual(seen, [{ filters: UNO_USB_FILTERS }, {}]);
});
