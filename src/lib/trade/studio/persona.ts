// Persona definitions for Trade Studio.
//
// Each persona drives WHICH offers the engine searches for. The persona is
// not just a label — it shapes the target fit signature (Your Fit / Their Fit
// ranges) and the structural preferences (sweetener allowed, exotic allowed,
// asymmetric allowed) that the offer search uses to filter candidates.

export type PersonaKey = "closer" | "straight_shooter" | "architect" | "hustler";

export type FitTarget = {
  // Acceptable range for "Works for you" (0-100 scale)
  yourFitMin: number;
  yourFitMax: number;
  // Acceptable range for "Works for them" (0-100 scale)
  theirFitMin: number;
  theirFitMax: number;
};

export type PersonaConfig = {
  key: PersonaKey;
  label: string;          // Display name (e.g., "The Closer")
  shortLabel: string;     // For inline display ("Closer")
  description: string;    // 1-line description for the picker
  fitTarget: FitTarget;
  // Structural flags that gate the offer search
  allowSweetener: boolean;       // Sender can throw in a small piece to push partner fit higher
  allowExoticStructure: boolean; // Pick swaps, far-future picks, asymmetric bundles
  preferSimple: boolean;         // Skip complex multi-piece structures
};

export const PERSONAS: Record<PersonaKey, PersonaConfig> = {
  closer: {
    key: "closer",
    label: "The Closer",
    shortLabel: "Closer",
    description: "Get the deal done. Throw in a sweetener if needed.",
    fitTarget: {
      yourFitMin: 75,
      yourFitMax: 100,
      theirFitMin: 80,
      theirFitMax: 100,
    },
    allowSweetener: true,
    allowExoticStructure: false,
    preferSimple: true,
  },
  straight_shooter: {
    key: "straight_shooter",
    label: "The Straight Shooter",
    shortLabel: "Straight Shooter",
    description: "Fair value, no games. Down the middle.",
    fitTarget: {
      yourFitMin: 70,
      yourFitMax: 90,
      theirFitMin: 70,
      theirFitMax: 90,
    },
    allowSweetener: false,
    allowExoticStructure: false,
    preferSimple: true,
  },
  architect: {
    key: "architect",
    label: "The Architect",
    shortLabel: "Architect",
    description: "Make it interesting. Pick swaps and creative structures.",
    fitTarget: {
      yourFitMin: 65,
      yourFitMax: 95,
      theirFitMin: 65,
      theirFitMax: 95,
    },
    allowSweetener: true,
    allowExoticStructure: true,
    preferSimple: false,
  },
  hustler: {
    key: "hustler",
    label: "The Hustler",
    shortLabel: "Hustler",
    description: "Come in low. Get them on the phone.",
    fitTarget: {
      yourFitMin: 85,
      yourFitMax: 100,
      theirFitMin: 50,
      theirFitMax: 70,
    },
    allowSweetener: false,
    allowExoticStructure: false,
    preferSimple: true,
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
