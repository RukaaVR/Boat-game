/**
 * In-race HUD (DOM). Elements are built once; each frame only changed values
 * are written, so the HUD costs almost nothing in layout.
 */

import { formatTime, ordinal } from '../core/mathx';
import { Vector3, type Camera } from 'three';
import type { GameEvent } from '../core/events';
import type { RaceSession } from '../race/session';
import { Minimap } from './minimap';
import { CAM_LABEL, type CamMode } from '../camera/cameraRig';
import { DRIFT_TIER_AT } from '../boat/boatPhysics';
import { keyLabel, type Bindings } from '../input/input';
import type { Tutorial, TutorialStep } from '../race/tutorial';
import { ITEM_LABEL, type ItemId } from '../race/items';

interface Msg {
  el: HTMLElement;
  t: number;
}

function el(tag: string, cls = '', parent?: HTMLElement, html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

export class Hud {
  readonly root: HTMLElement;
  private minimap: Minimap;
  private pos: HTMLElement;
  private lap: HTMLElement;
  private standings: HTMLElement;
  private timer: HTMLElement;
  private laptimes: HTMLElement;
  private split: HTMLElement;
  private cpdir: HTMLElement;
  private cpArrow: SVGElement;
  private cpText: HTMLElement;
  private speed: HTMLElement;
  private nitroFill: HTMLElement;
  private nitroGauge: HTMLElement;
  private boostFill: HTMLElement;
  private driftSpans: HTMLElement[] = [];
  private center: HTMLElement;
  private count: HTMLElement;
  private modebox: HTMLElement;
  private itemSlot: HTMLElement;
  private dmg: HTMLElement;
  private lastHits = 0;
  private proxL: HTMLElement;
  private proxR: HTMLElement;
  private tutorial: HTMLElement;
  private camLabel: HTMLElement;
  private draftEl: HTMLElement;
  private tags: HTMLElement[] = [];
  /** Everyone except this HUD's racer. */
  private others: import('../race/racer').Racer[] = [];
  private tagPos = new Vector3();
  /** Set by the game each frame for name-tag projection. */
  camera: Camera | null = null;
  private wrong: HTMLElement | null = null;
  private msgs: Msg[] = [];
  private cache: Record<string, string | number> = {};
  private camLabelT = 0;
  private prevSplits: number[] = [];
  private curSplits: number[] = [];
  private tutorialSteps: string[];
  private tutorialT = 0;
  showTutorial = false;
  /** Size of this HUD's viewport in CSS px (split-screen halves). */
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  /** Guided tutorial (tutorial mode). */
  guide: Tutorial | null = null;
  private guideEl: HTMLElement | null = null;
  private guideText: Record<TutorialStep, string> = {} as Record<TutorialStep, string>;

  constructor(
    private session: RaceSession,
    parent: HTMLElement,
    private units: 'kmh' | 'mph',
    private bindings: Bindings,
    touch = false,
    /** The racer this HUD belongs to (split-screen: player 2). */
    readonly me = session.player,
  ) {
    const root = (this.root = el('div', 'hud', parent));
    const tl = el('div', 'tl', root);
    this.pos = el('div', 'pos', tl);
    this.lap = el('div', 'lap', tl);
    this.standings = el('div', 'standings', tl);
    this.modebox = el('div', 'modebox', tl);
    this.itemSlot = el('div', 'itemslot', tl);
    this.itemSlot.style.display = session.items ? '' : 'none';
    this.dmg = el('div', 'dmgbar', tl, '<span>HULL</span><div><i></i></div>');
    const tc = el('div', 'tc', root);
    this.timer = el('div', 'timer', tc);
    this.laptimes = el('div', 'laptimes', tc);
    this.split = el('div', 'split', tc);
    this.cpdir = el('div', 'cpdir', tc);
    this.cpdir.innerHTML = `<svg viewBox="-10 -10 20 20"><path d="M0,-8 L6,6 L0,3 L-6,6 Z" fill="currentColor"/></svg><span></span>`;
    this.cpArrow = this.cpdir.querySelector('svg')!;
    this.cpText = this.cpdir.querySelector('span')!;
    const tr = el('div', 'tr', root);
    this.minimap = new Minimap(session, me);
    tr.appendChild(this.minimap.canvas);
    const br = el('div', 'br', root);
    this.speed = el('div', 'speed', br);
    const bg = el('div', 'gauge', br);
    this.boostFill = el('div', 'fill', bg);
    el('div', 'ticks', bg);
    el('div', 'glabel', br, 'SPEED');
    this.nitroGauge = el('div', 'gauge nitro', br);
    this.nitroFill = el('div', 'fill', this.nitroGauge);
    el('div', 'ticks', this.nitroGauge);
    const k = (a: keyof Bindings) => keyLabel(bindings[a][0]);
    el('div', 'glabel', br, `NITRO <span style="opacity:.7">[${k('boost')}]</span>`);
    const drift = el('div', 'drift', br);
    for (let i = 0; i < 3; i++) this.driftSpans.push(el('span', '', el('div', '', drift)));
    el('div', 'glabel', br, 'DRIFT');
    this.center = el('div', 'center-msg', root);
    this.count = el('div', 'count', root);
    this.count.style.display = 'none';
    this.proxL = el('div', 'prox l', root);
    this.proxR = el('div', 'prox r', root);
    this.tutorial = el('div', 'tutorial', root);
    this.tutorial.style.opacity = '0';
    this.draftEl = el('div', 'msg small cyan draft', root, 'SLIPSTREAM');
    this.draftEl.style.opacity = '0';
    this.camLabel = el('div', 'camlabel', root);
    this.camLabel.style.opacity = '0';
    this.others = session.racers.filter((r) => r !== me);
    for (const r of this.others) {
      const t = el('div', 'tag', root, `<i style="background:${r.livery.hull}"></i>${r.name}`);
      t.style.opacity = '0';
      this.tags.push(t);
    }
    requestAnimationFrame(() => this.minimap.resize());

    this.tutorialSteps = [
      `Hold <b>${k('throttle')}</b> to accelerate · steer with <b>${k('left')}</b> <b>${k('right')}</b>`,
      `Hold <b>${k('drift')}</b> while turning to DRIFT — release at a colour tier for a boost`,
      `Press <b>${k('boost')}</b> to burn NITRO — earn it by drifting, drafting, tricks and clean landings`,
      `In the air: <b>${k('drift')}</b> + direction for flips & spins, <b>${k('roll')}</b> to barrel roll. Land level!`,
      `<b>${k('camera')}</b> camera · <b>${k('respawn')}</b> respawn · <b>${keyLabel(bindings.pause[0])}</b> pause`,
    ];
    if (session.mode === 'freeride' || session.mode === 'stunt') this.cpdir.style.display = 'none';
    const K = (a: keyof Bindings, t: string) => `<b>${touch ? t : k(a)}</b>`;
    this.guideText = {
      throttle: `Hold ${K('throttle', 'GAS')} to accelerate`,
      steer: touch ? 'Steer with the <b>LEFT THUMB</b> — carve left and right' : `Steer with ${K('left', '')} ${K('right', '')} — carve left and right`,
      checkpoint: 'Follow the arrow at the top and pass through the glowing <b>CHECKPOINT</b>',
      drift: `DRIFT: turn at speed and hold ${K('drift', 'DRIFT')}. Keep holding until the meter turns <b>ORANGE</b>`,
      release: `Now RELEASE ${K('drift', 'DRIFT')} for a mini-turbo`,
      nitro: `Hold ${K('boost', 'NITRO')} to burn nitro. Earn it back by drifting, drafting and tricks`,
      ramp: 'Hit the orange <b>RAMP</b> at full speed',
      trick: touch ? 'In the air hold <b>DRIFT</b> + push the stick for a flip or spin, or tap <b>TRICK</b> to barrel roll' : `In the air hold ${K('drift', '')} + ${K('left', '')}/${K('right', '')} to spin, or ${K('throttle', '')}/${K('brake', '')} to flip`,
      land: touch ? 'Jump again and <b>LAND LEVEL</b> — push the stick up/down to match the nose to the water' : `Jump again and <b>LAND LEVEL</b> — ${K('throttle', '')}/${K('brake', '')} tilt the nose to match the water`,
      start: `PERFECT START: watch the countdown and hit ${K('throttle', 'GAS')} while <b>1</b> is showing`,
      done: 'TUTORIAL COMPLETE — you are ready to race!',
    };
  }

  private set(key: string, v: string | number, fn: () => void) {
    if (this.cache[key] === v) return;
    this.cache[key] = v;
    fn();
  }

  message(html: string, cls = '', life = 1.6) {
    const e = el('div', 'msg ' + cls, this.center, html);
    this.msgs.push({ el: e, t: life });
    while (this.msgs.length > 4) {
      const m = this.msgs.shift()!;
      m.el.remove();
    }
  }

  showCamera(mode: CamMode) {
    this.camLabel.textContent = CAM_LABEL[mode];
    this.camLabel.style.opacity = '1';
    this.camLabelT = 1.5;
  }

  onEvent(e: GameEvent) {
    if (e.racer !== this.me.id && e.racer !== -1) return;
    const s = this.session;
    switch (e.type) {
      case 'countdown':
        this.count.style.display = 'block';
        this.count.className = 'count' + (e.value === 0 ? ' go' : '');
        this.count.textContent = e.value === 0 ? 'GO!' : String(e.value);
        // Restart the pop animation.
        void this.count.offsetWidth;
        if (e.value === 0) setTimeout(() => (this.count.style.display = 'none'), 800);
        break;
      case 'falseStart':
        this.message('FALSE START!', 'warn', 2);
        break;
      case 'perfectStart':
        this.message('PERFECT START!', 'lime');
        break;
      case 'driftTier':
        this.message(['', 'DRIFT', 'SUPER DRIFT', 'ULTRA DRIFT'][e.value], ['', 'cyan', 'gold', 'msg-pink'][e.value] + ' small', 0.9);
        break;
      case 'boostStart':
        this.message(['', 'BOOST!', 'SUPER BOOST!', 'ULTRA BOOST!'][e.value], 'cyan small', 0.9);
        break;
      case 'trick':
        this.message(`${e.text} <span class="trick-score">+${Math.round(e.value)}</span>`, 'gold');
        break;
      case 'land':
        if (e.text === 'clean') this.message('PERFECT LANDING', 'lime small', 1.1);
        break;
      case 'wipeout':
        this.message('WIPEOUT!', 'warn', 1.4);
        break;
      case 'checkpoint': {
        if (!s.hasLaps) {
          if (s.mode === 'endless') this.message('+TIME', 'lime small', 0.9);
          break;
        }
        const lapT = this.me.lap >= 1 ? s.raceTime - this.me.lapStart : 0;
        const idx = e.value;
        this.curSplits[idx] = lapT;
        const prev = this.prevSplits[idx];
        if (prev !== undefined) {
          const d = lapT - prev;
          this.split.className = 'split ' + (d <= 0 ? 'good' : 'bad');
          this.split.textContent = (d <= 0 ? '−' : '+') + Math.abs(d).toFixed(2);
          this.cache.splitT = 2.5;
        }
        break;
      }
      case 'lap':
        this.prevSplits = this.curSplits;
        this.curSplits = [];
        this.prevSplits[0] = 0;
        this.message(`LAP ${e.value}`, 'cyan');
        break;
      case 'finalLap':
        this.message('FINAL LAP!', 'gold', 2.2);
        break;
      case 'wrongWay':
        break;
      case 'overtake':
        this.pos.classList.remove('bump');
        void this.pos.offsetWidth;
        this.pos.classList.add('bump');
        break;
      case 'ring':
        this.message(`RING +${e.value}`, 'gold small', 0.9);
        break;
      case 'boostPad':
        this.message('BOOST PAD', 'cyan small', 0.7);
        break;
      case 'reset':
        this.message('RESPAWN', 'small', 1);
        break;
      case 'itemPickup':
        this.message(`GOT ${ITEM_LABEL[e.text as ItemId] ?? e.text}!`, 'gold small', 1);
        break;
      case 'itemHit':
        this.message(e.text === 'oil' ? 'SLIPPED ON OIL!' : e.text === 'wave' ? 'SWAMPED!' : 'HIT!', 'warn', 1.2);
        break;
      case 'shieldHit':
        this.message('SHIELD BLOCKED IT', 'cyan small', 1.2);
        break;
      case 'collectible': {
        const found = s.bottles.filter((b) => b.found).length;
        this.message(`MESSAGE BOTTLE ${found}/${s.bottles.length}`, 'lime', 2.2);
        break;
      }
      case 'weatherShift':
        this.message(e.text === 'storm' ? 'A STORM IS ROLLING IN' : e.text === 'night' ? 'NIGHT IS FALLING' : e.text === 'sunset' ? 'THE SUN IS SETTING' : 'THE SKIES ARE CLEARING', 'cyan', 3);
        break;
      case 'finish':
        this.message(s.isRace ? `FINISH — ${ordinal(this.me.place)}` : 'FINISH', 'gold', 3);
        break;
    }
  }

  update(dt: number) {
    const s = this.session;
    const p = this.me;
    const b = p.boat;
    const n = s.racers.length;

    // Messages.
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i];
      m.t -= dt;
      if (m.t < 0.3) m.el.style.opacity = String(Math.max(0, m.t / 0.3));
      if (m.t <= 0) {
        m.el.remove();
        this.msgs.splice(i, 1);
      }
    }
    // Wrong way banner.
    if (p.wrongWay && s.phase === 'racing') {
      if (!this.wrong) this.wrong = el('div', 'msg warn', this.center, 'WRONG WAY');
    } else if (this.wrong) {
      this.wrong.remove();
      this.wrong = null;
    }

    // Position / lap.
    if (s.isRace) {
      this.set('pos', `${p.place}/${n}`, () => {
        const o = ordinal(p.place);
        this.pos.innerHTML = `${p.place}<sup>${o.slice(-2)}</sup><span class="of">/ ${n}</span>`;
      });
    } else this.set('pos', '', () => (this.pos.innerHTML = ''));
    if (s.hasLaps) {
      const lap = Math.min(Math.max(1, p.lap), s.totalLaps);
      this.set('lap', lap, () => {
        this.lap.textContent = `LAP ${lap} / ${s.totalLaps}`;
        this.lap.className = 'lap' + (lap === s.totalLaps && s.totalLaps > 1 ? ' final' : '');
      });
    } else this.set('lap', '', () => (this.lap.textContent = ''));

    // Standings (race modes): compact, nearest-relevant.
    if (s.isRace) {
      const key = s.order.map((r) => r.id).join(',') + (Math.floor(s.raceTime * 2) % 1000);
      this.set('stand', key, () => {
        let h = '';
        const leader = s.order[0];
        for (const r of s.order) {
          const gap = r === leader ? '' : r.finished ? 'FIN' : `+${Math.max(0, (leader.raceDist - r.raceDist) / Math.max(10, leader.boat.speed || 25)).toFixed(1)}`;
          h += `<div class="${r.isPlayer ? 'me' : ''}"><span>${r.place}</span><i style="background:${r.livery.hull}"></i><span>${r.name}</span><span class="gap">${gap}</span></div>`;
        }
        this.standings.innerHTML = h;
      });
    }

    // Battle item slot and hits landed.
    if (s.items) {
      const it = p.item as ItemId | null;
      const key = (it ?? '-') + (b.shield > 0 ? 'S' : '');
      this.set('item', key, () => {
        this.itemSlot.innerHTML = `<b class="ic ic-${it ?? 'none'}"></b><span>${it ? ITEM_LABEL[it] : 'NO ITEM'}</span>${it ? `<em>${keyLabel(this.bindings.item[0])}</em>` : ''}${b.shield > 0 ? '<span class="sh">SHIELD</span>' : ''}`;
      });
      if (p.itemHits > this.lastHits) {
        this.lastHits = p.itemHits;
        this.message('DIRECT HIT!', 'gold', 1.2);
      }
    }
    const dmg = Math.round(b.damage * 20);
    this.set('dmg', dmg, () => {
      this.dmg.style.display = b.damage > 0.04 ? '' : 'none';
      (this.dmg.querySelector('i') as HTMLElement).style.transform = `scaleX(${(1 - b.damage).toFixed(2)})`;
      this.dmg.classList.toggle('bad', b.damage > 0.5);
    });

    // Mode boxes.
    let mode = '';
    if (s.mode === 'stunt') mode = `SCORE <b>${s.stuntScore}</b> · ${formatTime(s.stuntTimeLeft, false)}`;
    else if (s.mode === 'endless') mode = `TIME <b>${s.endlessTimeLeft.toFixed(1)}</b> · ${Math.max(0, Math.round(s.endlessDistance))} m · LVL ${s.endlessLevel}`;
    else if (s.mode === 'freeride') mode = `TOP <b>${Math.round(p.topSpeed * (this.units === 'kmh' ? 3.6 : 2.237))}</b> · AIR <b>${p.bestAir.toFixed(1)}s</b> · TRICKS <b>${p.tricks}</b> · RINGS <b>${s.ringsTaken}</b>`;
    else if (s.mode === 'timetrial' && s.ghost) mode = `GHOST <b>${formatTime(s.ghost.time)}</b>`;
    this.set('mode', mode, () => {
      this.modebox.innerHTML = mode;
      this.modebox.style.display = mode ? 'block' : 'none';
    });

    // Timers.
    const showTime = s.mode !== 'freeride';
    const tt = s.phase === 'racing' || s.phase === 'finished' ? formatTime(s.raceTime) : formatTime(0);
    this.set('time', showTime ? tt : '', () => (this.timer.textContent = showTime ? tt : ''));
    if (s.hasLaps) {
      const lt = `LAP ${formatTime(p.lap >= 1 ? s.raceTime - p.lapStart : 0)} · BEST ${isFinite(p.bestLap) ? formatTime(p.bestLap) : '--:--.---'}`;
      this.set('laptimes', lt, () => (this.laptimes.textContent = lt));
    }
    if (typeof this.cache.splitT === 'number') {
      this.cache.splitT = (this.cache.splitT as number) - dt;
      if ((this.cache.splitT as number) <= 0) {
        this.split.textContent = '';
        delete this.cache.splitT;
      }
    }

    // Next checkpoint direction.
    if (s.mode !== 'freeride' && s.mode !== 'stunt') {
      const g = s.track.gates[p.checkpoints % s.track.gates.length];
      const dx = g.x - b.position.x;
      const dz = g.z - b.position.z;
      const ang = Math.atan2(dx, dz) - b.heading;
      const deg = Math.round((-ang * 180) / Math.PI);
      this.set('cpang', deg, () => (this.cpArrow.style.transform = `rotate(${deg}deg)`));
      const dist = Math.round(Math.hypot(dx, dz));
      const label = s.hasLaps && p.checkpoints % s.track.gates.length === 0 ? (p.checkpoints === 0 ? 'START' : 'FINISH') : 'CHECKPOINT';
      this.set('cpd', dist + label, () => (this.cpText.textContent = `${label} ${dist} m`));
    }

    // Speed / gauges.
    const mult = this.units === 'kmh' ? 3.6 : 2.237;
    const spd = Math.round(Math.abs(b.forwardSpeed) * mult);
    this.set('spd', spd, () => (this.speed.innerHTML = `${spd}<small>${this.units === 'kmh' ? 'KM/H' : 'MPH'}</small>`));
    const top = b.spec.boostTopSpeed;
    const sf = Math.min(1, Math.abs(b.forwardSpeed) / top);
    this.set('sf', Math.round(sf * 200), () => (this.boostFill.style.transform = `scaleX(${sf.toFixed(3)})`));
    const nf = b.nitro;
    this.set('nf', Math.round(nf * 200), () => {
      this.nitroFill.style.transform = `scaleX(${nf.toFixed(3)})`;
      this.nitroGauge.classList.toggle('full', nf > 0.98);
    });
    for (let i = 0; i < 3; i++) {
      const lo = i === 0 ? 0 : DRIFT_TIER_AT[i - 1];
      const hi = DRIFT_TIER_AT[i];
      const f = b.drifting ? Math.max(0, Math.min(1, (b.driftCharge - lo) / (hi - lo))) : 0;
      this.set('d' + i, Math.round(f * 50), () => (this.driftSpans[i].style.transform = `scaleX(${f.toFixed(2)})`));
    }

    // Proximity: rivals close behind/beside.
    let l = 0;
    let r = 0;
    const fx = Math.sin(b.heading);
    const fz = Math.cos(b.heading);
    for (let i = 0; i < this.others.length; i++) {
      const o = this.others[i].boat;
      const dx = o.position.x - b.position.x;
      const dz = o.position.z - b.position.z;
      const ahead = dx * fx + dz * fz;
      const side = dx * -fz + dz * fx;
      const d = Math.hypot(dx, dz);
      if (d < 16 && ahead < 3) {
        const k = 1 - d / 16;
        if (side > 0) r = Math.max(r, k);
        else l = Math.max(l, k);
      }
    }
    this.set('pl', Math.round(l * 10), () => (this.proxL.style.opacity = String(l)));
    this.set('pr', Math.round(r * 10), () => (this.proxR.style.opacity = String(r)));

    // Slipstream indicator.
    const dr = b.draft > 0.45 && s.phase === 'racing' ? 1 : 0;
    this.set('draft', dr, () => (this.draftEl.style.opacity = String(dr)));

    // Camera label fade.
    if (this.camLabelT > 0) {
      this.camLabelT -= dt;
      if (this.camLabelT <= 0) this.camLabel.style.opacity = '0';
    }

    // Guided tutorial panel.
    const gd = this.guide;
    if (gd) {
      if (!this.guideEl) {
        this.guideEl = el('div', 'tut-panel', this.root, `<div class="tp-step"></div><div class="tp-text"></div><div class="tp-fb"></div><div class="tp-dots">${'<i></i>'.repeat(gd.progress.n)}</div>`);
        this.tutorial.style.display = 'none';
      }
      const pr = gd.progress;
      this.set('gstep', gd.step + pr.i, () => {
        this.guideEl!.querySelector('.tp-step')!.textContent = gd.done ? 'DONE' : `STEP ${pr.i} / ${pr.n}`;
        this.guideEl!.querySelector('.tp-text')!.innerHTML = this.guideText[gd.step];
        this.guideEl!.querySelectorAll('.tp-dots i').forEach((d, i) => d.classList.toggle('on', i < pr.i - (gd.done ? 0 : 1)));
      });
      this.set('gfb', gd.cheer > 0 ? 'NICE!' : gd.feedback, () => (this.guideEl!.querySelector('.tp-fb')!.textContent = gd.cheer > 0 ? 'NICE!' : gd.feedback));
      this.set('gch', gd.cheer > 0 ? 1 : 0, () => this.guideEl!.classList.toggle('cheer', gd.cheer > 0));
    }

    // First-race tutorial.
    if (this.showTutorial && s.phase === 'countdown') {
      this.set('tut', 'start', () => {
        this.tutorial.innerHTML = 'TIP: hit the throttle on <b>1</b> for a PERFECT START — too early floods the engine';
        this.tutorial.style.opacity = '1';
      });
    } else if (this.showTutorial && s.phase === 'racing') {
      this.tutorialT += dt;
      const step = Math.floor(this.tutorialT / 5.5);
      if (step < this.tutorialSteps.length) {
        this.set('tut', step, () => {
          this.tutorial.innerHTML = this.tutorialSteps[step];
          this.tutorial.style.opacity = '1';
        });
      } else this.set('tut', -1, () => (this.tutorial.style.opacity = '0'));
    }

    // Rival name tags (nearby, in front of the lens).
    if (this.camera) {
      const cam = this.camera;
      const W = this.viewW;
      const H = this.viewH;
      for (let i = 0; i < this.others.length; i++) {
        const r = this.others[i];
        const tag = this.tags[i];
        const d = cam.position.distanceTo(r.boat.position);
        this.tagPos.copy(r.boat.position);
        this.tagPos.y += 2.6;
        this.tagPos.project(cam);
        const vis = d > 6 && d < 70 && this.tagPos.z < 1 && Math.abs(this.tagPos.x) < 1.1 && Math.abs(this.tagPos.y) < 1.1 && s.phase !== 'results';
        const op = vis ? Math.min(1, (70 - d) / 20) * Math.min(1, (d - 6) / 6) : 0;
        const key = vis ? `${Math.round((this.tagPos.x * 0.5 + 0.5) * W)},${Math.round((0.5 - this.tagPos.y * 0.5) * H)},${op.toFixed(1)},${r.place}` : '0';
        this.set('tag' + i, key, () => {
          tag.style.opacity = op.toFixed(2);
          if (vis) {
            tag.style.transform = `translate(${((this.tagPos.x * 0.5 + 0.5) * W).toFixed(0)}px, ${((0.5 - this.tagPos.y * 0.5) * H).toFixed(0)}px) translate(-50%, -100%)`;
            tag.dataset.place = String(r.place);
          }
        });
      }
    }

    this.minimap.draw(p.checkpoints);
  }

  resize() {
    this.minimap.resize();
  }

  destroy() {
    this.root.remove();
  }
}
