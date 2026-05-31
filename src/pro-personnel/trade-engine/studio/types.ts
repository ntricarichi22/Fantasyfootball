// src/lib/trade/studio/types.ts
//
// Trade Studio types.
//
// v3.12: per-partner persona restructure.
//   - `StudioPartner.persona` added (required). Each partner now carries
//     their own GM persona which drives the SHAPE of offers they would
//     propose to the user. The user's persona no longer shapes any
//     candidates in Studio — only used for the chip's "OUR band check".
//   - `StudioEngineContext.myPersona` tightened to PersonaKey (was loose
//     string).

import type {
  RosterAsset,
  StrategyProfile,
  Gap,
  PersonaKey,
  AssetType,
  TeamMode,
} from "@/pro-personnel/engine/core/types";

// ─── Re-exports for backwards compat ───────────────────────────────────

export type { RosterAsset, StrategyProfile, Gap, PersonaKey, AssetType, TeamMode };

export type StudioAsset = RosterAsset;
export type StudioStrategyProfile = StrategyProfile;
export type StudioAssetType = AssetType;

// ─── Studio-specific types ─────────────────────────────────────────────

export type OfferAssetSimple = {
  key: string;
  name: string;
  type: AssetType;
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
};

export type StudioOffer = {
  id: string;
  partnerTeamId: string;
  partnerTeamName: string;
  persona: PersonaKey;          // partner's persona (offering team's persona)
  send: OfferAssetSimple[];
  receive: OfferAssetSimple[];
  sendValue: number;
  receiveValue: number;
  valueGap: Gap;                // canonical fairness signal
  gradeLabel: string;           // "We should take this deal" / "I'd push for more here" / etc.
  gradeColor: string;           // hex chip color
  isFallback?: boolean;         // retained on the type but never set in v3.4+
};

export type StudioPartner = {
  teamId: string;
  teamName: string;
  profile: StrategyProfile | null;
  persona: PersonaKey;          // NEW v3.12 — drives candidate shape for this partner
  roster: RosterAsset[];
};

export type StudioEngineContext = {
  myTeamId: string;
  myTeamName: string;
  myPersona: PersonaKey;        // tightened from string — used for chip's OUR-band check only
  myProfile: StrategyProfile | null;
  myRoster: RosterAsset[];
  shopList: RosterAsset[];
  partners: StudioPartner[];
};

export type GenerationResult = {
  offers: StudioOffer[];
  totalCandidatesEvaluated: number;
  isFallback: boolean;
};