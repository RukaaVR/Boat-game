/**
 * Simulation → presentation event queue.
 *
 * The simulation never calls audio, particles, the camera or the HUD directly.
 * It pushes events here; each presentation system drains the queue once per
 * frame. That keeps the sim free of rendering dependencies and makes the
 * harness able to run it headless.
 */

export type GameEventType =
  | 'splash' // hull slap / heavy water contact; strength 0..1 (text 'hop' = drift hop)
  | 'land' // touchdown after air; strength 0..1, flag = clean
  | 'wipeout'
  | 'collide' // boat/boat or boat/static; strength 0..1
  | 'buoyHit'
  | 'driftTier' // value = tier reached
  | 'driftStart' // hull snapped into a slide; value = drift direction (±1)
  | 'waveLand' // landed a WAVE FLIP off a natural crest; value = boost seconds
  | 'boostStart' // value = tier / strength
  | 'nitro' // nitro activated
  | 'trick' // value = trick id, text = name
  | 'launch' // left ramp / crest
  | 'checkpoint'
  | 'lap' // value = lap reached
  | 'finalLap'
  | 'finish' // racer finished
  | 'wrongWay'
  | 'countdown' // value = 3,2,1,0(GO)
  | 'falseStart'
  | 'perfectStart'
  | 'overtake' // player gained a position
  | 'lightning'
  | 'ring' // stunt ring collected
  | 'boostPad'
  | 'reset' // racer respawned on track
  | 'shieldHit' // a shield absorbed a hit
  | 'itemPickup' // battle item box; text = item id
  | 'itemUse' // text = item id
  | 'itemHit' // racer hit by a battle item; text = item id
  | 'itemReady' // roulette finished; text = item id
  | 'itemDenied' // item pressed with nothing usable (empty, rolling, wiped out)
  | 'itemLock' // seeker lock beep on racer; value = urgency 0..1, text = 'start' on first lock
  | 'itemMiss' // text = 'dodge' (target evaded a seeker) or 'miss' (owner's shot expired)
  | 'collectible' // hidden bottle found; value = index
  | 'weatherShift' // mid-race weather change; text = new weather id
  | 'eliminated'; // battle: racer lost their last life

export interface GameEvent {
  type: GameEventType;
  racer: number; // racer id, -1 for global
  x: number;
  y: number;
  z: number;
  value: number;
  text: string;
}

export class EventQueue {
  readonly list: GameEvent[] = [];
  private pool: GameEvent[] = [];

  push(type: GameEventType, racer = -1, x = 0, y = 0, z = 0, value = 0, text = '') {
    const e = this.pool.pop() ?? { type, racer, x, y, z, value, text };
    e.type = type;
    e.racer = racer;
    e.x = x;
    e.y = y;
    e.z = z;
    e.value = value;
    e.text = text;
    this.list.push(e);
    return e;
  }

  /** Called once per frame after every consumer has read `list`. */
  clear() {
    for (let i = 0; i < this.list.length; i++) this.pool.push(this.list[i]);
    this.list.length = 0;
  }
}
