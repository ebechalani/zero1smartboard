/**
 * Emulated Arduino UNO for end-to-end upload tests: avr8js 0.21.1 CPU + peripherals, plus what
 * avr8js does NOT model and a bootloader needs:
 *
 *  - SPM (self-programming): avr8js decodes SPM (0x95E8) as a no-op. We intercept the opcode
 *    before avr8js executes it and implement ATmega328P semantics (datasheet §26/§27 "Boot Loader
 *    Support – Read-While-Write Self-Programming"): SPMCSR @0x57, 4-cycle arming window, page
 *    buffer fill (R1:R0 → temp buffer word Z[6:1]), page erase (PGERS), page write (PGWRT, flash
 *    AND buffer — so a missing erase shows up), RWWSRE, RWWSB busy flag, SPMEN held for the page
 *    programming time, SPM only from the boot section, boot section write-protected (lock bits
 *    0x0F from boards.txt → BLB1 mode 3).
 *  - BOOTRST: reset vector at the boot section (hfuse 0xDE → BOOTSZ=11 → 0x7E00), for power-on,
 *    external (DTR) and watchdog resets. avr8js's CPU.reset() jumps to 0 and keeps I/O state, so a
 *    reset here rebuilds a fresh CPU + peripherals over the same flash.
 *  - MCUSR reset-cause flags (EXTRF for DTR reset, WDRF for watchdog) — Optiboot's
 *    `if (!(MCUSR & EXTRF)) appStart()` depends on them.
 *  - Reset timing: DTR# falling edge → ~1 ms RESET pulse (100 nF / 10 kΩ) → tTOUT 65 ms
 *    (lfuse 0xFF: CKSEL=1111, SUT=11 → 14CK + 65 ms) before the first instruction.
 *  - The serial line at the HOST's baud rate: bytes take 10 bit-times of the host baud, the AVR
 *    receiver has a 2-byte FIFO + shift register, bytes arriving while RXEN=0 (in reset/startup)
 *    are lost, a 4th byte overruns (DOR). A baud mismatch > 4 % garbles bytes and sets FE.
 */
import {
  CPU,
  avrInstruction,
  AVRTimer,
  timer0Config,
  timer1Config,
  timer2Config,
  AVRUSART,
  usart0Config,
  AVRIOPort,
  portBConfig,
  portCConfig,
  portDConfig,
  AVRClock,
  AVRWatchdog,
  watchdogConfig,
} from 'avr8js';
import { parseIntelHex } from '../../../src/upload/serial/intelhex';

const SPMCSR = 0x57;
const SPMEN = 0x01,
  PGERS = 0x02,
  PGWRT = 0x04,
  BLBSET = 0x08,
  RWWSRE = 0x10,
  SIGRD = 0x20,
  RWWSB = 0x40;
const MCUSR = 0x54;
export const PORF = 0x01,
  EXTRF = 0x02,
  BORF = 0x04,
  WDRF = 0x08;
const UCSR0A = usart0Config.UCSRA,
  UCSR0B = usart0Config.UCSRB,
  UDR0 = usart0Config.UDR;
const RXC = 0x80,
  FE = 0x10,
  DOR = 0x08,
  RXEN = 0x10;

export interface UnoSimOptions {
  /** Intel HEX text of the bootloader (placed where its records say, e.g. 0x7E00). */
  bootloaderHex?: string;
  /** Byte address of the boot section / BOOTRST vector. 0x7E00 for the UNO (hfuse 0xDE). */
  bootStart?: number;
  /** Start of the No-Read-While-Write section (ATmega328P: 0x7000). */
  nrwwStart?: number;
  freqHz?: number;
  /** Baud rate the host (CH340) side uses. */
  hostBaud?: number;
  resetPulseMs?: number;
  /** tTOUT after any reset. lfuse 0xFF → 65 ms. */
  startupMs?: number;
  /** Page erase / page write time. Datasheet: 3.7–4.5 ms; we use the max. */
  spmMs?: number;
  /** Extra one-way latency USB ↔ CH340 (0 = ideal). Applied to host writes, host reads and DTR changes. */
  usbLatencyMs?: number;
  /** SPM refuses to erase/write the boot section (lock bits 0x0F). */
  protectBootSection?: boolean;
}

export interface PinEvent {
  t: number; // global cycle
  port: 'B' | 'C' | 'D';
  value: number;
  old: number;
}

/** avr8js keeps these private in its .d.ts; we need them for the line model. */
interface UsartInternals {
  RXC: Parameters<CPU['setInterruptFlag']>[0];
  cyclesPerChar: number;
  UBRR: number;
  multiplier: number;
}

