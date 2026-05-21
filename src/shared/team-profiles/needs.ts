import type { LeagueData, PlayerInfo } from "@/shared/league-data";
import type { NeedBucket, NeedDetail, NeedLevel, TeamNeeds } from "./types";

// ── tunable knobs (calibrate against /api/league/needs, not blind) ──────────
// Need is PURE roster truth: how a team's starting unit + depth rank against
// the league. No age (already in value) and no market/posture (belongs to the
// trade engine + scouting POV). Weights sum to 1, so the score uses the full
// 0..1 range: league-worst unit = 1.0, league-best = 0.
const STARTER_WEIGHT = 0.75; // the starting unit dominates
const DEPTH_WEIGHT = 0.25; // the depth man (injury insurance / trade currency)
const LEVEL_HIGH = 0.7; // score >= -> high
const LEVEL_MED = 0.34; // score >= -> med, else low

// Starter unit size per bucket; the depth man is the next one (QB3 / RB3 / PC5).
const STARTERS: Record<NeedBucket, number> = { QB: 2, RB: 2, PASS_CATCHER: 4 };
const BUCKETS: NeedBucket[] = ["QB", "RB", "PASS_CATCHER"];

// PASS_CATCHER = WR + TE (no dedicated TE slot in this league).
function inBucket(pos: PlayerInfo["position"], bucket: NeedBucket): boolean {
  if (bucket === "QB") return pos === "QB";
  if (bucket === "RB") return pos === "RB";
  return pos === "WR" || pos === "TE";
}

function minMax(values: number[]): number[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

function levelFor(score: number): NeedLevel {
  if (score >= LEVEL_HIGH) return "high";
  if (score >= LEVEL_MED) return "med";
  return "low";
}

type BucketRaw = { starterValue: number; depthValue: number };

// One team's raw numbers for a bucket: combined value of the starting unit
// (top K by value) and the depth man's value (the K+1th). Reframes roster
// facts only — computes no new ranking, applies no age or posture.
function rawForBucket(
  players: PlayerInfo[],
  valueOf: (id: string) => number,
  bucket: NeedBucket
): BucketRaw {
  const k = STARTERS[bucket];
  const ranked = players
    .filter((p) => inBucket(p.position, bucket))
    .map((p) => valueOf(p.id))
    .sort((a, b) => b - a);
  const starterValue = ranked.slice(0, k).reduce((s, v) => s + v, 0);
  const depthValue = ranked[k] ?? 0;
  return { starterValue, depthValue };
}

// League-relative team needs, per bucket. Need is the inverse of how a team's
// starting unit + depth stack up against the other 11. Score 0..1, 1 = highest
// need (league-worst unit). Returns a map keyed by rosterId so the profiler can
// bake it onto each TeamProfile.
export function computeNeeds(data: LeagueData): Map<string, TeamNeeds> {
  const teams = data.teams;
  const valueOf = (id: string) => data.values.value.get(id) ?? 0;

  const raw: Record<NeedBucket, BucketRaw[]> = { QB: [], RB: [], PASS_CATCHER: [] };
  const starterNorms: Record<NeedBucket, number[]> = { QB: [], RB: [], PASS_CATCHER: [] };
  const depthNorms: Record<NeedBucket, number[]> = { QB: [], RB: [], PASS_CATCHER: [] };
  for (const bucket of BUCKETS) {
    raw[bucket] = teams.map((t) => rawForBucket(t.players, valueOf, bucket));
    starterNorms[bucket] = minMax(raw[bucket].map((r) => r.starterValue));
    depthNorms[bucket] = minMax(raw[bucket].map((r) => r.depthValue));
  }

  const out = new Map<string, TeamNeeds>();
  teams.forEach((team, i) => {
    const detail = (bucket: NeedBucket): NeedDetail => {
      const starterNorm = starterNorms[bucket][i];
      const depthNorm = depthNorms[bucket][i];
      const score = STARTER_WEIGHT * (1 - starterNorm) + DEPTH_WEIGHT * (1 - depthNorm);
      return { bucket, starterNorm, depthNorm, score, level: levelFor(score) };
    };
    out.set(team.rosterId, {
      qb: detail("QB"),
      rb: detail("RB"),
      passCatcher: detail("PASS_CATCHER"),
    });
  });

  return out;
}