import type { Position, RosteredTeam, ValueMaps, SeasonResult } from "@/shared/league-data";
import type { StrengthBreakdown, ProductionBreakdown, LineupSlot, NeedBucket } from "./types";

// Light credit for bench depth — it's trade currency / injury insurance, not a
// measure of how good you are right now. Tunable.
const DEPTH_FACTOR = 0.1;

// Which positions can fill each starting slot. Slots not listed (BN, IR, TAXI,
// K, DEF, DST) are not starting spots and are skipped. Exported because the
// scouting draft-fit layer reads the SAME eligibility truth to decide whether
// an incoming player could legally start (and thus upgrade) a team's lineup —
// one source of truth, no duplicate map drifting out of sync.
export const SLOT_ELIGIBLE: Record<string, Position[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  WRRB: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  SUPERFLEX: ["QB", "RB", "WR", "TE"],
  SUPER_FLX: ["QB", "RB", "WR", "TE"],
  QB_FLEX: ["QB", "RB", "WR", "TE"],
};

function bucketOf(pos: Position): NeedBucket {
  if (pos === "QB") return "QB";
  if (pos === "RB") return "RB";
  return "PASS_CATCHER";
}

type Candidate = {
  id: string;
  name: string;
  position: Position;
  age: number | null;
  value: number;
};

// Build the best legal starting lineup from the real roster slots, fill it
// greedily most-restrictive-slot first, and sum its CFC value.
export function computeStrength(
  team: RosteredTeam,
  values: ValueMaps,
  rosterPositions: string[]
): StrengthBreakdown {
  const cands: Candidate[] = team.players.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    age: p.age,
    value: values.value.get(p.id) ?? 0,
  }));

  // Starting slots only, restrictive ones first so dedicated spots claim their
  // best option before FLEX / SUPER_FLEX get the leftovers.
  const slots = rosterPositions
    .map((slot) => ({ slot, elig: SLOT_ELIGIBLE[slot.toUpperCase()] }))
    .filter((s): s is { slot: string; elig: Position[] } => Array.isArray(s.elig))
    .sort((a, b) => a.elig.length - b.elig.length);

  const used = new Set<string>();
  const lineup: LineupSlot[] = [];
  for (const { slot, elig } of slots) {
    let best: Candidate | null = null;
    for (const c of cands) {
      if (used.has(c.id)) continue;
      if (!elig.includes(c.position)) continue;
      if (!best || c.value > best.value) best = c;
    }
    if (best) {
      used.add(best.id);
      lineup.push({ slot, playerId: best.id, name: best.name, position: best.position, value: best.value });
    } else {
      lineup.push({ slot, playerId: null, name: null, position: null, value: 0 });
    }
  }

  const starterValueRaw = lineup.reduce((s, l) => s + l.value, 0);
  let benchValue = 0;
  for (const c of cands) if (!used.has(c.id)) benchValue += c.value;
  const depthBonus = benchValue * DEPTH_FACTOR;

  // Ages: overall average + per-bucket average, both from the starters only.
  const ages: number[] = [];
  const bucketAges: Record<NeedBucket, number[]> = { QB: [], RB: [], PASS_CATCHER: [] };
  for (const l of lineup) {
    if (!l.playerId || l.position == null) continue;
    const c = cands.find((x) => x.id === l.playerId);
    if (!c || c.age == null) continue;
    ages.push(c.age);
    bucketAges[bucketOf(c.position)].push(c.age);
  }
  const avg = (arr: number[]): number | null =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    lineup,
    starterValueRaw,
    benchValue,
    depthBonus,
    starterValue: starterValueRaw + depthBonus,
    avgStarterAge: avg(ages),
    bucketAge: {
      QB: avg(bucketAges.QB),
      RB: avg(bucketAges.RB),
      PASS_CATCHER: avg(bucketAges.PASS_CATCHER),
    },
  };
}

export function computeProduction(result: SeasonResult | undefined): ProductionBreakdown {
  const wins = result?.wins ?? 0;
  const losses = result?.losses ?? 0;
  const ties = result?.ties ?? 0;
  const games = wins + losses + ties;
  return {
    points: result?.points ?? 0,
    wins,
    losses,
    ties,
    winPct: games > 0 ? (wins + 0.5 * ties) / games : null,
  };
}