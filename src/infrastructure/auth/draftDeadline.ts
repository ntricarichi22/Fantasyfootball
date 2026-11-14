/** A read-only poll must not allocate an atomic command before a transition is due. */
export function dueDraftDeadline(state: {
  status?: string; starts_at?: string | null; pick_submitted?: boolean;
  pick_announced_at?: string | null; clock_started_at?: string | null; seconds_remaining?: number;
} | null | undefined, now = Date.now()): number | null {
  if (!state || !["not_started", "running"].includes(state.status ?? "")) return null;
  const deadline = state.status === "not_started" ? Date.parse(state.starts_at ?? "") :
    state.pick_submitted ? Date.parse(state.pick_announced_at ?? "") :
    Date.parse(state.clock_started_at ?? "") + Number(state.seconds_remaining ?? 0) * 1000;
  return Number.isFinite(deadline) && deadline <= now ? deadline : null;
}
