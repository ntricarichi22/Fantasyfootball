import type { LeagueData, Position, PlayerInfo } from "@/shared/league-data";
import type { LineupSlot, NeedBucket } from "@/shared/team-profiles";
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

  let move = 0;
  for (let i = 0; i < k; i++) {
    const id = order[i];
    const ci = consIdx.get(id);
    move += ci == null ? k : Math.abs(ci - i);
  }
  const displacement = Math.min(1, move / k / (k / 2));

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

// ── successor pressure (per-starter, age OR quality) ─────────────────────────
const AGE_OLD = 28; // a starter at/above this is aging
const AGE_STEEP = 31; // at/above this the cliff is steep -> max age pressure
const WEAK_STARTER_VALUE = 120; // a starter below this is a placeholder, not a long-term answer
const HEIR_AGE = 24; // a benched player at/below this can be the young heir...
const HEIR_VALUE = 40; // ...if he carries at least this much value

function bucketOf(pos: Position): NeedBucket {
  if (pos === "QB") return "QB";
  if (pos === "RB") return "RB";
  return "PASS_CATCHER";
}

// Per-STARTER pressure: a starter needs a successor if he's OLD or a low-value
// PLACEHOLDER — judged individually, not by a blurred position-group average. A
// 38-yo journeyman and a 24-yo stud in the same room no longer average out to
// "kinda old"; the room's pressure = its single most urgent starter. Dampened
// to 0 for a bucket that already has a young, valued heir on the bench (an old
// starter with a stud behind him is not a target).
export function computeSuccessorPressure(
  lineup: LineupSlot[],
  players: PlayerInfo[],
  data: LeagueData
): SuccessorPressure {
  const valueOf = (id: string) => data.values.value.get(id) ?? 0;
  const ageOf = (id: string) => data.players.get(id)?.age ?? null;

  const starterIds = new Set(
    lineup.map((l) => l.playerId).filter((x): x is string => !!x)
  );

  const heir: Record<NeedBucket, boolean> = { QB: false, RB: false, PASS_CATCHER: false };
  for (const p of players) {
    if (starterIds.has(p.id)) continue;
    if (p.age == null || p.age > HEIR_AGE) continue;
    if (valueOf(p.id) < HEIR_VALUE) continue;
    heir[bucketOf(p.position)] = true;
  }

  // Each starter's individual pressure = max(age cliff, placeholder quality).
  const worst: Record<NeedBucket, number> = { QB: 0, RB: 0, PASS_CATCHER: 0 };
  for (const slot of lineup) {
    if (!slot.playerId || slot.position == null) continue;
    const b = bucketOf(slot.position);
    const age = ageOf(slot.playerId);
    const val = slot.value;

    let ageP = 0;
    if (age != null) {
      if (age >= AGE_STEEP) ageP = 1;
      else if (age >= AGE_OLD) ageP = (age - AGE_OLD) / (AGE_STEEP - AGE_OLD);
    }
    const qualityP = val < WEAK_STARTER_VALUE ? Math.min(1, (WEAK_STARTER_VALUE - val) / WEAK_STARTER_VALUE) : 0;

    const p = Math.max(ageP, qualityP);
    if (p > worst[b]) worst[b] = p;
  }

  return {
    QB: heir.QB ? 0 : worst.QB,
    RB: heir.RB ? 0 : worst.RB,
    PASS_CATCHER: heir.PASS_CATCHER ? 0 : worst.PASS_CATCHER,
  };
}