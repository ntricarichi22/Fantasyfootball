// src/pro-personnel/engine/thesis/types.ts
//
// The THESIS — the engine's deal-judgment for one team, formed by INTERPRETING
// shared facts (tier, window, trajectory, needs, strength, ages, wants). It
// recomputes none of those — shared owns the facts, the thesis owns the
// opinion. This is the layer the old engine never had.
//
// One thesis per team. We build a full one for our team and a lighter one for
// every partner, so deal-building understands both sides of the table.

import type { Bucket } from "../types";
import type { PersonaKey } from "../core/types";

// ── Posture: the thumb on the scale, read from the team's stated wants ──────
//   accumulate — wants picks/youth: protect picks, build for the future
//   convert    — wants studs/depth: picks are currency, spend for known players
//   neutral    — mixed/maxed/empty wants: no lean, pure roster logic
export type Posture = "accumulate" | "convert" | "neutral";

// Why an asset is on the sell list (drives the director's plain-English take).
export type SellReason =
  | "marked_sell" // explicit market stance
  | "sell_high_age" // aging star at a non-need / set position (Mahomes)
  | "surplus_depth"; // startable-but-not-special piece, consolidation fodder

export type SellItem = {
  key: string;
  bucket: Bucket;
  reason: SellReason;
  // For sell_high_age: do we already roster a young replacement at the spot?
  // If false, the required return must INCLUDE a replacement.
  hasReplacement?: boolean;
};

// A position we should acquire, ranked by RELATIVE need (severity 0..1).
export type BuyReason =
  | "marked_buy" // explicit market stance
  | "relative_need" // among our worst league-relative needs
  | "depth_cliff"; // strong starters, nothing behind them

export type BuyPriority = {
  bucket: Bucket;
  severity: number; // 0..1, higher = chase harder (drives ranking weight)
  reason: BuyReason;
};

// Which picks are the protected war chest vs. spendable currency.
//   "all" — convert posture: any pick is currency
//   "none" — accumulate posture: shield everything, spend reluctantly
//   "non_first" — neutral / partial: 2nds & 3rds spendable, 1sts protected
export type PickSpend = "all" | "non_first" | "none";

// Sleeper deal-shapes this team's situation makes worth hunting.
export type SleeperPattern =
  | "sell_high_star" // ship an aging star from a set position
  | "need_premium" // sell our surplus to a desperate contender at a premium
  | "buy_low_youth" // pry a buried young player off a contender
  | "consolidate" // bundle our depth into one impact starter (2-for-1)
  | "deconsolidate"; // our star → two starters, 2nd upgrades our worst slot (1-for-2)

// The thesis itself.
export type Thesis = {
  teamId: string;
  teamName: string;
  // Raw situational facts pulled from shared (for reference + the director).
  tier: string;
  window: string;
  trajectory: "ascending" | "steady" | "declining";
  persona: PersonaKey;
  avgStarterAge: number | null;
  // Judgment.
  posture: Posture;
  sell: SellItem[];
  buy: BuyPriority[]; // sorted, hardest-chased first
  pickSpend: PickSpend;
  activePatterns: SleeperPattern[];
  // Fragility flags (depth cliffs / succession), surfaced even at set positions.
  fragility: { bucket: Bucket; kind: "depth_cliff" | "age_cliff"; note: string }[];
};

// Partner-fit: how good a counterparty this partner is for OUR thesis, plus the
// premium read for a given position. Computed per (us, partner).
export type PartnerFit = {
  partnerId: string;
  fitScore: number; // higher = more natural partner (window + need mirroring)
  // Does a desperation premium fire when WE sell `bucket` to this partner?
  premiumFires: (bucket: Bucket) => boolean;
};