interface Machine {
  cpu: CPU;
  usart: UsartInternals;
  base: number; // global cycle at which this machine's cpu.cycles was 0
  armCycle: number; // cycle SPMCSR was written (arming window start)
  spmBusyUntil: number;
  tempBuf: Uint8Array; // SPM page buffer
  tempWritten: Uint8Array;
}

export class UnoSim {
  readonly flash = new Uint16Array(0x4000); // 32 KiB program memory, shared across resets
  readonly flashBytes = new Uint8Array(this.flash.buffer);
  readonly freq: number;
  readonly bootStart: number;
  readonly nrwwStart: number;
  readonly pageSize = 128;
  hostBaud: number;
  readonly opts: Required<Omit<UnoSimOptions, 'bootloaderHex'>>;

  private m: Machine | null = null;
  private idleNow = 0; // global time while the CPU is held in reset
  private resetUntil = 0;
  private pendingMcusr = PORF;
  private pendingReset: 'WDT' | null = null;
  private dtr = false;

  // host → AVR line
  private h2a: { t: number; b: number }[] = [];
  private h2aHead = 0;
  private lineFreeAt = 0;
  // AVR receiver
  private rxFifo: { b: number; fe: boolean }[] = [];
  private rxShift: { b: number; fe: boolean } | null = null;
  private dorPending = false;
  // AVR → host
  private a2h: { t: number; b: number }[] = [];
  private a2hHead = 0;

  readonly stats = {
    hostBytesSent: 0,
    lostInReset: 0,
    lostRxDisabled: 0,
    overruns: 0,
    garbledByBaud: 0,
    avrBytesSent: 0,
    spm: { pageLoads: 0, pageErases: 0, pageWrites: 0, rwwEnables: 0, ignoredLate: 0, ignoredOutsideBoot: 0, bootWriteBlocked: 0, rwwReadWhileBusy: 0, rwwExecWhileBusy: 0, doubleFill: 0, other: 0 },
    resets: [] as { t: number; cause: string; mcusr: number }[],
    instructions: 0,
  };
  readonly pinEvents: PinEvent[] = [];
  /** Every byte the AVR transmitted: [global cycle, byte]. */
  readonly avrTxLog: [number, number][] = [];

  constructor(options: UnoSimOptions = {}) {
    this.opts = {
      bootStart: 0x7e00,
      nrwwStart: 0x7000,
      freqHz: 16_000_000,
      hostBaud: 115200,
      resetPulseMs: 1,
      startupMs: 65,
      spmMs: 4.5,
      usbLatencyMs: 0,
      protectBootSection: true,
      ...options,
    };
    this.freq = this.opts.freqHz;
    this.bootStart = this.opts.bootStart;
    this.nrwwStart = this.opts.nrwwStart;
    this.hostBaud = this.opts.hostBaud;
    this.flashBytes.fill(0xff);
    if (options.bootloaderHex) {
      const hex = parseIntelHex(options.bootloaderHex);
      for (const s of hex.segments) this.flashBytes.set(s.data, s.address);
    }
  }

  // ---------------------------------------------------------------- time
  get now(): number {
    return this.m ? this.m.base + this.m.cpu.cycles : this.idleNow;
  }
  get nowMs(): number {
    return (this.now / this.freq) * 1000;
  }
  ms(ms: number): number {
    return (ms * this.freq) / 1000;
  }
  get running(): boolean {
    return this.m !== null;
  }
  get cpu(): CPU | null {
    return this.m?.cpu ?? null;
  }

  // ---------------------------------------------------------------- reset
  /** Power-on: CPU starts after tTOUT with MCUSR=PORF. */
  powerOn(): void {
    this.holdReset(PORF, 'power-on', 0);
  }

  private holdReset(flags: number, cause: string, pulseCycles: number): void {
    const t = this.now;
    const mcusr = (this.m ? this.m.cpu.data[MCUSR] : this.pendingMcusr) | flags;
    this.m = null;
    this.idleNow = t;
    this.resetUntil = t + pulseCycles + this.ms(this.opts.startupMs);
    this.pendingMcusr = mcusr;
    this.rxFifo = [];
    this.rxShift = null;
    this.dorPending = false;
    this.stats.resets.push({ t, cause, mcusr });
  }

