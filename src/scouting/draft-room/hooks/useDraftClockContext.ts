"use client";

import { useEffect, useRef, useState } from "react";

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
  const { disabled = false, pollMs = DEFAULT_POLL_MS } = options;
  const [context, setContext] = useState<DraftClockContext | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    if (disabled) {
      return () => {
        cancelledRef.current = true;
      };
    }

    const fetchOnce = async () => {
      try {
        const res = await fetch("/api/scouting/draft/clock-context", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: DraftClockContext | null };
        if (cancelledRef.current) return;
        setContext(json?.data ?? null);
      } catch {
        // ignore network errors; keep last snapshot
      }
    };

    fetchOnce();
    const interval = window.setInterval(
      fetchOnce,
      Math.max(MIN_POLL_MS, pollMs)
    );
    return () => {
      cancelledRef.current = true;
      window.clearInterval(interval);
    };
  }, [disabled, pollMs]);

  return context;
}
