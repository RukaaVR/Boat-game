// Seeker vs islands probe. Usage: npx tsx harness/seeker-probe.ts [trackId] [seconds] [srcRoot]
// Hands a SEEKER to a trailing AI every 2.5 s and counts frames where a missile
// in its direct-homing phase is inside an island/rock collider (should be 0),
// plus hits, bursts (rock / jumped / expired) and trailed-item blocks.
const id = process.argv[2] ?? 'lagoon';
const secs = Number(process.argv[3] ?? 180);
const root = process.argv[4] ?? '../src';
const { EventQueue } = await import(root + '/core/events');
const { RaceSession } = await import(root + '/race/session');
const { defaultLivery } = await import(root + '/boat/livery');
const ev = new EventQueue();
const battle = id === 'lagoon';
const s = new RaceSession({ mode: battle ? 'battle' : 'quick', items: true, trackId: id, weather: 'clear', laps: 9, difficulty: 'normal', playerBoat: 'speedster', playerLivery: defaultLivery(), playerName: 'YOU', opponents: 5, ghost: null, battleRule: 'timed' }, ev);
s.playerAutopilot = true;
const dt = 1 / 60;
let t = 0;
let inside = 0, fired = 0, hits = 0, bursts = 0, homeFrames = 0, blocked = 0, shielded = 0;
let give = 3;
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const all = s.statics.all;
while (t < secs && s.phase !== 'results') {
  s.step(dt);
  t += dt;
  if (s.phase === 'racing' && (give -= dt) <= 0) {
    give = 2.5;
    const r = s.order[s.order.length - 1 - Math.floor(rand() * 3)];
    if (r.ai && !r.item) { r.item = 'homer'; r.itemCount = 1; r.itemRoll = 0; }
  }
  for (const m of s.items.missiles) {
    if (!m.alive || m.phase !== 'home') continue;
    homeFrames++;
    for (const c of all) if ((m.x - c.x) ** 2 + (m.z - c.z) ** 2 < c.r * c.r) { inside++; break; }
  }
  for (const e of ev.list) {
    if (e.type === 'itemUse' && e.text === 'homer') fired++;
    if (e.type === 'itemHit' && e.text === 'homer') hits++;
    if (e.type === 'itemHit' && e.text === 'homer-miss') bursts++;
    if (e.type === 'shieldHit' && e.text === 'homer') shielded++;
    if (e.type === 'itemBlock') blocked++;
  }
  ev.clear();
}
console.log(`${id} ${root === '../src' ? 'NEW' : 'BASE'}: fired ${fired} hits ${hits} shielded ${shielded} blocked ${blocked} bursts(rock/jumped/expired) ${bursts} homeFrames ${homeFrames} framesInsideCollider ${inside}`);
