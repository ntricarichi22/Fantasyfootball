import type { PositionKey, TeamProfile } from "@/pro-personnel/trade-engine/profile";
import type {
  AvailablePlayer,
  DraftBoardFilter,
  RookieProspect,
  SleeperPlayer,
} from "./types";

/**
 * Map a player's position to a board-filter group. Returns null for positions
 * that do not appear on the draft board (defensive, kickers, etc).
 */
const filterMatches = (player: AvailablePlayer, filter: DraftBoardFilter) => {
  switch (filter) {
    case "ALL":
      return true;
    case "QB":
      return player.position === "QB";
    case "RB":
      return player.position === "RB";
    case "PASS":
      return player.position === "WR" || player.position === "TE";
    case "ROOKIE":
      return player.isRookie;
    case "VET":
      return !player.isRookie;
    default:
      return true;
  }
};

export const filterDraftBoard = (
  players: AvailablePlayer[],
  filter: DraftBoardFilter
): AvailablePlayer[] => players.filter((player) => filterMatches(player, filter));

const POSITION_KEYS: PositionKey[] = ["QB", "RB", "WR", "TE"];

/**
 * Compute a personalized fit score for each available player given the
 * logged-in owner's `TeamProfile.positionRanks` (1 = strongest position in
 * league, higher = weaker). The owner's weakest position scores ~100, the
 * strongest ~0. Within a position, the player's own value score nudges fit so
 * a high-value RB on an RB-needy roster beats a low-value RB on the same
 * roster.
 */
export const computeFitScore = (
  player: AvailablePlayer,
  profile: TeamProfile | null,
  teamCount: number
): number => {
  if (!profile) return player.valueScore;
  const pos = player.position as PositionKey;
  if (!POSITION_KEYS.includes(pos)) return player.valueScore;
  const denom = Math.max(teamCount, 2);
  const rank = profile.positionRanks[pos] || denom;
  // weakness: 0 (strongest, rank 1) → 1 (weakest, rank = teamCount)
  const weakness = Math.max(0, Math.min(1, (rank - 1) / Math.max(denom - 1, 1)));
  const positionalFit = weakness * 100;
  // 70% positional weakness, 30% personal value to differentiate within pos.
  const blended = positionalFit * 0.7 + player.valueScore * 0.3;
  return Math.round(Math.max(0, Math.min(100, blended)));
};

/**
 * Convert a sorted index (0 = top of board) into a 0-100 value score.
 * Top-ranked player → 100; lowest → ~1.
 */
export const valueScoreFromRank = (rankIndex: number, totalCount: number): number => {
  if (totalCount <= 1) return 100;
  const normalized = 1 - rankIndex / (totalCount - 1);
  return Math.round(Math.max(1, Math.min(100, normalized * 100)));
};

/* ------------------------------------------------------------------ *
 *  Letter grades
 * ------------------------------------------------------------------ */

export type LetterGrade =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D";

export type ScoutingGrade = {
  letter: LetterGrade | "TBD" | "—";
  title: string;
  detail: string;
};

export type ScoutingGradeSet = {
  capital: ScoutingGrade;
  situation: ScoutingGrade;
  opportunity: ScoutingGrade;
};

/** NFL pick → draft capital letter grade per spec. */
export const draftCapitalGrade = (pick: number | null | undefined): LetterGrade | "TBD" => {
  if (pick === null || pick === undefined) return "TBD";
  if (pick <= 0) return "D";
  if (pick <= 5) return "A+";
  if (pick <= 10) return "A";
  if (pick <= 20) return "A-";
  if (pick <= 40) return "B+";
  if (pick <= 64) return "B";
  if (pick <= 100) return "B-";
  if (pick <= 135) return "C+";
  if (pick <= 175) return "C";
  return "C-";
};

const overallPick = (round: number | null | undefined, pick: number | null | undefined) => {
  if (round && pick) return (round - 1) * 32 + pick;
  if (pick) return pick;
  return null;
};

export const buildCapitalGrade = (
  player: SleeperPlayer | undefined,
  prospect?: RookieProspect | null
): ScoutingGrade => {
  // Prefer the curated rookie_prospects bio when present (post-NFL-draft
  // the table is updated with team / round / pick); fall back to whatever
  // Sleeper has on file. If neither has the NFL Draft outcome yet, show
  // the "Pending" placeholder rather than an empty card.
  const round = prospect?.nfl_draft_round ?? player?.draft_round ?? null;
  const pick = prospect?.nfl_draft_pick ?? player?.draft_pick ?? null;
  const team = prospect?.nfl_team ?? player?.team ?? null;

  if (round === null && pick === null) {
    return {
      letter: "—",
      title: "Draft Capital",
      detail: team ? `${team} · NFL Draft — April 23-25` : "NFL Draft — April 23-25",
    };
  }

  const overall = overallPick(round, pick);
  const letter: LetterGrade | "TBD" = draftCapitalGrade(overall);
  const teamLabel = team || "—";
  if (round && pick) {
    return {
      letter,
      title: "Draft Capital",
      detail: `${teamLabel} · Round ${round}, Pick ${pick}`,
    };
  }
  return {
    letter,
    title: "Draft Capital",
    detail: `${teamLabel} · TBD`,
  };
};

