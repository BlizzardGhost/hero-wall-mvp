/**
 * Path: src/scripts/chiptune-audio.ts
 * Purpose: Zero-dependency procedural Web Audio API 16-bit chiptune & cozy SFX
 *          synthesizer providing organic campfire crackle bursts, low-frequency
 *          portal hums, shimmering dimensional portal warps, surface-aware footsteps
 *          (grass / stone / metal), Pokemon [START] menu blips, SNES typewriter
 *          ticks, confirm/cancel chimes, room arrival arpeggios, companion dog
 *          bark chime, and treasure chest fanfare with 0 KB external audio assets.
 * Spec Reference: SPEC-022 (022-hero-wall-studio-cozy-rebuild)
 *
 * Debug Operator Notes:
 * - Set `window.__RASS_OVERWORLD_DEBUG__ = true` to inspect AudioContext lifecycle,
 *   gesture unlock transitions, mute/crackle toggles, and per-event synth triggers.
 * - AudioContext creation is strictly gated behind a real pointer/keyboard/gamepad
 *   user gesture to satisfy Safari/Chrome autoplay restrictions.
 */

type OscillatorWave = 'square' | 'triangle' | 'sawtooth' | 'sine';
export type StepSurface = 'grass' | 'stone' | 'metal';

interface ToneParams {
  type: OscillatorWave;
  freqStart: number;
  freqEnd?: number;
  durationSec: number;
  delaySec?: number;
  peakGain: number;
  attackSec?: number;
}

interface NoiseBurstParams {
  filterType: BiquadFilterType;
  freqStart: number;
  freqEnd?: number;
  q?: number;
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
 * Procedural 16-bit synthesizer strictly gated behind real user gestures to
 * satisfy Chromium/Safari autoplay policies and keep audio payload at 0 KB.
 */
export class ChiptuneAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private crackleEnabled = true;
  private gestureUnlocked = false;
  private lastStepAtMs = 0;
  private lastTypewriterAtMs = 0;
  private lastCrackleAtMs = 0;
  private lastPortalHumAtMs = 0;
  private gestureBound = false;
  private onUnlockBound: (() => void) | null = null;

  /**
   * Minimum cooldown between footstep ticks (ms) so holding WASD/D-Pad yields
   * a rhythmic RPG walking cadence rather than a continuous oscillator buzz.
   */
  private static readonly STEP_COOLDOWN_MS = 105;

  /**
   * Minimum cooldown between typewriter dialogue blips (ms) so fast character
   * reveal keeps classic SNES dialogue cadence without clipping.
   */
  private static readonly TYPEWRITER_COOLDOWN_MS = 44;

  /**
   * Minimum interval between campfire crackle bursts (ms) so ambient hearth
   * ticks feel organic and never spam the audio graph.
   */
  private static readonly CRACKLE_COOLDOWN_MS = 260;

  /**
   * Minimum interval between proximity portal hum pulses (ms) so lingering near
   * a techno-organic portal breathes smoothly rather than retriggering every frame.
   */
  private static readonly PORTAL_HUM_COOLDOWN_MS = 720;

  /**
   * Master gain headroom (0..1) chosen to prevent digital clipping on mobile
   * speakers when multi-voice arpeggios and filtered noise overlap.
   */
  private static readonly MASTER_HEADROOM = 0.13;

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
      debugLog('User gesture detected; 16-bit synthesizer unlocked.');
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
   * Explicitly unlock and warm/resume the AudioContext inside a user click,
   * gamepad press, or keydown callback.
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
    this.muted = Boolean(muted);
    if (this.masterGain && this.ctx) {
      // Smooth 15ms gain ramp prevents audible clicks when toggling mute mid-note.
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(
        this.muted ? 0 : ChiptuneAudio.MASTER_HEADROOM,
        now + 0.015,
      );
    }
    debugLog(`Audio mute state changed -> ${this.muted ? 'muted' : 'active'}`);
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

  public isCrackleEnabled(): boolean {
    return this.crackleEnabled;
  }

  public setCrackleEnabled(enabled: boolean): boolean {
    this.crackleEnabled = Boolean(enabled);
    debugLog(`Campfire crackle SFX -> ${this.crackleEnabled ? 'enabled' : 'disabled'}`);
    return this.crackleEnabled;
  }

