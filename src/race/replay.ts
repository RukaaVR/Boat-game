/**
 * REPLAYS — record the whole race, play it back from any camera.
 *
 * Recording samples every boat's pose and the few state flags the visuals
 * read (boost, drift, air, wipeout, damage, shield) at 20 Hz, plus the global
 * clock and sea state, plus the events that make sound and spray. Playback
 * interpolates those samples back into the live Boat objects and re-emits the
 * events, so the existing world, wakes, particles and audio redraw the race
 * exactly as it happened, at any speed. Pose playback (rather than re-running
 * the simulation from inputs) can never drift out of sync.
 */

import type { GameEventType } from '../core/events';
import type { EventQueue } from '../core/events';
import { getChop, getSeaState, setSeaState, setWaveTime } from '../water/waves';
import type { RaceSession } from './session';

export const REPLAY_HZ = 20;
/** Floats per racer per sample. */
const RF = 15;
/** Global floats per sample: session time, race time, sea, chop. */
const GF = 4;

const RECORDED: ReadonlySet<GameEventType> = new Set<GameEventType>(['land', 'splash', 'collide', 'trick', 'wipeout', 'boostStart', 'nitro', 'finish', 'lap', 'itemUse', 'itemHit', 'shieldHit', 'driftTier', 'buoyHit', 'checkpoint', 'collectible', 'lightning']);

interface RecEvent {
  t: number;
  type: GameEventType;
  racer: number;
  x: number;
  y: number;
  z: number;
  value: number;
  text: string;
}

export class ReplayRecorder {
  private data: Float32Array;
  private n = 0;
  private acc = 0;
  readonly events: RecEvent[] = [];
  readonly racers: number;
  /** Max recorded length, seconds. */
  readonly maxSeconds = 600;

  constructor(private session: RaceSession) {
    this.racers = session.racers.length;
    this.data = new Float32Array(this.stride * REPLAY_HZ * 60);
  }

  get stride() {
    return GF + this.racers * RF;
  }
  get samples() {
    return this.n;
  }
  get duration() {
    return Math.max(0, (this.n - 1) / REPLAY_HZ);
  }

  /** Call after each simulation step with the step's real dt. */
  record(dt: number, events: EventQueue) {
    const s = this.session;
    if (s.phase === 'intro' || this.n >= this.maxSeconds * REPLAY_HZ) return;
    const t = this.n / REPLAY_HZ + this.acc;
    for (const e of events.list) if (RECORDED.has(e.type)) this.events.push({ t, type: e.type, racer: e.racer, x: e.x, y: e.y, z: e.z, value: e.value, text: e.text });
    this.acc += dt;
    if (this.n > 0 && this.acc < 1 / REPLAY_HZ) return;
    this.acc = this.n > 0 ? this.acc - 1 / REPLAY_HZ : 0;
    const st = this.stride;
    if ((this.n + 1) * st > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const d = this.data;
    let o = this.n * st;
    d[o++] = s.time;
    d[o++] = s.raceTime;
    d[o++] = getSeaState();
    d[o++] = getChop();
    for (const r of s.racers) {
      const b = r.boat;
      d[o++] = b.position.x;
      d[o++] = b.position.y;
      d[o++] = b.position.z;
      d[o++] = b.heading;
      d[o++] = b.pitch;
      d[o++] = b.roll;
      d[o++] = b.visPitch;
      d[o++] = b.visYaw;
      d[o++] = b.visRoll;
      d[o++] = b.boostLevel;
      d[o++] = b.drifting ? b.driftDir * (1 + b.driftTier) : 0;
      d[o++] = (b.airborne ? 1 : 0) + (b.wipeout > 0 ? 2 : 0);
      d[o++] = b.damage;
      d[o++] = b.shield;
      d[o++] = r.controls.steer;
    }
    this.n++;
  }

  /** Snapshot for playback. */
  finish(): ReplayData {
    return { data: this.data.slice(0, this.n * this.stride), samples: this.n, racers: this.racers, events: this.events.slice() };
  }
}

export interface ReplayData {
  data: Float32Array;
  samples: number;
  racers: number;
  events: RecEvent[];
}

const lerpAng = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

export class ReplayPlayer {
  t = 0;
  speed = 1;
  playing = true;
  private evIdx = 0;
  readonly duration: number;

