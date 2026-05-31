import type { LeagueData, Position, RosteredTeam } from "@/shared/league-data";
import {
  startingSlots,
  fillLineup,
  candidatesFor,
  slotEligibility,
} from "@/shared/team-profiles";

// ── Slot-aware depth-cliff detection + league-relative startability ────────
//
// Two slot-aware tools, both built on the same optimal-lineup machinery so
// they can never drift from how lineups are actually constructed:
//   detectSlotCliffs  — does dropping a starter crater the lineup (2-deep)?
//   startsForAtLeast  — would this player start for at least N other teams?

export const CLIFF_RETENTION_THRESHOLD = 0.45;
export const CLIFF_MIN_STARTER_VALUE = 80;

export type SlotCliff = {
  slot: string;
  starterId: string;
  starterName: string;
  starterValue: number;
  backfill1Value: number;
  backfill2Value: number;
  retention: number;
  eligiblePositions: Position[];
};

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

export function detectSlotCliffs(team: RosteredTeam, data: LeagueData): SlotCliff[] {
  const slots = startingSlots(data.settings.rosterPositions);
  const cands = candidatesFor(team, data.values);
  const { lineup } = fillLineup(cands, slots);
  const baseValue = lineup.reduce((s, l) => s + l.value, 0);

  const cliffsBySlotName = new Map<string, SlotCliff>();

  for (const slotEntry of lineup) {
    if (!slotEntry.playerId || slotEntry.value < CLIFF_MIN_STARTER_VALUE) continue;

    const starterId = slotEntry.playerId;
    const starterValue = slotEntry.value;

    const excluded1 = new Set<string>([starterId]);
    const value1 = lineupValueExcluding(team, data, excluded1);
    const marginalLoss1 = baseValue - value1;
    const backfill1Value = starterValue - marginalLoss1;

    const slotsList = startingSlots(data.settings.rosterPositions);
    const pool1 = candidatesFor(team, data.values).filter((c) => !excluded1.has(c.id));
    const fill1 = fillLineup(pool1, slotsList);
    const usedBase = new Set(lineup.map((l) => l.playerId).filter((x): x is string => !!x));
    let firstBackfillId: string | null = null;
    for (const id of fill1.used) {
      if (!usedBase.has(id)) { firstBackfillId = id; break; }
    }

    const excluded2 = new Set<string>([starterId]);
    if (firstBackfillId) excluded2.add(firstBackfillId);
    const value2 = lineupValueExcluding(team, data, excluded2);
    const marginalLoss2 = baseValue - value2;
    const backfill2Value = starterValue - (marginalLoss2 - marginalLoss1);

    const retention = starterValue > 0 ? Math.max(0, backfill2Value) / starterValue : 0;
    if (retention >= CLIFF_RETENTION_THRESHOLD) continue;

    const elig = slotEligibility(slotEntry.slot) ?? (slotEntry.position ? [slotEntry.position] : []);

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

    const existing = cliffsBySlotName.get(slotEntry.slot);
    if (!existing || cliff.retention < existing.retention) {
      cliffsBySlotName.set(slotEntry.slot, cliff);
    }
  }

  return Array.from(cliffsBySlotName.values());
}

// ── League-relative startability ──────────────────────────────────────────
//
// Would `player` (value `playerValue`, position `playerPos`) START for a given
// team — i.e. is he >= that team's worst optimal-lineup starter at a slot he's
// eligible for? Used for surplus detection ("starts for >= 4 teams") and for
// the vet-liquidation ceiling ("a real liquidation vet does NOT widely start").
//
// "Start for them" = there exists a starting slot whose eligibility includes
// the player's position, where the team's current occupant of that slot (or the
// weakest such occupant) is worth <= the player's value. Because lineups are
// built best-first, the relevant bar per eligible slot type is the WEAKEST
// starter currently filling a slot the player could take.

function worstEligibleStarterValue(
  team: RosteredTeam,
  data: LeagueData,
  playerPos: Position,
): number | null {
  const slots = startingSlots(data.settings.rosterPositions);
  const cands = candidatesFor(team, data.values);
  const { lineup } = fillLineup(cands, slots);
  let worst: number | null = null;
  for (const slot of lineup) {
    const elig = slotEligibility(slot.slot);
    if (!elig || !elig.includes(playerPos)) continue;
    // An empty slot (no one filling it) means the player would obviously start.
    if (!slot.playerId) return 0;
    if (worst === null || slot.value < worst) worst = slot.value;
  }
  return worst;
}

// Count how many teams (excluding the player's own roster) the player would
// start for. `>=` comparison — we're asking whether HE has surplus quality,
// not whether a specific deal exists. Ties count as "would start."
export function startsForCount(
  playerId: string,
  playerPos: Position,
  playerValue: number,
  ownRosterId: string,
  data: LeagueData,
): number {
  let count = 0;
  for (const team of data.teams) {
    if (team.rosterId === ownRosterId) continue;
    const bar = worstEligibleStarterValue(team, data, playerPos);
    if (bar === null) continue; // team has no slot this position can fill (rare)
    if (playerValue >= bar) count++;
  }
  return count;
}

// Convenience predicate: would this player start for at least N teams?
export function startsForAtLeast(
  playerId: string,
  playerPos: Position,
  playerValue: number,
  ownRosterId: string,
  data: LeagueData,
  n: number,
): boolean {
  return startsForCount(playerId, playerPos, playerValue, ownRosterId, data) >= n;
}