// src/shared/asset-values/age.ts
//
// Position-aware age classification — young / prime / aging. THE single source
// of truth for the age bands, lifted out of the Strategy Director's youth
// modifier so the trade engine and the value-modifier read identical numbers
// and can never drift. Pure: facts in (position, age), judgment out — nothing
// is stored on the player, exactly like computeNeeds derives need from facts.
//
// Bands (inclusive), matching the Strategy Director's tuned thresholds:
//   QB:     young <= 25,  aging >= 33
//   RB:     young <= 23,  aging >= 27
//   WR/TE:  young <= 24,  aging >= 30
// Everything between the two edges is "prime".
//
// "Young" also has an EXPERIENCE path: a player early in his career (<= 3 seasons
// of NFL experience) is a young/ascending building block even if a year or two
// past the positional age line — a 24yo RB or 26yo QB in year 1-4 is still on his
// rookie-deal trajectory. Age-only missed these (e.g. a 24yo 2nd-year RB). The
// experience OR applies to `isYoung` only; `ageBucket`/`isAging` stay age-pure.

import type { Position } from "@/shared/league-data";

export type AgeBucket = "young" | "prime" | "aging";

type Band = { young: number; aging: number };

const BANDS: Record<Position, Band> = {
  QB: { young: 25, aging: 33 },
  RB: { young: 23, aging: 27 },
  WR: { young: 24, aging: 30 },
  TE: { young: 24, aging: 30 },
};

// Tolerant lookup: accepts any string (engine assets carry loose position
// strings, picks carry "PICK"). Anything that isn't one of the four fantasy
// positions has no band, so it reads as neutral "prime".
function bandFor(position: string): Band | null {
  const p = (position ?? "").toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE") return BANDS[p as Position];
  return null;
}

// Classify a player's age for their position. Unknown age or non-player
// position -> "prime" (neutral), so a missing birthdate never reads as young
// OR aging, and a pick never reads as a youth/aging signal.
export function ageBucket(position: string, age: number | null | undefined): AgeBucket {
  if (age == null) return "prime";
  const band = bandFor(position);
  if (!band) return "prime";
  if (age <= band.young) return "young";
  if (age >= band.aging) return "aging";
  return "prime";
}

// Early-career cutoff: <= this many seasons of experience reads as young, regardless
// of age. Rookie deals run 4 years (exp 0-3), the "still ascending" window.
const YOUNG_EXP_MAX = 3;

export function isYoung(
  position: string,
  age: number | null | undefined,
  exp?: number | null,
): boolean {
  if (exp != null && exp <= YOUNG_EXP_MAX) return true;
  return ageBucket(position, age) === "young";
}

export function isAging(position: string, age: number | null | undefined): boolean {
  return ageBucket(position, age) === "aging";
}