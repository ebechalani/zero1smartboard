/**
 * Upload an Intel HEX sketch to an Arduino UNO (ATmega328P + Optiboot) over a serial port.
 *
 * Sequence (mirrors avrdude -c arduino, see README for sources):
 *   1. parse + size-check the hex BEFORE touching the port
 *   2. reset: DTR/RTS off, 250 ms, DTR/RTS on (the falling DTR# edge pulses RESET through the
 *      UNO's 100 nF cap), 100 ms  — avrdude arduino_open() (6.3 waits 50 ms, 7.x/8.x 100 ms)
 *   3. drain stale input (e.g. Serial.print output of the old sketch)
 *   4. GET_SYNC (0x30 0x20 → 0x14 0x10), one request in flight at a time, 500 ms per try,
 *      confirmed by a second clean round trip; re-reset and retry; then fall back to 57600
 *   5. GET_PARAMETER major/minor (bootloader version), READ_SIGN (1E 95 0F), ENTER_PROGMODE
 *   6. per 128-byte page: LOAD_ADDRESS (word address, LE) + PROG_PAGE ('d', len BE, 'F', data)
 *   7. verify: per page LOAD_ADDRESS + READ_PAGE ('t') and compare
 *   8. LEAVE_PROGMODE ('Q') → Optiboot arms a 16 ms watchdog and the sketch starts
 */
import { parseIntelHex, hexToImage, HexParseError } from './intelhex';
import type { ParsedHex } from './intelhex';
import { UploadError, MESSAGES, hexBytes } from './errors';
import { Stk500Client, STK } from './stk500';
import type { TraceFn } from './stk500';
import type { Clock, UploadPort } from './port';
import { realClock } from './port';

export type UploadPhase = 'connect' | 'write' | 'verify' | 'done';

export interface UploadProgress {
  phase: UploadPhase;
  message: string;
  /** Bytes done / total in the current phase (0/0 during connect). */
  done: number;
  total: number;
  /** Overall progress 0..100 (connect 0-5, write 5-60, verify 60-100 — or 5-100 without verify). */
  percent: number;
  baud?: number;
}

export interface UploadTiming {
  /** avrdude: serial_set_dtr_rts(0) then usleep(250 ms) — lets the reset capacitor recharge. */
  signalsOffMs: number;
  /** avrdude 6.3 waits 50 ms after setting DTR/RTS, avrdude 7/8 100 ms. We use 100 ms: the UNO's AVR
   *  only enables its UART ~66 ms after the reset edge (1 ms pulse + 65 ms start-up, lfuse 0xFF), so a
   *  sync sent at 50 ms (+ drain) can be lost; Optiboot cannot answer before ~440 ms anyway. */
  afterResetMs: number;
  /** Quiet time for draining stale bytes after reset. */
  drainQuietMs: number;
  /** Wait for a sync reply. Must be longer than Optiboot's "deaf" LED-flash window (≈375 ms on the UNO build) so
   *  at most one 0x30 0x20 pair is ever queued in the 2-byte USART FIFO. */
  syncTimeoutMs: number;
  /** Sync tries per reset. */
  syncAttemptsPerReset: number;
  /** Resets per baud rate. */
  resetsPerBaud: number;
  /** Timeout for every other command (a page write takes ~12 ms on the wire + ≤4.5 ms of flash programming). */
  commandTimeoutMs: number;
}

export const DEFAULT_TIMING: UploadTiming = {
  signalsOffMs: 250,
  afterResetMs: 100,
  drainQuietMs: 20,
  syncTimeoutMs: 500,
  syncAttemptsPerReset: 2,
  resetsPerBaud: 2,
  commandTimeoutMs: 1000,
};

/** ATmega328P */
export const ATMEGA328P_SIGNATURE = [0x1e, 0x95, 0x0f] as const;

