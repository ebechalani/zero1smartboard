/**
 * End-to-end: the uploader talks STK500 to the REAL Optiboot 4.4 binary
 * (ArduinoCore-avr 1.8.6 bootloaders/optiboot/optiboot_atmega328.hex) running on
 * avr8js, which self-programs the flash through the SPM model of
 * tests/fakes/upload/uno-sim.ts; then the uploaded program runs. From the
 * feasibility spike. The long cases (full 32 KB image, USB
 * latency, abort/recover, chatty sketch): `npm run test:hardware-sim`.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { UnoSim } from '../tests/fakes/upload/uno-sim';
import {
  newOptibootUno,
  runUpload,
  compareFlash,
  bootSectionMatches,
  avrTextSince,
  readText,
  fixture,
  OPTIBOOT_HEX_PATH,
  ATMEGABOOT_HEX_PATH,
} from '../tests/fakes/upload/scenario';
import type { UploadRun } from '../tests/fakes/upload/scenario';
import { UploadError } from '../src/upload/serial/errors';

const OPTIBOOT = readText(OPTIBOOT_HEX_PATH);

function summary(sim: UnoSim, run: UploadRun, hexText: string) {
  return {
    ok: !run.error,
    error: run.error instanceof UploadError ? `${run.error.code}: ${run.error.message}` : run.error ? String(run.error) : undefined,
    result: run.result,
    simulatedMs: +run.simMs.toFixed(1),
    wallMs: +run.wallMs.toFixed(0),
    avrInstructions: run.instructions,
    flashVsHex: compareFlash(sim, hexText),
    bootSectionIntact: bootSectionMatches(sim, OPTIBOOT),
    spm: { ...sim.stats.spm },
    line: { overruns: sim.stats.overruns, lostInReset: sim.stats.lostInReset, lostRxDisabled: sim.stats.lostRxDisabled },
    resets: sim.stats.resets.map((r) => `${r.cause}@${((r.t / sim.freq) * 1000).toFixed(2)}ms MCUSR=0x${r.mcusr.toString(16)}`),
    log: run.log,
  };
}

function edgesMs(sim: UnoSim, port: 'B' | 'C', bit: number, from: number) {
  return sim.pinEdges(port, bit, from).map((e) => ({ ms: +(((e.t - from) / sim.freq) * 1000).toFixed(2), level: e.level }));
}

test('C blink (native avr-gcc 7.3.0): flashed, verified, runs and toggles A1/D13', async () => {
  const hex = readText(fixture('blink.hex'));
  const sim = newOptibootUno();
  sim.runForMs(200);
  const run = await runUpload(sim, hex);
  const s = summary(sim, run, hex);
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(s.flashVsHex.mismatches, 0);
  assert.ok(s.bootSectionIntact);
  assert.equal(sim.stats.overruns, 0);
  assert.equal(sim.stats.spm.bootWriteBlocked + sim.stats.spm.rwwReadWhileBusy + sim.stats.spm.rwwExecWhileBusy, 0);
  assert.equal(sim.stats.spm.pageWrites, 3);
  sim.runForMs(1000);
  const a1 = edgesMs(sim, 'C', 1, run.endCycle);
  const d13 = edgesMs(sim, 'B', 5, run.endCycle);
  // LEAVE_PROGMODE → 16 ms watchdog → 65 ms start-up → Optiboot sees WDRF → app
  assert.ok(a1[0].ms > 75 && a1[0].ms < 90, `app started at ${a1[0].ms} ms`);
  const periods = a1.slice(1).map((e, i) => e.ms - a1[i].ms);
  assert.ok(periods.every((p) => p > 99 && p < 102), `toggle every ~100 ms: ${periods}`);
  assert.equal(d13.length, a1.length);
  const text = avrTextSince(sim, run.endCycle);
  assert.match(text, /^blink 0\r\nblink 1\r\n/);
});

test('full 32256-byte image (252 pages, up to 0x7DFF): written + verified, bootloader untouched', async () => {
  const hex = readText(fixture('full32256.hex'));
  const sim = newOptibootUno();
  sim.runForMs(200);
  const run = await runUpload(sim, hex);
  const s = summary(sim, run, hex);
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(s.flashVsHex.mismatches, 0);
  assert.equal(s.flashVsHex.comparedBytes, 32256);
  assert.ok(s.bootSectionIntact);
  assert.equal(sim.stats.spm.pageWrites, 252);
  assert.equal(sim.stats.overruns, 0);
});

test('second upload over a running sketch that floods Serial at 115200', async () => {
  const sim = newOptibootUno();
  sim.runForMs(200);
  const r1 = await runUpload(sim, readText(fixture('blink.hex')));
  assert.equal(r1.error, undefined);
  sim.runForMs(700); // sketch now printing "blink n" every 100 ms
  const hex2 = readText(fixture('31_greenhouse.hex'));
  const r2 = await runUpload(sim, hex2);
  const s = summary(sim, r2, hex2);
  assert.equal(r2.error, undefined, String(r2.error));
  assert.equal(s.flashVsHex.mismatches, 0);
  assert.ok(r2.discardedBytes > 0, 'stale sketch output was discarded');
});

for (const latency of [1, 4]) {
  test(`USB latency ${latency} ms each way (CH340 / OS scheduling)`, async () => {
    const hex = readText(fixture('full32256.hex'));
    const sim = newOptibootUno({ usbLatencyMs: latency });
    sim.runForMs(200);
    const run = await runUpload(sim, hex);
    const s = summary(sim, run, hex);
    assert.equal(run.error, undefined, String(run.error));
    assert.equal(s.flashVsHex.mismatches, 0);
    });
}

test('board with fast start-up fuse (SUT → 4.1 ms): first sync lands inside the LED-flash window, still one pair in flight', async () => {
  const hex = readText(fixture('blink.hex'));
  const sim = newOptibootUno({ startupMs: 4.1 });
  sim.runForMs(200);
  const run = await runUpload(sim, hex);
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(compareFlash(sim, hex).mismatches, 0);
  assert.equal(sim.stats.overruns, 0);
});

test('abort mid-write, board recovers, next upload succeeds', async () => {
  const sim = newOptibootUno();
  sim.runForMs(200);
  const ac = new AbortController();
  const hex = readText(fixture('full32256.hex'));
  const r1 = await runUpload(sim, hex, {
    signal: ac.signal,
    onProgress: (p) => {
      if (p.phase === 'write' && p.done >= 40 * 128) ac.abort();
    },
  });
  assert.ok(r1.error instanceof UploadError && r1.error.code === 'ABORTED', String(r1.error));
  const pagesAtAbort = sim.stats.spm.pageWrites;
  sim.runForMs(1500); // Optiboot's 1 s watchdog expires → (half-written) app starts
  const wdt = sim.stats.resets.filter((r) => r.cause === 'watchdog').length;
  const blink = readText(fixture('blink.hex'));
  const r2 = await runUpload(sim, blink);
  assert.equal(r2.error, undefined, String(r2.error));
  assert.equal(compareFlash(sim, blink).mismatches, 0);
});
