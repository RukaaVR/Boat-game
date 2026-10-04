/**
 * Garage PARTS tab and the rider creator's gear sections (BUILD, HEADWEAR,
 * OUTFIT, ACCESSORY): HTML builders plus the pure state changes behind their
 * buttons. Kept apart from screens.ts, which only mounts these and routes the
 * `data-act` events here.
 */

import { ACCESSORIES, BUILDS, gearUnlocked, HEADWEAR, OUTFITS, unlockText, type GearItem, type UnlockView } from '../boat/riderGear';
import { sanitizeLook, type RiderLook } from '../boat/riderLook';
import { buildSpec, ownsPart, partDef, PARTS, partKey, partsSpec, PART_SLOTS, SLOT_NAME, type FittedParts, type PartSlot } from '../boat/parts';
import { boatSpec, boatStatsRaw, type BoatId } from '../boat/specs';
import { upgradedSpec } from '../save/progress';
import type { SaveStore } from '../save/save';

type Raw = ReturnType<typeof boatStatsRaw>;

/** The boat as the player will race it: upgrades → parts → rider build. */
export function tunedStats(save: SaveStore, id: BoatId, parts?: FittedParts, look: RiderLook = save.data.rider) {
  const spec = buildSpec(partsSpec(upgradedSpec(boatSpec(id), save.upgrades(id)), parts ?? save.parts(id)), look.build);
  return { spec, raw: boatStatsRaw(spec) };
}

const pct = (v: number) => Math.max(0, Math.min(100, v * 10));

/**
 * Stat bars with trade-offs: the shared part in gold, gains in green, losses
 * as a red notch where the bar used to reach, plus a +/- figure.
 */
export function deltaCard(name: string, sub: string, now: Raw, base: Raw, foot: string) {
  const rows = (Object.keys(now) as (keyof Raw)[])
    .map((k) => {
      const v = now[k];
      const b = base[k];
      const lo = Math.min(v, b);
      const d = v - b;
      const tag = Math.abs(d) >= 0.05 ? `<em class="gd ${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}</em>` : '';
      return `<span class="g-k">${k.toUpperCase()}${tag}</span><div class="g-bar"><div class="g-fill" style="width:${pct(lo)}%"></div>${
        d > 0.02 ? `<div class="g-up" style="left:${pct(lo)}%;width:${pct(d)}%"></div>` : d < -0.02 ? `<div class="g-dn" style="left:${pct(lo)}%;width:${pct(-d)}%"></div>` : ''
      }<i></i></div>`;
    })
    .join('');
  return `<div class="g-name">${name}</div><div class="g-sub">${sub}</div><div class="g-bars">${rows}</div>${foot ? `<div class="g-foot">${foot}</div>` : ''}`;
}

export function unlockView(save: SaveStore): UnlockView {
  return { level: save.level, cups: save.data.cups, achievements: save.data.achievements };
}

// ── Rider creator: gear ─────────────────────────────────────────────────────
type GearField = 'build' | 'headwear' | 'outfit' | 'accessory';
const GEAR: Record<GearField, GearItem<string>[]> = { build: BUILDS, headwear: HEADWEAR, outfit: OUTFITS, accessory: ACCESSORIES };

export function riderGearHtml(save: SaveStore) {
  const lk = save.data.rider;
  const v = unlockView(save);
  const opts = (field: GearField) =>
    `<div class="opts gear-opts">${GEAR[field]
      .map((o) => {
        const open = gearUnlocked(o.unlock, v);
        return `<button class="opt ${lk[field] === o.id ? 'on' : ''} ${open ? '' : 'lk'}" data-nav data-act="rgear" data-arg="${field}:${o.id}" title="${open ? o.blurb : unlockText(o.unlock)}">${o.name}${open ? '' : `<small class="gear-rule">🔒 ${unlockText(o.unlock)}</small>`}</button>`;
      })
      .join('')}</div>`;
  const blurb = (field: GearField) => {
    const it = GEAR[field].find((o) => o.id === lk[field]);
    return it?.blurb ? `<div class="hint gear-blurb">${it.blurb}</div>` : '';
  };
  // What the build does to the boat you have selected (vs a medium rider).
  const id = save.data.selectedBoat;
  const now = tunedStats(save, id).raw;
  const base = tunedStats(save, id, undefined, { ...lk, build: 'medium' }).raw;
  const card = `<div class="g-stats gear-card">${deltaCard(boatSpec(id).name, lk.build === 'medium' ? 'MEDIUM BUILD · AS DESIGNED' : `${lk.build.toUpperCase()} BUILD vs MEDIUM`, now, base, '')}</div>`;
  return `<div class="label">BUILD <span class="r-val">${lk.build.toUpperCase()}</span></div>${opts('build')}${blurb('build')}${card}
    <div class="label">HEADWEAR</div>${opts('headwear')}
    <div class="label">OUTFIT</div>${opts('outfit')}${blurb('outfit')}
    <div class="label">ACCESSORY</div>${opts('accessory')}`;
}

/** Apply a gear choice. Returns an error message for a locked item, else null. */
export function setRiderGear(save: SaveStore, arg: string): string | null {
  const [field, id] = arg.split(':') as [GearField, string];
  const list = GEAR[field];
  const it = list?.find((o) => o.id === id);
  if (!it) return 'Unknown item';
  if (!gearUnlocked(it.unlock, unlockView(save))) return `${it.name}: ${unlockText(it.unlock)}`;
  save.data.rider = sanitizeLook({ ...save.data.rider, [field]: id });
  return null;
}

