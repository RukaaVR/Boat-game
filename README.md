# RIPTIDE — Arcade Wave Racing

A complete arcade water-racing game for the browser with a cel-shaded anime
look. Almost everything is generated from code: every boat, island, texture,
sound effect, voice chirp and music note. The one imported asset is the rider's
base body, a stylised character model (`assets/models/tinybase.fbx`) converted
once by `scripts/convert-rider.mjs` into `src/boat/riderModel.json`; hair, face,
clothes colours and animation are all procedural on top of it.

TypeScript · Vite · three.js (WebGL2) · Web Audio API · no backend.

![Frames captured from the game by the screenshot harness](riptide_showcase.png)

```bash
npm install
npm run dev        # → http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build on :4173
```

The production build is an installable offline app (web manifest + service
worker): open it once, then "Install" / "Add to Home Screen" and it runs with
no connection.

## Controls

| Action | Keyboard | Gamepad (standard mapping) |
|---|---|---|
| Throttle | `W` / `↑` | RT |
| Brake / reverse | `S` / `↓` | LT |
| Steer | `A` `D` / `←` `→` | Left stick |
| Drift (tap to hop + steer, hold through the turn, release for boost) | `Shift` / `Space` | A / RB |
| Nitro (hold) | `E` / `Left Ctrl` | X |
| Air tricks | in the air: `Drift` + `↑` front flip, `Drift` + `↓` back flip, `Drift` + `←/→` 360 spin | same with stick |
| Barrel roll (air) | `Q` | LB |
| Use item (Battle, or races with items on) | `F` | B |
| Air pitch | `W` / `S` while airborne | Left stick Y |
| Camera (close / far / bow / cinematic / aerial) | `C` | Y |
| Pause | `Esc` / `P` | Start |
| Restart | `R` | Back |
| Respawn on course | `T` | R3 |
| Menus | arrows / WASD, `Enter`, `Esc`, or mouse | D-pad / stick, A, B |

Every keyboard binding can be changed in **Settings → Controls**.

**Touch** (phones/tablets, auto-detected or forced in Settings → Controls): a
floating thumbstick on the left half of the screen steers (and trims pitch in
the air); GAS, BRAKE, DRIFT, NITRO and TRICK buttons on the right, ITEM in
Battle, pause and camera at the top left. Optional tilt-to-steer.

