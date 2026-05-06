// Trade Studio engine types.
//
// v3 changes:
//   - StudioAsset gains: isAging, isStarterLevel, pickYear/Round/Slot
//   - StudioStrategyProfile gains: team_mode (contend/retool/rebuild)
//   - StudioOffer gains: isFallback (offer came from fallback path)
//   - GenerationResult: top-level return type with fallback flag

export type StudioAssetType = "player" | "pick";

export type TeamMode = "contend" | "retool" | "rebuild";

export type StudioAsset = {
  // Identity
  key: string;
  name: string;

  // Player/pick metadata
  position: string;
  posGroup: string;
  type: StudioAssetType;
  meta: string;
  rosterMeta: string;
  ownerTeamId?: string;

  // Value & attachment
  value: number;
  tier: string;

  // Player class flags (computed in classification.ts)
  isStud: boolean;          // elite_multiplier_applied > 1.0
  isYouth: boolean;         // age_multiplier_applied > 1.0
  isAging?: boolean;        // age_multiplier_applied < 1.0
  isStarterLevel?: boolean; // top-N at position by value, excluding studs

  // Pick fields (only for type === "pick")
  pickYear?: number;
  pickRound?: number;
  pickSlot?: number;
};

export type StudioStrategyProfile = {
  team_id: string;
  wants_more: string[];
  qb_market: string;
  rb_market: string;
  wr_market: string;
  te_market: string;
  picks_market: string;
  team_mode?: TeamMode;
};

export type FitScore = {
  total: number;
  fairValue: number;
  positionNeed: number;
  wantsMore: number;
  rosterShape: number;
  attachment: number;
};

export type OfferAssetSimple = {
  key: string;
  name: string;
  type: StudioAssetType;
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
};

export type StudioOffer = {
  id: string;
  partnerTeamId: string;
  partnerTeamName: string;
  persona: string;
  send: OfferAssetSimple[];
  receive: OfferAssetSimple[];
  worksForYou: FitScore;
  worksForThem: FitScore;
  sendValue: number;
  receiveValue: number;
  isFallback?: boolean;
};

export type StudioPartner = {
  teamId: string;
  teamName: string;
  profile: StudioStrategyProfile | null;
  roster: StudioAsset[];
};

export type StudioEngineContext = {
  myTeamId: string;
  myTeamName: string;
  myPersona: string;
  myProfile: StudioStrategyProfile | null;
  myRoster: StudioAsset[];
  shopList: StudioAsset[];
  partners: StudioPartner[];
};

export type GenerationResult = {
  offers: StudioOffer[];
  totalCandidatesEvaluated: number;
  isFallback: boolean;
};
