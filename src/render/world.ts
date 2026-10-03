/**
 * The visual world for one session: assembles ocean, sky, atmosphere, scenery,
 * course furniture, boats, wakes, particles and FX into a scene, and updates
 * them each frame from the simulation. Owns disposal of everything it built.
 */

import { Scene, Vector3 } from 'three';
import type { EventQueue } from '../core/events';
import type { WeatherId } from '../core/types';
import { BoatVisual } from '../boat/boatMesh';
import { CameraRig } from '../camera/cameraRig';
import { Atmosphere } from '../environment/atmosphere';
import { Scenery } from '../environment/scenery';
import { Sky } from '../environment/sky';
import { Particles } from '../particles/particles';
import type { RaceSession } from '../race/session';
import { Ocean } from '../water/ocean';
import { WakeSystem } from '../water/wake';
import { celShared } from './cel';
import { CourseVisuals } from './course';
import { FxDirector } from './fx';
import type { Quality, Renderer } from './renderer';
import { boatSpec } from '../boat/specs';
import { BattleVisuals } from './battle';
import { Wildlife } from './wildlife';
import { BoatShadows } from './shadows';
import { Aurora } from '../environment/aurora';
import { blendWeather, WEATHER } from '../environment/weatherDefs';

const _ghost = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
const _v = new Vector3();

export class World {
  readonly scene = new Scene();
  readonly ocean: Ocean;
  readonly sky: Sky;
  readonly atmosphere: Atmosphere;
  readonly scenery: Scenery;
  readonly course: CourseVisuals;
  readonly wake: WakeSystem;
  readonly particles: Particles;
  readonly visuals: BoatVisual[];
  readonly fx: FxDirector;
  readonly ghost: BoatVisual | null;
  readonly battle: BattleVisuals | null;
  readonly wildlife: Wildlife;
  readonly shadows: BoatShadows;
  readonly aurora: Aurora | null;
  weather: WeatherId;
  private blend: { from: WeatherId; to: WeatherId; t: number } | null = null;
  /** Photo mode: hide every boat. */
  hideBoats = false;

  constructor(
    readonly session: RaceSession,
    readonly renderer: Renderer,
    events: EventQueue,
    quality: Quality,
    weather: WeatherId,
    opts: { wildlife?: boolean; shadows?: boolean } = {},
  ) {
    this.weather = weather;
    const scene = this.scene;
    this.ocean = new Ocean(quality);
    this.ocean.setShore(session.layout);
    scene.add(this.ocean.mesh);
    this.sky = new Sky(session.track.def.seed);
    scene.add(this.sky.group);
    this.atmosphere = new Atmosphere(scene, this.sky, events, quality);
    this.scenery = new Scenery(session.layout, session.track, quality);
    scene.add(this.scenery.group);
    this.course = new CourseVisuals(session);
    scene.add(this.course.group);

    this.visuals = session.racers.map((r) => new BoatVisual(r.boat.spec, r.livery));
    for (const v of this.visuals) scene.add(v.root);
    this.ghost = session.ghost ? new BoatVisual(boatSpec(session.ghost.boatId), session.player.livery, { ghost: true }) : null;
    if (this.ghost) {
      this.ghost.root.visible = false;
      scene.add(this.ghost.root);
    }

    this.wake = new WakeSystem(
      session.racers.map((r) => r.boat),
      session.racers.map((r) => r.livery.trail),
    );
    scene.add(this.wake.wakeMesh, this.wake.collarMesh);
    this.particles = new Particles(quality);
    for (const o of this.particles.objects) scene.add(o);
    this.fx = new FxDirector(session, this.particles, this.visuals, this.scenery.emitters);
    this.battle = session.items ? new BattleVisuals(session, session.items) : null;
    if (this.battle) scene.add(this.battle.group);
    this.wildlife = new Wildlife(session, this.particles, opts.wildlife !== false);
    this.aurora = session.track.def.theme === 'arctic' ? new Aurora() : null;
    if (this.aurora) scene.add(this.aurora.mesh);
    this.shadows = new BoatShadows(session);
    this.shadows.mesh.visible = opts.shadows !== false;
    scene.add(this.shadows.mesh);
    scene.add(this.wildlife.group);
    this.applyWeather(weather);
  }

  applyWeather(w: WeatherId) {
    this.weather = w;
    this.blend = null;
    this.atmosphere.apply(w, this.session.track.def.theme, this.ocean, this.wake, this.scenery.waterLights);
    this.scenery.setNight(this.atmosphere.night);
    this.wildlife?.setNight(this.atmosphere.night);
    this.particles.setFog(this.atmosphere.fog.color, this.atmosphere.fog.density);
  }

