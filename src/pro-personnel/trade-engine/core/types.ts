// src/lib/trade/core/types.ts
//
// Canonical types for the trade engine — single source of truth.
// Both Builder (advisor/) and Studio (studio/) import from here.

export type AssetType = "player" | "pick";

export type TeamMode = "contend" | "retool" | "rebuild";

export type PersonaKey = "closer" | "straight_shooter" | "architect" | "hustler";

// ─── Asset shapes ──────────────────────────────────────────────────────

export type RosterAsset = {
  key: string;
  name: string;
  position: string;       // QB / RB / WR / TE / PICK
  posGroup: string;       // QB / RB / PASS / PICK
  type: AssetType;
  meta: string;           // "QB · BUF · 26"  for players, "2025 Rd 1.04"  for picks
  rosterMeta: string;     // shorter display variant (used in suggestion rows)

  value: number;
  tier: string;           // "untouchable" / "core" / "listening" / "moveable"  (loose)

  isStud: boolean;
  isYouth: boolean;
  isAging?: boolean;          // Studio extra
  isStarterLevel?: boolean;   // Studio extra (computed via core/classification)

  // Pick-only fields (when type === "pick")
  pickYear?: number;
  pickRound?: number;
  pickSlot?: number;

  // Studio extra: which team this asset belongs to (used in candidate gen)
  ownerTeamId?: string;
};

export type DealAsset = {
  key: string;
  name: string;
  fromTeamId: string;
  toTeamId: string;
};

export type StrategyProfile = {
  team_id: string;
  wants_more: string[];
  qb_market: string;          // "buy" | "sell" | "hold"
  rb_market: string;
  wr_market: string;
  te_market: string;
  picks_market: string;
  team_mode?: TeamMode;
  gm_persona?: PersonaKey;
};

// ─── Gap analysis ──────────────────────────────────────────────────────

export type GapVerdict =
  | "EMPTY"
  | "RECV_ONLY"
  | "SEND_ONLY"
  | "MASSIVE_FAVOR_USER"
  | "STRONG_FAVOR_USER"
  | "SLIGHT_FAVOR_USER"
  | "FAIR"
  | "SLIGHT_FAVOR_OTHER"
  | "STRONG_FAVOR_OTHER"
  | "MASSIVE_FAVOR_OTHER";

export type Gap = {
  sendValue: number;
  receiveValue: number;
  ratio: number;        // receiveValue / sendValue (from user perspective)
  delta: number;        // receiveValue - sendValue
  verdict: GapVerdict;
  hasSend: boolean;
  hasReceive: boolean;
};

export type GradeBucket =
  | "great"
  | "ahead"
  | "fair"
  | "reaching"
  | "way_off"
  | "incomplete";

export type Grade = {
  label: string;
  color: string;
  bucket: GradeBucket;
};

// ─── Liquidity ─────────────────────────────────────────────────────────

export type LiquidityTier = "S" | "A" | "B" | "C";

// ─── Warnings ──────────────────────────────────────────────────────────

export type PostTradeWarning = {
  severity: "info" | "warning" | "alarm";
  message: string;
};
