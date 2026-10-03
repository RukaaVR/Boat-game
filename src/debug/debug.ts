/**
 * ?debug=1 overlay: live performance and simulation numbers plus toggles that
 * are genuinely useful while tuning (time scale, autopilot, post, outlines,
 * HUD, weather cycling, wireframe ocean, free AI kill switch).
 */

import type { Game } from '../core/game';
import type { GameEvent } from '../core/events';
import { oceanHeight, getSeaState } from '../water/waves';
import { celShared } from '../render/cel';
import { WEATHER_IDS } from '../environment/weatherDefs';
import type { ShaderMaterial } from 'three';

export class DebugOverlay {
  private el: HTMLElement;
  private text: HTMLElement;
  private t = 0;
  private evCount = 0;
  private lastEvent = '';
  private weatherIdx = 0;
  timeScale = 1;

  constructor(
    private game: Game,
    parent: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'debug';
    this.text = document.createElement('div');
    this.el.appendChild(this.text);
    const btns: [string, () => void][] = [
      ['autopilot', () => game.session && (game.session.playerAutopilot = !game.session.playerAutopilot)],
      ['slow-mo', () => game.session && (game.session.timeScale = game.session.timeScale === 1 ? 0.25 : 1)],
      ['bloom', () => (game.renderer.bloomEnabled = !game.renderer.bloomEnabled)],
      ['outlines', () => (celShared.uOutlineScale.value = celShared.uOutlineScale.value > 0 ? 0 : game.renderer.pixelRatio)],
      ['hud', () => (game.ui.style.visibility = game.ui.style.visibility === 'hidden' ? '' : 'hidden')],
      ['weather', () => game.world?.applyWeather(WEATHER_IDS[++this.weatherIdx % WEATHER_IDS.length])],
      ['wire', () => {
        const m = game.world?.ocean.material as ShaderMaterial | undefined;
        if (m) m.wireframe = !m.wireframe;
      }],
      ['nitro', () => game.session && (game.session.player.boat.nitro = 1)],
      ['respawn', () => game.session && game.session.respawn(game.session.player)],
      ['adaptive-res', () => (game.renderer.adaptive = !game.renderer.adaptive)],
    ];
    const row = document.createElement('div');
    for (const [label, fn] of btns) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      row.appendChild(b);
    }
    this.el.appendChild(row);
    parent.appendChild(this.el);
  }

  onEvent(e: GameEvent) {
    this.evCount++;
    if (e.racer === 0 || e.racer === -1) this.lastEvent = `${e.type}${e.text ? ':' + e.text : ''} ${e.value.toFixed(2)}`;
  }

  update(dt: number) {
    this.t += dt;
    if (this.t < 0.2) return;
    this.t = 0;
    const g = this.game;
    const r = g.renderer.stats;
    const s = g.session;
    const p = s?.player;
    const b = p?.boat;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const lines = [
      `FPS ${r.fps.toFixed(0).padStart(3)}  frame ${r.frameMs.toFixed(2)} ms  median ${r.medianMs.toFixed(2)} ms`,
      `draw calls ${r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k  dpr ${g.renderer.pixelRatio.toFixed(2)}${g.renderer.adaptive ? ' (auto)' : ''}  q=${g.renderer.quality}`,
      `heap ${mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) + ' MB' : 'n/a'}  geoms ${g.renderer.gl.info.memory.geometries} tex ${g.renderer.gl.info.memory.textures}`,
      `particles ${g.world?.particles.active ?? 0}  sea ${getSeaState().toFixed(2)}  state ${g.state}/${s?.phase ?? '-'}`,
    ];
    if (s && p && b) {
      const surf = oceanHeight(b.position.x, b.position.z, s.time);
      lines.push(
        `speed ${(b.speed * 3.6).toFixed(0)} km/h  fwd ${b.forwardSpeed.toFixed(1)}  slip ${(b.slip * 57.3).toFixed(0)}°  rpm ${b.rpm.toFixed(2)}`,
        `lap ${p.lap}/${s.totalLaps}  cp ${p.checkpoints}  place ${p.place}  dist ${p.raceDist.toFixed(0)}  lat ${p.lateral.toFixed(1)}${p.onShortcut >= 0 ? ' SHORTCUT' : ''}`,
        `y ${b.position.y.toFixed(2)}  wave ${surf.toFixed(2)}  clear ${b.clearance.toFixed(2)}  wet ${b.wet.toFixed(2)}  ${b.airborne ? 'AIR ' + b.airTime.toFixed(2) : 'water'}`,
        `pitch ${(b.pitch * 57.3).toFixed(0)}° roll ${(b.roll * 57.3).toFixed(0)}°  drift ${b.drifting ? 'T' + b.driftTier + ' ' + b.driftCharge.toFixed(1) : '-'}  boost ${b.boostLevel.toFixed(2)} nitro ${b.nitro.toFixed(2)}`,
        `trick ${b.trick}  wipeout ${b.wipeout.toFixed(1)}  draft ${b.draft.toFixed(2)}  autopilot ${s.playerAutopilot}`,
        `events ${this.evCount}  last ${this.lastEvent}`,
      );
    }
    this.text.textContent = lines.join('\n');
  }
}
