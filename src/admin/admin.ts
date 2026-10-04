/**
 * ADMIN PANEL — password-gated cheat / developer console.
 *
 * Open with Ctrl+Shift+K, or click any RIPTIDE logo five times quickly.
 *
 * The game has no server, so the check runs in the browser: only a hash of the
 * password is stored here, which keeps it out of a casual read of the bundle,
 * but anyone with dev tools can bypass it. It is a convenience lock, not
 * security. Three wrong attempts lock the prompt for 30 s; a correct one stays
 * unlocked for the rest of the browser tab's session.
 */

import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, type ShaderMaterial } from 'three';
import type { Game } from '../core/game';
import type { WeatherId } from '../core/types';
import { ADMIN_BOAT, BOATS } from '../boat/specs';
import { resetTune, TUNE } from '../boat/boatPhysics';
import { CUPS, TRACKS } from '../race/trackDefs';
import { MAX_LEVEL, sanitizeSave, xpToNext } from '../save/save';
import { WEATHER, WEATHER_IDS } from '../environment/weatherDefs';
import { getSeaState, oceanHeight, setSeaState } from '../water/waves';
import { maxUpgrades } from '../save/progress';
import { ITEM_IDS, ITEM_LABEL, type ItemId } from '../race/items';
import { activeQuality } from '../render/graphics';
import { LOD } from '../render/lod';

/** cyrb53 — a small, fast 53-bit string hash. */
export function hash53(str: string, seed = 0x52495054) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const PASS_HASH = '1b6qsfei5g0';
const SESSION_KEY = 'riptide.admin';
const LOCK_KEY = 'riptide.admin.lock';
const MAX_TRIES = 3;
const LOCK_MS = 30000;

const ss = {
  get(k: string) {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* session storage blocked: the unlock just won't survive a reload */
    }
  },
};

type Tab = 'save' | 'race' | 'physics' | 'world' | 'fun' | 'debug';

/** One-click physics presets for the FUN tab (multipliers on top of normal handling). */
const FUN_PRESETS: Record<string, [string, Partial<Record<'speed' | 'grip' | 'drift' | 'gravity' | 'buoyancy' | 'boost', number>>]> = {
  normal: ['NORMAL', {}],
  moon: ['MOON GRAVITY', { gravity: 0.35 }],
  ice: ['ICE RINK', { grip: 0.35, drift: 1.6 }],
  rocket: ['ROCKET BOATS', { speed: 1.6, boost: 2.5 }],
  glue: ['SUPER GRIP', { grip: 2.3, drift: 0.7 }],
  slowpoke: ['SLOWPOKE', { speed: 0.6, boost: 0.5 }],
};

const TUNE_SLIDERS: [keyof typeof TUNE, string, number, number][] = [
  ['speed', 'TOP SPEED / THRUST', 0.5, 2],
  ['grip', 'GRIP', 0.3, 2.5],
  ['drift', 'DRIFT STRENGTH', 0.4, 2],
  ['gravity', 'GRAVITY', 0.2, 2],
  ['buoyancy', 'BUOYANCY', 0.4, 2],
  ['boost', 'BOOST POWER', 0, 3],
];

export class AdminPanel {
  private el: HTMLElement | null = null;
  private tab: Tab = 'save';
  private tries = 0;
  private clicks: number[] = [];
  private statsTimer = 0;
  private colliders: LineSegments | null = null;
  private colliderWorld: unknown = null;
  /** True while the free camera is flying. */
  freeCam = false;
  unlocked = false;
  /** FUN: riders' heads drawn at a silly size (visual only). */
  private bigHeads = false;
  private bigHeadTimer = 0;
  private funPreset = 'normal';

