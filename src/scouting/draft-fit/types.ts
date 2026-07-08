import type { Position } from "@/shared/league-data";
import type { NeedBucket, NeedLevel, Tier } from "@/shared/team-profiles";

// One available player in the prospect pool — every unrostered, valued player
// in the dictionary. Value is required (a player with no CFC value can't be
// fit-scored), so this is "valued available talent," derived from LeagueData.
export type ProspectInfo = {
  id: string;
  name: string;
  position: Position;
  age: number | null;
  exp: number | null;
  isRookie: boolean;
  value: number;
};

// One (team x prospect) result — THREE INDEPENDENT SIGNALS, never blended:
//   need    — league-relative room weakness at the prospect's bucket
//   upgrade — value over the team's startable floor at the prospect's position
//             (0 = the player wouldn't crack the lineup; a depth piece)
//   asset   — raw CFC value, the best-player-available read
// The POV layer decides which story each cell tells (fills a hole / starts now
// / take the asset anyway). Need and upgrade stay separate on purpose.
// Roster-relative role: where an incoming player would land on THIS team's depth
// chart at his position. STARTER = would crack the lineup (value over floor);
// IN_ROTATION = within striking distance of the floor (a real depth / injury
// piece); BACKUP = well below the floor (wouldn't see the field). Measured
// against the team's own startable floor, NOT a global value cutoff — so a
// prospect can't be "in rotation" for a team already stacked at his position.
export type Role = "STARTER" | "IN_ROTATION" | "BACKUP";

export type DraftFitCell = {
  playerId: string;
  name: string;
  position: Position;
  bucket: NeedBucket;
  asset: number;
  needScore: number; // 0..1, 1 = league-worst room
  needLevel: NeedLevel;
  upgrade: number; // value over the position floor, never below 0
  role: Role; // roster-relative depth-chart slot at this position
};

// One team's full read over the pool. floors[pos] is the weakest startable slot
// an incoming player of that position could legally take — the threshold a
// prospect must beat to register any upgrade. cells are sorted upgrade-first.
export type TeamFit = {
  rosterId: string;
  teamName: string;
  tier: Tier;
  floors: Record<Position, number>;
  cells: DraftFitCell[];
};

// The whole grid. A ROW (one TeamFit) = "our best fits"; a COLUMN (one playerId
// across teams) = "who covets this player" (trade-partner intel). One
// computation, both views.
export type DraftFitGrid = {
  poolSize: number;
  teams: TeamFit[];
};