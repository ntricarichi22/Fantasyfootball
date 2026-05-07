// src/lib/trade/studio/persona.ts
//
// Persona definitions for Trade Studio.
//
// v3.4: ratio-based gates replace fit-score gates. Each persona has a
// numeric receive/send ratio band the engine uses to filter candidates,
// plus a shape rule that tells the candidate generator what structures
// are allowed.
//
//   STRAIGHT SHOOTER — fair value, simple shapes (1-for-1 / 1-for-2 / etc.),
//                      ratio 0.90–1.10
//   CLOSER           — extends UP to 1.15 (sweetener-friendly), any shape
//   HUSTLER          — sits ABOVE fair, lowball offer with a partner pick
//                      added to receive side as the lift. No upper cap on
//                      ratio (engine ranks ratios closer to 1.0 higher,
//                      so modest lowballs surface first in the slate).
//   ARCHITECT        — exotic shapes only (4+ assets / pick swap / future pick),
//                      ratio 0.90–1.10

import type { PersonaKey } from "../core/types";

export type { PersonaKey };

export type PersonaShapeRule = "simple" | "exotic" | "any";

export type PersonaConfig = {
  key: PersonaKey;
  label: string;
  shortLabel: string;
  description: string;
  ratioMin: number;
  ratioMax: number;
  shapeRule: PersonaShapeRule;
};

export const PERSONAS: Record<PersonaKey, PersonaConfig> = {
  closer: {
    key: "closer",
    label: "The Closer",
    shortLabel: "Closer",
    description: "Get the deal done. Throw in a sweetener if needed.",
    ratioMin: 0.90,
    ratioMax: 1.15,
    shapeRule: "any",
  },
  straight_shooter: {
    key: "straight_shooter",
    label: "The Straight Shooter",
    shortLabel: "Straight Shooter",
    description: "Fair value, no games. Down the middle.",
    ratioMin: 0.90,
    ratioMax: 1.10,
    shapeRule: "simple",
  },
  architect: {
    key: "architect",
    label: "The Architect",
    shortLabel: "Architect",
    description: "Make it interesting. Pick swaps and creative structures.",
    ratioMin: 0.90,
    ratioMax: 1.10,
    shapeRule: "exotic",
  },
  hustler: {
    key: "hustler",
    label: "The Hustler",
    shortLabel: "Hustler",
    description: "Come in low. Get them on the phone.",
    ratioMin: 1.00,
    ratioMax: 99,
    shapeRule: "any",
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
