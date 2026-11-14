/** Poll retries after every completed attempt, including a revision conflict.
 * The shared requester preserves command identity after ambiguous failures. */
export function createDraftTickPoller(send: typeof fetch, onAdvanced: () => void, isDue: () => boolean) {
  let inFlight = false;
  return async () => {
    if (inFlight || !isDue()) return;
    inFlight = true;
    try {
      const response = await send("/api/scouting/draft/state", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tick" }), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const data = await response.json();
      if (Number(data.steps) > 0) onAdvanced();
    } catch { /* A later interval retries transient failures. */ }
    finally { inFlight = false; }
  };
}

/** One scheduler for start, skip and reveal deadlines, with retry and teardown. */
export function startDraftTickPolling(poll: () => Promise<void>, deadline: number | null, disabled = false) {
  if (disabled || deadline === null || !Number.isFinite(deadline)) return () => {};
  let cancelled = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleDeadline = () => {
    if (cancelled) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) { void poll(); return; }
    // Browser timers overflow beyond ~24.8 days; re-arm long schedules safely.
    deadlineTimer = setTimeout(scheduleDeadline, Math.min(remaining, 2_147_483_647));
  };
  scheduleDeadline();
  const retryTimer = setInterval(() => { void poll(); }, 3000);
  return () => {
    cancelled = true;
    clearTimeout(deadlineTimer);
    clearInterval(retryTimer);
  };
}
