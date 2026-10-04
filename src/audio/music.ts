/**
 * Procedural soundtrack. A lookahead step sequencer (16th notes, scheduled
 * ~150 ms ahead on the audio clock) plays authored songs with synthesised
 * instruments: drums (kick/snare/clap/hats/toms/crash), punchy bass, detuned
 * pads, plucky arps, piano-ish stabs and a vibrato lead (supersaw / square /
 * brass / bell). Everything is original material written in the tables below.
 *
 * Songs (one per mood):
 *   MENU    "Sky Splash"   D major, 164 BPM  — intro(4) → A verse(8) → B chorus(8), loops A↔B
 *   RACE    "Riptide Rush" A minor, ~156 BPM — intro(4) → A(8) → B hook(8), loops A↔B,
 *                           re-keyed per course; WIN / LOSE stings lead into results
 *   GARAGE  "Dry Dock"     D major, 108 BPM  — 8-bar laid-back loop
 *   RESULTS "Harbour Lights" F major, 112 BPM swung — 8-bar loop (lead only after a podium)
 *
 * Race dynamics are layers (each its own gain bus, faded on bar lines):
 *   NORMAL  drums + bass + pad + arp, lead on the hook
 *   LEADING triumph layer (brass harmony + lead everywhere)
 *   CLOSE   tension layer (16th string ostinato + ticks)
 *   BEHIND  urgent layer (galloping off-beat bass + toms)
 *   FINAL   one transition bar (fill + riser) → jump to the hook +2 semitones,
 *           +6 BPM, 16th hats/claps and an octave arp
 *   BOOST   whole-mix filter opens; a riser lands on the next downbeat with a crash
 *   FINISH  victory / lose sting on the next beat, then the results song
 *
 * Song/mood switches happen on bar lines, stings on beats; layer changes are
 * gain ramps, so nothing clicks. Finished notes disconnect themselves.
 */

import { Rng } from '../core/rng';
import type { AudioEngine } from './audio';

export type Mood = 'off' | 'menu' | 'race' | 'final' | 'results' | 'garage';

/** Per-frame race situation pushed by the game (read on bar lines). */
export interface RaceState {
  finalLap: boolean;
  /** A rival is within a small time gap ahead or behind. */
  close: boolean;
  /** 1-based place; 0 for modes without positions. */
  place: number;
  racers: number;
  boosting: boolean;
}

// ── Notation ────────────────────────────────────────────────────────────────
const QUAL: Record<string, readonly number[]> = {
  M: [0, 4, 7],
  m: [0, 3, 7],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  D7: [0, 4, 7, 10],
  sus: [0, 5, 7],
  add9: [0, 4, 7, 14],
};
interface Chord {
  r: number;
  t: readonly number[];
}
/** "9m | 5M | 2m7,7D7" → per bar, one or two (half-bar) chords; roots in semitones from the key. */
function chords(src: string): Chord[][] {
  return src.split('|').map((bar) =>
    bar
      .trim()
      .split(',')
      .map((c) => {
        const m = /^(-?\d+)(.*)$/.exec(c.trim());
        if (!m || !QUAL[m[2]]) throw new Error(`bad chord ${c}`);
        return { r: +m[1], t: QUAL[m[2]] };
      }),
  );
}
interface Note {
  n: number;
  l: number;
}
/** "12.2 15.2 -.4 | ..." → sparse array indexed by 16th step: semitone.length, '-' = rest. */
function melody(src: string): (Note | undefined)[] {
  const out: (Note | undefined)[] = [];
  let at = 0;
  for (const tok of src.split(/[\s|]+/)) {
    if (!tok) continue;
    const [n, l] = tok.split('.');
    if (n !== '-') out[at] = { n: +n, l: +l };
    at += +l;
  }
  return out;
}
/** 16-char step pattern: x = accent, o = normal, - = ghost, . = rest. */
function pat(s: string): Float32Array {
  const a = new Float32Array(16);
  for (let i = 0; i < 16; i++) a[i] = s[i] === 'x' ? 1 : s[i] === 'o' ? 0.6 : s[i] === '-' ? 0.32 : 0;
  return a;
}
interface Kit {
  kick: Float32Array;
  snare: Float32Array;
  clap: Float32Array;
  hat: Float32Array;
  open: Float32Array;
  tom: Float32Array;
}
const E = '................';
function kit(kick: string, snare: string, hat: string, open = E, clap = E, tom = E): Kit {
  return { kick: pat(kick), snare: pat(snare), hat: pat(hat), open: pat(open), clap: pat(clap), tom: pat(tom) };
}

type BassStyle = 'pump' | 'octave' | 'soft' | 'hold';
type ArpStyle = 'up16' | 'eight' | 'roll' | 'none';
type LeadVoice = 'supersaw' | 'square' | 'brass' | 'bell';

interface Section {
  bars: number;
  chords: Chord[][];
  mel?: (Note | undefined)[];
  /** Explicit harmony line for the triumph layer (else: chord tone above the melody). */
  harm?: (Note | undefined)[];
  kit: Kit;
  /** Per-bar kit overrides (stings). */
  kits?: Kit[];
  bass: BassStyle;
  arp: ArpStyle;
  pad: boolean;
  stabs?: boolean;
  /** on / off / race state decides / only after a podium. */
  lead: 'on' | 'off' | 'state' | 'won';
  voice: LeadVoice;
  fill?: boolean;
  crash?: boolean;
  pump?: boolean;
  sting?: 'win' | 'lose';
}
interface Song {
  id: string;
  bpm: number;
  /** MIDI note of the tonic in the melody octave. */
  root: number;
  swing: number;
  /** Mix lowpass when not boosting. */
  cutoff: number;
  sections: Section[];
  loop: number;
  loopEnd: number;
}

