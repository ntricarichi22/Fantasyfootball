// Persona definitions for Trade Studio.
//
// v3.1: PersonaKey now lives in types.ts so StudioOffer can use it directly.
// We re-export it here so existing imports (`from "./persona"`) keep working.
//
// Color-signature gates per the commandments:
//
//   STRAIGHT SHOOTER — both fits >= 85 (green / green)
//   CLOSER           — your fit 67–84, their fit >= 85 (yellow / green)
//   HUSTLER          — your fit >= 85, their fit 67–84 (green / yellow)
//   ARCHITECT        — both fits >= 67, neither needs to be >= 85
//
// The candidate generator (candidates.ts) handles the shape rules; the engine
// applies these gates as a final filter before slate ranking.

import type { PersonaKey } from "./types";

export type { PersonaKey };

export type PersonaConfig = {
  key: PersonaKey;
  label: string;
  shortLabel: string;
  description: string;
  yourFitMin: number;
  yourFitMax: number;
  theirFitMin: number;
  theirFitMax: number;
};

export const PERSONAS: Record<PersonaKey, PersonaConfig> = {
  closer: {
    key: "closer",
    label: "The Closer",
    shortLabel: "Closer",
    description: "Get the deal done. Throw in a sweetener if needed.",
    yourFitMin: 67, yourFitMax: 84,
    theirFitMin: 85, theirFitMax: 100,
  },
  straight_shooter: {
    key: "straight_shooter",
    label: "The Straight Shooter",
    shortLabel: "Straight Shooter",
    description: "Fair value, no games. Down the middle.",
    yourFitMin: 85, yourFitMax: 100,
    theirFitMin: 85, theirFitMax: 100,
  },
  architect: {
    key: "architect",
    label: "The Architect",
    shortLabel: "Architect",
    description: "Make it interesting. Pick swaps and creative structures.",
    yourFitMin: 67, yourFitMax: 100,
    theirFitMin: 67, theirFitMax: 100,
  },
  hustler: {
    key: "hustler",
    label: "The Hustler",
    shortLabel: "Hustler",
    description: "Come in low. Get them on the phone.",
    yourFitMin: 85, yourFitMax: 100,
    theirFitMin: 67, theirFitMax: 84,
  },
};

export function getPersona(key: string | null | undefined): PersonaConfig {
  if (!key) return PERSONAS.straight_shooter;
  const normalized = key.toLowerCase() as PersonaKey;
  return PERSONAS[normalized] ?? PERSONAS.straight_shooter;
}

export function isValidPersona(key: string | null | undefined): key is PersonaKey {
  if (!key) return false;
  return key.toLowerCase() in PERSONAS;
}
