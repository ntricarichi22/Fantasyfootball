// src/pro-personnel/engine/types.ts
//
// Vocabulary for the unified deal engine.
//
// ONE front door (the constructor) discovers a partner set (or takes a locked
// one) and builds a deal; three thin adapters (Studio, Builder, Scouting)
// decide what to feed it. These types are the contract between the adapters
// and the constructor — NOT the HTTP response shape. The API routes map an
// EngineOffer onto the frozen wire shape the UI already reads, so no UI file
// is touched.
//
// Imports only gap-math primitives from engine/core. Does NOT import @/shared,
// so it compiles before the pricing/gate layers (which DO use shared) land.

import type { Grade, GapVerdict, PersonaKey } from "@/pro-personnel/engine/core/types";

export type { PersonaKey };

// ─── Assets ──────────────────────────────────────────────────────────────
//
// The engine speaks in asset KEYS — a player's sleeper id, or a canonical pick
// key ("pick:2026-2-7-7" current, "pick:2027-2-7" future). These keys are
// identical across the client payload, shared OwnedPick, and the team-value
// table (cfc_team_trade_values_current.sleeper_player_id), so players and picks
// join everywhere with no ID gymnastics.

export type AssetKey = string;

export type AssetType = "player" | "pick";

// Need/market buckets, matching shared's 3-market model (WR + TE collapse into
// PASS_CATCHER) plus picks. The old separate WR/TE markets are gone.
export type Bucket = "QB" | "RB" | "PASS_CATCHER" | "PICK";

// A roster asset as the engine consumes it. Per-asset dollar values are NOT
// carried here — the pricing layer attaches two of them (ours and theirs) when
// it builds the scoreboards, because there is no single universal price.
export type EngineAsset = {
  key: AssetKey;
  name: string;
  type: AssetType;
  position: string; // "QB" | "RB" | "WR" | "TE" | "PICK"
  bucket: Bucket;
  ownerTeamId: string;
  isStud: boolean;
  // pick-only (mirrors shared OwnedPick)
  pickYear?: number;
  pickRound?: number;
  pickSlot?: number | null;
};

// ─── The request — what an adapter feeds the front door ────────────────────

// The structural move the deal is. Shapes how the deal gets built.
//   acquire    — Builder: go get a target          (anchor on the receive side)
//   shop       — Studio / Scouting: open an asset   (anchor on the send side)
//   trade_up   — Scouting: send our pick + more to climb to a higher pick
//   trade_back — Scouting: move our pick down for more / later capital
export type Intent = "acquire" | "shop" | "trade_up" | "trade_back";

// Soft biases on the RETURN composition. Hard wants come from strategy; these
// are gentle nudges a directed door layers on top. Never hard filters — at
// worst a lean fails to fire and the deal is just slightly less tuned.
export type Lean =
  | "prefer_players"
  | "prefer_picks"
  | "prefer_future_picks"
  | "avoid_current_picks"
  | "accumulate_picks";

// Which scoreboard the balancer aims to satisfy when filling out the deal.
//   "us"      — Builder / Scouting: build the best deal for US, open strong,
//               negotiate from there. The partner read is informational.
//   "partner" — Studio: only surface deals the PARTNER would realistically take
//               ("what can I get for these guys").
export type AimAt = "us" | "partner";

// A side of the table, always from OUR perspective.
export type Side = "send" | "receive";

// A fixed anchor: an asset locked to a side that the deal is built around.
//   Studio:            our shop list, all on "send".
//   Builder:           the target, on "receive".
//   Scouting up/back:  our pick on "send" AND a required partner pick on
//                      "receive" — the two-anchor case the old engine couldn't do.
export type Anchor = {
  key: AssetKey;
  side: Side;
};

// Who we'll deal with. "open" makes the constructor scan the eligible league;
// "locked" restricts to one team or a short vetted list (directed-door lock).
export type Counterparty =
  | { mode: "open" }
  | { mode: "locked"; teamIds: string[] };

