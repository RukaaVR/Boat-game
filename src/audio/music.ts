/**
 * Procedural soundtrack. A lookahead step sequencer (16th notes, scheduled
 * ~120 ms ahead on the audio clock) plays synthesised drums, bass, pads, an
 * arpeggio and — on the final lap — a lead line. Moods change the progression,
 * tempo and which layers play; boost opens a filter on the whole mix.
 *
 * Each track seeds its own key and progression, so every course has its own
 * theme while sharing an identity.
 */

import { Rng } from '../core/rng';
import type { AudioEngine } from './audio';

export type Mood = 'off' | 'menu' | 'race' | 'final' | 'results' | 'garage';

interface Style {
  bpm: number;
  kick: number[];
  snare: number[];
  hat: number[];
  bass: boolean;
  arp: boolean;
  lead: boolean;
  pad: boolean;
  swing: number;
}

const STYLES: Record<Exclude<Mood, 'off'>, Style> = {
  menu: { bpm: 100, kick: [0, 10], snare: [4, 12], hat: [2, 6, 10, 14], bass: true, arp: true, lead: false, pad: true, swing: 0.08 },
  garage: { bpm: 92, kick: [0, 8], snare: [12], hat: [4, 12], bass: true, arp: false, lead: false, pad: true, swing: 0.1 },
  race: { bpm: 132, kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], bass: true, arp: true, lead: false, pad: true, swing: 0 },
  final: { bpm: 142, kick: [0, 4, 8, 12], snare: [4, 12, 14], hat: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15], bass: true, arp: true, lead: true, pad: true, swing: 0 },
  results: { bpm: 88, kick: [0], snare: [], hat: [8], bass: false, arp: true, lead: false, pad: true, swing: 0.12 },
};

/** Minor-key progressions (scale degrees, 0-based in natural minor). */
const PROGRESSIONS = [
  [0, 5, 2, 6],
  [0, 3, 5, 4],
  [5, 3, 0, 4],
  [0, 6, 5, 6],
];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  mood: Mood = 'off';
  private style: Style = STYLES.menu;
  private step = 0;
  private nextTime = 0;
  private timer = 0;
  private root = 57; // A3
  private prog = PROGRESSIONS[0];
  private scale = MINOR;
  private melody: number[] = [];
  private bus: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private intensity = 0;
  private noiseBuf: AudioBuffer | null = null;

  constructor(private audio: AudioEngine) {}

  /** Re-key for a track (deterministic per seed). */
  seed(seed: number) {
    const r = new Rng(seed);
    this.root = 50 + r.int(0, 9);
    this.prog = PROGRESSIONS[r.int(0, PROGRESSIONS.length - 1)];
    this.melody = [];
    for (let i = 0; i < 32; i++) this.melody.push(r.next() < 0.3 ? -1 : r.int(0, 7));
  }

  setMood(m: Mood) {
    if (m === this.mood) return;
    this.mood = m;
    if (m === 'off') return;
    this.style = STYLES[m];
    this.scale = m === 'results' ? MAJOR : MINOR;
    this.ensure();
  }

  /** 0..1 boost intensity opens the music filter. */
  setIntensity(v: number) {
    this.intensity = v;
    const ctx = this.audio.ctx;
    if (!ctx || !this.filter) return;
    this.filter.frequency.setTargetAtTime(2400 + v * 9000, ctx.currentTime, 0.12);
  }

  private ensure() {
    const ctx = this.audio.ctx;
    if (!ctx) return;
    if (!this.bus) {
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 2400;
      this.filter.Q.value = 0.8;
      this.bus = ctx.createGain();
      this.bus.gain.value = 0.9;
      this.bus.connect(this.filter).connect(this.audio.musicBus);
    }
    if (!this.timer) {
      this.nextTime = ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
  }

  stop() {
    this.mood = 'off';
  }

  private schedule() {
    const ctx = this.audio.ctx;
    if (!ctx || this.mood === 'off' || ctx.state !== 'running') {
      if (ctx) this.nextTime = ctx.currentTime + 0.05;
      return;
    }
    const st = this.style;
    const stepDur = 60 / st.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const t = this.nextTime + (s % 2 === 1 ? st.swing * stepDur : 0);
      const chordDeg = this.prog[bar % this.prog.length];
      if (st.kick.includes(s)) this.kick(t);
      if (st.snare.includes(s)) this.snare(t);
      if (st.hat.includes(s)) this.hat(t, s % 4 === 2 ? 0.05 : 0.03);
      if (st.bass && (s % 2 === 0 || this.mood === 'final')) {
        const oct = s % 8 === 6 ? 12 : 0;
        this.bass(t, this.note(chordDeg, -12) + oct, stepDur * 1.6);
      }
      if (st.pad && s === 0) this.pad(t, chordDeg, stepDur * 16);
      if (st.arp && s % (this.mood === 'results' ? 4 : 2) === 0) {
        const pattern = [0, 2, 4, 7, 4, 2, 0, 2];
        const deg = chordDeg + pattern[(s / 2) % 8];
        this.pluck(t, this.note(deg, 12), stepDur * 1.8, this.mood === 'results' ? 0.05 : 0.035);
      }
      if (st.lead && s % 2 === 0) {
        const m = this.melody[(bar * 8 + s / 2) % this.melody.length];
        if (m >= 0) this.lead(t, this.note(chordDeg + m, 12), stepDur * 2);
      }
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private note(deg: number, octave: number) {
    const n = this.scale.length;
    const o = Math.floor(deg / n);
    const d = ((deg % n) + n) % n;
    return this.root + octave + o * 12 + this.scale[d];
  }

  private out(g: GainNode) {
    g.connect(this.bus!);
  }

  private kick(t: number) {
    const ctx = this.audio.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g);
    this.out(g);
    o.start(t);
    o.stop(t + 0.3);
  }

  private noise(t: number, dur: number, type: BiquadFilterType, freq: number, vol: number) {
    const ctx = this.audio.ctx!;
    if (!this.noiseBuf) {
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g);
    this.out(g);
    src.start(t, Math.random() * 0.7, dur + 0.02);
  }

  private snare(t: number) {
    this.noise(t, 0.18, 'bandpass', 1800, 0.22);
    const ctx = this.audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g);
    this.out(g);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, vol: number) {
    this.noise(t, 0.05, 'highpass', 7000, vol);
  }

  private bass(t: number, midi: number, dur: number) {
    const ctx = this.audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(900 + this.intensity * 600, t);
    f.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g);
    this.out(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private pad(t: number, deg: number, dur: number) {
    const ctx = this.audio.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + dur * 0.25);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g);
    this.out(g);
    for (const off of [0, 2, 4]) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(this.note(deg + off, 0));
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  private pluck(t: number, midi: number, dur: number, vol: number) {
    const ctx = this.audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(400, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g);
    this.out(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private lead(t: number, midi: number, dur: number) {
    const ctx = this.audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    const v = ctx.createOscillator();
    v.frequency.value = 5.5;
    const vg = ctx.createGain();
    vg.gain.value = 6;
    v.connect(vg).connect(o.detune);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g);
    this.out(g);
    o.start(t);
    v.start(t);
    o.stop(t + dur + 0.02);
    v.stop(t + dur + 0.02);
  }
}
