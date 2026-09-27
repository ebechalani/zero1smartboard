/**
 * A fake W3C Web Serial `SerialPort` whose other end is the emulated UNO, paced in REAL time
 * (the emulator is advanced from a 1 ms interval to match performance.now()). Lets the
 * browser adapter (src/webserial.ts) run unmodified — real setTimeout timeouts, WHATWG
 * streams, reader/writer locking, close()/open() for baud changes — against real Optiboot.
 *
 * Signal semantics modelled on Linux/macOS: open() asserts DTR+RTS (tty open with HUPCL),
 * close() drops them. Both are assumptions to re-check on real Windows/macOS hardware.
 */
import type { WebSerialOpenOptions, WebSerialPortLike } from '../../../src/upload/serial/webserial';
import type { UnoSim } from './uno-sim';

export class RealtimeSimSerialPort implements WebSerialPortLike {
  private isOpen = false;
  private stream: ReadableStream<Uint8Array> | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private ws: WritableStream<Uint8Array> | null = null;
  private timer: ReturnType<typeof setInterval>;
  private wall0 = performance.now();
  private sim0: number;
  opens = 0;
  /** Max simulated lag behind wall time observed (ms). */
  maxLagMs = 0;
  /** Set to make open() fail like Chrome does when another program holds the port. */
  failOpenWith: DOMException | null = null;

  constructor(
    readonly sim: UnoSim,
    readonly options: { dtrOnOpen?: boolean } = {},
  ) {
    this.sim0 = sim.now;
    this.timer = setInterval(() => this.pump(), 1);
  }

  private pump(): void {
    const target = this.sim0 + ((performance.now() - this.wall0) * this.sim.freq) / 1000;
    const cap = this.sim.now + this.sim.ms(20); // keep the event loop responsive
    this.sim.runUntil(Math.min(target, cap));
    this.maxLagMs = Math.max(this.maxLagMs, ((target - this.sim.now) / this.sim.freq) * 1000);
    const rx = this.sim.hostTakeRx();
    if (rx.length && this.controller) this.controller.enqueue(rx);
  }

  get readable(): ReadableStream<Uint8Array> | null {
    if (!this.isOpen) return null;
    if (!this.stream) {
      this.stream = new ReadableStream<Uint8Array>({
        start: (c) => {
          this.controller = c;
        },
        cancel: () => {
          this.controller = null;
          this.stream = null;
        },
      });
    }
    return this.stream;
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.isOpen ? this.ws : null;
  }

  async open(o: WebSerialOpenOptions): Promise<void> {
    if (this.failOpenWith) throw this.failOpenWith;
    if (this.isOpen) throw new DOMException('The port is already open.', 'InvalidStateError');
    this.opens++;
    this.sim.hostBaud = o.baudRate;
    this.isOpen = true;
    this.ws = new WritableStream<Uint8Array>({ write: (chunk) => this.sim.hostWrite(chunk) });
    if (this.options.dtrOnOpen ?? true) this.sim.setDTR(true);
  }

  async close(): Promise<void> {
    if (this.stream?.locked || this.ws?.locked) throw new TypeError('Cannot close a locked stream');
    this.stream = null;
    this.controller = null;
    this.ws = null;
    this.isOpen = false;
    this.sim.setDTR(false);
  }

  async setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
    if (!this.isOpen) throw new DOMException('The port is closed.', 'InvalidStateError');
    if (s.dataTerminalReady !== undefined) this.sim.setDTR(s.dataTerminalReady);
  }

  /** Simulate the USB device vanishing (cable pulled): readable errors, port unusable. */
  unplug(): void {
    this.controller?.error(new DOMException('The device has been lost.', 'NetworkError'));
    this.controller = null;
    this.stream = null;
    this.isOpen = false;
    this.ws = null;
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
