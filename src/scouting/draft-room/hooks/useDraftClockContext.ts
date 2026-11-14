"use client";

import { useLeagueFetch } from "@/infrastructure/identity/useLeagueFetch";

import { useEffect, useState } from "react";

export type DraftClockContext = {
  season: string;
  round: number;
  pick: number;
  pickIndex: number;
  teamCount: number;
  onClockRosterId: string;
  onClockTeamName: string;
};

const DEFAULT_POLL_MS = 15_000;
const MIN_POLL_MS = 5_000;

type UseDraftClockContextOptions = {
  /** Skip polling entirely (e.g. when the draft is not active). */
  disabled?: boolean;
  /** Poll interval in ms. Defaults to 15s. */
  pollMs?: number;
};

/**
 * Polls `/api/scouting/draft/clock-context` for round / pick / on-the-clock metadata
 * needed by the global ClockBar. Independent of `useDraftStatus` because the
 * data sources (Sleeper league + draft_log) are heavier than the clock state
 * row and only relevant while the draft is active.
 */
export function useDraftClockContext(
  options: UseDraftClockContextOptions = {}
): DraftClockContext | null {
  const fetch = useLeagueFetch();
  const { disabled = false, pollMs = DEFAULT_POLL_MS } = options;
  const [context, setContext] = useState<DraftClockContext | null>(null);
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();

    const fetchOnce = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const res = await fetch("/api/scouting/draft/clock-context", { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: DraftClockContext | null };
        if (cancelled) return;
        setContext(json?.data ?? null);
      } catch {
        // ignore network errors; keep last snapshot
      } finally {
        inFlight = false;
      }
    };

    fetchOnce();
    const interval = window.setInterval(
      fetchOnce,
      Math.max(MIN_POLL_MS, pollMs)
    );
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [disabled, fetch, pollMs]);

  return context;
}
