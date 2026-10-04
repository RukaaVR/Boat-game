/**
 * Synthesised character voices — short syllable-like chirps ("ya!", "woo!",
 * "oof", "uh-oh", "go!") built from a glottal source (saw/square + breath
 * noise) pushed through three parallel formant band-passes whose centre
 * frequencies glide between vowel targets. No samples, no speech engine.
 *
 * Every racer id maps to a voice profile (pitch, vocal-tract size, timbre,
 * vibrato, tempo), so rivals sound distinct. Each category has a per-racer
 * cooldown and the bank caps simultaneous voices, so pack racing never turns
 * into a chorus. All output goes to the SFX bus handed in by the engine.
 */

type Formants = readonly [number, number, number];

/** Vowel / consonant formant targets (Hz) for a ~child/young-adult tract. */
const VOWEL: Record<string, Formants> = {
  a: [850, 1450, 2800],
  e: [560, 2100, 2950],
  i: [320, 2600, 3300],
  o: [520, 900, 2650],
  u: [360, 820, 2450],
  '@': [660, 1300, 2650], // "uh"
  f: [1500, 3600, 6200], // fricative hiss band
};

/** Keyframe: [time s, vowel, voiced amp 0..1, noise amp 0..1, pitch multiplier]. */
type Key = readonly [number, string, number, number, number];

export type Syllable = 'ya' | 'yay' | 'woo' | 'hey' | 'hai' | 'hup' | 'oof' | 'ugh' | 'uhoh' | 'go';

const SYL: Record<Syllable, readonly Key[]> = {
  ya: [[0, 'i', 0, 0, 1.05], [0.025, 'i', 0.7, 0, 1.15], [0.075, 'a', 1, 0, 1.32], [0.17, 'a', 0.85, 0, 1.12], [0.24, 'a', 0, 0, 0.92]],
  yay: [[0, 'i', 0, 0, 1.1], [0.03, 'i', 0.7, 0, 1.2], [0.1, 'e', 1, 0, 1.45], [0.26, 'i', 0.8, 0, 1.38], [0.38, 'i', 0, 0, 1.15]],
  woo: [[0, 'u', 0, 0, 0.9], [0.04, 'u', 0.8, 0, 0.95], [0.16, 'u', 1, 0, 1.35], [0.3, 'o', 0.9, 0, 1.55], [0.42, 'o', 0, 0, 1.4]],
  hey: [[0, 'e', 0, 0.6, 1.2], [0.04, 'e', 0.3, 0.3, 1.2], [0.07, 'e', 1, 0, 1.3], [0.16, 'i', 0.8, 0, 1.25], [0.22, 'i', 0, 0, 1.1]],
  hai: [[0, 'a', 0, 0.5, 1.15], [0.035, 'a', 0.4, 0.2, 1.2], [0.06, 'a', 1, 0, 1.3], [0.13, 'i', 0.8, 0, 1.4], [0.2, 'i', 0, 0, 1.3]],
  hup: [[0, '@', 0, 0.6, 1.1], [0.035, '@', 0.3, 0.3, 1.1], [0.055, '@', 1, 0, 1.15], [0.11, 'u', 0.9, 0, 1.05], [0.125, 'u', 0, 0, 1.0]],
  oof: [[0, 'o', 0, 0.2, 1.0], [0.02, 'o', 1, 0.05, 1.0], [0.1, 'u', 0.8, 0, 0.82], [0.15, 'u', 0.15, 0.25, 0.75], [0.17, 'f', 0, 0.5, 0.7], [0.27, 'f', 0, 0, 0.7]],
  ugh: [[0, '@', 0, 0.3, 0.95], [0.03, '@', 1, 0.1, 0.95], [0.14, '@', 0.6, 0.15, 0.75], [0.2, '@', 0, 0.1, 0.7]],
  uhoh: [[0, '@', 0, 0, 1.2], [0.02, '@', 1, 0, 1.25], [0.12, '@', 0.8, 0, 1.2], [0.14, '@', 0, 0, 1.1], [0.17, 'o', 0, 0, 0.95], [0.2, 'o', 1, 0, 0.98], [0.36, 'u', 0.7, 0, 0.85], [0.46, 'u', 0, 0, 0.8]],
  go: [[0, 'u', 0, 0.4, 1.1], [0.02, 'u', 0.6, 0.1, 1.15], [0.06, 'o', 1, 0, 1.35], [0.22, 'o', 0.85, 0, 1.3], [0.32, 'u', 0, 0, 1.05]],
};

