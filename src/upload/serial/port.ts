/**
 * The two things the uploader needs from its environment, kept injectable so the same
 * protocol code runs against Web Serial in the browser, a fake port in unit tests, and
 * an emulated ATmega328P (avr8js + the real Optiboot binary) in the end-to-end test.
 */

export interface SerialSignals {
  /** true = asserted. On a CH340/16U2 UNO, asserting DTR drives the DTR# pin low → reset pulse through the 100 nF cap. */
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
}

export interface UploadPort {
  /** Queue bytes for transmission. Resolves once the bytes are handed to the port. */
  write(bytes: Uint8Array): Promise<void>;
  /**
   * Resolve with the next chunk of received bytes (length ≥ 1), or `null` if nothing arrives
   * within `timeoutMs`. Bytes received earlier and not yet read are returned first.
   * Implementations should reject promptly if `signal` aborts.
   */
  read(timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array | null>;
  /** Set the modem-control outputs (Web Serial: SerialPort.setSignals). */
  setSignals(signals: SerialSignals): Promise<void>;
  /** Optional: switch baud rate (Web Serial must close + reopen the port). */
  setBaud?(baud: number): Promise<void>;
  /** Optional: throw away bytes already received but not yet read. */
  discardInput?(): void;
}

/** Time source + sleep. Real time in the browser; simulated time in the emulator test. */
export interface Clock {
  now(): number; // milliseconds
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(abortReason(signal));
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(abortReason(signal!));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The upload was cancelled', 'AbortError');
}
