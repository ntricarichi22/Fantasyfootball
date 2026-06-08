import type { LeagueData } from "@/shared/league-data";
import type { NeedBucket } from "./types";
import { bucketOf } from "./buckets";

// ── League-relative value ranks ──────────────────────────────────────────────
//
// Two bars, both read off ONE league-wide value ranking per bucket:
//   • IMPACT_TOPN — the top end: top-20 QB/RB, top-40 pass-catcher. A keeper by
//     value/role, and the bar an acquire target must clear.
//   • SCRUB_RANK_FLOOR — the bottom end: a QB outside the top 35, an RB outside
//     the top 40, a pass-catcher outside the top 75. Deep-bench bodies with no
//     trade market; they never fund a deal as a makeweight (picks do that job).
// These live in team-profiles because both the matcher and the brain depend on
// it already (bucketOf / NeedBucket) and neither may import the other (cycle).
// The brain READS these sets; it never recomputes them elsewhere.
export const IMPACT_TOPN: Record<NeedBucket, number> = { QB: 20, RB: 20, PASS_CATCHER: 40 };
export const SCRUB_RANK_FLOOR: Record<NeedBucket, number> = { QB: 35, RB: 40, PASS_CATCHER: 80 };

export type ImpactSets = Map<NeedBucket, Set<string>>;
export type ScrubSets = Map<NeedBucket, Set<string>>;

// League players bucketed and sorted by value (desc) — the one ranking both bars
// read. Built once; sliced two ways.
function rankByBucket(data: LeagueData): Map<NeedBucket, string[]> {
  const byBucket = new Map<NeedBucket, Array<{ id: string; v: number }>>();
  for (const t of data.teams) {
    for (const pid of t.playerIds) {
      const p = data.players.get(pid);
      if (!p) continue;
      const b = bucketOf(p.position);
      if (!b) continue;
      const arr = byBucket.get(b) ?? [];
      arr.push({ id: pid, v: data.values.value.get(pid) ?? 0 });
      byBucket.set(b, arr);
    }
  }
  const out = new Map<NeedBucket, string[]>();
  for (const [b, arr] of byBucket) {
    arr.sort((x, y) => y.v - x.v);
    out.set(b, arr.map((x) => x.id));
  }
  return out;
}

// The league top-N impact set per bucket. A player is "impact" if he's top-N by
// value at his bucket.
export function buildImpactSets(data: LeagueData): ImpactSets {
  const out: ImpactSets = new Map();
  for (const [b, ids] of rankByBucket(data)) {
    out.set(b, new Set(ids.slice(0, IMPACT_TOPN[b])));
  }
  return out;
}

// The league scrub set per bucket: players ranked beyond the position's startable
// depth (QB > 35, RB > 40, PC > 75). A "scrub" by league-relative value rank — a
// dead-weight body, never an auto-balancer makeweight.
export function buildScrubSets(data: LeagueData): ScrubSets {
  const out: ScrubSets = new Map();
  for (const [b, ids] of rankByBucket(data)) {
    out.set(b, new Set(ids.slice(SCRUB_RANK_FLOOR[b])));
  }
  return out;
}
