export type DraftClockStatus = "running" | "paused" | "not_started";

export type DraftStateRow = {
  league_id: string;
  status: DraftClockStatus;
  seconds_remaining: number | null;
  clock_started_at: string | null;
  updated_at?: string | null;
};

export const INITIAL_PICK_SECONDS = 30 * 60;

const normalizeNumber = (value: unknown, fallback: number = INITIAL_PICK_SECONDS) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return fallback;
};

export const normalizeDraftStateRow = (row?: Partial<DraftStateRow> | null): DraftStateRow | null => {
  if (!row) return null;
  const leagueId = typeof row.league_id === "string" ? row.league_id : "";
  const status: DraftClockStatus =
    row.status === "running" || row.status === "paused" || row.status === "not_started"
      ? row.status
      : "not_started";

  const secondsRemaining = normalizeNumber(row.seconds_remaining);
  const clockStartedAt =
    typeof row.clock_started_at === "string" && row.clock_started_at ? row.clock_started_at : null;

  if (!leagueId) return null;

  return {
    league_id: leagueId,
    status,
    seconds_remaining: secondsRemaining,
    clock_started_at: clockStartedAt,
    updated_at: row.updated_at ?? null,
  };
};

export const computeRemainingSeconds = (
  state?: Partial<DraftStateRow> | null,
  nowMs: number = Date.now()
) => {
  if (!state) return INITIAL_PICK_SECONDS;
  const base = normalizeNumber(state.seconds_remaining);
  if (state.status !== "running") return base;
  const startedAt = state.clock_started_at ? new Date(state.clock_started_at).getTime() : NaN;
  if (!Number.isFinite(startedAt)) return base;
  const elapsed = Math.max(0, (nowMs - startedAt) / 1000);
  return Math.max(0, Math.round(base - elapsed));
};
