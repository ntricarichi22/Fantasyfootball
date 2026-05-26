import type { AttachmentLevel } from "@/shared/league-data";
import type { Tier } from "@/shared/team-profiles";

export type ClassStrength = "weak" | "average" | "stacked";

// Future pick: the original owner's tier implies a finishing SLOT within the
// round (championship finishes high → late pick; rebuilding → early pick).
export const TIER_TO_SLOT: Record<Tier, number> = {
  championship: 11,
  playoff: 8,
  retooling: 5,
  rebuilding: 2,
};

// Future picks discount for being a year or more out.
export function yearDiscount(yearsOut: number): number {
  if (yearsOut <= 0) return 1.0;
  if (yearsOut === 1) return 0.95;
  return 0.9;
}

// Availability tier — how attached the owner is. Same scale for players + picks.
// Untouchable is +20%: the price spike is the protection — pry the guy loose
// only with a genuinely big return, no hard "never trade" wall needed.
export const AVAILABILITY_PCT: Record<AttachmentLevel, number> = {
  untouchable: 20,
  core_piece: 5,
  listening: 0,
  moveable: -5,
};

// Draft class strength — how good the incoming rookie class is (picks only).
export const CLASS_STRENGTH_PCT: Record<ClassStrength, number> = {
  weak: -10,
  average: 0,
  stacked: 10,
};

// Apply a stack of percentage modifiers to a base value, e.g.
//   applyModifiers(68, [AVAILABILITY_PCT.untouchable, CLASS_STRENGTH_PCT.stacked])
export function applyModifiers(base: number, percents: number[]): number {
  const total = percents.reduce((sum, p) => sum + p, 0);
  return Math.round(base * (1 + total / 100));
}