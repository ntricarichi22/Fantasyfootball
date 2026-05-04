// Persona definitions for Trade Studio.
//
// Each persona has TWO things that drive the engine:
//   1. ratioBand — what range of received/sent ratios are valid
//   2. fitTarget — what range of "Works for you / Works for them" scores
//      are required to make the slate
//
// Ratio is the primary filter (it's what makes personas structurally distinct).
// Fit targets are a softer filter (they prevent garbage from sneaking through).

export type PersonaKey = "closer" | "straight_shooter" | "architect" | "hustler";

export type RatioBand = {
  min: number;     // minimum received/sent ratio
  max: number;     // maximum received/sent ratio
  prefer: number;  // ideal target for candidate generation
};

export type FitTarget = {
  yourFitMin: number;
  yourFitMax: number;
  theirFitMin: number;
  theirFitMax: number;
};

export type PersonaConfig = {
  key: PersonaKey;
  label: string;
  shortLabel: string;
  description: string;
  ratioBand: RatioBand;
  fitTarget: FitTarget;
  allowExoticStructure: boolean;  // pick swaps, far-future picks, asymmetric bundles
  requireExoticStructure: boolean; // architect MUST be exotic
};

export const PERSONAS: Record<PersonaKey, PersonaConfig> = {
  closer: {
    key: "closer",
    label: "The Closer",
    shortLabel: "Closer",
    description: "Get the deal done. Throw in a sweetener if needed.",
    // Closer pays a small premium (sends more than receives) → ratio < 1
    ratioBand: { min: 0.82, max: 1.00, prefer: 0.92 },
    fitTarget: { yourFitMin: 55, yourFitMax: 100, theirFitMin: 70, theirFitMax: 100 },
    allowExoticStructure: false,
    requireExoticStructure: false,
  },
  straight_shooter: {
    key: "straight_shooter",
    label: "The Straight Shooter",
    shortLabel: "Straight Shooter",
    description: "Fair value, no games. Down the middle.",
    // Tight band around even-up
    ratioBand: { min: 0.93, max: 1.07, prefer: 1.00 },
    fitTarget: { yourFitMin: 60, yourFitMax: 95, theirFitMin: 60, theirFitMax: 95 },
    allowExoticStructure: false,
    requireExoticStructure: false,
  },
  architect: {
    key: "architect",
    label: "The Architect",
    shortLabel: "Architect",
    description: "Make it interesting. Pick swaps and creative structures.",
    // Wide ratio range — the structure is what makes it interesting, not the value
    ratioBand: { min: 0.80, max: 1.25, prefer: 1.00 },
    fitTarget: { yourFitMin: 50, yourFitMax: 100, theirFitMin: 50, theirFitMax: 100 },
    allowExoticStructure: true,
    requireExoticStructure: true,
  },
  hustler: {
    key: "hustler",
    label: "The Hustler",
    shortLabel: "Hustler",
    description: "Come in low. Get them on the phone.",
    // Hustler asks for more than they send → ratio > 1, intentionally
    ratioBand: { min: 1.12, max: 1.50, prefer: 1.25 },
    fitTarget: { yourFitMin: 65, yourFitMax: 100, theirFitMin: 35, theirFitMax: 75 },
    allowExoticStructure: false,
    requireExoticStructure: false,
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
