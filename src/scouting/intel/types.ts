export type Position = "QB" | "RB" | "WR" | "TE";

export const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

export type MarketStance = "buy" | "hold" | "sell" | "unknown";

export type AttachmentLevel = "untouchable" | "core_piece" | "listening" | "moveable";

export type NeedSeverity = "critical" | "moderate" | "set" | "surplus";

export type RosterPlayer = {
  id: string;
  name: string;
  position: Position;
  value: number;
};

export type PositionNeed = {
  position: Position;
  starterCount: number;
  totalCount: number;
  topValue: number;
  severity: NeedSeverity;
};

export type StatedIntent = {
  wantsMore: string[];
  qbMarket: MarketStance;
  rbMarket: MarketStance;
  pcMarket: MarketStance;
  picksMarket: MarketStance;
  persona: string | null;
};

export type BehavioralClass = "move_up" | "stand_pat" | "move_down" | "unknown";

export type BehavioralRead = {
  classification: BehavioralClass;
  reason: string;
  confidence: "high" | "medium" | "low";
};

export type TeamProfile = {
  teamId: string;
  teamName: string;
  isUs: boolean;
  pickSlots: number[];
  firstPick: number | null;
  roster: RosterPlayer[];
  needs: PositionNeed[];
  intent: StatedIntent;
  behavioral: BehavioralRead;
};

export type AvailablePlayer = {
  id: string;
  name: string;
  position: Position;
  value: number;
};