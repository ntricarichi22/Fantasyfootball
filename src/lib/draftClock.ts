export const DRAFT_TOTAL_SECONDS = 5 * 60;

export type DraftClockStatus = "running" | "paused";

export type DraftStateRow = {
  league_id?: string | null;
  status?: DraftClockStatus | null;
  seconds_remaining?: number | null;
  clock_started_at?: string | null;
  updated_at?: string | null;
};

export type DraftClockState = {
  leagueId: string;
  status: DraftClockStatus;
  secondsRemaining: number;
  clockStartedAt: string | null;
  updatedAt: string | null;
};

const normalizeSeconds = (value?: number | null) => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  return DRAFT_TOTAL_SECONDS;
};

export const defaultDraftClockState = (leagueId: string): DraftClockState => ({
  leagueId,
  status: "paused",
  secondsRemaining: DRAFT_TOTAL_SECONDS,
  clockStartedAt: null,
  updatedAt: null,
});

export const normalizeDraftClockState = (
  row: DraftStateRow | null | undefined,
  leagueId: string
): DraftClockState => {
  if (!row) return defaultDraftClockState(leagueId);
  const status: DraftClockStatus = row.status === "paused" ? "paused" : "running";
  const secondsRemaining = normalizeSeconds(row.seconds_remaining);
  return {
    leagueId: row.league_id ?? leagueId,
    status,
    secondsRemaining,
    clockStartedAt: row.clock_started_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
};

export const computeClockRemaining = (state: DraftClockState) => {
  const baseSeconds = normalizeSeconds(state.secondsRemaining);
  if (state.status === "paused") return baseSeconds;
  const startedAt = state.clockStartedAt ? new Date(state.clockStartedAt).getTime() : 0;
  if (!startedAt) return baseSeconds;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  return Math.max(0, baseSeconds - elapsed);
};
