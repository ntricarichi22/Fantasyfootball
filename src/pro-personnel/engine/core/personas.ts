// src/pro-personnel/engine/core/personas.ts
//
// THE single source of truth for persona accept bands.
//
// Collapses the three drifted copies that used to live in core/gap.ts,
// studio/persona.ts, and builder/engine.ts (PARTNER_PERSONA_BAND) into one
// table. core/gap.ts's personaAwareGrade and the engine both read from here,
// so the chip and the deal logic can never disagree again.
//
// A band is how lopsided a deal a GM tolerates, from THEIR seat. ratio =
// value received / value given. floor = how much they'll overpay; ceiling =
// how lopsided-in-their-favor before it's out of character.
//
// These are the FALLBACK. When a partner has >= MIN_SAMPLES_FOR_EMPIRICAL_BAND
// accepted trades on file, history/reader.ts overrides with their real band.

import type { PersonaKey } from "./types";

export type PersonaBand = {
  min: number; // floor — most they'll overpay (lowest acceptable ratio)
  max: number; // ceiling — most lopsided-in-their-favor they'll go
};

// LOCKED bands (Nick, this session):
//   Straight Shooter  0.90 – 1.10   down the middle
//   Architect         0.90 – 1.10   same tolerance; personality is in the SHAPE
//   Closer            0.85 – 1.05   pays up to close (lowest floor)
//   Hustler           1.00 – 99     only does deals where they win; never overpays
export const PERSONA_BANDS: Record<PersonaKey, PersonaBand> = {
  straight_shooter: { min: 0.9, max: 1.1 },
  architect: { min: 0.9, max: 1.1 },
  closer: { min: 0.85, max: 1.05 },
  hustler: { min: 1.0, max: 99 },
};

// Default when a team's persona is missing/"unknown". Straight Shooter is the
// neutral, symmetric choice.
export const DEFAULT_PERSONA: PersonaKey = "straight_shooter";

const VALID = new Set<PersonaKey>(["closer", "straight_shooter", "architect", "hustler"]);

export function isValidPersona(v: unknown): v is PersonaKey {
  return typeof v === "string" && VALID.has(v as PersonaKey);
}

// Normalize any stored persona string (dossier.persona / StrategyProfile, which
// can be null or "unknown") to a usable PersonaKey.
export function normalizePersona(v: unknown): PersonaKey {
  return isValidPersona(v) ? v : DEFAULT_PERSONA;
}

export function bandFor(persona: PersonaKey): PersonaBand {
  return PERSONA_BANDS[persona] ?? PERSONA_BANDS[DEFAULT_PERSONA];
}

// Is a ratio inside a persona's accept band? Used by both the chip
// (personaAwareGrade, our band) and the partner-read signal (their band).
export function ratioInBand(ratio: number, persona: PersonaKey): boolean {
  const b = bandFor(persona);
  return ratio >= b.min && ratio <= b.max;
}