  private startMachine(): void {
    const cpu = new CPU(this.flash, 2048); // ATmega328P: 2 KiB SRAM → RAMEND 0x8FF
    const clock = new AVRClock(cpu, this.freq);
    new AVRTimer(cpu, timer0Config);
    new AVRTimer(cpu, timer1Config);
    new AVRTimer(cpu, timer2Config);
    const usart = new AVRUSART(cpu, usart0Config, this.freq);
    const ports = { B: new AVRIOPort(cpu, portBConfig), C: new AVRIOPort(cpu, portCConfig), D: new AVRIOPort(cpu, portDConfig) };
    new AVRWatchdog(cpu, watchdogConfig, clock);
    const m: Machine = {
      cpu,
      usart: usart as unknown as UsartInternals,
      base: this.resetUntil,
      armCycle: -100,
      spmBusyUntil: 0,
      tempBuf: new Uint8Array(this.pageSize).fill(0xff),
      tempWritten: new Uint8Array(this.pageSize / 2),
    };
    cpu.data[MCUSR] = this.pendingMcusr;
    cpu.pc = this.bootStart >> 1; // BOOTRST programmed
    // Intercept the watchdog's system reset (avr8js calls cpu.reset() then ORs WDRF into MCUSR).
    (cpu as unknown as { reset: () => void }).reset = () => {
      this.pendingReset = 'WDT';
    };
    // SPMCSR: remember when it was armed; RWWSB is read-only.
    cpu.writeHooks[SPMCSR] = (value) => {
      const keep = cpu.data[SPMCSR] & RWWSB;
      if (cpu.data[SPMCSR] & SPMEN && m.spmBusyUntil > this.now) {
        // Writes while an erase/write is in progress are ignored.
        return true;
      }
      cpu.data[SPMCSR] = keep | (value & 0xbf);
      m.armCycle = cpu.cycles;
      if (value & SPMEN) {
        // Hardware clears the command bits if no SPM follows within 4 cycles.
        cpu.addClockEvent(() => {
          if (cpu.cycles - m.armCycle >= 4 && !(m.spmBusyUntil > this.now)) {
            cpu.data[SPMCSR] &= ~(SPMEN | PGERS | PGWRT | BLBSET | RWWSRE | SIGRD);
          }
        }, 5);
      }
      return true;
    };
    // Our receiver model replaces avr8js's single-byte one.
    cpu.readHooks[UDR0] = () => this.readUdr(m);
    // avr8js's UCSR0A write hook clears RXC/FE/DOR in the register image; on silicon they are
    // read-only, so re-apply them from our FIFO after every write.
    // Same for UDRE (read-only on silicon): without this, a program that writes UCSR0A while the
    // transmitter is already enabled (e.g. a sketch started by a bootloader's jump, not a reset)
    // waits forever for UDRE.
    const ucsraHook = cpu.writeHooks[UCSR0A];
    cpu.writeHooks[UCSR0A] = (value, old, addr, mask) => {
      const udre = cpu.data[UCSR0A] & 0x20;
      const r = ucsraHook(value, old, addr, mask);
      cpu.data[UCSR0A] |= udre;
      this.updateRxFlags(m);
      return r;
    };
    usart.onByteTransmit = (b) => this.avrTransmit(m, b);
    for (const [name, port] of Object.entries(ports)) {
      port.addListener((value, old) => this.pinEvents.push({ t: this.now, port: name as 'B' | 'C' | 'D', value, old }));
    }
    this.m = m;
  }

  /** DTR as seen by the host API: true = asserted = DTR# pin low. Assert edge resets the AVR. */
  setDTR(asserted: boolean): void {
    if (asserted && !this.dtr) {
      this.holdReset(EXTRF, 'DTR', this.ms(this.opts.resetPulseMs));
    }
    this.dtr = asserted;
  }

  // ---------------------------------------------------------------- serial line
  private get avrBaud(): number {
    if (!this.m) return 0;
    const u = this.m.usart;
    return this.freq / (u.multiplier * (u.UBRR + 1));
  }
  private baudMismatch(): boolean {
    const a = this.avrBaud;
    return a > 0 && Math.abs(this.hostBaud / a - 1) > 0.04;
  }

  /** Host writes bytes: they go on the wire back-to-back at the host baud rate. */
  hostWrite(bytes: ArrayLike<number>): void {
    const bitCycles = this.freq / this.hostBaud;
    let t = Math.max(this.now + this.ms(this.opts.usbLatencyMs), this.lineFreeAt);
    for (let i = 0; i < bytes.length; i++) {
      t += 10 * bitCycles; // start + 8 data + stop
      this.h2a.push({ t, b: bytes[i] & 0xff });
      this.stats.hostBytesSent++;
    }
    this.lineFreeAt = t;
  }

