/**
 * Menu screens. Each screen is a DOM fragment built from a template, wired with
 * delegated `data-act` handlers and registered with the spatial navigator.
 * Screens never touch the simulation directly — they call into the Game.
 */

import type { Game, EventRequest } from '../core/game';
import { BOATS, boatSpec, boatStats, type BoatId } from '../boat/specs';
import { BOOSTS, DECALS, PAINTS, STRIPES, TRAILS, type Livery } from '../boat/livery';
import { CUPS, CHAMP_POINTS, TRACKS, trackDef } from '../race/trackDefs';
import { Track } from '../race/track';
import { WEATHER, WEATHER_IDS } from '../environment/weatherDefs';
import { cosmeticUnlocks, levelFromXp, type Settings } from '../save/save';
import { formatTime, ordinal } from '../core/mathx';
import { drawTrackPreview } from './minimap';
import { ACTION_LABEL, ACTIONS, DEFAULT_BINDINGS, keyLabel, type Action } from '../input/input';
import type { ModeId, WeatherId } from '../core/types';
import { RIVALS } from '../race/session';
import { t, t as t2 } from './i18n';
import { ACHIEVEMENTS, BOTTLES_PER_TRACK, bottleCount, CAREER, dayKey, makeChallenge, UPGRADE_INFO, UPGRADE_KINDS, UPGRADE_MAX, upgradeCost, upgradedSpec, weekKey, type Challenge } from '../save/progress';
import { encodeGhost, decodeGhost } from '../save/ghostCode';
import { LANG_NAME, LANGS } from './i18n';
import { checkAchievements, endlessTargets, medalName, stuntTargets, type RewardSummary } from '../save/rewards';

const MODE_SUB: Record<ModeId, string> = { quick: 'quickSub', championship: 'champSub', timetrial: 'ttSub', freeride: 'freeSub', stunt: 'stuntSub', endless: 'endlessSub', battle: 'battleSub', career: 'careerSub', tutorial: 'tutorialSub' };
const modeName = (m: ModeId) => t(m);
const modeBlurb = (m: ModeId) => t(MODE_SUB[m]);

