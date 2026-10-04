/**
 * Character creator stage: the player's rider standing on a slowly turning
 * striped platform, lit like a toon portrait (warm key, cool fill, rim). The
 * rider idles (breathing, weight shifts, glances) and waves when the look
 * changes. Drag (mouse/touch) or Q/E / gamepad shoulder buttons turn it.
 *
 * Rendered by the game in place of the world while the creator is open, so it
 * costs one small scene (no ocean, no props) — cheaper than a race frame.
 */

import { AmbientLight, CanvasTexture, DirectionalLight, Group, HemisphereLight, Mesh, type MeshToonMaterial, PerspectiveCamera, Scene, SRGBColorSpace, TorusGeometry, Vector3 } from 'three';
import type { Boat } from '../boat/boat';
import type { Livery } from '../boat/livery';
import { addBoots, foothold, Rider } from '../boat/rider';
import type { RiderLook } from '../boat/riderLook';
import { addOutline, cel } from './cel';
import { GeoBuilder } from './geo';

/** The handful of boat fields the rider's pose reads, held at "idle on deck". */
function idleBoat() {
  return {
    airborne: false,
    boostLevel: 0,
    driftDir: 0,
    drifting: false,
    engine: 0,
    landStrength: 0,
    sinceLand: 5,
    trick: 'none',
    trickDir: 1,
    yawRate: 0,
    wipeout: 0,
    pitchRate: 0,
  } as unknown as Boat;
}

function backdrop() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#5fd0ff');
  gr.addColorStop(0.55, '#1f86f0');
  gr.addColorStop(1, '#0b3a9e');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class CharacterStage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 16 / 9, 0.1, 50);
  private turntable = new Group();
  private platform: Mesh;
  private ring: Mesh;
  private rider: Rider | null = null;
  private boots: Mesh | null = null;
  private boat = idleBoat();
  private t = 0;
  private wave = 0;
  /** Player-driven yaw and its velocity (drag flick). */
  yaw = -0.5;
  private yawVel = 0;
  private spinHold = 0;
  private bgTex = backdrop();

  constructor() {
    this.scene.background = this.bgTex;
    const key = new DirectionalLight(0xfff1dc, 2.2);
    key.position.set(2.5, 4, 3.5);
    const fill = new DirectionalLight(0x9fc8ff, 0.8);
    fill.position.set(-3, 1.5, 1);
    const rim = new DirectionalLight(0xffffff, 1.6);
    rim.position.set(-1, 3, -4);
    this.scene.add(key, fill, rim, new HemisphereLight(0xdff2ff, 0x2a4a7a, 0.9), new AmbientLight(0xffffff, 0.15));

    // Platform: a chunky striped puck with a glowing ring that pulses.
    const gb = new GeoBuilder();
    gb.cyl(0.95, 1.05, 0.24, '#ffffff', { y: -0.12 }, 32);
    gb.cyl(1.07, 1.1, 0.08, '#12306e', { y: -0.26 }, 32);
    for (let i = 0; i < 8; i++) gb.box(0.18, 0.02, 0.9, i % 2 ? '#ffd93a' : '#ff4f8b', { y: 0.005, ry: (i / 8) * Math.PI, z: 0 });
    gb.cyl(0.42, 0.42, 0.03, '#3fe0ff', { y: 0.01 }, 24);
    this.platform = new Mesh(gb.build(), cel('stagePlatform', { vertexColors: true, gloss: 0.6 }));
    addOutline(this.platform, 2.4);
    this.ring = new Mesh(new TorusGeometry(1.18, 0.035, 6, 48), cel('stageRing', { color: 0x9ff4ff, emissive: 0x3fe0ff, emissiveIntensity: 0.8 }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = -0.2;
    this.turntable.add(this.platform);
    this.scene.add(this.turntable, this.ring);
    this.camera.position.set(0, 1.25, 5.2);
  }

  /** (Re)build the rider for a look; `react` plays the happy wave. */
  setLook(look: RiderLook, liv: Livery, react: boolean) {
    if (this.rider) {
      this.turntable.remove(this.rider.root);
      this.rider.dispose();
    }
    if (this.boots) {
      this.turntable.remove(this.boots);
      this.boots.geometry.dispose();
    }
    const deck = 0.01;
    const hip = new Vector3(0, deck + 0.9, -0.02);
    this.rider = new Rider(liv, { hip, gripL: new Vector3(0.36, deck + 0.62, 0.12), gripR: new Vector3(-0.36, deck + 0.62, 0.12), footL: foothold(0, deck, 0), footR: foothold(1, deck, 0) }, null, look);
    const gb = new GeoBuilder();
    addBoots(gb, deck, 0, liv);
    this.boots = new Mesh(gb.build(), cel('boatParts', { vertexColors: true, gloss: 0.6 }));
    addOutline(this.boots, 2.4);
    this.turntable.add(this.rider.root, this.boots);
    if (react) this.wave = 1.6;
  }

  /** Turn by a drag delta (pixels) — flicks keep spinning a little. */
  drag(dx: number) {
    this.yaw += dx * 0.012;
    this.yawVel = dx * 0.6;
    this.spinHold = 2.5;
  }
  /** Keyboard / pad nudge in radians per second. */
  nudge(dir: number, dt: number) {
    this.yaw += dir * 2.4 * dt;
    this.spinHold = 2.5;
  }

  update(dt: number, aspect: number) {
    this.t += dt;
    this.wave = Math.max(0, this.wave - dt);
    this.spinHold = Math.max(0, this.spinHold - dt);
    // Gentle auto-turn when the player isn't steering it; flicks decay.
    this.yaw += this.yawVel * dt;
    this.yawVel *= Math.exp(-dt * 4);
    if (this.spinHold <= 0) this.yaw += dt * 0.35;
    this.turntable.rotation.y = this.yaw;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);
    (this.ring.material as MeshToonMaterial).emissiveIntensity = 0.5 + pulse * 0.6;
    this.ring.scale.setScalar(1 + pulse * 0.02);
    // Idle life: slow weight shifts and glances, fed through the normal pose system.
    const b = this.boat as unknown as Record<string, number>;
    b.yawRate = Math.sin(this.t * 0.6) * 0.5;
    if (this.rider) this.rider.update(this.boat, Math.sin(this.t * 0.37) * 0.6, dt, this.t, this.wave > 0);
    // Frame the rider to the right of the menu column.
    this.camera.aspect = aspect;
    const shift = aspect > 1.3 ? -1.05 : 0;
    this.camera.position.set(shift, 1.45, aspect > 1.3 ? 6.4 : 7.6);
    this.camera.lookAt(shift, 1.0, 0);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.rider?.dispose();
    this.boots?.geometry.dispose();
    this.platform.geometry.dispose();
    this.ring.geometry.dispose();
    this.bgTex.dispose();
  }
}
