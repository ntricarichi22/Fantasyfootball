"use client";

import { createDraftTickPoller, shouldPollDraftTick } from "@/scouting/draft-room/draftTick";
import { useLeagueFetch } from "@/infrastructure/identity/useLeagueFetch";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { useDraftStatus, type DraftStatus } from "@/scouting/draft-room/hooks/useDraftStatus";

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
 * Single shared subscriber to `/api/scouting/draft/state`. Mount once near the top of
 * the tree (e.g. inside `AppShell`) so every consumer reads the same snapshot
 * instead of polling independently.
 */
export function DraftStatusProvider({
  children,
  pollMs,
  disabled,
}: DraftStatusProviderProps) {
  const fetch = useLeagueFetch();
  const status = useDraftStatus({ pollMs, disabled });
  // The hook returns a fresh object on every poll. Memoize on the meaningful
  // primitive fields so consumers don't re-render when nothing has actually
  // changed. `state` (the raw DraftStateRow) is intentionally excluded from
  // the dependency list because it is reconstructed on every poll; any
  // semantically-meaningful change in it is already reflected in `status`,
  // the display and clock-anchor fields listed below.
  const { status: clockStatus, isActive, secondsRemaining, isLoading, state } = status;
  const pickSubmitted = state?.pick_submitted === true;
  const pickAnnouncedAt = state?.pick_announced_at ?? null;
  const currentPickIndex = state?.current_pick_index ?? null;
  const startsAt = state?.starts_at ?? null;
  const clockStartedAt = state?.clock_started_at ?? null;
  const baseSeconds = state?.seconds_remaining ?? null;
  const value = useMemo<DraftStatus>(
    () => ({ status: clockStatus, isActive, secondsRemaining, isLoading, state }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clockStatus, isActive, secondsRemaining, isLoading, pickSubmitted, pickAnnouncedAt, currentPickIndex, startsAt, clockStartedAt, baseSeconds]
  );

  // One owner for scheduled-start and active-clock retry polling. HTTP conflicts
  // never latch the clock in not_started; the next poll reads a fresh revision.
  useEffect(() => {
    if (clockStatus !== "running" && !(clockStatus === "not_started" && startsAt)) return;
    const poll = createDraftTickPoller(fetch,
      () => window.dispatchEvent(new Event("draft-log-refetch-requested")),
      () => shouldPollDraftTick(clockStatus, startsAt));
    void poll();
    const timer = window.setInterval(poll, 3000);
    window.addEventListener("focus", poll);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [clockStatus, fetch, startsAt]);

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