// ─── Return aiming — what the RETURN should look like, not just its value ────
//
// Leans are gentle nudges; a ReturnAim is the storyline's actual demand on the
// composition of what comes back. It is pushed all the way down into the
// balance step, so the gap-closer pulls the RIGHT pieces, not merely the
// nearest-value ones. This is what makes a build's stud sale come back as
// youth + the pick tier the owner asked for instead of the highest-value vet
// the math allows.
//
//   requireBackfill : a HARD constraint — the return MUST include a competent
//                     starter at this bucket (passes the start-for test). The
//                     harvest/sell-high case: ship a QB, you cannot drop below
//                     two startable QBs, so a competent QB comes back first and
//                     the rest of the package is built around it. No competent
//                     piece on the partner → no deal with them (correct).
//   preferPickTier  : bias the fill toward picks of this tier
//                     (premium = round 1, future = down-the-road, any = all).
//   preferBuckets   : the player position-buckets the fill may pull from. This
//                     is what AIMS a shape: [RB] = "complete the RB room",
//                     [PASS_CATCHER] = "young WR shape", [] = picks-only (no
//                     players). undefined = any bucket.
//   youthBuckets    : buckets whose RETURNED PLAYERS must be young + non-stud
//                     to count — driven by the owner's per-position buy intent
//                     (PC = buy_young → young PCs only; RB = consolidate →
//                     proven RB is fine, so RB is NOT here).
//   strength        : "hard" filters the fill pool to aim-matching pieces only
//                     (a build's sell IS youth/picks of the right shape). "soft"
//                     keeps the full pool but PREFERS aim matches among in-band
//                     candidates.
export type ReturnAim = {
  requireBackfill?: Bucket;
  preferPickTier?: "premium" | "future" | "any";
  preferBuckets?: Bucket[];
  youthBuckets?: Bucket[];
  strength?: "hard" | "soft";
};

export type DealRequest = {
  ourTeamId: string;
  // Whose personality shapes the offer. For us-initiated doors this is us; in
  // Studio each partner shapes their own offers, so the adapter sets this per
  // candidate partner inside the constructor's partner loop.
  offeringTeamId: string;
  intent: Intent;
  // Assets locked into the deal, by side. A side may be empty.
  anchors: Anchor[];
  counterparty: Counterparty;
  // Targeted doors only: specific partner asset(s) the deal MUST include — the
  // slot we climb to (trade_up) or the pick we acquire (trade_back). Empty
  // otherwise. The engine reconstructs WHY a partner fits from their dossier;
  // it only needs WHO and WHAT here.
  requiredCounterpartyKeys?: AssetKey[];
  leans: Lean[];
  // The storyline's demand on what the return looks like (pushed into balance).
  // Absent → the constructor balances to value as before (back-compat).
  returnShape?: ReturnAim;
  aimAt: AimAt;
  // Marks a deal whose currency rules differ from a normal trade. "insurance"
  // means a contender buying depth: it must NOT pay with anyone who fills a
  // real role (optimal-lineup starter OR a needed backup), only with picks plus
  // genuinely-excess players (the brain's surplus / buried-young lists). The
  // constructor reads that excess set from ec.bundles for ourTeamId.
  dealKind?: "insurance";
};

// ─── Pricing — two scoreboards ─────────────────────────────────────────────
//
// There is no universal price. Each side prices its OWN assets at its
// team-specific value (cfc_team_trade_values_current.final_value) and fills the
// other side — assets it never set a price on — at the neutral CFC base (shared
// ValueMaps.value). Those two unknowable squares are where human negotiation
// lives; the engine never fakes them.

export type PricingLens = "ours" | "theirs";

// A read of the deal under ONE lens. ratio = receive / send from that reader's
// seat: > 1 the reader comes out ahead, < 1 the reader overpays. verdict/ratio
// reuse the core Gap vocabulary so the chip + bands keep working unchanged.
export type Scoreboard = {
  lens: PricingLens;
  sendValue: number;
  receiveValue: number;
  ratio: number;
  verdict: GapVerdict;
};

// How the deal reads to the PARTNER — the additive signal a card may surface
// later (the chip keeps showing OUR view). Derived from their scoreboard
// against their persona accept band.
//   likely        — clears their band comfortably
//   needs_selling — outside their band but in reach; you'll negotiate
//   long_shot     — well outside; a real ask
export type PartnerRead = "likely" | "needs_selling" | "long_shot";

// ─── The offer — constructor output ────────────────────────────────────────

export type EngineOfferAsset = {
  key: AssetKey;
  name: string;
  type: AssetType;
  side: Side; // from our perspective
};

export type EngineOffer = {
  id: string;
  partnerTeamId: string;
  partnerTeamName: string;
  partnerPersona: PersonaKey;
  intent: Intent;
  assets: EngineOfferAsset[];

  // OUR scoreboard drives the chip the UI already shows.
  ourScoreboard: Scoreboard;
  grade: Grade; // chip label + color, from OUR view (via personaAwareGrade)

  // THEIR scoreboard + the readable signal (additive; UI may surface later).
  partnerScoreboard: Scoreboard;
  partnerRead: PartnerRead;

  // True when the deal clears BOTH bands. False = near-miss: good for us but a
  // sell to them (shown on locked/directed doors, flagged needs-negotiation).
  clears: boolean;

  // Slate-time placeholder; the advisor route overwrites with LLM prose when
  // the card becomes active. Display of all prose stays in the UI.
  prose: string;

  // Ranking diagnostic.
  score: number;
};

export type SlateReason = "ok" | "no_strategy" | "no_clean_offers";

export type EngineSlate = {
  generatedAt: string;
  offers: EngineOffer[];
  reason: SlateReason;
};