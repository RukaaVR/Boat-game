/**
 * Leaderboard interface layer.
 *
 * RIPTIDE has no backend. Everything here is designed so a server can be
 * added later behind `LeaderboardProvider` (global / daily / weekly / friends
 * rankings, top 100, ghost downloads) without touching the UI code — but the
 * only implementation that exists is LOCAL: it ranks the times stored on
 * this device (your records and ghosts, plus friends' ghosts you imported by
 * code). The UI always shows the provider's label, so local data is never
 * presented as global.
 */

import type { SaveData } from '../save/save';

export type BoardScope = 'local' | 'global' | 'daily' | 'weekly' | 'friends';

export interface BoardEntry {
  name: string;
  /** Lap time in seconds. */
  time: number;
  boatId: string;
  /** Where the entry came from (for honest labelling). */
  source: 'you' | 'ghost' | 'imported';
}

export interface LeaderboardProvider {
  /** Shown next to every board, e.g. "LOCAL · THIS DEVICE". */
  readonly label: string;
  /** Scopes this provider can actually serve. */
  readonly scopes: BoardScope[];
  /** Best laps for a track, fastest first. */
  bestLaps(trackId: string, scope: BoardScope, limit?: number): Promise<BoardEntry[]>;
}

/** Offline provider: ranks what is stored in the save on this device. */
export class LocalLeaderboard implements LeaderboardProvider {
  readonly label = 'LOCAL · THIS DEVICE';
  readonly scopes: BoardScope[] = ['local'];
  constructor(private data: () => SaveData) {}

  async bestLaps(trackId: string, scope: BoardScope, limit = 10): Promise<BoardEntry[]> {
    if (scope !== 'local') return [];
    const d = this.data();
    const out: BoardEntry[] = [];
    const lap = d.records[trackId]?.lap;
    const mine = d.ghosts[trackId];
    if (mine) out.push({ name: d.playerName, time: mine.time, boatId: mine.boatId, source: 'ghost' });
    else if (lap) out.push({ name: d.playerName, time: lap, boatId: d.selectedBoat, source: 'you' });
    const rival = d.rivalGhosts[trackId];
    if (rival) out.push({ name: rival.name ?? 'RIVAL', time: rival.time, boatId: rival.boatId, source: 'imported' });
    return out.sort((a, b) => a.time - b.time).slice(0, limit);
  }
}
