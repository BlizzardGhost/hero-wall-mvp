/**
 * Path: src/scripts/chiptune-audio.ts
 * Purpose: Zero-dependency procedural Web Audio API 8-bit chiptune synthesizer
 *          providing RPG footsteps, SNES dialogue typewriter blips, confirm/cancel
 *          menu chimes, zone arrival arpeggios, White Dog bark chime, treasure chest
 *          fanfare, and HUD toggle ticks with 0 KB external audio assets.
 * Spec Reference: SPEC-021 (021-hero-wall-full-game-overworld)
 *
 * Debug Operator Notes:
 * - Set `window.__RASS_OVERWORLD_DEBUG__ = true` to inspect AudioContext lifecycle,
 *   gesture unlock transitions, and per-event synth triggers in DevTools console.
 */

type OscillatorWave = 'square' | 'triangle' | 'sawtooth' | 'sine';

interface ToneParams {
  type: OscillatorWave;
  freqStart: number;
  freqEnd?: number;
  durationSec: number;
  delaySec?: number;
  peakGain: number;
  attackSec?: number;
}

declare global {
  interface Window {
    __RASS_OVERWORLD_DEBUG__?: boolean;
    webkitAudioContext?: typeof AudioContext;
  }
}

/**
 * Emit opt-in debug diagnostics when `window.__RASS_OVERWORLD_DEBUG__` is enabled.
 */
function debugLog(message: string, detail?: unknown): void {
  if (typeof window !== 'undefined' && window.__RASS_OVERWORLD_DEBUG__) {
    console.info(`[ChiptuneAudio] ${message}`, detail ?? '');
  }
}

/**
 * Procedural 8-bit synthesizer strictly gated behind real user gestures to
 * satisfy Chromium/Safari autoplay policies and keep payload at 0 KB audio assets.
 */
