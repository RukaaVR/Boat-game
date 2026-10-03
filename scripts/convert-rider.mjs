// Converts assets/models/tinybase.fbx (the rider base mesh) into
// src/boat/riderModel.json: per-part indexed triangle meshes in metres,
// model space (+Y up, +Z forward, character's left = +X), T-pose.
//   node scripts/convert-rider.mjs
import fs from 'fs';
globalThis.self = globalThis;
globalThis.window = globalThis;
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');

const SCALE = 0.0068; // model units → metres (about 1.75 m tall)
const NAMES = { yhead: 'head', TOSO: 'torso', LC: 'shoulderL', R_C: 'shoulderR', l_arm: 'armL', R_ARM: 'armR', HAND_L: 'handL', HAND_R: 'handR', l_leg: 'legL', R_LEG: 'legR', l_foot: 'footL', r_foot: 'footR', WATCH_L: 'watchL', WATCH_R: 'watchR' };

const buf = fs.readFileSync(new URL('../assets/models/tinybase.fbx', import.meta.url));
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
root.updateMatrixWorld(true);
const parts = {};
root.traverse((o) => {
  if (!o.isMesh || !NAMES[o.name]) return;
  let g = o.geometry.clone();
  g.applyMatrix4(o.matrixWorld);
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g = mergeVertices(g, 1e-3);
  const p = Array.from(g.attributes.position.array, (v) => Math.round(v * SCALE * 1e4) / 1e4);
  parts[NAMES[o.name]] = { p, i: Array.from(g.index.array) };
});
const out = new URL('../src/boat/riderModel.json', import.meta.url);
fs.writeFileSync(out, JSON.stringify({ source: 'assets/models/tinybase.fbx', scale: SCALE, parts }));
console.log('wrote', out.pathname, (fs.statSync(out).size / 1024).toFixed(1), 'KB', Object.entries(parts).map(([k, v]) => `${k}:${v.p.length / 3}`).join(' '));
