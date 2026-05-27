import type { NeedBucket } from "@/shared/team-profiles";
import type { PhantomCorrection } from "./types";

// ── Phantom-signal corrections ────────────────────────────────────────────
//
// Single dials can lie. The brain compounds the bodies against the dials and
// refuses to act on phantoms. See trade_brain.docx Section 3.5.
//
// These checks are called by builder.ts when constructing the rosterRead.
// Each function takes the raw inputs and returns either a correction (the
// dial was misleading) or null (no correction needed). Builder collects
// whichever fire and surfaces them on the bundle.

// Per the team-profiles convention: QB 2, RB 2, pass catcher 4.
// These are the BASE starter requirements per bucket — what the optimal
// lineup MUST fill. FLEX is treated as bonus capacity, not a fixed slot,
// so it doesn't bump these counts.
export const STARTER_COUNTS: Record<NeedBucket, number> = {
  QB: 2,
  RB: 2,
  PASS_CATCHER: 4,
};

// depthNorm below this reads as a cliff in the dials. Lifted from the engine
// spec's DEPTH_CLIFF tunable.
export const DEPTH_CLIFF_THRESHOLD = 0.25;

// Rule 1 — Depth dials behind two studs are phantoms.
//
// A low depthNorm LOOKS like a cliff. But if the position is staffed by
// enough studs to cover the starter requirement, the "depth" behind never
// plays — the cliff doesn't impair the starting lineup. Insurance may still
// apply (the cliff is real if the team is one injury from disaster) but the
// SCARCITY reading is suppressed.
//
// Returns a correction when the cliff dial is masking a position that is
// genuinely fine at the top.
export function checkPhantomCliff(
  bucket: NeedBucket,
  depthNorm: number,
  studCount: number,
): PhantomCorrection | null {
  if (depthNorm >= DEPTH_CLIFF_THRESHOLD) return null;
  const required = STARTER_COUNTS[bucket];
  if (studCount < required) return null;
  return {
    rule: "depth_dial_behind_two_studs",
    description:
      `${bucket} depthNorm ${depthNorm.toFixed(2)} reads as a cliff, but ` +
      `${studCount} stud(s) cover the ${required}-slot starting requirement — ` +
      `the bodies behind never play. Scarcity suppressed.`,
  };
}

// Rule 2 — Apparent surplus that's really an aging glut.
//
// A low need at a position with multiple bodies LOOKS like surplus. But if
// the extra bodies are aging vets with limited remaining value, they're not
// currency — just a roster glut. Suppress surplus detection.
//
// Caller passes the candidate surplus pieces (those beyond starter
// requirement at the bucket) plus an isAging predicate. If ALL of them are
// aging, surplus is phantom.
export function checkPhantomSurplusFromAging(
  bucket: NeedBucket,
  candidates: Array<{ id: string; age: number | null; position: string }>,
  isAgingFn: (position: string, age: number | null) => boolean,
): PhantomCorrection | null {
  if (candidates.length === 0) return null;
  const allAging = candidates.every((c) => isAgingFn(c.position, c.age));
  if (!allAging) return null;
  return {
    rule: "need_dial_in_front_of_aging_roster",
    description:
      `${bucket} shows apparent surplus (${candidates.length} extra bodies) ` +
      `but all are aging vets — not currency, just glut. Surplus suppressed.`,
  };
}

// Rule 3 — High individual value is not the same as positional surplus.
//
// A high-value player at a position with thin depth is NOT surplus — shipping
// him would open a void. This rule is enforced structurally: surplus is
// defined as "players NOT in the optimal lineup," so a high-value lineup
// piece never appears in the surplus list. This function exists so the
// builder can surface an audit record when a naive heuristic WOULD have
// flagged a high-value lineup piece as tradeable — useful for the director's
// "we considered Cook but he's not actually surplus" framing.
export function checkPhantomHighValueIsNotSurplus(
  bucket: NeedBucket,
  inLineupHighValueNames: string[],
): PhantomCorrection | null {
  if (inLineupHighValueNames.length === 0) return null;
  return {
    rule: "high_value_is_not_surplus",
    description:
      `${bucket} holds high-value lineup piece(s) (${inLineupHighValueNames.join(", ")}) ` +
      `that would otherwise look tradeable. Surplus = quality beyond what you start, ` +
      `not quality at the top.`,
  };
}