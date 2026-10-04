/**
 * BATTLE SPECTATE — when a human is knocked out of a BALLOONS battle the fight
 * runs on and their camera follows the other boats.
 *
 * By default it follows the current leader (holding each pick a moment so the
 * view doesn't flap); steering left / right (keys, stick, touch) or the ◀ ▶
 * buttons cycle through the fighters still afloat and lock onto that boat until
 * it is knocked out too. SKIP TO RESULTS (confirm / item, or the button) settles
 * the battle from the current standings — in split-screen once both players are
 * out. One Spectator per human, drawn inside that player's HUD viewport.
 */

import type { Controls } from '../core/types';
import type { Racer } from '../race/racer';
import type { RaceSession } from '../race/session';

/** Minimum seconds on one boat before auto-follow switches to a new leader. */
const AUTO_HOLD = 2.5;

export class Spectator {
  readonly el: HTMLElement;
  private nameEl: HTMLElement;
  private skipEl: HTMLElement;
  private cur: Racer | null = null;
  /** Following the leader automatically (until the player picks a boat). */
  private auto = true;
  private holdT = 0;
  private prevSteer = 0;
  private prevItem = true;
  private shown = false;
  private lastKey = '';
  /** Set when the target changed this frame (the camera cuts). */
  changed = false;

  constructor(
    private session: RaceSession,
    readonly me: Racer,
    parent: HTMLElement,
    private onSkip: () => void,
  ) {
    const el = (this.el = document.createElement('div'));
    el.className = 'spectate';
    el.style.display = 'none';
    el.innerHTML = `<div class="sp-title">SPECTATING — KNOCKED OUT</div>
      <div class="sp-row"><button data-sp="prev" aria-label="Previous boat">◀</button><span class="sp-name"></span><button data-sp="next" aria-label="Next boat">▶</button></div>
      <button class="sp-skip" data-sp="skip">SKIP TO RESULTS</button>
      <div class="sp-hint">STEER ◀ ▶ TO SWITCH BOAT · ITEM / ENTER TO SKIP</div>`;
    parent.appendChild(el);
    this.nameEl = el.querySelector('.sp-name')!;
    this.skipEl = el.querySelector('.sp-skip')!;
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-sp]') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.sp === 'prev') this.cycle(-1);
      else if (b.dataset.sp === 'next') this.cycle(1);
      else this.skip();
    });
  }

  /** Is this player knocked out with the battle still on? */
  get active() {
    return this.session.spectating(this.me);
  }

  /** The boat the camera should follow, or null to follow the player as usual. */
  get target(): Racer | null {
    return this.me.eliminated ? this.cur : null;
  }

  private skip() {
    if (this.session.skipBattle()) this.onSkip();
  }

  /** Step to the next / previous boat still afloat (locks auto-follow off). */
  cycle(dir: number) {
    const f = this.session.activeFighters;
    if (!f.length) return;
    const i = this.cur ? f.indexOf(this.cur) : -1;
    const next = f[(((i < 0 ? 0 : i + dir) % f.length) + f.length) % f.length];
    this.auto = false;
    this.pick(next);
  }

  private pick(r: Racer) {
    if (r === this.cur) return;
    this.cur = r;
    this.holdT = 0;
    this.changed = true;
  }

  /**
   * Per frame. `c` is this player's controls read fresh from their input
   * (steer edges cycle, item press skips); `confirm` is an extra skip press.
   */
  update(dt: number, c: Controls | null, confirm: boolean) {
    this.changed = false;
    const s = this.session;
    const on = this.active;
    if (on !== this.shown) {
      this.shown = on;
      this.el.style.display = on ? '' : 'none';
      if (on) this.prevItem = true; // the button that was down at the knock-out is not a skip
    }
    if (!this.me.eliminated) return;
    this.holdT += dt;
    // Lost the boat being watched (knocked out too): back to the leader.
    if (!this.cur || this.cur.eliminated) this.auto = true;
    if (this.auto && on) {
      let lead: Racer | null = null;
      for (const r of s.order) if (!r.eliminated) {
        lead = r;
        break;
      }
      if (lead && (!this.cur || this.cur.eliminated || (lead !== this.cur && this.holdT > AUTO_HOLD))) this.pick(lead);
    }
    if (!on) return;
    if (c) {
      const st = c.steer > 0.5 ? 1 : c.steer < -0.5 ? -1 : 0;
      if (st !== 0 && st !== this.prevSteer) this.cycle(st);
      this.prevSteer = st;
      if (c.item && !this.prevItem) this.skip();
      this.prevItem = c.item;
    }
    if (confirm) this.skip();
    const canSkip = s.humans.every((h) => h.eliminated);
    const cur = this.cur;
    const key = (cur ? cur.id + ':' + cur.lives : '-') + (this.auto ? 'A' : 'M') + (canSkip ? 'S' : '');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.nameEl.innerHTML = cur ? `<i style="background:${cur.livery.hull}"></i>${cur.name} <b>${'♥'.repeat(Math.max(0, cur.lives))}</b>${this.auto ? '<small>LEADER</small>' : ''}` : '';
      this.skipEl.textContent = canSkip ? 'SKIP TO RESULTS' : 'WAITING FOR THE OTHER PLAYER';
      this.skipEl.classList.toggle('off', !canSkip);
    }
  }

  dispose() {
    this.el.remove();
  }
}