// ── Kits ────────────────────────────────────────────────────────────────────
const K_MENU_INTRO = kit('x.......x.......', E, '..o...o...o...o.');
const K_MENU_A = kit('x.....x...x.....', '....x.......x...', 'o.x.o.x.o.x.o.x.', E, E);
const K_MENU_B = kit('x...x...x...x.o.', '....x.......x...', 'xo.oxo.oxo.oxo.o', '..x...x...x...x.', '....x.......x...');
const K_RACE_INTRO = kit('x...x...x...x...', E, '..o...o...o...o.');
const K_RACE = kit('x...x...x...x...', '....x.......x...', '-.x.-.x.-.x.-.xo', '..o...o...o...o.');
const K_CHILL = kit('x......x..x.....', '....o.......o...', 'o.-.o.-.o.-.o.-.');
const K_RESULTS = kit('x.........x.....', '....o.......o...', 'o.-.o.-.o.-.o.-.');
const K_SILENT = kit(E, E, E);
const K_ROLL = kit('x.......x.......', '-.-.-.o.o-oxoxxx', E);
const K_HIT = kit('x...............', 'x...............', E);
const K_TOM = kit(E, E, E, E, E, 'x...............');

// ── Songs (original material) ──────────────────────────────────────────────
const MENU: Song = {
  id: 'menu',
  bpm: 164,
  root: 62, // D4
  swing: 0,
  cutoff: 19000,
  loop: 1,
  loopEnd: 2,
  sections: [
    {
      // Intro: hook teased on a bell over the "royal road" turnaround.
      bars: 4,
      chords: chords('5M7 | 7M | 4m7 | 9m'),
      mel: melody('19.2 16.2 17.4 14.2 12.2 14.4 | 16.3 14.3 12.2 11.2 9.2 11.4 | 12.2 11.2 9.4 16.4 14.4 | 14.4 12.4 9.8'),
      kit: K_MENU_INTRO,
      bass: 'hold',
      arp: 'eight',
      pad: true,
      lead: 'on',
      voice: 'bell',
      fill: true,
      crash: true,
    },
    {
      // A — verse: syncopated bass, 16th plucks, square lead.
      bars: 8,
      chords: chords('9m | 5M | 7M | 0M | 9m | 5M | 2m7 | 7sus,7M'),
      mel: melody(
        '-.2 9.2 9.2 12.2 14.3 12.3 9.2 | 7.4 9.2 7.2 5.4 2.4 | 4.2 4.2 7.2 9.2 11.3 9.3 7.2 | 7.3 4.3 2.2 4.8 |' +
          '-.2 9.2 9.2 12.2 14.3 16.3 14.2 | 12.4 14.2 12.2 9.4 7.4 | 7.2 7.2 9.2 7.2 5.4 4.4 | 7.4 9.4 11.4 14.4',
      ),
      kit: K_MENU_A,
      bass: 'pump',
      arp: 'up16',
      pad: true,
      lead: 'on',
      voice: 'square',
      fill: true,
      crash: true,
    },
    {
      // B — chorus: four-on-the-floor, octave bass, stabs, supersaw hook resolving to D.
      bars: 8,
      chords: chords('5M7 | 7M | 4m7 | 9m | 5M7 | 7M | 0M | 2m7,7D7'),
      mel: melody(
        '19.2 16.2 17.4 14.2 12.2 14.4 | 16.3 14.3 12.2 11.2 9.2 11.4 | 12.2 11.2 9.4 16.4 14.4 | 14.3 12.3 9.4 7.2 9.2 12.2 |' +
          '19.2 16.2 17.4 19.2 21.2 19.4 | 21.3 19.3 16.2 19.4 21.4 | 21.2 19.2 16.2 19.2 24.8 | -.4 21.2 19.2 17.2 16.2 14.2 11.2',
      ),
      kit: K_MENU_B,
      bass: 'octave',
      arp: 'up16',
      pad: true,
      stabs: true,
      lead: 'on',
      voice: 'supersaw',
      fill: true,
      crash: true,
      pump: true,
    },
  ],
};

const RACE_A_MEL = melody(
  '12.2 12.2 15.2 12.2 17.2 15.2 12.2 10.2 | 12.4 8.4 7.4 8.4 | 7.2 7.2 10.2 7.2 12.2 10.2 7.2 3.2 | 5.4 7.4 10.8 |' +
    '12.2 12.2 15.2 12.2 19.2 17.2 15.2 12.2 | 17.4 15.4 12.4 15.4 | 17.2 15.2 14.2 12.2 14.4 8.4 | 11.6 14.2 17.4 20.4',
);
const RACE_HOOK = melody(
  '12.3 15.3 17.2 19.4 17.2 15.2 | 14.3 17.3 19.2 22.4 19.2 17.2 | 24.6 22.2 19.4 15.4 | 17.3 15.3 14.2 12.8 |' +
    '12.3 15.3 17.2 19.4 20.2 19.2 | 22.3 19.3 22.2 26.4 24.2 22.2 | 23.6 20.2 19.4 17.4 | 23.4 20.4 17.4 14.4',
);
const RACE_A = 1;
const RACE_HOOK_IDX = 2;
const RACE_WIN = 3;
const RACE_LOSE = 4;