  /** Repaint the player's boat (garage). */
  repaintPlayer() {
    const r = this.session.player;
    this.visuals[0].repaint(r.livery);
    this.wake.setTrailColor(0, r.livery.trail);
  }

  /** Replace the player's boat model (garage boat switch). */
  swapPlayerVisual(v: BoatVisual) {
    const old = this.visuals[0];
    this.scene.remove(old.root);
    old.dispose();
    this.visuals[0] = v;
    this.scene.add(v.root);
  }

  /** Roll from the current weather to `to` over `seconds`. */
  blendTo(to: WeatherId, seconds = 14) {
    this.blend = { from: this.weather, to, t: 0 };
    this.blendSeconds = seconds;
  }
  private blendSeconds = 14;

  update(dt: number, time: number, rig: CameraRig, events: EventQueue) {
    const s = this.session;
    for (const e of events.list) if (e.type === 'weatherShift') this.blendTo(e.text as WeatherId);
    const bl = this.blend;
    if (bl) {
      bl.t = Math.min(1, bl.t + dt / this.blendSeconds);
      const k = bl.t * bl.t * (3 - 2 * bl.t);
      const mid = k < 0.5 ? bl.from : bl.to;
      this.atmosphere.apply(mid, s.track.def.theme, this.ocean, this.wake, this.scenery.waterLights, blendWeather(WEATHER[bl.from], WEATHER[bl.to], k));
      this.scenery.setNight(this.atmosphere.night);
      this.particles.setFog(this.atmosphere.fog.color, this.atmosphere.fog.density);
      if (bl.t >= 1) {
        this.blend = null;
        this.applyWeather(bl.to);
      }
    }
    const cam = rig.camera;
    celShared.uTime.value = time;
    for (let i = 0; i < s.racers.length; i++) {
      const r = s.racers[i];
      this.visuals[i].update(r.boat, r.controls.steer, dt, time);
      const v = this.visuals[i];
      const d2 = (r.boat.position.x - cam.position.x) ** 2 + (r.boat.position.z - cam.position.z) ** 2;
      v.setLod(d2 > 260 * 260 ? 2 : d2 > 110 * 110 ? 1 : 0);
      v.setDamage(r.boat.damage, i * 17 + 3);
      // Ghosting after respawn: blink.
      this.visuals[i].root.visible = !this.hideBoats && (r.boat.ghostTime <= 0 || Math.floor(time * 12) % 2 === 0);
    }
    if (this.ghost && s.mode === 'timetrial') {
      const ok = s.phase === 'racing' && s.player.lap >= 1 && s.ghostPose(s.playerLapTime(), _ghost);
      this.ghost.root.visible = !!ok;
      if (ok) {
        this.ghost.root.position.set(_ghost.x, _ghost.y, _ghost.z);
        this.ghost.root.rotation.set(-_ghost.pitch, _ghost.heading, _ghost.roll, 'YXZ');
      }
    }
    this.ocean.update(cam);
    this.sky.update(cam.position, time);
    this.atmosphere.update(dt, cam, this.ocean);
    this.scenery.update(time, dt);
    this.scenery.setPixelScale(this.renderer.drawingHeight);
    const pr = s.player;
    this.course.update(time, cam.position.x, cam.position.z, s.track.gateIndexFor(pr.checkpoints), s.hasLaps && (s.phase === 'racing' || s.phase === 'countdown'));
    this.wake.update(time);
    this.battle?.update(time);
    this.wildlife.update(dt, time, cam.position);
    this.aurora?.update(cam.position, time, this.atmosphere.night);
    if (this.shadows.mesh.visible) this.shadows.update(time, this.atmosphere.sunDir, this.weather === 'storm' ? 1 : this.weather === 'night' ? 0.7 : 0);
    this.fx.update(dt, time, rig, this.renderer, events, this.atmosphere.preset.rain * this.atmosphere.rainScale);
    this.particles.update(dt);
    this.particles.setScale(this.renderer.drawingHeight, cam.fov);
    void _v;
  }

  /** Point camera-following pieces at `cam` before rendering a split-screen view. */
  prepareView(cam: import('three').Camera, time: number) {
    this.ocean.update(cam);
    this.sky.update(cam.position, time);
    this.atmosphere.followCamera(cam);
  }

  dispose() {
    this.ocean.dispose();
    this.sky.dispose();
    this.atmosphere.dispose();
    this.scenery.dispose();
    this.course.dispose();
    this.wake.dispose();
    this.particles.dispose();
    for (const v of this.visuals) v.dispose();
    this.ghost?.dispose();
    this.battle?.dispose();
    this.wildlife.dispose();
    this.shadows.dispose();
    this.aurora?.dispose();
    this.scene.clear();
  }
}
