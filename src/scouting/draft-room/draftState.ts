export type DraftClockStatus = "running" | "paused" | "not_started" | "completed";

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

export const INITIAL_PICK_SECONDS = 1800;

/** 1-round rookie draft, 12 teams */
export const DRAFT_ROUNDS = 1;
export const DRAFT_TEAM_COUNT = 12;
export const TOTAL_DRAFT_PICKS = DRAFT_ROUNDS * DRAFT_TEAM_COUNT;

const normalizeNumber = (value: unknown, fallback: number = INITIAL_PICK_SECONDS) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return fallback;
};

/**
 * Coerce a value that may be a Date, number (epoch ms), or string into an ISO
 * string. Returns null for empty/invalid inputs. Postgres timestamptz columns
 * normally come back from PostgREST as ISO strings, but we accept Date /
 * number too so that locally-constructed rows or alternative drivers don't
 * silently fall through to null (which previously broke the auto-announce
 * comparison in `/api/scouting/draft/tick`).
 */
const normalizeIsoTimestamp = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? value.toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
};

/**
 * Coerce a value that may be a real boolean, the strings "true"/"false"/"t"/"f",
 * or 0/1 into a strict JS boolean. PostgREST returns booleans as real JS
 * booleans, but historically a stricter `=== true` check here masked an
 * upstream bug where any non-`true` shape (e.g. the string "true") silently
 * disabled the auto-announce path.
 */
export const normalizeBoolean = (value: unknown): boolean => {
  if (value === true) return true;
  if (value === 1) return true;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    return lowered === "true" || lowered === "t" || lowered === "1" || lowered === "yes";
  }
  return false;
};

export const normalizeDraftStateRow = (row?: Partial<DraftStateRow> | null): DraftStateRow | null => {
  if (!row) return null;
  const leagueId = typeof row.league_id === "string" ? row.league_id : "";
  const status: DraftClockStatus =
    row.status === "running" || row.status === "paused" || row.status === "not_started" || row.status === "completed"
      ? row.status
      : "not_started";

  const secondsRemaining = normalizeNumber(row.seconds_remaining);
  const clockStartedAt = normalizeIsoTimestamp(row.clock_started_at);
  const startsAt = normalizeIsoTimestamp(row.starts_at);
  const pickAnnouncedAt = normalizeIsoTimestamp(row.pick_announced_at);
  const pickSubmitted = normalizeBoolean(row.pick_submitted);
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
