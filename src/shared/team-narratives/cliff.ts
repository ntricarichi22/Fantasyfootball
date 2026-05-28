import type { LeagueData, Position, RosteredTeam } from "@/shared/league-data";
import {
  startingSlots,
  fillLineup,
  candidatesFor,
} from "@/shared/team-profiles";

// ── Slot-aware depth-cliff detection ──────────────────────────────────────
//
// The position-dial approach to depth (depthNorm < 0.25 at a bucket) over-fires
// because it ignores the lineup's actual slot structure. A thin 3rd RB doesn't
// matter if your pass-catchers are deep enough to win the FLEX slots — RB only
// has to fill one dedicated slot. The real question is: if a starter goes down,
// does the OPTIMAL LINEUP crater, accounting for who backfills the flex?
//
// And it's not enough to survive ONE loss — bye weeks plus injuries overlap, so
// a team needs roughly a 2-deep cushion to be genuinely safe. See trade_brain
// discussion (slot-aware cliff, 2-deep cushion).
//
// Method, per starting slot:
//   1. Take the optimal lineup's player in that slot.
//   2. Drop him, recompute the optimal lineup from the remaining pool.
//   3. Drop the FIRST backfill too, recompute again (the 2-deep test).
//   4. Measure the cumulative value drop-off across those two losses against
//      the original slot value.
//   5. If the drop-off is steep, the slot is a cliff — and the fill-set is the
//      positions ELIGIBLE for that slot (so a FLEX cliff shops RB OR pass-
//      catcher, a SUPER_FLEX cliff includes QB).

// How far the slot's coverage can fall across a 2-deep loss before it's a
// cliff. Expressed as the fraction of the original starter's value that the
// 2nd backfill retains. Below this, it's a cliff. Tunable.
//
// 0.45 means: after losing the starter AND his first replacement, the next
// body in is worth less than 45% of the original — a real fall-off.
export const CLIFF_RETENTION_THRESHOLD = 0.45;

// Minimum starter value for a slot to even be cliff-eligible. A slot that's
// already near-empty isn't a "cliff" (it's just a scarcity the need dials
// already catch); cliffs are about good starters with nothing behind.
export const CLIFF_MIN_STARTER_VALUE = 80;

export type SlotCliff = {
  slot: string;                 // e.g. "SUPER_FLEX", "RB", "FLEX"
  starterId: string;
  starterName: string;
  starterValue: number;
  // Value of the lineup's slot after dropping the starter (1-deep backfill).
  backfill1Value: number;
  // Value after dropping the starter AND the first backfill (2-deep).
  backfill2Value: number;
  retention: number;            // backfill2Value / starterValue
  // Positions eligible to fill this slot — the fix-set. A FLEX cliff returns
  // [RB, WR, TE]; a SUPER_FLEX cliff includes QB.
  eligiblePositions: Position[];
};

// Recompute the optimal lineup from a candidate pool that excludes a set of
// player IDs, and return the value assigned to a specific target slot
// occurrence. Because a roster can have multiple identical slot names (two RB,
// three WR), we match by slot ORDER: we ask for the value of the Nth slot in
// the most-restrictive-first ordering. Simpler and robust: we just sum the
// whole lineup and compare deltas, since dropping one player and recomputing
// reflects the true marginal loss across the WHOLE lineup (the flex cascade).
function lineupValueExcluding(
  team: RosteredTeam,
  data: LeagueData,
  excluded: Set<string>,
): number {
  const cands = candidatesFor(team, data.values).filter((c) => !excluded.has(c.id));
  const slots = startingSlots(data.settings.rosterPositions);
  const { lineup } = fillLineup(cands, slots);
  return lineup.reduce((s, l) => s + l.value, 0);
}

// Detect cliffs across all starting slots for one team. Returns at most one
// cliff PER SLOT NAME (deduped) — so a roster with two RB slots yields a
// single RB-slot cliff entry, not two. This is part of the collapse-to-one
// behavior: the narrative layer fires de-consolidate ONCE per slot-cliff, not
// once per fragile player.
export function detectSlotCliffs(
  team: RosteredTeam,
  data: LeagueData,
): SlotCliff[] {
  const slots = startingSlots(data.settings.rosterPositions);
  const cands = candidatesFor(team, data.values);
  const { lineup } = fillLineup(cands, slots);

  // Full optimal lineup value — the baseline.
  const baseValue = lineup.reduce((s, l) => s + l.value, 0);

  const cliffsBySlotName = new Map<string, SlotCliff>();

  for (const slotEntry of lineup) {
    if (!slotEntry.playerId || slotEntry.value < CLIFF_MIN_STARTER_VALUE) continue;

    const starterId = slotEntry.playerId;
    const starterValue = slotEntry.value;

    // 1-deep: drop the starter, recompute whole lineup, measure the marginal
    // loss. The marginal loss IS the value of the best backfill the flex
    // cascade can muster.
    const excluded1 = new Set<string>([starterId]);
    const value1 = lineupValueExcluding(team, data, excluded1);
    const marginalLoss1 = baseValue - value1; // value the replacement could NOT recover
    const backfill1Value = starterValue - marginalLoss1; // what the replacement is worth

    // Find who actually backfilled (the player now occupying the marginal
    // slot) so we can drop them for the 2-deep test. Recompute and diff the
    // used sets.
    const slotsList = startingSlots(data.settings.rosterPositions);
    const pool1 = candidatesFor(team, data.values).filter((c) => !excluded1.has(c.id));
    const fill1 = fillLineup(pool1, slotsList);
    const usedBase = new Set(lineup.map((l) => l.playerId).filter((x): x is string => !!x));
    let firstBackfillId: string | null = null;
    for (const id of fill1.used) {
      if (!usedBase.has(id)) { firstBackfillId = id; break; }
    }

    // 2-deep: drop the starter AND the first backfill, recompute.
    const excluded2 = new Set<string>([starterId]);
    if (firstBackfillId) excluded2.add(firstBackfillId);
    const value2 = lineupValueExcluding(team, data, excluded2);
    const marginalLoss2 = baseValue - value2;
    const backfill2Value = starterValue - (marginalLoss2 - marginalLoss1);

    const retention = starterValue > 0 ? Math.max(0, backfill2Value) / starterValue : 0;

    if (retention >= CLIFF_RETENTION_THRESHOLD) continue; // cushion holds — no cliff

    const elig = slotEntry.position
      ? (startingSlots(data.settings.rosterPositions).find((s) => s.slot === slotEntry.slot)?.elig ?? [slotEntry.position])
      : [];

    const cliff: SlotCliff = {
      slot: slotEntry.slot,
      starterId,
      starterName: slotEntry.name ?? starterId,
      starterValue,
      backfill1Value: Math.max(0, backfill1Value),
      backfill2Value: Math.max(0, backfill2Value),
      retention,
      eligiblePositions: elig,
    };

    // Keep only the worst cliff per slot NAME (dedupe two RB slots → one).
    const existing = cliffsBySlotName.get(slotEntry.slot);
    if (!existing || cliff.retention < existing.retention) {
      cliffsBySlotName.set(slotEntry.slot, cliff);
    }
  }

  return Array.from(cliffsBySlotName.values());
}