export type MetricKey =
  | "startingQBs"
  | "startingRBs"
  | "startingWRs"
  | "remainingStarters"
  | "qbDepth"
  | "skillDepth";

export interface LeaguePlayerInput {
  sleeperId: string;
  position?: string | null;
}

export interface LeagueTeamInput {
  rosterId: string | number;
  players: LeaguePlayerInput[];
}

export interface TeamMetrics {
  startingQBs: number;
  startingRBs: number;
  startingWRs: number;
  remainingStarters: number;
  qbDepth: number;
  skillDepth: number;
}

export type TeamMetricRanks = Record<MetricKey, number>;

export interface TeamRanking {
  metrics: TeamMetrics;
  ranks: TeamMetricRanks;
}

export interface LeagueRankingsResult {
  teams: Record<string, TeamRanking>;
  teamCount: number;
}

export const TE_FLEX_MULTIPLIER = 0.7;

const defaultMetrics = (): TeamMetrics => ({
  startingQBs: 0,
  startingRBs: 0,
  startingWRs: 0,
  remainingStarters: 0,
  qbDepth: 0,
  skillDepth: 0,
});

const toId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";

const rankMetric = (
  entries: Array<{ rosterId: string; metrics: TeamMetrics }>,
  key: MetricKey
): Map<string, number> => {
  const sorted = [...entries].sort(
    (a, b) => (b.metrics[key] ?? 0) - (a.metrics[key] ?? 0)
  );
  return new Map(sorted.map((entry, idx) => [entry.rosterId, idx + 1]));
};

const takeTop = (values: number[], count: number) =>
  [...values].sort((a, b) => b - a).slice(0, count);

export const computeLeagueRankings = (
  teams: LeagueTeamInput[],
  playerValues: Record<string, number>,
  options?: { teMultiplier?: number }
): LeagueRankingsResult => {
  const teMultiplier = options?.teMultiplier ?? TE_FLEX_MULTIPLIER;

  const entries = teams
    .filter((team) => toId(team.rosterId))
    .map((team) => {
      const metrics = defaultMetrics();
      const qbValues: number[] = [];
      const rbValues: number[] = [];
      const wrValues: number[] = [];
      const teValues: number[] = [];

      team.players.forEach((player) => {
        const id = toId(player.sleeperId);
        if (!id) return;
        const position = player.position?.toUpperCase();
        const value = playerValues[id] ?? 0;
        if (!Number.isFinite(value) || value <= 0) return;
        if (position === "QB") qbValues.push(value);
        else if (position === "RB") rbValues.push(value);
        else if (position === "WR") wrValues.push(value);
        else if (position === "TE") teValues.push(value * teMultiplier);
      });

      const qbSorted = [...qbValues].sort((a, b) => b - a);
      metrics.startingQBs = takeTop(qbSorted, 2).reduce((sum, v) => sum + v, 0);
      metrics.qbDepth = qbSorted[2] ?? 0;

      const rbSorted = [...rbValues].sort((a, b) => b - a);
      const wrSorted = [...wrValues].sort((a, b) => b - a);
      const teAdjusted = [...teValues].sort((a, b) => b - a);

      const rbStarters = rbSorted.slice(0, 2);
      const wrStarters = wrSorted.slice(0, 3);

      metrics.startingRBs = rbStarters.reduce((sum, v) => sum + v, 0);
      metrics.startingWRs = wrStarters.reduce((sum, v) => sum + v, 0);

      const rbRemaining = rbSorted.slice(2);
      const wrRemaining = wrSorted.slice(3);

      const flexCandidates = [
        ...rbRemaining.map((v) => ({ value: v, source: "RB" as const })),
        ...wrRemaining.map((v) => ({ value: v, source: "WR" as const })),
        ...teAdjusted.map((v) => ({ value: v, source: "TE" as const })),
      ].sort((a, b) => b.value - a.value);

      const flexPicks = flexCandidates.slice(0, 2);
      metrics.remainingStarters = flexPicks.reduce((sum, item) => sum + item.value, 0);

      const flexUsage = flexPicks.reduce<Record<string, number>>((acc, item) => {
        acc[item.source] = (acc[item.source] ?? 0) + 1;
        return acc;
      }, {});

      const rbAfterFlex = rbRemaining.slice(flexUsage.RB ?? 0);
      const wrAfterFlex = wrRemaining.slice(flexUsage.WR ?? 0);
      const teAfterFlex = teAdjusted.slice(flexUsage.TE ?? 0);

      const depthPool = [
        ...rbAfterFlex.map((v) => ({ value: v })),
        ...wrAfterFlex.map((v) => ({ value: v })),
        ...teAfterFlex.map((v) => ({ value: v })),
      ]
        .sort((a, b) => b.value - a.value)
        .slice(0, 3);

      metrics.skillDepth = depthPool.reduce((sum, item) => sum + item.value, 0);

      return { rosterId: toId(team.rosterId), metrics };
    });

  const metricKeys: MetricKey[] = [
    "startingQBs",
    "startingRBs",
    "startingWRs",
    "remainingStarters",
    "qbDepth",
    "skillDepth",
  ];

  const rankMaps: Record<MetricKey, Map<string, number>> = Object.fromEntries(
    metricKeys.map((key) => [key, rankMetric(entries, key)])
  ) as Record<MetricKey, Map<string, number>>;

  const teamsRanking: Record<string, TeamRanking> = Object.fromEntries(
    entries.map((entry) => {
      const ranks = Object.fromEntries(
        metricKeys.map((key) => [key, rankMaps[key].get(entry.rosterId) ?? entries.length])
      ) as TeamMetricRanks;
      return [entry.rosterId, { metrics: entry.metrics, ranks }];
    })
  );

  return { teams: teamsRanking, teamCount: entries.length };
};

// Bands default to 12-team league unless a teamCount override is provided.
const MIN_MIDDLE_BAND_SIZE = 8; // keeps middle band reasonable for small leagues
export const rankBandLabel = (rank?: number, teamCount = 12) => {
  if (rank === undefined || rank === null) return "N/A";
  if (rank === 1) return "Best in league";
  if (rank <= 2) return "Top 2";
  if (rank <= 4) return "Top 4";
  if (rank <= Math.max(MIN_MIDDLE_BAND_SIZE, Math.ceil(teamCount / 2))) return "Middle of the pack";
  if (rank <= teamCount - 2) return "Bottom 4";
  return "Bottom 2";
};
