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
import { ITEM_IDS, ITEM_LABEL, SURGE_TIME, type ItemId } from '../race/items';
import type { Racer } from '../race/racer';

interface Msg {
  el: HTMLElement;
  t: number;
}

/** A queued manga callout. Higher `pri` jumps the queue / survives the cap. */
interface Callout {
  text: string;
  cls: string;
  pri: number;
}
/** Minimum spacing between callouts and how long each stays up. */
const CALLOUT_GAP = 1.2;
const CALLOUT_LIFE = 1.15;
/** Overtake callouts are ignored this long after GO (the start-line shuffle). */
const CALLOUT_GRACE = 4;

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
  private itemBubble: HTMLElement;
  private itemRing: HTMLElement;
  private itemIc: HTMLElement;
  private itemQty: HTMLElement;
  private itemTxt: HTMLElement;
  // Seeker lock: reticle over the target, red edge + arrow when this HUD's racer is the target.
  private lockRet: HTMLElement;
  private warnEdge: HTMLElement;
  private warnArrow: HTMLElement;
  private incomingShown = false;
  // Manga callouts.
  private coEl: HTMLElement;
  private coText: HTMLElement;
  private coQueue: Callout[] = [];
  private coCur = '';
  private coPri = 0;
  private coT = 99;
  private coShown = false;
  private prevPlace: Int16Array;
  private nameCd: Float32Array;
  private passCd: Float32Array;
  private placesInit = false;
  private finalLapShown = false;
  private prevDrift = false;
  private prevTier = 0;
  private watchCd = 0;
  private bossCd = 0;
  private boss: Racer | null = null;
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
    this.itemBubble = el('div', 'bubble', this.itemSlot);
    this.itemRing = el('div', 'iring', this.itemBubble);
    this.itemIc = el('b', 'ic ic-none', this.itemBubble);
    this.itemQty = el('div', 'iqty', this.itemBubble);
    this.itemTxt = el('div', 'it-txt', this.itemSlot);
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
    this.warnEdge = el('div', 'warnedge', root);
    this.warnArrow = el('div', 'warnarrow', root, '<svg viewBox="-10 -10 20 20"><path d="M0,-9 L7,5 L0,1.5 L-7,5 Z" fill="#ff2a44" stroke="#12306e" stroke-width="1.6" stroke-linejoin="round"/></svg>');
    this.lockRet = el('div', 'lockret', root, '<i></i><i></i><i></i><i></i><b>LOCK</b>');
    this.coEl = el('div', 'callout', root, '<div class="co-lines"></div><div class="co-text"></div>');
    this.coText = this.coEl.querySelector('.co-text') as HTMLElement;
    const nR = session.racers.length;
    this.prevPlace = new Int16Array(nR);
    this.nameCd = new Float32Array(nR);
    this.passCd = new Float32Array(nR);
    const bossIdx = session.cfg.boss;
    this.boss = bossIdx !== undefined ? (session.racers.find((r) => r.rivalIndex === bossIdx && r !== me) ?? null) : null;
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

  /** Queue a big manga callout (rate-limited, deduped, max 2 waiting). */
  callout(text: string, cls = '', pri = 1) {
    if (this.session.phase !== 'racing') return;
    if (text === this.coCur && this.coT < CALLOUT_GAP + 0.6) return;
    for (const q of this.coQueue) if (q.text === text) return;
    // Danger warnings cut in over a minor callout that has had its moment.
    if (pri >= 4 && this.coShown && this.coPri < 4 && this.coT > 0.35) {
      this.showCallout({ text, cls, pri });
      return;
    }
    this.coQueue.push({ text, cls, pri });
    this.coQueue.sort((a, b) => b.pri - a.pri);
    if (this.coQueue.length > 2) this.coQueue.length = 2;
  }

  private showCallout(c: Callout) {
    this.coCur = c.text;
    this.coPri = c.pri;
    this.coT = 0;
    this.coShown = true;
    this.coText.textContent = c.text;
    const rot = (Math.random() * 2 - 1) * 4;
    this.coEl.style.setProperty('--rot', rot.toFixed(1) + 'deg');
    this.coEl.className = 'callout ' + c.cls + (c.text.length > 16 ? ' xlong' : c.text.length > 11 ? ' long' : '');
    void this.coEl.offsetWidth;
    this.coEl.classList.add('on');
  }

  private pulse(e: HTMLElement, cls: string) {
    e.classList.remove(cls);
    void e.offsetWidth;
    e.classList.add(cls);
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
        this.message(['', 'DRIFT', 'SUPER DRIFT', 'ULTRA DRIFT'][e.value] + (document.body.classList.contains('symbols') ? ' ' + ['', 'I', 'II', 'III'][e.value] : ''), ['', 'cyan', 'gold', 'msg-pink'][e.value] + ' small', 0.9);
        break;
      case 'boostStart':
        this.message(['', 'BOOST!', 'SUPER BOOST!', 'ULTRA BOOST!'][e.value], 'cyan small', 0.9);
        break;
      case 'trick':
        this.message(`${e.text} <span class="trick-score">+${Math.round(e.value)}</span>`, 'gold');
        break;
      case 'land':
        if (e.text === 'clean' && e.racer === this.me.id) this.callout('PERFECT LANDING!', 'lime', 1);
        break;
      case 'wipeout':
        this.callout('WIPEOUT!', 'warn', 2);
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
        break; // per-HUD callout from update() (covers player 2 too)
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
        break; // the roulette in the item bubble announces it
      case 'itemHit':
        if (e.racer < 0) break; // an expired shot splashing down somewhere
        if (e.text === 'storm') this.message('ZAPPED! SHRUNK!', 'warn small', 1.6);
        else if (e.text === 'oil') this.message('SLIPPED ON OIL!', 'warn small', 1.2);
        else if (e.text === 'wave') this.message('SWAMPED!', 'warn small', 1.2);
        else if (e.text === 'homer') this.message('SEEKER HIT!', 'warn small', 1.4);
        if (e.text === 'torpedo' || e.text === 'homer' || e.text === 'oil') this.callout('WIPEOUT!', 'warn', 2);
        break;
      case 'shieldHit':
        this.message('SHIELD BLOCKED IT', 'cyan small', 1.2);
        break;
      case 'itemUse':
        if (e.racer !== this.me.id) break;
        this.pulse(this.itemBubble, 'fire');
        if (e.text === 'turbo' || (e.text === 'surge' && this.me.boat.surge > SURGE_TIME - 0.05)) this.callout('BOOST!', 'cyan', 1);
        if (e.text === 'storm') this.message('RIVALS SHRUNK!', 'lime', 1.6);
        break;
      case 'itemDenied':
        this.pulse(this.itemBubble, 'deny');
        break;
      case 'itemReady':
        this.pulse(this.itemBubble, 'ready');
        break;
      case 'itemMiss':
        if (e.text === 'dodge') this.message('DODGED!', 'lime', 1.4);
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
      // Kart-style roulette: a fresh item spins through the icons first (timed by the sim).
      const spinning = it !== null && p.itemRoll > 0;
      const shown = spinning ? ITEM_IDS[Math.floor(p.itemRoll * 14) % ITEM_IDS.length] : it;
      const surging = it === 'surge' && b.surge > 0;
      const qty = !spinning && it === 'torpedo3' ? p.itemCount : 0;
      const key = (shown ?? '-') + (spinning ? 'R' : '') + (b.shield > 0 ? 'S' : '') + qty + (surging ? 'G' : '');
      this.set('item', key, () => {
        this.itemSlot.classList.toggle('spin', spinning);
        this.itemSlot.classList.toggle('has', !!it && !spinning);
        this.itemSlot.classList.toggle('surging', surging);
        this.itemIc.className = `ic ic-${shown ?? 'none'}`;
        this.itemQty.textContent = qty > 0 ? `×${qty}` : '';
        this.itemQty.style.display = qty > 0 ? '' : 'none';
        const label = spinning ? '???' : it === 'torpedo3' ? `${ITEM_LABEL[it]} ×${qty}` : it ? ITEM_LABEL[it] : 'NO ITEM';
        const hint = it && !spinning ? `<em>${surging ? 'MASH ' : ''}${keyLabel(this.bindings.item[0])}</em>` : '';
        this.itemTxt.innerHTML = `<span>${label}</span>${hint}${b.shield > 0 ? '<span class="sh">SHIELD</span>' : ''}`;
      });
      // Golden Surge: remaining-time ring around the bubble.
      const ring = surging ? Math.ceil((b.surge / SURGE_TIME) * 90) : 0;
      this.set('ring', ring, () => this.itemRing.style.setProperty('--p', (ring / 90).toFixed(3)));
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

    this.updateThreats(dt);
    this.updateCallouts(dt);

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
      const gi = s.track.gateIndexFor(p.checkpoints);
      const g = s.track.gates[gi];
      const dx = g.x - b.position.x;
      const dz = g.z - b.position.z;
      const ang = Math.atan2(dx, dz) - b.heading;
      const deg = Math.round((-ang * 180) / Math.PI);
      this.set('cpang', deg, () => (this.cpArrow.style.transform = `rotate(${deg}deg)`));
      const dist = Math.round(Math.hypot(dx, dz));
      const label = s.track.sprint ? (gi === 0 ? 'START' : gi === s.track.gates.length - 1 ? 'FINISH' : 'CHECKPOINT') : s.hasLaps && gi === 0 ? (p.checkpoints === 0 ? 'START' : 'FINISH') : 'CHECKPOINT';
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

  /** Seeker lock reticle / incoming warning, and WATCH OUT for torpedoes closing in. */
  private updateThreats(dt: number) {
    const s = this.session;
    const it = s.items;
    const me = this.me;
    const b = me.boat;
    if (!it) return;
    // Most urgent missile on anyone for the reticle; the one on me for the warning.
    let any: (typeof it.missiles)[number] | null = null;
    for (const m of it.missiles) if (m.alive && (!any || m.target === me.id || (any.target !== me.id && m.urgency > any.urgency))) any = m;
    const mine = it.missileOn(me.id);
    // Reticle over the locked target boat.
    let retKey = '0';
    const tgt = any ? s.racers[any.target] : null;
    if (any && tgt && this.camera) {
      this.tagPos.copy(tgt.boat.position);
      this.tagPos.y += 1.2;
      this.tagPos.project(this.camera);
      if (this.tagPos.z < 1 && Math.abs(this.tagPos.x) < 1.2 && Math.abs(this.tagPos.y) < 1.2) {
        const x = Math.round((this.tagPos.x * 0.5 + 0.5) * this.viewW);
        const y = Math.round((0.5 - this.tagPos.y * 0.5) * this.viewH);
        const d = this.camera.position.distanceTo(tgt.boat.position);
        const sc = Math.max(0.55, Math.min(1.4, 22 / Math.max(6, d)));
        retKey = `${x},${y},${sc.toFixed(2)},${any.urgency > 0.6 ? 2 : 1}`;
      }
    }
    this.set('ret', retKey, () => {
      const on = retKey !== '0';
      this.lockRet.classList.toggle('on', on);
      if (!on) return;
      const [x, y, sc, u] = retKey.split(',');
      this.lockRet.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${sc})`;
      this.lockRet.classList.toggle('hot', u === '2');
    });
    // I'm the target: edge glow + arrow toward the missile + INCOMING!
    const warn = mine ? (mine.urgency > 0.6 ? 2 : 1) : 0;
    this.set('warn', warn, () => {
      this.warnEdge.className = 'warnedge' + (warn ? ' on' : '') + (warn === 2 ? ' hot' : '');
      this.warnArrow.classList.toggle('on', warn > 0);
    });
    if (mine) {
      if (!this.incomingShown) {
        this.incomingShown = true;
        this.callout('INCOMING!', 'warn', 5);
      }
      const ang = Math.atan2(mine.x - b.position.x, mine.z - b.position.z) - b.heading;
      const ax = Math.round(this.viewW * 0.5 - Math.sin(ang) * this.viewW * 0.4);
      const ay = Math.round(this.viewH * 0.52 - Math.cos(ang) * this.viewH * 0.36);
      const deg = Math.round((-ang * 180) / Math.PI);
      this.set('warnA', `${ax},${ay},${deg}`, () => (this.warnArrow.style.transform = `translate(${ax}px, ${ay}px) translate(-50%, -50%) rotate(${deg}deg)`));
    } else this.incomingShown = false;

    // WATCH OUT!: a torpedo running straight at me.
    this.watchCd = Math.max(0, this.watchCd - dt);
    if (this.watchCd <= 0) {
      for (const t of it.torpedoes) {
        if (!t.alive || t.owner === me.id) continue;
        const dx = b.position.x - t.x;
        const dz = b.position.z - t.z;
        const d = Math.hypot(dx, dz);
        const sp = Math.hypot(t.vx, t.vz) || 1;
        if (d < 32 && d > 3 && (dx * t.vx + dz * t.vz) / (d * sp) > 0.85) {
          this.callout('WATCH OUT!', 'warn', 4);
          this.watchCd = 3;
          break;
        }
      }
    }
  }

  /** Race-state callouts (overtakes, rivals, final lap, drift) + the callout queue itself. */
  private updateCallouts(dt: number) {
    const s = this.session;
    const me = this.me;
    const b = me.boat;
    const racing = s.phase === 'racing';
    for (let i = 0; i < this.nameCd.length; i++) {
      if (this.nameCd[i] > 0) this.nameCd[i] -= dt;
      if (this.passCd[i] > 0) this.passCd[i] -= dt;
    }
    if (s.isRace && racing) {
      const rs = s.racers;
      if (!this.placesInit) {
        for (let i = 0; i < rs.length; i++) this.prevPlace[i] = rs[i].place;
        this.placesInit = true;
      } else if (this.prevPlace[me.id] !== me.place || this.othersMoved()) {
        const early = s.raceTime < CALLOUT_GRACE || me.finished;
        let passedN = 0;
        let passed = -1;
        let passer = -1;
        const myPrev = this.prevPlace[me.id];
        for (const o of this.others) {
          const wasAhead = this.prevPlace[o.id] < myPrev;
          const nowAhead = o.place < me.place;
          if (wasAhead && !nowAhead) {
            passedN++;
            passed = o.id;
          } else if (!wasAhead && nowAhead && !o.finished) passer = o.id;
        }
        if (!early) {
          if (passedN > 0 && me.place === 1) this.callout('FIRST PLACE!', 'gold', 3);
          else if (passedN === 1 && this.nameCd[passed] <= 0) {
            this.callout(`${rs[passed].name} OVERTAKEN`, 'cyan', 2);
            this.nameCd[passed] = 10;
          } else if (passedN > 0) this.callout('OVERTAKE!', 'cyan', 2);
          if (passer >= 0 && passedN === 0 && this.passCd[passer] <= 0) {
            this.callout(`${rs[passer].name} PASSED YOU`, 'warn', 1);
            this.passCd[passer] = 10;
          }
        }
        for (let i = 0; i < rs.length; i++) this.prevPlace[i] = rs[i].place;
      }
      // FINAL LAP! (per HUD, so player 2 hears it too).
      if (s.hasLaps && s.totalLaps > 1 && !this.finalLapShown && me.lap === s.totalLaps && !me.finished) {
        this.finalLapShown = true;
        this.callout('FINAL LAP!', 'gold', 4);
      }
      // Career boss breathing down your neck.
      this.bossCd = Math.max(0, this.bossCd - dt);
      const boss = this.boss;
      if (boss && this.bossCd <= 0 && !me.finished && !boss.finished && s.raceTime > CALLOUT_GRACE) {
        const gap = me.raceDist - boss.raceDist;
        if (gap > 0 && gap < 25) {
          this.callout(`${boss.name} IS RIGHT BEHIND YOU`, 'warn boss', 3);
          this.bossCd = 20;
        }
      }
    }
    // NICE DRIFT!: released an ultra (tier 3) drift cleanly.
    if (this.prevDrift && this.prevTier >= 3 && !b.drifting && b.wipeout <= 0 && racing) this.callout('NICE DRIFT!', 'gold', 1);
    this.prevDrift = b.drifting;
    this.prevTier = b.driftTier;

    // Queue → screen.
    this.coT += dt;
    if (this.coShown && this.coT > CALLOUT_LIFE) {
      this.coShown = false;
      this.coEl.classList.remove('on');
    }
    if (!racing && this.coQueue.length) this.coQueue.length = 0;
    if (this.coQueue.length && this.coT >= CALLOUT_GAP) this.showCallout(this.coQueue.shift()!);
  }

  private othersMoved() {
    for (const o of this.others) if (this.prevPlace[o.id] !== o.place) return true;
    return false;
  }

  resize() {
    this.minimap.resize();
  }

  destroy() {
    this.root.remove();
  }
}