  constructor(private game: Game) {
    this.unlocked = ss.get(SESSION_KEY) === hash53(PASS_HASH);
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyK' && e.ctrlKey && e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          this.toggle();
          return;
        }
        if (!this.el) return;
        const inPanel = e.target instanceof Node && this.el.contains(e.target);
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.close();
          return;
        }
        // Typing in the panel must not steer the boat or move menu focus.
        if (inPanel && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
          e.stopPropagation();
          if (e.code === 'Enter' && (e.target as HTMLElement).dataset.pw !== undefined) this.tryPassword((e.target as HTMLInputElement).value);
        }
      },
      true,
    );
    // Five quick clicks on any logo.
    window.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.('.title-logo, h1.h, .boot-logo')) return;
      const now = performance.now();
      this.clicks = this.clicks.filter((c) => now - c < 2500);
      this.clicks.push(now);
      if (this.clicks.length >= 5) {
        this.clicks.length = 0;
        this.open();
      }
    });
  }

  get isOpen() {
    return !!this.el;
  }

  toggle() {
    if (this.el) this.close();
    else this.open();
  }

  open() {
    if (this.el) return;
    const el = document.createElement('div');
    el.className = 'admin';
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (b) this.act(b.dataset.a!, b.dataset.v ?? '', b);
    });
    el.addEventListener('input', (e) => this.onInput(e.target as HTMLInputElement));
    this.game.ui.appendChild(el);
    this.el = el;
    this.game.nav.enabled = false;
    this.render();
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.game.nav.enabled = true;
    this.game.input.flush();
  }

  private lockRemaining() {
    const until = Number(ss.get(LOCK_KEY) ?? 0);
    return Math.max(0, until - Date.now());
  }

  private tryPassword(pw: string) {
    if (this.lockRemaining() > 0) return this.render();
    if (hash53(pw) === PASS_HASH) {
      this.unlocked = true;
      this.tries = 0;
      ss.set(SESSION_KEY, hash53(PASS_HASH));
      this.game.audio.unlockSting();
    } else {
      this.tries++;
      this.game.audio.click('deny');
      if (this.tries >= MAX_TRIES) {
        this.tries = 0;
        ss.set(LOCK_KEY, String(Date.now() + LOCK_MS));
      }
      this.render(this.lockRemaining() > 0 ? '' : `Wrong password (${MAX_TRIES - this.tries} left)`);
      return;
    }
    this.render();
  }

  private render(msg = '') {
    const el = this.el;
    if (!el) return;
    if (!this.unlocked) {
      const lock = this.lockRemaining();
      el.innerHTML = `<div class="adm-head"><b>ADMIN</b><button data-a="close">✕</button></div>
        <div class="adm-body"><div class="adm-lock">🔒 Password required</div>
        ${lock > 0 ? `<div class="adm-msg" data-lockmsg>Too many attempts. Try again in ${Math.ceil(lock / 1000)} s.</div>` : `<input type="password" data-pw placeholder="Password" autocomplete="off"><button data-a="pw">UNLOCK</button>`}
        ${msg ? `<div class="adm-msg">${msg}</div>` : ''}</div>`;
      const inp = el.querySelector('input[data-pw]') as HTMLInputElement | null;
      inp?.focus();
      if (lock > 0) this.tickLock();
      return;
    }
    const tabs: Tab[] = ['save', 'race', 'physics', 'world', 'fun', 'debug'];
    el.innerHTML = `<div class="adm-head"><b>ADMIN</b><span class="adm-tabs">${tabs.map((t) => `<button class="${t === this.tab ? 'on' : ''}" data-a="tab" data-v="${t}">${t.toUpperCase()}</button>`).join('')}</span><button data-a="close">✕</button></div>
      <div class="adm-body">${this.body()}</div>${msg ? `<div class="adm-msg">${msg}</div>` : ''}`;
  }

  /** Count the lockout down in place (re-rendering would move the buttons under the cursor). */
  private tickLock() {
    setTimeout(() => {
      if (!this.el || this.unlocked) return;
      const left = this.lockRemaining();
      if (left <= 0) return this.render();
      const m = this.el.querySelector('[data-lockmsg]');
      if (m) m.textContent = `Too many attempts. Try again in ${Math.ceil(left / 1000)} s.`;
      this.tickLock();
    }, 1000);
  }

  private sl(id: string, label: string, min: number, max: number, step: number, v: number) {
    return `<label class="adm-sl"><span>${label}</span><input type="range" data-s="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><em>${v.toFixed(2)}</em></label>`;
  }
  private tg(id: string, label: string, on: boolean) {
    return `<button class="adm-tg ${on ? 'on' : ''}" data-a="toggle" data-v="${id}">${on ? '☑' : '☐'} ${label}</button>`;
  }

  private body(): string {
    const g = this.game;
    const d = g.save.data;
    const s = g.session;
    const racing = g.state === 'race' && !!s;
    switch (this.tab) {
      case 'save':
        return `<div class="adm-row"><span>CREDITS</span><input type="number" data-f="credits" value="${d.credits}" min="0" max="100000000"><button data-a="setCredits">SET</button><button data-a="addCredits" data-v="10000">+10K</button></div>
          <div class="adm-row"><span>LEVEL</span><select data-f="level">${Array.from({ length: MAX_LEVEL }, (_, i) => `<option ${g.save.level === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select><button data-a="setLevel">SET</button><span class="adm-dim">XP ${Math.round(d.xp)}</span></div>
          <div class="adm-row"><button data-a="unlockAll">UNLOCK EVERYTHING</button><button data-a="gold">GIVE ALL GOLD MEDALS</button></div>
          <div class="adm-row"><button data-a="allBoats">GIVE ALL BOATS</button><button data-a="maxUpgrades">MAX ALL UPGRADES</button></div>
          <div class="adm-row"><button data-a="allClasses">UNLOCK ALL CLASSES + MIRROR / REVERSE</button></div>
          <div class="adm-sub">ADMIN BOAT</div><div class="adm-row"><button class="${d.selectedBoat === ADMIN_BOAT.id ? 'on' : ''}" data-a="adminBoat">RIDE ${ADMIN_BOAT.name}</button><span class="adm-dim">admin-only · also listed in the garage while unlocked</span></div>
          <div class="adm-sub">EXPORT / IMPORT SAVE</div>
          <textarea data-f="savejson" spellcheck="false" placeholder="Paste a save here to import, or press EXPORT"></textarea>
          <div class="adm-row"><button data-a="export">EXPORT</button><button data-a="download">DOWNLOAD .JSON</button><button data-a="import">IMPORT</button><button class="danger" data-a="reset">RESET PROGRESS</button></div>`;
      case 'race':
        if (!racing) return `<div class="adm-dim">Start a race to use these.</div>${this.tg('nitro', 'INFINITE NITRO', TUNE.infiniteNitro)}${this.tg('god', 'GOD MODE (NO WIPEOUTS)', TUNE.godMode)}`;
        return `${this.tg('nitro', 'INFINITE NITRO', TUNE.infiniteNitro)}${this.tg('god', 'GOD MODE (NO WIPEOUTS)', TUNE.godMode)}${this.tg('freezeAi', 'FREEZE AI', s!.aiFrozen)}
          ${this.sl('ai', 'AI STRENGTH', 0, 2, 0.05, TUNE.aiPower)}
          <div class="adm-row"><button data-a="nextCp">NEXT CHECKPOINT</button><button data-a="skipLap">SKIP A LAP</button><button data-a="respawn">RESPAWN</button></div>
          <div class="adm-row"><button data-a="pearls">10 PEARLS</button><button data-a="refill">REFILL NITRO</button><button data-a="repair">REPAIR HULL</button><button data-a="shield">SHIELD 10 s</button></div>
          <div class="adm-sub">INSTANT FINISH</div>
          <div class="adm-row">${s!.isRace ? [1, 2, 3, s!.racers.length].map((p) => `<button data-a="finish" data-v="${p}">${p === s!.racers.length ? 'LAST' : p + ['ST', 'ND', 'RD'][p - 1]}</button>`).join('') : `<button data-a="finish" data-v="1">FINISH NOW</button>`}</div>`;
      case 'physics':
        return `<div class="adm-dim">Live multipliers on every boat's handling. 1.00 = normal.</div>
          ${TUNE_SLIDERS.map(([k, l, a, b]) => this.sl(k, l, a, b, 0.05, TUNE[k] as number)).join('')}
          <div class="adm-row"><button data-a="resetTune">RESET TO DEFAULTS</button></div>`;
      case 'world': {
        const w = g.world;
        return `<div class="adm-sub">WEATHER / TIME OF DAY</div><div class="adm-row">${WEATHER_IDS.map((id) => `<button class="${w?.weather === id ? 'on' : ''}" data-a="weather" data-v="${id}">${WEATHER[id].name}</button>`).join('')}</div>
          ${this.sl('sea', 'WAVE HEIGHT', 0, 3, 0.05, getSeaState())}
          ${this.sl('rain', 'RAIN / STORM', 0, 3, 0.05, w?.atmosphere.rainScale ?? 1)}
          ${this.sl('slowmo', 'GAME SPEED', 0.1, 2, 0.05, g.timeScale)}
          <div class="adm-row"><button data-a="mine" data-v="1">SPAWN MINE</button><button data-a="mine" data-v="5">SPAWN 5 MINES</button><button data-a="ramp">SPAWN RAMP AHEAD</button></div>
          ${this.tg('freecam', 'FREE CAMERA (WASD move · arrows look · Q/E down/up · Shift fast)', this.freeCam)}`;
      }
      case 'fun': {
        const racers = s?.racers ?? [];
        const follow = g.adminCamTarget;
        return `<div class="adm-sub">PHYSICS PRESETS (every boat)</div><div class="adm-row">${Object.entries(FUN_PRESETS).map(([id, [label]]) => `<button class="${this.funPreset === id ? 'on' : ''}" data-a="funPreset" data-v="${id}">${label}</button>`).join('')}</div>
          ${this.tg('bigHeads', 'BIG HEAD MODE (visual only)', this.bigHeads)}
          <div class="adm-sub">CAMERA FOLLOWS ${racing ? '' : '(start a race)'}</div><div class="adm-row">${racers.map((r, i) => `<button class="${(follow ?? 0) === i ? 'on' : ''}" data-a="follow" data-v="${i}" ${racing ? '' : 'disabled'}>${r.isPlayer ? 'YOU' : r.name}</button>`).join('')}</div>
          <div class="adm-sub">TELEPORT TO CHECKPOINT ${racing && s!.hasLaps ? '' : '(lap races only)'}</div><div class="adm-row">${racing && s!.hasLaps ? Array.from({ length: s!.gateCount }, (_, i) => `<button data-a="tpGate" data-v="${i}">${i === 0 ? 'START' : 'CP ' + i}</button>`).join('') : ''}</div>`;
      }
      case 'debug': {
        const r = g.renderer.stats;
        const ocean = g.world?.ocean.material as ShaderMaterial | undefined;
        return `<div class="adm-stats" data-stats>${this.statsLine()}</div>
          ${this.tg('overlay', 'DEBUG OVERLAY', g.debugOn)}
          ${this.tg('wire', 'OCEAN WIREFRAME', !!ocean?.wireframe)}
          ${this.tg('colliders', 'SHOW COLLISION SHAPES', !!this.colliders?.visible)}
          ${this.tg('hud', 'HIDE UI', g.ui.style.visibility === 'hidden')}
          ${this.tg('bloom', 'BLOOM', g.renderer.bloomEnabled)}
          ${this.tg('outlines', 'OUTLINES', this.game.renderer.outlinesEnabled)}
          ${this.tg('autopilot', 'PLAYER AUTOPILOT', !!s?.playerAutopilot)}
          <div class="adm-sub">GRAPHICS PRESET (current ${activeQuality.toUpperCase()})</div><div class="adm-row">${(['auto', 'low', 'medium', 'high'] as const).map((q) => `<button class="${g.save.data.settings.quality === q ? 'on' : ''}" data-a="gfx" data-v="${q}">${q.toUpperCase()}</button>`).join('')}</div>
          <div class="adm-sub">RIDER ANIMATIONS (player)</div><div class="adm-row"><button data-a="ranim" data-v="pickup">ITEM PICKUP</button><button data-a="ranim" data-v="hit">HIT</button><button data-a="ranim" data-v="trick">TRICK</button><button data-a="ranim" data-v="lookback">LOOK BACK</button><button data-a="ranim" data-v="victory">VICTORY</button></div>
          <div class="adm-sub">DRIFT SPARKS</div><div class="adm-row"><button data-a="dtier" data-v="1">TIER 1 BLUE</button><button data-a="dtier" data-v="2">TIER 2 ORANGE</button><button data-a="dtier" data-v="3">TIER 3 PURPLE</button><button data-a="burst" data-v="3">MINI-TURBO BURST</button></div>
          <div class="adm-sub">ITEMS ${s?.items ? '' : '(items are off in this event)'}</div><div class="adm-row">${ITEM_IDS.map((id) => `<button data-a="item" data-v="${id}" ${s?.items ? '' : 'disabled'}>${ITEM_LABEL[id]}</button>`).join('')}</div>
          <div class="adm-row"><button data-a="creator">OPEN CHARACTER CREATOR</button></div>
          <div class="adm-sub">PODIUM / TROPHY PREVIEW</div><div class="adm-row"><button data-a="podium">PODIUM</button><button data-a="trophy" data-v="1">GOLD TROPHY</button><button data-a="trophy" data-v="2">SILVER</button><button data-a="trophy" data-v="3">BRONZE</button></div>
          <div class="adm-dim">${r.calls} draw calls · ${(r.triangles / 1000).toFixed(0)}k tris · particles ${g.world?.particles.active ?? 0} · LOD full ${LOD.hiCount} / reduced ${LOD.loCount}</div>`;
      }
    }
  }

  private statsLine() {
    const g = this.game;
    const r = g.renderer.stats;
    const b = g.session?.player.boat;
    return `FPS ${r.fps.toFixed(0)} · ${r.frameMs.toFixed(1)} ms · CPU ${g.cpuMs.toFixed(2)} ms · DPR ${g.renderer.pixelRatio.toFixed(2)}${b ? ` · ${(b.speed * 3.6).toFixed(0)} km/h · y ${b.position.y.toFixed(1)}` : ''}`;
  }

  private driftPreview: { tier: number; t: number } | null = null;
  /** Called every frame by the game. */
  update(dt: number) {
    // Big-head mode: scale every rider's head group (the neck pivot) a couple of
    // times a second so riders spawned by a new race pick it up too.
    this.bigHeadTimer -= dt;
    if (this.bigHeadTimer <= 0 && this.game.world) {
      this.bigHeadTimer = 0.5;
      const k = this.bigHeads ? 1.9 : 1;
      this.game.world.scene.traverse((o) => {
        if (o.name === 'riderHead' && o.parent && o.parent.scale.x !== k) o.parent.scale.setScalar(k);
      });
    }
    // Drift-tier preview: hold the player's boat in a sliding drift at a tier.
    const dp = this.driftPreview;
    const pb = this.game.session?.player.boat;
    if (dp && pb) {
      dp.t -= dt;
      pb.drifting = dp.t > 0;
      pb.driftTier = dp.t > 0 ? dp.tier : 0;
      pb.driftDir = 1;
      if (dp.t <= 0) this.driftPreview = null;
    }
    if (!this.el) return;
    this.statsTimer += dt;
    if (this.statsTimer > 0.4 && this.tab === 'debug') {
      this.statsTimer = 0;
      const st = this.el.querySelector('[data-stats]');
      if (st) st.textContent = this.statsLine();
    }
  }

  private onInput(t: HTMLInputElement) {
    const id = t.dataset.s;
    if (!id) return;
    const v = Number(t.value);
    const em = t.parentElement?.querySelector('em');
    if (em) em.textContent = v.toFixed(2);
    const g = this.game;
    if (id in TUNE && id !== 'ai') (TUNE as Record<string, number | boolean>)[id] = v;
    else if (id === 'ai') TUNE.aiPower = v;
    else if (id === 'sea') setSeaState(v, 0.8 + v * 0.15);
    else if (id === 'rain' && g.world) {
      g.world.atmosphere.rainScale = v;
      g.world.applyWeather(g.world.weather);
    } else if (id === 'slowmo') g.timeScale = v;
  }

  private act(a: string, v: string, btn: HTMLElement) {
    const g = this.game;
    const d = g.save.data;
    const s = g.session;
    const field = (f: string) => this.el?.querySelector(`[data-f="${f}"]`) as HTMLInputElement | null;
    let msg = '';
    switch (a) {
      case 'close':
        return this.close();
      case 'gfx':
        d.settings.quality = v as 'auto' | 'low' | 'medium' | 'high';
        g.save.save();
        g.applySettings();
        msg = `Graphics preset ${v.toUpperCase()} (ocean/particle density applies from the next race)`;
        break;
      case 'ranim': {
        const vis = g.world?.visuals[0];
        if (!vis) break;
        if (v === 'victory') {
          vis.celebrate = true;
          setTimeout(() => (vis.celebrate = false), 2500);
        } else vis.rider.react(v as 'pickup' | 'hit' | 'trick' | 'lookback', Math.random() < 0.5 ? -1 : 1);
        msg = 'Rider animation: ' + v;
        break;
      }
      case 'dtier':
        if (s) {
          this.driftPreview = { tier: Number(v), t: 2.5 };
          const b = s.player.boat;
          g.events.push('driftTier', 0, b.position.x, b.position.y, b.position.z, Number(v));
          msg = 'Drift tier ' + v + ' preview';
        }
        break;
      case 'burst':
        if (s) {
          const b = s.player.boat;
          g.events.push('boostStart', 0, b.position.x, b.position.y, b.position.z, Number(v));
          msg = 'Mini-turbo burst';
        }
        break;
      case 'item':
        if (s?.items) {
          s.player.item = v as ItemId;
          s.player.itemCount = v === 'torpedo3' ? 3 : 1;
          s.player.itemRoll = 0;
          msg = 'Item: ' + ITEM_LABEL[v as ItemId];
        }
        break;
      case 'podium':
        this.close();
        g.debugPodium();
        return;
      case 'trophy':
        this.close();
        g.debugTrophy(Number(v) as 1 | 2 | 3);
        return;
      case 'creator':
        this.close();
        g.screens.rider('menu');
        return;
      case 'pw':
        return this.tryPassword((this.el?.querySelector('input[data-pw]') as HTMLInputElement | null)?.value ?? '');
      case 'tab':
        this.tab = v as Tab;
        break;
      case 'setCredits':
        d.credits = Math.max(0, Math.min(1e8, Math.round(Number(field('credits')?.value) || 0)));
        msg = 'Credits set.';
        break;
      case 'addCredits':
        d.credits = Math.min(1e8, d.credits + Number(v));
        msg = `+${Number(v).toLocaleString()} credits.`;
        break;
      case 'setLevel': {
        const lvl = Math.max(1, Math.min(MAX_LEVEL, Number((this.el?.querySelector('[data-f="level"]') as HTMLSelectElement | null)?.value) || 1));
        let xp = 0;
        for (let l = 1; l < lvl; l++) xp += xpToNext(l);
        d.xp = xp;
        msg = `Level ${lvl}.`;
        break;
      }
      case 'unlockAll': {
        let xp = 0;
        for (let l = 1; l < MAX_LEVEL; l++) xp += xpToNext(l);
        d.xp = Math.max(d.xp, xp);
        d.owned = BOATS.map((b) => b.id);
        msg = 'Everything unlocked: max level, all boats, courses, cups and cosmetics.';
        break;
      }
      case 'allBoats':
        d.owned = BOATS.map((b) => b.id);
        msg = 'All boats added to your garage.';
        break;
      case 'maxUpgrades':
        for (const b of BOATS) d.upgrades[b.id] = maxUpgrades();
        msg = 'Every boat fully upgraded.';
        break;
      case 'gold':
        for (const t of TRACKS) d.medals[t.id] = { race: 3, tt: 3, stunt: 3 };
        for (const c of CUPS) d.cups[c.id] = 3;
        msg = 'Gold everywhere.';
        break;
      case 'allClasses':
        // Gold trophies at every engine class, plus gold medals: opens TSUNAMI, MIRROR and REVERSE everywhere.
        for (const t of TRACKS) d.medals[t.id] = { race: 3, tt: 3, stunt: 3 };
        for (const c of CUPS) {
          d.cups[c.id] = 3;
          d.classCups.ripple[c.id] = 3;
          d.classCups.tsunami[c.id] = 3;
        }
        msg = 'All engine classes and course directions unlocked.';
        break;
      case 'adminBoat':
        d.selectedBoat = ADMIN_BOAT.id;
        msg = `${ADMIN_BOAT.name} selected. Admin-only: it disappears after a reload unless admin is unlocked again.`;
        break;
      case 'pearls':
        if (s) s.player.pearls = 10;
        msg = '10 pearls.';
        break;
      case 'export':
        if (field('savejson')) (field('savejson') as unknown as HTMLTextAreaElement).value = JSON.stringify(d, null, 1);
        return;
      case 'download': {
        const blob = new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'riptide-save.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      case 'import': {
        const raw = (field('savejson') as unknown as HTMLTextAreaElement | null)?.value ?? '';
        try {
          g.save.data = sanitizeSave(JSON.parse(raw));
          msg = 'Save imported.';
        } catch {
          msg = 'That is not valid save JSON.';
          this.render(msg);
          return;
        }
        g.applySettings();
        break;
      }
      case 'reset':
        g.screens.confirm('Reset ALL progress?', () => {
          g.save.reset();
          this.render('Progress reset.');
          if (g.state === 'menu') g.enterMenu();
        });
        return;
      case 'toggle':
        this.toggleFlag(v);
        break;
      case 'funPreset': {
        const preset = FUN_PRESETS[v];
        if (preset) {
          Object.assign(TUNE, { speed: 1, grip: 1, drift: 1, gravity: 1, buoyancy: 1, boost: 1 }, preset[1]);
          this.funPreset = v;
          msg = 'Physics: ' + preset[0];
        }
        break;
      }
      case 'follow':
        g.adminCamTarget = Number(v) === 0 ? null : Number(v);
        g.rig.cut();
        break;
      case 'tpGate':
        if (s) s.adminTeleportToGate(Number(v));
        g.rig.cut();
        break;
      case 'nextCp':
        if (s) s.adminNextCheckpoint();
        g.rig.cut();
        break;
      case 'skipLap':
        s?.adminSkipLaps(1);
        break;
      case 'respawn':
        if (s) s.respawn(s.player);
        break;
      case 'refill':
        if (s) s.player.boat.nitro = 1;
        break;
      case 'repair':
        if (s) s.player.boat.damage = 0;
        break;
      case 'shield':
        if (s) s.player.boat.shield = 10;
        break;
      case 'finish':
        s?.adminFinish(Number(v));
        this.close();
        return;
      case 'resetTune':
        resetTune();
        break;
      case 'weather':
        if (g.world && s) {
          g.world.applyWeather(v as WeatherId);
          s.cfg.weather = v as WeatherId;
          s.applyWeatherSea(v as WeatherId);
        }
        break;
      case 'mine': {
        let n = 0;
        for (let i = 0; i < Number(v); i++) if (s?.spawnMine(40 + i * 18, 60 + i * 18)) n++;
        msg = n ? `${n} mine${n > 1 ? 's' : ''} ahead.` : 'No free mines (14 max).';
        break;
      }
      case 'ramp': {
        const r = s?.spawnRamp(70);
        if (r && g.world) g.world.course.addRamps([r]);
        msg = r ? 'Ramp placed 70 m ahead.' : 'No room for a ramp here.';
        break;
      }
    }
    g.save.save();
    void btn;
    this.render(msg);
  }

  private toggleFlag(v: string) {
    const g = this.game;
    const s = g.session;
    switch (v) {
      case 'nitro':
        TUNE.infiniteNitro = !TUNE.infiniteNitro;
        break;
      case 'god':
        TUNE.godMode = !TUNE.godMode;
        break;
      case 'bigHeads':
        this.bigHeads = !this.bigHeads;
        this.bigHeadTimer = 0;
        break;
      case 'freezeAi':
        if (s) s.aiFrozen = !s.aiFrozen;
        break;
      case 'freecam':
        this.freeCam = !this.freeCam;
        if (this.freeCam) g.rig.startFree();
        else g.rig.endScripted();
        break;
      case 'overlay':
        g.toggleDebug();
        break;
      case 'wire': {
        const m = g.world?.ocean.material as ShaderMaterial | undefined;
        if (m) m.wireframe = !m.wireframe;
        break;
      }
      case 'colliders':
        this.toggleColliders();
        break;
      case 'hud':
        g.ui.style.visibility = g.ui.style.visibility === 'hidden' ? '' : 'hidden';
        // Keep the panel itself visible.
        if (this.el) this.el.style.visibility = 'visible';
        break;
      case 'bloom':
        g.renderer.bloomEnabled = !g.renderer.bloomEnabled;
        break;
      case 'outlines':
        g.renderer.outlinesEnabled = !g.renderer.outlinesEnabled;
        break;
      case 'autopilot':
        if (s) s.playerAutopilot = !s.playerAutopilot;
        break;
    }
  }

  private toggleColliders() {
    const g = this.game;
    const w = g.world;
    const s = g.session;
    if (!w || !s) return;
    if (this.colliders && this.colliderWorld === w) {
      this.colliders.visible = !this.colliders.visible;
      return;
    }
    if (this.colliders) {
      // Built for an earlier world: free it before building for this one.
      this.colliders.removeFromParent();
      this.colliders.geometry.dispose();
      (this.colliders.material as LineBasicMaterial).dispose();
      this.colliders = null;
    }
    const pos: number[] = [];
    const N = 24;
    const circle = (x: number, z: number, r: number) => {
      const y = Math.max(0.6, oceanHeight(x, z, s.time) + 0.6);
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        const a1 = ((i + 1) / N) * Math.PI * 2;
        pos.push(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r);
      }
    };
    for (const c of s.statics.all) circle(c.x, c.z, c.r);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const lines = new LineSegments(geo, new LineBasicMaterial({ color: 0xff00ff, depthTest: false, transparent: true }));
    lines.renderOrder = 999;
    lines.frustumCulled = false;
    w.scene.add(lines);
    this.colliders = lines;
    this.colliderWorld = w;
  }
}
