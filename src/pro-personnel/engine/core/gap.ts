// src/pro-personnel/engine/core/gap.ts
//
// Gap math + grade derivation. Single source of truth for fairness.
//
//   computeGap          — given a deal, returns sendValue/receiveValue/ratio/verdict
//   gradeFromVerdict    — converts verdict to a Grade (label + color + bucket).
//                         Labels updated to director's-voice copy:
//                           "We should take this deal"  (green)
//                           "I'd push for more here"    (yellow)
//                           "Don't even entertain this" (red)
//   personaAwareGrade   — adjusts Grade based on OUR persona band. Builder
//                         + Studio both pass OUR persona now — the chip is
//                         OUR accept-band check. Bilateral acceptance (will
//                         the partner take it?) is handled in advisor prose.
//
// Band source: the locked table in ./personas (PERSONA_BANDS via bandFor).
// This file no longer carries its own copy — that drift (closer capped at 1.00
// here vs 1.05 in the locked table) is gone. One table, read everywhere.
//
// Bucket preservation: the full bucket vocabulary
//   "great" | "ahead" | "fair" | "reaching" | "way_off" | "incomplete"
// is preserved so any UI branching on specific buckets (e.g. position
// dots, prose tone shifts) still works. The label and color are what
// collapse — three buckets now share the same "We should take this deal"
// label and green underline, but downstream code can still distinguish.

import type {
  RosterAsset,
  DealAsset,
  Gap,
  GapVerdict,
  Grade,
  PersonaKey,
} from "./types";
import { bandFor } from "./personas";

// ─── Color tokens (mirror locked palette) ──────────────────────────────

const GREEN = "#019942";
const YELLOW = "#F5C230";
const RED = "#E8503A";
const MUTED = "#8C7E6A";

// ─── Director's bottom-line copy ───────────────────────────────────────

const VERDICT_TAKE = "We should take this deal";
const VERDICT_PUSH = "I'd push for more here";
const VERDICT_WALK = "Don't even entertain this";
const VERDICT_ADD = "Add your pieces";
const VERDICT_PICK = "Pick your targets";

// ─── Gap computation ──────────────────────────────────────────────────

export function computeGap(
  dealAssets: DealAsset[],
  rosters: Record<string, RosterAsset[]>,
  myTeamId: string,
): Gap {
  let sendValue = 0;
  let receiveValue = 0;
  for (const a of dealAssets) {
    const asset = (rosters[a.fromTeamId] ?? []).find((r) => r.key === a.key);
    if (!asset) continue;
    if (a.fromTeamId === myTeamId) sendValue += asset.value;
    if (a.toTeamId === myTeamId) receiveValue += asset.value;
  }

  const hasSend = dealAssets.some((a) => a.fromTeamId === myTeamId);
  const hasReceive = dealAssets.some((a) => a.toTeamId === myTeamId);
  const ratio = sendValue > 0 ? receiveValue / sendValue : hasReceive ? 99 : 0;
  const delta = receiveValue - sendValue;

  let verdict: GapVerdict = "EMPTY";
  if (!hasSend && !hasReceive) verdict = "EMPTY";
  else if (hasReceive && !hasSend) verdict = "RECV_ONLY";
  else if (hasSend && !hasReceive) verdict = "SEND_ONLY";
  else if (ratio > 1.5) verdict = "MASSIVE_FAVOR_USER";
  else if (ratio > 1.2) verdict = "STRONG_FAVOR_USER";
  else if (ratio > 1.1) verdict = "SLIGHT_FAVOR_USER";
  else if (ratio >= 0.9) verdict = "FAIR";
  else if (ratio >= 0.8) verdict = "SLIGHT_FAVOR_OTHER";
  else if (ratio >= 0.5) verdict = "STRONG_FAVOR_OTHER";
  else verdict = "MASSIVE_FAVOR_OTHER";

  return { sendValue, receiveValue, ratio, delta, verdict, hasSend, hasReceive };
}

// ─── Verdict → Grade mapping ──────────────────────────────────────────
//
// Under the new design the chip is always OUR view. Any deal that lands
// at or above fair value for us shows "We should take this deal" (green).
// Bucket distinctions are preserved underneath so downstream code can
// still differentiate "great" vs "ahead" vs "fair" if needed.

export function gradeFromVerdict(v: GapVerdict): Grade {
  switch (v) {
    case "MASSIVE_FAVOR_USER":
    case "STRONG_FAVOR_USER":
      return { label: VERDICT_TAKE, color: GREEN, bucket: "great" };
    case "SLIGHT_FAVOR_USER":
      return { label: VERDICT_TAKE, color: GREEN, bucket: "ahead" };
    case "FAIR":
      return { label: VERDICT_TAKE, color: GREEN, bucket: "fair" };
    case "SLIGHT_FAVOR_OTHER":
      return { label: VERDICT_PUSH, color: YELLOW, bucket: "reaching" };
    case "STRONG_FAVOR_OTHER":
    case "MASSIVE_FAVOR_OTHER":
      return { label: VERDICT_WALK, color: RED, bucket: "way_off" };
    case "RECV_ONLY":
      return { label: VERDICT_ADD, color: YELLOW, bucket: "incomplete" };
    case "SEND_ONLY":
      return { label: VERDICT_PICK, color: YELLOW, bucket: "incomplete" };
    default:
      return { label: "", color: MUTED, bucket: "incomplete" };
  }
}

// ─── Persona accept-band check ────────────────────────────────────────
//
// Both Builder and Studio pass OUR persona — the chip grades whether the
// deal falls in OUR accept band. Inside band → "We should take this deal"
// (green). Outside band → falls through to standard verdict grade.
//
// Band numbers come from the locked PERSONA_BANDS table via bandFor(), so
// the chip and the engine can never disagree. Hustler's band sits at/above
// 1.0 (they never overpay); the 99 ceiling lets the math bound naturally.

export function personaAwareGrade(
  gap: Gap,
  ourPersona?: PersonaKey | null,
): Grade {
  // Incomplete deals or unknown persona → standard grading
  if (
    !ourPersona ||
    gap.verdict === "EMPTY" ||
    gap.verdict === "RECV_ONLY" ||
    gap.verdict === "SEND_ONLY"
  ) {
    return gradeFromVerdict(gap.verdict);
  }

  const band = bandFor(ourPersona);

  // Inside our persona's accept band → director endorses with green chip
  if (gap.ratio >= band.min && gap.ratio <= band.max) {
    // Pick the bucket that best reflects where in the band we landed:
    //   ratio >= 1.0 → "ahead" (favorable end)
    //   ratio <  1.0 → "fair"  (we're paying fairly)
    const bucket: Grade["bucket"] = gap.ratio >= 1.0 ? "ahead" : "fair";
    return { label: VERDICT_TAKE, color: GREEN, bucket };
  }
  // Outside band → fall through to standard verdict grade
  return gradeFromVerdict(gap.verdict);
}