const trackCache = new Map<string, Track>();
function trackGeo(id: string) {
  let t = trackCache.get(id);
  if (!t) {
    t = new Track(trackDef(id));
    trackCache.set(id, t);
  }
  return t;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Kart-style stats card: segmented bars, upgrades shown as a gold extension. */
function statCard(name: string, sub: string, st: Record<string, number>, base: Record<string, number> | null, foot: string) {
  const rows = Object.entries(st)
    .map(([k, v]) => {
      const b = base ? Math.min(v, base[k]) : v;
      return `<span class="g-k">${k.toUpperCase()}</span><div class="g-bar"><div class="g-fill" style="width:${b * 10}%"></div>${base && v > b ? `<div class="g-up" style="left:${b * 10}%;width:${(v - b) * 10}%"></div>` : ''}<i></i></div>`;
    })
    .join('');
  return `<div class="g-name">${name}</div><div class="g-sub">${sub}</div><div class="g-bars">${rows}</div>${foot ? `<div class="g-foot">${foot}</div>` : ''}`;
}

export class Screens {
  root: HTMLElement | null = null;
  private toastBox: HTMLElement;
  current = '';
  /** Pending setup choices. */
  private setup: EventRequest = { mode: 'quick', trackId: 'coral', weather: 'default', laps: 3, difficulty: 'normal', boat: 'speedster' };

  constructor(
    private game: Game,
    private host: HTMLElement,
  ) {
    this.toastBox = document.createElement('div');
    this.toastBox.className = 'toasts';
    host.appendChild(this.toastBox);
  }

  private mount(name: string, html: string, onBack: (() => void) | null, cls = 'screen dim') {
    this.clear();
    this.current = name;
    const r = document.createElement('div');
    r.className = cls;
    r.innerHTML = html;
    r.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t || !r.contains(t)) return;
      if (t.classList.contains('disabled')) {
        this.game.audio.click('deny');
        return;
      }
      this.handle(t.dataset.act!, t.dataset.arg ?? '', t);
    });
    this.host.insertBefore(r, this.toastBox);
    this.root = r;
    this.game.nav.attach(r, onBack);
    return r;
  }

  clear() {
    this.root?.remove();
    this.root = null;
    this.current = '';
    this.game.nav.detach();
  }

  toast(text: string, sub = 'UNLOCKED') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<small>${esc(sub)}</small>${esc(text)}`;
    this.toastBox.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .5s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 600);
    }, 3600);
  }

  // ── Dispatcher ───────────────────────────────────────────────────────────
  private handle(act: string, arg: string, el: HTMLElement) {
    const g = this.game;
    const a = g.audio;
    switch (act) {
      case 'start':
        a.click('select');
        g.audio.unlock();
        g.enterMenu();
        break;
      case 'mode':
        a.click('select');
        if (arg === 'championship') this.champ();
        else this.eventSetup(arg as ModeId);
        break;
      case 'garage':
        a.click('select');
        this.garage();
        break;
      case 'modes':
        a.click('select');
        this.modes();
        break;
      case 'career':
        a.click('select');
        this.career();
        break;
      case 'careerGo':
        this.startCareer(Number(arg));
        break;
      case 'challenges':
        a.click('select');
        this.challenges();
        break;
      case 'chalGo':
        this.startChallenge(Number(arg));
        break;
      case 'achievements':
        a.click('select');
        this.achievements();
        break;
      case 'tutorial':
        a.click('select');
        g.startTutorial();
        break;
      case 'split':
        a.click('select');
        this.splitSetup();
        break;
      case 'photo':
        a.click('select');
        g.photoMode();
        break;
      case 'replay':
        a.click('select');
        g.watchReplay();
        break;
      case 'settings':
        a.click('select');
        this.settings(arg || 'menu');
        break;
      case 'back':
        a.click('back');
        g.nav.back();
        break;
      case 'track': {
        const def = trackDef(arg);
        if (g.save.level < def.unlockLevel) {
          a.click('deny');
          this.toast(`Reach level ${def.unlockLevel}`, 'LOCKED');
          return;
        }
        a.click('move');
        this.setup.trackId = arg;
        this.refreshSetup();
        g.setBackdrop(arg, this.weatherFor());
        break;
      }
      case 'weather':
        a.click('move');
        this.setup.weather = arg as WeatherId | 'default';
        this.refreshSetup();
        g.setBackdrop(this.setup.trackId, this.weatherFor());
        break;
      case 'laps':
        a.click('move');
        this.setup.laps = Number(arg);
        this.refreshSetup();
        break;
      case 'diff':
        a.click('move');
        this.setup.difficulty = arg as EventRequest['difficulty'];
        this.refreshSetup();
        break;
      case 'boat':
        if (!g.save.data.owned.includes(arg as BoatId)) {
          a.click('deny');
          this.toast('Buy it in the Garage', 'NOT OWNED');
          return;
        }
        a.click('move');
        this.setup.boat = arg as BoatId;
        g.save.data.selectedBoat = arg as BoatId;
        g.save.save();
        this.refreshSetup();
        break;
      case 'go':
        a.click('select');
        g.startEvent({ ...this.setup });
        break;
      case 'cup':
        this.startCup(arg);
        break;
      case 'champNext':
        a.click('select');
        g.startChampRound();
        break;
      case 'champTrophy':
        a.click('select');
        this.pendingFinal?.();
        this.pendingFinal = null;
        break;
      case 'champAbandon':
        a.click('back');
        this.confirm('Abandon this championship? Points will be lost.', () => {
          g.save.data.champ = null;
          g.save.save();
          this.champ();
        });
        break;
      case 'resume':
        a.click('select');
        g.resumeRace();
        break;
      case 'restart':
        a.click('select');
        g.restartRace();
        break;
      case 'quit':
        a.click('back');
        g.quitRace();
        break;
      case 'continue':
        a.click('select');
        g.afterResults();
        break;
      case 'camera':
        a.click('move');
        g.cycleCamera();
        break;
      default:
        this.handleGarage(act, arg, el) || this.handleSettings(act, arg, el) || this.handleSplit(act, arg);
    }
  }

  // ── Title ────────────────────────────────────────────────────────────────
  title() {
    const r = this.mount(
      'title',
      `<div class="center-col">
        <div class="title-logo">RIPTIDE<small>ARCADE WAVE RACING</small></div>
        <button class="btn big primary press" data-nav data-act="start" style="margin-top:7vh;animation:pulse 1.6s infinite"><span>PRESS ENTER TO RIDE</span></button>
        <div class="hint" style="margin-top:20px;color:#cfe0ff;text-shadow:0 1px 3px #000">Keyboard · Mouse · Gamepad — every mesh, texture and sound generated in code</div>
      </div>`,
      null,
      'screen titlebg',
    );
    r.addEventListener('pointerdown', () => this.game.audio.unlock(), { once: true });
  }

  // ── Main menu ────────────────────────────────────────────────────────────
  mainMenu() {
    const g = this.game;
    const d = g.save.data;
    const lv = levelFromXp(d.xp);
    const champ = d.champ ? CUPS.find((c) => c.id === d.champ!.cupId) : null;
    const today = this.todayChallenges();
    const openCh = today.filter((c) => !d.challengesDone.includes(c.key)).length;
    const achN = Object.keys(d.achievements).length;
    this.mount(
      'menu',
      `<h1 class="h">RIPTIDE</h1><div class="sub">Arcade Wave Racing</div>
      <div class="menu">
        <button class="btn big primary" data-nav data-act="mode" data-arg="quick"><span>${t('play')}</span><span class="k">${t('quick')}</span></button>
        <button class="btn" data-nav data-act="career"><span>${t('career')}</span><span class="k">${d.career.stage >= CAREER.length ? '★ ' + t('completed') : `RIVAL ${d.career.stage + 1}/${CAREER.length}`}</span></button>
        <button class="btn" data-nav data-act="mode" data-arg="championship"><span>${t('championship')}</span><span class="k">${champ ? 'CONTINUE ' + champ.name : CUPS.length + ' CUPS'}</span></button>
        <button class="btn" data-nav data-act="challenges"><span>${t('challenges')}</span><span class="k">${openCh ? `${openCh} NEW` : '✓'}</span></button>
        <button class="btn" data-nav data-act="modes"><span>MORE MODES</span><span class="k">BATTLE · 2P · STUNT · …</span></button>
        <button class="btn" data-nav data-act="garage"><span>${t('garage')}</span><span class="k">${t('boats')} · ${t('upgrades')}</span></button>
        <button class="btn" data-nav data-act="achievements"><span>${t('achievements')}</span><span class="k">${achN}/${ACHIEVEMENTS.length}</span></button>
        <button class="btn" data-nav data-act="settings"><span>${t('settings')}</span><span class="k"></span></button>
      </div>
      <div class="profile">
        <div class="name">${esc(d.playerName)}</div>
        <div class="lvl">${t('level')} ${lv.level}${lv.level >= 20 ? ' · MAX' : ''}</div>
        <div class="xpbar"><div style="width:${((lv.into / lv.need) * 100).toFixed(1)}%"></div></div>
        <div class="stats-line"><span>${t('credits')} <b class="cr">${d.credits.toLocaleString()}</b></span><span>${t('races')} <b>${d.races}</b></span><span>${t('wins')} <b>${d.wins}</b></span></div>
        <div class="stats-line" style="margin-top:6px"><span>${t('medals')} <b>${this.medalCount()}</b></span><span>${t('boats')} <b>${d.owned.length}/${BOATS.length}</b></span><span>${t('bottles')} <b>${this.bottleTotal()}</b></span></div>
      </div>
      <div class="footer"><span class="hint">${t('menuHint').replace(/(↑↓|ENTER|ENTRÉE|ESC|ÉCHAP)/g, '<b>$1</b>')}</span>${g.save.error ? `<span class="hint" style="color:var(--pink)">${esc(g.save.error)}</span>` : ''}${g.save.recovered ? '<span class="hint" style="color:var(--yellow)">Save data was unreadable and has been reset.</span>' : ''}</div>`,
      null,
    );
    if (!d.tutorialDone && d.races === 0) setTimeout(() => this.current === 'menu' && this.toast('MORE MODES → TUTORIAL', 'NEW HERE?'), 900);
  }

  // ── More modes ───────────────────────────────────────────────────────────
  modes() {
    const g = this.game;
    const row = (act: string, arg: string, name: string, sub: string) => `<button class="btn" data-nav data-act="${act}" data-arg="${arg}"><span>${name}</span><span class="k">${sub}</span></button>`;
    this.mount(
      'modes',
      `<h1 class="h">MORE MODES</h1><div class="sub">Pick your poison</div>
      <div class="menu">
        ${row('mode', 'battle', t('battle'), 'ITEMS · TORPEDOES')}
        ${row('split', '', t('splitscreen'), 'SPLIT-SCREEN')}
        ${row('mode', 'timetrial', t('timetrial'), 'BEAT YOUR GHOST')}
        ${row('mode', 'stunt', t('stunt'), 'SCORE ATTACK')}
        ${row('mode', 'endless', t('endless'), 'SURVIVAL')}
        ${row('mode', 'freeride', t('freeride'), 'EXPLORE · BOTTLES')}
        ${row('tutorial', '', t('tutorial'), g.save.data.tutorialDone ? '✓' : 'START HERE')}
      </div>
      <div class="footer"><button class="btn" data-nav data-act="back"><span>${t('back')}</span></button></div>`,
      () => g.enterMenu(),
    );
  }

  private bottleTotal() {
    let n = 0;
    for (const tr of TRACKS) n += bottleCount(this.game.save.data.bottles[tr.id] ?? 0);
    return `${n}/${TRACKS.length * BOTTLES_PER_TRACK}`;
  }

  private todayChallenges(): Challenge[] {
    const lvl = this.game.save.level;
    const tracks = TRACKS.filter((tr) => tr.unlockLevel <= lvl && !tr.sprint).map((tr) => tr.id);
    return [makeChallenge(dayKey(), false, tracks), makeChallenge(weekKey(), true, tracks)];
  }

  // ── Challenges ───────────────────────────────────────────────────────────
  challenges() {
    const g = this.game;
    const d = g.save.data;
    const list = this.todayChallenges();
    const cards = list
      .map((c, i) => {
        const done = d.challengesDone.includes(c.key);
        const tr = trackDef(c.trackId);
        return `<div class="card chal ${done ? 'done' : ''}" data-nav data-act="chalGo" data-arg="${i}" style="width:min(420px,88vw)">
          <span class="tag">${c.weekly ? t('weekly') : t('daily')}</span>
          <canvas data-track="${c.trackId}"></canvas>
          <div class="ct">${esc(c.text)}</div>
          <div class="cs">${tr.name} · ${c.mode.toUpperCase()}${c.boat ? ' · ' + boatSpec(c.boat).name + (d.owned.includes(c.boat) ? '' : ' (LOANER)') : ''}</div>
          <div class="lock" style="color:${done ? 'var(--lime)' : 'var(--yellow)'}">${done ? '✓ ' + t('completed') : `REWARD ${c.credits.toLocaleString()} CR · ${c.xp} XP`}</div>
        </div>`;
      })
      .join('');
    this.mount(
      'challenges',
      `<h1 class="h">${t('challenges')}</h1><div class="sub">New daily challenge every day · weekly every Monday · ${d.challengesDone.length} completed</div>
      <div class="cards">${cards}</div>
      <div class="footer"><button class="btn" data-nav data-act="back"><span>${t('back')}</span></button></div>`,
      () => g.enterMenu(),
    );
    this.root!.querySelectorAll<HTMLCanvasElement>('canvas[data-track]').forEach((c) => {
      const tg = trackGeo(c.dataset.track!);
      drawTrackPreview(c, tg.px, tg.pz, '#ffd21e', trackDef(c.dataset.track!).sprint);
    });
  }

  private startChallenge(i: number) {
    const g = this.game;
    const c = this.todayChallenges()[i];
    if (!c) return;
    if (g.save.data.challengesDone.includes(c.key)) {
      g.audio.click('deny');
      this.toast('Already completed — come back tomorrow', t('completed'));
      return;
    }
    g.audio.click('select');
    const boat = c.boat ?? g.save.data.selectedBoat;
    g.startEvent({ mode: c.mode, trackId: c.trackId, weather: c.weather, laps: c.laps, difficulty: c.weekly ? 'hard' : g.save.data.settings.difficulty, boat, challenge: c });
  }

  // ── Career ───────────────────────────────────────────────────────────────
  career() {
    const g = this.game;
    const d = g.save.data;
    const cur = Math.min(d.career.stage, CAREER.length - 1);
    const rows = CAREER.map((st, i) => {
      const r = RIVALS[st.boss];
      const beaten = d.career.stage > i;
      const open = i === d.career.stage;
      const locked = i > d.career.stage;
      return `<button class="btn ${open ? 'primary' : ''} ${locked ? 'disabled' : ''}" data-nav data-act="careerGo" data-arg="${i}" style="width:100%;margin-bottom:6px">
        <span><i style="display:inline-block;width:12px;height:12px;background:${r.hull};margin-right:8px;transform:skewX(-10deg)"></i>${i + 1}. ${r.name} — ${st.title}</span>
        <span class="k">${beaten ? '✓ BEATEN' : locked ? '🔒' : trackDef(st.trackId).name}</span></button>`;
    }).join('');
    const st = CAREER[cur];
    const done = d.career.stage >= CAREER.length;
    this.mount(
      'career',
      `<h1 class="h">${t('career')}</h1><div class="sub">${t('careerSub')}</div>
      <div class="grid2"><div class="scroll">${rows}</div>
      <div><div class="panel"><div class="label" style="margin-top:0">${done ? 'CHAMPION' : 'NEXT RIVAL'}</div>
        <div style="font-family:var(--font);font-style:italic;font-size:30px;color:${RIVALS[st.boss].hull}">${RIVALS[st.boss].name}</div>
        <div class="hint" style="font-size:15px;margin:8px 0 12px;line-height:1.4">${done ? 'You have beaten every rival on the water. Replay any stage for fun.' : esc(st.intro)}</div>
        <div class="hint">${trackDef(st.trackId).name} · ${st.weather.toUpperCase()} · ${st.laps} LAPS · ${st.difficulty.toUpperCase()} FIELD</div>
        <div class="hint" style="margin-top:6px">Finish ahead of ${RIVALS[st.boss].name} to advance · REWARD ${st.credits.toLocaleString()} CR</div></div></div></div>
      <div class="footer"><button class="btn" data-nav data-act="back"><span>${t('back')}</span></button></div>`,
      () => g.enterMenu(),
    );
    g.setBackdrop(st.trackId, st.weather);
  }

  private startCareer(i: number) {
    const g = this.game;
    if (i > g.save.data.career.stage) {
      g.audio.click('deny');
      return;
    }
    g.audio.click('select');
    const st = CAREER[i];
    this.setup.trackId = st.trackId;
    this.setup.weather = st.weather;
    this.setup.careerStage = i;
    this.eventSetup('career', st.trackId);
  }

  // ── Split-screen setup ───────────────────────────────────────────────────
  private split = { trackId: 'coral', weather: 'default' as WeatherId | 'default', laps: 3, opponents: 2, difficulty: 'normal' as EventRequest['difficulty'], p1: 'speedster' as BoatId, p2: 'drifter' as BoatId };

  splitSetup() {
    const g = this.game;
    this.split.p1 = g.save.data.selectedBoat;
    this.mount(
      'split',
      `<h1 class="h">${t('splitscreen')}</h1><div class="sub">${t('splitSub')} · No progression is awarded</div>
      <div class="scroll" style="flex:1" id="splitBody"></div>
      <div class="footer"><button class="btn" data-nav data-act="back"><span>${t('back')}</span></button><span class="spacer"></span>
      <button class="btn big primary" data-nav data-act="splitGo" id="splitGo"><span>${t('start')}</span><span class="k">ENTER</span></button></div>`,
      () => this.modes(),
      'screen full',
    );
    this.refreshSplit();
    g.nav.focus(this.root!.querySelector('#splitGo') as HTMLElement, false);
  }

  private refreshSplit() {
    const body = this.root?.querySelector('#splitBody');
    if (!body) return;
    const g = this.game;
    const sp = this.split;
    const focusedAct = g.nav.current?.dataset.act;
    const focusedArg = g.nav.current?.dataset.arg;
    const lvl = g.save.level;
    const opt = (act: string, arg: string, label: string, on: boolean, locked = false) => `<button class="opt ${on ? 'on' : ''} ${locked ? 'disabled' : ''}" data-nav data-act="${act}" data-arg="${arg}">${label}</button>`;
    body.innerHTML = `
      <div class="label">${t('course')}</div><div class="opts">${TRACKS.map((tr) => opt('sp_track', tr.id, tr.name + (lvl < tr.unlockLevel ? ' 🔒' : ''), sp.trackId === tr.id, lvl < tr.unlockLevel)).join('')}</div>
      <div class="label">${t('weather')}</div><div class="opts">${['default', ...WEATHER_IDS].map((w) => opt('sp_weather', w, w === 'default' ? t('trackDefault') : WEATHER[w as WeatherId].name, sp.weather === w)).join('')}</div>
      ${trackDef(sp.trackId).sprint ? '' : `<div class="label">${t('laps')}</div><div class="opts">${[1, 2, 3, 4, 5].map((n) => opt('sp_laps', String(n), String(n), sp.laps === n)).join('')}</div>`}
      <div class="label">AI rivals</div><div class="opts">${[0, 1, 2, 3, 4].map((n) => opt('sp_opp', String(n), String(n), sp.opponents === n)).join('')}${(['easy', 'normal', 'hard'] as const).map((d) => opt('sp_diff', d, d.toUpperCase(), sp.difficulty === d)).join('')}</div>
      <div class="grid2" style="margin-top:8px;flex:none">
        <div class="panel"><div class="label" style="margin-top:0;color:var(--pink)">PLAYER 1 · TOP</div><div class="opts">${BOATS.map((b) => opt('sp_p1', b.id, b.name, sp.p1 === b.id)).join('')}</div>
          <div class="hint" style="margin-top:8px"><b>W A S D</b> drive · <b>SPACE</b> drift · <b>E</b> nitro · <b>Q</b> roll · <b>F</b> item · <b>C</b> camera · <b>T</b> respawn · or gamepad 1</div></div>
        <div class="panel"><div class="label" style="margin-top:0;color:var(--cyan)">PLAYER 2 · BOTTOM</div><div class="opts">${BOATS.map((b) => opt('sp_p2', b.id, b.name, sp.p2 === b.id)).join('')}</div>
          <div class="hint" style="margin-top:8px"><b>ARROWS</b> drive · <b>R-SHIFT</b> drift · <b>R-CTRL</b> nitro · <b>.</b> roll · <b>/</b> item · <b>M</b> camera · <b>\</b> respawn · or gamepad 2 (gamepad 1 if only one)</div></div>
      </div>`;
    const again = focusedAct ? (body.querySelector(`[data-act="${focusedAct}"][data-arg="${focusedArg}"]`) as HTMLElement | null) : null;
    if (again) g.nav.focus(again, false);
  }

  private handleSplit(act: string, arg: string): boolean {
    const g = this.game;
    const sp = this.split;
    switch (act) {
      case 'sp_track':
        sp.trackId = arg;
        g.setBackdrop(arg, sp.weather === 'default' ? trackDef(arg).weather : sp.weather);
        break;
      case 'sp_weather':
        sp.weather = arg as WeatherId | 'default';
        break;
      case 'sp_laps':
        sp.laps = Number(arg);
        break;
      case 'sp_opp':
        sp.opponents = Number(arg);
        break;
      case 'sp_diff':
        sp.difficulty = arg as EventRequest['difficulty'];
        break;
      case 'sp_p1':
        sp.p1 = arg as BoatId;
        break;
      case 'sp_p2':
        sp.p2 = arg as BoatId;
        break;
      case 'splitGo':
        g.audio.click('select');
        g.startEvent({ mode: 'quick', trackId: sp.trackId, weather: sp.weather, laps: sp.laps, difficulty: sp.difficulty, boat: sp.p1, p2Boat: sp.p2, opponents: sp.opponents });
        return true;
      default:
        return false;
    }
    g.audio.click('move');
    this.refreshSplit();
    return true;
  }

  // ── Achievements ─────────────────────────────────────────────────────────
  achievements() {
    const g = this.game;
    const d = g.save.data;
    const list = ACHIEVEMENTS.map((a) => {
      const got = d.achievements[a.id];
      return `<div class="ach ${got ? 'got' : ''}" data-nav><b>${got ? '★' : '☆'} ${a.name}</b><span>${a.desc}</span><em>${got ? new Date(got).toLocaleDateString() : `+${a.credits} CR`}</em></div>`;
    }).join('');
    const st = d.stats;
    const bottles = TRACKS.map((tr) => `<div class="row hint" style="font-size:13px"><span>${tr.name}</span><span class="spacer"></span><b>${bottleCount(d.bottles[tr.id] ?? 0)}/${BOTTLES_PER_TRACK}</b></div>`).join('');
    this.mount(
      'achievements',
      `<h1 class="h">${t('achievements')}</h1><div class="sub">${Object.keys(d.achievements).length} of ${ACHIEVEMENTS.length} unlocked</div>
      <div class="grid2"><div class="scroll achs">${list}</div>
      <div class="scroll"><div class="panel"><div class="label" style="margin-top:0">LIFETIME</div>
        <div class="hint" style="font-size:14px;line-height:1.8">TRICKS <b>${st.tricks}</b> · PINK DRIFTS <b>${st.tier3}</b> · CLEAN LANDINGS <b>${st.cleanLandings}</b><br>
        BEST AIR <b>${st.bestAir.toFixed(1)} s</b> · TOP SPEED <b>${Math.round(st.topSpeed * 3.6)} KM/H</b><br>
        DISTANCE <b>${(st.distance / 1000).toFixed(1)} KM</b> · ITEM HITS <b>${st.itemHits}</b> · PERFECT STARTS <b>${st.perfectStarts}</b></div>
        <div class="label">MESSAGE BOTTLES ${this.bottleTotal()}</div>${bottles}
        <div class="hint" style="margin-top:8px">Bottles hide off the racing line, in shortcuts and in the air past ramps. Free Ride is the best way to hunt them.</div></div></div></div>
      <div class="footer"><button class="btn" data-nav data-act="back"><span>${t('back')}</span></button></div>`,
      () => g.enterMenu(),
    );
  }

  private medalCount() {
    let n = 0;
    for (const m of Object.values(this.game.save.data.medals)) n += (m.race ? 1 : 0) + (m.tt ? 1 : 0) + (m.stunt ? 1 : 0);
    return n;
  }

  private medalsHtml(trackId: string) {
    const m = this.game.save.data.medals[trackId];
    if (!m) return '';
    return `<div class="medals" title="Race · Time Trial · Stunt"><span class="medal m${m.race}"></span><span class="medal m${m.tt}"></span><span class="medal m${m.stunt}"></span></div>`;
  }

  private weatherFor(): WeatherId {
    return this.setup.weather === 'default' ? trackDef(this.setup.trackId).weather : this.setup.weather;
  }

  // ── Event setup ──────────────────────────────────────────────────────────
  eventSetup(mode: ModeId, fixedTrack?: string) {
    const g = this.game;
    const s = g.save.data;
    this.setup.mode = mode;
    if (mode !== 'career') this.setup.careerStage = undefined;
    this.setup.challenge = null;
    this.setup.boat = s.selectedBoat;
    this.setup.difficulty = s.settings.difficulty;
    this.setup.laps = s.settings.laps;
    if (fixedTrack) this.setup.trackId = fixedTrack;
    else if (g.save.level < trackDef(this.setup.trackId).unlockLevel) this.setup.trackId = 'coral';
    // Stunt and endless need a lapped course; sprints are hidden from their list.
    if ((mode === 'stunt' || mode === 'endless') && trackDef(this.setup.trackId).sprint) this.setup.trackId = 'coral';
    this.mount(
      'setup',
      `<h1 class="h">${modeName(mode)}</h1><div class="sub">${modeBlurb(mode)}</div>
      <div class="scroll" style="flex:1" id="setupBody"></div>
      <div class="footer">
        <button class="btn" data-nav data-act="back"><span>BACK</span></button>
        <span class="spacer"></span>
        <button class="btn big primary" data-nav data-act="go" id="goBtn"><span>${mode === 'championship' ? 'START ROUND' : 'START'}</span><span class="k">ENTER</span></button>
      </div>`,
      () => (mode === 'championship' ? this.champ() : mode === 'career' ? this.career() : mode === 'quick' || mode === 'battle' ? g.enterMenu() : this.modes()),
      'screen full',
    );
    this.refreshSetup(fixedTrack);
    g.setBackdrop(this.setup.trackId, this.weatherFor());
    const go = this.root!.querySelector('#goBtn') as HTMLElement;
    this.game.nav.focus(go, false);
  }

  private refreshSetup(fixedTrack?: string) {
    const body = this.root?.querySelector('#setupBody');
    if (!body) return;
    const g = this.game;
    const st = this.setup;
    const lvl = g.save.level;
    const rec = g.save.data.records[st.trackId] ?? {};
    const focusedAct = g.nav.current?.dataset.act;
    const focusedArg = g.nav.current?.dataset.arg;
    const showTracks = st.mode !== 'championship' && st.mode !== 'career';
    const stage = st.mode === 'career' && st.careerStage !== undefined ? CAREER[st.careerStage] : null;
    const tracks = TRACKS.filter((t) => !(t.sprint && (st.mode === 'stunt' || st.mode === 'endless'))).map((t) => {
      const locked = lvl < t.unlockLevel;
      return `<div class="card ${t.id === st.trackId ? 'sel' : ''} ${locked ? 'locked' : ''}" data-nav data-act="track" data-arg="${t.id}">
        <span class="tag">${t.theme.toUpperCase()}</span>
        <canvas data-track="${t.id}"></canvas>
        <div class="ct">${t.name}</div><div class="cs">${t.blurb}</div>
        ${locked ? `<div class="lock">🔒 LEVEL ${t.unlockLevel}</div>` : this.medalsHtml(t.id)}
      </div>`;
    }).join('');
    const weather = ['default', ...WEATHER_IDS]
      .map((w) => `<button class="opt ${st.weather === w ? 'on' : ''}" data-nav data-act="weather" data-arg="${w}">${w === 'default' ? 'TRACK DEFAULT' : WEATHER[w as WeatherId].name}</button>`)
      .join('');
    const boats = BOATS.map((b) => {
      const owned = g.save.data.owned.includes(b.id);
      return `<button class="opt ${st.boat === b.id ? 'on' : ''} ${owned ? '' : 'disabled'}" data-nav data-act="boat" data-arg="${b.id}">${b.name}${owned ? '' : ' 🔒'}</button>`;
    }).join('');
    const spec = boatSpec(st.boat);
    const stats = boatStats(spec);
    const bars = Object.entries(stats).map(([k, v]) => `<span>${k.toUpperCase()}</span><div class="sbar"><div style="width:${v * 10}%"></div></div>`).join('');
    const sprint = !!trackDef(st.trackId).sprint;
    const laps = (st.mode === 'quick' || st.mode === 'timetrial' || st.mode === 'battle') && !sprint ? `<div class="label">Laps</div><div class="opts">${[1, 2, 3, 4, 5].map((n) => `<button class="opt ${st.laps === n ? 'on' : ''}" data-nav data-act="laps" data-arg="${n}">${n}</button>`).join('')}</div>` : '';
    const diff = st.mode === 'quick' || st.mode === 'championship' || st.mode === 'battle' ? `<div class="label">Opponents</div><div class="opts">${(['easy', 'normal', 'hard'] as const).map((d) => `<button class="opt ${st.difficulty === d ? 'on' : ''}" data-nav data-act="diff" data-arg="${d}">${d.toUpperCase()}</button>`).join('')}</div>` : '';
    let records = '';
    const ghost = g.save.data.ghosts[st.trackId];
    if (st.mode === 'timetrial') {
      const [gm, sm, bm] = trackDef(st.trackId).medals;
      records = `BEST LAP <b>${rec.lap ? formatTime(rec.lap) : '—'}</b> · GOLD ${formatTime(gm)} · SILVER ${formatTime(sm)} · BRONZE ${formatTime(bm)}${ghost ? ` · GHOST ${formatTime(ghost.time)}` : ''}`;
    } else if (st.mode === 'stunt') {
      const [gm, sm, bm] = stuntTargets(st.trackId);
      records = `BEST <b>${rec.stunt ?? '—'}</b> · GOLD ${gm} · SILVER ${Math.round(sm)} · BRONZE ${Math.round(bm)}`;
    } else if (st.mode === 'endless') {
      const [gm, sm, bm] = endlessTargets();
      records = `BEST <b>${rec.endless ?? '—'} m</b> · GOLD ${gm} m · SILVER ${sm} m · BRONZE ${bm} m`;
    } else if (st.mode === 'career' && stage) {
      records = '';
    } else if (st.mode !== 'freeride') records = `RECORD <b>${rec.race ? formatTime(rec.race) : '—'}</b> · BEST LAP <b>${rec.lap ? formatTime(rec.lap) : '—'}</b>`;
    const dyn = st.mode === 'quick' || st.mode === 'championship' || st.mode === 'battle' || st.mode === 'freeride';
    const dynHtml = dyn ? `<div class="label">${t('dynWeather')}</div><div class="opts">${[false, true].map((v) => `<button class="opt ${g.save.data.settings.dynamicWeather === v ? 'on' : ''}" data-nav data-act="dynw" data-arg="${v}">${v ? t('on') : t('off')}</button>`).join('')}</div>` : '';
    const ghostHtml =
      st.mode === 'timetrial'
        ? `<div class="label">Ghost sharing</div><div class="opts"><button class="opt ${ghost ? '' : 'disabled'}" data-nav data-act="ghostShare">SHARE MY GHOST</button><button class="opt" data-nav data-act="ghostImport">RACE A FRIEND'S GHOST</button>${ghost?.name ? `<span class="hint" style="align-self:center">Current ghost: <b>${esc(ghost.name)}</b> ${formatTime(ghost.time)}</span>` : ''}</div>`
        : '';
    const bossHtml = stage
      ? `<div class="panel" style="margin:8px 0;border-left:4px solid ${RIVALS[stage.boss].hull}"><div style="font-family:var(--font);font-style:italic;font-size:22px">${RIVALS[stage.boss].name} · ${stage.title}</div><div class="hint" style="font-size:14px;margin-top:6px">${esc(stage.intro)}</div><div class="hint" style="margin-top:6px">${stage.laps} LAPS · ${stage.weather.toUpperCase()} · Finish ahead of ${RIVALS[stage.boss].name}</div></div>`
      : '';
    body.innerHTML = `
      ${bossHtml}
      ${showTracks ? `<div class="label">Course</div><div class="cards">${tracks}</div>` : `<div class="label">Course</div><div class="panel"><b style="font-family:var(--font);font-size:22px;font-style:italic">${trackDef(fixedTrack ?? st.trackId).name}</b><div class="hint">${trackDef(st.trackId).blurb}</div></div>`}
      <div class="hint" style="margin:4px 0 4px">${records}</div>
      ${stage ? '' : `<div class="label">${t('weather')}</div><div class="opts">${weather}</div>`}
      ${laps}${diff}${dynHtml}${ghostHtml}
      <div class="label">Watercraft</div><div class="opts">${boats}</div>
      <div class="panel" style="margin-top:10px;max-width:520px"><div style="font-family:var(--font);font-style:italic;font-size:18px">${spec.name}</div><div class="hint" style="margin-bottom:8px">${spec.tagline}</div><div class="statbars">${bars}</div></div>`;
    body.querySelectorAll<HTMLCanvasElement>('canvas[data-track]').forEach((c) => {
      const t = trackGeo(c.dataset.track!);
      drawTrackPreview(c, t.px, t.pz, c.dataset.track === st.trackId ? '#ff3b5c' : '#26e8ff', trackDef(c.dataset.track!).sprint);
    });
    // Restore focus to the equivalent control after re-render.
    const again = focusedAct ? (body.querySelector(`[data-act="${focusedAct}"][data-arg="${focusedArg}"]`) as HTMLElement | null) : null;
    if (again) g.nav.focus(again, false);
  }

  // ── Championship ─────────────────────────────────────────────────────────
  champ() {
    const g = this.game;
    const d = g.save.data;
    const lvl = g.save.level;
    const cards = CUPS.map((c) => {
      const locked = lvl < c.unlockLevel;
      const active = d.champ?.cupId === c.id;
      const trophy = d.cups[c.id] ?? 0;
      return `<div class="card ${locked ? 'locked' : ''} ${active ? 'sel' : ''}" data-nav data-act="cup" data-arg="${c.id}" style="width:260px">
        <span class="tag">${c.tracks.length} RACES</span>
        <div class="ct" style="margin-top:22px">${c.name}</div>
        <div class="cs">${c.tracks.map((t) => trackDef(t).name).join(' · ')}</div>
        ${locked ? `<div class="lock">🔒 LEVEL ${c.unlockLevel}</div>` : `<div class="medals"><span class="medal m${trophy}"></span><span class="hint" style="margin-left:6px">${trophy ? medalName(trophy) + ' TROPHY' : 'NO TROPHY YET'}</span></div>`}
        ${active ? `<div class="lock" style="color:var(--cyan)">IN PROGRESS · ROUND ${d.champ!.round + 1}</div>` : ''}
      </div>`;
    }).join('');
    this.mount(
      'champ',
      `<h1 class="h">CHAMPIONSHIP</h1><div class="sub">Points: ${CHAMP_POINTS.slice(0, 6).join(' · ')} — top three take a trophy</div>
      <div class="cards">${cards}</div>
      ${d.champ ? `<div class="row"><button class="btn small" data-nav data-act="champAbandon"><span>ABANDON CURRENT CUP</span></button></div>` : ''}
      <div class="footer"><button class="btn" data-nav data-act="back"><span>BACK</span></button></div>`,
      () => g.enterMenu(),
    );
  }

  private startCup(id: string) {
    const g = this.game;
    const d = g.save.data;
    const cup = CUPS.find((c) => c.id === id)!;
    if (g.save.level < cup.unlockLevel) {
      g.audio.click('deny');
      this.toast(`Reach level ${cup.unlockLevel}`, 'LOCKED');
      return;
    }
    g.audio.click('select');
    const go = () => {
      if (!d.champ || d.champ.cupId !== id) {
        d.champ = { cupId: id, round: 0, points: new Array(1 + Math.min(5, RIVALS.length)).fill(0) };
        g.save.save();
      }
      this.champStandings();
    };
    if (d.champ && d.champ.cupId !== id) this.confirm('Start a new cup? Your current championship will be abandoned.', go);
    else go();
  }

  champStandings(lastRound = false) {
    const g = this.game;
    const ch = g.save.data.champ;
    if (!ch) return this.champ();
    const cup = CUPS.find((c) => c.id === ch.cupId)!;
    const names = [g.save.data.playerName, ...RIVALS.slice(0, ch.points.length - 1).map((r) => r.name)];
    const rows = ch.points
      .map((p, i) => ({ p, i }))
      .sort((a, b) => b.p - a.p)
      .map((o, k) => `<tr class="${o.i === 0 ? 'me' : ''}"><td class="p">${k + 1}</td><td>${esc(names[o.i])}</td><td class="t">${o.p} PTS</td></tr>`)
      .join('');
    const nextTrack = cup.tracks[ch.round];
    this.mount(
      'champStandings',
      `<h1 class="h">${cup.name}</h1><div class="sub">${lastRound ? 'FINAL STANDINGS' : `ROUND ${ch.round + 1} OF ${cup.tracks.length} — ${trackDef(nextTrack).name}`}</div>
      <div class="grid2"><div class="panel scroll"><table class="res">${rows}</table></div>
      <div><div class="label">Schedule</div>${cup.tracks.map((t, i) => `<div class="hint" style="font-size:15px;margin:6px 0;${i === ch.round ? 'color:var(--cyan)' : i < ch.round ? 'opacity:.5' : ''}">${i + 1}. ${trackDef(t).name}${i < ch.round ? ' ✓' : ''}</div>`).join('')}</div></div>
      <div class="footer"><button class="btn" data-nav data-act="back"><span>MENU</span></button><span class="spacer"></span>
      <button class="btn big primary" data-nav data-act="champNext" data-default><span>${ch.round === 0 ? 'CHOOSE BOAT' : 'NEXT RACE'}</span><span class="k">ENTER</span></button></div>`,
      () => g.enterMenu(),
    );
  }

  /** Final table of a finished cup (championship state has already been cleared). */
  champFinalStandings(cupId: string, points: number[], next: () => void) {
    const cup = CUPS.find((c) => c.id === cupId)!;
    const names = [this.game.save.data.playerName, ...RIVALS.slice(0, points.length - 1).map((r) => r.name)];
    const rows = points
      .map((p, i) => ({ p, i }))
      .sort((a, b) => b.p - a.p)
      .map((o, k) => `<tr class="${o.i === 0 ? 'me' : ''}"><td class="p">${k + 1}</td><td>${esc(names[o.i])}</td><td class="t">${o.p} PTS</td></tr>`)
      .join('');
    this.pendingFinal = next;
    this.mount(
      'champStandings',
      `<h1 class="h">${cup.name}</h1><div class="sub">FINAL STANDINGS</div>
      <div class="panel scroll" style="max-width:560px">${rows ? `<table class="res">${rows}</table>` : ''}</div>
      <div class="footer"><span class="spacer"></span><button class="btn big primary" data-nav data-act="champTrophy" data-default><span>SEE TROPHY</span><span class="k">ENTER</span></button></div>`,
      () => next(),
      'screen full',
    );
  }
  private pendingFinal: (() => void) | null = null;

  champSetup() {
    const ch = this.game.save.data.champ!;
    const cup = CUPS.find((c) => c.id === ch.cupId)!;
    this.setup.trackId = cup.tracks[ch.round];
    this.setup.weather = 'default';
    this.eventSetup('championship', cup.tracks[ch.round]);
  }

  champFinal(place: number, xp: number, credits: number, cupName: string) {
    this.mount(
      'champFinal',
      `<div class="center-col"><div class="sub">${cupName} — FINAL RESULT</div><div class="bigplace">${ordinal(place)}</div>
      <div style="font-family:var(--font);font-size:28px;font-style:italic;margin:10px 0;color:${place === 1 ? 'var(--gold)' : place === 2 ? 'var(--silver)' : place === 3 ? 'var(--bronze)' : 'var(--dim)'}">${place <= 3 ? medalName(4 - place) + ' TROPHY' : 'NO TROPHY'}</div>
      <div class="reward"><div><span class="n">+${xp}</span><span class="l">XP</span></div><div><span class="n cr">+${credits}</span><span class="l">CREDITS</span></div></div>
      <button class="btn big primary" data-nav data-act="continue" data-default style="margin-top:20px"><span>CONTINUE</span></button></div>`,
      () => this.game.afterResults(),
      'screen full',
    );
  }

  // ── Garage ───────────────────────────────────────────────────────────────
  private garageBoat: BoatId = 'speedster';
  private garageTab = 'boats';

  garage(tab = 'boats') {
    const g = this.game;
    this.garageBoat = g.save.data.selectedBoat;
    this.garageTab = tab;
    this.mount(
      'garage',
      `<div class="g-banner"><h1 class="h">GARAGE</h1></div><div class="g-credits" id="gCredits"></div>
      <div class="tabs" id="gTabs"></div>
      <div class="grid2"><div class="scroll" id="gBody"></div><div class="g-side"><div class="g-stats" id="gStats"></div></div></div>
      <div class="footer"><button class="btn" data-nav data-act="back"><span>BACK</span></button><span class="hint">Changes save automatically</span></div>`,
      () => {
        g.endGarage();
        g.enterMenu();
      },
      'screen dim garage',
    );
    g.beginGarage(this.garageBoat);
    this.refreshGarage();
  }

  private refreshGarage() {
    const g = this.game;
    const body = this.root?.querySelector('#gBody');
    if (!body) return;
    const d = g.save.data;
    const lvl = g.save.level;
    const cos = cosmeticUnlocks(lvl);
    const focusedAct = g.nav.current?.dataset.act;
    const focusedArg = g.nav.current?.dataset.arg;
    (this.root!.querySelector('#gCredits') as HTMLElement).innerHTML = `<span class="coin"></span><b>${d.credits.toLocaleString()}</b><small>LV ${lvl}</small>`;
    const tabs = ['boats', 'upgrades', 'paint', 'style', 'fx'];
    (this.root!.querySelector('#gTabs') as HTMLElement).innerHTML = tabs
      .map((t) => `<button class="opt ${this.garageTab === t ? 'on' : ''}" data-nav data-act="gtab" data-arg="${t}">${{ boats: t2('boats'), upgrades: t2('upgrades'), paint: t2('paint'), style: t2('stripes'), fx: t2('trail') }[t]}</button>`)
      .join('');
    const liv = g.save.livery(this.garageBoat);
    const spec = boatSpec(this.garageBoat);
    let html = '';
    let side = statCard(spec.name, spec.tagline, boatStats(upgradedSpec(spec, g.save.upgrades(spec.id))), null, '');
    if (this.garageTab === 'boats') {
      html = BOATS.map((b) => {
        const owned = d.owned.includes(b.id);
        const avail = lvl >= b.unlockLevel;
        const state = owned ? (d.selectedBoat === b.id ? 'SELECTED' : 'OWNED') : avail ? `${b.price.toLocaleString()} CR` : `LEVEL ${b.unlockLevel}`;
        return `<button class="btn ${this.garageBoat === b.id ? 'focus-sel' : ''}" data-nav data-act="gboat" data-arg="${b.id}" style="width:100%;margin-bottom:6px;${this.garageBoat === b.id ? 'border-left-color:var(--pink)' : ''}"><span>${b.name}</span><span class="k">${state}</span></button>`;
      }).join('');
      const st = boatStats(spec);
      const owned = d.owned.includes(spec.id);
      const avail = lvl >= spec.unlockLevel;
      side = statCard(spec.name, spec.tagline, st, null, `TOP ${Math.round(spec.topSpeed * 3.6)} KM/H · BOOST ${Math.round(spec.boostTopSpeed * 3.6)} KM/H · ${spec.length.toFixed(1)} M`);
      html += `<div class="panel" style="margin-top:10px">
        <div class="row">${
          owned
            ? `<button class="btn small" data-nav data-act="gselect" data-arg="${spec.id}"><span>${d.selectedBoat === spec.id ? '✓ SELECTED' : 'SELECT'}</span></button>`
            : avail
              ? `<button class="btn small primary ${d.credits < spec.price ? 'disabled' : ''}" data-nav data-act="gbuy" data-arg="${spec.id}"><span>BUY ${spec.price.toLocaleString()} CR</span></button>`
              : `<span class="lock">🔒 REACH LEVEL ${spec.unlockLevel}</span>`
        }</div></div>`;
    } else if (this.garageTab === 'upgrades') {
      const owned = d.owned.includes(spec.id);
      const up = g.save.upgrades(spec.id);
      const base = boatStats(spec);
      const now = boatStats(upgradedSpec(spec, up));
      html = `<div class="hint" style="margin-bottom:10px">Upgrades belong to each boat. ${owned ? '' : '<b style="color:var(--yellow)">Buy this boat first.</b>'}</div>`;
      html += UPGRADE_KINDS.map((k) => {
        const lvlK = up[k];
        const maxed = lvlK >= UPGRADE_MAX;
        const cost = upgradeCost(k, lvlK);
        const pips = Array.from({ length: UPGRADE_MAX }, (_, i) => `<i class="pip ${i < lvlK ? 'on' : ''}"></i>`).join('');
        return `<div class="panel upg"><div class="row"><b style="font-family:var(--font);font-style:italic">${UPGRADE_INFO[k].name}</b><span class="pips">${pips}</span><span class="spacer"></span>
          <button class="btn small ${maxed ? '' : 'primary'} ${!owned || maxed || d.credits < cost ? 'disabled' : ''}" data-nav data-act="gup" data-arg="${k}"><span>${maxed ? 'MAXED' : `${cost.toLocaleString()} CR`}</span></button></div>
          <div class="hint">${UPGRADE_INFO[k].blurb}</div></div>`;
      }).join('');
      side = statCard(spec.name, 'UPGRADED STATS', now, base, `TOP ${Math.round(upgradedSpec(spec, up).topSpeed * 3.6)} KM/H (stock ${Math.round(spec.topSpeed * 3.6)})`);
    } else if (this.garageTab === 'paint') {
      const sw = (field: 'hull' | 'accent', list: string[], n: number) =>
        `<div class="swatches">${list.map((c, i) => `<button class="sw ${liv[field] === c ? 'on' : ''} ${i >= n ? 'lk disabled' : ''}" style="background:${c}" data-nav data-act="gpaint" data-arg="${field}:${c}" title="${i >= n ? 'Unlocks at a higher level' : c}"></button>`).join('')}</div>`;
      html = `<div class="label">Hull colour</div>${sw('hull', PAINTS, cos.paints)}<div class="label">Accent colour</div>${sw('accent', PAINTS, cos.paints)}
        <div class="label">Race number</div><div class="opts"><button class="opt" data-nav data-act="gnum" data-arg="-1">◀</button><span style="font-family:var(--font);font-size:26px;padding:0 14px;font-style:italic">${liv.number}</span><button class="opt" data-nav data-act="gnum" data-arg="1">▶</button><button class="opt" data-nav data-act="gnum" data-arg="10">+10</button></div>`;
    } else if (this.garageTab === 'style') {
      html = `<div class="label">Stripe pattern</div><div class="opts">${STRIPES.map((s, i) => `<button class="opt ${liv.stripe === s ? 'on' : ''} ${i >= cos.stripes ? 'disabled' : ''}" data-nav data-act="gstripe" data-arg="${s}">${s.toUpperCase()}${i >= cos.stripes ? ' 🔒' : ''}</button>`).join('')}</div>
      <div class="label">Decal</div><div class="opts">${DECALS.map((s, i) => `<button class="opt ${liv.decal === s ? 'on' : ''} ${i >= cos.decals ? 'disabled' : ''}" data-nav data-act="gdecal" data-arg="${s}">${s.toUpperCase()}${i >= cos.decals ? ' 🔒' : ''}</button>`).join('')}</div>`;
    } else {
      const sw = (field: 'trail' | 'boost', list: string[], n: number) =>
        `<div class="swatches">${list.map((c, i) => `<button class="sw ${liv[field] === c ? 'on' : ''} ${i >= n ? 'lk disabled' : ''}" style="background:${c}" data-nav data-act="gpaint" data-arg="${field}:${c}"></button>`).join('')}</div>`;
      html = `<div class="label">Wake trail tint</div>${sw('trail', TRAILS, cos.trails)}<div class="label">Boost flame</div>${sw('boost', BOOSTS, cos.boosts)}<div class="hint" style="margin-top:12px">Locked swatches unlock as you level up.</div>`;
    }
    body.innerHTML = html;
    const sideEl = this.root!.querySelector('#gStats');
    if (sideEl) sideEl.innerHTML = side;
    const again = focusedAct ? (this.root!.querySelector(`[data-act="${focusedAct}"][data-arg="${focusedArg}"]`) as HTMLElement | null) : null;
    if (again) g.nav.focus(again, false);
    else {
      const first = this.root!.querySelector('#gBody [data-nav]') as HTMLElement | null;
      if (first) g.nav.focus(first, false);
    }
  }

  private handleGarage(act: string, arg: string, _el: HTMLElement): boolean {
    const g = this.game;
    const d = g.save.data;
    const liv = (): Livery => g.save.livery(this.garageBoat);
    const commit = (l: Livery) => {
      d.liveries[this.garageBoat] = l;
      g.save.save();
      g.previewLivery(l);
      this.refreshGarage();
    };
    switch (act) {
      case 'gtab':
        g.audio.click('move');
        this.garageTab = arg;
        this.refreshGarage();
        return true;
      case 'gboat':
        g.audio.click('move');
        this.garageBoat = arg as BoatId;
        g.previewBoat(this.garageBoat);
        this.refreshGarage();
        return true;
      case 'gselect':
        g.audio.click('select');
        d.selectedBoat = arg as BoatId;
        g.save.save();
        this.refreshGarage();
        return true;
      case 'gbuy': {
        const spec = boatSpec(arg);
        if (d.credits < spec.price || g.save.level < spec.unlockLevel) {
          g.audio.click('deny');
          return true;
        }
        this.confirm(`Buy ${spec.name} for ${spec.price.toLocaleString()} credits?`, () => {
          d.credits -= spec.price;
          d.owned.push(spec.id);
          d.selectedBoat = spec.id;
          const ach = checkAchievements(g.save);
          g.save.save(true);
          g.audio.unlockSting();
          this.toast(spec.name, 'PURCHASED');
          ach.forEach((n, i) => setTimeout(() => this.toast(n, 'ACHIEVEMENT'), 700 + i * 700));
          this.garage('boats');
        });
        return true;
      }
      case 'gpaint': {
        const [field, color] = arg.split(':');
        g.audio.click('move');
        commit({ ...liv(), [field]: color });
        return true;
      }
      case 'gnum': {
        g.audio.click('move');
        const n = (liv().number + Number(arg) + 100) % 100;
        commit({ ...liv(), number: n });
        return true;
      }
      case 'gup': {
        const k = arg as (typeof UPGRADE_KINDS)[number];
        const up = { ...g.save.upgrades(this.garageBoat) };
        const cost = upgradeCost(k, up[k]);
        if (!d.owned.includes(this.garageBoat) || up[k] >= UPGRADE_MAX || d.credits < cost) {
          g.audio.click('deny');
          return true;
        }
        d.credits -= cost;
        up[k]++;
        d.upgrades[this.garageBoat] = up;
        const ach = checkAchievements(g.save);
        g.save.save(true);
        g.audio.unlockSting();
        this.toast(`${UPGRADE_INFO[k].name} STAGE ${up[k]}`, 'UPGRADED');
        ach.forEach((n, i) => setTimeout(() => this.toast(n, 'ACHIEVEMENT'), 700 + i * 700));
        this.refreshGarage();
        return true;
      }
      case 'dynw':
        g.audio.click('move');
        g.save.data.settings.dynamicWeather = arg === 'true';
        g.save.save();
        this.refreshSetup();
        return true;
      case 'ghostShare': {
        const gh = d.ghosts[this.setup.trackId];
        if (!gh) return true;
        g.audio.click('select');
        void encodeGhost(gh, gh.name ?? d.playerName).then((code) => this.showText('YOUR GHOST CODE', `Send this to a friend. They paste it into RACE A FRIEND'S GHOST on ${trackDef(gh.trackId).name}.`, code));
        return true;
      }
      case 'ghostImport':
        g.audio.click('select');
        this.promptText("FRIEND'S GHOST CODE", 'Paste a code that starts with RPT1.', (code) => {
          void decodeGhost(code).then((gh) => {
            if (!gh) {
              this.toast('That code is not a valid ghost', 'GHOST');
              return;
            }
            d.ghosts[gh.trackId] = gh;
            g.save.save(true);
            this.toast(`${gh.name} · ${trackDef(gh.trackId).name} · ${formatTime(gh.time)}`, 'GHOST IMPORTED');
            this.setup.trackId = gh.trackId;
            this.refreshSetup();
          });
        });
        return true;
      case 'gstripe':
        g.audio.click('move');
        commit({ ...liv(), stripe: arg as Livery['stripe'] });
        return true;
      case 'gdecal':
        g.audio.click('move');
        commit({ ...liv(), decal: arg as Livery['decal'] });
        return true;
    }
    return false;
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  private settingsTab = 'audio';
  settingsReturn = 'menu';

  settings(ret = 'menu', tab = this.settingsTab) {
    this.settingsReturn = ret;
    this.settingsTab = tab;
    const g = this.game;
    this.mount(
      'settings',
      `<h1 class="h">SETTINGS</h1><div class="sub">Saved automatically</div>
      <div class="tabs">${['audio', 'video', 'gameplay', 'controls', 'data'].map((t) => `<button class="opt ${tab === t ? 'on' : ''}" data-nav data-act="stab" data-arg="${t}">${t.toUpperCase()}</button>`).join('')}</div>
      <div class="scroll panel" style="max-width:760px;flex:1" id="sBody"></div>
      <div class="footer"><button class="btn" data-nav data-act="back"><span>BACK</span></button></div>`,
      () => {
        if (this.settingsReturn === 'pause') this.pause();
        else g.enterMenu();
      },
      ret === 'pause' ? 'screen full' : 'screen dim',
    );
    this.refreshSettings();
  }

  private slider(key: keyof Settings, label: string, min: number, max: number, step: number, fmt: (v: number) => string) {
    const v = this.game.save.data.settings[key] as number;
    return `<div class="setting" data-nav><span class="nm">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-set="${key}"><span class="val">${fmt(v)}</span></div>`;
  }
  private choice(key: keyof Settings, label: string, opts: [string | number | boolean, string][]) {
    const v = this.game.save.data.settings[key];
    return `<div class="setting"><span class="nm">${label}</span><div class="opts">${opts.map(([o, l]) => `<button class="opt ${v === o ? 'on' : ''}" data-nav data-act="sset" data-arg='${key}:${JSON.stringify(o)}'>${l}</button>`).join('')}</div><span></span></div>`;
  }

  private refreshSettings() {
    const body = this.root?.querySelector('#sBody') as HTMLElement | null;
    if (!body) return;
    const g = this.game;
    const s = g.save.data.settings;
    const pct = (v: number) => Math.round(v * 100) + '%';
    let html = '';
    switch (this.settingsTab) {
      case 'audio':
        html = this.slider('master', 'MASTER VOLUME', 0, 1, 0.05, pct) + this.slider('music', 'MUSIC VOLUME', 0, 1, 0.05, pct) + this.slider('sfx', 'EFFECTS VOLUME', 0, 1, 0.05, pct);
        break;
      case 'video':
        html =
          this.choice('quality', 'GRAPHICS QUALITY', [
            ['low', 'LOW'],
            ['medium', 'MEDIUM'],
            ['high', 'HIGH'],
          ]) +
          this.slider('pixelRatio', 'MAX PIXEL RATIO', 0.5, 2, 0.25, (v) => v.toFixed(2) + '×') +
          this.choice('autoRes', 'ADAPTIVE RESOLUTION', [
            [true, 'ON'],
            [false, 'OFF'],
          ]) +
          this.slider('shake', 'CAMERA SHAKE', 0, 1, 0.1, pct) +
          this.slider('motion', 'MOTION EFFECTS', 0, 1, 0.1, pct) +
          this.choice('assist', 'COLOUR ASSIST', [
            [0, 'OFF'],
            [1, 'PROTAN'],
            [2, 'DEUTAN'],
            [3, 'TRITAN'],
          ]) +
          this.slider('hudScale', 'HUD SCALE', 0.75, 1.3, 0.05, pct) +
          this.choice('symbols', 'COLOUR-BLIND SYMBOLS', [
            [false, 'OFF'],
            [true, 'ON'],
          ]) +
          this.choice('shadows', 'BOAT SHADOWS', [
            [true, 'ON'],
            [false, 'OFF'],
          ]) +
          this.choice('wildlife', 'WILDLIFE & TRAFFIC', [
            [true, 'ON'],
            [false, 'OFF'],
          ]);
        break;
      case 'gameplay':
        html =
          this.choice('difficulty', 'DEFAULT DIFFICULTY', [
            ['easy', 'EASY'],
            ['normal', 'NORMAL'],
            ['hard', 'HARD'],
          ]) +
          this.slider('laps', 'DEFAULT LAPS', 1, 5, 1, (v) => String(v)) +
          this.choice('items', 'ITEM BOXES & POWER-UPS IN RACES', [
            [true, 'ON'],
            [false, 'OFF'],
          ]) +
          this.choice('racingLine', 'RACING LINE ASSIST', [
            [false, 'OFF'],
            [true, 'ON'],
          ]) +
          this.choice('units', 'SPEED UNITS', [
            ['kmh', 'KM/H'],
            ['mph', 'MPH'],
          ]) +
          this.slider('sensitivity', 'STEERING SENSITIVITY', 0.5, 1.6, 0.05, (v) => v.toFixed(2)) +
          this.choice('dynamicWeather', 'CHANGING WEATHER IN RACES', [
            [false, 'OFF'],
            [true, 'ON'],
          ]) +
          this.choice('lang', t('language'), LANGS.map((l) => [l, LANG_NAME[l]] as [string, string]));
        break;
      case 'controls':
        html =
          this.choice('touch', 'TOUCH CONTROLS', [
            ['auto', 'AUTO'],
            ['on', 'ALWAYS'],
            ['off', 'NEVER'],
          ]) +
          this.choice('tilt', 'TILT TO STEER (TOUCH)', [
            [false, 'OFF'],
            [true, 'ON'],
          ]) +
          ACTIONS.map((a) => `<div class="setting"><span class="nm">${ACTION_LABEL[a].toUpperCase()}</span><div class="opts">${s.bindings[a].map((k) => `<span class="opt on">${keyLabel(k)}</span>`).join('')}<button class="opt" data-nav data-act="sbind" data-arg="${a}">+ REBIND</button></div><span></span></div>`).join('') +
          `<div class="row" style="margin-top:12px"><button class="btn small" data-nav data-act="sbindreset"><span>RESET TO DEFAULTS</span></button></div>
          <div class="hint" style="margin-top:12px">Gamepad: Left stick steer · RT throttle · LT brake · A/RB drift · X nitro · LB barrel roll · Y camera · Start pause</div>`;
        break;
      case 'data':
        html = `<div class="setting"><span class="nm">PLAYER NAME</span><input type="text" maxlength="12" value="${esc(g.save.data.playerName)}" data-name style="font-family:var(--font);font-size:16px;padding:6px 10px;background:#0a1230;color:#fff;border:1px solid var(--line)"><span></span></div>
        <div class="row" style="margin-top:14px"><button class="btn small" data-nav data-act="sreset"><span>RESET PROGRESS</span></button></div>
        <div class="hint" style="margin-top:10px">Resets level, credits, boats, records, ghosts and customisation. Settings are kept.</div>`;
        break;
    }
    body.innerHTML = html;
    body.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.set as keyof Settings;
        const v = Number(inp.value);
        (g.save.data.settings as unknown as Record<string, unknown>)[key] = v;
        const val = inp.parentElement!.querySelector('.val')!;
        val.textContent = key === 'pixelRatio' ? v.toFixed(2) + '×' : key === 'laps' ? String(v) : key === 'sensitivity' ? v.toFixed(2) : Math.round(v * 100) + '%';
        g.applySettings();
        g.save.save();
      });
    });
    const name = body.querySelector<HTMLInputElement>('input[data-name]');
    name?.addEventListener('change', () => {
      g.save.data.playerName = (name.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 12) || 'YOU').trim() || 'YOU';
      g.save.save();
    });
    const first = body.querySelector('[data-nav]') as HTMLElement | null;
    if (first && !this.root!.querySelector('.focus')) g.nav.focus(first, false);
  }

  private handleSettings(act: string, arg: string, el: HTMLElement): boolean {
    const g = this.game;
    const s = g.save.data.settings;
    switch (act) {
      case 'stab':
        g.audio.click('move');
        this.settings(this.settingsReturn, arg);
        return true;
      case 'sset': {
        const i = arg.indexOf(':');
        const key = arg.slice(0, i) as keyof Settings;
        (s as unknown as Record<string, unknown>)[key] = JSON.parse(arg.slice(i + 1));
        g.audio.click('move');
        // Persist first: applying (e.g. a quality change) may rebuild the scene.
        g.save.save(true);
        g.applySettings();
        this.refreshSettings();
        const again = this.root?.querySelector(`[data-act="sset"][data-arg='${arg}']`) as HTMLElement | null;
        if (again) g.nav.focus(again, false);
        return true;
      }
      case 'sbind':
        g.audio.click('select');
        el.textContent = 'PRESS A KEY…';
        g.input.captureNext = (code) => {
          const a = arg as Action;
          if (code !== 'Escape') {
            // A key can only drive one action: remove it elsewhere.
            for (const other of ACTIONS) s.bindings[other] = s.bindings[other].filter((k) => k !== code);
            s.bindings[a] = [code, ...s.bindings[a].filter((k) => k !== code)].slice(0, 3);
            for (const other of ACTIONS) if (!s.bindings[other].length) s.bindings[other] = [...DEFAULT_BINDINGS[other]];
            g.applySettings();
            g.save.save();
          }
          this.refreshSettings();
        };
        return true;
      case 'sbindreset':
        g.audio.click('select');
        s.bindings = structuredClone(DEFAULT_BINDINGS);
        g.applySettings();
        g.save.save();
        this.refreshSettings();
        return true;
      case 'sreset':
        this.confirm('Really reset ALL progress? This cannot be undone.', () => {
          g.save.reset();
          this.toast('Progress reset', 'DATA');
          g.enterMenu();
        });
        return true;
    }
    return false;
  }

  // ── Pause / results ─────────────────────────────────────────────────────
  pause() {
    this.mount(
      'pause',
      `<div class="center-col"><h1 class="h" style="transform:none">${t('paused')}</h1>
      <div class="menu">
        <button class="btn big primary" data-nav data-act="resume" data-default><span>${t('resume')}</span><span class="k">ESC</span></button>
        ${this.game.session?.mode === 'championship' || this.game.session?.mode === 'tutorial' ? '' : `<button class="btn" data-nav data-act="restart"><span>${t('restart')}</span><span class="k">R</span></button>`}
        ${this.game.split ? '' : `<button class="btn" data-nav data-act="photo"><span>${t('photo')}</span><span class="k">F</span></button>`}
        <button class="btn" data-nav data-act="camera"><span>${t('changeCamera')}</span><span class="k">C</span></button>
        <button class="btn" data-nav data-act="settings" data-arg="pause"><span>${t('settings')}</span></button>
        <button class="btn" data-nav data-act="quit"><span>${t('quit')}</span></button>
      </div></div>`,
      () => this.game.resumeRace(),
      'screen full',
    );
  }

  results(sum: RewardSummary, again = false) {
    const g = this.game;
    const s = g.session!;
    const p = s.player;
    let head = '';
    let table = '';
    if (s.isRace) {
      head = `<div class="bigplace">${ordinal(p.place)}</div><div class="sub">${trackDef(s.cfg.trackId).name} · ${s.cfg.difficulty.toUpperCase()}</div>`;
      table = `<table class="res">${s.results
        .map((r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td class="p">${r.place}</td><td>${esc(r.name)}</td><td class="hint">${r.boat}</td><td class="t">${r.finished ? formatTime(r.time) : '~' + formatTime(r.time)}</td><td class="t hint">${isFinite(r.bestLap) ? formatTime(r.bestLap) : '—'}</td></tr>`)
        .join('')}</table>`;
    } else if (s.mode === 'timetrial') {
      head = `<div class="bigplace" style="font-size:clamp(50px,8vw,110px)">${isFinite(p.bestLap) ? formatTime(p.bestLap) : '—'}</div><div class="sub">BEST LAP · ${trackDef(s.cfg.trackId).name}${s.newGhost ? ' · NEW GHOST SAVED' : ''}</div>`;
      table = `<table class="res">${p.lapTimes.map((t, i) => `<tr class="${t === p.bestLap ? 'me' : ''}"><td class="p">L${i + 1}</td><td class="t">${formatTime(t)}</td></tr>`).join('')}</table>`;
    } else if (s.mode === 'stunt') {
      head = `<div class="bigplace">${s.stuntScore.toLocaleString()}</div><div class="sub">STUNT SCORE · ${p.tricks} TRICKS · ${s.ringsTaken} RINGS</div>`;
    } else if (s.mode === 'endless') {
      head = `<div class="bigplace">${Math.round(s.endlessDistance).toLocaleString()} m</div><div class="sub">SURVIVED ${formatTime(s.raceTime, false)} · REACHED LEVEL ${s.endlessLevel}</div>`;
    } else if (s.mode === 'tutorial') {
      head = `<div class="bigplace" style="font-size:clamp(50px,8vw,100px)">WELL DONE!</div><div class="sub">TUTORIAL COMPLETE · YOU'RE READY TO RACE</div>`;
    } else {
      head = `<div class="bigplace" style="font-size:clamp(50px,8vw,100px)">FREE RIDE</div><div class="sub">TOP ${Math.round(p.topSpeed * 3.6)} KM/H · BEST AIR ${p.bestAir.toFixed(1)}s · ${p.tricks} TRICKS</div>`;
    }
    const medalCol = ['var(--dim)', 'var(--bronze)', 'var(--silver)', 'var(--gold)'][sum.medal];
    const champ = s.mode === 'championship';
    this.mount(
      'results',
      `${head}
      <div class="grid2" style="margin-top:10px"><div class="scroll panel">${table || sum.breakdown.map(([l, v]) => `<div class="row"><span class="hint">${l}</span><span class="spacer"></span><b>+${v} XP</b></div>`).join('')}</div>
      <div>
        <div class="reward">
          <div><span class="n" style="color:${medalCol}">${sum.medalLabel}</span><span class="l">MEDAL</span></div>
          <div><span class="n">+${sum.xp}</span><span class="l">XP</span></div>
          <div><span class="n cr">+${sum.credits}</span><span class="l">CREDITS</span></div>
        </div>
        <div class="label">LEVEL <span id="lvlNum">${sum.levelBefore}</span></div>
        <div class="xpbar" style="height:12px;max-width:420px"><div id="xpFill" style="width:${(sum.xpIntoBefore * 100).toFixed(1)}%"></div></div>
        ${sum.career ? `<div class="msg small ${sum.career.beatBoss ? 'lime' : 'warn'}" style="font-size:20px;animation:none;transform:none">${sum.career.beatBoss ? `YOU BEAT ${esc(sum.career.bossName)}!${sum.career.final ? ' CAREER COMPLETE!' : ''}` : `${esc(sum.career.bossName)} GOT AWAY — TRY AGAIN`}</div>` : ''}
        ${sum.challenge ? `<div class="msg small ${sum.challenge.done ? 'lime' : ''}" style="font-size:16px;animation:none;transform:none;white-space:normal">${sum.challenge.done ? '✓ CHALLENGE COMPLETE · +' + sum.challenge.credits.toLocaleString() + ' CR' : '✗ CHALLENGE NOT MET'}</div><div class="hint">${esc(sum.challenge.text)}</div>` : ''}
        ${sum.bottlesFound ? `<div class="msg small cyan" style="font-size:16px;animation:none;transform:none">FOUND ${sum.bottlesFound} MESSAGE BOTTLE${sum.bottlesFound > 1 ? 'S' : ''}</div>` : ''}
        ${sum.records.map((r) => `<div class="msg small gold" style="font-size:18px;animation:none;transform:none">${r}</div>`).join('')}
        ${table ? `<div style="margin-top:10px">${sum.breakdown.map(([l, v]) => `<div class="row hint"><span>${l}</span><span class="spacer"></span><b>+${v}</b></div>`).join('')}</div>` : ''}
      </div></div>
      <div class="footer">
        ${champ ? '' : `<button class="btn" data-nav data-act="restart"><span>${t('raceAgain')}</span><span class="k">R</span></button>`}
        ${g.replayAvailable ? `<button class="btn" data-nav data-act="replay"><span>${t('watchReplay')}</span></button>` : ''}
        <span class="spacer"></span>
        <button class="btn big primary" data-nav data-act="continue" data-default><span>CONTINUE</span><span class="k">ENTER</span></button>
      </div>`,
      () => this.game.afterResults(),
      'screen full',
    );
    // Animate the XP bar across level-ups.
    const fill = this.root!.querySelector('#xpFill') as HTMLElement;
    const num = this.root!.querySelector('#lvlNum') as HTMLElement;
    let lvl = sum.levelBefore;
    const step = () => {
      if (!fill.isConnected) return;
      if (lvl < sum.levelAfter) {
        fill.style.width = '100%';
        setTimeout(() => {
          lvl++;
          num.textContent = String(lvl);
          fill.style.transition = 'none';
          fill.style.width = '0%';
          void fill.offsetWidth;
          fill.style.transition = '';
          g.audio.unlockSting();
          step();
        }, 900);
      } else fill.style.width = (sum.xpIntoAfter * 100).toFixed(1) + '%';
    };
    if (again) {
      fill.style.transition = 'none';
      num.textContent = String(sum.levelAfter);
      fill.style.width = (sum.xpIntoAfter * 100).toFixed(1) + '%';
      return;
    }
    setTimeout(step, 400);
    sum.unlocks.forEach((u, i) => setTimeout(() => this.toast(u.split(': ').pop()!, u.includes(':') ? u.split(':')[0] : 'UNLOCKED'), 1200 + i * 700));
    if (sum.levelAfter > sum.levelBefore) setTimeout(() => this.toast(`LEVEL ${sum.levelAfter}`, 'LEVEL UP'), 900);
    sum.achievements.forEach((n, i) => setTimeout(() => this.toast(n, 'ACHIEVEMENT'), 1500 + (sum.unlocks.length + i) * 700));
  }

  confirm(text: string, yes: () => void) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="panel"><div style="font-family:var(--font);font-size:18px;margin-bottom:16px">${esc(text)}</div><div class="row" style="justify-content:center"><button class="btn small" data-nav data-x="no"><span>CANCEL</span></button><button class="btn small primary" data-nav data-x="yes"><span>CONFIRM</span></button></div></div>`;
    this.host.appendChild(m);
    const prevRoot = this.root;
    const prevBack = this.game.nav.onBack;
    const close = () => {
      m.remove();
      if (prevRoot?.isConnected) this.game.nav.attach(prevRoot, prevBack);
      else this.game.nav.detach();
    };
    this.game.nav.attach(m, close, m.querySelector('[data-x="no"]') as HTMLElement);
    m.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-x]') as HTMLElement | null;
      if (!t) return;
      close();
      if (t.dataset.x === 'yes') {
        this.game.audio.click('select');
        yes();
      } else this.game.audio.click('back');
    });
  }

  /** Read-only text box (copyable). */
  showText(title: string, sub: string, text: string) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="panel" style="max-width:620px"><div style="font-family:var(--font);font-size:18px">${esc(title)}</div><div class="hint" style="margin:6px 0 10px">${esc(sub)}</div>
      <textarea readonly class="codebox">${esc(text)}</textarea>
      <div class="row" style="justify-content:center;margin-top:10px"><button class="btn small" data-nav data-x="copy"><span>COPY</span></button><button class="btn small primary" data-nav data-x="close"><span>CLOSE</span></button></div></div>`;
    this.host.appendChild(m);
    const ta = m.querySelector('textarea')!;
    ta.select();
    const prevRoot = this.root;
    const prevBack = this.game.nav.onBack;
    const close = () => {
      m.remove();
      if (prevRoot?.isConnected) this.game.nav.attach(prevRoot, prevBack);
      else this.game.nav.detach();
    };
    this.game.nav.attach(m, close, m.querySelector('[data-x="copy"]') as HTMLElement);
    m.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-x]') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.x === 'copy') {
        ta.select();
        navigator.clipboard?.writeText(text).then(
          () => this.toast('Copied to clipboard', 'GHOST'),
          () => document.execCommand?.('copy'),
        );
      } else close();
    });
  }

  /** Multi-line text input modal. */
  promptText(title: string, sub: string, ok: (text: string) => void) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="panel" style="max-width:620px"><div style="font-family:var(--font);font-size:18px">${esc(title)}</div><div class="hint" style="margin:6px 0 10px">${esc(sub)}</div>
      <textarea class="codebox" spellcheck="false"></textarea>
      <div class="row" style="justify-content:center;margin-top:10px"><button class="btn small" data-nav data-x="no"><span>CANCEL</span></button><button class="btn small primary" data-nav data-x="yes"><span>IMPORT</span></button></div></div>`;
    this.host.appendChild(m);
    const ta = m.querySelector('textarea')!;
    setTimeout(() => ta.focus(), 50);
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    const prevRoot = this.root;
    const prevBack = this.game.nav.onBack;
    const close = () => {
      m.remove();
      if (prevRoot?.isConnected) this.game.nav.attach(prevRoot, prevBack);
      else this.game.nav.detach();
    };
    this.game.nav.attach(m, close, m.querySelector('[data-x="yes"]') as HTMLElement);
    m.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-x]') as HTMLElement | null;
      if (!b) return;
      close();
      if (b.dataset.x === 'yes') ok(ta.value);
    });
  }

  loading(text = 'LOADING') {
    this.mount('loading', `<div class="center-col"><div class="title-logo" style="font-size:48px">${text}</div><div class="boot-bar" style="margin-top:20px"><div style="width:100%;animation:shine 1s linear infinite;background-size:200% 100%"></div></div></div>`, null, 'screen full');
  }
}
