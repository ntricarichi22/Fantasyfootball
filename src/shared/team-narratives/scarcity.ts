import type { LeagueData } from "@/shared/league-data";
import type { NeedBucket } from "@/shared/team-profiles";
import { bucketOf } from "@/shared/team-profiles";
import { startsForAtLeast } from "./cliff";

// ── Real-hole validation (replaces the old "phantom" machinery) ──────────────
//
// A loud need dial doesn't prove a hole. This is the single, plainly-stated
// test: a need is a REAL hole only if the team CANNOT field its required
// starters at the bucket from bodies that each pass the start-for test (would
// start for >= 1 other team). If it can, the position is merely "not elite,"
// not genuinely thin — e.g. two startable QBs in superflex is not a QB hole
// even when the dial reads high. The old depth-behind-studs correction folds in
// for free: studs start for many teams, so they satisfy the requirement and the
// cliff behind them never plays.

// Base starter requirement per bucket (QB2 / RB2 / PC4). FLEX is bonus
// capacity, not a fixed slot, so it doesn't bump these.
export const STARTER_COUNTS: Record<NeedBucket, number> = {
  QB: 2,
  RB: 2,
  PASS_CATCHER: 4,
};

export function isRealHole(bucket: NeedBucket, rosterId: string, data: LeagueData): boolean {
  const team = data.teams.find((t) => t.rosterId === rosterId);
  if (!team) return false;
  const required = STARTER_COUNTS[bucket];

  // Bodies at this bucket, best value first.
  const bodies = team.players
    .filter((p) => bucketOf(p.position) === bucket)
    .map((p) => ({ p, v: data.values.value.get(p.id) ?? 0 }))
    .sort((a, b) => b.v - a.v);

  // How many of the top bodies would start for >= 1 OTHER team?
  let startable = 0;
  for (const { p, v } of bodies) {
    if (startsForAtLeast(p.id, p.position, v, rosterId, data, 1)) startable++;
    if (startable >= required) break;
  }

  // Can field the required startable starters -> NOT a real hole.
  return startable < required;
}