/**
 * Ghost sharing without a server: a best-lap ghost is packed into a text code
 * that can be pasted into a chat and imported on another machine.
 *
 *   RPT1.<track>.<boat>.<lap ms>.<name>.<z|r><base64url payload>
 *
 * The payload is the ghost's samples quantised to integers (5 cm positions,
 * 1 cm height, milliradian angles), delta-coded per channel as Int16, then
 * deflated when the browser supports CompressionStream ('z') or left raw ('r').
 */

import type { GhostData } from '../race/session';
import { TRACKS } from '../race/trackDefs';
import { BOATS } from '../boat/specs';

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

export async function encodeGhost(g: GhostData, name: string): Promise<string> {
  const n = g.samples.length / 6;
  const data = new Int16Array(g.samples.length);
  const prev = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 6; c++) {
      const q = Math.round(g.samples[i * 6 + c] * SCALE[c]);
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
  const safeName = name.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12) || 'RIVAL';
  return `RPT1.${g.trackId}.${g.boatId}.${Math.round(g.time * 1000)}.${safeName}.${flag}${b64url(bytes)}`;
}

export interface DecodedGhost extends GhostData {
  name: string;
}

/** Parse and validate a ghost code; null if it is not a valid code. */
export async function decodeGhost(code: string): Promise<DecodedGhost | null> {
  const parts = code.trim().split('.');
  if (parts.length !== 6 || parts[0] !== 'RPT1') return null;
  const [, trackId, boatId, ms, name, payload] = parts;
  if (!TRACKS.some((t) => t.id === trackId) || !BOATS.some((b) => b.id === boatId)) return null;
  const time = Number(ms) / 1000;
  if (!Number.isFinite(time) || time <= 5 || time > 1200) return null;
  try {
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
    return { trackId, boatId, time, samples, name: name.slice(0, 12) || 'RIVAL' };
  } catch {
    return null;
  }
}