/** A random look among the unlocked gear (keeps the build — that is a handling choice). */
export function randomGear(save: SaveStore): Pick<RiderLook, 'headwear' | 'outfit' | 'accessory'> {
  const v = unlockView(save);
  const r = <T extends string>(list: GearItem<T>[]) => {
    const open = list.filter((o) => gearUnlocked(o.unlock, v));
    return open[Math.floor(Math.random() * open.length)].id;
  };
  return { headwear: r(HEADWEAR), outfit: r(OUTFITS), accessory: r(ACCESSORIES) };
}

// ── Garage: PARTS tab ───────────────────────────────────────────────────────
export interface PartsPreview {
  slot: PartSlot;
  id: string;
}

/** Fitted parts with a try-on applied. */
export function withPreview(fit: FittedParts, p: PartsPreview | null): FittedParts {
  return p ? { ...fit, [p.slot]: p.id } : fit;
}

export function partsTab(save: SaveStore, id: BoatId, preview: PartsPreview | null) {
  const d = save.data;
  const owned = d.owned.includes(id);
  const st = d.boatParts[id];
  const fit = save.parts(id);
  const lvl = save.level;
  let html = `<div class="hint" style="margin-bottom:8px">Parts belong to each boat and show on it. Tap a part to try it on and compare. ${owned ? '' : '<b style="color:var(--yellow)">Buy this boat first.</b>'}</div>`;
  for (const slot of PART_SLOTS) {
    html += `<div class="label">${SLOT_NAME[slot]}</div><div class="parts-list">`;
    for (const p of PARTS.filter((x) => x.slot === slot)) {
      const have = ownsPart(st, slot, p.id);
      const on = fit[slot] === p.id;
      const trying = preview?.slot === slot && preview.id === p.id;
      const state = on ? '✓ FITTED' : have ? 'OWNED' : lvl < p.level ? `🔒 LEVEL ${p.level}` : `${p.price.toLocaleString()} CR`;
      html += `<button class="btn part-btn ${trying ? 'focus-sel' : ''} ${on ? 'fitted' : ''}" data-nav data-act="gpart" data-arg="${slot}:${p.id}"><span>${p.name}</span><span class="k">${state}</span></button>`;
    }
    html += `</div>`;
  }
  // Selected part: what it does and the action.
  const sel = preview ?? null;
  if (sel) {
    const p = partDef(sel.slot, sel.id);
    const have = ownsPart(st, sel.slot, sel.id);
    const on = fit[sel.slot] === sel.id;
    let btn: string;
    if (on) btn = `<span class="lock" style="color:var(--green,#7dff3a)">FITTED</span>`;
    else if (!owned) btn = `<span class="lock">BUY THE BOAT FIRST</span>`;
    else if (have) btn = `<button class="btn small primary" data-nav data-act="gpartfit" data-arg="${sel.slot}:${sel.id}"><span>FIT</span></button>`;
    else if (lvl < p.level) btn = `<span class="lock">🔒 REACH LEVEL ${p.level}</span>`;
    else btn = `<button class="btn small primary ${d.credits < p.price ? 'disabled' : ''}" data-nav data-act="gpartbuy" data-arg="${sel.slot}:${sel.id}"><span>BUY &amp; FIT ${p.price.toLocaleString()} CR</span></button>`;
    html += `<div class="panel part-info"><b class="part-name">${p.name}</b><div class="hint">${p.blurb}</div><div class="row" style="margin-top:6px">${btn}</div></div>`;
  }
  const now = tunedStats(save, id, withPreview(fit, sel)).raw;
  const base = tunedStats(save, id).raw;
  const spec = tunedStats(save, id, withPreview(fit, sel)).spec;
  const side = deltaCard(
    boatSpec(id).name,
    sel && fit[sel.slot] !== sel.id ? `TRYING ${partDef(sel.slot, sel.id).name} vs FITTED` : `FITTED PARTS · ${d.rider.build.toUpperCase()} RIDER`,
    now,
    base,
    `TOP ${Math.round(spec.topSpeed * 3.6)} KM/H · ${PART_SLOTS.map((s) => partDef(s, withPreview(fit, sel)[s]).name).join(' · ')}`,
  );
  return { html, side };
}

/** Buy (if needed) and fit a part. Returns a toast message, or an error string prefixed with '!'. */
export function buyOrFitPart(save: SaveStore, id: BoatId, arg: string, buy: boolean): string {
  const [slot, pid] = arg.split(':') as [PartSlot, string];
  if (!PART_SLOTS.includes(slot)) return '!Unknown part';
  const p = partDef(slot, pid);
  if (p.id !== pid) return '!Unknown part';
  const d = save.data;
  if (!d.owned.includes(id)) return '!Buy this boat first';
  const st = d.boatParts[id] ?? { fitted: save.parts(id), owned: [] };
  if (!ownsPart(st, slot, pid)) {
    if (!buy) return '!Not owned';
    if (save.level < p.level) return `!Reach level ${p.level}`;
    if (d.credits < p.price) return '!Not enough credits';
    d.credits -= p.price;
    st.owned = [...st.owned, partKey(slot, pid)];
  }
  st.fitted = { ...st.fitted, [slot]: pid };
  d.boatParts[id] = st;
  return p.name;
}
