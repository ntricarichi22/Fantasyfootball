import type { LeagueData, Position, RosteredTeam } from "@/shared/league-data";
import type { NeedBucket, TeamProfile } from "@/shared/team-profiles";
import type { SuccessorPressure } from "./types";

// ── curation weight ─────────────────────────────────────────────────────────
// How much a team's board overrides the signals. The untouched board IS the
// consensus value order (that's what the auto-seed produces), so divergence
// from consensus is the evidence of real curation — nothing manual to track.
const TOP_WINDOW = 24; // ~first two rounds — where curation actually matters
const DISPLACEMENT_W = 0.7; // weight on reordering
const STAR_W = 0.3; // weight on starring
const NEAR_PICK_RADIUS = 6; // a star within this many board slots of the pick = conviction
const STAR_SATURATION = 5; // this many stars saturates the count signal

// 0..1. Identical-to-consensus order with no stars => 0. Heavy reorder near the
// top + stars by the pick => approaches 1.
export function computeCuration(
  order: string[],
  consensus: string[],
  starred: string[],
  pickOverall: number | null
): number {
  const k = Math.min(TOP_WINDOW, consensus.length);
  if (k === 0) return 0;

  const consIdx = new Map<string, number>();
  consensus.forEach((id, i) => consIdx.set(id, i));

  // Displacement: average absolute move of the players sitting in the team's
  // top-k vs. where consensus would have them. Normalized so an average move of
  // k/2 reads as a fully reshuffled top => 1.0.
  let move = 0;
  for (let i = 0; i < k; i++) {
    const id = order[i];
    const ci = consIdx.get(id);
    move += ci == null ? k : Math.abs(ci - i);
  }
  const displacement = Math.min(1, move / k / (k / 2));

  // Stars: count (saturating) plus a hard bump if any star sits near the pick.
  let starSignal = 0;
  if (starred.length) {
    const base = Math.min(1, starred.length / STAR_SATURATION);
    let near = 0;
    if (pickOverall != null) {
      for (const id of starred) {
        const ci = consIdx.get(id);
        if (ci != null && Math.abs(ci - (pickOverall - 1)) <= NEAR_PICK_RADIUS) {
          near = 1;
          break;
        }
      }
    }
    starSignal = Math.min(1, 0.6 * base + 0.4 * near);
  }

  return Math.min(1, DISPLACEMENT_W * displacement + STAR_W * starSignal);
}

// ── successor pressure ───────────────────────────────────────────────────────
const AGE_OLD = 28; // a starting unit at/above this is aging
const AGE_STEEP = 31; // at/above this, the cliff is steep -> max pressure
const YOUNG_SUCCESSOR_AGE = 24; // a benched player at/below this can dampen pressure
const SUCCESSOR_VALUE_FLOOR = 40; // ...if he carries at least this much value

function bucketOf(pos: Position): NeedBucket {
  if (pos === "QB") return "QB";
  if (pos === "RB") return "RB";
  return "PASS_CATCHER";
}

// 0..1 per bucket. High when the starting unit is old AND no young, valued heir
// already sits on the bench. An old starter with a stud rookie behind him is
// NOT a successor target — that's the bench-dampening that keeps it honest.
export function computeSuccessorPressure(
  profile: TeamProfile,
  team: RosteredTeam,
  data: LeagueData
): SuccessorPressure {
  const starterIds = new Set(
    profile.strength.lineup.map((l) => l.playerId).filter((x): x is string => !!x)
  );
  const valueOf = (id: string) => data.values.value.get(id) ?? 0;

  const benchYoung: Record<NeedBucket, boolean> = { QB: false, RB: false, PASS_CATCHER: false };
  for (const p of team.players) {
    if (starterIds.has(p.id)) continue;
    if (p.age == null || p.age > YOUNG_SUCCESSOR_AGE) continue;
    if (valueOf(p.id) < SUCCESSOR_VALUE_FLOOR) continue;
    benchYoung[bucketOf(p.position)] = true;
  }

  const ageOf = profile.strength.bucketAge;
  const pressureFor = (b: NeedBucket): number => {
    const age = ageOf[b];
    if (age == null) return 0; // no starter in this bucket
    if (benchYoung[b]) return 0; // young heir already in house
    if (age >= AGE_STEEP) return 1;
    if (age >= AGE_OLD) return (age - AGE_OLD) / (AGE_STEEP - AGE_OLD);
    return 0;
  };

  return {
    QB: pressureFor("QB"),
    RB: pressureFor("RB"),
    PASS_CATCHER: pressureFor("PASS_CATCHER"),
  };
}