// src/pro-personnel/engine/shapes.ts
//
// The four GM personalities, expressed as the finishing FLAVOR on top of a
// balanced base — not as blind generators. Each persona maps to a small set of
// knobs the constructor reads while building an offer; shapes itself stays pure
// and pool-agnostic (persona in, knobs out), so it's trivial to reason about
// and can't drift.
//
// Whose persona? The OFFERING team's (DealRequest.offeringTeamId): in
// Builder/Scouting that's us, in Studio it's each candidate partner.
//
// openingRatio is from the OFFERING team's seat (receive ÷ give):
//   Straight Shooter 1.00  — clean, down the middle
//   Architect        1.00  — same balance; personality is in the SHAPE
//   Closer           0.95  — opens a hair generous to grease the deal (pays up)
//   Hustler          1.08  — opens a hair light (only does deals they win)

import type { PersonaKey } from "./types";

export type ShapeKnobs = {
  // Target receive/send ratio from the offering team's seat.
  openingRatio: number;
  // Where the persona's signature sweetener goes, if any:
  //   "send"    → Closer adds a low pick to their own side (pays to close)
  //   "receive" → Hustler grabs a small partner pick (extracts a touch more)
  //   null      → no add-on sweetener (Straight Shooter / Architect)
  sweetenerSide: Side | null;
  // Architect leans exotic: prefer a pick-swap / bigger-piece shape.
  preferSwap: boolean;
  // Hard cap on assets per side for this persona's offers.
  maxPerSide: number;
};

type Side = "send" | "receive";

const KNOBS: Record<PersonaKey, ShapeKnobs> = {
  straight_shooter: { openingRatio: 1.0, sweetenerSide: null, preferSwap: false, maxPerSide: 3 },
  architect: { openingRatio: 1.0, sweetenerSide: null, preferSwap: true, maxPerSide: 4 },
  closer: { openingRatio: 0.95, sweetenerSide: "send", preferSwap: false, maxPerSide: 3 },
  hustler: { openingRatio: 1.08, sweetenerSide: "receive", preferSwap: false, maxPerSide: 3 },
};

const FALLBACK: ShapeKnobs = KNOBS.straight_shooter;

export function shapeKnobsFor(persona: PersonaKey): ShapeKnobs {
  return KNOBS[persona] ?? FALLBACK;
}