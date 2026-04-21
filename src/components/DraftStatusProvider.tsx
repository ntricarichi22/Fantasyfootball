"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { useDraftStatus, type DraftStatus } from "../lib/hooks/useDraftStatus";

const DEFAULT_STATUS: DraftStatus = {
  status: "not_started",
  isActive: false,
  secondsRemaining: 0,
  state: null,
  isLoading: true,
};

const DraftStatusContext = createContext<DraftStatus>(DEFAULT_STATUS);

type DraftStatusProviderProps = {
  children: ReactNode;
  /** Poll interval in milliseconds. */
  pollMs?: number;
  /** Disable polling (initial fetch still runs). */
  disabled?: boolean;
};

/**
 * Single shared subscriber to `/api/draft-state`. Mount once near the top of
 * the tree (e.g. inside `AppShell`) so every consumer reads the same snapshot
 * instead of polling independently.
 */
export function DraftStatusProvider({
  children,
  pollMs,
  disabled,
}: DraftStatusProviderProps) {
  const status = useDraftStatus({ pollMs, disabled });
  // The hook returns a fresh object on every poll. Memoize on the meaningful
  // primitive fields so consumers don't re-render when nothing has actually
  // changed. `state` (the raw DraftStateRow) is intentionally excluded from
  // the dependency list because it is reconstructed on every poll; any
  // semantically-meaningful change in it is already reflected in `status`,
  // `isActive`, or `secondsRemaining`.
  const { status: clockStatus, isActive, secondsRemaining, isLoading, state } = status;
  const pickSubmitted = state?.pick_submitted === true;
  const pickAnnouncedAt = state?.pick_announced_at ?? null;
  const currentPickIndex = state?.current_pick_index ?? null;
  const startsAt = state?.starts_at ?? null;
  const value = useMemo<DraftStatus>(
    () => ({ status: clockStatus, isActive, secondsRemaining, isLoading, state }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clockStatus, isActive, secondsRemaining, isLoading, pickSubmitted, pickAnnouncedAt, currentPickIndex, startsAt]
  );

  // ----- /api/draft-tick safety net ---------------------------------------
  // The ClockBar's zero-crossing useEffect is the primary trigger, but it
  // can miss if the page is backgrounded, Realtime drops, or the timer
  // never reaches zero in this client. Poll the (idempotent) tick endpoint
  // every 3s while the draft is running so the maximum delay between a
  // timer expiring and the announcement firing is ~3s, regardless of
  // whether the primary trigger ran.
  useEffect(() => {
    if (clockStatus !== "running") return;
    const id = window.setInterval(() => {
      fetch("/api/draft-tick", { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
          if (data?.status === "advanced") {
            console.log("[poll] tick advanced state");
          }
        })
        .catch(() => {
          // ignore network errors — next interval will retry
        });
    }, 3000);
    return () => window.clearInterval(id);
  }, [clockStatus]);

  // Fire one tick on window focus so a user returning from a backgrounded
  // tab / sleeping phone catches up immediately instead of waiting up to
  // 3s for the next poll.
  useEffect(() => {
    if (clockStatus !== "running") return;
    const onFocus = () => {
      fetch("/api/draft-tick", { method: "POST" }).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [clockStatus]);

  return (
    <DraftStatusContext.Provider value={value}>
      {children}
    </DraftStatusContext.Provider>
  );
}

/** Read the shared draft status snapshot. */
export function useDraftStatusContext(): DraftStatus {
  return useContext(DraftStatusContext);
}
