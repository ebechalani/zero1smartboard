/**
 * Buzzer sound: a WebAudio square-wave oscillator that follows the frequency
 * reported by the buzzer peripheral. The AudioContext is created on the first
 * user gesture (browsers refuse to play sound before one).
 */

/** localStorage key remembering the mute checkbox. */
export const MUTE_STORAGE_KEY = 'z1.mute';

export interface BuzzerAudio {
  /** Call every frame with `buzzer.state.freq` (null = silent). */
  update(freq: number | null): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Stop the oscillator and release the AudioContext. */
  dispose(): void;
}

export interface BuzzerAudioOptions {
  /** Output gain while sounding (default 0.05, deliberately quiet). */
  gain?: number;
  muted?: boolean;
}

const DEFAULT_GAIN = 0.05;
/** Seconds for gain/frequency ramps, short enough to keep beeps crisp but avoid clicks. */
const RAMP_S = 0.004;

/**
 * Create the buzzer audio output. Safe to call in environments without
 * WebAudio (it then does nothing).
 */
export function createBuzzerAudio(options: BuzzerAudioOptions = {}): BuzzerAudio {
  const gainLevel = options.gain ?? DEFAULT_GAIN;
  let muted = options.muted ?? false;
  let ctx: AudioContext | null = null;
  let osc: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let wantedFreq: number | null = null;
  let appliedFreq: number | null = null;
  let appliedGain = 0;

  const AudioContextCtor: typeof AudioContext | undefined =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;

  function ensureContext(): void {
    if (ctx || !AudioContextCtor) return;
    try {
      ctx = new AudioContextCtor();
      osc = ctx.createOscillator();
      osc.type = 'square';
      gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      apply();
    } catch {
      ctx = null;
      osc = null;
      gain = null;
    }
  }

  function apply(): void {
    if (!ctx || !osc || !gain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const targetGain = wantedFreq !== null && !muted ? gainLevel : 0;
    if (wantedFreq !== null && wantedFreq !== appliedFreq) {
      osc.frequency.setTargetAtTime(wantedFreq, now, RAMP_S);
      appliedFreq = wantedFreq;
    }
    if (targetGain !== appliedGain) {
      gain.gain.setTargetAtTime(targetGain, now, RAMP_S);
      appliedGain = targetGain;
    }
  }

  const gestureEvents = ['pointerdown', 'keydown', 'touchstart'] as const;
  const onGesture = (): void => {
    ensureContext();
    if (ctx) removeGestureListeners();
  };
  function removeGestureListeners(): void {
    for (const ev of gestureEvents) document.removeEventListener(ev, onGesture);
  }
  if (typeof document !== 'undefined' && AudioContextCtor) {
    for (const ev of gestureEvents) document.addEventListener(ev, onGesture, { passive: true });
  }

  return {
    update(freq) {
      const next = freq !== null && Number.isFinite(freq) && freq > 0 ? Math.min(freq, 20000) : null;
      if (next === wantedFreq) return;
      wantedFreq = next;
      apply();
    },
    setMuted(m) {
      muted = m;
      apply();
    },
    isMuted: () => muted,
    dispose() {
      removeGestureListeners();
      osc?.stop();
      void ctx?.close();
      ctx = null;
      osc = null;
      gain = null;
    },
  };
}

/** Read the remembered mute state (default: not muted). */
export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember the mute state for the next visit. */
export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Storage unavailable: nothing to remember.
  }
}
