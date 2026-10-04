/**
 * Ghost sharing without a server: a best-lap ghost is packed into a text code
 * that can be pasted into a chat and imported on another machine.
 *
 * Version 2 (current):
 *   RPT2.<track>.<boat>.<lap ms>.<name>.<look>.<upgrades>.<crc32>.<z|r><payload>
 *     look      hair-style initial, hair / skin / eye hex, expression initial
 *               e.g. "b-f3e0a8-ffdcc4-e0a020-g"
 *     upgrades  one digit per upgrade kind (engine, hull, nitro, handling)
 *     crc32     hex checksum over everything before it plus the payload,
 *               so a truncated or edited code is rejected rather than raced
 * Version 1 (still accepted on import):
 *   RPT1.<track>.<boat>.<lap ms>.<name>.<z|r><payload>
 *
 * The payload is the ghost's samples quantised to integers (5 cm positions,
 * 1 cm height, milliradian angles), delta-coded per channel as Int16, then
 * deflated when the browser supports CompressionStream ('z') or left raw ('r').
 *
 * A code also has a short human fingerprint, RIPTIDE-XXXX-XXXX-XXXX, derived
 * from its checksum — handy to confirm two people have the same ghost.
 */

import type { GhostData } from '../race/session';
import { TRACKS } from '../race/trackDefs';
import { BOATS } from '../boat/specs';
import { HAIR_STYLES, sanitizeLook, type RiderLook } from '../boat/riderLook';
import { UPGRADE_KINDS, UPGRADE_MAX, type Upgrades } from './progress';

export const GHOST_CODE_VERSION = 2;
const SCALE = [20, 100, 20, 1000, 1000, 1000];

function b64url(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

let crcTable: Uint32Array | null = null;
/** Standard CRC-32 (IEEE) of a string. */
export function crc32(str: string) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) crc = crcTable[(crc ^ str.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function packLook(l: RiderLook) {
  return `${l.hair[0]}-${l.hairColor.slice(1)}-${l.skin.slice(1)}-${l.eyes.slice(1)}-${l.expression[0]}`;
}
function unpackLook(s: string): RiderLook | undefined {
  const p = s.split('-');
  if (p.length !== 5) return undefined;
  const hair = HAIR_STYLES.find((h) => h.id[0] === p[0])?.id;
  if (!hair) return undefined;
  return sanitizeLook({ hair, hairColor: '#' + p[1], skin: '#' + p[2], eyes: '#' + p[3], expression: p[4] === 'd' ? 'determined' : 'grin' });
}
function packUpgrades(u?: Upgrades) {
  return UPGRADE_KINDS.map((k) => Math.max(0, Math.min(UPGRADE_MAX, Math.round(u?.[k] ?? 0)))).join('');
}
function unpackUpgrades(s: string): Upgrades | undefined {
  if (!/^\d+$/.test(s) || s.length !== UPGRADE_KINDS.length) return undefined;
  const out = {} as Upgrades;
  UPGRADE_KINDS.forEach((k, i) => (out[k] = Math.min(UPGRADE_MAX, Number(s[i]))));
  return out;
}

async function packSamples(samples: number[]) {
  const n = samples.length / 6;
  const data = new Int16Array(samples.length);
  const prev = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 6; c++) {
      const q = Math.round(samples[i * 6 + c] * SCALE[c]);
      const d = Math.max(-32768, Math.min(32767, q - prev[c]));
      data[i * 6 + c] = d;
      prev[c] += d;
    }
  }
  let bytes = new Uint8Array(data.buffer);
  let flag = 'r';
  if (typeof CompressionStream !== 'undefined') {
    try {
      bytes = await pipe(bytes, new CompressionStream('deflate-raw'));
      flag = 'z';
    } catch {
      /* fall back to raw */
    }
  }
  return flag + b64url(bytes);
}

async function unpackSamples(payload: string): Promise<number[] | null> {
  let bytes = unb64url(payload.slice(1));
  if (payload[0] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (payload[0] !== 'r') return null;
  if (bytes.length % 12 !== 0 || bytes.length > 6 * 2 * 10 * 600) return null;
  const data = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
  const samples: number[] = new Array(data.length);
  const acc = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < data.length; i++) {
    const c = i % 6;
    acc[c] += data[i];
    samples[i] = acc[c] / SCALE[c];
  }
  return samples;
}

const safeName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12) || 'RIVAL';

export async function encodeGhost(g: GhostData, name: string): Promise<string> {
  const look = g.look ? packLook(g.look) : 'x';
  const head = `RPT2.${g.trackId}.${g.boatId}.${Math.round(g.time * 1000)}.${safeName(name)}.${look}.${packUpgrades(g.upgrades)}`;
  const payload = await packSamples(g.samples);
  return `${head}.${crc32(head + '.' + payload)}.${payload}`;
}

/** Short, human-checkable fingerprint for a code: RIPTIDE-XXXX-XXXX-XXXX. */
export function ghostFingerprint(code: string) {
  const h = crc32(code).toUpperCase() + crc32(code.split('').reverse().join('')).toUpperCase();
  return `RIPTIDE-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}

export interface DecodedGhost extends GhostData {
  name: string;
  /** Code format version the ghost was imported from. */
  version: number;
}

/** Parse and validate a ghost code; null if it is not a valid code. */
export async function decodeGhost(code: string): Promise<DecodedGhost | null> {
  const parts = code.trim().replace(/\s+/g, '').split('.');
  try {
    if (parts[0] === 'RPT2' && parts.length === 9) {
      const [, trackId, boatId, ms, name, look, upg, crc, payload] = parts;
      if (crc32(parts.slice(0, 7).join('.') + '.' + payload) !== crc) return null;
      if (!TRACKS.some((t) => t.id === trackId) || !BOATS.some((b) => b.id === boatId)) return null;
      const time = Number(ms) / 1000;
      if (!Number.isFinite(time) || time <= 5 || time > 1200) return null;
      const samples = await unpackSamples(payload);
      if (!samples) return null;
      return { trackId, boatId, time, samples, name: safeName(name), look: look === 'x' ? undefined : unpackLook(look), upgrades: unpackUpgrades(upg), version: 2 };
    }
    if (parts[0] === 'RPT1' && parts.length === 6) {
      const [, trackId, boatId, ms, name, payload] = parts;
      if (!TRACKS.some((t) => t.id === trackId) || !BOATS.some((b) => b.id === boatId)) return null;
      const time = Number(ms) / 1000;
      if (!Number.isFinite(time) || time <= 5 || time > 1200) return null;
      const samples = await unpackSamples(payload);
      if (!samples) return null;
      return { trackId, boatId, time, samples, name: safeName(name), version: 1 };
    }
  } catch {
    return null;
  }
  return null;
}
