import type { Position, RosteredTeam, ValueMaps, SeasonResult } from "@/shared/league-data";
import type { StrengthBreakdown, ProductionBreakdown, LineupSlot } from "./types";

// Light credit for bench depth — it's trade currency / injury insurance, not a
// measure of how good you are right now. Tunable.
const DEPTH_FACTOR = 0.1;

// Which positions can fill each starting slot. Slots not listed (BN, IR, TAXI,
// K, DEF, DST) are not starting spots and are skipped.
//
// EXPORTED: this is the single source of truth for slot eligibility. The
// slot-aware depth-cliff logic (team-narratives/cliff.ts) reads the same map
// so it can never drift from how the optimal lineup is actually built.
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

// Eligible positions for a given slot name, or null if the slot isn't a
// starting spot (BN/IR/TAXI/K/DEF/etc.). Tolerant of case.
export function slotEligibility(slot: string): Position[] | null {
  return SLOT_ELIGIBLE[(slot ?? "").toUpperCase()] ?? null;
}

// The starting slots from a rosterPositions config, most-restrictive first —
// the same ordering computeStrength uses to fill greedily. Exposed so the
// cliff logic builds the identical slot list.
export function startingSlots(
  rosterPositions: string[]
): Array<{ slot: string; elig: Position[] }> {
  return rosterPositions
    .map((slot) => ({ slot, elig: slotEligibility(slot) }))
    .filter((s): s is { slot: string; elig: Position[] } => Array.isArray(s.elig))
    .sort((a, b) => a.elig.length - b.elig.length);
}

type Candidate = {
  id: string;
  name: string;
  position: Position;
  age: number | null;
  value: number;
};

// Build the best legal starting lineup from a candidate pool, filling the
// most-restrictive slot first so dedicated spots claim their best option
// before FLEX / SUPER_FLEX get the leftovers. Pure helper shared by
// computeStrength and the cliff recompute.
export function fillLineup(
  cands: Candidate[],
  slots: Array<{ slot: string; elig: Position[] }>
): { lineup: LineupSlot[]; used: Set<string> } {
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
  return { lineup, used };
}

// Candidate pool from a roster — exported so the cliff logic can rebuild the
// pool minus a dropped player and recompute the optimal lineup.
export function candidatesFor(team: RosteredTeam, values: ValueMaps): Candidate[] {
  return team.players.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    age: p.age,
    value: values.value.get(p.id) ?? 0,
  }));
}

// Build the best legal starting lineup from the real roster slots, fill it
// greedily most-restrictive-slot first, and sum its CFC value.
export function computeStrength(
  team: RosteredTeam,
  values: ValueMaps,
  rosterPositions: string[]
): StrengthBreakdown {
  const cands = candidatesFor(team, values);
  const slots = startingSlots(rosterPositions);
  const { lineup, used } = fillLineup(cands, slots);

  const starterValueRaw = lineup.reduce((s, l) => s + l.value, 0);
  let benchValue = 0;
  for (const c of cands) if (!used.has(c.id)) benchValue += c.value;
  const depthBonus = benchValue * DEPTH_FACTOR;

  const ages: number[] = [];
  for (const l of lineup) {
    if (!l.playerId) continue;
    const c = cands.find((x) => x.id === l.playerId);
    if (c && c.age != null) ages.push(c.age);
  }
  const avgStarterAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;

  return {
    lineup,
    starterValueRaw,
    benchValue,
    depthBonus,
    starterValue: starterValueRaw + depthBonus,
    avgStarterAge,
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