const RACE: Song = {
  id: 'race',
  bpm: 156,
  root: 57, // A3
  swing: 0,
  cutoff: 7000,
  loop: RACE_A,
  loopEnd: RACE_HOOK_IDX,
  sections: [
    { bars: 4, chords: chords('0m | 8M | 3M | 7M'), kit: K_RACE_INTRO, bass: 'hold', arp: 'up16', pad: true, lead: 'off', voice: 'supersaw', fill: true, crash: true },
    { bars: 8, chords: chords('0m | 8M | 3M | 10M | 0m | 8M | 5m | 7M'), mel: RACE_A_MEL, kit: K_RACE, bass: 'octave', arp: 'up16', pad: true, lead: 'state', voice: 'square', crash: true, pump: true },
    { bars: 8, chords: chords('8M | 10M | 0m | 0m | 8M | 10M | 7M | 7D7'), mel: RACE_HOOK, kit: K_RACE, bass: 'octave', arp: 'up16', pad: true, lead: 'on', voice: 'supersaw', fill: true, crash: true, pump: true },
    {
      // WIN sting: snare roll over VI–VII, Picardy major tonic.
      bars: 2,
      chords: chords('8M,10M | 0M'),
      mel: melody('12.2 12.2 12.2 12.2 14.4 17.4 | 24.12 -.4'),
      harm: melody('15.2 15.2 15.2 15.2 17.4 22.4 | 28.12 -.4'),
      kit: K_SILENT,
      kits: [K_ROLL, K_HIT],
      bass: 'hold',
      arp: 'none',
      pad: true,
      lead: 'on',
      voice: 'brass',
      sting: 'win',
    },
    {
      // LOSE sting: drooping chromatic line, settles on the minor third.
      bars: 2,
      chords: chords('5m | 0m'),
      mel: melody('8.4 7.4 6.4 5.4 | 3.12 -.4'),
      kit: K_SILENT,
      kits: [K_SILENT, K_TOM],
      bass: 'hold',
      arp: 'none',
      pad: true,
      lead: 'on',
      voice: 'square',
      sting: 'lose',
    },
  ],
};

const GARAGE: Song = {
  id: 'garage',
  bpm: 108,
  root: 62,
  swing: 0.08,
  cutoff: 9000,
  loop: 0,
  loopEnd: 0,
  sections: [{ bars: 8, chords: chords('9m | 5M | 7M | 0M | 9m | 5M | 2m7 | 7sus,7M'), kit: K_CHILL, bass: 'soft', arp: 'eight', pad: true, lead: 'off', voice: 'bell' }],
};

const RESULTS: Song = {
  id: 'results',
  bpm: 112,
  root: 65, // F4
  swing: 0.12,
  cutoff: 12000,
  loop: 0,
  loopEnd: 0,
  sections: [
    {
      bars: 8,
      chords: chords('0M7 | 9m7 | 2m7 | 7sus,7M | 0M7 | 9m7 | 5M7 | 7M'),
      mel: melody('7.4 4.2 7.2 12.6 11.2 | 9.6 7.2 5.4 4.4 | 2.4 5.4 9.4 7.4 | 5.8 4.4 -.4 | 7.4 4.2 7.2 12.6 14.2 | 16.4 14.4 12.4 9.4 | 9.4 12.4 14.6 12.2 | 14.4 11.4 7.8'),
      kit: K_RESULTS,
      bass: 'soft',
      arp: 'roll',
      pad: true,
      lead: 'won',
      voice: 'bell',
    },
  ],
};

const SONG_FOR: Record<Exclude<Mood, 'off' | 'final'>, Song> = { menu: MENU, race: RACE, garage: GARAGE, results: RESULTS };

const ARP_PATTERNS = [
  [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6],
  [0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 4, 3, 1],
  [0, 1, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1, 2, 3, 1],
];
const ROLL = [0, 1, 2, 3, 4, 3, 2, 1];

type LayerId = 'drums' | 'bass' | 'pad' | 'arp' | 'stabs' | 'lead' | 'triumph' | 'tension' | 'urgent' | 'final' | 'fx';
const LAYERS: readonly LayerId[] = ['drums', 'bass', 'pad', 'arp', 'stabs', 'lead', 'triumph', 'tension', 'urgent', 'final', 'fx'];
const LEVEL: Record<LayerId, number> = { drums: 1, bass: 1, pad: 1, arp: 1, stabs: 1, lead: 1, triumph: 0.85, tension: 0.8, urgent: 0.9, final: 0.85, fx: 1 };

const LOOKAHEAD = 0.15;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
/** Keep bass roots within a fifth of the tonic. */
const normRoot = (r: number) => (((r % 12) + 12) % 12 > 6 ? (((r % 12) + 12) % 12) - 12 : ((r % 12) + 12) % 12);

export class Music {
  mood: Mood = 'off';
  /** 0..1 race pressure (kept for compatibility; adds ghost hats when high). */
  pressure = 0;

  private song: Song | null = null;
  private pendingSong: Song | null = null;
  private sec = 0;
  private bar = 0;
  private step = 0;
  private nextTime = 0;
  private timer = 0;
  private bpm = 120;
  private stepDur = 0.125;
  private key = 62;
  private raceShift = 0;
  private raceBpm = 156;
  private arpPat = ARP_PATTERNS[0];

  // Race state (copied, never retained).
  private rs: RaceState = { finalLap: false, close: false, place: 0, racers: 1, boosting: false };
  private closeSeen = false;
  private closeBars = 0;
  private leadBars = 0;
  private behindBars = 0;
  private finalWant = false;
  private finalOn = false;
  private fillBar = false;
  private sting: 'win' | 'lose' | null = null;
  private won = true;
  private riserPending = false;
  private riserCool = 0;
  private crashAt = 0;
  private intensity = 0;
  private lastCut = 0;
  private lastLeadEnd = 0;
  private lastLeadMidi = 0;

