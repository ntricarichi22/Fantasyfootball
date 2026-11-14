type DraftDeadlineState = {
  status?: string; starts_at?: string | null; pick_submitted?: boolean | null;
  pick_announced_at?: string | null; clock_started_at?: string | null; seconds_remaining?: number | null;
};

/** The same server timestamps drive browser wakeups and server due checks. */
export function draftTickDeadline(state: DraftDeadlineState | null | undefined): number | null {
  if (!state || !["not_started", "running"].includes(state.status ?? "")) return null;
  const deadline = state.status === "not_started" ? Date.parse(state.starts_at ?? "") :
    state.pick_submitted ? Date.parse(state.pick_announced_at ?? "") :
    Date.parse(state.clock_started_at ?? "") + Number(state.seconds_remaining ?? 0) * 1000;
  return Number.isFinite(deadline) ? deadline : null;
}

/** A read-only poll must not allocate an atomic command before a transition is due. */
export function dueDraftDeadline(state: DraftDeadlineState | null | undefined, now = Date.now()): number | null {
  const deadline = draftTickDeadline(state);
  return deadline !== null && deadline <= now ? deadline : null;
}
