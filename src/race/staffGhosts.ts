/**
 * STAFF GHOSTS — one reference lap per race course (normal direction).
 *
 * These are not human laps: scripts/make-staff-ghosts.ts drives every course
 * offline with the game's own autopilot (the same AI driver the rivals use,
 * no AI-only forces), keeps the best of several laps and boats, and writes the
 * lap to staffGhosts.json. The UI labels them as an AI reference lap.
 *
 * Storage: samples quantised exactly like ghost codes (GHOST_SAMPLE_SCALE),
 * delta-coded per channel as little-endian Int16, base64, stored at a reduced
 * rate (`hz`) and interpolated back up to GHOST_HZ on load.
 */

import { GHOST_SAMPLE_SCALE } from '../save/ghostCode';
import type { GhostData } from './session';
import data from './staffGhosts.json';

export interface StaffGhostEntry {
  boat: string;
  /** Lap time, seconds. */
  time: number;
  /** Packed samples (base64 Int16 LE deltas). */
  data: string;
}

export interface StaffGhostFile {
  format: string;
  note: string;
  /** Sample rate of the packed data. */
  hz: number;
  ghosts: Record<string, StaffGhostEntry>;
}

const FILE = data as StaffGhostFile;
/** Must match session GHOST_HZ (kept local to avoid a module cycle with session). */
const PLAY_HZ = 10;
export const STAFF_NAME = 'STAFF';

/** Staff lap time for a course, or 0 when it has none. */
export function staffGhostTime(trackId: string) {
  return FILE.ghosts[trackId]?.time ?? 0;
}

export function staffGhostBoat(trackId: string) {
  return FILE.ghosts[trackId]?.boat ?? '';
}

function b64ToBytes(s: string): Uint8Array {
  const b = atob(s);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** Pack 6-channel samples (any rate) into the staff format. */
export function packStaffSamples(samples: number[]): string {
  const n = samples.length / 6;
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  const prev = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 6; c++) {
      const q = Math.round(samples[i * 6 + c] * GHOST_SAMPLE_SCALE[c]);
      const d = Math.max(-32768, Math.min(32767, q - prev[c]));
      view.setInt16((i * 6 + c) * 2, d, true);
      prev[c] += d;
    }
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Unpack to samples at the packed rate. */
export function unpackStaffSamples(packed: string): number[] {
  const bytes = b64ToBytes(packed);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.length / 2);
  const out: number[] = new Array(count);
  const acc = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    const c = i % 6;
    acc[c] += view.getInt16(i * 2, true);
    out[i] = acc[c] / GHOST_SAMPLE_SCALE[c];
  }
  return out;
}

/** Resample 6-channel samples from rate `from` to rate `to` (angles wrap). */
export function resampleGhost(s: number[], from: number, to: number): number[] {
  if (from === to) return s.slice();
  const n = s.length / 6;
  const dur = (n - 1) / from;
  const m = Math.floor(dur * to) + 1;
  const out: number[] = new Array(m * 6);
  for (let i = 0; i < m; i++) {
    const f = Math.min(n - 1, (i / to) * from);
    const a = Math.min(n - 2, Math.floor(f));
    const k = f - a;
    for (let c = 0; c < 6; c++) {
      const x = s[a * 6 + c];
      let d = s[(a + 1) * 6 + c] - x;
      if (c === 3) {
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
      }
      out[i * 6 + c] = x + d * k;
    }
  }
  return out;
}

const cache = new Map<string, GhostData>();

/** The staff ghost of a course as playable ghost data, or null if none. */
export function staffGhost(trackId: string): GhostData | null {
  const e = FILE.ghosts[trackId];
  if (!e) return null;
  let g = cache.get(trackId);
  if (!g) {
    g = { trackId, boatId: e.boat, time: e.time, samples: resampleGhost(unpackStaffSamples(e.data), FILE.hz, PLAY_HZ), name: STAFF_NAME };
    cache.set(trackId, g);
  }
  return g;
}
