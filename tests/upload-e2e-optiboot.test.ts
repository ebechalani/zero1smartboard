/**
 * End-to-end: the uploader talks STK500 to the REAL Optiboot 4.4 binary
 * (ArduinoCore-avr 1.8.6 bootloaders/optiboot/optiboot_atmega328.hex) running on
 * avr8js, which self-programs the flash through the SPM model of
 * tests/fakes/upload/uno-sim.ts; then the uploaded program runs. From the
 * feasibility spike. The quick cases run in the normal suite;
 * the long ones (full 32 KB image, USB latency, abort/recover) in
 * tests-hardware-sim/ (`npm run test:hardware-sim`).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { UnoSim } from './fakes/upload/uno-sim';
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
} from './fakes/upload/scenario';
import type { UploadRun } from './fakes/upload/scenario';
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

test('Arduino-core sketch 01_blink_red: A1 blinks at 500 ms, prints ON/OFF', async () => {
  const hex = readText(fixture('01_blink_red.hex'));
  const sim = newOptibootUno();
  sim.runForMs(200);
  const run = await runUpload(sim, hex);
  const s = summary(sim, run, hex);
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(s.flashVsHex.mismatches, 0);
  sim.runForMs(1700);
  const a1 = edgesMs(sim, 'C', 1, run.endCycle);
  assert.ok(a1.length >= 3);
  const periods = a1.slice(1).map((e, i) => e.ms - a1[i].ms);
  assert.ok(periods.every((p) => Math.abs(p - 500) < 2), `500 ms: ${periods}`);
  assert.match(avrTextSince(sim, run.endCycle), /^ON\r\nOFF\r\nON\r\n/);
});

test('too-large program: refused before any reset', async () => {
  const sim = newOptibootUno();
  sim.runForMs(50);
  const run = await runUpload(sim, readText(fixture('toolarge32257.hex')));
  assert.ok(run.error instanceof UploadError && run.error.code === 'TOO_LARGE');
  assert.equal(sim.stats.resets.length, 1); // power-on only
  assert.equal(sim.stats.hostBytesSent, 0);
});

test('57600 fallback against the old ATmegaBOOT (Nano "old bootloader")', async () => {
  const boot = readText(ATMEGABOOT_HEX_PATH);
  const sim = new UnoSim({ bootloaderHex: boot, bootStart: 0x7800 });
  sim.powerOn();
  sim.runForMs(200);
  const hex = readText(fixture('blink.hex'));
  const run = await runUpload(sim, hex);
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(run.result!.baud, 57600);
  assert.deepEqual(run.result!.bootloaderVersion, { major: 1, minor: 16 });
  assert.equal(compareFlash(sim, hex).mismatches, 0);
  sim.runForMs(2000);
  const a1 = edgesMs(sim, 'C', 1, run.endCycle);
  assert.ok(a1.length >= 5, 'app runs after the bootloader times out');
});
