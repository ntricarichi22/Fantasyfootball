import type { Tier } from "@/shared/team-profiles";

// The competitive-timeline read. Distinct from tier: tier is strength NOW,
// window is where the team sits in its build cycle.
export type Window = "contending" | "ascending" | "closing" | "rebuilding";

// How much to trust the posture read. Flips to "strong" automatically once a
// team sets a real market (everything is "hold" pre-launch => "thin" for now).
export type Confidence = "strong" | "thin";

// The full neutral report. Computes NOTHING new — it frames fields already on
// TeamProfile + the live strategy/attachment rows. Scouting renders it; the
// trade engine reads the same object. One source of truth, no partial views.
export type TeamDossier = {
  rosterId: string;
  teamName: string;
  tier: Tier;
  tierLabel: string;
  verdict: string; // scout-voice headline
  window: Window;
  wants: string; // what they're chasing
  sells: string; // what they're shedding
  coreLabel: string; // untouchable players + locked picks vs. everyone-else-moveable
  tradeStance: string; // tier + contendIntent + persona + picksLocked
  persona: string; // raw GM persona, or "unknown"
  picksLocked: boolean; // any future/current pick marked untouchable — clean signal for the trade engine
  confidence: Confidence;
};