  public toggleCrackle(): boolean {
    const next = !this.crackleEnabled;
    this.setCrackleEnabled(next);
    if (next && !this.muted) {
      this.unlock();
      this.playCampfireCrackle();
    } else if (!this.muted) {
      this.playToggle();
    }
    return this.crackleEnabled;
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
   * Lazily synthesize and cache a 0.25s mono white/impulse noise buffer used by
   * campfire crackle bursts, grass footstep rustles, and portal warp sweeps.
   */
  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }

    const length = Math.max(1024, Math.floor(ctx.sampleRate * 0.25));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    // Mix soft continuous noise with occasional sharper wood-snap transients.
    for (let i = 0; i < length; i += 1) {
      const base = Math.random() * 2 - 1;
      const snap = Math.random() > 0.985 ? (Math.random() > 0.5 ? 1 : -1) * 0.95 : 0;
      channel[i] = Math.max(-1, Math.min(1, base * 0.55 + snap));
    }

    this.noiseBuffer = buffer;
    return buffer;
  }

  /**
   * Schedule a single oscillator tone with a click-free linear attack and
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
    osc.frequency.setValueAtTime(Math.max(20, freqStart), startTime);
    if (freqEnd && freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), stopTime);
    }

    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(Math.max(0.0002, peakGain), startTime + attackSec);
    env.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc.connect(env);
    env.connect(this.masterGain);

    osc.start(startTime);
    osc.stop(stopTime + 0.015);
  }

  /**
   * Schedule a filtered noise burst from the cached mono noise buffer for organic
   * campfire crackle pops, grass footsteps, and dimensional portal wind shimmer.
   */
  private scheduleNoiseBurst({
    filterType,
    freqStart,
    freqEnd,
    q = 1.6,
    durationSec,
    delaySec = 0,
    peakGain,
    attackSec = 0.003,
  }: NoiseBurstParams): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const noise = this.getNoiseBuffer(ctx);
    const startTime = ctx.currentTime + delaySec;
    const stopTime = startTime + durationSec;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    // Offset randomly inside the cached buffer so consecutive ticks sound organic.
    const maxOffset = Math.max(0.01, noise.duration - durationSec - 0.01);
    const offset = Math.random() * maxOffset;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.setValueAtTime(q, startTime);
    filter.frequency.setValueAtTime(Math.max(40, freqStart), startTime);
    if (freqEnd && freqEnd !== freqStart) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), stopTime);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(Math.max(0.0002, peakGain), startTime + attackSec);
    env.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain);

    src.start(startTime, offset, durationSec + 0.01);
    src.stop(stopTime + 0.015);
  }

  /**
   * Subtle organic campfire crackle burst (bandpass-filtered wood snap + soft
   * warm ember pop) played ambiently in the Campfire Sanctuary when crackle SFX is on.
   */
  public playCampfireCrackle(): void {
    if (this.muted || !this.crackleEnabled || !this.gestureUnlocked) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastCrackleAtMs < ChiptuneAudio.CRACKLE_COOLDOWN_MS) return;
    this.lastCrackleAtMs = now;

    // Bandpass noise snap randomized slightly across warm hearth frequencies.
    const centerHz = 1450 + Math.random() * 1350;
    this.scheduleNoiseBurst({
      filterType: 'bandpass',
      freqStart: centerHz,
      freqEnd: centerHz * 0.72,
      q: 2.4,
      durationSec: 0.048,
      peakGain: 0.14,
      attackSec: 0.002,
    });

    // Subtle secondary ember pop on ~65% of ticks for cozy organic irregularity.
    if (Math.random() > 0.35) {
      const popDelay = 0.018 + Math.random() * 0.045;
      const popHz = 165 + Math.random() * 95;
      this.scheduleTone({
        type: 'triangle',
        freqStart: popHz,
        freqEnd: 78,
        durationSec: 0.036,
        delaySec: popDelay,
        peakGain: 0.09,
        attackSec: 0.002,
      });
    }
  }

  /**
   * Subtle low-frequency sci-fi resonator hum emitted gently when Boris nears
   * any of the 3 alien frontier portals or a room's return portal.
   */
  public playPortalHum(): void {
    if (this.muted || !this.gestureUnlocked) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastPortalHumAtMs < ChiptuneAudio.PORTAL_HUM_COOLDOWN_MS) return;
    this.lastPortalHumAtMs = now;

    // Warm sub-resonator (D2) paired with slightly detuned harmonic shimmer.
    this.scheduleTone({
      type: 'triangle',
      freqStart: 73.42,
      freqEnd: 79.5,
      durationSec: 0.42,
      peakGain: 0.15,
      attackSec: 0.065,
    });
    this.scheduleTone({
      type: 'sine',
      freqStart: 146.83,
      freqEnd: 152.0,
      durationSec: 0.38,
      delaySec: 0.03,
      peakGain: 0.075,
      attackSec: 0.06,
    });
  }

  /**
   * Shimmering ~520ms 16-bit dimensional warp frequency sweep played when stepping
   * into an alien frontier portal, Return Portal, or [TOWN MAP] fast-travel slot.
   */
  public playPortalWarp(): void {
    if (this.muted) return;
    this.unlock();

    // Sweeping low-to-high phase carrier + filtered dimensional shimmer wind.
    this.scheduleTone({
      type: 'triangle',
      freqStart: 155,
      freqEnd: 880,
      durationSec: 0.34,
      delaySec: 0,
      peakGain: 0.28,
      attackSec: 0.012,
    });
    this.scheduleNoiseBurst({
      filterType: 'bandpass',
      freqStart: 420,
      freqEnd: 2800,
      q: 2.1,
      durationSec: 0.36,
      delaySec: 0.02,
      peakGain: 0.18,
      attackSec: 0.02,
    });

    // Crystalline 16-bit teleport chime tail matching the ~550ms iris transition.
    const shimmerNotes = [523.25, 659.25, 783.99, 1046.5];
    shimmerNotes.forEach((freq, idx) => {
      this.scheduleTone({
        type: 'square',
        freqStart: freq,
        freqEnd: freq * 1.03,
        durationSec: idx === shimmerNotes.length - 1 ? 0.2 : 0.085,
        delaySec: 0.12 + idx * 0.065,
        peakGain: 0.14,
        attackSec: 0.004,
      });
    });

    debugLog('Played 16-bit dimensional portal warp.');
  }

  /**
   * Surface-aware soft 16-bit footstep tick throttled by STEP_COOLDOWN_MS:
   * - `grass`: muffled forest turf rustle (campfire clearing)
   * - `stone`: crisp obsidian/brick tap (cyber_chasm & armory)
   * - `metal`: high-orbit deck / biomechanical grate click (bio_forge & signal_beacon)
   */
  public playStep(surface: StepSurface = 'grass'): void {
    if (this.muted || !this.gestureUnlocked) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastStepAtMs < ChiptuneAudio.STEP_COOLDOWN_MS) return;
    this.lastStepAtMs = now;

    if (surface === 'stone') {
      this.scheduleTone({
        type: 'triangle',
        freqStart: 235,
        freqEnd: 120,
        durationSec: 0.042,
        peakGain: 0.3,
      });
      this.scheduleTone({
        type: 'square',
        freqStart: 510,
        freqEnd: 260,
        durationSec: 0.018,
        peakGain: 0.1,
        attackSec: 0.002,
      });
      return;
    }

    if (surface === 'metal') {
      this.scheduleTone({
        type: 'square',
        freqStart: 470,
        freqEnd: 310,
        durationSec: 0.026,
        peakGain: 0.14,
        attackSec: 0.002,
      });
      this.scheduleTone({
        type: 'triangle',
        freqStart: 740,
        freqEnd: 480,
        durationSec: 0.032,
        peakGain: 0.22,
        attackSec: 0.002,
      });
      return;
    }

    // Default 'grass': soft filtered rustle + warm low-mid thud.
    this.scheduleNoiseBurst({
      filterType: 'lowpass',
      freqStart: 880,
      freqEnd: 360,
      q: 0.9,
      durationSec: 0.038,
      peakGain: 0.16,
      attackSec: 0.003,
    });
    this.scheduleTone({
      type: 'triangle',
      freqStart: 170,
      freqEnd: 98,
      durationSec: 0.042,
      peakGain: 0.28,
    });
  }

  /**
   * Crisp 16-bit RPG menu cursor blip used for the Pokémon [START] menu and
   * interactive list navigation.
   */
  public playMenuBlip(): void {
    if (this.muted) return;
    this.unlock();

    this.scheduleTone({
      type: 'square',
      freqStart: 880,
      freqEnd: 1174.66,
      durationSec: 0.042,
      peakGain: 0.18,
      attackSec: 0.002,
    });
    this.scheduleTone({
      type: 'triangle',
      freqStart: 440,
      durationSec: 0.046,
      peakGain: 0.16,
      attackSec: 0.002,
    });
  }

  /**
   * Ascending 3-note 16-bit room arrival chime mapped cleanly across the 4 rooms
   * (`campfire`, `cyber_chasm`, `bio_forge`, `signal_beacon`).
   */
  public playZoneChime(zoneIndex: number): void {
    if (this.muted || !this.gestureUnlocked) return;
    // Warm sanctuary C4, arcane chasm D4, forge E4, orbital beacon G4.
    const roots = [261.63, 293.66, 329.63, 392.0];
    const safeIdx = ((Math.floor(zoneIndex) % roots.length) + roots.length) % roots.length;
    const root = roots[safeIdx];
    const notes = [root, root * 1.25, root * 1.5];

    notes.forEach((freq, idx) => {
      this.scheduleTone({
        type: 'square',
        freqStart: freq,
        durationSec: idx === notes.length - 1 ? 0.14 : 0.075,
        delaySec: idx * 0.055,
        peakGain: 0.22,
      });
    });

    this.scheduleTone({
      type: 'triangle',
      freqStart: root * 0.5,
      durationSec: 0.18,
      delaySec: 0,
      peakGain: 0.24,
    });

    debugLog('Played room/zone arrival chime', { zoneIndex: safeIdx, root });
  }

  /**
   * Cheerful two-tone 16-bit bark chime when waking or petting The Dog by the
   * campfire hearth.
   */
  public playBarkChime(): void {
    if (this.muted) return;
    this.unlock();

    // First playful yip: 480Hz -> 760Hz over 70ms.
    this.scheduleTone({
      type: 'square',
      freqStart: 480,
      freqEnd: 760,
      durationSec: 0.07,
      delaySec: 0,
      peakGain: 0.28,
    });
    this.scheduleTone({
      type: 'triangle',
      freqStart: 240,
      freqEnd: 380,
      durationSec: 0.075,
      delaySec: 0,
      peakGain: 0.2,
    });

    // Second brighter bark after a 55ms breath: 590Hz -> 920Hz over 90ms.
    this.scheduleTone({
      type: 'square',
      freqStart: 590,
      freqEnd: 920,
      durationSec: 0.09,
      delaySec: 0.115,
      peakGain: 0.3,
    });
    this.scheduleTone({
      type: 'triangle',
      freqStart: 295,
      freqEnd: 460,
      durationSec: 0.095,
      delaySec: 0.115,
      peakGain: 0.22,
    });

    debugLog('Played companion bark chime.');
  }

  /**
   * Classic 4-note RPG treasure chest arpeggio (G4 -> B4 -> D5 -> G5) used
   * when opening the Mimic Roast Chest.
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
        peakGain: 0.24,
      });
    }

    this.scheduleTone({
      type: 'triangle',
      freqStart: 392.0,
      durationSec: 0.28,
      delaySec: 0.225,
      peakGain: 0.26,
    });

    debugLog('Played treasure chest open fanfare.');
  }

  /**
   * Snappy 38ms UI toggle tick for HUD & [START] Settings switches.
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
   * Classic SNES RPG dialogue typewriter tick throttled by TYPEWRITER_COOLDOWN_MS.
   * Optional `pitchOffsetHz` subtly colors voice register per speaker ([BORIS],
   * [RASS], [MS. DEVIL], [THE DOG], [TERMINAL]).
   */
  public playTypewriterBlip(pitchOffsetHz = 0): void {
    if (this.muted || !this.gestureUnlocked) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastTypewriterAtMs < ChiptuneAudio.TYPEWRITER_COOLDOWN_MS) return;
    this.lastTypewriterAtMs = now;

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
   * dialogue panels, dismissing overlays, or exiting [START] menus.
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
    this.noiseBuffer = null;
    this.gestureBound = false;
  }
}

export const chiptuneAudio = new ChiptuneAudio();

export function createChiptuneAudio(): ChiptuneAudio {
  return new ChiptuneAudio();
}
