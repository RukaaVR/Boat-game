/**
 * Procedural audio — every sound is synthesised with Web Audio. No files.
 *
 * Buses: sfx and music feed a master with a gentle compressor. The music bus has
 * its own lowpass so pause/results can muffle it.
 *
 * Continuous voices (player engine, two nearest rival engines, water rush,
 * drift hiss, boost roar, wind, rain, ambience) are created once and only have
 * their parameters ramped each frame. One-shots are short-lived node graphs
 * that free themselves.
 */

import { clamp, clamp01 } from '../core/mathx';
import type { GameEvent } from '../core/events';
import type { Boat } from '../boat/boat';
import type { ThemeId } from '../core/types';
import { VoiceBank } from './voice';

interface EngineVoice {
  a: OscillatorNode;
  b: OscillatorNode;
  sub: OscillatorNode;
  am: OscillatorNode;
  amGain: GainNode;
  shaper: WaveShaperNode;
  filter: BiquadFilterNode;
  out: GainNode;
  pan: StereoPannerNode;
}

interface NoiseVoice {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  out: GainNode;
}

export interface Listener {
  x: number;
  z: number;
  /** Camera right vector in XZ. */
  rx: number;
  rz: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  musicBus!: GainNode;
  musicFilter!: BiquadFilterNode;
  private comp!: DynamicsCompressorNode;
  /** Mix-polish chain: glue compressor → limiter → soft clipper. */
  private limiter!: DynamicsCompressorNode;
  private clipper!: WaveShaperNode;
  /** Music ducking under big impacts (between the music filter and master). */
  private musicDuck!: GainNode;
  /** Character voice chirps (created with the context). */
  voice: VoiceBank | null = null;
  private noiseBuf!: AudioBuffer;
  private engine: EngineVoice | null = null;
  private rivals: EngineVoice[] = [];
  private rush: NoiseVoice | null = null;
  private drift: NoiseVoice | null = null;
  private boost: NoiseVoice | null = null;
  private boostRoar: OscillatorNode | null = null;
  private boostRoarGain: GainNode | null = null;
  private wind: NoiseVoice | null = null;
  private rain: NoiseVoice | null = null;
  private ambience: NoiseVoice | null = null;
  private ambienceKind: ThemeId = 'tropical';
  private gullTimer = 3;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.85 };
  private racingVoices = false;
  private lastClick = 0;
  /** Thunder queued after lightning (seconds). */
  private thunderQ: { t: number; s: number }[] = [];

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    if (this.ctx) {
      this.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicDuck = ctx.createGain();
    this.musicBus.connect(this.musicFilter).connect(this.musicDuck).connect(this.master);
    this.sfx.connect(this.master);
    this.buildOutput(ctx);
    // Two seconds of white noise, shared by every noise voice.
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w; // a touch of pink-ish weight
      d[i] = w * 0.7 + b * 1.6;
    }
    this.setVolumes(this.volumes.master, this.volumes.music, this.volumes.sfx);
    this.voice = new VoiceBank(ctx, this.sfx, this.noiseBuf);
    this.watchResume();
  }

  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;

  /** Output meter (tests/debug): RMS and absolute peak of the master bus right now. */
  meter() {
    if (!this.ctx) return { rms: 0, peak: 0, state: 'none' };
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.clipper.connect(this.analyser);
      this.meterBuf = new Float32Array(this.analyser.fftSize);
    }
    this.analyser.getFloatTimeDomainData(this.meterBuf!);
    let s = 0;
    let p = 0;
    for (const v of this.meterBuf!) {
      s += v * v;
      p = Math.max(p, Math.abs(v));
    }
    return { rms: Math.sqrt(s / this.meterBuf!.length), peak: p, state: this.ctx.state, reduction: this.comp.reduction + this.limiter.reduction };
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.volumes = { master, music, sfx };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(music * 0.55, t, 0.05);
    this.sfx.gain.setTargetAtTime(sfx, t, 0.05);
  }

  /** Muffle music (pause menu, results). */
  muffle(on: boolean) {
    if (!this.ctx) return;
    this.musicFilter.frequency.setTargetAtTime(on ? 900 : 18000, this.ctx.currentTime, 0.15);
  }

  private noiseVoice(type: BiquadFilterType, freq: number, q = 1): NoiseVoice {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopStart = Math.random();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const out = ctx.createGain();
    out.gain.value = 0;
    src.connect(filter).connect(out).connect(this.sfx);
    src.start(0, Math.random() * 1.5);
    return { src, filter, out };
  }

  private engineVoice(): EngineVoice {
    const ctx = this.ctx!;
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    const b = ctx.createOscillator();
    b.type = 'square';
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    const amGain = ctx.createGain();
    amGain.gain.value = 0.7;
    const am = ctx.createOscillator();
    am.type = 'sine';
    am.frequency.value = 24;
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.3;
    am.connect(amDepth).connect(amGain.gain);
    const out = ctx.createGain();
    out.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const ga = ctx.createGain();
    ga.gain.value = 0.35;
    const gb = ctx.createGain();
    gb.gain.value = 0.22;
    const gs = ctx.createGain();
    gs.gain.value = 0.5;
    a.connect(ga).connect(shaper);
    b.connect(gb).connect(shaper);
    sub.connect(gs).connect(filter);
    shaper.connect(filter).connect(amGain).connect(out).connect(pan).connect(this.sfx);
    for (const o of [a, b, sub, am]) o.start();
    return { a, b, sub, am, amGain, shaper, filter, out, pan };
  }

  /** Create/destroy the continuous racing voices. */
  startRace(theme: ThemeId) {
    if (!this.ctx) return;
    this.stopRace();
    this.racingVoices = true;
    this.engine = this.engineVoice();
    this.rivals = [this.engineVoice(), this.engineVoice()];
    this.rush = this.noiseVoice('bandpass', 900, 0.7);
    this.drift = this.noiseVoice('bandpass', 2600, 1.5);
    this.boost = this.noiseVoice('highpass', 1800, 0.7);
    this.wind = this.noiseVoice('lowpass', 500, 0.5);
    this.rain = this.noiseVoice('highpass', 3500, 0.4);
    this.ambienceKind = theme;
    this.ambience = this.noiseVoice('lowpass', theme === 'neon' ? 180 : theme === 'volcanic' ? 90 : 350, 0.8);
    const ctx = this.ctx;
    this.boostRoar = ctx.createOscillator();
    this.boostRoar.type = 'sawtooth';
    this.boostRoarGain = ctx.createGain();
    this.boostRoarGain.gain.value = 0;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    this.boostRoar.connect(f).connect(this.boostRoarGain).connect(this.sfx);
    this.boostRoar.start();
  }

  stopRace() {
    if (!this.ctx || !this.racingVoices) return;
    const t = this.ctx.currentTime;
    const kill = (n: AudioScheduledSourceNode | null | undefined, g?: GainNode | null) => {
      if (g) g.gain.setTargetAtTime(0, t, 0.05);
      if (n) n.stop(t + 0.3);
    };
    for (const v of [this.engine, ...this.rivals]) {
      if (!v) continue;
      kill(v.a, v.out);
      kill(v.b);
      kill(v.sub);
      kill(v.am);
    }
    for (const v of [this.rush, this.drift, this.boost, this.wind, this.rain, this.ambience]) if (v) kill(v.src, v.out);
    kill(this.boostRoar, this.boostRoarGain);
    this.engine = null;
    this.rivals = [];
    this.rush = this.drift = this.boost = this.wind = this.rain = this.ambience = null;
    this.boostRoar = null;
    this.boostRoarGain = null;
    this.racingVoices = false;
  }

  /** Per-frame continuous mix. `rivals` are boats sorted nearest first. */
  updateRace(dt: number, player: Boat, throttle: number, rivals: readonly Boat[], L: Listener, storm: number, paused: boolean, revving: number) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const k = 0.04;
    const mute = paused ? 0 : 1;
    // Player engine.
    const rpm = Math.max(player.rpm, revving);
    const f0 = 46 + rpm * 150;
    const e = this.engine;
    e.a.frequency.setTargetAtTime(f0, t, k);
    e.b.frequency.setTargetAtTime(f0 * 0.502, t, k);
    e.sub.frequency.setTargetAtTime(f0 * 0.5, t, k);
    e.am.frequency.setTargetAtTime(14 + rpm * 30, t, k);
    e.filter.frequency.setTargetAtTime(380 + rpm * 1800 + throttle * 900 + (player.airborne ? 1400 : 0), t, k);
    e.out.gain.setTargetAtTime(mute * (0.16 + 0.12 * throttle + 0.08 * rpm), t, k);
    e.pan.pan.setTargetAtTime(0, t, k);
    // Rivals.
    for (let i = 0; i < this.rivals.length; i++) {
      const v = this.rivals[i];
      const b = rivals[i];
      if (!b) {
        v.out.gain.setTargetAtTime(0, t, 0.1);
        continue;
      }
      const dx = b.position.x - L.x;
      const dz = b.position.z - L.z;
      const d = Math.hypot(dx, dz);
      const att = clamp01(1 - d / 90);
      // Cheap Doppler: closing speed bends pitch.
      const closing = d > 0.1 ? -((b.velocity.x - player.velocity.x) * dx + (b.velocity.z - player.velocity.z) * dz) / d : 0;
      const dop = clamp(1 + closing / 340, 0.85, 1.15);
      const rf = (50 + b.rpm * 140) * dop * (1 + i * 0.03);
      v.a.frequency.setTargetAtTime(rf, t, k);
      v.b.frequency.setTargetAtTime(rf * 0.503, t, k);
      v.sub.frequency.setTargetAtTime(rf * 0.5, t, k);
      v.filter.frequency.setTargetAtTime(500 + b.rpm * 1500, t, k);
      v.out.gain.setTargetAtTime(mute * att * att * 0.16, t, 0.08);
      v.pan.pan.setTargetAtTime(d > 0.1 ? clamp((dx * L.rx + dz * L.rz) / d, -0.9, 0.9) : 0, t, 0.05);
    }
    const sp = clamp01(player.speed / 34);
    const water = player.airborne ? 0 : clamp01(player.wet * 1.4);
    this.rush!.out.gain.setTargetAtTime(mute * water * (0.04 + 0.22 * sp), t, 0.06);
    this.rush!.filter.frequency.setTargetAtTime(500 + sp * 1300, t, 0.1);
    this.drift!.out.gain.setTargetAtTime(mute * (player.drifting ? 0.08 + 0.04 * player.driftTier : 0), t, 0.04);
    this.drift!.filter.frequency.setTargetAtTime(2200 + player.driftTier * 700, t, 0.05);
    this.boost!.out.gain.setTargetAtTime(mute * player.boostLevel * 0.13, t, 0.05);
    // Golden Surge: the engine sings higher and harder for the whole window.
    const surge = player.surge > 0 ? 1 : 0;
    this.boostRoar!.frequency.setTargetAtTime(70 + rpm * 60 + surge * 45, t, 0.05);
    this.boostRoarGain!.gain.setTargetAtTime(mute * (player.boostLevel * 0.07 + surge * 0.035), t, 0.05);
    this.wind!.out.gain.setTargetAtTime(mute * (0.02 + sp * 0.06 + (player.airborne ? 0.08 : 0) + storm * 0.07), t, 0.2);
    this.wind!.filter.frequency.setTargetAtTime(300 + sp * 900 + storm * 300, t, 0.2);
    this.rain!.out.gain.setTargetAtTime(mute * storm * 0.08, t, 0.3);
    this.ambience!.out.gain.setTargetAtTime(mute * (this.ambienceKind === 'volcanic' ? 0.12 : this.ambienceKind === 'neon' ? 0.06 : 0.05), t, 0.4);

    // Theme ambience details.
    this.gullTimer -= dt;
    if (this.gullTimer <= 0 && !paused) {
      this.gullTimer = 4 + Math.random() * 8;
      if (this.ambienceKind === 'tropical') this.gull();
    }
    for (let i = this.thunderQ.length - 1; i >= 0; i--) {
      this.thunderQ[i].t -= dt;
      if (this.thunderQ[i].t <= 0) {
        this.thunder(this.thunderQ[i].s);
        this.thunderQ.splice(i, 1);
      }
    }
  }

  // ── One-shots ──────────────────────────────────────────────────────────
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, pan = 0, slideTo = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, type: BiquadFilterType, freq: number, vol: number, pan = 0, when = 0, freqEnd = 0, q = 0.8) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.008, vol, dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.1);
  }

  private gull() {
    const p = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < 3; i++) this.tone(1400 + Math.random() * 300, 0.16, 'triangle', 0.025, i * 0.22, p, 900);
  }

  thunder(s: number) {
    this.burst(3.2, 'lowpass', 300, 0.5 * s, 0, 0, 40, 0.5);
    this.burst(1.2, 'lowpass', 900, 0.25 * s, 0.3, 0.05, 120, 0.5);
  }

  /** Menu / UI sound level (0..1), separate from gameplay SFX. */
  uiVolume = 1;

  click(kind: 'move' | 'select' | 'back' | 'deny' = 'move') {
    if (!this.ctx || this.uiVolume <= 0) return;
    const u = this.uiVolume;
    const now = performance.now();
    if (kind === 'move' && now - this.lastClick < 40) return;
    this.lastClick = now;
    if (kind === 'move') this.tone(1800, 0.04, 'square', 0.025 * u);
    else if (kind === 'select') {
      this.tone(880, 0.06, 'square', 0.05 * u);
      this.tone(1320, 0.1, 'square', 0.04 * u, 0.05);
      this.voice?.confirm(0.45 * u);
    } else if (kind === 'back') this.tone(600, 0.08, 'triangle', 0.06 * u, 0, 0, 380);
    else this.tone(160, 0.18, 'sawtooth', 0.06 * u);
  }

  unlockSting() {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.07 * this.uiVolume, i * 0.07));
  }

  /** Podium / trophy: a short brass-ish fanfare (bigger for the cup trophy). */
  fanfare(big = false) {
    if (!this.ctx) return;
    const notes: [number, number, number][] = big
      ? [
          [523, 0, 0.16],
          [523, 0.16, 0.16],
          [523, 0.32, 0.16],
          [659, 0.48, 0.5],
          [587, 1.0, 0.16],
          [659, 1.16, 0.16],
          [784, 1.32, 0.9],
        ]
      : [
          [392, 0, 0.14],
          [523, 0.14, 0.14],
          [659, 0.28, 0.14],
          [784, 0.42, 0.7],
        ];
    for (const [f, w, d] of notes) {
      this.tone(f, d + 0.08, 'sawtooth', 0.045, w);
      this.tone(f * 2, d, 'square', 0.02, w);
      this.tone(f / 2, d + 0.1, 'triangle', 0.05, w);
    }
    const end = notes[notes.length - 1][1];
    // Final chord with a cymbal swell.
    for (const f of big ? [262, 330, 392, 523] : [262, 330, 392]) this.tone(f, 1.6, 'sawtooth', 0.02, end);
    this.burst(big ? 2.2 : 1.4, 'highpass', 5000, 0.05, 0, end, 7000, 0.6);
  }

  /** Drift hop: a light slap of water under a short rubbery "boing". */
  private driftHop(isPlayer: boolean, att: number, pan: number) {
    const v = isPlayer ? 1 : att * 0.6;
    if (v < 0.05) return;
    this.burst(0.16, 'bandpass', 1700, 0.07 * v, pan, 0, 700, 1.4);
    this.tone(240, 0.13, 'triangle', 0.05 * v, 0, pan, 430);
    this.tone(430, 0.1, 'sine', 0.025 * v, 0.1, pan, 300);
  }

  /**
   * Drift spark tier: a rising "shing" per tier — each tier starts higher and
   * adds a note, over a short sparkle of high noise (blue → orange → pink).
   */
  private sparkTier(tier: number) {
    const k = Math.max(1, Math.min(3, Math.round(tier)));
    const base = [0, 740, 932, 1175][k];
    const steps = [1, 1.26, 1.5, 2];
    for (let i = 0; i <= k; i++) this.tone(base * steps[i], 0.09 + 0.02 * k, i === k ? 'triangle' : 'square', (i === k ? 0.05 : 0.032) * (0.85 + 0.1 * k), i * 0.045);
    this.burst(0.18 + 0.05 * k, 'highpass', 4500 + 900 * k, 0.035 + 0.012 * k, 0, 0, 9000, 1.2);
  }

  /** Crowd cheer + scattered applause (filtered noise swells). */
  crowdCheer(seconds = 3) {
    if (!this.ctx) return;
    this.burst(seconds, 'bandpass', 900, 0.09, 0, 0, 1300, 0.6);
    this.burst(seconds * 0.8, 'bandpass', 2200, 0.05, -0.4, 0.15, 1800, 1.2);
    this.burst(seconds * 0.8, 'bandpass', 2000, 0.05, 0.4, 0.3, 2400, 1.2);
    for (let i = 0; i < 18; i++) this.burst(0.05, 'highpass', 2500 + Math.random() * 1500, 0.04, Math.random() * 1.6 - 0.8, 0.2 + Math.random() * seconds * 0.8);
    // A couple of whistles.
    this.tone(1900, 0.5, 'sine', 0.025, 0.4, -0.5, 2600);
    this.tone(2100, 0.4, 'sine', 0.02, 1.1, 0.5, 1500);
  }

  /** Confetti cannon pop. */
  confettiPop() {
    if (!this.ctx) return;
    this.tone(120, 0.18, 'sine', 0.18, 0, 0, 50);
    this.burst(0.25, 'lowpass', 2500, 0.2, -0.3, 0, 400);
    this.burst(0.25, 'lowpass', 2500, 0.2, 0.3, 0.05, 400);
    this.burst(0.8, 'highpass', 6000, 0.05, 0, 0.08, 4000, 1);
  }

  /** React to simulation events. */
  onEvent(e: GameEvent, L: Listener, isPlayer: boolean) {
    if (!this.ctx) return;
    const dx = e.x - L.x;
    const dz = e.z - L.z;
    const d = Math.hypot(dx, dz);
    const pan = d > 0.5 ? clamp((dx * L.rx + dz * L.rz) / d, -0.85, 0.85) : 0;
    const att = isPlayer ? 1 : clamp01(1 - d / 120);
    if (att <= 0.01 && e.racer >= 0) return;
    this.reactExtras(e, isPlayer, att, pan);
    switch (e.type) {
      case 'splash':
        if (e.text === 'hop') {
          this.driftHop(isPlayer, att, pan);
          break;
        }
        this.burst(0.5 + e.value * 0.4, 'bandpass', 1200, (0.08 + e.value * 0.2) * att, pan, 0, 300);
        break;
      case 'driftStart':
        // The hull snapping into the slide: a short bright "shk" over a soft thump.
        if (isPlayer || att > 0.5) {
          this.burst(0.09, 'bandpass', 3200, 0.07 * att, pan, 0, 1800, 2.2);
          this.tone(150, 0.09, 'sine', 0.06 * att, 0, pan, 90);
        }
        break;
      case 'waveLand':
        // Landed a WAVE FLIP: a light whoosh and a two-note lift (smaller than a trick fanfare).
        if (isPlayer) {
          this.burst(0.45, 'bandpass', 700, 0.12, 0, 0, 2600, 1.1);
          [784, 1175].forEach((f, i) => this.tone(f, 0.1, 'triangle', 0.045, 0.04 + i * 0.05));
        }
        break;
      case 'land':
        this.tone(110, 0.3, 'sine', (0.15 + e.value * 0.3) * att, 0, pan, 38);
        this.burst(0.7 + e.value * 0.5, 'lowpass', 2400, (0.12 + e.value * 0.25) * att, pan, 0, 300);
        if (isPlayer && e.text === 'clean') [660, 990].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.05, 0.06 + i * 0.06));
        break;
      case 'collide': {
        const hard = e.text === 'rock' || e.text === 'pile' || e.text === 'island';
        this.tone(90, 0.25, 'sine', (0.15 + e.value * 0.35) * att, 0, pan, 40);
        this.burst(0.3, hard ? 'bandpass' : 'lowpass', hard ? 1800 : 900, (0.1 + e.value * 0.25) * att, pan, 0, 400);
        if (hard) this.tone(420, 0.18, 'square', 0.04 * att, 0, pan, 200);
        if (e.text === 'mine') {
          this.burst(1.6, 'lowpass', 1600, 0.6 * att, pan, 0, 60, 0.4);
          this.tone(60, 0.8, 'sine', 0.4 * att, 0, pan, 25);
        }
        break;
      }
      case 'buoyHit':
        this.tone(330, 0.2, 'triangle', 0.06 * att, 0, pan, 260);
        break;
      case 'wipeout':
        this.burst(1.2, 'bandpass', 900, 0.35 * att, pan, 0, 200);
        if (isPlayer) this.tone(300, 0.5, 'sawtooth', 0.06, 0, 0, 80);
        break;
      case 'driftTier':
        if (isPlayer) this.sparkTier(e.value);
        break;
      case 'boostStart':
      case 'nitro':
      case 'boostPad':
        if (isPlayer || att > 0.3) {
          this.burst(0.8, 'bandpass', 600, 0.22 * att, pan, 0, 3500, 1.2);
          this.tone(90, 0.5, 'sawtooth', 0.08 * att, 0, pan, 180);
        }
        break;
      case 'trick':
        if (isPlayer) {
          this.burst(0.35, 'bandpass', 1500, 0.08, 0, 0, 4000, 2);
          [880, 1108, 1318].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.05, i * 0.05));
        }
        break;
      case 'launch':
        if (isPlayer) this.burst(0.4, 'highpass', 1800, 0.05);
        break;
      case 'checkpoint':
        if (isPlayer) {
          this.tone(1046, 0.12, 'triangle', 0.08);
          this.tone(1568, 0.18, 'triangle', 0.07, 0.08);
        }
        break;
      case 'lap':
        if (isPlayer) [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'square', 0.05, i * 0.07));
        break;
      case 'finalLap':
        [784, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'sawtooth', 0.05, 0.4 + i * 0.16));
        break;
      case 'countdown':
        if (e.value > 0) this.tone(440, 0.22, 'square', 0.1);
        else {
          this.tone(880, 0.6, 'square', 0.1);
          this.tone(1320, 0.6, 'square', 0.05);
        }
        break;
      case 'finish':
        if (isPlayer) {
          [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.07, i * 0.09));
          [262, 330, 392].forEach((f) => this.tone(f, 1.4, 'sawtooth', 0.03, 0.45));
        }
        break;
      case 'wrongWay':
        this.tone(140, 0.25, 'sawtooth', 0.07);
        this.tone(140, 0.25, 'sawtooth', 0.07, 0.3);
        break;
      case 'falseStart':
        this.tone(110, 0.5, 'sawtooth', 0.1, 0, 0, 70);
        break;
      case 'perfectStart':
        [1046, 1568].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.08, i * 0.06));
        break;
      case 'overtake':
        this.tone(1318, 0.08, 'square', 0.035);
        break;
      case 'ring':
        [1568, 2093].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.08, i * 0.05));
        break;
      case 'lightning':
        this.burst(0.12, 'highpass', 3000, 0.12 * e.value);
        this.thunderQ.push({ t: 0.6 + Math.random() * 1.6, s: e.value });
        break;
      case 'reset':
        if (isPlayer) this.tone(600, 0.25, 'sine', 0.06, 0, 0, 1200);
        break;
      case 'itemPickup':
        if (isPlayer) [660, 880, 1320, 1760].forEach((f, i) => this.tone(f, 0.08, 'square', 0.04, i * 0.04));
        break;
      case 'itemReady':
        // Roulette lands: a bright two-note "ta-da".
        if (isPlayer) {
          this.tone(1318, 0.09, 'square', 0.045);
          this.tone(1976, 0.22, 'triangle', 0.06, 0.07);
        }
        break;
      case 'itemDenied':
        if (isPlayer) {
          this.tone(150, 0.09, 'square', 0.05);
          this.tone(120, 0.12, 'square', 0.05, 0.1);
        }
        break;
      case 'itemUse':
        if (e.text === 'torpedo' || e.text === 'torpedo3') {
          // Tube thump + hiss of the launch.
          this.tone(130, 0.18, 'sine', 0.16 * att, 0, pan, 60);
          this.burst(0.7, 'bandpass', 2400, 0.18 * att, pan, 0, 500, 1.5);
          this.tone(240, 0.4, 'sawtooth', 0.05 * att, 0, pan, 90);
        } else if (e.text === 'oil') this.burst(0.5, 'lowpass', 500, 0.15 * att, pan, 0, 150);
        else if (e.text === 'shield') [523, 784, 1046].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.05 * att, i * 0.03, pan));
        else if (e.text === 'wave') {
          this.tone(55, 1.0, 'sine', 0.35 * att, 0, pan, 30);
          this.burst(1.5, 'lowpass', 1400, 0.4 * att, pan, 0, 200);
        } else if (e.text === 'turbo') {
          this.tone(220, 0.35, 'sawtooth', 0.06 * att, 0, pan, 880);
        } else if (e.text === 'homer') {
          // Launch: ignition crack, then a rising rocket whoosh that pans away.
          this.burst(0.15, 'highpass', 2500, 0.2 * att, pan);
          this.burst(1.3, 'bandpass', 500, 0.3 * att, pan, 0.03, 4200, 1.4);
          this.tone(180, 1.1, 'sawtooth', 0.06 * att, 0.03, pan, 720);
          if (isPlayer) [784, 988].forEach((f, i) => this.tone(f, 0.12, 'square', 0.04, 0.15 + i * 0.09));
        } else if (e.text === 'surge') {
          // Golden chime on every pump, over a short throaty kick.
          [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.05 * att, i * 0.03, pan));
          this.burst(0.5, 'bandpass', 700, 0.2 * att, pan, 0, 3800, 1.3);
          this.tone(110, 0.4, 'sawtooth', 0.08 * att, 0, pan, 260);
        } else if (e.text === 'storm') {
          // Global: static crackle, a whip-crack of thunder and a rolling tail.
          this.burst(0.25, 'highpass', 4000, 0.22);
          this.burst(0.09, 'bandpass', 2000, 0.3, 0, 0.05, 0, 3);
          this.burst(0.09, 'bandpass', 2600, 0.25, 0, 0.16, 0, 3);
          this.thunder(0.9);
          if (isPlayer) [523, 784, 1046, 1568].forEach((f, i) => this.tone(f, 0.18, 'square', 0.035, 0.1 + i * 0.05));
        }
        break;
      case 'itemLock':
        // Seeker lock: an alarm on first lock, then beeps that rise in pitch and rate.
        if (!isPlayer || e.racer < 0) break;
        if (e.text === 'start') {
          this.tone(880, 0.14, 'square', 0.07);
          this.tone(660, 0.14, 'square', 0.07, 0.16);
          this.tone(880, 0.14, 'square', 0.07, 0.32);
        } else this.tone(900 + e.value * 900, 0.06, 'square', 0.035 + e.value * 0.03);
        break;
      case 'itemMiss':
        if (!isPlayer) break;
        if (e.text === 'dodge') {
          // Cleared it: a cheeky upward swish.
          this.burst(0.35, 'bandpass', 900, 0.12, 0, 0, 4000, 2);
          [988, 1318, 1760].forEach((f, i) => this.tone(f, 0.1, 'triangle', 0.05, i * 0.05));
        } else {
          // Your shot fizzled: a soft deflating whiff.
          this.tone(440, 0.3, 'triangle', 0.035, 0, 0, 220);
        }
        break;
      case 'itemHit':
        // Unowned splashes (expired shots) fade with distance like any world sound.
        if (e.racer < 0) {
          const far = clamp01(1 - d / 150);
          if (far <= 0.01) break;
          if (e.text === 'homer-miss') {
            this.tone(48, 1.0, 'sine', 0.3 * far, 0, pan, 22);
            this.burst(1.8, 'lowpass', 2000, 0.35 * far, pan, 0, 60, 0.4);
          } else this.burst(0.8, 'lowpass', 1400, 0.25 * far, pan, 0, 120, 0.5);
          break;
        }
        if (e.text === 'storm') {
          // Zap + the shrink: a wobbling "bwoo-oop" sliding down.
          this.burst(0.12, 'highpass', 3500, 0.12 * att, pan);
          this.tone(900, 0.45, 'sine', (isPlayer ? 0.09 : 0.04) * att, 0.03, pan, 220);
          this.tone(1350, 0.45, 'triangle', (isPlayer ? 0.04 : 0.02) * att, 0.03, pan, 330);
          break;
        }
        if (e.text === 'homer' || e.text === 'homer-miss') {
          // Seeker impact: a deep boom with a long rumbling tail and falling water.
          const big = e.text === 'homer' ? 1 : 0.6;
          this.tone(48, 1.2, 'sine', 0.5 * att * big, 0, pan, 22);
          this.burst(2.2, 'lowpass', 2200, 0.55 * att * big, pan, 0, 60, 0.4);
          this.burst(1.4, 'bandpass', 1300, 0.18 * att * big, pan, 0.25, 300);
          if (isPlayer && e.racer >= 0) this.tone(300, 0.6, 'sawtooth', 0.07, 0.05, 0, 70);
          break;
        }
        this.burst(1.2, 'lowpass', 1800, 0.45 * att, pan, 0, 80, 0.4);
        this.tone(70, 0.6, 'sine', 0.3 * att, 0, pan, 30);
        if (isPlayer) this.tone(300, 0.4, 'sawtooth', 0.06, 0.05, 0, 90);
        break;
      case 'shieldHit':
        // Shield block: a glassy ping and a bright deflect.
        [1568, 1175, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.07 * att, i * 0.05, pan));
        this.tone(2400, 0.3, 'sine', 0.04 * att, 0, pan, 1600);
        break;
      case 'collectible':
        [1046, 1318, 1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.35, 'sine', 0.07, i * 0.07));
        break;
      case 'weatherShift':
        this.tone(80, 2.5, 'sine', 0.12, 0, 0, 55);
        break;
    }
  }

  // ── Mix polish, ducking and character voices ──────────────────────────────
  // Kept apart from the SFX switch above so item/SFX edits there don't collide.

  /** master → glue compressor → limiter → soft clipper → destination. */
  private buildOutput(ctx: AudioContext) {
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    // Linear to 0.7, then a tanh knee that never exceeds 0.98: no hard clipping.
    this.clipper = ctx.createWaveShaper();
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const a = Math.abs(x);
      const y = a <= 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28);
      curve[i] = Math.sign(x) * y;
    }
    this.clipper.curve = curve;
    this.clipper.oversample = '2x';
    this.master.connect(this.comp).connect(this.limiter).connect(this.clipper).connect(ctx.destination);
  }

  /** Resume the context whenever it is suspended/interrupted and the user interacts again. */
  private watchResume() {
    const again = () => this.resume();
    window.addEventListener('pointerdown', again, true);
    window.addEventListener('keydown', again, true);
    window.addEventListener('touchend', again, true);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) again();
    });
  }

  private resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    ctx.resume().catch(() => {});
  }

  /** Dip the music by `depth` (0..1) for `hold` seconds, then recover smoothly. */
  duck(depth: number, hold: number) {
    if (!this.ctx) return;
    const g = this.musicDuck.gain;
    const t = this.ctx.currentTime;
    const target = 1 - clamp01(depth);
    const cur = g.value;
    if (cur <= target + 0.02) return; // already ducked at least this far
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    g.setTargetAtTime(target, t, 0.015);
    g.setTargetAtTime(1, t + hold, 0.3);
  }

  /** Voice chirps and ducking for simulation events. */
  private reactExtras(e: GameEvent, isPlayer: boolean, att: number, pan: number) {
    const v = this.voice;
    switch (e.type) {
      case 'itemPickup':
        if (isPlayer) v?.pickup(e.racer);
        break;
      case 'itemHit':
        if (e.racer >= 0) v?.hit(e.racer, isPlayer ? 1 : att * 0.7, isPlayer ? 0 : pan);
        if (isPlayer || att > 0.6) this.duck(0.4 * (isPlayer ? 1 : att), 0.45);
        break;
      case 'collide':
        if (e.text === 'mine') {
          this.duck(0.55, 0.7);
          if (isPlayer) v?.hit(e.racer);
        } else if (isPlayer && e.value > 0.6) {
          this.duck(0.3 * e.value, 0.3);
          if (e.value > 0.85) v?.hit(e.racer, 0.8);
        }
        break;
      case 'wipeout':
        if (isPlayer) {
          v?.hit(e.racer);
          this.duck(0.35, 0.6);
        }
        break;
      case 'itemUse':
        if (e.text === 'wave' && att > 0.4) this.duck(0.35 * att, 0.6);
        break;
      case 'trick':
        if (isPlayer) v?.excited(e.racer);
        break;
      case 'overtake':
        v?.excited(0, e.value === 1);
        break;
      case 'perfectStart':
        v?.hup(0);
        break;
      case 'countdown':
        if (e.value === 0) v?.go(0);
        break;
      case 'finalLap':
        if (isPlayer) v?.callout(0);
        break;
      case 'wrongWay':
      case 'falseStart':
        if (isPlayer) v?.warn(0);
        break;
      case 'finish':
        if (isPlayer) v?.finish(e.racer, e.value);
        break;
      default:
        break;
    }
  }
}
