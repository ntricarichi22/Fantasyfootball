export type TeamMode = "contend" | "retool" | "rebuild";
export type TeamPosture = "buyer" | "neutral" | "seller";
export type PositionKey = "QB" | "RB" | "WR" | "TE";

export type TeamProfile = {
  rosterId: number | string;
  mode: TeamMode;
  posture: TeamPosture;
  positionRanks: Record<PositionKey, number>;
  positionBands: Record<PositionKey, string>;
  needs: string[];
  totalValue: number;
  averageAge: number | null;
};
