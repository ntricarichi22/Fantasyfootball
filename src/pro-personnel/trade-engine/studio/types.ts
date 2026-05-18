// src/lib/trade/studio/types.ts
//
// Trade Studio types.
//
// v3.4: Canonical types live in core/. This file is now a backwards-compat
// layer — re-exporting RosterAsset as StudioAsset and StrategyProfile as
// StudioStrategyProfile so existing import paths keep working without
// churn. StudioOffer is updated: FitScore is gone; valueGap (Gap) +
// gradeLabel + gradeColor replace worksForYou / worksForThem.

import type {
  RosterAsset,
  StrategyProfile,
  Gap,
  PersonaKey,
  AssetType,
  TeamMode,
} from "../core/types";

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
  persona: PersonaKey;
  send: OfferAssetSimple[];
  receive: OfferAssetSimple[];
  sendValue: number;
  receiveValue: number;
  valueGap: Gap;          // canonical fairness signal
  gradeLabel: string;     // "In the range" / "You're ahead" / etc.
  gradeColor: string;     // hex chip color
  isFallback?: boolean;   // retained on the type but never set in v3.4
};

export type StudioPartner = {
  teamId: string;
  teamName: string;
  profile: StrategyProfile | null;
  roster: RosterAsset[];
};

export type StudioEngineContext = {
  myTeamId: string;
  myTeamName: string;
  myPersona: string;
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