  // Graph (built lazily once a context exists).
  private ctx: AudioContext | null = null;
  private mix: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private pump!: GainNode;
  private bus = {} as Record<LayerId, GainNode>;
  private on = {} as Record<LayerId, boolean>;
  private was = {} as Record<LayerId, boolean>;
  private arpL!: GainNode;
  private arpR!: GainNode;
  private revSend!: GainNode;
  private delay!: DelayNode;
  private noiseBuf!: AudioBuffer;
  private voicing: number[] = [0, 0, 0, 0];

  constructor(private audio: AudioEngine) {
    for (const id of LAYERS) this.on[id] = this.was[id] = false;
  }

  /** Re-key the race theme for a track (deterministic per seed). */
  seed(seed: number) {
    const r = new Rng(seed);
    this.raceShift = r.int(-2, 3);
    this.raceBpm = 152 + r.int(0, 6);
    this.arpPat = ARP_PATTERNS[r.int(0, ARP_PATTERNS.length - 1)];
  }

  setMood(m: Mood) {
    if (m === this.mood) return;
    const prev = this.mood;
    this.mood = m;
    this.ensure();
    if (m === 'off') {
      this.stop();
      return;
    }
    if (m === 'final') {
      this.finalWant = true;
      if (prev === 'race' && this.song === RACE) return;
      this.request(RACE);
      return;
    }
    if (m === 'results' && (prev === 'race' || prev === 'final') && this.song === RACE) {
      // Finish: sting on the next beat, then the results song.
      const p = this.rs.place;
      this.won = p <= 3;
      this.sting = this.won ? 'win' : 'lose';
      this.pendingSong = null;
      return;
    }
    if (m !== 'results') this.won = true;
    if (m === 'race') {
      this.finalWant = false;
      // Coming back from the final lap means a restart: replay the theme from its intro.
      if (prev === 'final' && this.song === RACE) {
        this.sting = null;
        this.pendingSong = RACE;
        return;
      }
    }
    this.request(SONG_FOR[m]);
  }

  setPressure(v: number) {
    this.pressure = Math.max(0, Math.min(1, v));
  }

  /** Feed the race situation every frame; changes are applied on bar lines. */
  setRaceState(s: RaceState) {
    const r = this.rs;
    if (s.boosting && !r.boosting && this.song === RACE && !this.sting && this.ctx && this.ctx.currentTime > this.riserCool) this.riserPending = true;
    r.finalLap = s.finalLap;
    r.close = s.close;
    r.place = s.place;
    r.racers = s.racers;
    r.boosting = s.boosting;
    if (s.close) this.closeSeen = true;
    if (s.finalLap && this.mood !== 'results') this.finalWant = true;
  }

  /** 0..1 boost intensity opens the music filter. */
  setIntensity(v: number) {
    this.intensity = v;
    const ctx = this.audio.ctx;
    if (!ctx || !this.filter || !this.song) return;
    const base = this.song.cutoff;
    const cut = base + v * (19500 - base);
    if (Math.abs(cut - this.lastCut) < 40) return;
    this.lastCut = cut;
    this.filter.frequency.setTargetAtTime(cut, ctx.currentTime, 0.12);
  }

