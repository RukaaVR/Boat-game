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
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicBus.connect(this.musicFilter).connect(this.master);
    this.sfx.connect(this.master);
    this.master.connect(this.comp).connect(ctx.destination);
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
  }

  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;

  /** Output meter (tests/debug): RMS and absolute peak of the master bus right now. */
  meter() {
    if (!this.ctx) return { rms: 0, peak: 0, state: 'none' };
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.comp.connect(this.analyser);
      this.meterBuf = new Float32Array(this.analyser.fftSize);
    }
    this.analyser.getFloatTimeDomainData(this.meterBuf!);
    let s = 0;
    let p = 0;
    for (const v of this.meterBuf!) {
      s += v * v;
      p = Math.max(p, Math.abs(v));
    }
    return { rms: Math.sqrt(s / this.meterBuf!.length), peak: p, state: this.ctx.state };
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
    this.boostRoar!.frequency.setTargetAtTime(70 + rpm * 60, t, 0.05);
    this.boostRoarGain!.gain.setTargetAtTime(mute * player.boostLevel * 0.07, t, 0.05);
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

  click(kind: 'move' | 'select' | 'back' | 'deny' = 'move') {
    if (!this.ctx) return;
    const now = performance.now();
    if (kind === 'move' && now - this.lastClick < 40) return;
    this.lastClick = now;
    if (kind === 'move') this.tone(1800, 0.04, 'square', 0.025);
    else if (kind === 'select') {
      this.tone(880, 0.06, 'square', 0.05);
      this.tone(1320, 0.1, 'square', 0.04, 0.05);
    } else if (kind === 'back') this.tone(600, 0.08, 'triangle', 0.06, 0, 0, 380);
    else this.tone(160, 0.18, 'sawtooth', 0.06);
  }

  unlockSting() {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.07, i * 0.07));
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
    switch (e.type) {
      case 'splash':
        this.burst(0.5 + e.value * 0.4, 'bandpass', 1200, (0.08 + e.value * 0.2) * att, pan, 0, 300);
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
        if (isPlayer) this.tone(500 + e.value * 220, 0.12, 'square', 0.06, 0, 0, 700 + e.value * 300);
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
      case 'itemUse':
        if (e.text === 'torpedo') {
          this.burst(0.7, 'bandpass', 2400, 0.18 * att, pan, 0, 500, 1.5);
          this.tone(240, 0.4, 'sawtooth', 0.05 * att, 0, pan, 90);
        } else if (e.text === 'oil') this.burst(0.5, 'lowpass', 500, 0.15 * att, pan, 0, 150);
        else if (e.text === 'shield') [523, 784, 1046].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.05 * att, i * 0.03, pan));
        else if (e.text === 'wave') {
          this.tone(55, 1.0, 'sine', 0.35 * att, 0, pan, 30);
          this.burst(1.5, 'lowpass', 1400, 0.4 * att, pan, 0, 200);
        }
        break;
      case 'itemHit':
        this.burst(1.2, 'lowpass', 1800, 0.45 * att, pan, 0, 80, 0.4);
        this.tone(70, 0.6, 'sine', 0.3 * att, 0, pan, 30);
        if (isPlayer) this.tone(300, 0.4, 'sawtooth', 0.06, 0.05, 0, 90);
        break;
      case 'shieldHit':
        [1568, 1175, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.07 * att, i * 0.05, pan));
        break;
      case 'collectible':
        [1046, 1318, 1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.35, 'sine', 0.07, i * 0.07));
        break;
      case 'weatherShift':
        this.tone(80, 2.5, 'sine', 0.12, 0, 0, 55);
        break;
    }
  }
}
