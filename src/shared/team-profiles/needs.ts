import type { LeagueData, MarketStance, PlayerInfo, StrategyProfile } from "@/shared/league-data";
import type { NeedBucket, NeedDetail, NeedLevel, TeamNeeds } from "./types";

// ── tunable knobs (calibrate against /api/league/needs, not blind) ──────────
const STARTER_WEIGHT = 0.55; // weak starting unit drives most of the need
const DEPTH_WEIGHT = 0.15; // thin depth behind the starters adds to it
const AGE_WEIGHT = 0.15; // aging unit raises need, young suppresses
const MARKET_WEIGHT = 0.15; // stated buy raises, sell lowers (dormant pre-launch)
const AGE_OLD = 28.0; // mirror the profiler's thresholds
const AGE_YOUNG = 25.5;
const LEVEL_HIGH = 0.6; // score >= -> high
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

// QB -> qbMarket, RB -> rbMarket, pass catcher -> pcMarket (the merged WR/TE
// market). All "hold"/"unknown" pre-launch, so this is dormant but wired.
function marketFor(bucket: NeedBucket, strat: StrategyProfile | undefined): MarketStance {
  if (!strat) return "unknown";
  if (bucket === "QB") return strat.qbMarket;
  if (bucket === "RB") return strat.rbMarket;
  return strat.pcMarket;
}

function marketSignal(m: MarketStance): number {
  if (m === "buy") return 1;
  if (m === "sell") return -1;
  return 0;
}

function ageSignal(avg: number | null): number {
  if (avg == null) return 0;
  if (avg >= AGE_OLD) return 1; // aging unit -> emerging need
  if (avg <= AGE_YOUNG) return -1; // young unit -> need suppressed
  return 0;
}

function levelFor(score: number): NeedLevel {
  if (score >= LEVEL_HIGH) return "high";
  if (score >= LEVEL_MED) return "med";
  return "low";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

type BucketRaw = { starterValue: number; depthValue: number; avgAge: number | null };

// One team's raw numbers for a bucket: combined value of the starting unit
// (top K by value), the depth man's value (the K+1th), and the starting unit's
// average age. Reframes roster facts only — computes no new ranking.
function rawForBucket(
  players: PlayerInfo[],
  valueOf: (id: string) => number,
  bucket: NeedBucket
): BucketRaw {
  const k = STARTERS[bucket];
  const ranked = players
    .filter((p) => inBucket(p.position, bucket))
    .map((p) => ({ value: valueOf(p.id), age: p.age }))
    .sort((a, b) => b.value - a.value);
  const starters = ranked.slice(0, k);
  const starterValue = starters.reduce((s, x) => s + x.value, 0);
  const depthValue = ranked[k]?.value ?? 0;
  const ages = starters.map((x) => x.age).filter((a): a is number => a != null);
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
  return { starterValue, depthValue, avgAge };
}

// League-relative team needs, per bucket. Need is the inverse of how a team's
// starting unit + depth stack up against the other 11, nudged by the unit's
// age and the team's stated market. Score 0..1, 1 = highest need. Returns a
// map keyed by rosterId so the profiler can bake it onto each TeamProfile.
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
    const strat = data.strategy.get(team.rosterId);
    const detail = (bucket: NeedBucket): NeedDetail => {
      const starterNorm = starterNorms[bucket][i];
      const depthNorm = depthNorms[bucket][i];
      const aSig = ageSignal(raw[bucket][i].avgAge);
      const market = marketFor(bucket, strat);
      const score = clamp01(
        STARTER_WEIGHT * (1 - starterNorm) +
          DEPTH_WEIGHT * (1 - depthNorm) +
          AGE_WEIGHT * aSig +
          MARKET_WEIGHT * marketSignal(market)
      );
      return { bucket, starterNorm, depthNorm, ageSignal: aSig, market, score, level: levelFor(score) };
    };
    out.set(team.rosterId, {
      qb: detail("QB"),
      rb: detail("RB"),
      passCatcher: detail("PASS_CATCHER"),
    });
  });

  return out;
}