  stop() {
    this.mood = 'off';
    this.song = null;
    this.pendingSong = null;
    this.sting = null;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const id of LAYERS) {
      this.bus[id].gain.setTargetAtTime(0, t, 0.2);
      this.on[id] = this.was[id] = false;
    }
  }

  /** Debug/test snapshot (allocates; not for per-frame use). */
  debug() {
    const layers: string[] = [];
    for (const id of LAYERS) if (this.on[id]) layers.push(id);
    return { mood: this.mood, song: this.song?.id ?? 'none', section: this.sec, bar: this.bar, bpm: this.bpm, key: this.key, final: this.finalOn, sting: this.sting, layers };
  }

  // ── Transport ─────────────────────────────────────────────────────────────
  private request(song: Song) {
    if (!this.song) {
      this.pendingSong = song;
      this.bar = 0;
      this.step = 0;
      if (this.ctx) this.nextTime = this.ctx.currentTime + 0.06;
      return;
    }
    if (song === this.song && !this.sting) {
      this.pendingSong = null;
      return;
    }
    this.sting = null;
    this.pendingSong = song;
  }

  private ensure() {
    if (!this.timer) this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private build(ctx: AudioContext) {
    this.ctx = ctx;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 19000;
    this.filter.Q.value = 0.7;
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.85;
    this.mix.connect(this.filter).connect(this.audio.musicBus);
    this.pump = ctx.createGain();
    this.pump.connect(this.mix);
    // Reverb: generated stereo impulse, one convolver shared by all sends.
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.7);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 400 ? i / 400 : 1);
    }
    conv.buffer = ir;
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 1;
    const revRet = ctx.createGain();
    revRet.gain.value = 0.32;
    this.revSend.connect(conv).connect(revRet).connect(this.mix);
    // Tempo delay for the lead.
    this.delay = ctx.createDelay(2);
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 3200;
    const dret = ctx.createGain();
    dret.gain.value = 0.22;
    const dpan = ctx.createStereoPanner();
    dpan.pan.value = 0.35;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    dlp.connect(dret).connect(dpan).connect(this.mix);
    // Layer buses.
    for (const id of LAYERS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(id === 'pad' || id === 'arp' || id === 'stabs' || id === 'tension' ? this.pump : this.mix);
      this.bus[id] = g;
    }
    const send = (id: LayerId, amt: number) => {
      const s = ctx.createGain();
      s.gain.value = amt;
      this.bus[id].connect(s).connect(this.revSend);
    };
    send('pad', 0.35);
    send('lead', 0.22);
    send('arp', 0.18);
    send('stabs', 0.2);
    send('tension', 0.15);
    send('triumph', 0.25);
    const dsend = ctx.createGain();
    dsend.gain.value = 0.5;
    this.bus.lead.connect(dsend).connect(this.delay);
    this.arpL = ctx.createGain();
    this.arpR = ctx.createGain();
    const pl = ctx.createStereoPanner();
    pl.pan.value = -0.4;
    const pr = ctx.createStereoPanner();
    pr.pan.value = 0.4;
    this.arpL.connect(pl).connect(this.bus.arp);
    this.arpR.connect(pr).connect(this.bus.arp);
    // Two seconds of white noise for drums and risers.
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  private schedule() {
    const ctx = this.audio.ctx;
    if (!ctx) return;
    if (!this.mix) this.build(ctx);
    if (this.mood === 'off' || ctx.state !== 'running' || (!this.song && !this.pendingSong)) {
      this.nextTime = ctx.currentTime + 0.06;
      return;
    }
    // Fell behind (tab throttled)? Re-anchor rather than burst-schedule.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.tick(this.nextTime);
      this.nextTime += this.stepDur;
    }
  }

  private setSong(song: Song, t: number) {
    this.song = song;
    this.sec = 0;
    this.bar = 0;
    this.step = 0;
    this.sting = null;
    const race = song === RACE;
    this.bpm = race ? this.raceBpm : song.bpm;
    this.key = song.root + (race ? this.raceShift : 0);
    this.finalOn = false;
    this.fillBar = false;
    this.leadBars = this.behindBars = this.closeBars = 0;
    this.crashAt = 0;
    this.stepDur = 60 / this.bpm / 4;
    this.delay.delayTime.setTargetAtTime(this.stepDur * 3, t, 0.05);
    this.lastCut = song.cutoff + this.intensity * (19500 - song.cutoff);
    this.filter!.frequency.setTargetAtTime(this.lastCut, t, 0.1);
  }

  private tick(t0: number) {
    // Finish sting: on the next beat.
    if (this.sting && this.song === RACE && this.step % 4 === 0) {
      this.sec = this.sting === 'win' ? RACE_WIN : RACE_LOSE;
      this.sting = null;
      this.bar = 0;
      this.step = 0;
    }
    if (this.step === 0) this.onBar(t0);
    const song = this.song;
    if (!song) return;
    const sec = song.sections[this.sec];
    const s = this.step;
    const bar = this.bar;
    const abs = bar * 16 + s;
    const sd = this.stepDur;
    const t = t0 + (s % 2 === 1 ? song.swing * sd : 0);
    const cb = sec.chords[bar % sec.chords.length];
    const ch = cb.length > 1 && s >= 8 ? cb[1] : cb[0];
    const race = song === RACE;
    const fill = !sec.sting && ((sec.fill && bar === sec.bars - 1) || this.fillBar);

    // Crash after a riser / on section downbeats.
    if (this.crashAt && t0 >= this.crashAt - sd * 0.5) {
      this.crash(t0, 0.9);
      this.crashAt = 0;
    } else if (s === 0 && bar === 0 && sec.crash) this.crash(t0, 0.8);

    // Drums.
    if (this.active('drums')) {
      const k = sec.kits ? sec.kits[bar] ?? sec.kit : sec.kit;
      const d = this.bus.drums;
      if (fill && s >= 8) {
        if (s === 8 || s === 14) this.kick(t, 0.9, d);
        if (s === 8 || s === 10 || s >= 12) this.snare(t, 0.45 + (s - 8) * 0.08, d);
        if (s === 12 || s === 13) this.tom(t, s === 12 ? 190 : 150, 0.6, d);
      } else {
        if (k.kick[s]) {
          this.kick(t, k.kick[s], d);
          if (sec.pump && k.kick[s] >= 0.9) this.pumpAt(t);
        }
        if (k.snare[s]) this.snare(t, k.snare[s], d);
        if (k.clap[s]) this.clap(t, k.clap[s] * 0.8, d);
        if (k.hat[s]) this.hat(t, k.hat[s], false, d);
        else if (race && this.pressure > 0.6 && s % 2 === 1) this.hat(t, 0.25, false, d);
        if (k.open[s]) this.hat(t, k.open[s], true, d);
        if (k.tom[s]) this.tom(t, 110, k.tom[s], d);
      }
    }
    // Final-lap percussion: straight 16th hats and claps on the backbeat.
    if (race && this.active('final') && !fill) {
      const f = this.bus.final;
      if (s % 2 === 1) this.hat(t, s % 4 === 3 ? 0.55 : 0.35, false, f);
      if (s === 4 || s === 12) this.clap(t, 0.7, f);
    }
    // Urgent toms (BEHIND).
    if (race && this.active('urgent') && !fill && (s === 7 || s === 11 || s === 14 || s === 15)) this.tom(t, s === 15 ? 95 : s === 14 ? 120 : 150, 0.5, this.bus.urgent);

    // Bass.
    const bassRoot = this.key - 24 + normRoot(ch.r);
    if (this.active('bass')) {
      const b = this.bus.bass;
      switch (sec.bass) {
        case 'pump':
          if (s === 0 || s === 3 || s === 8 || s === 11) this.bassNote(t, bassRoot + (s === 11 ? 7 : 0), sd * 2.6, 1, b);
          else if (s === 6 || s === 14) this.bassNote(t, bassRoot + 12, sd * 1.6, 0.8, b);
          break;
        case 'octave':
          if (s % 2 === 0) this.bassNote(t, bassRoot + (s % 4 === 2 ? 12 : 0), sd * 1.7, s % 4 === 0 ? 1 : 0.8, b);
          break;
        case 'soft':
          if (s === 0 || s === 8) this.bassNote(t, bassRoot, sd * 5.5, 0.8, b);
          else if (s === 6 || s === 14) this.bassNote(t, bassRoot + 7, sd * 1.6, 0.6, b);
          break;
        case 'hold':
          if (s === 0 || (s === 8 && cb.length > 1)) this.bassNote(t, bassRoot, sd * (cb.length > 1 ? 7.5 : 15), 0.9, b);
          break;
      }
    }
    if (race && this.active('urgent') && s % 2 === 1) this.bassNote(t, bassRoot + 12, sd * 0.8, 0.55, this.bus.urgent);

    // Pad (whole chord, voice-led around G3..F#4).
    if (sec.pad && this.active('pad') && (s === 0 || (s === 8 && cb.length > 1))) {
      this.voice(ch, 55);
      this.pad(t, this.voicing, ch.t.length, sd * (cb.length > 1 ? 8 : 16));
    }

    // Arp.
    if (sec.arp !== 'none' && this.active('arp')) {
      this.voice(ch, 64);
      const n = ch.t.length;
      let idx = -1;
      let len = sd * 1.6;
      if (sec.arp === 'up16') idx = (song === MENU ? ARP_PATTERNS[0] : this.arpPat)[s];
      else if (sec.arp === 'eight' && s % 2 === 0) {
        idx = [0, 2, 1, 3, 2, 1, 3, 4][s / 2];
        len = sd * 2.4;
      } else if (sec.arp === 'roll' && s % 2 === 0) {
        idx = ROLL[s / 2];
        len = sd * 3;
      }
      if (idx >= 0) {
        const m = this.voicing[idx % n] + 12 * Math.floor(idx / n);
        this.pluck(t, m, len, s % 4 === 0 ? 1 : 0.75, s % 2 === 0 ? this.arpL : this.arpR);
      }
    }
    // Final-lap octave arp.
    if (race && this.active('final') && s % 2 === 0) {
      this.voice(ch, 76);
      const i = this.arpPat[(s + 4) % 16];
      this.pluck(t, this.voicing[i % ch.t.length] + 12 * Math.floor(i / ch.t.length), sd * 1.4, 0.6, this.bus.final);
    }

    // Stabs (offbeat piano-ish chords).
    if (sec.stabs && this.active('stabs') && (s === 2 || s === 6 || s === 10 || s === 13)) {
      this.voice(ch, 60);
      this.stab(t, this.voicing, ch.t.length, s === 13 ? 0.7 : 1);
    }

    // Tension ostinato (CLOSE).
    if (race && this.active('tension')) {
      this.voice(ch, 64);
      const m = s % 4 === 2 ? this.voicing[2 % ch.t.length] : s % 2 === 1 ? this.voicing[1] + 12 : this.voicing[0] + 12;
      this.string(t, m, sd * 0.9, s % 4 === 0 ? 1 : 0.65);
      if (s % 2 === 0) this.tick16(t);
    }

    // Lead + triumph harmony.
    const note = sec.mel?.[abs];
    if (note) {
      const midi = this.key + note.n;
      const dur = note.l * sd;
      if (this.active('lead')) this.lead(t, midi, dur, 1, sec.voice, this.bus.lead);
      if (this.active('triumph')) {
        const h = sec.harm?.[abs];
        const hm = h ? this.key + h.n : this.toneAbove(midi, ch);
        this.lead(t, hm, dur, 0.7, 'brass', this.bus.triumph);
      }
    }
    // Triumph swell on downbeats where the melody rests.
    if (race && !sec.sting && this.active('triumph') && s === 0 && !note) {
      this.voice(ch, 67);
      this.lead(t, this.voicing[0] + 12, sd * 6, 0.5, 'brass', this.bus.triumph);
    }

    // Boost riser: lands on a downbeat with a crash.
    if (this.riserPending) {
      this.riserPending = false;
      let steps = 16 - s;
      if (steps < 6) steps += 16;
      const dur = steps * sd;
      this.riser(t0, dur);
      this.crashAt = t0 + dur;
      this.riserCool = t0 + dur + sd * 32;
    }

    // Advance.
    this.step++;
    if (this.step >= 16) {
      this.step = 0;
      this.bar++;
      if (this.bar >= sec.bars) {
        this.bar = 0;
        if (sec.sting) this.pendingSong = RESULTS;
        else this.sec = this.sec >= song.loopEnd ? song.loop : this.sec + 1;
      }
    }
  }

  private onBar(t: number) {
    if (this.pendingSong) {
      const s = this.pendingSong;
      this.pendingSong = null;
      this.setSong(s, t);
    }
    const song = this.song;
    if (!song) return;
    // FINAL LAP: one transition bar (fill + riser), then the hook up a whole tone.
    if (song === RACE && this.finalWant && !this.finalOn && !song.sections[this.sec].sting) {
      if (!this.fillBar) {
        this.fillBar = true;
        this.riser(t, this.stepDur * 16);
        this.crashAt = t + this.stepDur * 16;
      } else {
        this.fillBar = false;
        this.finalOn = true;
        this.key += 2;
        this.bpm += 6;
        this.stepDur = 60 / this.bpm / 4;
        this.delay.delayTime.setTargetAtTime(this.stepDur * 3, t, 0.05);
        this.sec = RACE_HOOK_IDX;
        this.bar = 0;
      }
    } else this.fillBar = this.fillBar && this.finalWant && !this.finalOn;
    this.evalLayers(t);
  }

  private evalLayers(t: number) {
    const song = this.song!;
    const sec = song.sections[this.sec];
    const race = song === RACE;
    const st = this.rs;
    const positional = race && !sec.sting && st.place > 0 && st.racers > 1;
    this.leadBars = positional && st.place === 1 ? this.leadBars + 1 : 0;
    this.behindBars = positional && st.place > Math.min(3, st.racers - 1) ? this.behindBars + 1 : 0;
    this.closeBars = this.closeSeen ? 2 : Math.max(0, this.closeBars - 1);
    this.closeSeen = false;
    const leading = this.leadBars >= 2;
    const want = (id: LayerId): boolean => {
      switch (id) {
        case 'drums':
        case 'bass':
        case 'fx':
          return true;
        case 'pad':
          return sec.pad;
        case 'arp':
          return sec.arp !== 'none';
        case 'stabs':
          return !!sec.stabs;
        case 'lead':
          return sec.lead === 'on' || (sec.lead === 'state' && (this.finalOn || leading)) || (sec.lead === 'won' && this.won);
        case 'triumph':
          return (positional && leading) || sec.sting === 'win';
        case 'tension':
          return positional && this.closeBars > 0;
        case 'urgent':
          return positional && this.behindBars >= 2;
        case 'final':
          return race && this.finalOn && !sec.sting;
      }
    };
    const beat = this.stepDur * 4;
    for (const id of LAYERS) {
      const w = want(id);
      this.was[id] = this.on[id];
      if (w === this.on[id]) continue;
      this.on[id] = w;
      this.bus[id].gain.setTargetAtTime(w ? LEVEL[id] : 0, t, w ? beat * 0.12 : beat * 0.3);
    }
  }

  private active(id: LayerId) {
    return this.on[id] || this.was[id];
  }

  /** Close voicing of `ch` with every tone in [lo, lo+12). */
  private voice(ch: Chord, lo: number) {
    const v = this.voicing;
    for (let i = 0; i < ch.t.length; i++) {
      const pc = this.key + ch.r + ch.t[i];
      v[i] = lo + ((((pc - lo) % 12) + 12) % 12);
    }
    // Sort ascending (≤4 items) so arp indices climb.
    for (let i = 1; i < ch.t.length; i++) {
      const x = v[i];
      let j = i - 1;
      while (j >= 0 && v[j] > x) {
        v[j + 1] = v[j];
        j--;
      }
      v[j + 1] = x;
    }
  }

  /** Nearest chord tone at least a minor third above `m`. */
  private toneAbove(m: number, ch: Chord) {
    let best = m + 4;
    let bestD = 99;
    for (let i = 0; i < ch.t.length; i++) {
      const pc = (((this.key + ch.r + ch.t[i]) % 12) + 12) % 12;
      let n = m + 3 + ((((pc - (m + 3)) % 12) + 12) % 12);
      if (n - m > 9) n -= 12;
      const d = n - m;
      if (d >= 3 && d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // ── Instruments ───────────────────────────────────────────────────────────
  private free(src: AudioScheduledSourceNode, out: AudioNode) {
    src.onended = () => out.disconnect();
  }

  private env(g: GainNode, t: number, a: number, peak: number, end: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
  }

  private pumpAt(t: number) {
    const p = this.pump.gain;
    p.setValueAtTime(1, t);
    p.linearRampToValueAtTime(0.5, t + 0.01);
    p.linearRampToValueAtTime(1, t + this.stepDur * 2.6);
  }

  private noise(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, vol: number, dest: AudioNode, attack = 0.001) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, vol, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * Math.max(0, 1.9 - dur));
    src.stop(t + dur + 0.02);
    this.free(src, g);
    return g;
  }

  private kick(t: number, vel: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.62 * vel, t + 0.32);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.34);
    this.free(o, g);
  }

  private snare(t: number, vel: number, dest: AudioNode) {
    const g = this.noise(t, 0.17, 'highpass', 1400, 0.7, 0.26 * vel, dest);
    g.connect(this.revSend);
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const og = ctx.createGain();
    this.env(og, t, 0.002, 0.22 * vel, t + 0.1);
    o.connect(og).connect(dest);
    o.start(t);
    o.stop(t + 0.12);
    this.free(o, og);
  }

  private clap(t: number, vel: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 1.1;
    const g = ctx.createGain();
    const v = 0.3 * vel;
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 3; i++) {
      const ti = t + i * 0.011;
      g.gain.linearRampToValueAtTime(v, ti + 0.001);
      g.gain.linearRampToValueAtTime(v * 0.25, ti + 0.009);
    }
    g.gain.linearRampToValueAtTime(v * 0.8, t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    src.connect(f).connect(g).connect(dest);
    g.connect(this.revSend);
    src.start(t, Math.random());
    src.stop(t + 0.22);
    this.free(src, g);
  }

  private hat(t: number, vel: number, open: boolean, dest: AudioNode) {
    this.noise(t, open ? 0.24 : 0.045, 'highpass', open ? 7000 : 8000, 0.8, (open ? 0.07 : 0.085) * vel, dest);
  }

  private tom(t: number, freq: number, vel: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.22);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.36 * vel, t + 0.26);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.28);
    this.free(o, g);
  }

  private crash(t: number, vel: number) {
    const g = this.noise(t, 1.5, 'highpass', 4800, 0.5, 0.11 * vel, this.bus.drums, 0.002);
    g.connect(this.revSend);
  }

  private tick16(t: number) {
    this.noise(t, 0.025, 'bandpass', 5200, 3, 0.07, this.bus.tension);
  }

  private bassNote(t: number, midi: number, dur: number, vel: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const f0 = mtof(midi);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f0;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f0;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(1500 + this.intensity * 900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + Math.max(0.08, dur));
    const g = ctx.createGain();
    this.env(g, t, 0.004, 0.17 * vel, t + dur);
    const sg = ctx.createGain();
    sg.gain.value = 0.9;
    o.connect(f).connect(g);
    sub.connect(sg).connect(g);
    g.connect(dest);
    o.start(t);
    sub.start(t);
    o.stop(t + dur + 0.02);
    sub.stop(t + dur + 0.02);
    this.free(o, g);
  }

  private pad(t: number, notes: number[], n: number, dur: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1700;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    const lvl = 0.05 / Math.sqrt(n);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(lvl, t + Math.min(0.12, dur * 0.2));
    g.gain.setValueAtTime(lvl, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.08);
    f.connect(g).connect(this.bus.pad);
    let last: OscillatorNode | null = null;
    for (let i = 0; i < n; i++) {
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(notes[i]);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.1);
        last = o;
      }
    }
    if (last) this.free(last, g);
  }

  private pluck(t: number, midi: number, dur: number, vel: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(4200 + this.intensity * 3000, t);
    f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.045 * vel, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.free(o, g);
  }

  private stab(t: number, notes: number[], n: number, vel: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    const g = ctx.createGain();
    this.env(g, t, 0.002, (0.07 / Math.sqrt(n)) * vel, t + 0.16);
    f.connect(g).connect(this.bus.stabs);
    let last: OscillatorNode | null = null;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'square' : 'triangle';
      o.frequency.value = mtof(notes[i] + 12);
      o.connect(f);
      o.start(t);
      o.stop(t + 0.18);
      last = o;
    }
    if (last) this.free(last, g);
  }

  private string(t: number, midi: number, dur: number, vel: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = ctx.createGain();
    this.env(g, t, 0.004, 0.04 * vel, t + dur);
    o.connect(f).connect(g).connect(this.bus.tension);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.free(o, g);
  }

  private lead(t: number, midi: number, dur: number, vel: number, voice: LeadVoice, dest: GainNode) {
    const ctx = this.ctx!;
    const f0 = mtof(midi);
    const bell = voice === 'bell';
    // Legato glide from the previous lead note (vocal-like portamento).
    const glide = dest === this.bus.lead && !bell && Math.abs(t - this.lastLeadEnd) < 0.03 && Math.abs(midi - this.lastLeadMidi) <= 7 && this.lastLeadMidi > 0;
    const fromF = mtof(this.lastLeadMidi);
    if (dest === this.bus.lead) {
      this.lastLeadEnd = t + dur;
      this.lastLeadMidi = midi;
    }
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.connect(g).connect(dest);
    const hold = bell ? 0 : dur * 0.94;
    const rel = bell ? Math.min(1.2, dur + 0.4) : 0.1;
    const end = t + hold + rel;
    const peak = vel * (voice === 'supersaw' ? 0.05 : voice === 'square' ? 0.055 : voice === 'brass' ? 0.06 : 0.08);
    g.gain.setValueAtTime(0.0001, t);
    if (bell) {
      g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
    } else {
      g.gain.exponentialRampToValueAtTime(peak, t + (voice === 'brass' ? 0.03 : 0.012));
      g.gain.setTargetAtTime(peak * 0.8, t + 0.04, 0.1);
      g.gain.setTargetAtTime(0.0001, t + hold, rel / 5);
    }
    if (voice === 'brass') {
      f.frequency.setValueAtTime(700, t);
      f.frequency.exponentialRampToValueAtTime(3200, t + 0.06);
      f.frequency.exponentialRampToValueAtTime(1900, t + 0.3);
    } else f.frequency.value = bell ? 6000 : 5200 + this.intensity * 4000;

    const dets = voice === 'supersaw' ? [-14, 0, 14] : voice === 'brass' ? [-7, 7] : [0];
    const type: OscillatorType = voice === 'square' ? 'square' : bell ? 'triangle' : 'sawtooth';
    // Delayed vibrato.
    let vib: GainNode | null = null;
    let lfo: OscillatorNode | null = null;
    if (!bell && dur > 0.18) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = 5.6;
      vib = ctx.createGain();
      vib.gain.setValueAtTime(0, t);
      vib.gain.linearRampToValueAtTime(0, t + 0.14);
      vib.gain.linearRampToValueAtTime(voice === 'square' && dest === this.bus.lead && this.song?.sections[this.sec].sting === 'lose' ? 45 : 16, t + 0.4);
      lfo.connect(vib);
      lfo.start(t);
      lfo.stop(end + 0.02);
    }
    let last: OscillatorNode | null = null;
    for (const d of dets) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = d;
      if (glide) {
        o.frequency.setValueAtTime(fromF, t);
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.035);
      } else o.frequency.value = f0;
      if (vib) vib.connect(o.detune);
      o.connect(f);
      o.start(t);
      o.stop(end + 0.02);
      last = o;
    }
    if (bell) {
      // Octave sparkle.
      const o = ctx.createOscillator();
      o.frequency.value = f0 * 2;
      const og = ctx.createGain();
      this.env(og, t, 0.002, peak * 0.35, t + 0.25);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 0.27);
    }
    if (last) this.free(last, g);
  }

  private riser(t: number, dur: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.97);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.02);
    src.connect(f).connect(g).connect(this.bus.fx);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(mtof(this.key - 12), t);
    o.frequency.exponentialRampToValueAtTime(mtof(this.key + 12), t + dur);
    const og = ctx.createGain();
    og.gain.value = 0.08;
    o.connect(og).connect(f);
    src.start(t);
    o.start(t);
    src.stop(t + dur + 0.05);
    o.stop(t + dur + 0.05);
    this.free(src, g);
  }
}
