import type { RiderLook } from '../boat/riderLook';
import { makeControls, type Controls } from '../core/types';
import { Boat } from '../boat/boat';
import type { BoatSpec } from '../boat/specs';
import type { Livery } from '../boat/livery';
import type { AIDriver } from '../ai/aiDriver';

/** A participant: boat + controls + whoever drives them + race bookkeeping. */
export class Racer {
  /** Chosen rider look (players); AI derive theirs from the livery. */
  look: RiderLook | null = null;
  readonly boat: Boat;
  readonly controls: Controls = makeControls();

  // Progress
  hint = -1;
  s = 0;
  lateral = 0;
  onShortcut = -1;
  /** Unwrapped distance along the course since the start line (negative on the grid). */
  raceDist = 0;
  maxRaceDist = -Infinity;
  /** Number of checkpoints passed (index 0 = start line crossing). */
  checkpoints = 0;
  lap = 0;
  lapStart = 0;
  lapTimes: number[] = [];
  bestLap = Infinity;
  finished = false;
  finishTime = 0;
  place = 1;
  wrongWay = false;
  wrongT = 0;
  offCourseT = 0;
  /** Seconds before an AI reacts to GO. */
  reaction = 0;
  /** Championship points this cup. */
  points = 0;
  topSpeed = 0;
  bestAir = 0;
  driftScore = 0;
  tricks = 0;
  /** Index into RIVALS (AI only, -1 for the player). */
  rivalIndex = -1;
  /** Battle items: held item and hits taken/landed. */
  item: string | null = null;
  itemHits = 0;
  /** Checkpoint respawn location. */
  respawnS = 0;

  constructor(
    readonly id: number,
    readonly name: string,
    spec: BoatSpec,
    readonly livery: Livery,
    readonly isPlayer: boolean,
    readonly ai: AIDriver | null,
  ) {
    this.boat = new Boat(spec);
  }
}
