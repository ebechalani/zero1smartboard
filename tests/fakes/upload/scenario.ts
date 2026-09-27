/**
 * Shared end-to-end scenario helpers: emulated UNO running the official Optiboot, uploader
 * connected through the co-simulation, and checks on the resulting flash + running app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UnoSim } from './uno-sim';
import type { UnoSimOptions } from './uno-sim';
import { CoSim } from './cosim';
import { uploadHex } from '../../../src/upload/serial/uploader';
import type { UploadOptions, UploadProgress, UploadResult } from '../../../src/upload/serial/uploader';
import { parseIntelHex, hexToImage } from '../../../src/upload/serial/intelhex';

/** tests/fixtures/upload: the official Optiboot 4.4 and ATmegaBOOT binaries (ArduinoCore-avr 1.8.6) + test images. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/upload');
export const OPTIBOOT_HEX_PATH = path.join(ROOT, 'optiboot_atmega328.hex');
export const ATMEGABOOT_HEX_PATH = path.join(ROOT, 'ATmegaBOOT_168_atmega328.hex');
export const fixture = (name: string) => path.join(ROOT, name);
export const readText = (p: string) => fs.readFileSync(p, 'utf8');

export function newOptibootUno(opts: UnoSimOptions = {}): UnoSim {
  const sim = new UnoSim({ bootloaderHex: readText(OPTIBOOT_HEX_PATH), ...opts });
  sim.powerOn();
  return sim;
}

export interface UploadRun {
  result?: UploadResult;
  error?: unknown;
  simMs: number;
  wallMs: number;
  progress: UploadProgress[];
  log: string[];
  startCycle: number;
  endCycle: number;
  instructions: number;
  /** Stale bytes the uploader discarded before syncing. */
  discardedBytes: number;
}

export async function runUpload(sim: UnoSim, hexText: string, opts: UploadOptions = {}, maxSimMs = 120_000): Promise<UploadRun> {
  const co = new CoSim(sim);
  const progress: UploadProgress[] = [];
  const log: string[] = [];
  const startCycle = sim.now;
  const instr0 = sim.stats.instructions;
  const w0 = performance.now();
  let result: UploadResult | undefined;
  let error: unknown;
  try {
    result = await co.run(
      (port, clock) =>
        uploadHex(port, hexText, {
          clock,
          onProgress: (p) => progress.push(p),
          log: (l) => log.push(`[${clock.now().toFixed(1)} ms] ${l}`),
          ...opts,
        }),
      maxSimMs,
    );
  } catch (e) {
    error = e;
  }
  const wallMs = performance.now() - w0;
  const endCycle = sim.now;
  return {
    result,
    error,
    simMs: ((endCycle - startCycle) / sim.freq) * 1000,
    wallMs,
    progress,
    log,
    startCycle,
    endCycle,
    instructions: sim.stats.instructions - instr0,
    discardedBytes: co.discardedBytes,
  };
}

/** Compare the emulated flash with the hex: every programmed page must equal the hex padded with 0xFF. */
export function compareFlash(sim: UnoSim, hexText: string, pageSize = 128) {
  const hex = parseIntelHex(hexText);
  const end = Math.ceil(hex.maxAddress / pageSize) * pageSize;
  const img = hexToImage(hex, end, 0xff);
  let mismatches = 0;
  let firstMismatch = -1;
  for (let i = 0; i < end; i++) {
    if (sim.flashBytes[i] !== img[i]) {
      mismatches++;
      if (firstMismatch < 0) firstMismatch = i;
    }
  }
  return { dataBytes: hex.dataBytes, comparedBytes: end, mismatches, firstMismatch };
}

export function bootSectionMatches(sim: UnoSim, bootHexText: string): boolean {
  const hex = parseIntelHex(bootHexText);
  for (const s of hex.segments) {
    for (let i = 0; i < s.data.length; i++) if (sim.flashBytes[s.address + i] !== s.data[i]) return false;
  }
  return true;
}

export function avrTextSince(sim: UnoSim, fromCycle: number): string {
  return String.fromCharCode(...sim.avrTxLog.filter(([t]) => t >= fromCycle).map(([, b]) => b));
}
