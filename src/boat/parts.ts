/**
 * Bolt-on boat parts: a HULL KIT, an ENGINE and FINS per boat, each a small
 * set of stat trade-offs plus a procedural mesh (partsMesh.ts). Parts are
 * bought per boat with credits once the level allows, fitted in the garage,
 * and applied to a copy of the player's spec at race start (AI ride stock).
 *
 * `tunedSpec` is the single place that combines upgrades, parts and the
 * rider's weight class, so the garage bars and the race can never disagree.
 */

import type { BoatId, BoatSpec } from './specs';
import { BOATS } from './specs';
import { BUILD_TUNING, type Build } from './riderGear';

export type PartSlot = 'hull' | 'engine' | 'fins';
export const PART_SLOTS: PartSlot[] = ['hull', 'engine', 'fins'];
export const SLOT_NAME: Record<PartSlot, string> = { hull: 'HULL KIT', engine: 'ENGINE', fins: 'FINS' };

export type HullKit = 'stock' | 'rails' | 'step' | 'bumper';
export type EngineKit = 'stock' | 'twin' | 'cowl' | 'core';
export type FinKit = 'stock' | 'shark' | 'winglets' | 'rudders';
export interface FittedParts {
  hull: HullKit;
  engine: EngineKit;
  fins: FinKit;
}
export const STOCK_PARTS: FittedParts = { hull: 'stock', engine: 'stock', fins: 'stock' };

/** Multipliers (×) and offsets (+) on the physics spec. */
interface PartFx {
  topSpeed?: number;
  thrust?: number;
  turnRate?: number;
  yawResponse?: number;
  grip?: number;
  driftYaw?: number;
  driftCharge?: number;
  boostPower?: number;
  mass?: number;
  /** Additive. */
  stability?: number;
  air?: number;
}

export interface PartDef {
  slot: PartSlot;
  id: string;
  name: string;
  blurb: string;
  price: number;
  level: number;
  fx: PartFx;
}

export const PARTS: PartDef[] = [
  { slot: 'hull', id: 'stock', name: 'FACTORY HULL', blurb: 'As it left the yard.', price: 0, level: 1, fx: {} },
  { slot: 'hull', id: 'rails', name: 'RAZOR RAILS', blurb: 'Spray rails along the chines bite into turns. A little extra drag.', price: 600, level: 2, fx: { turnRate: 1.04, grip: 1.05, stability: 0.04, topSpeed: 0.99 } },
  { slot: 'hull', id: 'step', name: 'SKIMMER STEP', blurb: 'A stepped planing pad and bow splitter: rides higher, flies further, skates in swell.', price: 900, level: 4, fx: { topSpeed: 1.022, air: 0.08, stability: -0.07, grip: 0.97 } },
  { slot: 'hull', id: 'bumper', name: 'BRAWLER BUMPERS', blurb: 'Rubber fenders and a bow guard: heavier, planted, wins every shove.', price: 800, level: 5, fx: { mass: 1.22, stability: 0.08, thrust: 0.97, turnRate: 0.97 } },
  { slot: 'engine', id: 'stock', name: 'FACTORY JET', blurb: 'Reliable single jet.', price: 0, level: 1, fx: {} },
  { slot: 'engine', id: 'twin', name: 'TWIN-JET PODS', blurb: 'Two side pods for a punchy launch. Runs out of breath at the top.', price: 800, level: 2, fx: { thrust: 1.045, topSpeed: 0.985 } },
  { slot: 'engine', id: 'cowl', name: 'HYPERCOWL', blurb: 'Supercharged cowl with a ram scoop: big top end and boost, lazy off the line.', price: 1400, level: 5, fx: { topSpeed: 1.028, boostPower: 1.05, thrust: 0.965, turnRate: 0.985 } },
  { slot: 'engine', id: 'core', name: 'TIDECORE', blurb: 'Hybrid pod with glowing coils: drift sparks charge fast.', price: 1200, level: 7, fx: { driftCharge: 1.12, thrust: 1.015, topSpeed: 0.988 } },
  { slot: 'fins', id: 'stock', name: 'FACTORY FINS', blurb: 'Standard trim.', price: 0, level: 1, fx: {} },
  { slot: 'fins', id: 'shark', name: 'SHARK FINS', blurb: 'Swept twin dorsals: the tail swings out eagerly.', price: 400, level: 1, fx: { driftYaw: 1.06, driftCharge: 1.05, yawResponse: 1.05, stability: -0.04, air: -0.04 } },
  { slot: 'fins', id: 'winglets', name: 'SKY WINGLETS', blurb: 'Stub wings that hang the boat in the air. Slightly draggy.', price: 700, level: 3, fx: { air: 0.15, stability: 0.02, topSpeed: 0.99 } },
  { slot: 'fins', id: 'rudders', name: 'TWIN RUDDERS', blurb: 'Deep transom rudders: crisp turn-in, stiffer drifts.', price: 900, level: 6, fx: { turnRate: 1.05, yawResponse: 1.08, driftYaw: 0.95, driftCharge: 0.95 } },
];