interface Profile {
  /** Base pitch (Hz). */
  f0: number;
  /** Formant scale: >1 = smaller, brighter tract. */
  tract: number;
  wave: OscillatorType;
  /** Breathiness mixed under voiced parts. */
  breath: number;
  vibRate: number;
  vibCents: number;
  /** Duration multiplier. */
  speed: number;
}

/** One profile per racer slot (id mod length). Slot 0 is the player. */
const PROFILES: readonly Profile[] = [
  { f0: 300, tract: 1.1, wave: 'sawtooth', breath: 0.06, vibRate: 6, vibCents: 25, speed: 1 },
  { f0: 390, tract: 1.22, wave: 'sawtooth', breath: 0.08, vibRate: 7, vibCents: 35, speed: 0.92 },
  { f0: 175, tract: 0.9, wave: 'sawtooth', breath: 0.1, vibRate: 5, vibCents: 18, speed: 1.08 },
  { f0: 260, tract: 1.0, wave: 'square', breath: 0.05, vibRate: 5.5, vibCents: 22, speed: 1 },
  { f0: 450, tract: 1.28, wave: 'square', breath: 0.07, vibRate: 7.5, vibCents: 40, speed: 0.88 },
  { f0: 145, tract: 0.84, wave: 'sawtooth', breath: 0.12, vibRate: 4.5, vibCents: 15, speed: 1.15 },
  { f0: 340, tract: 1.15, wave: 'square', breath: 0.06, vibRate: 6.5, vibCents: 30, speed: 0.95 },
  { f0: 220, tract: 0.96, wave: 'sawtooth', breath: 0.09, vibRate: 5, vibCents: 20, speed: 1.05 },
];

const enum Cat {
  Pickup,
  Excited,
  Hit,
  Warn,
  Confirm,
  Go,
  Finish,
  Count,
}
const COOLDOWN = [1.2, 2.6, 0.9, 3.5, 0.3, 1.0, 4.0];
const MAX_RACERS = 32;
const MAX_ACTIVE = 4;
/** Makeup gain after the formant filters (band-passes eat a lot of energy). */
const LEVEL = 0.55;

export class VoiceBank {
  private cool = new Float64Array(MAX_RACERS * Cat.Count);
  private active = 0;

  constructor(
    private ctx: AudioContext,
    private dest: AudioNode,
    private noiseBuf: AudioBuffer,
  ) {}

  // ── Public cues ─────────────────────────────────────────────────────────
  /** Item box grabbed. */
  pickup(racer: number, vol = 1, pan = 0) {
    if (this.gate(racer, Cat.Pickup)) this.say(Math.random() < 0.6 ? 'ya' : 'hey', racer, vol * 0.8, pan);
  }
  /** Overtake, took the lead, landed a trick. `big` = first place / big moment. */
  excited(racer: number, big = false, vol = 1, pan = 0) {
    if (!this.gate(racer, Cat.Excited)) return;
    this.say(big ? (Math.random() < 0.5 ? 'woo' : 'yay') : Math.random() < 0.5 ? 'ya' : 'hup', racer, vol, pan);
  }
  /** Small effort grunt (perfect start, ramp launch). */
  hup(racer: number, vol = 1, pan = 0) {
    if (this.gate(racer, Cat.Excited)) this.say('hup', racer, vol * 0.85, pan);
  }
  /** Hit by an item, wiped out, heavy crash. */
  hit(racer: number, vol = 1, pan = 0) {
    if (this.gate(racer, Cat.Hit)) this.say(Math.random() < 0.65 ? 'oof' : 'ugh', racer, vol, pan);
  }
  /** Warning callout: wrong way, false start. */
  warn(racer: number, vol = 1) {
    if (this.gate(racer, Cat.Warn)) this.say('uhoh', racer, vol * 0.9, 0);
  }
  /** Final-lap / attention callout. */
  callout(racer: number, vol = 1) {
    if (this.gate(racer, Cat.Warn)) this.say('hey', racer, vol, 0);
  }
  /** Countdown GO. */
  go(racer: number, vol = 1) {
    if (this.gate(racer, Cat.Go)) this.say('go', racer, vol, 0);
  }
  /** Menu confirmation chirp (player voice, quiet). */
  confirm(vol = 0.45) {
    if (this.gate(0, Cat.Confirm)) this.say('hai', 0, vol, 0);
  }
  /** Crossed the line: cheer on a podium, groan otherwise. */
  finish(racer: number, place: number, vol = 1) {
    if (!this.gate(racer, Cat.Finish)) return;
    this.say(place <= 1 ? 'yay' : place <= 3 ? 'woo' : 'uhoh', racer, vol, 0);
  }