  constructor(
    readonly rep: ReplayData,
    private session: RaceSession,
  ) {
    this.duration = Math.max(0, (rep.samples - 1) / REPLAY_HZ);
  }

  restart() {
    this.t = 0;
    this.evIdx = 0;
  }

  /** Advance playback by real dt; writes boat state and re-emits events. */
  update(dt: number, events: EventQueue) {
    const prevT = this.t;
    if (this.playing) this.t = Math.min(this.duration, this.t + dt * this.speed);
    if (this.t >= this.duration) this.playing = false;
    this.apply(this.t, dt * this.speed);
    const evs = this.rep.events;
    if (this.t < prevT) this.evIdx = 0;
    while (this.evIdx < evs.length && evs[this.evIdx].t <= this.t) {
      const e = evs[this.evIdx++];
      if (e.t > prevT || this.t === 0) events.push(e.type, e.racer, e.x, e.y, e.z, e.value, e.text);
    }
  }

  private apply(t: number, dt: number) {
    const r = this.rep;
    const st = GF + r.racers * RF;
    const f = Math.min(r.samples - 1, t * REPLAY_HZ);
    const i = Math.min(r.samples - 2, Math.floor(f));
    const k = Math.max(0, Math.min(1, f - i));
    const a = Math.max(0, i) * st;
    const bOff = a + st;
    const d = r.data;
    const L = (o: number) => d[a + o] + (d[bOff + o] - d[a + o]) * k;
    const s = this.session;
    s.time = L(0);
    s.raceTime = L(1);
    setWaveTime(s.time);
    const sea = L(2);
    const ch = L(3);
    if (Math.abs(sea - getSeaState()) > 1e-3 || Math.abs(ch - getChop()) > 1e-3) setSeaState(sea, ch);
    for (let ri = 0; ri < r.racers; ri++) {
      const racer = s.racers[ri];
      if (!racer) continue;
      const b = racer.boat;
      const o = GF + ri * RF;
      const px = b.position.x;
      const pz = b.position.z;
      const py = b.position.y;
      b.position.set(L(o), L(o + 1), L(o + 2));
      if (dt > 1e-4) b.velocity.set((b.position.x - px) / dt, (b.position.y - py) / dt, (b.position.z - pz) / dt);
      if (b.velocity.lengthSq() > 80 * 80) b.velocity.set(0, 0, 0);
      b.heading = lerpAng(d[a + o + 3], d[bOff + o + 3], k);
      b.pitch = L(o + 4);
      b.roll = L(o + 5);
      b.visPitch = lerpAng(d[a + o + 6], d[bOff + o + 6], k);
      b.visYaw = lerpAng(d[a + o + 7], d[bOff + o + 7], k);
      b.visRoll = lerpAng(d[a + o + 8], d[bOff + o + 8], k);
      b.boostLevel = L(o + 9);
      const dr = d[a + o + 10];
      b.drifting = dr !== 0;
      b.driftDir = Math.sign(dr);
      b.driftTier = Math.max(0, Math.abs(dr) - 1);
      const flags = d[a + o + 11];
      b.airborne = (flags & 1) === 1;
      b.wipeout = flags & 2 ? 0.5 : 0;
      b.damage = d[a + o + 12];
      b.shield = d[a + o + 13];
      racer.controls.steer = L(o + 14);
      const fx = Math.sin(b.heading);
      const fz = Math.cos(b.heading);
      b.forwardSpeed = b.velocity.x * fx + b.velocity.z * fz;
      b.wet = b.airborne ? 0 : 1;
      b.surfaceY = b.position.y - 0.1;
      b.ghostTime = 0;
      // Engine note for the audio: rough RPM from speed and boost.
      b.engine = b.speed > 2 ? 1 : 0;
      b.rpm = Math.min(1, 0.2 + 0.6 * Math.min(1, b.speed / b.spec.topSpeed) + 0.2 * b.boostLevel);
    }
  }
}