  private deliverDueRx(): void {
    const now = this.now;
    while (this.h2aHead < this.h2a.length && this.h2a[this.h2aHead].t <= now) {
      const { b } = this.h2a[this.h2aHead++];
      this.receiveByte(b);
    }
    if (this.h2aHead > 1024 && this.h2aHead === this.h2a.length) {
      this.h2a = [];
      this.h2aHead = 0;
    }
  }

  private receiveByte(b: number): void {
    const m = this.m;
    if (!m) {
      this.stats.lostInReset++;
      return;
    }
    if (!(m.cpu.data[UCSR0B] & RXEN)) {
      this.stats.lostRxDisabled++;
      return;
    }
    let fe = false;
    if (this.baudMismatch()) {
      b = (b * 0x9d + 0x3b) & 0xff;
      fe = true;
      this.stats.garbledByBaud++;
    }
    const entry = { b, fe };
    if (this.rxFifo.length < 2) this.rxFifo.push(entry);
    else if (!this.rxShift) this.rxShift = entry;
    else {
      // Buffer full, a character waiting in the shift register and a new start bit → Data OverRun.
      this.stats.overruns++;
      this.dorPending = true;
      this.rxShift = entry;
    }
    this.updateRxFlags(m);
  }

  private updateRxFlags(m: Machine): void {
    const d = m.cpu.data;
    const head = this.rxFifo[0];
    d[UCSR0A] = (d[UCSR0A] & ~(FE | DOR)) | (head?.fe ? FE : 0) | (this.dorPending && head ? DOR : 0);
    if (head) m.cpu.setInterruptFlag(m.usart.RXC);
    else m.cpu.clearInterrupt(m.usart.RXC);
  }

  private readUdr(m: Machine): number {
    const head = this.rxFifo.shift();
    if (this.rxShift && this.rxFifo.length < 2) {
      this.rxFifo.push(this.rxShift);
      this.rxShift = null;
    }
    if (head) this.dorPending = false;
    this.updateRxFlags(m);
    return head ? head.b : 0;
  }

  private avrTransmit(m: Machine, b: number): void {
    const t = this.now + m.usart.cyclesPerChar + this.ms(this.opts.usbLatencyMs);
    this.avrTxLog.push([this.now, b]);
    this.stats.avrBytesSent++;
    if (this.baudMismatch()) {
      b = (b * 0x3b + 0x9d) & 0xff;
      this.stats.garbledByBaud++;
    }
    this.a2h.push({ t, b });
  }

  /** Bytes that have reached the host by now. */
  hostRxAvailable(): number {
    const now = this.now;
    let n = 0;
    for (let i = this.a2hHead; i < this.a2h.length && this.a2h[i].t <= now; i++) n++;
    return n;
  }
  hostTakeRx(): Uint8Array {
    const now = this.now;
    const out: number[] = [];
    while (this.a2hHead < this.a2h.length && this.a2h[this.a2hHead].t <= now) out.push(this.a2h[this.a2hHead++].b);
    if (this.a2hHead > 1024 && this.a2hHead === this.a2h.length) {
      this.a2h = [];
      this.a2hHead = 0;
    }
    return Uint8Array.from(out);
  }
  private nextHostArrival(): number {
    return this.a2hHead < this.a2h.length ? this.a2h[this.a2hHead].t : Infinity;
  }

  // ---------------------------------------------------------------- SPM
  private spm(m: Machine): void {
    const cpu = m.cpu;
    const d = cpu.data;
    const cmd = d[SPMCSR];
    const s = this.stats.spm;
    if (!(cmd & SPMEN)) return;
    if (cpu.cycles - m.armCycle > 4) {
      s.ignoredLate++;
      return;
    }
    if (cpu.pc * 2 < this.bootStart) {
      s.ignoredOutsideBoot++;
      return;
    }
    const z = d[30] | (d[31] << 8);
    const page = z & ~(this.pageSize - 1) & 0x7fff;
    const op = cmd & (PGERS | PGWRT | BLBSET | RWWSRE | SIGRD);
    const busy = (cycles: number) => {
      m.spmBusyUntil = this.now + cycles;
      cpu.addClockEvent(() => {
        d[SPMCSR] &= ~(SPMEN | PGERS | PGWRT);
      }, cycles);
      if (page < this.nrwwStart) d[SPMCSR] |= RWWSB;
      else cpu.cycles += cycles; // CPU halted while programming the NRWW section
    };
    const tProg = Math.round(this.ms(this.opts.spmMs));
    switch (op) {
      case 0: {
        // Fill temporary page buffer with R1:R0 at word Z[6:1].
        const w = (z & (this.pageSize - 1)) >> 1;
        if (m.tempWritten[w]) s.doubleFill++;
        m.tempWritten[w] = 1;
        m.tempBuf[w * 2] = d[0];
        m.tempBuf[w * 2 + 1] = d[1];
        s.pageLoads++;
        d[SPMCSR] &= ~SPMEN;
        return;
      }
      case PGERS:
        if (this.opts.protectBootSection && page >= this.bootStart) {
          s.bootWriteBlocked++;
          d[SPMCSR] &= ~(SPMEN | PGERS);
          return;
        }
        this.flashBytes.fill(0xff, page, page + this.pageSize);
        s.pageErases++;
        busy(tProg);
        return;
      case PGWRT:
        if (this.opts.protectBootSection && page >= this.bootStart) {
          s.bootWriteBlocked++;
          d[SPMCSR] &= ~(SPMEN | PGWRT);
          return;
        }
        for (let i = 0; i < this.pageSize; i++) this.flashBytes[page + i] &= m.tempBuf[i]; // flash bits only go 1→0
        m.tempBuf.fill(0xff);
        m.tempWritten.fill(0);
        s.pageWrites++;
        busy(tProg);
        return;
      case RWWSRE:
        if (m.spmBusyUntil > this.now) {
          s.other++;
          return;
        }
        d[SPMCSR] &= ~(RWWSB | SPMEN | RWWSRE);
        m.tempBuf.fill(0xff);
        m.tempWritten.fill(0);
        s.rwwEnables++;
        return;
      default:
        s.other++;
        d[SPMCSR] &= ~(SPMEN | op);
    }
  }