export interface UploadOptions {
  clock?: Clock;
  signal?: AbortSignal;
  onProgress?: (p: UploadProgress) => void;
  log?: (line: string) => void;
  trace?: TraceFn;
  /** Baud rates to try, in order. The port must already be open at baudRates[0]. Default [115200, 57600]. */
  baudRates?: number[];
  verify?: boolean;
  /** null disables the check. */
  expectedSignature?: readonly number[] | null;
  pageSize?: number;
  /**
   * Flash bytes available for the sketch. Default: decided from the bootloader version —
   * Optiboot (major ≥ 4, 512-byte boot section) → 32256 (= uno.upload.maximum_size);
   * older ATmegaBOOT (2 KiB boot section, 57600 baud "old bootloader") → 30720.
   */
  maxSize?: number;
  timing?: Partial<UploadTiming>;
  /** Skip the DTR/RTS reset (for boards reset by hand). */
  noReset?: boolean;
}

export interface UploadResult {
  baud: number;
  signature: number[] | null;
  bootloaderVersion: { major: number; minor: number } | null;
  bytesInHex: number;
  pagesWritten: number;
  bytesWritten: number;
  bytesVerified: number;
  syncAttempts: number;
  resets: number;
  ms: { connect: number; write: number; verify: number; total: number };
}

const OPTIBOOT_MAX = 32256; // 0x7E00, boards.txt uno.upload.maximum_size
const ATMEGABOOT_MAX = 30720; // 0x7800, boards.txt nano.menu.cpu.atmega328old.upload.maximum_size

/** Parse and upload Intel HEX text. */
export async function uploadHex(port: UploadPort, hexText: string, opts: UploadOptions = {}): Promise<UploadResult> {
  let hex: ParsedHex;
  try {
    hex = parseIntelHex(hexText);
  } catch (e) {
    if (e instanceof HexParseError) {
      throw new UploadError(e.code, `The compiled program (.hex) is damaged: ${e.message}`, { line: e.line }, { cause: e });
    }
    throw e;
  }
  return uploadParsed(port, hex, opts);
}

export async function uploadParsed(port: UploadPort, hex: ParsedHex, opts: UploadOptions = {}): Promise<UploadResult> {
  try {
    return await doUpload(port, hex, opts);
  } catch (e) {
    if (e instanceof UploadError) {
      if (opts.signal?.aborted && e.code !== 'ABORTED') throw new UploadError('ABORTED', MESSAGES.aborted, {}, { cause: e });
      throw e;
    }
    if (opts.signal?.aborted) throw new UploadError('ABORTED', MESSAGES.aborted, {}, { cause: e });
    // write()/setSignals()/setBaud() failures: cable pulled, port closed by someone else…
    throw new UploadError('PORT', `Lost the connection to the board: ${(e as Error)?.message ?? String(e)}`, {}, { cause: e });
  }
}

