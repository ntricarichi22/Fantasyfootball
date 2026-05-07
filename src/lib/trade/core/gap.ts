// src/lib/trade/core/gap.ts
//
// Gap math + grade derivation. Single source of truth for fairness.
//
//   computeGap          — given a deal, returns sendValue/receiveValue/ratio/verdict
//   gradeFromVerdict    — converts verdict to a Grade (label + color + bucket)
//   personaAwareGrade   — adjusts Grade based on partner's gm_persona;
//                         used by Builder so the chip reflects the partner's
//                         likely acceptance. A +12% deal grades green
//                         (in-the-range) with a Closer partner, yellow
//                         (you're ahead) with a Straight Shooter.

import type {
  RosterAsset,
  DealAsset,
  Gap,
  GapVerdict,
  Grade,
  PersonaKey,
} from "./types";

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

export function gradeFromVerdict(v: GapVerdict): Grade {
  switch (v) {
    case "MASSIVE_FAVOR_USER":
    case "STRONG_FAVOR_USER":
      return { label: "Great deal for you", color: "#E8503A", bucket: "great" };
    case "SLIGHT_FAVOR_USER":
      return { label: "You're ahead", color: "#F5C230", bucket: "ahead" };
    case "FAIR":
      return { label: "In the range", color: "#007370", bucket: "fair" };
    case "SLIGHT_FAVOR_OTHER":
      return { label: "You're reaching", color: "#F5C230", bucket: "reaching" };
    case "STRONG_FAVOR_OTHER":
    case "MASSIVE_FAVOR_OTHER":
      return { label: "Way off", color: "#E8503A", bucket: "way_off" };
    case "RECV_ONLY":
      return { label: "Add your pieces", color: "#F5C230", bucket: "incomplete" };
    case "SEND_ONLY":
      return { label: "Pick your targets", color: "#F5C230", bucket: "incomplete" };
    default:
      return { label: "", color: "#8C7E6A", bucket: "incomplete" };
  }
}

// Per-persona ratio bands. These match studio/persona.ts but live here too
// so personaAwareGrade is self-contained for Builder use without importing
// from studio/. KEEP IN SYNC with studio/persona.ts.
//
// Hustler band sits ABOVE 1.0 — "come in low" means underpaying the partner,
// so user-perspective ratio (receive/send) ends up > 1.0.
const PERSONA_RATIO_MIN: Record<PersonaKey, number> = {
  straight_shooter: 0.90,
  closer: 0.90,
  hustler: 1.00,
  architect: 0.90,
};
const PERSONA_RATIO_MAX: Record<PersonaKey, number> = {
  straight_shooter: 1.10,
  closer: 1.15,
  hustler: 1.15,
  architect: 1.10,
};

export function personaAwareGrade(
  gap: Gap,
  partnerPersona?: PersonaKey | null,
): Grade {
  // Incomplete deals or unknown partner persona → fall back to neutral grading
  if (
    !partnerPersona ||
    gap.verdict === "EMPTY" ||
    gap.verdict === "RECV_ONLY" ||
    gap.verdict === "SEND_ONLY"
  ) {
    return gradeFromVerdict(gap.verdict);
  }

  const min = PERSONA_RATIO_MIN[partnerPersona];
  const max = PERSONA_RATIO_MAX[partnerPersona];

  // Inside partner's persona band → green / fair bucket
  if (gap.ratio >= min && gap.ratio <= max) {
    return { label: "In the range", color: "#007370", bucket: "fair" };
  }
  // Outside band → neutral grading
  return gradeFromVerdict(gap.verdict);
}