  // ---------------------------------------------------------------- run
  /**
   * Run until global cycle `target`. If `stopOnHostRx`, return as soon as a byte reaches the host.
   * Returns the number of instructions executed.
   */
  runUntil(target: number, stopOnHostRx = false): number {
    let n = 0;
    const flash = this.flash;
    for (;;) {
      if (this.h2aHead < this.h2a.length && this.h2a[this.h2aHead].t <= this.now) this.deliverDueRx();
      if (stopOnHostRx && this.nextHostArrival() <= this.now) break;
      if (this.now >= target) break;
      const m = this.m;
      if (!m) {
        // Held in reset: skip ahead to the next interesting moment.
        const nextRx = this.h2aHead < this.h2a.length ? this.h2a[this.h2aHead].t : Infinity;
        const nextHost = stopOnHostRx ? this.nextHostArrival() : Infinity;
        const next = Math.min(target, this.resetUntil, Math.max(nextRx, this.idleNow), Math.max(nextHost, this.idleNow));
        this.idleNow = Math.max(this.idleNow, next);
        if (this.idleNow >= this.resetUntil) this.startMachine();
        continue;
      }
      const cpu = m.cpu;
      const op = flash[cpu.pc];
      const d = cpu.data;
      if (d[SPMCSR] & RWWSB) {
        if (cpu.pc * 2 < this.nrwwStart) this.stats.spm.rwwExecWhileBusy++;
        if (op === 0x95c8 || (op & 0xfe0e) === 0x9004) {
          const z = d[30] | (d[31] << 8);
          if (z < this.nrwwStart) this.stats.spm.rwwReadWhileBusy++;
        }
      }
      if (op === 0x95e8) this.spm(m);
      avrInstruction(cpu);
      cpu.tick();
      n++;
      if (this.pendingReset) {
        this.pendingReset = null;
        // avr8js has already ORed WDRF into MCUSR.
        this.holdReset(WDRF, 'watchdog', 0);
      }
    }
    this.stats.instructions += n;
    return n;
  }

  runForMs(ms: number): void {
    this.runUntil(this.now + this.ms(ms));
  }

  // ---------------------------------------------------------------- helpers for tests
  /** Load an application image directly into flash (as if programmed by ISP). */
  loadApp(bytes: Uint8Array, at = 0): void {
    this.flashBytes.set(bytes, at);
  }
  pinLevel(port: 'B' | 'C' | 'D', bit: number, atCycle = Infinity): number {
    let v = 0;
    for (const e of this.pinEvents) {
      if (e.t > atCycle) break;
      if (e.port === port) v = (e.value >> bit) & 1;
    }
    return v;
  }
  /** Edges (level changes) of one pin since `fromCycle`. */
  pinEdges(port: 'B' | 'C' | 'D', bit: number, fromCycle = 0): { t: number; level: number }[] {
    const out: { t: number; level: number }[] = [];
    for (const e of this.pinEvents) {
      if (e.port !== port || e.t < fromCycle) continue;
      const a = (e.old >> bit) & 1,
        b = (e.value >> bit) & 1;
      if (a !== b) out.push({ t: e.t, level: b });
    }
    return out;
  }
}
