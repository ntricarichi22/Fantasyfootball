export type DraftClockStatus = "running" | "paused" | "not_started";

export type DraftStateRow = {
  league_id: string;
  status: DraftClockStatus;
  seconds_remaining: number | null;
  clock_started_at: string | null;
  /** True if the team currently on the clock has submitted their pick but it has not yet been announced. */
  pick_submitted?: boolean | null;
  /** ISO timestamp when the currently-submitted pick will be announced (= clock_started_at + 30 minutes). */
  pick_announced_at?: string | null;
  /** Zero-based index of the pick currently on the clock. */
  current_pick_index?: number | null;
  /** Scheduled draft start time (ISO). When set and in the future + status is not_started, the clock bar shows the pre-draft countdown. */
  starts_at?: string | null;
  updated_at?: string | null;
};

export const INITIAL_PICK_SECONDS = Number(process.env.NEXT_PUBLIC_PICK_SECONDS) || 30 * 60;

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
  const startsAt =
    typeof row.starts_at === "string" && row.starts_at ? row.starts_at : null;
  const pickAnnouncedAt =
    typeof row.pick_announced_at === "string" && row.pick_announced_at ? row.pick_announced_at : null;
  const pickSubmitted = row.pick_submitted === true;
  const currentPickIndex =
    typeof row.current_pick_index === "number" && Number.isFinite(row.current_pick_index)
      ? Math.max(0, Math.round(row.current_pick_index))
      : typeof row.current_pick_index === "string" && row.current_pick_index !== ""
        ? Number.isFinite(Number(row.current_pick_index))
          ? Math.max(0, Math.round(Number(row.current_pick_index)))
          : null
        : null;

  if (!leagueId) return null;

  return {
    league_id: leagueId,
    status,
    seconds_remaining: secondsRemaining,
    clock_started_at: clockStartedAt,
    pick_submitted: pickSubmitted,
    pick_announced_at: pickAnnouncedAt,
    current_pick_index: currentPickIndex,
    starts_at: startsAt,
    updated_at: row.updated_at ?? null,
  };
};

/**
 * Seconds until the currently-submitted pick will be announced.
 * Returns 0 if no pick is submitted or the announcement time has passed.
 */
export const computeSecondsUntilAnnouncement = (
  state?: Partial<DraftStateRow> | null,
  nowMs: number = Date.now()
): number => {
  if (!state || !state.pick_submitted || !state.pick_announced_at) return 0;
  const announceMs = new Date(state.pick_announced_at).getTime();
  if (!Number.isFinite(announceMs)) return 0;
  return Math.max(0, Math.round((announceMs - nowMs) / 1000));
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