const teamContextFor = (contextMap: NflTeamContextMap, team: string | undefined): NflTeamContext =>
  (team && contextMap[team]) || {};

/* ----- NFL team trade-context map (shared by situation + opportunity) -- */

export type NflTeamPlayer = {
  name: string;
  value: number;
};

export type NflTeamContext = Partial<Record<PositionKey, NflTeamPlayer>>;

/**
 * Map of NFL team code → highest-value rostered player at each position
 * (sourced from `cfc_team_trade_values_current` aggregated across the league).
 */
export type NflTeamContextMap = Record<string, NflTeamContext>;

const valueTier = (value: number): { letter: LetterGrade; tier: string } => {
  if (value >= 80) return { letter: "A+", tier: "Top 5" };
  if (value >= 65) return { letter: "A", tier: "Top 10" };
  if (value >= 50) return { letter: "B+", tier: "Top 15" };
  if (value >= 35) return { letter: "B", tier: "Top 20" };
  if (value >= 20) return { letter: "C+", tier: "starter" };
  return { letter: "C", tier: "depth" };
};

export const buildSituationGrade = (
  player: SleeperPlayer | undefined,
  position: string,
  contextMap: NflTeamContextMap,
  prospect?: RookieProspect | null
): ScoutingGrade => {
  const team = prospect?.nfl_team ?? player?.team;
  if (!team) {
    return { letter: "—", title: "Situation", detail: "Pending NFL Draft" };
  }
  const context = teamContextFor(contextMap, team);

  if (position === "WR" || position === "TE") {
    const qb = context.QB;
    if (!qb) {
      return {
        letter: "C",
        title: "Situation",
        detail: `No established QB context for ${team}`,
      };
    }
    const tier = valueTier(qb.value);
    return {
      letter: tier.letter,
      title: "Situation",
      detail: `Catches passes from ${qb.name}. QB: ${qb.name} (${tier.tier})`,
    };
  }

  if (position === "RB") {
    const offensiveValue =
      (context.QB?.value || 0) + (context.WR?.value || 0) + (context.TE?.value || 0);
    const tier = valueTier(offensiveValue / 2);
    const qbName = context.QB?.name;
    return {
      letter: tier.letter,
      title: "Situation",
      detail: qbName
        ? `Offense led by ${qbName}. Skill value (${tier.tier})`
        : `Offensive context (${tier.tier})`,
    };
  }

  if (position === "QB") {
    const wr = context.WR;
    if (!wr) {
      return { letter: "C", title: "Situation", detail: `Limited skill talent on ${team}` };
    }
    const tier = valueTier(wr.value);
    return {
      letter: tier.letter,
      title: "Situation",
      detail: `Throws to ${wr.name} (${tier.tier})`,
    };
  }

  return { letter: "C", title: "Situation", detail: `${team} depth chart unclear` };
};

export const buildOpportunityGrade = (
  player: SleeperPlayer | undefined,
  position: string,
  contextMap: NflTeamContextMap,
  prospect?: RookieProspect | null
): ScoutingGrade => {
  const team = prospect?.nfl_team ?? player?.team;
  if (!team || !position) {
    return { letter: "—", title: "Opportunity", detail: "Pending NFL Draft" };
  }
  const incumbent = teamContextFor(contextMap, team)[position as PositionKey];
  if (!incumbent || incumbent.value < 15) {
    return {
      letter: "A+",
      title: "Opportunity",
      detail: `No established ${position} on roster`,
    };
  }
  if (incumbent.value < 35) {
    return {
      letter: "B",
      title: "Opportunity",
      detail: `Splits work with ${incumbent.name}`,
    };
  }
  if (incumbent.value < 60) {
    return {
      letter: "C+",
      title: "Opportunity",
      detail: `Behind ${incumbent.name} on depth chart`,
    };
  }
  return {
    letter: "D",
    title: "Opportunity",
    detail: `Buried behind ${incumbent.name}`,
  };
};

export const buildScoutingGrades = (
  player: SleeperPlayer | undefined,
  position: string,
  contextMap: NflTeamContextMap,
  prospect?: RookieProspect | null
): ScoutingGradeSet => ({
  capital: buildCapitalGrade(player, prospect),
  situation: buildSituationGrade(player, position, contextMap, prospect),
  opportunity: buildOpportunityGrade(player, position, contextMap, prospect),
});

/* ------------------------------------------------------------------ *
 *  Grade color tokens (consumed by the modal)
 * ------------------------------------------------------------------ */

export const gradeColors = (
  letter: LetterGrade | "TBD" | "—"
): { bg: string; text: string } => {
  switch (letter) {
    case "A+":
      return { bg: "#d4f5d4", text: "#1a7a2e" };
    case "A":
    case "A-":
      return { bg: "#d0e0f7", text: "#3366CC" };
    case "B+":
    case "B":
      return { bg: "#F5C230", text: "#8a6d00" };
    case "B-":
      return { bg: "#ffe0b2", text: "#8a6d00" };
    case "C+":
    case "C":
    case "C-":
      return { bg: "#eee", text: "#666" };
    case "D":
      return { bg: "#eee", text: "#999" };
    default:
      return { bg: "#eee", text: "#999" };
  }
};
