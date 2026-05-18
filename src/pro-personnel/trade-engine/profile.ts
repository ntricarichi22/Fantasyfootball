import type { DraftPick } from "@/infrastructure/picks";
import { getPickValue } from "./value";

export type TeamMode = "contend" | "retool" | "rebuild";
export type TeamPosture = "buyer" | "neutral" | "seller";
export type PositionKey = "QB" | "RB" | "WR" | "TE";

export type ProfilePlayer = {
  id: string;
  position?: string | null;
  value?: number | null;
  age?: number | null;
  isStarter?: boolean;
};

export type ProfileTeam = {
  rosterId: number | string;
  players: ProfilePlayer[];
  picks?: DraftPick[];
};

export type LeagueProfileSettings = {
  superflex?: boolean;
  teDiscount?: number;
  qbPremium?: number;
  teamCount?: number;
  cfcValues?: Record<string, number | null | undefined>;
};

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

const STARTER_LIMITS: Record<PositionKey, number> = {
  QB: 2,
  RB: 2,
  WR: 3,
  TE: 1,
};

const bandLabel = (rank: number, teamCount: number) => {
  if (rank <= Math.max(2, Math.ceil(teamCount / 4))) return "top tier";
  if (rank <= Math.max(4, Math.ceil(teamCount / 2))) return "top half";
  if (rank >= teamCount - 1) return "bottom 2";
  if (rank >= teamCount - Math.max(2, Math.ceil(teamCount / 4))) return "bottom tier";
  return "middle tier";
};

const positionalScore = (players: ProfilePlayer[], position: PositionKey, teDiscount: number, qbPremium: number = 1) => {
  const limit = STARTER_LIMITS[position];
  const adjustValue = (v: number) => {
    if (position === "QB") return v * qbPremium;
    if (position === "TE") return v * teDiscount;
    return v;
  };
  const sorted = players
    .filter((p) => (p.position || "").toUpperCase() === position)
    .map((p) => ({
      ...p,
      adjusted: adjustValue(p.value ?? 0),
    }))
    .sort((a, b) => (b.adjusted ?? 0) - (a.adjusted ?? 0))
    .slice(0, limit);
  return sorted.reduce((sum, p) => sum + (p.adjusted ?? 0), 0);
};

const computeNeeds = (ranks: Record<PositionKey, number>, teamCount: number) => {
  const ordered = (Object.keys(ranks) as PositionKey[]).sort((a, b) => ranks[b] - ranks[a]);
  const labels: Record<PositionKey, string> = {
    QB: "needs QB2",
    RB: "needs RB depth",
    WR: "needs WR depth",
    TE: "needs TE upgrade",
  };
  const needs = ordered.slice(0, 2).map((pos) => labels[pos]);
  if (needs[0] === needs[1]) return [needs[0]].filter(Boolean);
  if (teamCount <= 4) return needs.slice(0, 1);
  return needs;
};

const pickAgeStats = (players: ProfilePlayer[]) => {
  const ages = players
    .map((p) => p.age)
    .filter((age): age is number => typeof age === "number" && Number.isFinite(age));
  if (!ages.length) return { averageAge: null, youngShare: 0, veteranShare: 0 };
  const averageAge = ages.reduce((sum, age) => sum + age, 0) / ages.length;
  const youngShare = ages.filter((age) => age <= 25).length / ages.length;
  const veteranShare = ages.filter((age) => age >= 29).length / ages.length;
  return { averageAge, youngShare, veteranShare };
};

const modeFromRank = (valueRank: number, teamCount: number, averageAge: number | null) => {
  const topBand = Math.ceil(teamCount / 3);
  const bottomBand = teamCount - Math.floor(teamCount / 3);
  if (valueRank <= topBand) return averageAge && averageAge < 26 ? "retool" : "contend";
  if (valueRank >= bottomBand) return averageAge && averageAge >= 28 ? "retool" : "rebuild";
  if (averageAge !== null && averageAge < 25) return "rebuild";
  if (averageAge !== null && averageAge > 28) return "contend";
  return "retool";
};

const postureFromMode = (mode: TeamMode): TeamPosture => {
  if (mode === "contend") return "buyer";
  if (mode === "rebuild") return "seller";
  return "neutral";
};

export const buildLeagueProfiles = (
  teams: ProfileTeam[],
  settings?: LeagueProfileSettings
): Record<string | number, TeamProfile> => {
  const teamCount = settings?.teamCount ?? teams.length ?? 12;
  const teDiscount = settings?.teDiscount ?? 0.75;
  const qbPremium = settings?.qbPremium ?? 1.25;
  const cfcValues = settings?.cfcValues;
  const allTotals = teams.map((team) => {
    const pickTotal = (team.picks ?? []).reduce(
      (sum, pick) => sum + getPickValue(pick, { teamCount, cfcValues }),
      0
    );
    const playerTotal = team.players.reduce((sum, player) => sum + (player.value ?? 0), 0);
    return { rosterId: team.rosterId, totalValue: pickTotal + playerTotal };
  });

  const totalRanks = [...allTotals]
    .sort((a, b) => b.totalValue - a.totalValue)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const positionalStrengths: Record<string | number, Record<PositionKey, number>> = {};
  teams.forEach((team) => {
    const scores = {
      QB: positionalScore(team.players, "QB", teDiscount, qbPremium),
      RB: positionalScore(team.players, "RB", teDiscount, qbPremium),
      WR: positionalScore(team.players, "WR", teDiscount, qbPremium),
      TE: positionalScore(team.players, "TE", teDiscount, qbPremium),
    };
    positionalStrengths[team.rosterId] = scores;
  });

  const ranksByPosition: Record<PositionKey, Array<{ rosterId: string | number; score: number }>> = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
  };

  Object.entries(positionalStrengths).forEach(([rosterId, scores]) => {
    (Object.keys(scores) as PositionKey[]).forEach((pos) => {
      ranksByPosition[pos].push({ rosterId, score: scores[pos] });
    });
  });

  const positionRanks: Record<string | number, Record<PositionKey, number>> = {};
  (Object.keys(ranksByPosition) as PositionKey[]).forEach((pos) => {
    ranksByPosition[pos]
      .sort((a, b) => b.score - a.score)
      .forEach((entry, index) => {
        if (!positionRanks[entry.rosterId]) {
          positionRanks[entry.rosterId] = { QB: 0, RB: 0, WR: 0, TE: 0 };
        }
        positionRanks[entry.rosterId][pos] = index + 1;
      });
  });

  const profiles: Record<string | number, TeamProfile> = {};

  teams.forEach((team) => {
    const totals = totalRanks.find((entry) => entry.rosterId === team.rosterId);
    const averageRank = totals?.rank ?? teamCount;
    const totalValue = totals?.totalValue ?? 0;
    const { averageAge } = pickAgeStats(team.players);
    const posRanks = positionRanks[team.rosterId] ?? { QB: teamCount, RB: teamCount, WR: teamCount, TE: teamCount };
    const bands: Record<PositionKey, string> = {
      QB: bandLabel(posRanks.QB, teamCount),
      RB: bandLabel(posRanks.RB, teamCount),
      WR: bandLabel(posRanks.WR, teamCount),
      TE: bandLabel(posRanks.TE, teamCount),
    };
    const needs = computeNeeds(posRanks, teamCount);
    const mode = modeFromRank(averageRank, teamCount, averageAge);
    const posture = postureFromMode(mode);

    profiles[team.rosterId] = {
      rosterId: team.rosterId,
      mode,
      posture,
      positionRanks: posRanks,
      positionBands: bands,
      needs,
      totalValue,
      averageAge,
    };
  });

  return profiles;
};