export function partDef(slot: PartSlot, id: string): PartDef {
  return PARTS.find((p) => p.slot === slot && p.id === id) ?? PARTS.find((p) => p.slot === slot)!;
}

/** Per-boat parts state in the save. */
export interface BoatPartsState {
  fitted: FittedParts;
  /** Bought parts as `slot:id` keys (stock parts are always owned). */
  owned: string[];
}

export const partKey = (slot: PartSlot, id: string) => `${slot}:${id}`;
export function ownsPart(st: BoatPartsState | undefined, slot: PartSlot, id: string) {
  return id === 'stock' || !!st?.owned.includes(partKey(slot, id));
}

export function sanitizeFitted(v: unknown): FittedParts {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const pick = (slot: PartSlot) => (PARTS.some((p) => p.slot === slot && p.id === o[slot]) ? (o[slot] as string) : 'stock');
  return { hull: pick('hull') as HullKit, engine: pick('engine') as EngineKit, fins: pick('fins') as FinKit };
}

/** Validate the save's per-boat parts map; anything unknown is dropped. */
export function sanitizeBoatParts(v: unknown): Partial<Record<BoatId, BoatPartsState>> {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out: Partial<Record<BoatId, BoatPartsState>> = {};
  for (const b of BOATS) {
    const e = o[b.id];
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const owned = Array.isArray(r.owned) ? [...new Set(r.owned.filter((k) => typeof k === 'string' && PARTS.some((p) => p.id !== 'stock' && partKey(p.slot, p.id) === k)) as string[])] : [];
    const fitted = sanitizeFitted(r.fitted);
    // Only parts you own can be fitted.
    for (const s of PART_SLOTS) if (!ownsPart({ fitted, owned }, s, fitted[s])) (fitted as unknown as Record<string, string>)[s] = 'stock';
    out[b.id] = { fitted, owned };
  }
  return out;
}

/** A copy of the spec with fitted parts applied (never mutates `spec`). */
export function partsSpec(spec: BoatSpec, fit: FittedParts | null | undefined): BoatSpec {
  if (!fit) return spec;
  const s = { ...spec };
  for (const slot of PART_SLOTS) {
    const fx = partDef(slot, fit[slot]).fx;
    if (fx.topSpeed) {
      s.topSpeed *= fx.topSpeed;
      s.boostTopSpeed *= fx.topSpeed;
    }
    if (fx.thrust) s.thrust *= fx.thrust;
    if (fx.turnRate) s.turnRate *= fx.turnRate;
    if (fx.yawResponse) s.yawResponse *= fx.yawResponse;
    if (fx.grip) s.grip *= fx.grip;
    if (fx.driftYaw) s.driftYaw *= fx.driftYaw;
    if (fx.driftCharge) s.driftCharge *= fx.driftCharge;
    if (fx.boostPower) s.boostPower *= fx.boostPower;
    if (fx.mass) s.mass *= fx.mass;
    if (fx.stability) s.stability = Math.max(0.05, Math.min(1, s.stability + fx.stability));
    if (fx.air) s.air = Math.max(0.05, Math.min(1, s.air + fx.air));
  }
  return s;
}

/** A copy of the spec with the rider's weight class applied. */
export function buildSpec(spec: BoatSpec, build: Build | undefined): BoatSpec {
  if (!build || build === 'medium') return spec;
  const k = BUILD_TUNING[build];
  return {
    ...spec,
    thrust: spec.thrust * k.thrust,
    topSpeed: spec.topSpeed * k.topSpeed,
    boostTopSpeed: spec.boostTopSpeed * k.topSpeed,
    turnRate: spec.turnRate * k.turn,
    yawResponse: spec.yawResponse * k.yaw,
    stability: Math.max(0.05, Math.min(1, spec.stability + k.stability)),
    mass: spec.mass * k.mass,
  };
}

/** Damage multiplier from the weight class (light riders get knocked about more). */
export function buildToughness(build: Build | undefined) {
  return BUILD_TUNING[build ?? 'medium'].toughness;
}
