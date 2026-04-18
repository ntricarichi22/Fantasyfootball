"use client";

import { useEffect, useRef, useState } from "react";

import {
  computeRemainingSeconds,
  type DraftClockStatus,
  type DraftStateRow,
} from "../draftState";

export type DraftStatus = {
  status: DraftClockStatus;
  /** True when the draft clock is running or paused (i.e. the draft is in progress). */
  isActive: boolean;
  /** Best-effort current seconds remaining on the pick clock. */
  secondsRemaining: number;
  /** Raw draft state row from the API, if any. */
  state: DraftStateRow | null;
  /** True until the first poll completes. */
  isLoading: boolean;
};

const DEFAULT_POLL_MS = 10_000;
const MIN_POLL_MS = 2_000;

const DEFAULT_STATUS: DraftStatus = {
  status: "not_started",
  isActive: false,
  secondsRemaining: 0,
  state: null,
  isLoading: true,
};

const isDraftActive = (status: DraftClockStatus): boolean =>
  status === "running" || status === "paused";

type UseDraftStatusOptions = {
  /** Poll interval in milliseconds. Defaults to 10s. */
  pollMs?: number;
  /** Disable polling entirely (still performs the initial fetch). */
  disabled?: boolean;
};

/**
 * Polls `/api/draft-state` and exposes a normalized snapshot of the league's
 * draft clock. Designed to be called once at the AppShell level and shared via
 * `DraftStatusProvider` so individual pages do not each fetch independently.
 */
export function useDraftStatus(options: UseDraftStatusOptions = {}): DraftStatus {
  const { pollMs = DEFAULT_POLL_MS, disabled = false } = options;
  const [snapshot, setSnapshot] = useState<DraftStatus>(DEFAULT_STATUS);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const apply = (state: DraftStateRow | null) => {
      if (cancelledRef.current) return;
      const status: DraftClockStatus = state?.status ?? "not_started";
      setSnapshot({
        status,
        isActive: isDraftActive(status),
        secondsRemaining: state ? computeRemainingSeconds(state) : 0,
        state,
        isLoading: false,
      });
    };

    const fetchOnce = async () => {
      try {
        const res = await fetch("/api/draft-state", { cache: "no-store" });
        if (!res.ok) {
          apply(null);
          return;
        }
        const json = (await res.json()) as { data?: DraftStateRow | null };
        apply(json?.data ?? null);
      } catch {
        apply(null);
      }
    };

    fetchOnce();

    if (disabled) {
      return () => {
        cancelledRef.current = true;
      };
    }

    const interval = window.setInterval(fetchOnce, Math.max(MIN_POLL_MS, pollMs));
    return () => {
      cancelledRef.current = true;
      window.clearInterval(interval);
    };
  }, [disabled, pollMs]);

  return snapshot;
}