export class ChiptuneAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private gestureUnlocked = false;
  private lastStepAtMs = 0;
  private lastTypewriterAtMs = 0;
  private gestureBound = false;
  private onUnlockBound: (() => void) | null = null;

  /**
   * Minimum cooldown between footstep blips (ms) so holding WASD/Arrow keys
   * sounds like rhythmic 8-bit walking steps rather than a continuous buzz.
   */
  private static readonly STEP_COOLDOWN_MS = 105;

  /**
   * Minimum cooldown between typewriter speech blips (ms) so rapid character-by-
   * character dialogue reveals sound like crisp SNES text cadence without buzz.
   */
  private static readonly TYPEWRITER_COOLDOWN_MS = 44;

  /**
   * Master gain headroom (0..1) chosen to prevent digital clipping when
   * multi-voice arpeggio notes overlap across mobile speakers.
   */
  private static readonly MASTER_HEADROOM = 0.12;

  constructor() {
    this.bindGestureUnlock();
  }

  /**
   * Attach one-shot capture-phase listeners for pointer/keyboard gestures so
   * `gestureUnlocked` flips to true BEFORE bubble-phase HUD handlers invoke audio.
   */
  public bindGestureUnlock(): void {
    if (this.gestureBound || typeof window === 'undefined') return;
    this.gestureBound = true;

    const handleFirstGesture = () => {
      this.gestureUnlocked = true;
      debugLog('User gesture detected; chiptune synthesizer unlocked.');
      // Lazily resume if a context already exists in suspended state.
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
    };

    this.onUnlockBound = handleFirstGesture;
    window.addEventListener('pointerdown', handleFirstGesture, {
      capture: true,
      passive: true,
      once: true,
    });
    window.addEventListener('keydown', handleFirstGesture, {
      capture: true,
      passive: true,
      once: true,
    });
  }

  /**
   * Explicitly unlock and warm/resume the AudioContext inside a user click or
   * keydown callback (e.g. `#audioToggle` or canvas interaction).
   */
  public unlock(): boolean {
    if (typeof window === 'undefined') return false;
    this.gestureUnlocked = true;
    const ctx = this.ensureContext();
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      void ctx.resume().catch((err) => {
        debugLog('AudioContext resume deferred', err);
      });
    }
    return true;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): boolean {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      // Smooth 15ms gain ramp prevents audible clicks when toggling mute mid-note.
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(
        muted ? 0 : ChiptuneAudio.MASTER_HEADROOM,
        now + 0.015,
      );
    }
    debugLog(`Audio mute state changed -> ${muted ? 'muted' : 'active'}`);
    return this.muted;
  }

  public toggleMute(): boolean {
    const nextMuted = !this.muted;
    if (!nextMuted) {
      this.unlock();
    }
    this.setMuted(nextMuted);
    if (!nextMuted) {
      this.playToggle();
    }
    return this.muted;
  }

  /**
   * Lazy AudioContext creation strictly gated behind `gestureUnlocked` (or
   * active `navigator.userActivation`) so page load never triggers autoplay warnings.
   */
  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    const hasUserActivation =
      typeof navigator !== 'undefined' && Boolean(navigator.userActivation?.isActive);
    const userActivated = this.gestureUnlocked || hasUserActivation;
    if (!userActivated) {
      debugLog('Blocked AudioContext creation prior to user gesture.');
      return null;
    }

    if (!this.ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) {
        debugLog('Web Audio API unavailable in this browser.');
        return null;
      }
      this.ctx = new AudioCtor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : ChiptuneAudio.MASTER_HEADROOM;
      this.masterGain.connect(this.ctx.destination);
      debugLog('Created lazy AudioContext', { sampleRate: this.ctx.sampleRate });
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  /**
   * Schedule a single oscillator tone with a 5ms click-free linear attack and
   * exponential decay down to 0.0001 (Web Audio rejects exponential ramps to 0).
   */
  private scheduleTone({
    type,
    freqStart,
    freqEnd,
    durationSec,
    delaySec = 0,
    peakGain,
    attackSec = 0.005,
  }: ToneParams): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const startTime = ctx.currentTime + delaySec;
    const stopTime = startTime + durationSec;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    if (freqEnd && freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, freqEnd),
        stopTime,
      );
    }

    // Envelope starts near zero, ramps linearly past DC offset, then decays exponentially.
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + attackSec);
    env.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc.connect(env);
    env.connect(this.masterGain);

    osc.start(startTime);
    osc.stop(stopTime + 0.01);
  }

  /**
   * Soft 8-bit triangle footstep blip throttled by STEP_COOLDOWN_MS so rapid
   * walking cadence stays crisp without harsh square-wave fatigue.
   */
  public playStep(): void {
    if (this.muted || !this.gestureUnlocked) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastStepAtMs < ChiptuneAudio.STEP_COOLDOWN_MS) return;
    this.lastStepAtMs = now;

    this.scheduleTone({
      type: 'triangle',
      freqStart: 195,
      freqEnd: 115,
      durationSec: 0.048,
      peakGain: 0.38,
    });
  }

  /**
   * Ascending 3-note 8-bit zone chime mapped across the 5 Overworld regions
   * (Sanctuary, Hall of Eras, Relic Vault, Trophy Armory, Signal Beacon).
   */
  public playZoneChime(zoneIndex: number): void {
    if (this.muted || !this.gestureUnlocked) return;
    // C-major pentatonic anchors so each zone feels progressively brighter eastward.
    const roots = [261.63, 293.66, 329.63, 392.0, 523.25];
    const safeIdx = ((Math.floor(zoneIndex) % roots.length) + roots.length) % roots.length;
    const root = roots[safeIdx];
    const notes = [root, root * 1.25, root * 1.5];

    notes.forEach((freq, idx) => {
      this.scheduleTone({
        type: 'square',
        freqStart: freq,
        durationSec: idx === notes.length - 1 ? 0.14 : 0.075,
        delaySec: idx * 0.055,
        peakGain: 0.24,
      });
    });

    // Triangle sub-octave anchor adds Game Boy warmth under the square lead.
    this.scheduleTone({
      type: 'triangle',
      freqStart: root * 0.5,
      durationSec: 0.18,
      delaySec: 0,
      peakGain: 0.26,
    });

    debugLog('Played zone chime', { zoneIndex: safeIdx, root });
  }

  /**
   * Two-tone cheerful 8-bit bark for the White Dog memorial companion (Emy,
   * Kiba, and Yue tribute): two playful upward pitch glides with subtle harmonic body.
   */
  public playBarkChime(): void {
    if (this.muted) return;
    // Allow direct click/keydown calls to unlock context synchronously.
    this.unlock();

    // First playful yip: 480Hz -> 760Hz over 70ms.
    this.scheduleTone({
      type: 'square',
      freqStart: 480,
      freqEnd: 760,
      durationSec: 0.07,
      delaySec: 0,
      peakGain: 0.3,
    });
    this.scheduleTone({
      type: 'triangle',
      freqStart: 240,
      freqEnd: 380,
      durationSec: 0.075,
      delaySec: 0,
      peakGain: 0.22,
    });

    // Second brighter bark after a 55ms breath: 590Hz -> 920Hz over 90ms.
    this.scheduleTone({
      type: 'square',
      freqStart: 590,
      freqEnd: 920,
      durationSec: 0.09,
      delaySec: 0.115,
      peakGain: 0.32,
    });
    this.scheduleTone({
      type: 'triangle',
      freqStart: 295,
      freqEnd: 460,
      durationSec: 0.095,
      delaySec: 0.115,
      peakGain: 0.24,
    });

    debugLog('Played White Dog memorial bark chime.');
  }

  /**
   * Classic 4-note RPG treasure chest arpeggio (G4 -> B4 -> D5 -> G5) used
   * when opening the satirical AI hype roast chest/monolith.
   */
  public playChestOpen(): void {
    if (this.muted) return;
    this.unlock();

    const fanfare = [
      { freq: 392.0, dur: 0.085, delay: 0.0 },
      { freq: 493.88, dur: 0.085, delay: 0.075 },
      { freq: 587.33, dur: 0.085, delay: 0.15 },
      { freq: 783.99, dur: 0.28, delay: 0.225 },
    ];

    for (const step of fanfare) {
      this.scheduleTone({
        type: 'square',
        freqStart: step.freq,
        durationSec: step.dur,
        delaySec: step.delay,
        peakGain: 0.26,
      });
    }

    // Warm triangle fifth on the final chord hold.
    this.scheduleTone({
      type: 'triangle',
      freqStart: 392.0,
      durationSec: 0.28,
      delaySec: 0.225,
      peakGain: 0.28,
    });

    debugLog('Played treasure chest open fanfare.');
  }

  /**
   * Snappy 38ms UI toggle tick for HUD switches (sky, motion, audio).
   */
  public playToggle(): void {
    if (this.muted) return;
    this.unlock();

    this.scheduleTone({
      type: 'square',
      freqStart: 780,
      freqEnd: 1046.5,
      durationSec: 0.038,
      peakGain: 0.18,
    });
  }

  /**
   * Classic SNES RPG dialogue typewriter blip throttled by TYPEWRITER_COOLDOWN_MS
   * so rapid character reveals produce crisp speech cadence without harsh clipping.
   * Optional `pitchOffsetHz` subtly colors voice register per speaker (e.g. RASS vs Boris).
   */
  public playTypewriterBlip(pitchOffsetHz = 0): void {
    if (this.muted || !this.gestureUnlocked) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastTypewriterAtMs < ChiptuneAudio.TYPEWRITER_COOLDOWN_MS) return;
    this.lastTypewriterAtMs = now;

    // Clamped 420..980Hz voice band sits comfortably inside mobile speaker mid-range.
    const baseFreq = Math.max(420, Math.min(980, 620 + pitchOffsetHz));
    this.scheduleTone({
      type: 'square',
      freqStart: baseFreq,
      freqEnd: baseFreq * 1.06,
      durationSec: 0.024,
      peakGain: 0.12,
      attackSec: 0.002,
    });
  }

  /**
   * Crisp two-note ascending SNES confirm chime (C5 -> G5) used when advancing
   * dialogue, interacting with world hotspots, or opening the Character Dossier.
   */
  public playConfirm(): void {
    if (this.muted) return;
    this.unlock();

    this.scheduleTone({
      type: 'square',
      freqStart: 523.25,
      durationSec: 0.052,
      delaySec: 0,
      peakGain: 0.22,
    });
    this.scheduleTone({
      type: 'square',
      freqStart: 783.99,
      durationSec: 0.095,
      delaySec: 0.045,
      peakGain: 0.24,
    });
    // Triangle root adds warm SNES cartridge body underneath the confirm fifth.
    this.scheduleTone({
      type: 'triangle',
      freqStart: 261.63,
      durationSec: 0.12,
      delaySec: 0.045,
      peakGain: 0.2,
    });

    debugLog('Played SNES confirm chime.');
  }

  /**
   * Gentle descending two-note cancel/back chime (E5 -> A4) used when closing
   * dialogue panels, dismissing overlays, or backing out of menus ([ESC / B]).
   */
  public playCancel(): void {
    if (this.muted) return;
    this.unlock();

    this.scheduleTone({
      type: 'square',
      freqStart: 659.25,
      durationSec: 0.048,
      delaySec: 0,
      peakGain: 0.18,
    });
    this.scheduleTone({
      type: 'triangle',
      freqStart: 440.0,
      freqEnd: 329.63,
      durationSec: 0.09,
      delaySec: 0.042,
      peakGain: 0.24,
    });

    debugLog('Played SNES cancel chime.');
  }

  /**
   * Release event listeners and close AudioContext cleanly on teardown.
   */
  public dispose(): void {
    if (typeof window !== 'undefined' && this.onUnlockBound) {
      window.removeEventListener('pointerdown', this.onUnlockBound, { capture: true });
      window.removeEventListener('keydown', this.onUnlockBound, { capture: true });
      this.onUnlockBound = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
      this.masterGain = null;
    }
    this.gestureBound = false;
  }
}

export const chiptuneAudio = new ChiptuneAudio();

export function createChiptuneAudio(): ChiptuneAudio {
  return new ChiptuneAudio();
}