**Two players** (split-screen, top/bottom): P1 uses `W A S D`, `Space` drift,
`E` nitro, `Q` roll, `F` item, `C` camera, `T` respawn; P2 uses the arrow keys,
`Right Shift` drift, `Right Ctrl` nitro, `.` roll, `/` item, `M` camera, `\`
respawn. With two gamepads each player gets one; with one gamepad it goes to P2.

## How it plays

- **Drift** is the core skill and works like a kart racer. Tap drift and the
  boat **hops**; steer during the hop (or land a jump with drift held) and it
  breaks into a slide that way. The direction is locked for the whole drift:
  steering only sets the radius — into the turn for a tight arc, away for a wide
  one — and it never straightens out. The hull swings out and holds its angle,
  the slide keeps its speed, and small wave skips don't break it. Sparks build
  through three tiers (blue → orange → pink), faster the tighter you hold the
  line; release for a mini-turbo whose length depends on the tier. Holding the
  button without a fresh hop does nothing, so every drift is deliberate.
- **Nitro** is a reserve you spend by holding the nitro button. You earn it by
  drifting, drafting behind rivals (a SLIPSTREAM indicator appears), tricks,
  clean landings, boost pads and stunt rings.
- **Air** comes from ramps and from real wave crests — swell zones on each track
  build bigger seas, storms make everything bigger. In the air you can trim
  pitch, flip, spin and barrel-roll. Land level and aligned with the course for
  a PERFECT LANDING boost; land mid-trick or badly and you wipe out.
- **Readability**: buoy-marked edges, chevron corner signs, a glowing arch on
  the next checkpoint, a checkpoint direction pointer, a rotating minimap,
  rival name tags with positions, edge arrows for boats alongside, an optional
  racing-line assist (Settings → Gameplay), and an unmissable WRONG WAY banner.
- **Starts**: holding the throttle when "2" shows floods the engine (FALSE START,
  1.2 s penalty). Hitting the throttle on "1" gives a PERFECT START launch.
- **Shortcuts**: every course has a narrow channel through the rocks, marked
  with yellow buoys and a SHORTCUT sign. It saves distance and costs nerve.

- **Items** (Battle always; normal races when Settings → Gameplay → ITEM BOXES is
  on): drive through a box and a roulette picks an item weighted by your place —
  leaders get defensive items, the back of the pack gets the strong ones:
  TORPEDO, TORPEDO ×3 (three shots), OIL SLICK, SHIELD, WAVE MAKER, TURBO,
  SEEKER (a homing missile that hunts the leader — jump at the last moment or
  shield it), GOLDEN SURGE (mash for repeated boosts for 6 s) and STORM CALL
  (lightning shrinks and slows every rival for 5 s; last places only, with a
  cooldown). Nothing changes a boat's stats permanently.
- **Callouts**: manga-style banners for overtakes (with the rival's name), first
  place, final lap, incoming missiles, big drifts, perfect landings and the
  career boss closing in. At most one at a time, rate-limited and queued.

## Game modes

| Mode | |
|---|---|
| Quick Race | 6 boats, 1–5 laps, easy / normal / hard AI, any weather, optional changing weather |
| Career | Eight named rivals, one at a time, each with an intro line. Finish ahead of the boss to unlock the next; the final boss, MAELSTROM, runs a hotter engine |
| Championship | Six cups (3–6 races), starting with the beginner SPLASH CUP. Points 10-8-6-5-4-3, standings between rounds, a podium after each race and a trophy ceremony at the end |
| Challenges | A new daily challenge and weekly challenge, generated from the date (same for everyone), with credit and XP rewards. Boats you don't own are lent for the attempt |
| Battle | A fight in **Lagoon Arena** (an open lagoon ringed by islands, channels, an arch, docks and floating platforms) or on any course. Three rules: BALLOONS (3 lives, last boat afloat), TIMED (most hits in 3 minutes) and SCORE (first to 5 hits) |
| 2 Player | Local split-screen with 0–4 AI rivals (no progression awarded) |
| Time Trial | Solo laps against medal targets and a best-lap **ghost** — yours, or a friend's imported from a code |
| Stunt Run | Two minutes to score with tricks, drifts, clean landings and rings |
| Endless Wave | The sea keeps rising and mines drift in; checkpoints add time |
| Free Ride | No clock — explore the course, chase rings, hunt message bottles |
| Tutorial | A guided lesson on calm water: throttle, steering, checkpoints, drift tiers, mini-turbo, nitro, ramps, tricks, clean landings and the perfect start. Each step completes only when you have actually done it |

## Content

- **14 race courses plus a battle arena** — new beginner courses Palm Shallows
  (wide, calm), Hopscotch Keys (a run of weaving ramps) and Lighthouse Point
  (drift S-bends) make up the SPLASH CUP; **Starfall Circuit** is a neon night
  course with light rails along both edges, light hoops for checkpoints, a
  giant moon and a glowing skyline. The original ten: Coral Cove and Sunset Atoll (tropical bay),
  Thunderhead Coast (storm coast), Neon Harbor and Shipyard Sprint (harbour /
  industrial docks), Cinder Strait (volcanic waters), Glacier Bay (icebergs,
  drifting floes, the northern lights), Canal City (stone embankments,
  waterfront townhouses, arch bridges, gondolas and tight turns), and two
  **point-to-point sprints** — Jungle Rapids (a river between wooded banks, past
  a temple ruin) and Fjord Dash (between snow-capped cliffs). A sprint races one
  stretch of the generated course from a START gate to a FINISH gate; the rest
  of the loop is walled off by a log jam or an ice wall.
- Each course has gates, buoy-marked edges, chevron corner signs, ramps, boost
  pads, swell zones, hazards, a shortcut, five hidden **message bottles**, and
  themed scenery.
- **Living world**: dolphin pods leap beside the course, gull flocks circle the
  islands, a whale breaches out on open water, and fishing trawlers cross the
  course as moving obstacles (the AI steers around them). Toggle in Settings.
- **Music that follows the race**: original synthesised songs for the menu,
  garage, race and results. In a race, layers fade in on bar lines — brass when
  you lead, a string ostinato when the fight is close, a driving bass when
  you're behind — and the final lap jumps to the hook, two semitones up and
  faster. Win and lose stings on the finish. Riders have short synthesised voice
  chirps (no recorded audio). The output runs through a compressor, limiter and
  soft clipper.
- **Changing weather**: optionally, a storm rolls in, night falls, or the sky
  clears part-way through a race — sky, light, water colour, rain and the sea
  state all blend over about 14 s.
- **4 weathers** for any course — clear, sunset, storm (rain, lightning,
  thunder, much bigger swell), night (stars, moon, neon reflections).
- **6 watercraft** with distinct hulls and handling: SPEEDSTER (balanced),
  DRIFTER (loose and twitchy), BULLET (top speed), AERO (air control), TANK
  (twin-hull bruiser), WAVE BREAKER (deep-V, eats swell).
- **5 AI rivals** with personalities (aggressive, technical, speed, balanced,
  reckless): different lanes, drift habits, shortcut and ramp choices, nitro
  strategy, deliberate mistakes, traffic behaviour and stuck recovery.
- **Your rider**: a character creator (main menu → RIDER, or the garage tab)
  with hair style and colour, skin tone, eye colour and expression on a
  turntable stage you can drag or turn with `Q`/`E`. The same rider appears in
  races, the garage, replays, podiums and in ghost codes you share. Riders
  react in races (item pickup, hits, tricks, glancing back at rivals) and their
  spiky hair has spring-driven secondary motion.
- **Podium and trophy**: after a quick race, championship round or career
  stage the top three take the podium (winner celebrates, the others clap,
  confetti). Finishing a cup in the top three ends with a trophy ceremony.
  Skippable with any button.
- **Garage**: buy boats, upgrade each one (engine, hull, nitro tank, handling;
  three stages each), and customise hull and accent colour, stripe pattern,
  race number, decal, wake-trail tint and boost-flame colour — painted live on
  the 3D hull.
- **Damage**: hard hits, mines and battle items scuff and dent the hull livery,
  trail smoke from the engine and cost up to 12% power for the rest of the
  event. Hull upgrades reduce damage taken.
- **Progression**: XP and levels (unlock courses, cups, boats, paint, decals,
  trail and flame colours), credits, medals per course and mode, records,
  championship trophies, 27 achievements with credit rewards, lifetime stats,
  collectibles, career progress, unlock toasts.

## Replays, photos and sharing

- **Replay**: every race (except split-screen) is recorded. Watch it from the
  results screen at ¼×–2× speed, from any camera, following any boat.
- **Photo mode** (pause menu or replay bar): the action freezes and a free
  camera flies anywhere (`WASD`, arrows, `Q`/`E`, `Shift`). Adjust FOV and tilt,
  pick a filter (vivid, noir, sepia, retro, dream), hide the boats, and SNAP to
  save a PNG.
- **Ghost codes (v2)**: in Time Trial, SHARE MY GHOST produces a text code (the
  lap, quantised and deflated, about 1–2 KB) that also carries your rider look
  and boat upgrades, a CRC-32 checksum (an edited or truncated code is
  rejected) and a short fingerprint (`RIPTIDE-XXXX-XXXX-XXXX`) to confirm two
  people have the same ghost. A friend pastes it into RACE A FRIEND'S GHOST;
  imported ghosts are stored separately and never overwrite your own. Old v1
  codes still import.
- **Leaderboard**: the best-lap board in Time Trial is **local to this device**
  and labelled as such. There is no online leaderboard and no server; the code
  has a small provider interface (`src/online/leaderboard.ts`) so a real
  backend could be added later.

## Settings and accessibility

Five menu languages (English, Español, Français, Deutsch, Português), colour
assist filters (protan / deutan / tritan), **colour-blind symbols** (shapes on
buoys — ▲ left edge, ■ right edge, ◆ shortcut — Roman numerals on drift tiers,
letters on medals), HUD scale, camera-shake and motion-effect sliders, **reduce flashes**
(lightning, impact frames and white-outs at a quarter strength), **particle
amount**, separate **menu / UI sound** volume, boat shadows, wildlife on/off, changing weather on/off, touch controls and tilt,
steering sensitivity, key rebinding.

**Graphics**: LOW / MEDIUM / HIGH presets plus **AUTO**, which picks a preset
from the device (GPU renderer string, cores, memory, screen) and steps down one
preset if the median frame time stays high even at minimum resolution. Presets
set ocean density, MSAA, bloom, particle budget, shadows, scenery outlines and
level-of-detail distances. Dynamic resolution (on by default) scales the pixel
ratio from the median frame time.

**Saves** are versioned (currently v2). An older save is backed up to
`riptide.save.v1.v<N>` in localStorage before it is migrated step by step, and
every field is validated on load. A save written by a newer build is read as
far as it is understood and its original is backed up the same way.

## Admin panel

A password-protected developer / cheat console. Open it with
**`Ctrl` + `Shift` + `K`** anywhere, or click any RIPTIDE logo five times
quickly. The password is **`SaltyKraken77`**.

- **Save**: set credits / level, unlock everything, give all boats, max all
  upgrades, give gold medals, export / download / import the save as JSON,
  reset progress.
- **Race**: infinite nitro, god mode (no wipeouts), freeze AI, AI strength
  slider, jump to the next checkpoint, skip a lap, respawn, refill nitro, repair,
  shield, instant finish in any position.
- **Physics**: live multipliers for top speed, grip, drift, gravity, buoyancy
  and boost power.
- **World**: weather / time of day, wave height, rain strength, game speed
  (slow motion), spawn mines or a ramp ahead, free-flying camera.
- **Debug**: live FPS / CPU stats, particle and LOD counts, the `?debug=1`
  overlay, ocean wireframe, collision shapes, hide UI, bloom, outlines,
  autopilot, graphics preset buttons, rider animation triggers, drift-spark
  tier preview, grant any item, podium / trophy previews, open the character
  creator.

Three wrong passwords lock the prompt for 30 seconds; a correct one stays
unlocked until the tab is closed. The game has no server, so the check runs in
the browser and only a hash of the password ships in the code — it keeps
casual players out, but anyone with developer tools could get past it.

**This is not security.** Everything the panel can do, a player can also do by
editing localStorage or the JavaScript in their own browser. The password only
stops accidental use; it protects no secrets and nothing server-side (there is
no server).

## Architecture

```
src/
  admin/       password-gated admin panel
  core/        game orchestrator (state machine, harness API), math, rng, events, types
  water/       waves.ts — THE wave field (CPU + GLSL); ocean mesh/shader; wakes & hull foam
  boat/        specs, state, physics (buoyancy, handling, drift, boost, tricks), collisions, meshes
  race/        course generator (loops + sprints), race session (all mode rules), racers,
               battle items, trawler traffic, replay recorder/player, guided tutorial
  ai/          AI drivers
  environment/ layout (pure data), scenery visuals, props, sky, aurora, weather presets + blending, atmosphere
  render/      renderer + post stack + split-screen + adaptive resolution, graphics presets,
               distance LOD for instanced props, character / podium stages, cel materials/outlines,
               course furniture, battle visuals, wildlife, boat shadows, FX director, world
  camera/      chase/bow/cinematic/aerial rig with shake and comfort scaling
  particles/   pooled GPU point particles
  audio/       synthesised SFX/engines and procedural music sequencer
  ui/          menus, HUD, minimap, replay bar / photo panel, translations, spatial navigation, styles
  input/       keyboard + gamepads (incl. split-screen layouts) + touch, rebindable
  online/      leaderboard provider interface + the local (this-device) implementation
  save/        validated, versioned localStorage save, progression content (upgrades, achievements,
               challenges, career), rewards, ghost codes
