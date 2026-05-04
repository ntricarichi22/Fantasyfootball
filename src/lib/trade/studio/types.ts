// Shared types for the Trade Studio engine.

import type { PersonaKey } from "./persona";

// ─── Asset shape (mirrors advisor/engine.ts RosterAsset) ─────────────────

export type StudioAsset = {
  key: string;
  name: string;
  position: string;     // QB / RB / WR / TE / PICK
  posGroup: string;     // QB / RB / PASS / PICK
  value: number;        // final_value from cfc_team_trade_values_current (or cfc_value for picks)
  tier: string;         // moveable / listening / core / untouchable
  type: "player" | "pick";
  isStud: boolean;
  isYouth: boolean;
  meta: string;         // "QB · DEN · 25" or "Your pick"
  rosterMeta: string;
  ownerTeamId: string;  // who currently owns this asset
};

// ─── Strategy profile (mirrors what advisor expects) ─────────────────────

export type StudioStrategyProfile = {
  team_id: string;
  wants_more: string[];
  qb_market: string;
  rb_market: string;
  wr_market: string;
  te_market: string;
  picks_market: string;
};

// ─── Offer shape ─────────────────────────────────────────────────────────

export type OfferAssetSimple = {
  key: string;
  name: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
};

export type FitScore = {
  total: number;          // 0-100, weighted average
  fairValue: number;      // 0-100
  positionNeed: number;   // 0-100
  wantsMore: number;      // 0-100
  rosterShape: number;    // 0-100
  attachment: number;     // 0-100
};

export type StudioOffer = {
  id: string;                    // synthetic, generated client-side
  partnerTeamId: string;
  partnerTeamName: string;
  persona: PersonaKey;            // which persona produced this offer
  send: OfferAssetSimple[];       // what user gives up
  receive: OfferAssetSimple[];    // what user gets back
  worksForYou: FitScore;
  worksForThem: FitScore;
  sendValue: number;
  receiveValue: number;
};

// ─── Engine context (everything needed to generate offers) ──────────────

export type StudioEngineContext = {
  myTeamId: string;
  myTeamName: string;
  myPersona: PersonaKey;
  myProfile: StudioStrategyProfile | null;
  myRoster: StudioAsset[];
  shopList: StudioAsset[];   // subset of myRoster the user toggled "Y" on
  partners: Array<{
    teamId: string;
    teamName: string;
    profile: StudioStrategyProfile | null;
    roster: StudioAsset[];
  }>;
};

// ─── API response shape ──────────────────────────────────────────────────

export type GenerateOffersResponse = {
  offers: StudioOffer[];
  totalCandidatesEvaluated: number;
};
