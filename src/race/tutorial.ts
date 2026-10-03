/**
 * GUIDED TUTORIAL — a scripted lesson on Coral Cove.
 *
 * Each step watches the real simulation (speed, heading, events) and advances
 * when the player has actually done the thing: no step completes on a timer.
 * Steps that need a set-up (ramp approach, the start countdown) stage it by
 * placing the player, so a failed attempt just re-stages and tries again.
 * The HUD turns step ids into text with the player's own key bindings.
 */

import type { GameEvent } from '../core/events';
import { settleBoat } from '../boat/boatPhysics';
import type { RaceSession } from './session';

export type TutorialStep = 'throttle' | 'steer' | 'checkpoint' | 'drift' | 'release' | 'nitro' | 'ramp' | 'trick' | 'land' | 'start' | 'done';
export const TUTORIAL_STEPS: TutorialStep[] = ['throttle', 'steer', 'checkpoint', 'drift', 'release', 'nitro', 'ramp', 'trick', 'land', 'start', 'done'];

export class Tutorial {
  index = 0;
  /** Seconds the current step has run. */
  t = 0;
  /** Short feedback line ("Too early!"), cleared after a moment. */
  feedback = '';
  feedbackT = 0;
  /** Seconds of the "well done" flash between steps. */
  cheer = 0;
  private turned = 0;
  private prevHeading = 0;
  private cpAtStart = 0;
  private nitroT = 0;
  private staged = false;
  private sawCountdown = false;

  constructor(private s: RaceSession) {
    this.prevHeading = s.player.boat.heading;
  }

  get step(): TutorialStep {
    return TUTORIAL_STEPS[this.index];
  }
  get done() {
    return this.step === 'done';
  }
  get progress() {
    return { i: Math.min(this.index + 1, TUTORIAL_STEPS.length - 1), n: TUTORIAL_STEPS.length - 1 };
  }

  private next() {
    this.index++;
    this.t = 0;
    this.staged = false;
    this.cheer = 1.2;
    this.feedback = '';
    const b = this.s.player.boat;
    this.cpAtStart = this.s.player.checkpoints;
    this.turned = 0;
    if (this.step === 'nitro') b.nitro = 1;
    if (this.step === 'done') {
      const p = this.s.player;
      p.finished = true;
      p.finishTime = this.s.raceTime;
      this.s.events.push('finish', 0, b.position.x, b.position.y, b.position.z, 1);
      this.s.forceFinish();
    }
  }

  private say(text: string) {
    this.feedback = text;
    this.feedbackT = 2.2;
  }

  /** Put the player 55 m before the first ramp, rolling at speed. */
  private stageRamp(boost = false) {
    const s = this.s;
    // The tallest ramp gives the most hang time to learn on.
    const r = s.track.ramps.reduce<(typeof s.track.ramps)[number] | null>((a, x) => (!a || x.height > a.height ? x : a), null);
    if (!r) return;
    const b = s.player.boat;
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    b.place(r.x - fx * 55, r.z - fz * 55, r.heading);
    settleBoat(b, s.time);
    const v = boost ? 34 : 26;
    b.velocity.set(fx * v, 0, fz * v);
    b.forwardSpeed = v;
    b.engine = 1;
    if (boost) {
      // A free boost into the ramp: more hang time while learning tricks.
      b.boostTime = 2.2;
      b.boostStrength = 1;
    }
    s.player.hint = -1;
    this.staged = true;
    this.t = 0;
  }

  update(dt: number, events: readonly GameEvent[]) {
    const s = this.s;
    const b = s.player.boat;
    this.t += dt;
    this.cheer = Math.max(0, this.cheer - dt);
    if (this.feedbackT > 0) {
      this.feedbackT -= dt;
      if (this.feedbackT <= 0) this.feedback = '';
    }
    let dh = b.heading - this.prevHeading;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    this.prevHeading = b.heading;
    const mine = (type: string) => events.some((e) => e.racer === 0 && e.type === type);
    const ev = (type: string) => events.find((e) => e.racer === 0 && e.type === type);

    switch (this.step) {
      case 'throttle':
        if (b.speed > 15) this.next();
        break;
      case 'steer':
        this.turned += Math.abs(dh);
        if (this.turned > 2.2 && b.speed > 8) this.next();
        break;
      case 'checkpoint':
        if (s.player.checkpoints >= this.cpAtStart + 1 && mine('checkpoint')) this.next();
        break;
      case 'drift': {
        const e = ev('driftTier');
        if (e && e.value >= 2) this.next();
        else if (mine('boostStart')) this.say('Hold the drift longer — wait for ORANGE');
        break;
      }
      case 'release': {
        const e = ev('boostStart');
        if (e) this.next();
        break;
      }
      case 'nitro':
        if (b.nitroActive) this.nitroT += dt;
        if (this.nitroT > 1.0) this.next();
        if (b.nitro < 0.15 && !b.nitroActive) b.nitro = 1;
        break;
      case 'ramp':
        if (!this.staged) this.stageRamp();
        if (mine('launch') || b.airTime > 0.5) this.next();
        else if (this.t > 9) {
          this.say('Line up with the orange ramp and keep the throttle down');
          this.t = 0;
          this.staged = false;
        }
        break;
      case 'trick':
        if (!this.staged) this.stageRamp(true);
        if (this.t > 8) {
          this.say('Hit the ramp at full speed, then hold DRIFT + a direction');
          this.staged = false;
        }
        if (mine('trick')) this.next();
        else if (mine('wipeout')) {
          this.say('Bailed! Finish the trick before you touch down');
          this.staged = false;
        } else if (mine('land') && this.t > 1) {
          this.say('No trick that time — try again');
          this.staged = false;
        }
        break;
      case 'land': {
        if (!this.staged) this.stageRamp(true);
        if (this.t > 8) {
          // A hop too short to count as a landing: line up again.
          this.say('Hit the ramp at full speed for a proper jump');
          this.staged = false;
        }
        const e = ev('land');
        if (e && e.text === 'clean') this.next();
        else if (e || mine('wipeout')) {
          this.say('Not quite level — keep the nose matched to the water');
          this.staged = false;
        }
        break;
      }
      case 'start':
        if (!this.staged) {
          // Line up on the grid and run a real countdown.
          const tp = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 };
          s.track.gridSlot(0, tp);
          b.place(tp.x, tp.z, tp.heading);
          settleBoat(b, s.time);
          s.player.hint = -1;
          s.startState = 'none';
          s.stats.perfectStart = false;
          s.setPhase('countdown');
          this.staged = true;
          this.sawCountdown = true;
        }
        if (this.sawCountdown && s.phase === 'racing' && this.t > 0.2) {
          if (s.stats.perfectStart) this.next();
          else {
            this.say(s.startState === 'false' ? 'Too early — the engine flooded! Wait for 1' : 'Too late — press the throttle while 1 is showing');
            this.staged = false;
          }
        }
        break;
      case 'done':
        break;
    }
  }
}
