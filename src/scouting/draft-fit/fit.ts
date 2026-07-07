import type { LeagueData, Position } from "@/shared/league-data";
import { SLOT_ELIGIBLE } from "@/shared/team-profiles";
import type { LineupSlot, NeedBucket, NeedDetail, TeamProfile } from "@/shared/team-profiles";
import type { DraftFitCell, DraftFitGrid, ProspectInfo, TeamFit } from "./types";

// PASS_CATCHER = WR + TE (no dedicated TE slot in this league).
function bucketForPosition(pos: Position): NeedBucket {
  if (pos === "QB") return "QB";
  if (pos === "RB") return "RB";
  return "PASS_CATCHER";
}

function needForBucket(needs: TeamProfile["needs"], bucket: NeedBucket): NeedDetail {
  if (bucket === "QB") return needs.qb;
  if (bucket === "RB") return needs.rb;
  return needs.passCatcher;
}

// The weakest startable slot an incoming player of this position could LEGALLY
// take. Eligibility comes from the shared SLOT_ELIGIBLE map, so a QB only sees
// QB + SUPER_FLEX, a TE never sees the pure RB or WR slots, etc. An empty slot
// reads 0 (the player starts outright). Infinity = eligible for no slot at all
// (can't crack the lineup) -> upgrade collapses to 0.
function floorForPosition(pos: Position, lineup: LineupSlot[]): number {
  let floor = Infinity;
  for (const slot of lineup) {
    const elig = SLOT_ELIGIBLE[slot.slot.toUpperCase()];
    if (!elig || !elig.includes(pos)) continue;
    if (slot.value < floor) floor = slot.value;
  }
  return floor;
}

// Every unrostered, valued player in the dictionary. Value is required, so this
// is "valued available talent" — derived straight from the bundle, no extra
// fetch. Sorted best-asset first.
function buildProspectPool(data: LeagueData): ProspectInfo[] {
  const rostered = new Set<string>();
  for (const t of data.teams) for (const id of t.playerIds) rostered.add(id);

  const pool: ProspectInfo[] = [];
  for (const p of data.players.values()) {
    if (rostered.has(p.id)) continue;
    const value = data.values.value.get(p.id);
    if (typeof value !== "number") continue;
    pool.push({
      id: p.id,
      name: p.name,
      position: p.position,
      age: p.age,
      exp: p.exp,
      isRookie: p.exp === 0,
      value,
    });
  }
  pool.sort((a, b) => b.value - a.value);
  return pool;
}

// THE KEYSTONE. For every (team x prospect) pair, three independent signals:
// NEED (from the profile), UPGRADE (value over the team's startable floor at
// that position), ASSET (raw CFC value). Nothing is multiplied into anything
// else — the POV layer decides which story a cell tells. Read a row for "our
// best fits," pivot a playerId across teams for "who covets this player."
export function computeDraftFit(data: LeagueData, profiles: TeamProfile[]): DraftFitGrid {
  const pool = buildProspectPool(data);

  const teams: TeamFit[] = profiles.map((profile) => {
    const lineup = profile.strength.lineup;
    const floors: Record<Position, number> = {
      QB: floorForPosition("QB", lineup),
      RB: floorForPosition("RB", lineup),
      WR: floorForPosition("WR", lineup),
      TE: floorForPosition("TE", lineup),
    };

    const cells: DraftFitCell[] = pool.map((prospect) => {
      const bucket = bucketForPosition(prospect.position);
      const need = needForBucket(profile.needs, bucket);
      const floor = floors[prospect.position];
      const upgrade = floor === Infinity ? 0 : Math.max(0, prospect.value - floor);
      return {
        playerId: prospect.id,
        name: prospect.name,
        position: prospect.position,
        bucket,
        asset: prospect.value,
        needScore: need.score,
        needLevel: need.level,
        upgrade,
      };
    });

    cells.sort((a, b) => b.upgrade - a.upgrade || b.asset - a.asset);

    return {
      rosterId: profile.rosterId,
      teamName: profile.teamName,
      tier: profile.tier,
      floors,
      cells,
    };
  });

  return { poolSize: pool.length, teams };
}