/**
 * In-race HUD (DOM). Elements are built once; each frame only changed values
 * are written, so the HUD costs almost nothing in layout.
 */

import { formatTime, ordinal } from '../core/mathx';
import type { GameEvent } from '../core/events';
import type { RaceSession } from '../race/session';
import { Minimap } from './minimap';
import { CAM_LABEL, type CamMode } from '../camera/cameraRig';
import { DRIFT_TIER_AT } from '../boat/boatPhysics';
import { keyLabel, type Bindings } from '../input/input';

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
  private proxL: HTMLElement;
  private proxR: HTMLElement;
  private tutorial: HTMLElement;
  private camLabel: HTMLElement;
  private draftEl: HTMLElement;
  private wrong: HTMLElement | null = null;
  private msgs: Msg[] = [];
  private cache: Record<string, string | number> = {};
  private camLabelT = 0;
  private prevSplits: number[] = [];
  private curSplits: number[] = [];
  private tutorialSteps: string[];
  private tutorialT = 0;
  showTutorial = false;

  constructor(
    private session: RaceSession,
    parent: HTMLElement,
    private units: 'kmh' | 'mph',
    bindings: Bindings,
  ) {
    const root = (this.root = el('div', 'hud', parent));
    const tl = el('div', 'tl', root);
    this.pos = el('div', 'pos', tl);
    this.lap = el('div', 'lap', tl);
    this.standings = el('div', 'standings', tl);
    this.modebox = el('div', 'modebox', tl);
    const tc = el('div', 'tc', root);
    this.timer = el('div', 'timer', tc);
    this.laptimes = el('div', 'laptimes', tc);
    this.split = el('div', 'split', tc);
    this.cpdir = el('div', 'cpdir', tc);
    this.cpdir.innerHTML = `<svg viewBox="-10 -10 20 20"><path d="M0,-8 L6,6 L0,3 L-6,6 Z" fill="currentColor"/></svg><span></span>`;
    this.cpArrow = this.cpdir.querySelector('svg')!;
    this.cpText = this.cpdir.querySelector('span')!;
    const tr = el('div', 'tr', root);
    this.minimap = new Minimap(session);
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
    requestAnimationFrame(() => this.minimap.resize());

    this.tutorialSteps = [
      `Hold <b>${k('throttle')}</b> to accelerate · steer with <b>${k('left')}</b> <b>${k('right')}</b>`,
      `Hold <b>${k('drift')}</b> while turning to DRIFT — release at a colour tier for a boost`,
      `Press <b>${k('boost')}</b> to burn NITRO — earn it by drifting, drafting, tricks and clean landings`,
      `In the air: <b>${k('drift')}</b> + direction for flips & spins, <b>${k('roll')}</b> to barrel roll. Land level!`,
      `<b>${k('camera')}</b> camera · <b>${k('respawn')}</b> respawn · <b>${keyLabel(bindings.pause[0])}</b> pause`,
    ];
    if (session.mode === 'freeride' || session.mode === 'stunt') this.cpdir.style.display = 'none';
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
    if (e.racer !== 0 && e.racer !== -1) return;
    const s = this.session;
    switch (e.type) {
      case 'countdown':
        if (e.value === 3 && this.showTutorial) this.message('TIP: hit the throttle on <b>1</b> for a PERFECT START', 'small', 2.8);
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
        const lapT = s.playerLapTime();
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
      case 'finish':
        this.message(s.isRace ? `FINISH — ${ordinal(s.player.place)}` : 'FINISH', 'gold', 3);
        break;
    }
  }

  update(dt: number) {
    const s = this.session;
    const p = s.player;
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
      const lt = `LAP ${formatTime(s.playerLapTime())} · BEST ${isFinite(p.bestLap) ? formatTime(p.bestLap) : '--:--.---'}`;
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
    for (let i = 1; i < s.racers.length; i++) {
      const o = s.racers[i].boat;
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

    // First-race tutorial.
    if (this.showTutorial && (s.phase === 'racing' || s.phase === 'countdown')) {
      this.tutorialT += dt;
      const step = Math.floor(this.tutorialT / 5.5);
      if (step < this.tutorialSteps.length) {
        this.set('tut', step, () => {
          this.tutorial.innerHTML = this.tutorialSteps[step];
          this.tutorial.style.opacity = '1';
        });
      } else this.set('tut', -1, () => (this.tutorial.style.opacity = '0'));
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