async function doUpload(port: UploadPort, hex: ParsedHex, opts: UploadOptions): Promise<UploadResult> {
  const clock = opts.clock ?? realClock;
  const t: UploadTiming = { ...DEFAULT_TIMING, ...opts.timing };
  const pageSize = opts.pageSize ?? 128;
  const baudRates = opts.baudRates ?? [115200, 57600];
  const verify = opts.verify ?? true;
  const expectedSig = opts.expectedSignature === undefined ? ATMEGA328P_SIGNATURE : opts.expectedSignature;
  const log = opts.log ?? (() => {});
  const progress = (p: UploadProgress) => opts.onProgress?.(p);

  // ---- 1. size checks before touching the board ------------------------------------------
  if (hex.dataBytes === 0) throw new UploadError('HEX_PARSE', 'The compiled program (.hex) contains no data.');
  if (hex.minAddress < 0) throw new UploadError('HEX_PARSE', 'Bad address in .hex');
  const hardMax = opts.maxSize ?? OPTIBOOT_MAX;
  if (hex.maxAddress > hardMax) {
    throw new UploadError('TOO_LARGE', MESSAGES.tooLarge(hex.maxAddress, hardMax), { size: hex.maxAddress, max: hardMax });
  }
  // Always program whole pages, padded with 0xFF: Optiboot 4.4 ignores the length's high byte and
  // always copies SPM_PAGESIZE bytes from its RAM buffer, so a short last page would get stale bytes.
  const end = Math.ceil(hex.maxAddress / pageSize) * pageSize;
  const image = hexToImage(hex, end, 0xff);
  const firstPage = Math.floor(hex.minAddress / pageSize) * pageSize; // avrdude writes from the first page with data
  const pages: number[] = [];
  for (let a = firstPage; a < end; a += pageSize) pages.push(a);
  const totalBytes = pages.length * pageSize;

  const client = new Stk500Client(port, clock, opts.signal, opts.trace);
  const t0 = clock.now();
  const pct = (phase: UploadPhase, done: number, total: number) => {
    if (phase === 'connect') return 0;
    if (phase === 'done') return 100;
    const w0 = 5,
      w1 = verify ? 60 : 100;
    if (phase === 'write') return w0 + ((w1 - w0) * done) / Math.max(1, total);
    return 60 + (40 * done) / Math.max(1, total);
  };

  // ---- 2-4. reset + sync, with baud fallback ----------------------------------------------
  progress({ phase: 'connect', message: 'Connecting to the board…', done: 0, total: 0, percent: 0 });
  let baud = 0;
  let syncAttempts = 0;
  let resets = 0;
  let anyBytes = false;
  const garbage: number[] = [];
  let currentBaud = baudRates[0];
  // Rounds are interleaved (115200, 57600, 115200, 57600) so an old-bootloader board does not
  // wait for every 115200 retry first.
  syncLoop: for (let r = 0; r < t.resetsPerBaud; r++) {
    for (const b of baudRates) {
      if (b !== currentBaud) {
        if (!port.setBaud) {
          log(`port cannot change baud rate; not trying ${b}`);
          continue;
        }
        log(`switching to ${b} baud`);
        await port.setBaud(b);
        currentBaud = b;
      }
      client.checkAbort();
      if (!opts.noReset) {
        await resetBoard(port, clock, t, opts.signal);
        resets++;
      }
      const stale = await client.drain(t.drainQuietMs, 1000);
      if (stale.length) log(`drained ${stale.length} stale byte(s): ${hexBytes(stale)}`);
      for (let a = 0; a < t.syncAttemptsPerReset; a++) {
        syncAttempts++;
        const { ok, seen } = await client.syncOnce(t.syncTimeoutMs);
        if (seen.length) {
          anyBytes = true;
          if (!ok && garbage.length < 64) garbage.push(...seen.slice(0, 64 - garbage.length));
        }
        log(`sync @${b} reset ${r + 1} try ${a + 1}: ${ok ? 'in sync' : seen.length ? 'got ' + hexBytes(seen) : 'no answer'}`);
        if (!ok) continue;
        // Confirm: flush anything queued (a late duplicate reply), then one more clean round trip.
        await client.drain(t.drainQuietMs, 200);
        const again = await client.syncOnce(t.syncTimeoutMs);
        syncAttempts++;
        if (again.ok && again.seen.length === 2) {
          baud = b;
          break syncLoop;
        }
        log(`sync confirmation failed: ${hexBytes(again.seen)}`);
      }
    }
  }
  if (!baud) {
    if (!anyBytes) throw new UploadError('NO_ANSWER', MESSAGES.noAnswer, { baudRates, syncAttempts, resets });
    throw new UploadError('NOT_IN_SYNC', MESSAGES.notInSync(describeBytes(garbage)), { baudRates, syncAttempts, resets, received: garbage });
  }

  // ---- 5. identify ---------------------------------------------------------------------------
  const major = await client.getParameter(STK.PARM_SW_MAJOR, t.commandTimeoutMs);
  const minor = await client.getParameter(STK.PARM_SW_MINOR, t.commandTimeoutMs);
  const version = { major, minor };
  log(`bootloader version ${major}.${minor}`);
  const maxSize = opts.maxSize ?? (version.major >= 4 ? OPTIBOOT_MAX : ATMEGABOOT_MAX);
  if (hex.maxAddress > maxSize) {
    throw new UploadError('TOO_LARGE', MESSAGES.tooLarge(hex.maxAddress, maxSize), { size: hex.maxAddress, max: maxSize, version });
  }

  let signature: number[] | null = null;
  if (expectedSig !== null) {
    signature = Array.from(await client.readSignature(t.commandTimeoutMs));
    log(`signature ${hexBytes(signature)}`);
    if (signature.some((v, i) => v !== expectedSig[i])) {
      throw new UploadError('SIGNATURE_MISMATCH', MESSAGES.signature(hexBytes(signature), hexBytes(expectedSig)), { signature });
    }
  }
  await client.enterProgMode(t.commandTimeoutMs);
  const tConnected = clock.now();

  // ---- 6. write -------------------------------------------------------------------------------
  let written = 0;
  progress({ phase: 'write', message: 'Writing…', done: 0, total: totalBytes, percent: pct('write', 0, totalBytes), baud });
  for (const addr of pages) {
    await client.loadAddress(addr, t.commandTimeoutMs);
    await client.progPage(image.subarray(addr, addr + pageSize), t.commandTimeoutMs, addr);
    written += pageSize;
    progress({ phase: 'write', message: 'Writing…', done: written, total: totalBytes, percent: pct('write', written, totalBytes), baud });
  }
  const tWritten = clock.now();

  // ---- 7. verify ------------------------------------------------------------------------------
  let verified = 0;
  if (verify) {
    progress({ phase: 'verify', message: 'Checking…', done: 0, total: totalBytes, percent: pct('verify', 0, totalBytes), baud });
    for (const addr of pages) {
      await client.loadAddress(addr, t.commandTimeoutMs);
      const got = await client.readPage(pageSize, t.commandTimeoutMs, addr);
      for (let i = 0; i < pageSize; i++) {
        if (got[i] !== image[addr + i]) {
          throw new UploadError('VERIFY_FAILED', MESSAGES.verify(addr + i, image[addr + i], got[i]), {
            address: addr + i,
            wrote: image[addr + i],
            read: got[i],
          });
        }
      }
      verified += pageSize;
      progress({ phase: 'verify', message: 'Checking…', done: verified, total: totalBytes, percent: pct('verify', verified, totalBytes), baud });
    }
  }
  const tVerified = clock.now();

  // ---- 8. start the sketch ------------------------------------------------------------------
  await client.leaveProgMode(t.commandTimeoutMs);
  const tEnd = clock.now();
  progress({ phase: 'done', message: 'Done', done: totalBytes, total: totalBytes, percent: 100, baud });

  return {
    baud,
    signature,
    bootloaderVersion: version,
    bytesInHex: hex.dataBytes,
    pagesWritten: pages.length,
    bytesWritten: written,
    bytesVerified: verified,
    syncAttempts,
    resets,
    ms: { connect: tConnected - t0, write: tWritten - tConnected, verify: tVerified - tWritten, total: tEnd - t0 },
  };
}

/**
 * Auto-reset, avrdude 6.3 arduino_open(): DTR+RTS cleared, 250 ms, DTR+RTS set, 50 ms.
 * Setting DTR makes the USB-serial chip drive DTR# low; on the UNO that edge goes through a
 * 100 nF capacitor to RESET (10 k pull-up), giving a ~1 ms reset pulse. RTS is toggled too, like
 * avrdude, for boards wired to RTS.
 */
export async function resetBoard(port: UploadPort, clock: Clock, t: UploadTiming = DEFAULT_TIMING, signal?: AbortSignal): Promise<void> {
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  await clock.sleep(t.signalsOffMs, signal);
  await port.setSignals({ dataTerminalReady: true, requestToSend: true });
  await clock.sleep(t.afterResetMs, signal);
}

function describeBytes(bytes: number[]): string {
  if (!bytes.length) return 'nothing';
  const printable = bytes.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127));
  if (printable) {
    const s = String.fromCharCode(...bytes).replace(/\r?\n/g, '⏎');
    return `text "${s.length > 40 ? s.slice(0, 40) + '…' : s}"`;
  }
  return `bytes ${hexBytes(bytes, 12)}`;
}
