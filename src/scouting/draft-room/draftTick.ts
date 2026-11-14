export function shouldPollDraftTick(status: string, startsAt: string | null | undefined, now = Date.now()): boolean {
  if (status === "running") return true;
  const start = startsAt ? Date.parse(startsAt) : NaN;
  return status === "not_started" && Number.isFinite(start) && start <= now;
}

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
