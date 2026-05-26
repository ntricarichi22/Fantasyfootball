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

export function isYoung(position: string, age: number | null | undefined): boolean {
  return ageBucket(position, age) === "young";
}

export function isAging(position: string, age: number | null | undefined): boolean {
  return ageBucket(position, age) === "aging";
}