public/        web manifest, icons, service worker
  debug/       ?debug=1 overlay, GPU↔CPU wave agreement check
harness/       Playwright + tsx test and capture scripts
```

Rules the code follows:

1. **One wave field.** `src/water/waves.ts` defines the Gerstner wave table,
   the swell-zone envelope, the GLSL (`WAVE_GLSL`) and the CPU mirror
   (`oceanHeight` / `sampleOcean`). The ocean, wakes, hull foam, boost pads and
   racing line displace with the GLSL; boats, buoys, mines, the camera and the
   AI sample the CPU side. Both use the same fixed-point inverse for horizontal
   Gerstner displacement. `harness/gameplay-test.mjs` renders the GLSL into a
   float target and checks it against the CPU: max error is under 2 cm.
2. **The simulation is headless.** `RaceSession` runs without a renderer and
   communicates with presentation through an event queue. The race can be
   simulated in Node (`npx tsx harness/sim-probe.ts`).
3. **AI drives the same `Controls` as the player.** No AI-only forces.
4. **No allocation in the frame loop** for physics, particles, wakes and
   instanced updates (preallocated scratch objects and pooled buffers).

Frame order: input → simulation (sub-stepped physics, collisions, progress,
mode rules) → camera → world visuals → HUD → audio → render.

## Testing and tooling

All harness scripts drive the real game in headless Chromium through
`window.__RIPTIDE__` (enabled with `?harness=1`), which owns a fixed-step clock
so results are deterministic.

```bash
npm run dev &                          # or build + preview
npm test                               # 29 gameplay tests + 20 feature tests
node harness/features-test.mjs         # just the feature suite
node harness/capture.mjs --list        # named screenshot scenarios
node harness/capture.mjs --shots=racing,storm,night --out=shots
npx tsx harness/sim-probe.ts coral     # headless full race, numeric report
npx tsx harness/drift-probe.ts         # drift feel: turn rate wide/neutral/tight, speed kept, tier times
node harness/perf.mjs --url=http://localhost:4173/   # real-clock perf sampling
```

The feature suite covers: the admin password gate and lockout, upgrades
applied in races, achievements and lifetime stats, replay playback, photo
snapshots, ghost-code round trips, deterministic challenges, the full guided
tutorial, battle items and damage, split-screen input, a point-to-point sprint
finish, the new courses, the career ladder, bottle collection, mid-race weather
changes, touch controls, menu translation, hostile values in the new save
fields, v1 → v2 save migration, ghost-code v2 checksums and fingerprints, and
all three Lagoon Arena battle rules.

The gameplay suite covers: GPU/CPU wave agreement, race start sequence,
flotation, acceleration, checkpoints and AI progress, finish and results,
progression saved to localStorage, wrong-way detection, respawn, pause/resume,
restart, drift tiers and boost release, ramp launch and landing, every mode,
stunt timer, ghost saving, championship rounds and finale, garage persistence,
settings persistence, key rebinding, viewport resizing, a clean console,
reload persistence, corrupted/hostile save data, gamepad driving and gamepad
menu navigation, and keyboard-only menu flow.

`?debug=1` shows FPS, frame time, CPU cost of simulation + update, draw calls,
triangles, heap, particles, sea state, and live boat/race state, with toggles
for autopilot, slow-motion, bloom, outlines, HUD, weather, ocean wireframe,
nitro, respawn and adaptive resolution.

## Performance

Measured in this project's development container, which has **no GPU**:
Chromium falls back to SwiftShader (software rasterisation on the CPU), so
real frame rates could not be measured here. What could be measured:

| | |
|---|---|
| CPU per frame, simulation + all scene updates, 6 boats (`perf.mjs`) | **0.76 ms** |
| Draw calls mid-race (high quality, 6 boats, scenery, post) | ~110–125 |
| Triangles mid-race | ~300–360 k |
| GPU resources across repeated race loads | stable (no leaks) |

Systems in place for real hardware: instanced props with outlines sharing the
instance buffer, merged islands/gates/signs, one draw call for all wakes and
one for all hull-foam collars, pooled particles (two draw calls), GPU-animated
rain, a camera-centred radial ocean grid with distance band-limiting, three
quality presets (ocean density, MSAA, bloom, particle budget, rain density), a
user pixel-ratio cap, and an adaptive resolution controller driven by median
frame time. Run `node harness/perf.mjs` on a machine with a GPU for real
numbers.

## Known limitations

- Frame rate on real GPUs has not been measured (see above).
- Audio was verified by measuring the output signal (levels, no clipping, mood
  changes), not by listening.
- Wake and spray are stylised approximations: there is no wave–wake interaction
  between boats, and spray is billboarded points rather than fluid.
- Boat shadows are soft projected footprints, not shadow maps: they are cast
  onto the water and ramps, not onto other boats or scenery.
- Tracks are generated from harmonic radius profiles. Point-to-point sprints
  race part of such a loop and wall off the rest, so start and finish are never
  very far apart in a straight line.
- Canal City's "right-angle" turns are tight rounded corners (the generator
  enforces a 30 m minimum turn radius so every boat can make them).
- Touch controls were tested with emulated touch input in headless Chromium,
  not on a physical phone.
- Split-screen renders the scene twice per frame; on weak GPUs expect roughly
  half the single-player frame rate. Replays and progression are off in
  split-screen.
- Only menus are translated; in-race callouts stay in English.
- The admin password check is client-side and is not security (see above).
- There are no online features: ghosts are shared by copying a text code, and
  the leaderboard only lists this device's times.
- Battle: when the player is knocked out in BALLOONS the battle ends at once
  (no spectating). In the direct-homing phase the SEEKER ignores islands.
- Item effect timers (shrink, surge) are not captured by the replay recorder;
  replays show the boats' motion but not the shrink.
- Item and voice sounds play for player 1 only in split-screen (one audio
  output); player 2 still gets every visual warning.
- On the podium the rider's short arms hold the trophy by its base just above
  the head rather than fully overhead.
- Voice chirps and music were verified by measuring output levels, not by
  listening on real speakers.