  // ── Internals ───────────────────────────────────────────────────────────
  private gate(racer: number, cat: Cat) {
    if (this.active >= MAX_ACTIVE) return false;
    const i = (((racer % MAX_RACERS) + MAX_RACERS) % MAX_RACERS) * Cat.Count + cat;
    const now = this.ctx.currentTime;
    if (now < this.cool[i]) return false;
    this.cool[i] = now + COOLDOWN[cat];
    return true;
  }

  /** Render one syllable for `racer` (profile = id mod 8). */
  say(id: Syllable, racer: number, vol = 1, pan = 0) {
    const ctx = this.ctx;
    if (ctx.state !== 'running' || vol <= 0.01) return;
    const p = PROFILES[((racer % PROFILES.length) + PROFILES.length) % PROFILES.length];
    const keys = SYL[id];
    const t0 = ctx.currentTime + 0.01;
    const sp = p.speed * (0.94 + Math.random() * 0.12);
    const pitch = p.f0 * (0.95 + Math.random() * 0.1);
    const end = t0 + keys[keys.length - 1][0] * sp;

    // Source: glottal oscillator with delayed vibrato + breath noise.
    const osc = ctx.createOscillator();
    osc.type = p.wave;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.vibRate;
    const lfoG = ctx.createGain();
    lfoG.gain.setValueAtTime(0, t0);
    lfoG.gain.linearRampToValueAtTime(p.vibCents, t0 + 0.12 * sp);
    lfo.connect(lfoG).connect(osc.detune);
    const voiced = ctx.createGain();
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const noiseG = ctx.createGain();
    const sum = ctx.createGain();
    osc.connect(voiced).connect(sum);
    noise.connect(noiseG).connect(sum);

    // Three formant band-passes in parallel.
    const out = ctx.createGain();
    out.gain.value = vol * LEVEL;
    const f1 = ctx.createBiquadFilter();
    const f2 = ctx.createBiquadFilter();
    const f3 = ctx.createBiquadFilter();
    const filters = [f1, f2, f3];
    const fGain = [1, 0.75, 0.4];
    const fQ = [7, 11, 14];
    for (let i = 0; i < 3; i++) {
      const f = filters[i];
      f.type = 'bandpass';
      f.Q.value = fQ[i];
      const g = ctx.createGain();
      g.gain.value = fGain[i] * (1 + i * 0.4); // high formants need lift
      sum.connect(f).connect(g).connect(out);
    }
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(this.dest);

    // Keyframe automation.
    for (let k = 0; k < keys.length; k++) {
      const [kt, v, amp, nz, pm] = keys[k];
      const t = t0 + kt * sp;
      const fm = VOWEL[v] ?? VOWEL.a;
      const fr = pitch * pm;
      const breath = amp * p.breath;
      if (k === 0) {
        osc.frequency.setValueAtTime(fr, t);
        voiced.gain.setValueAtTime(amp, t);
        noiseG.gain.setValueAtTime(nz + breath, t);
        for (let i = 0; i < 3; i++) filters[i].frequency.setValueAtTime(fm[i] * p.tract, t);
      } else {
        osc.frequency.exponentialRampToValueAtTime(fr, t);
        voiced.gain.linearRampToValueAtTime(amp, t);
        noiseG.gain.linearRampToValueAtTime(nz + breath, t);
        for (let i = 0; i < 3; i++) filters[i].frequency.linearRampToValueAtTime(fm[i] * p.tract, t);
      }
    }

    osc.start(t0);
    lfo.start(t0);
    noise.start(t0, Math.random() * Math.max(0, this.noiseBuf.duration - 1));
    const stop = end + 0.03;
    osc.stop(stop);
    lfo.stop(stop);
    noise.stop(stop);
    this.active++;
    osc.onended = () => {
      this.active--;
      panner.disconnect();
      out.disconnect();
      sum.disconnect();
    };
  }
}
